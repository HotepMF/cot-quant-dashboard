import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { CURVE_DEPTH, CURVE_MARKETS, curveCandidates, curveCarry, curveSpread, realisedVol, type CurveContract, type CurvePairHistory, type CurveRow, type CurveSnapshot } from "@workspace/cot-engine";
import { settledThrough } from "./hand-compute";
import { upTo, yahooBars } from "./hand-sources";
import { RestD1 } from "./rest-d1";
import { saveSnapshot } from "./sectors-cli";

export const CURVES_JOB = "curves";
const UA = { "User-Agent": "Mozilla/5.0 (cot-quant curve archive)" };
const round = (x: number) => Number(x.toFixed(4));

/**
 * Final daily closes of one contract over the last few sessions (dates on or before `through`, empty closes skipped).
 * After the close Yahoo can leave today's close empty for busy contracts and add a live point dated tomorrow, so the
 * caller lines contracts up on a date they all share instead of taking each one's latest point.
 */
async function yahooCloses(ticker: string, through: string): Promise<Map<string, number>> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.searchParams.set("range", "5d");
  url.searchParams.set("interval", "1d");
  const out = new Map<string, number>();
  const response = await fetch(url, { headers: { ...UA, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return out;
  const body = await response.json() as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } };
  const r = body.chart?.result?.[0], close = r?.indicators?.quote?.[0]?.close ?? [];
  (r?.timestamp ?? []).forEach((t, i) => {
    const c = close[i], date = new Date(t * 1000).toISOString().slice(0, 10);
    if (c != null && c > 0 && date <= through) out.set(date, c);
  });
  return out;
}

/**
 * Annualised 5-year vol of a continuous series with roll jumps removed: daily moves beyond 8x the median absolute
 * move are dropped (in seasonal curves such as hogs or gas, a roll can be a 10% "move" that never happened).
 */
function normalVol(closes: number[]): number | null {
  const r = closes.slice(1).map((x, i) => Math.log(x / closes[i])).filter(Number.isFinite);
  const med = [...r].map(Math.abs).sort((a, b) => a - b)[Math.floor(r.length / 2)] ?? 0;
  const kept = r.filter(x => Math.abs(x) <= 8 * med);
  if (kept.length < 500) return null;
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
  return Math.sqrt(kept.reduce((a, b) => a + (b - mean) ** 2, 0) / (kept.length - 1) * 252);
}

/** Front-minus-second daily closes on the dates both traded, last ~3 months (today's pair, so no roll inside). */
function pairHistory(near: { month: string; dates: string[]; close: number[] }, far: { month: string; dates: string[]; close: number[] }): CurvePairHistory | undefined {
  const farByDate = new Map(far.dates.map((d, i) => [d, far.close[i]]));
  const h: CurvePairHistory = { near: near.month, far: far.month, dates: [], spread: [] };
  near.dates.forEach((d, i) => {
    const f = farByDate.get(d);
    if (f != null && f > 0 && near.close[i] > 0) { h.dates.push(d); h.spread.push(Number((near.close[i] - f).toPrecision(8))); }
  });
  return h.dates.length >= 5 ? h : undefined;
}

/** Cboe VIX futures: the next monthly contracts' latest settlements from Cboe's public per-contract files. */
async function cboeVix(today: string, through: string): Promise<{ contracts: CurveContract[]; history?: CurvePairHistory; vol?: CurveRow["vol"] }> {
  const list = await (await fetch("https://www.cboe.com/us/futures/market_statistics/historical_data/product/list/VX/", { headers: UA, signal: AbortSignal.timeout(30_000) })).json() as Record<string, { expire_date: string; duration_type: string; path: string }[]>;
  const months = Object.values(list).flat().filter(c => c.duration_type === "M" && c.expire_date >= today).sort((a, b) => a.expire_date.localeCompare(b.expire_date)).slice(0, CURVE_DEPTH);
  const out: CurveContract[] = [], series: { month: string; dates: string[]; close: number[] }[] = [];
  for (const c of months) {
    const response = await fetch(`https://cdn.cboe.com/${c.path}`, { headers: UA, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) continue;
    const month = c.expire_date.slice(0, 7).replace("-", "");
    const rows = (await response.text()).trim().split(/\r?\n/).map(l => l.split(",")).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f[0]) && f[0] <= through && Number(f[6]) > 0).slice(-65);
    const last = rows.at(-1);
    if (!last) continue;
    out.push({ month, ticker: `VX ${c.expire_date}`, date: last[0], close: Number(last[6]) });
    series.push({ month, dates: rows.map(f => f[0]), close: rows.map(f => Number(f[6])) });
  }
  // VIX futures' own vol: the front contract's last 20 settlements; no 5-year normal (each file is one contract).
  const now = series[0] ? realisedVol(series[0].close) : null;
  return { contracts: out, history: series.length >= 2 ? pairHistory(series[0], series[1]) : undefined, vol: now == null ? undefined : { now: round(now), normal: null, ratio: null } };
}

