/** Inputs for The Invisible Hand numbers. Run in GitHub Actions, never in the Worker. */
import { HAND_CATEGORIES, type HandReport } from "@workspace/cot-engine";

export type CurvePoint = { date: string; m3: number; y2: number; y10: number };
export type CategoryHistory = { date: string; oi: number; long: number; short: number }[];
export type LatestCounts = { top4Long: number | null; top4Short: number | null; traders: Record<string, { long: number | null; short: number | null }> };

/** U.S. Treasury daily par yield curve (public CSV, no key): 3-month, 2- and 10-year, oldest first. */
export async function treasuryCurve(years = 5, now = new Date()): Promise<CurvePoint[]> {
  const rows: CurvePoint[] = [];
  for (let year = now.getUTCFullYear() - years + 1; year <= now.getUTCFullYear(); year++) {
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (cot-quant invisible hand job)" }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Treasury returned HTTP ${response.status}.`);
    const [header, ...lines] = (await response.text()).trim().split(/\r?\n/);
    const cols = header.split(",").map(c => c.replace(/"/g, ""));
    const i3 = cols.indexOf("3 Mo"), i2 = cols.indexOf("2 Yr"), i10 = cols.indexOf("10 Yr");
    if (i3 < 0 || i2 < 0 || i10 < 0) throw new Error("Treasury yield file format changed.");
    for (const line of lines) {
      const f = line.split(",");
      const [m, d, y] = f[0].split("/");
      const row = { date: `${y}-${m}-${d}`, m3: Number(f[i3]), y2: Number(f[i2]), y10: Number(f[i10]) };
      if (/^\d{4}-\d{2}-\d{2}$/.test(row.date) && f[i3] && f[i2] && f[i10] && [row.m3, row.y2, row.y10].every(Number.isFinite)) rows.push(row);
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) throw new Error("Treasury returned no yields.");
  return rows;
}

const DATASET: Record<HandReport, string> = { tff: "gpe5-46if", disagg: "72hh-3qpy", legacy: "6dca-aqww" };

async function cftcQuery(report: HandReport, statement: string, token?: string) {
  const url = new URL(`https://publicreporting.cftc.gov/resource/${DATASET[report]}.json`);
  url.searchParams.set("$query", statement);
  const response = await fetch(url, { headers: { Accept: "application/json", ...(token ? { "X-App-Token": token } : {}) }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`CFTC returned HTTP ${response.status}.`);
  return await response.json() as Record<string, string | undefined>[];
}

const num = (v: string | undefined) => v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;

/**
 * Last 165 weekly reports for each category (newest last), plus the latest report's trader counts and top-4
 * net concentration. Counts the CFTC suppresses for confidentiality come back as null.
 */
export async function cftcParticipation(report: HandReport, code: string, categories: readonly string[], token?: string) {
  const fields = categories.flatMap(c => [HAND_CATEGORIES[report][c].long, HAND_CATEGORIES[report][c].short]);
  const where = `cftc_contract_market_code = '${code.replace(/'/g, "''")}'`;
  const rows = await cftcQuery(report, `SELECT report_date_as_yyyy_mm_dd, open_interest_all, ${fields.join(", ")} WHERE ${where} ORDER BY report_date_as_yyyy_mm_dd DESC LIMIT 165`, token);
  if (rows.length < 60) throw new Error(`Too little CFTC history for ${code}.`);
  const histories: Record<string, CategoryHistory> = {};
  for (const c of categories) {
    const f = HAND_CATEGORIES[report][c];
    histories[c] = rows.map(r => ({ date: r.report_date_as_yyyy_mm_dd?.slice(0, 10) ?? "", oi: Number(r.open_interest_all), long: Number(r[f.long]), short: Number(r[f.short]) }))
      .filter(r => r.date && r.oi > 0 && Number.isFinite(r.long) && Number.isFinite(r.short)).reverse();
  }
  // Field names for counts and concentration differ slightly between reports, so read the latest row whole.
  const [latest] = await cftcQuery(report, `SELECT * WHERE ${where} AND report_date_as_yyyy_mm_dd = '${rows[0].report_date_as_yyyy_mm_dd}'`, token);
  const pick = (...names: string[]) => { for (const n of names) { const v = num(latest?.[n]); if (v != null) return v; } return null; };
  const counts: LatestCounts = {
    top4Long: pick("conc_net_le_4_tdr_long_all", "conc_net_le_4_tdr_long"),
    top4Short: pick("conc_net_le_4_tdr_short_all", "conc_net_le_4_tdr_short"),
    traders: {},
  };
  for (const c of categories) {
    const k = HAND_CATEGORIES[report][c].key;
    counts.traders[c] = { long: pick(`traders_${k}_long_all`, `traders_${k}_long`), short: pick(`traders_${k}_short_all`, `traders_${k}_short`) };
  }
  return { histories, counts };
}

export type DailyBars = { dates: string[]; open: number[]; high: number[]; low: number[]; close: number[] };

/** Recent daily bars from the Yahoo chart endpoint (same accepted-risk source as the sectors job). */
export async function yahooBars(ticker: string, range = "3mo"): Promise<DailyBars> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.searchParams.set("range", range);
  url.searchParams.set("interval", "1d");
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (cot-quant invisible hand job)", Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Price source returned HTTP ${response.status} for ${ticker}.`);
  const body = await response.json() as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[] }[] } }[] } };
  const r = body.chart?.result?.[0], q = r?.indicators?.quote?.[0];
  if (!r?.timestamp?.length || !q?.high || !q.low || !q.close) throw new Error(`Price source returned no bars for ${ticker}.`);
  const out: DailyBars = { dates: [], open: [], high: [], low: [], close: [] };
  r.timestamp.forEach((t, i) => {
    const o = q.open?.[i] ?? null, h = q.high![i], l = q.low![i], c = q.close![i];
    if (o != null && h != null && l != null && c != null && h >= l && l > 0) {
      out.dates.push(new Date(t * 1000).toISOString().slice(0, 10)); out.open.push(o); out.high.push(h); out.low.push(l); out.close.push(c);
    }
  });
  return out;
}

export type SiteHistory = { date: string; largeTraders: number; smallTraders?: number; commercialHedgers: number; openInterest: number | null }[];

/** Weekly Legacy histories exactly as the site serves them (stitched, consolidated lines included). */
export async function siteHistories(names: Map<string, string>, origin = process.env.HAND_SITE_ORIGIN ?? "https://zcot.trade") {
  const markets = await (await fetch(`${origin}/api/cot/markets?report=futures`, { signal: AbortSignal.timeout(30_000) })).json() as { markets: { name: string; code: string }[] };
  const out = new Map<string, SiteHistory>();
  for (const m of markets.markets) {
    if (!names.has(m.code)) continue;
    const url = `${origin}/api/cot/market?report=futures&market=${encodeURIComponent(m.name)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) continue;
    const body = await response.json() as { rows: SiteHistory };
    out.set(m.code, body.rows);
  }
  return out;
}
