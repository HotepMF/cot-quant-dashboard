/**
 * Daily futures curve archive: the first few listed contracts of each core market, saved once per trading day.
 * Research data only (not on the site yet). The 2026-10 curve test found the curve does not improve the COT filter;
 * the archive exists so any future curve rule can be tested on data after 2024-03, where the free history ends.
 */

const MONTH_CODES = "FGHJKMNQUVXZ";

/** Yahoo root, exchange suffix and listed contract months for each core market. VX comes from Cboe instead. */
export const CURVE_MARKETS: { symbol: string; root: string; exchange: "CME" | "CBT" | "NYM" | "CMX" | "NYB"; months: string }[] = [
  { symbol: "ES", root: "ES", exchange: "CME", months: "HMUZ" },
  { symbol: "NQ", root: "NQ", exchange: "CME", months: "HMUZ" },
  { symbol: "YM", root: "YM", exchange: "CBT", months: "HMUZ" },
  { symbol: "RTY", root: "RTY", exchange: "CME", months: "HMUZ" },
  { symbol: "NKD", root: "NKD", exchange: "CME", months: "HMUZ" },
  { symbol: "CL", root: "CL", exchange: "NYM", months: MONTH_CODES },
  { symbol: "NG", root: "NG", exchange: "NYM", months: MONTH_CODES },
  { symbol: "RB", root: "RB", exchange: "NYM", months: MONTH_CODES },
  { symbol: "HO", root: "HO", exchange: "NYM", months: MONTH_CODES },
  { symbol: "PL", root: "PL", exchange: "NYM", months: "FJNV" },
  { symbol: "PA", root: "PA", exchange: "NYM", months: "HMUZ" },
  { symbol: "GC", root: "GC", exchange: "CMX", months: "GJMQVZ" },
  { symbol: "SI", root: "SI", exchange: "CMX", months: "HKNUZ" },
  { symbol: "HG", root: "HG", exchange: "CMX", months: "HKNUZ" },
  { symbol: "ZT", root: "ZT", exchange: "CBT", months: "HMUZ" },
  { symbol: "ZF", root: "ZF", exchange: "CBT", months: "HMUZ" },
  { symbol: "ZN", root: "ZN", exchange: "CBT", months: "HMUZ" },
  { symbol: "ZB", root: "ZB", exchange: "CBT", months: "HMUZ" },
  { symbol: "6N", root: "6N", exchange: "CME", months: "HMUZ" },
  { symbol: "6A", root: "6A", exchange: "CME", months: "HMUZ" },
  { symbol: "6B", root: "6B", exchange: "CME", months: "HMUZ" },
  { symbol: "6J", root: "6J", exchange: "CME", months: "HMUZ" },
  { symbol: "6E", root: "6E", exchange: "CME", months: "HMUZ" },
  { symbol: "6C", root: "6C", exchange: "CME", months: "HMUZ" },
  { symbol: "6S", root: "6S", exchange: "CME", months: "HMUZ" },
  { symbol: "DX", root: "DX", exchange: "NYB", months: "HMUZ" },
  { symbol: "BTC", root: "BTC", exchange: "CME", months: MONTH_CODES },
  { symbol: "ETH", root: "ETH", exchange: "CME", months: MONTH_CODES },
  { symbol: "HE", root: "HE", exchange: "CME", months: "GJKMNQVZ" },
  { symbol: "GF", root: "GF", exchange: "CME", months: "FHJKQUVX" },
  { symbol: "LE", root: "LE", exchange: "CME", months: "GJMQVZ" },
  { symbol: "ZR", root: "ZR", exchange: "CBT", months: "FHKNUX" },
  { symbol: "ZS", root: "ZS", exchange: "CBT", months: "FHKNQUX" },
  { symbol: "ZM", root: "ZM", exchange: "CBT", months: "FHKNQUVZ" },
  { symbol: "ZL", root: "ZL", exchange: "CBT", months: "FHKNQUVZ" },
  { symbol: "ZC", root: "ZC", exchange: "CBT", months: "HKNUZ" },
  { symbol: "ZW", root: "ZW", exchange: "CBT", months: "HKNUZ" },
  { symbol: "OJ", root: "OJ", exchange: "NYB", months: "FHKNUX" },
  { symbol: "CC", root: "CC", exchange: "NYB", months: "HKNUZ" },
  { symbol: "KC", root: "KC", exchange: "NYB", months: "HKNUZ" },
  { symbol: "SB", root: "SB", exchange: "NYB", months: "HKNV" },
  { symbol: "CT", root: "CT", exchange: "NYB", months: "HKNVZ" },
  { symbol: "LBR", root: "LBR", exchange: "CME", months: "FHKNUX" },
];

/** Contracts saved per market (after expired ones are dropped). */
export const CURVE_DEPTH = 4;

/**
 * Candidate contracts from this month on, in order: `count` listed months, as Yahoo tickers with a YYYYMM month.
 * The current month is included because many contracts trade into their delivery month; expired ones simply return
 * no price and are dropped by the job.
 */
export function curveCandidates(market: typeof CURVE_MARKETS[number], today: string, count = CURVE_DEPTH + 3) {
  let year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  const out: { ticker: string; month: string }[] = [];
  for (let guard = 0; out.length < count && guard < 48; guard++) {
    const code = MONTH_CODES[month - 1];
    if (market.months.includes(code)) out.push({ ticker: `${market.root}${code}${String(year % 100).padStart(2, "0")}.${market.exchange}`, month: `${year}${String(month).padStart(2, "0")}` });
    if (++month > 12) { month = 1; year++; }
  }
  return out;
}

export type CurveContract = { month: string; ticker: string; date: string; close: number };
export type CurveRow = { symbol: string; source: "yahoo" | "cboe"; contracts: CurveContract[]; carry: number | null };
export type CurveSnapshot = { generatedAt: string; asOf: string; markets: CurveRow[]; missing: string[] };

const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(4, 6));

/**
 * Carry between the first two saved contracts: ln(F_near / F_far) per year. Positive = backwardation.
 * Same definition as the research test (backtest/curve/preregistration.md), though the contracts differ.
 */
export function curveCarry(contracts: CurveContract[]): number | null {
  const [a, b] = contracts;
  if (!a || !b || !(a.close > 0) || !(b.close > 0)) return null;
  const years = (monthIndex(b.month) - monthIndex(a.month)) / 12;
  return years > 0 ? Math.log(a.close / b.close) / years : null;
}
