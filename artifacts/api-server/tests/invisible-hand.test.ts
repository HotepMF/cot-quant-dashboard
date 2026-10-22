import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { HAND_PARTICIPATION, HAND_POWER_PRODUCERS, eventTags, marketEvents } from "@workspace/cot-engine";
import { buildHand, changeZ, crowdedRows, hysteresis, participationRow, rangeRows } from "../cloudflare/hand-compute";
import { HAND_JOB } from "../cloudflare/hand-cli";
import type { CategoryHistory, CurvePoint, DailyBars, LatestCounts, SiteHistory } from "../cloudflare/hand-sources";
import { saveSnapshot } from "../cloudflare/sectors-cli";
import { handleApi } from "../cloudflare/api";
import { RestD1 } from "../cloudflare/rest-d1";
import type { DailyCloses } from "../cloudflare/sectors-sources";
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
const weeks = (n: number, f: (i: number) => { long: number; short: number }): CategoryHistory =>
  Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2023, 7, 1) + i * 7 * 86_400_000).toISOString().slice(0, 10), oi: 1000, ...f(i) }));
const counts = (long: number | null, short: number | null, top4 = 20): LatestCounts => ({ top4Long: top4, top4Short: top4, traders: { "leveraged funds": { long, short } } });

test("Labels enter at ±1.0 and hold until the reading falls back inside ±0.5", () => {
  assert.deepEqual(hysteresis([0, 1.1, 0.7, 0.4, -1.2, -0.6, -0.3, null], "high", "low", "normal"),
    ["normal", "high", "high", "normal", "low", "low", "normal", null]);
});

test("Change z-scores need 104 changes of history", () => {
  assert.equal(changeZ(Array.from({ length: 110 }, (_, i) => i), 13).at(-1), null);
  const z = changeZ([...Array.from({ length: 200 }, (_, i) => (i % 2) * 0.01), 5], 13).at(-1)!;
  assert.ok(z > 3, "a jump far outside the usual changes scores high");
});

test("Participation rows: net, gross, 3-year percentile and 4-week change; thin markets are withheld", () => {
  const spec = HAND_PARTICIPATION[0];
  const rising = weeks(165, i => ({ long: 100 + i, short: 200 }));
  const row = participationRow(spec, "leveraged funds", rising, counts(105, 191));
  assert.equal(row.netPct, 6.4);
  assert.deepEqual([row.longPct, row.shortPct], [26.4, 20]);
  assert.equal(row.pct3y, 100, "the highest reading in 3 years");
  assert.equal(row.chg4w, 0.4);
  assert.equal(row.withheld, false);
  assert.equal(participationRow(spec, "leveraged funds", rising, counts(7, 12)).withheld, true, "fewer than 20 traders");
  assert.equal(participationRow(spec, "leveraged funds", rising, counts(null, null)).netPct, null, "suppressed counts are withheld");
  assert.equal(participationRow(spec, "leveraged funds", rising, counts(100, 100, 55)).withheld, true, "top 4 hold more than half");
});

function inputs(curve: CurvePoint[] | null) {
  const prices = new Map<string, DailyCloses>();
  const days = 1300;
  // Calm, then a volatile final month: the volatility card should read high.
  prices.set("SPY", series(days, i => 300 * Math.exp(i * 0.0003 + (i > days - 22 ? (i % 2 ? 0.04 : -0.04) : (i % 2 ? 0.004 : -0.004)))));
  // Semis and power producers share the same excess-return wiggle: the AI gauge should read linked.
  const theme = (k: number) => (i: number) => 50 * Math.exp(i * 0.0003 + 0.05 * Math.sin(i / 3) + k * 0.001 * Math.sin(i / 11));
  prices.set("SMH", series(days, theme(0)));
  HAND_POWER_PRODUCERS.forEach((t, k) => prices.set(t, series(days, theme(k + 1))));
  for (const t of ["XLK", "XLU", "HYG", "IEF"]) prices.set(t, series(days, i => 80 * Math.exp(i * 0.0002)));
  prices.set("^VIX", series(days, () => 15)); prices.set("^VIX3M", series(days, () => 18));
  const participation = new Map(HAND_PARTICIPATION.map(spec => [spec.code, {
    histories: Object.fromEntries(spec.categories.map(c => [c, weeks(165, i => ({ long: 300 + Math.sin(i / 5) * 50, short: 300 }))])),
    counts: { top4Long: 20, top4Short: 20, traders: Object.fromEntries(spec.categories.map(c => [c, { long: 40, short: 40 }])) },
  }]));
  return { generatedAt: "2026-10-23T20:00:00.000Z", priceSource: "test", prices, curve, participation };
}

