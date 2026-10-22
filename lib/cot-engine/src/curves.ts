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
/** Daily end-of-day spread history of today's front pair (front minus second), oldest first. */
export type CurvePairHistory = { near: string; far: string; dates: string[]; spread: number[] };
export type CurveRow = {
  symbol: string; source: "yahoo" | "cboe"; contracts: CurveContract[]; carry: number | null;
  /** Front minus second close, in price units: positive = backwardation. */
  spread: number | null; history?: CurvePairHistory;
  /** Annualised realised vol: last 20 days on the front contract, and the market's trailing 5-year normal. */
  vol?: { now: number; normal: number | null; ratio: number | null };
};

/** Annualised standard deviation of daily log returns over the last `days` closes (null when too few). */
export function realisedVol(closes: number[], days = 20): number | null {
  const c = closes.filter(x => x > 0).slice(-(days + 1));
  if (c.length < Math.min(days, 15) + 1) return null;
  const r = c.slice(1).map((x, i) => Math.log(x / c[i]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1) * 252);
}
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

export const curveSpread = (contracts: CurveContract[]) => contracts.length >= 2 ? contracts[0].close - contracts[1].close : null;

/**
 * Carry percentiles per market (5th, 20th, 80th, 95th) from weekly pysystemtrade history, 2002-07..2024-03
 * (VIX: Cboe, 2004..2026). Computed by backtest/curve/cutoffs.py. The research pairs are not always the front two
 * contracts, so these are close to, not exactly, the site's front-pair carry. Lumber has too little history.
 */
export const CURVE_CUTOFFS: Record<string, [number, number, number, number]> = {
  ES: [-0.039, -0.022, 0.016, 0.02], NQ: [-0.049, -0.032, 0.006, 0.011], YM: [-0.04, -0.031, 0.013, 0.024],
  RTY: [-0.046, -0.039, 0.005, 0.013], NKD: [-0.008, 0.0, 0.072, 0.104], CL: [-0.17, -0.073, 0.096, 0.168],
  NG: [-1.17, -0.519, -0.013, 0.253], RB: [-0.77, -0.111, 0.268, 0.69], HO: [-0.254, -0.129, 0.071, 0.331],
  PL: [-0.036, -0.022, 0.003, 0.051], GC: [-0.058, -0.04, -0.007, -0.001], HG: [-0.097, -0.039, 0.038, 0.15],
  PA: [-0.061, -0.041, 0.006, 0.036], SI: [-0.108, -0.05, -0.001, 0.08], ZT: [-0.016, -0.004, 0.013, 0.024],
  ZF: [-0.016, -0.001, 0.031, 0.046], ZN: [-0.017, 0.002, 0.043, 0.053], ZB: [-0.025, 0.003, 0.044, 0.051],
  "6N": [-0.006, 0.003, 0.036, 0.045], "6A": [-0.013, -0.001, 0.035, 0.046], "6B": [-0.016, -0.006, 0.01, 0.028],
  "6J": [-0.054, -0.037, -0.004, -0.002], DX: [-0.025, -0.019, 0.013, 0.021], "6E": [-0.028, -0.02, 0.002, 0.014],
  "6C": [-0.137, -0.039, 0.056, 0.175], "6S": [-0.156, -0.052, 0.062, 0.217], BTC: [-0.327, -0.138, 0.034, 0.333],
  ETH: [-0.428, -0.146, 0.05, 0.532], HE: [-0.802, -0.328, 0.395, 0.717], GF: [-0.295, -0.163, 0.089, 0.248],
  LE: [-0.314, -0.237, 0.018, 0.248], ZR: [-0.255, -0.171, -0.037, 0.323], ZS: [-0.102, -0.031, 0.182, 0.325],
  ZM: [-0.124, -0.078, 0.178, 0.648], ZL: [-0.112, -0.074, 0.011, 0.169], ZC: [-0.187, -0.125, 0.069, 0.189],
  ZW: [-0.203, -0.152, -0.06, -0.021], OJ: [-0.226, -0.147, 0.063, 0.191], CC: [-0.112, -0.066, 0.038, 0.145],
  KC: [-0.15, -0.116, -0.054, 0.056], SB: [-0.246, -0.136, 0.123, 0.394], CT: [-0.26, -0.163, 0.06, 0.22],
  VX: [-1.711, -1.217, -0.096, 0.635],
};

