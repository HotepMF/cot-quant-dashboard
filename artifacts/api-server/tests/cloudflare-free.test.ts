import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { computeRows, defaultSignalSettings, signalMarket, type RawRow } from "@workspace/cot-engine";
import { RestD1 } from "../cloudflare/rest-d1";
import { launchUpdate } from "../cloudflare/launcher";
import { collectReports } from "../cloudflare/collector";
import { handleApi } from "../cloudflare/api";
import type { Sql } from "../cloudflare/database";
import type { Env } from "../cloudflare/types";

const history: RawRow[] = Array.from({ length: 70 }, (_, i) => ({
  date: new Date(Date.UTC(2098, 0, 1) + i * 7 * 86400000).toISOString().slice(0, 10),
  large_traders: i === 69 ? -2000 : Math.sin(i) * 100,
  commercial_hedgers: i === 69 ? 2000 : -Math.sin(i) * 100,
  small_traders: i === 69 ? 2000 : Math.cos(i) * 100, open_interest: 10000 + i,
}));
const asOf = history.at(-1)!.date;
const market = { name: "TEST CONTRACT - EXCHANGE", code: "42" };

test("Latest-only calculations exactly match full historical rules, across custom settings", () => {
  for (const participant of ["Commercial Hedgers", "Large Traders", "Small Traders"]) {
    for (const signalMode of ["Z-Score Only", "COT Confluence", "Both (AND gate)"]) {
      for (const requireSmall of [false, true]) for (const lookback of [3, 63, 100]) {
        const settings = { ...defaultSignalSettings, participant, signalMode, requireSmall, lookback };
        assert.deepEqual(computeRows(history, settings, true)[0], computeRows(history, settings).at(-1));
      }
    }
  }
  assert.deepEqual(computeRows([], defaultSignalSettings, true), []);
});

test("REST D1 adapter submits one atomic batch, binds values safely, sanitizes failures", async () => {
  const requests: any[] = [];
  const db = new RestD1("a".repeat(32), "b".repeat(8) + "-1234-1234-1234-" + "c".repeat(12), "test-only", (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ success: true, result: requests.at(-1).batch.map(() => ({ success: true, results: [{ value: 7 }], meta: {} })) });
  }) as typeof fetch);
  const batch = await db.batch([db.prepare("SELECT ? AS value").bind("x'; DROP TABLE cot_snapshots;--"), db.prepare("SELECT 7")]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].batch.length, 2);
  assert.equal(batch[0].results[0].value, 7);
  assert.equal(await db.prepare("SELECT 7 AS value").first("value"), 7);
  const unavailable = new RestD1("a".repeat(32), "b".repeat(8) + "-1234-1234-1234-" + "c".repeat(12), "sensitive-test-only", (async () => new Response("sensitive-test-only provider dump", { status: 403 })) as typeof fetch);
  await assert.rejects(unavailable.prepare("SELECT 1").all(), error => /HTTP 403/.test(String(error)) && !String(error).includes("sensitive-test-only"));
});