test("A snapshot has all five cards, every participation row, and marks unconnected sources as pending", () => {
  // 2s10s flat for years, then steepens sharply in the last 13 weeks while the 10-year rises: a bear steepener.
  const spy = series(1300, () => 1);
  const curve = spy.dates.map((date, i) => {
    const late = Math.max(0, i - 1235) * 0.012;
    return { date, m3: 4, y2: 4.2 + 0.01 * Math.sin(i / 9), y10: 4.6 + 0.01 * Math.sin(i / 7) + late };
  });
  const s = buildHand(inputs(curve));
  assert.deepEqual(s.cards.map(c => c.id), ["credit", "rates", "power", "volatility", "ai"]);
  assert.deepEqual(s.cards.filter(c => c.status === "pending").map(c => c.id), ["credit", "power"]);
  const card = (id: string) => s.cards.find(c => c.id === id)!;
  assert.equal(card("rates").state, "steepener");
  assert.match(card("rates").headline, /steepening: 2s10s \+\d+ bp over 13 weeks \(bear\)/);
  assert.equal(card("volatility").state, "high");
  assert.match(card("volatility").readings[1].note!, /upward-sloping/);
  assert.equal(card("ai").state, "linked");
  assert.equal(s.participation.length, HAND_PARTICIPATION.reduce((n, p) => n + p.categories.length, 0));
  assert.equal(s.positioningAsOf, s.participation[0].reportDate);
  assert.ok(JSON.stringify(s).length < 60_000);
  assert.equal(buildHand(inputs(null)).cards.find(c => c.id === "rates")!.status, "pending", "no yields: rates pending, page still built");
});

test("Calendar: official dates plus expirations from exchange rules, holiday shifts included", () => {
  const ev = marketEvents("2026-06-01", "2026-12-31");
  const on = (kind: string, d: string) => ev.some(e => e.kind === kind && e.date === d);
  assert.ok(on("witching", "2026-06-18"), "Juneteenth fell on the third Friday, so June witching moved to Thursday");
  assert.ok(on("roll", "2026-12-10") && on("witching", "2026-12-18"));
  assert.ok(on("last-trade", "2026-10-20"), "WTI Nov: the 25th is a Sunday, so 4 business days before");
  assert.ok(on("last-trade", "2026-11-20"), "WTI Dec: 3 business days before Wed Nov 25");
  assert.ok(on("last-trade", "2026-11-25"), "Natural gas Dec: 3 business days before Dec 1, skipping Thanksgiving");
  assert.ok(on("fomc", "2026-10-28") && on("cpi", "2026-11-10") && on("payrolls", "2026-11-06"));
  assert.ok(ev.every((e, i) => i === 0 || ev[i - 1].date <= e.date), "sorted by date");
});

test("Event tags: next 7 days, and the week the latest report covers", () => {
  const es = eventTags("13874+", "2026-10-13", "2026-10-22");
  assert.deepEqual(es.upcoming.map(e => e.kind), ["fomc"]);
  assert.deepEqual(es.inData.map(e => e.kind), []);
  const after = eventTags("13874+", "2026-10-20", "2026-10-22");
  assert.deepEqual(after.inData.map(e => `${e.kind} ${e.date}`), ["cpi 2026-10-14", "opex 2026-10-16"], "CPI and opex fell inside the Oct 14-20 report week");
  assert.deepEqual(eventTags("067651", "2026-10-13", "2026-10-22").upcoming, [], "crude is not tagged with macro releases");
  assert.equal(eventTags("023651", "2026-10-13", "2026-10-22").upcoming[0].short, "NG expiry");
});

