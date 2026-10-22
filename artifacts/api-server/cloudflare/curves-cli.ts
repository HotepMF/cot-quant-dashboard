import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { CURVE_DEPTH, CURVE_MARKETS, curveCandidates, curveCarry, type CurveContract, type CurveRow, type CurveSnapshot } from "@workspace/cot-engine";
import { RestD1 } from "./rest-d1";
import { saveSnapshot } from "./sectors-cli";

export const CURVES_JOB = "curves";
const UA = { "User-Agent": "Mozilla/5.0 (cot-quant curve archive)" };

/** Latest daily close of one contract from the Yahoo chart endpoint, or null when it has expired or has no price. */
async function yahooLast(ticker: string): Promise<{ date: string; close: number } | null> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.searchParams.set("range", "5d");
  url.searchParams.set("interval", "1d");
  const response = await fetch(url, { headers: { ...UA, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return null;
  const body = await response.json() as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } };
  const r = body.chart?.result?.[0], close = r?.indicators?.quote?.[0]?.close ?? [];
  for (let i = (r?.timestamp?.length ?? 0) - 1; i >= 0; i--) {
    const c = close[i];
    if (c != null && c > 0) return { date: new Date(r!.timestamp![i] * 1000).toISOString().slice(0, 10), close: c };
  }
  return null;
}

/** Cboe VIX futures: the next monthly contracts' latest settlements from Cboe's public per-contract files. */
async function cboeVix(today: string): Promise<CurveContract[]> {
  const list = await (await fetch("https://www.cboe.com/us/futures/market_statistics/historical_data/product/list/VX/", { headers: UA, signal: AbortSignal.timeout(30_000) })).json() as Record<string, { expire_date: string; duration_type: string; path: string }[]>;
  const months = Object.values(list).flat().filter(c => c.duration_type === "M" && c.expire_date >= today).sort((a, b) => a.expire_date.localeCompare(b.expire_date)).slice(0, CURVE_DEPTH);
  const out: CurveContract[] = [];
  for (const c of months) {
    const response = await fetch(`https://cdn.cboe.com/${c.path}`, { headers: UA, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) continue;
    const last = (await response.text()).trim().split(/\r?\n/).at(-1)?.split(",");
    const settle = Number(last?.[6]);
    if (last && /^\d{4}-\d{2}-\d{2}$/.test(last[0]) && settle > 0) out.push({ month: c.expire_date.slice(0, 7).replace("-", ""), ticker: `VX ${c.expire_date}`, date: last[0], close: settle });
  }
  return out;
}

/**
 * Daily curve archive: the first few live contracts of every core market, one history row per trading day.
 * Runs after the evening sectors job. `--dry-run` prints the snapshot instead of saving it.
 */
async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const markets: CurveRow[] = [], missing: string[] = [];
  for (const m of CURVE_MARKETS) {
    const contracts: CurveContract[] = [];
    for (const c of curveCandidates(m, today)) {
      if (contracts.length >= CURVE_DEPTH) break;
      const last = await yahooLast(c.ticker).catch(() => null);
      if (last) contracts.push({ month: c.month, ticker: c.ticker, ...last });
    }
    // A contract whose last price is older than the market's newest one has stopped trading (expired or delivery).
    const newest = contracts.reduce((d, c) => c.date > d ? c.date : d, "");
    const live = contracts.filter(c => c.date === newest);
    if (live.length < 2) { missing.push(m.symbol); continue; }
    markets.push({ symbol: m.symbol, source: "yahoo", contracts: live, carry: curveCarry(live) });
  }
  try {
    const vx = await cboeVix(today);
    if (vx.length >= 2) markets.push({ symbol: "VX", source: "cboe", contracts: vx, carry: curveCarry(vx) });
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
