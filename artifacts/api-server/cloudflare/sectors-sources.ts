/** Inputs for the daily sectors snapshot. Run in GitHub Actions, never in the Worker. */
export type DailyCloses = { dates: string[]; closes: number[] };
export type PositioningHistory = { date: string; fundsNetPct: number; otherNetPct: number }[];
export type YieldSeries = { date: string; value: number }[];

/** Swappable so a licensed provider can replace the default without touching the calculations. */
export interface PriceSource {
  name: string;
  daily(ticker: string, adjusted: boolean): Promise<DailyCloses>;
}

const isoDay = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * In the evening Yahoo has the newest day's close but not yet its adjusted close. Fill those trailing gaps from the
 * plain close, scaled by the last day that has both (the dividend adjustment carried forward), so the newest day
 * isn't dropped.
 */
function withLatestAdjusted(adj: (number | null)[] | undefined, close: (number | null)[] | undefined) {
  if (!adj || !close) return adj;
  let k = adj.length - 1;
  while (k >= 0 && adj[k] == null) k--;
  if (k < 0 || k === adj.length - 1 || !close[k]) return adj;
  const factor = adj[k]! / close[k]!;
  return adj.map((v, i) => i > k && close[i] != null ? close[i]! * factor : v);
}

/**
 * Yahoo Finance chart endpoint (unofficial, no key). Yahoo's terms don't license redistribution; the site
 * shows derived end-of-day statistics from it as an accepted risk. Swap in a licensed provider before
 * donations, ads or paid features.
 */
export const yahooPrices: PriceSource = {
  name: "Yahoo Finance",
  async daily(ticker, adjusted) {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
    url.searchParams.set("range", "6y");
    url.searchParams.set("interval", "1d");
    url.searchParams.set("includeAdjustedClose", "true");
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (cot-quant sectors job)", Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Price source returned HTTP ${response.status} for ${ticker}.`);
    const body = await response.json() as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[]; adjclose?: { adjclose?: (number | null)[] }[] } }[] } };
    const result = body.chart?.result?.[0];
    const raw = result?.indicators?.quote?.[0]?.close;
    const values = adjusted ? withLatestAdjusted(result?.indicators?.adjclose?.[0]?.adjclose, raw) : raw;
    if (!result?.timestamp?.length || !values) throw new Error(`Price source returned no closes for ${ticker}.`);
    const out: DailyCloses = { dates: [], closes: [] };
    result.timestamp.forEach((t, i) => {
      const v = values[i];
      if (v != null && Number.isFinite(v) && v > 0) { out.dates.push(isoDay(t)); out.closes.push(v); }
    });
    return out;
  },
};

export function priceSource(name = process.env.SECTORS_PRICE_SOURCE ?? "yahoo"): PriceSource {
  if (name === "yahoo") return yahooPrices;
  throw new Error(`Unknown price source: ${name}.`);
}

const CFTC = { disagg: "72hh-3qpy", tff: "gpe5-46if" } as const;
const FIELDS = {
  disagg: { fundsLong: "m_money_positions_long_all", fundsShort: "m_money_positions_short_all", otherLong: "prod_merc_positions_long", otherShort: "prod_merc_positions_short" },
  tff: { fundsLong: "lev_money_positions_long", fundsShort: "lev_money_positions_short", otherLong: "asset_mgr_positions_long", otherShort: "asset_mgr_positions_short" },
} as const;

/** Newest-last weekly history (up to 165 reports) of funds' and the other group's net position as % of open interest. */
export async function cftcPositioning(report: "disagg" | "tff", code: string, token?: string): Promise<PositioningHistory> {
  const f = FIELDS[report];
  const statement = `SELECT report_date_as_yyyy_mm_dd, open_interest_all, ${f.fundsLong}, ${f.fundsShort}, ${f.otherLong}, ${f.otherShort} WHERE cftc_contract_market_code = '${code.replace(/'/g, "''")}' ORDER BY report_date_as_yyyy_mm_dd DESC LIMIT 165`;
  const url = new URL(`https://publicreporting.cftc.gov/resource/${CFTC[report]}.json`);
  url.searchParams.set("$query", statement);
  const response = await fetch(url, { headers: { Accept: "application/json", ...(token ? { "X-App-Token": token } : {}) }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`CFTC returned HTTP ${response.status}.`);
  const rows = await response.json() as Record<string, string>[];
  const out = rows.map(r => {
    const oi = Number(r.open_interest_all);
    const n = (a: string, b: string) => (Number(r[a]) - Number(r[b])) / oi * 100;
    return { date: r.report_date_as_yyyy_mm_dd?.slice(0, 10), fundsNetPct: n(f.fundsLong, f.fundsShort), otherNetPct: n(f.otherLong, f.otherShort) };
  }).filter(r => r.date && Number.isFinite(r.fundsNetPct) && Number.isFinite(r.otherNetPct));
  if (out.length < 30) throw new Error(`Too little CFTC positioning history for ${code}.`);
  return out.reverse();
}

/** U.S. Treasury daily par yield curve (public CSV, no key): 2- and 10-year, oldest first, this year and last. */
export async function treasuryYields(now = new Date()): Promise<{ y2: YieldSeries; y10: YieldSeries }> {
  const rows: { date: string; y2: number; y10: number }[] = [];
  for (const year of [now.getUTCFullYear() - 1, now.getUTCFullYear()]) {
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (cot-quant sectors job)" }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Treasury returned HTTP ${response.status}.`);
    const [header, ...lines] = (await response.text()).trim().split(/\r?\n/);
    const cols = header.split(",").map(c => c.replace(/"/g, ""));
    const i2 = cols.indexOf("2 Yr"), i10 = cols.indexOf("10 Yr");
    if (i2 < 0 || i10 < 0) throw new Error("Treasury yield file format changed.");
    for (const line of lines) {
      const f = line.split(",");
      const [m, d, y] = f[0].split("/");
      const row = { date: `${y}-${m}-${d}`, y2: Number(f[i2]), y10: Number(f[i10]) };
      if (/^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.y2) && Number.isFinite(row.y10)) rows.push(row);
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) throw new Error("Treasury returned no yields.");
  return { y2: rows.map(r => ({ date: r.date, value: r.y2 })), y10: rows.map(r => ({ date: r.date, value: r.y10 })) };
}
