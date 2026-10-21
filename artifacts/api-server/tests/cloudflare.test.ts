import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";
import { handleApi } from "../cloudflare/api";
import { officialHistories, officialMarkets } from "../cloudflare/cftc-source";
import { acquireUpdate, commitRun, finishUpdate, initializeRun, readHistories, stageHistories, updateStatus, viewMetadata } from "../cloudflare/repository";
import type { Sql } from "../cloudflare/database";
import type { Env } from "../cloudflare/types";
import type { RawRow } from "@workspace/cot-engine";
import { computeRows, defaultSignalSettings, signalMarket } from "@workspace/cot-engine";
import { stagePublicHistories, stageSignals } from "../cloudflare/prepared";
import { RestD1 } from "../cloudflare/rest-d1";
import { launchUpdate } from "../cloudflare/launcher";

const emptyEnv = {} as Env;
const request = (path: string, init?: RequestInit) => new Request(`https://cot.example/api${path}`, init);

test("Worker validates routes, methods and settings without needing a database", async () => {
  for (const [req, expected] of [
    [request("/healthz"), 200], [request("/unknown"), 404],
    [request("/cot/screener?report=invalid"), 400],
    [request("/cot/screener?report=futures&lookback=2"), 400],
    [request("/cot/screener?report=futures&report=combined"), 400],
    [request("/cot/market?report=futures"), 400],
    [request("/cot/update-status", { method: "POST" }), 405],
    [request("/cot/screener/refresh", { method: "POST", body: "{}" }), 400],
    [request("/cot/screener/refresh", { method: "POST", body: "null" }), 400],
    [request("/cot/screener/refresh", { method: "POST", body: "{" }), 400],
    [request("/cot/screener/refresh", { method: "POST", body: '{"report":"futures"}', headers: { Origin: "https://elsewhere.example" } }), 403],
  ] as const) {
    const response = await handleApi(req, emptyEnv);
    assert.equal(response.status, expected, req.url);
    assert.match(response.headers.get("Content-Type")!, /application\/json/);
  }
});

test("Database failures become explicit, sanitized HTTP 503 responses", async () => {
  const response = await handleApi(request("/cot/update-status"), emptyEnv);
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.match(text, /storage is temporarily unavailable/);
  assert.doesNotMatch(text, /postgres:|password|connectionString|SELECT/);
});

test("Official history parsing preserves exact market names and safely quotes names", async t => {
  let query = "";
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    query = url.searchParams.get("query")!;
    return new Response(JSON.stringify([{
      market_and_exchange_names: "TEST'S MARKET - EXCHANGE", report_date_as_yyyy_mm_dd: "2026-10-13T00:00:00.000",
      large_traders: "11", commercial_hedgers: "-12", small_traders: "1", open_interest: "100",
    }]));
  });
  const histories = await officialHistories("futures", "2026-10-13", [{ name: "TEST'S MARKET - EXCHANGE", code: "012345" }]);
  assert.match(query, /TEST''S MARKET - EXCHANGE/);
  assert.equal(histories.get("TEST'S MARKET - EXCHANGE")!.rows[0].commercial_hedgers, -12);
});

test("Conflicting, invalid, and incomplete CFTC batches are rejected", async t => {
  const base = { market_and_exchange_names: "TEST", report_date_as_yyyy_mm_dd: "2026-10-13T00:00:00.000", large_traders: "11", commercial_hedgers: "-12", small_traders: "1", open_interest: "100" };
  let rows: unknown[] = [base, { ...base, large_traders: "99" }];
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(rows)));
  await assert.rejects(officialHistories("futures", "2026-10-13", [{ name: "TEST", code: "1" }]), /Conflicting/);
  rows = [{ ...base, large_traders: null }];
  await assert.rejects(officialHistories("futures", "2026-10-13", [{ name: "TEST", code: "1" }]), /Invalid/);
  rows = [];
  await assert.rejects(officialHistories("futures", "2026-10-13", [{ name: "TEST", code: "1" }]), /missing/);
});

test("Ambiguous official current market lists cannot initialize a scan", async t => {
  let call = 0;
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(++call === 1
    ? [{ report_date_as_yyyy_mm_dd: "2026-10-13T00:00:00.000" }]
    : [{ market_and_exchange_names: "DUPLICATE", cftc_contract_market_code: "1" }, { market_and_exchange_names: "DUPLICATE", cftc_contract_market_code: "2" }])));
  await assert.rejects(officialMarkets("combined"), /ambiguous/);
});

