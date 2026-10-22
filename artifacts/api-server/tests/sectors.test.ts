import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { BENCHMARK, POSITIONING_MARKETS, SECTOR_ETFS } from "@workspace/cot-engine";
import { buildSnapshot, latestZ, momentum, weeklyLast } from "../cloudflare/sectors-compute";
import { launchSectors, sectorsDue } from "../cloudflare/sectors-launcher";
import { saveSnapshot } from "../cloudflare/sectors-cli";
import { handleApi } from "../cloudflare/api";
import { RestD1 } from "../cloudflare/rest-d1";
import type { DailyCloses, PositioningHistory } from "../cloudflare/sectors-sources";
import type { Env } from "../cloudflare/types";

/** Weekday closes from 2020-01-01, value(i) per trading day. */
function series(days: number, value: (i: number) => number): DailyCloses {
  const out: DailyCloses = { dates: [], closes: [] };
  for (let t = Date.UTC(2020, 0, 1), i = 0; out.dates.length < days; t += 86_400_000) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    out.dates.push(new Date(t).toISOString().slice(0, 10)); out.closes.push(value(i++));
  }
  return out;
}
const positioning = (net: (i: number) => number): PositioningHistory =>
  Array.from({ length: 165 }, (_, i) => ({ date: new Date(Date.UTC(2023, 7, 1) + i * 7 * 86_400_000).toISOString().slice(0, 10), fundsNetPct: net(i), otherNetPct: -net(i) }));

test("Weekly closes take each week's last trading day; the latest week may be partial", () => {
  const w = weeklyLast(["2026-10-12", "2026-10-16", "2026-10-19", "2026-10-21"], [1, 2, 3, 4]);
  assert.deepEqual(w.map(x => [x.date, x.value]), [["2026-10-16", 2], ["2026-10-21", 4]]);
});

test("z-scores need 104 weeks of moves and use the trailing 156", () => {
  assert.equal(latestZ(Array.from({ length: 100 }, (_, i) => i), 13), null);
  const flatThenJump = [...Array.from({ length: 200 }, (_, i) => (i % 2) * 0.01), 0.2];
  assert.ok(latestZ(flatThenJump, 4)! > 3, "a jump far outside the usual range scores high");
});

test("Momentum labels follow the 4-week z and the 3-month direction", () => {
  assert.deepEqual(momentum(0.8, 5), { arrow: "▲", word: "Rising", qualifier: "gaining" });
  assert.equal(momentum(0.8, -5)!.qualifier, "turning up");
  assert.equal(momentum(-0.8, 5)!.qualifier, "fading");
  assert.equal(momentum(-0.8, -5)!.qualifier, "still falling");
  assert.equal(momentum(0.2, 5)!.word, "Flat");
  assert.equal(momentum(null, 5), null);
});

test("The job runs once per weekday evening in New York, retrying every 90 minutes until it succeeds", () => {
  const wed1800 = Date.UTC(2026, 9, 21, 22, 0); // 18:00 EDT
  assert.equal(sectorsDue(wed1800, null, null), true);
  assert.equal(sectorsDue(Date.UTC(2026, 9, 21, 20, 0), null, null), false, "16:00 is before the close window");
  assert.equal(sectorsDue(Date.UTC(2026, 9, 24, 22, 0), null, null), false, "Saturday");
  assert.equal(sectorsDue(wed1800, wed1800 - 30 * 60_000, null), false, "dispatched 30 minutes ago");
  assert.equal(sectorsDue(wed1800 + 100 * 60_000, wed1800, null), true, "retry after 90 minutes without success");
  assert.equal(sectorsDue(wed1800 + 100 * 60_000, wed1800, wed1800 + 10 * 60_000), false, "already succeeded today");
  assert.equal(sectorsDue(wed1800, Date.UTC(2026, 9, 20, 22, 0), Date.UTC(2026, 9, 20, 22, 5)), true, "yesterday's success does not count");
});

function synthetic() {
  const prices = new Map<string, DailyCloses>();
  prices.set(BENCHMARK, series(900, i => 300 * Math.exp(i * 0.0003)));
  SECTOR_ETFS.forEach((s, k) => prices.set(s.ticker, series(900, i => 50 * Math.exp(i * 0.0003 + (k - 5) * 0.0002 * i + 0.02 * Math.sin(i / 15 + k)))));
  for (const m of POSITIONING_MARKETS) if (m.priceTicker) prices.set(m.priceTicker, series(900, i => 80 + Math.sin(i / 20) * 5));
  const pos = new Map<string, PositioningHistory>();
  POSITIONING_MARKETS.forEach((m, k) => pos.set(m.id, positioning(i => k === 3 ? i : Math.sin(i / 7) * 10)));
  return buildSnapshot({ generatedAt: "2026-10-21T22:30:00.000Z", priceSource: "test", prices, positioning: pos, y10: [{ date: "2026-07-01", value: 4.5 }, { date: "2026-10-21", value: 5.1 }], y2: [{ date: "2026-07-01", value: 4.2 }, { date: "2026-10-21", value: 4.8 }] });
}