/** What the curve means for each market: storage commodities, financial (rates / dividends) or VIX (fear). */
export const curveKind = (symbol: string): "commodity" | "financial" | "volatility" =>
  symbol === "VX" ? "volatility" : ["ES", "NQ", "YM", "RTY", "NKD", "ZT", "ZF", "ZN", "ZB", "6N", "6A", "6B", "6J", "6E", "6C", "6S", "DX", "BTC", "ETH"].includes(symbol) ? "financial" : "commodity";

export type CurveZone = "deep-contango" | "normal" | "deep-backwardation";

/** Where carry sits in the market's own history: beyond the 20th / 80th percentile = deep (the vol study's quintiles). */
export function curveZone(symbol: string, carry: number | null): CurveZone | null {
  const c = CURVE_CUTOFFS[symbol];
  if (!c || carry == null) return null;
  return carry < c[1] ? "deep-contango" : carry > c[2] ? "deep-backwardation" : "normal";
}

/** Gauge needle 0..1: piecewise-linear through the 5th / 20th / 80th / 95th percentiles, clamped. */
export function curveGauge(symbol: string, carry: number | null): number | null {
  const c = CURVE_CUTOFFS[symbol];
  if (!c || carry == null) return null;
  const xs = [c[0], c[1], c[2], c[3]], ys = [0.05, 0.2, 0.8, 0.95];
  const lerp = (x0: number, x1: number, y0: number, y1: number) => x1 === x0 ? (y0 + y1) / 2 : y0 + (carry - x0) * (y1 - y0) / (x1 - x0);
  let v: number;
  if (carry <= xs[0]) v = lerp(xs[0], xs[1], ys[0], ys[1]);
  else if (carry >= xs[3]) v = lerp(xs[2], xs[3], ys[2], ys[3]);
  else { let i = 0; while (carry > xs[i + 1]) i++; v = lerp(xs[i], xs[i + 1], ys[i], ys[i + 1]); }
  return Math.max(0, Math.min(1, v));
}

/**
 * Measured next-4-week volatility vs a trailing 5-year normal, commodities 2002-07..2024-03 (vol_by_curve.py):
 * deep backwardation 0.951 and deep contango 0.898 against 0.797 for a flat curve. Descriptive, not a signal.
 */
export const CURVE_VOL_EFFECT = { deepBackwardation: 0.19, deepContango: 0.13 } as const;

export type VolState = "calm" | "normal" | "elevated" | "extreme";

/**
 * Plain-language volatility state from vol now / the market's 5-year normal. Fixed, round bands chosen for reading,
 * not tested thresholds: under 0.75x calm, 0.75-1.25x normal, 1.25-1.75x elevated, 1.75x and up extreme.
 */
export const VOL_STATES: { state: VolState; from: number; label: string; meaning: string }[] = [
  { state: "calm", from: 0, label: "Calm", meaning: "Moves are smaller than usual for this market. Quiet markets can wake up quickly." },
  { state: "normal", from: 0.75, label: "Normal", meaning: "Moves are about the usual size for this market." },
  { state: "elevated", from: 1.25, label: "Elevated", meaning: "Moves are bigger than usual. Wider stops or a smaller size keep the same risk." },
  { state: "extreme", from: 1.75, label: "Extreme", meaning: "Moves are close to twice the usual size or more. Expect big swings both ways." },
];

export function volState(ratio: number | null | undefined) {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  return [...VOL_STATES].reverse().find(s => ratio >= s.from)!;
}

/** Volatility needle 0..1: ratio 0.25x at the left end, 2.25x at the right, so each state is a quarter of the dial. */
export const volGauge = (ratio: number | null | undefined) => ratio == null || !Number.isFinite(ratio) ? null : Math.max(0, Math.min(1, (ratio - 0.25) / 2));