/**
 * Daily curve archive: the first few live contracts of every core market, one history row per trading day.
 * Runs after the evening sectors job. `--dry-run` prints the snapshot instead of saving it.
 */
async function main() {
  const today = new Date().toISOString().slice(0, 10);
  // Only settled closes: through yesterday in New York (the same rule as the oscillator job).
  const through = settledThrough();
  const markets: CurveRow[] = [], missing: string[] = [];
  for (const m of CURVE_MARKETS) {
    const fetched: { month: string; ticker: string; closes: Map<string, number> }[] = [];
    for (const c of curveCandidates(m, today)) {
      const closes = await yahooCloses(c.ticker, through).catch(() => new Map<string, number>());
      if (closes.size) fetched.push({ month: c.month, ticker: c.ticker, closes });
      if (fetched.length >= CURVE_DEPTH + 1) break;
    }
    // The latest date on which at least two contracts both have a final close; contracts without one that day
    // (expired, in delivery, or not yet settled) are left out.
    const dates = [...new Set(fetched.flatMap(f => [...f.closes.keys()]))].sort().reverse();
    const day = dates.find(d => fetched.filter(f => f.closes.has(d)).length >= 2);
    const live: CurveContract[] = day ? fetched.filter(f => f.closes.has(day)).slice(0, CURVE_DEPTH)
      .map(f => ({ month: f.month, ticker: f.ticker, date: day, close: f.closes.get(day)! })) : [];
    if (live.length < 2) { missing.push(m.symbol); continue; }
    // Spread history of today's front pair: context only, so a failed fetch leaves it out rather than the market.
    let history: CurvePairHistory | undefined, vol: CurveRow["vol"];
    try {
      const [a, b] = await Promise.all([yahooBars(live[0].ticker).then(x => upTo(x, through)), yahooBars(live[1].ticker).then(x => upTo(x, through))]);
      history = pairHistory({ month: live[0].month, dates: a.dates, close: a.close }, { month: live[1].month, dates: b.dates, close: b.close });
      // Current vol on the front contract itself (no roll inside 20 days); the 5-year normal from the continuous
      // series, where an occasional roll day barely moves a 5-year figure. Same measure as the curve vol study.
      const now = realisedVol(a.close);
      const normal = await yahooBars(`${m.root}=F`, "5y").then(c => normalVol(upTo(c, through).close)).catch(() => null);
      if (now != null) vol = { now: round(now), normal: normal == null ? null : round(normal), ratio: normal ? round(now / normal) : null };
    } catch { /* no history today */ }
    markets.push({ symbol: m.symbol, source: "yahoo", contracts: live, carry: curveCarry(live), spread: curveSpread(live), history, vol });
  }
  try {
    const vx = await cboeVix(today, through);
    if (vx.contracts.length >= 2) markets.push({ symbol: "VX", source: "cboe", contracts: vx.contracts, carry: curveCarry(vx.contracts), spread: curveSpread(vx.contracts), history: vx.history, vol: vx.vol });
    else missing.push("VX");
  } catch { missing.push("VX"); }
  if (markets.length < CURVE_MARKETS.length / 2) throw new Error(`Curve archive: too few markets priced (${markets.length}).`);
  const asOf = markets.flatMap(m => m.contracts.map(c => c.date)).sort().at(-1)!;
  const snapshot: CurveSnapshot = { generatedAt: new Date().toISOString(), asOf, markets, missing };
  if (process.argv.includes("--dry-run")) { console.info(JSON.stringify(snapshot, null, 2)); return; }

  const config = JSON.parse(await readFile(new URL("../../../wrangler.jsonc", import.meta.url), "utf8"));
  const db = new RestD1(process.env.CLOUDFLARE_ACCOUNT_ID ?? "", config.d1_databases?.[0]?.database_id ?? "", process.env.CLOUDFLARE_D1_TOKEN ?? "");
  // One history row per trading day: a second run on the same day updates it in place.
  await saveSnapshot(db, CURVES_JOB, asOf, JSON.stringify(snapshot), CURVES_JOB);
  console.info(`Curve archive saved for ${asOf}: ${markets.length} markets${missing.length ? `, missing ${missing.join(" ")}` : ""}.`);
}

if (process.argv[1]?.endsWith("curves-cli.ts")) {
  main().catch(error => {
    // Fixed message only: provider responses and credentials are never printed.
    console.error(error instanceof Error && error.message.startsWith("Curve archive") ? error.message : "Curve archive job failed.");
    process.exitCode = 1;
  });
}