test("A snapshot covers every sector, positioning market and panel, ranked by 3-month relative performance", () => {
  const s = synthetic();
  assert.equal(s.sectors.length, SECTOR_ETFS.length);
  assert.ok(s.sectors.every((r, i) => i === 0 || (s.sectors[i - 1].rel.m3 ?? 0) >= (r.rel.m3 ?? 0)));
  assert.ok(s.sectors.every(r => r.spark.length === 27 && r.momentum && r.z.w13 != null && r.rel.y1 != null));
  assert.equal(s.positioning.length, POSITIONING_MARKETS.length);
  const rising = s.positioning.find(p => p.id === POSITIONING_MARKETS[3].id)!;
  assert.equal(rising.fundsPct3y, 100);
  assert.equal(rising.label3y, "Crowded · top");
  assert.deepEqual(s.yields, { y10: 5.1, y10chg13w: 60, y2: 4.8, y2chg13w: 60, asOf: "2026-10-21" });
  const energy = s.panels.find(p => p.id === "energy")!;
  assert.match(energy.read.join(" "), /Gasoline: the managed money position is crowded at the top of its 3-year range \(100th percentile\)/);
  assert.match(s.panels.find(p => p.id === "utilities-rates")!.read.join(" "), /10-year yield 5\.10% \(\+60 bp in 13 weeks\)/);
  assert.ok(JSON.stringify(s).length < 100_000);
});

test("Actual D1: the job's snapshot is stored with history, served by /api/sectors, and the daily dispatch is recorded", async t => {
  const require = createRequire(import.meta.url);
  const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", compatibilityDate: "2026-10-20", d1Databases: ["DB"] }));
  const originalFetch = globalThis.fetch;
  t.after(async () => { globalThis.fetch = originalFetch; await runtime.dispose(); });
  const native = await runtime.getD1Database("DB") as Env["DB"];
  for (const file of ["0001_cot.sql", "0002_prepared_data.sql", "0003_documents.sql"]) {
    const schema = await readFile(new URL(`../../../deployment/cloudflare/migrations/${file}`, import.meta.url), "utf8");
    await native.batch(schema.split(";").map(s => s.trim()).filter(Boolean).map(s => native.prepare(s)));
  }
  const env = { DB: native, GITHUB_REPOSITORY: "test/cot", GITHUB_ACTIONS_TOKEN: "test-only" } as Env;
  const sectors = () => handleApi(new Request("https://example.test/api/sectors"), env);
  assert.equal((await sectors()).status, 503, "no snapshot yet");

  const transport = (async (_url, init) => {
    const { batch } = JSON.parse(String(init?.body));
    const results = await native.batch(batch.map((s: any) => native.prepare(s.sql).bind(...s.params)));
    return Response.json({ success: true, result: results });
  }) as typeof fetch;
  const rest = new RestD1("a".repeat(32), "b".repeat(8) + "-1234-1234-1234-" + "c".repeat(12), "test-only", transport);
  const snap = synthetic();
  await saveSnapshot(rest, "sectors", snap.pricesAsOf, JSON.stringify(snap));
  await saveSnapshot(rest, "sectors", snap.pricesAsOf, JSON.stringify({ ...snap, generatedAt: "rerun" }));
  const res = await sectors();
  assert.equal(res.status, 200);
  assert.equal((await res.json() as any).generatedAt, "rerun", "same day reruns replace the current document");
  assert.equal(await native.prepare("SELECT count(*) AS n FROM cot_cf_document_history").first("n"), 1, "one history row per prices date");
  assert.equal((await handleApi(new Request("https://example.test/api/sectors", { method: "POST" }), env)).status, 405);

  let dispatches = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.match(String(input), /actions\/workflows\/sectors-update\.yml\/dispatches$/);
    dispatches++;
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const sql = native.withSession("first-primary");
  const wed1800 = Date.UTC(2026, 9, 21, 22, 0);
  await native.prepare("DELETE FROM cot_cf_jobs").run();
  assert.equal(await launchSectors(sql, env, wed1800), true);
  assert.equal(await launchSectors(sql, env, wed1800 + 10 * 60_000), false, "not again within 90 minutes");
  assert.equal(dispatches, 1);
  globalThis.fetch = (async () => new Response(null, { status: 403 })) as typeof fetch;
  await assert.rejects(launchSectors(sql, env, wed1800 + 100 * 60_000), /HTTP 403/);
  assert.equal(await native.prepare("SELECT last_error FROM cot_cf_jobs").first("last_error"), "dispatch failed");
});