test("Browser background worker applies small-spec confirmation, caches histories and rejects mixed snapshots", async () => {
  const bundled = await build({ entryPoints: [new URL("../../cot-quant-dashboard/src/lib/scan.worker.ts", import.meta.url).pathname], bundle: true, write: false, format: "iife", platform: "browser" });
  let calls = 0, conflict = false;
  const responses = new Map<string, (value: any) => void>();
  const scope: any = { postMessage: (data: any) => { if (!data.progress) responses.get(data.id)?.(data); } };
  runInNewContext(bundled.outputFiles[0].text, {
    self: scope, AbortController, URL, console,
    fetch: async (_url: string, init: RequestInit) => {
      calls++;
      assert.ok(new Headers(init.headers).get("X-COT-Snapshot"));
      if (conflict) return new Response(null, { status: 409 });
      return Response.json({ reportAsOf: asOf, rows: history.map(r => ({ date: r.date, largeTraders: r.large_traders, smallTraders: r.small_traders, commercialHedgers: r.commercial_hedgers, openInterest: r.open_interest })) });
    },
  });
  const data = { report: "futures", reportAsOf: asOf, markets: [signalMarket(market, { rows: history, error: null }, asOf, defaultSignalSettings)], settings: defaultSignalSettings, total: 1, processed: 1, status: "ready" };
  const run = (id: string, requireSmall: boolean, snapshot = "test-snapshot", serverNow?: number) => new Promise<any>(resolve => {
    responses.set(id, resolve);
    scope.onmessage({ data: { id, data, snapshot, serverNow, params: { report: "futures", ...defaultSignalSettings, requireSmall }, marketUrl: "https://example.test/api/cot/market" } });
  });
  const confirmed = await run("confirmed", true);
  assert.equal(confirmed.result.markets[0].signal, "none", "opposing small specs remove the otherwise bullish setup");
  const withoutConfirmation = await run("without", false);
  assert.equal(withoutConfirmation.result.markets[0].signal, "bullish");
  assert.equal(calls, 1, "changing settings reuses immutable snapshot histories");
  const expired = await run("expired", false, "test-snapshot", Date.parse(asOf) + 11 * 86400000);
  assert.equal(expired.result.markets[0].signal, "unavailable", "server time prevents a wrong device clock from reviving stale setups");
  conflict = true;
  const mixed = await run("changed", true, "new-snapshot");
  assert.match(mixed.error, /dataset changed/i);
  assert.equal(mixed.result, undefined);
});