test("Actual D1 runtime: leases, resumable staging, atomic snapshots, API parity and cooldown", async t => {
  // Use Wrangler's installed Miniflare runtime, not a PostgreSQL/SQLite mock.
  const require = createRequire(import.meta.url);
  const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: "export default {fetch(){return new Response('D1 integration test')}}",
    compatibilityDate: "2026-10-20", d1Databases: { DB: "cot-integration-tests" },
  }));
  try {
    const db = await runtime.getD1Database("DB") as Env["DB"];
    const schema = await readFile(new URL("../../../deployment/cloudflare/migrations/0001_cot.sql", import.meta.url), "utf8");
    const preparedSchema = await readFile(new URL("../../../deployment/cloudflare/migrations/0002_prepared_data.sql", import.meta.url), "utf8");
    await db.batch((schema + preparedSchema).split(";").map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
    const sql: Sql = db.withSession("first-primary");
    const owner = crypto.randomUUID();
    assert.equal(await acquireUpdate(sql, owner), true);
    assert.equal(await acquireUpdate(sql, crypto.randomUUID()), false);
    const markets = [{ name: "CF TEST A - EXCHANGE", code: "1" }, { name: "CF TEST B - EXCHANGE", code: "2" }];
    const reportAsOf = "2099-01-06";
    await initializeRun(sql, owner, "futures", { reportAsOf, markets });
    const row: RawRow = { date: reportAsOf, large_traders: 10, small_traders: 1, commercial_hedgers: -11, open_interest: 100 };
    const batch = new Map([[markets[0].name, { rows: [row], error: null }]]);
    await stageHistories(sql, owner, "futures", batch);
    await stageHistories(sql, owner, "futures", batch);
    assert.equal((await viewMetadata(sql, "futures"))!.processed, 1, "retry does not double-count");
    await assert.rejects(commitRun(sql, owner, "futures"), /Incomplete/);
    await stageHistories(sql, owner, "futures", new Map([[markets[1].name, { rows: [row], error: null }]]));
    await assert.rejects(commitRun(sql, owner, "futures", true), /CHECK|constraint/, "prepared scan and public histories are mandatory before publication");
    const completeHistories = new Map(markets.map(m => [m.name, { rows: [row], error: null }]));
    await stagePublicHistories(sql, owner, "futures", completeHistories);
    await stageSignals(sql, owner, "futures", markets.map(m => signalMarket(m, completeHistories.get(m.name), reportAsOf, defaultSignalSettings)));
    await commitRun(sql, owner, "futures");
    await commitRun(sql, owner, "futures"); // Successful commit replay is harmless.
    const view = (await viewMetadata(sql, "futures"))!;
    assert.equal(view.status, "ready");
    assert.equal((await readHistories(sql, view, [markets[0].name])).size, 1);
    await finishUpdate(sql, owner, [reportAsOf, reportAsOf], []);
    assert.equal((await updateStatus(sql)).running, false);
    assert.equal(await acquireUpdate(sql, crypto.randomUUID()), false, "not due");
    let created = 0;
    const env = { DB: db, GITHUB_REPOSITORY: "test/cot", GITHUB_ACTIONS_TOKEN: "test-only" } as unknown as Env;
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://api.github.com/")) { created++; return new Response(null, { status: 204 }); }
      return originalFetch(input, init);
    }) as typeof fetch;
    const scopedDatabase: typeof import("../cloudflare/database").withDatabase = async (_env, run) => run(sql);
    const call = (path: string, init?: RequestInit) => handleApi(request(path, init), env, undefined, undefined, scopedDatabase);
    const marketList = await (await call("/cot/markets?report=futures")).json() as any;
    assert.equal(marketList.markets.length, 2);
    const detail = await (await call(`/cot/market?report=futures&market=${encodeURIComponent(markets[0].name)}`)).json() as any;
    assert.equal(detail.rows[0].commercialHedgers, -11);
    const scanner = await (await call("/cot/screener?report=futures")).json() as any;
    assert.equal(scanner.total, 2);
    assert.equal(scanner.markets[0].status, "insufficient");
    assert.equal(scanner.markets[0].signal, "unavailable", "short history never becomes neutral");
    const init = { method: "POST", body: '{"report":"futures"}' };
    assert.equal((await call("/cot/screener/refresh", init)).status, 200);
    assert.equal(created, 0, "fifteen-minute cooldown enforced");
    await sql.prepare("UPDATE cot_update_state SET last_attempt_at=NULL WHERE id='weekly-cftc'").run();
    await call("/cot/screener/refresh", init);
    await call("/cot/screener/refresh", init);
    assert.equal(created, 1, "concurrent refreshes coalesce");
    await assert.rejects(initializeRun(sql, owner, "combined", { reportAsOf, markets }), /CHECK|constraint/, "expired owner is fenced");
    assert.equal(await sql.prepare("SELECT count(*) AS n FROM cot_cf_runs WHERE report='combined'").first("n"), 0, "failed guard rolls the entire batch back");
    const secondOwner = (await sql.prepare("SELECT owner FROM cot_cf_leases WHERE id='weekly-cftc'").first<{owner:string}>())!.owner;
    await initializeRun(sql, secondOwner, "futures", { reportAsOf: "2098-01-07", markets });
    await stageHistories(sql, secondOwner, "futures", new Map(markets.map(m => [m.name, { rows: [{ ...row, date: "2098-01-07" }], error: null }])));
    await assert.rejects(commitRun(sql, secondOwner, "futures"), /newer official snapshot/, "older source cannot overwrite newer data");
    await sql.prepare("UPDATE cot_cf_leases SET expires_at=0 WHERE id='weekly-cftc'").run();
    assert.equal(await acquireUpdate(sql, crypto.randomUUID()), true, "expired lease permits recovery without a browser");
    const lastGood = await sql.prepare("SELECT report_as_of FROM cot_snapshots WHERE report='futures'").first("report_as_of");
    assert.equal(lastGood, reportAsOf, "failure and expired workflows preserve last-good data");
    // D1 is a separate store: this test never connects to Replit PostgreSQL.
  } finally {
    await runtime.dispose();
  }
});