test("Expected ranges convert the tested median and wide day into points; crowded watch finds 3-year extremes", () => {
  const bars: DailyBars = { dates: [], high: [], low: [], close: [] };
  for (let i = 0; i < 30; i++) { bars.dates.push(`2026-09-${String(i + 1).padStart(2, "0")}`); bars.close.push(1000); bars.high.push(1005); bars.low.push(995); }
  const [es] = rangeRows("normal", new Map([["ES", bars]]));
  assert.deepEqual([es.medianPct, es.medianPts, es.p80Pts, es.recent20Pct], [1.18, 12, 19, 1]);
  assert.equal(rangeRows("high", new Map([["ES", bars]]))[0].medianPct, 1.98);
  const weekly = (f: (i: number) => number): SiteHistory => Array.from({ length: 170 }, (_, i) => ({ date: new Date(Date.UTC(2023, 7, 1) + i * 7 * 86_400_000).toISOString().slice(0, 10), largeTraders: f(i), commercialHedgers: -f(i), openInterest: 1000 }));
  const rows = crowdedRows(new Map([["088691", weekly(i => i)], ["067651", weekly(i => Math.sin(i / 3) * 50)]]));
  assert.deepEqual(rows.map(r => [r.symbol, r.side, r.specPct3y, r.commPct3y]), [["GC", "top", 100, 0]], "gold at a 3-year high; mid-range crude is left out");
});

test("Actual D1: the snapshot is stored once per CFTC week and served by /api/invisible-hand", async t => {
  const require = createRequire(import.meta.url);
  const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default {fetch(){return new Response('ok')}}", compatibilityDate: "2026-10-20", d1Databases: ["DB"] }));
  t.after(async () => { await runtime.dispose(); });
  const native = await runtime.getD1Database("DB") as Env["DB"];
  for (const file of ["0001_cot.sql", "0002_prepared_data.sql", "0003_documents.sql"]) {
    const schema = await readFile(new URL(`../../../deployment/cloudflare/migrations/${file}`, import.meta.url), "utf8");
    await native.batch(schema.split(";").map(s => s.trim()).filter(Boolean).map(s => native.prepare(s)));
  }
  const env = { DB: native } as Env;
  const hand = () => handleApi(new Request("https://example.test/api/invisible-hand"), env);
  assert.equal((await hand()).status, 503, "no snapshot yet");

  const transport = (async (_url, init) => {
    const { batch } = JSON.parse(String(init?.body));
    const results = await native.batch(batch.map((s: any) => native.prepare(s.sql).bind(...s.params)));
    return Response.json({ success: true, result: results });
  }) as typeof fetch;
  const rest = new RestD1("a".repeat(32), "b".repeat(8) + "-1234-1234-1234-" + "c".repeat(12), "test-only", transport);
  const snap = buildHand(inputs(null));
  await saveSnapshot(rest, HAND_JOB, snap.positioningAsOf, JSON.stringify(snap), HAND_JOB);
  await saveSnapshot(rest, HAND_JOB, snap.positioningAsOf, JSON.stringify({ ...snap, pricesAsOf: "next-close" }), HAND_JOB);
  const res = await hand();
  assert.equal(res.status, 200);
  assert.equal((await res.json() as any).pricesAsOf, "next-close", "price refreshes in the same CFTC week replace the current document");
  assert.equal(await native.prepare("SELECT count(*) AS n FROM cot_cf_document_history WHERE key=?").bind(HAND_JOB).first("n"), 1, "one history row per CFTC week");
  assert.ok(await native.prepare("SELECT last_success_at FROM cot_cf_jobs WHERE id=?").bind(HAND_JOB).first("last_success_at"));
  assert.equal(await native.prepare("SELECT count(*) AS n FROM cot_cf_jobs WHERE id='daily-sectors'").first("n"), 0, "does not mark the sectors job done");
  assert.equal((await handleApi(new Request("https://example.test/api/invisible-hand", { method: "POST" }), env)).status, 405);
});