test("Actual D1 + REST + GitHub collector: complete both reports, preserve last-good data, stale scans and safe dispatch", async t => {
  const require = createRequire(import.meta.url);
  const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
  // Resolve through Wrangler to use its installed emulator API.
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", compatibilityDate: "2026-10-20", d1Databases: ["DB"] }));
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  try {
    const native = await runtime.getD1Database("DB") as Env["DB"];
    for (const file of ["0001_cot.sql", "0002_prepared_data.sql"]) {
      const schema = await readFile(new URL(`../../../deployment/cloudflare/migrations/${file}`, import.meta.url), "utf8");
      await native.batch(schema.split(";").map(s => s.trim()).filter(Boolean).map(s => native.prepare(s)));
    }
    let failCombined = false, sourceRequests = 0, dispatches = 0;
    let dispatchStatus = 204, dispatchThrows = false;
    const credentialMarker = "test-only-credential-must-not-appear-in-diagnostics";
    const transport = (async (_url, init) => {
      const { batch } = JSON.parse(String(init?.body));
      try {
        const results = await native.batch(batch.map((s: any) => native.prepare(s.sql).bind(...s.params)));
        return Response.json({ success: true, result: results });
      } catch { return Response.json({ success: false, result: [] }); }
    }) as typeof fetch;
    const db = new RestD1("a".repeat(32), "b".repeat(8) + "-1234-1234-1234-" + "c".repeat(12), "test-only", transport);
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "api.github.com") {
        dispatches++;
        if (dispatchThrows) throw new Error(`Transport error with Bearer ${credentialMarker}`);
        return new Response(dispatchStatus === 204 ? null : credentialMarker, {
          status: dispatchStatus,
          headers: { "X-Diagnostic-Test": credentialMarker },
        });
      }
      sourceRequests++;
      if (failCombined) return new Response(null, { status: 503 });
      const query = url.searchParams.get("query") ?? "";
      if (query.startsWith("SELECT report_date")) return Response.json([{ report_date_as_yyyy_mm_dd: asOf }]);
      if (query.startsWith("SELECT market_and_exchange_names, cftc_contract_market_code")) return Response.json([{ market_and_exchange_names: market.name, cftc_contract_market_code: market.code }]);
      return Response.json(history.map(r => ({ cftc_contract_market_code: market.code, report_date_as_yyyy_mm_dd: r.date, large_traders: String(r.large_traders), small_traders: String(r.small_traders), commercial_hedgers: String(r.commercial_hedgers), open_interest: String(r.open_interest) })));
    }) as typeof fetch;
    const result = await collectReports(db);
    assert.deepEqual(result.failures, []);
    assert.equal(await native.prepare("SELECT count(*) AS n FROM cot_snapshots").first("n"), 2);
    const env = { DB: native, GITHUB_REPOSITORY: "test/cot", GITHUB_ACTIONS_TOKEN: "test-only" } as Env;
    const call = (path: string, headers?: HeadersInit) => handleApi(new Request(`https://example.test/api/cot/${path}`, { headers }), env);
    const scan = await call("screener?report=futures");
    const snapshot = scan.headers.get("X-COT-Snapshot")!;
    assert.ok(snapshot);
    const scanBody: any = await scan.json();
    assert.equal(scanBody.markets[0].signal, "bullish");
    const detail = await call(`market?report=futures&market=${encodeURIComponent(market.name)}`, { "X-COT-Snapshot": snapshot });
    assert.equal((await detail.json() as any).rows.length, history.length);
    assert.equal((await call(`market?report=futures&market=${encodeURIComponent(market.name)}`, { "X-COT-Snapshot": "wrong" })).status, 409);
    assert.equal((await call("screener?report=futures&requireSmall=true")).status, 400, "custom rules are not silently replaced by default results");
    const clock = Date.now;
    try {
      Date.now = () => Date.parse(asOf) + 11 * 86400000;
      const stale: any = await (await call("screener?report=futures")).json();
      assert.equal(stale.markets[0].status, "stale");
      assert.equal(stale.markets[0].signal, "unavailable");
      assert.equal(stale.markets[0].setupScore, null);
    } finally { Date.now = clock; }
    const before = sourceRequests;
    await native.prepare("UPDATE cot_update_state SET last_attempt_at=NULL").run();
    await collectReports(db);
    assert.equal(sourceRequests - before, 4, "unchanged reports fetch metadata only, not all history");
    const firstRun = await native.prepare("SELECT run_id FROM cot_snapshots WHERE report='futures'").first("run_id");
    await native.prepare("UPDATE cot_update_state SET last_attempt_at=NULL").run();
    failCombined = true;
    const failed = await collectReports(db);
    assert.equal(failed.failures.length, 2);
    assert.equal(await native.prepare("SELECT run_id FROM cot_snapshots WHERE report='futures'").first("run_id"), firstRun);
    // Exercise the public refresh path with real D1 coordination. Only fixed
    // diagnostic fields may reach logs; upstream bodies and errors stay private.
    const diagnostics: unknown[][] = [];
    const errorLog = t.mock.method(console, "error", (...args: unknown[]) => { diagnostics.push(args); });
    const diagnosticEnv = { ...env, GITHUB_ACTIONS_TOKEN: credentialMarker };
    for (const status of [401, 403, 404, 422, 429, 500, null]) {
      dispatchStatus = status ?? 204;
      dispatchThrows = status === null;
      diagnostics.length = 0;
      await native.prepare("UPDATE cot_update_state SET last_attempt_at=NULL").run();
      const response = await handleApi(new Request("https://example.test/api/cot/screener/refresh", {
        method: "POST", body: JSON.stringify({ report: "futures" }),
      }), diagnosticEnv);
      assert.equal(response.status, 503);
      const publicBody = await response.text();
      assert.match(publicBody, /Last-good data has been retained/);
      assert.deepEqual(diagnostics.filter(args => args[0] === "github-dispatch-failed"), [
        ["github-dispatch-failed", { phase: status === null ? "transport" : "http", httpStatus: status }],
      ]);
      assert.ok(!JSON.stringify(diagnostics).includes(credentialMarker));
      assert.ok(!publicBody.includes(credentialMarker));
      assert.equal(await native.prepare("SELECT running FROM cot_update_state").first("running"), 0);
      assert.equal(await native.prepare("SELECT run_id FROM cot_snapshots WHERE report='futures'").first("run_id"), firstRun);
    }
    diagnostics.length = 0;
    dispatchStatus = 204;
    dispatchThrows = false;
    const dispatchesBeforeSuccess = dispatches;
    await native.prepare("UPDATE cot_update_state SET last_attempt_at=NULL").run();
    assert.equal(await launchUpdate(native.withSession("first-primary") as Sql, env, true), true);
    assert.equal(await launchUpdate(native.withSession("first-primary") as Sql, env, true), false);
    assert.equal(dispatches - dispatchesBeforeSuccess, 1, "Cron and manual updates share the same fenced cooldown");
    assert.deepEqual(diagnostics, [], "Successful dispatch and cooldown skips do not log failures");
    errorLog.mock.restore();
  } finally { await runtime.dispose(); }
});
