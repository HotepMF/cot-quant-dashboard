/**
 * Demo account: a public forward test of the site's default COT filter traded with weekly Strat entries.
 * Rules are frozen; they match backtest/indicator_grid/strat_active.py (the test that selected them):
 *
 * Filter   the site's default signal (AND gate, Commercial Hedgers, OI-normalised Z over 16 weeks >= 2.0,
 *          cycle 65%) is on for the report week. Bullish = longs only, bearish = shorts only.
 * Trigger  (short; mirror for long) on the week's bar t:
 *            - bar t-1 closed green and t is a failed 2U (broke t-1's high, closed red) or a 3   -> "failed 2" / "3"
 *            - bar t closed red and is a 2 or a 3                                                -> "2-2" / "3-2"
 * Order    sell stop at t's low for the next week only; fill at the stop, or the open if the week gaps through it.
 * Stop     t's high; trailed to the high of every later week that closes red.
 * Target   2 sigma from the fill price (sigma = std of weekly close changes over the 52 weeks to the trigger bar); orders
 *          show it measured from the order price until they fill.
 * Fills    weekly bars only: a week that touches both stop and target counts the stop; the entry week can stop out
 *          but cannot reach the target; gaps fill at the open; max hold 52 weeks.
 * Size     one full-size contract per trade; P&L in dollars before commissions and slippage.
 */
export const DEMO_RULES_VERSION = 1;
/** Account format; v1 accounts could place their first orders for a week already under way, so they restart clean. */
export const DEMO_STATE_VERSION = 2;
export const DEMO_TARGET_SIGMA = 2;
export const DEMO_START_BALANCE = 100_000;

/** Core markets traded by the demo: CFTC code, Yahoo continuous ticker, dollars per 1.0 of the quoted price. */
export const DEMO_MARKETS: { code: string; symbol: string; ticker: string; pointValue: number; contract: string }[] = [
  { code: "13874+", symbol: "ES", ticker: "ES=F", pointValue: 50, contract: "E-mini S&P 500" },
  { code: "20974+", symbol: "NQ", ticker: "NQ=F", pointValue: 20, contract: "E-mini Nasdaq-100" },
  { code: "12460+", symbol: "YM", ticker: "YM=F", pointValue: 5, contract: "E-mini Dow" },
  { code: "239742", symbol: "RTY", ticker: "RTY=F", pointValue: 50, contract: "E-mini Russell 2000" },
  { code: "067651", symbol: "CL", ticker: "CL=F", pointValue: 1000, contract: "WTI crude, 1,000 bbl" },
  { code: "023651", symbol: "NG", ticker: "NG=F", pointValue: 10000, contract: "Natural gas, 10,000 MMBtu" },
  { code: "111659", symbol: "RB", ticker: "RB=F", pointValue: 42000, contract: "RBOB gasoline, 42,000 gal" },
  { code: "022651", symbol: "HO", ticker: "HO=F", pointValue: 42000, contract: "Heating oil, 42,000 gal" },
  { code: "076651", symbol: "PL", ticker: "PL=F", pointValue: 50, contract: "Platinum, 50 oz" },
  { code: "088691", symbol: "GC", ticker: "GC=F", pointValue: 100, contract: "Gold, 100 oz" },
  { code: "085692", symbol: "HG", ticker: "HG=F", pointValue: 25000, contract: "Copper, 25,000 lb" },
  { code: "075651", symbol: "PA", ticker: "PA=F", pointValue: 100, contract: "Palladium, 100 oz" },
  { code: "084691", symbol: "SI", ticker: "SI=F", pointValue: 5000, contract: "Silver, 5,000 oz" },
  { code: "042601", symbol: "ZT", ticker: "ZT=F", pointValue: 2000, contract: "2-year note" },
  { code: "044601", symbol: "ZF", ticker: "ZF=F", pointValue: 1000, contract: "5-year note" },
  { code: "043602", symbol: "ZN", ticker: "ZN=F", pointValue: 1000, contract: "10-year note" },
  { code: "020601", symbol: "ZB", ticker: "ZB=F", pointValue: 1000, contract: "Treasury bond" },
  { code: "112741", symbol: "6N", ticker: "6N=F", pointValue: 100000, contract: "New Zealand dollar" },
  { code: "232741", symbol: "6A", ticker: "6A=F", pointValue: 100000, contract: "Australian dollar" },
  { code: "096742", symbol: "6B", ticker: "6B=F", pointValue: 62500, contract: "British pound" },
  { code: "097741", symbol: "6J", ticker: "6J=F", pointValue: 12500000, contract: "Japanese yen" },
  { code: "099741", symbol: "6E", ticker: "6E=F", pointValue: 125000, contract: "Euro" },
  { code: "090741", symbol: "6C", ticker: "6C=F", pointValue: 100000, contract: "Canadian dollar" },
  { code: "092741", symbol: "6S", ticker: "6S=F", pointValue: 125000, contract: "Swiss franc" },
  { code: "133741", symbol: "BTC", ticker: "BTC=F", pointValue: 5, contract: "Bitcoin, 5 BTC" },
  { code: "146021", symbol: "ETH", ticker: "ETH=F", pointValue: 50, contract: "Ether, 50 ETH" },
  { code: "054642", symbol: "HE", ticker: "HE=F", pointValue: 400, contract: "Lean hogs, 40,000 lb" },
  { code: "061641", symbol: "GF", ticker: "GF=F", pointValue: 500, contract: "Feeder cattle, 50,000 lb" },
  { code: "057642", symbol: "LE", ticker: "LE=F", pointValue: 400, contract: "Live cattle, 40,000 lb" },
  { code: "039601", symbol: "ZR", ticker: "ZR=F", pointValue: 2000, contract: "Rough rice, 2,000 cwt" },
  { code: "005602", symbol: "ZS", ticker: "ZS=F", pointValue: 50, contract: "Soybeans, 5,000 bu" },
  { code: "026603", symbol: "ZM", ticker: "ZM=F", pointValue: 100, contract: "Soybean meal, 100 t" },
  { code: "007601", symbol: "ZL", ticker: "ZL=F", pointValue: 600, contract: "Soybean oil, 60,000 lb" },
  { code: "002602", symbol: "ZC", ticker: "ZC=F", pointValue: 50, contract: "Corn, 5,000 bu" },
  { code: "001602", symbol: "ZW", ticker: "ZW=F", pointValue: 50, contract: "Chicago wheat, 5,000 bu" },
  { code: "040701", symbol: "OJ", ticker: "OJ=F", pointValue: 150, contract: "Orange juice, 15,000 lb" },
  { code: "073732", symbol: "CC", ticker: "CC=F", pointValue: 10, contract: "Cocoa, 10 t" },
  { code: "083731", symbol: "KC", ticker: "KC=F", pointValue: 375, contract: "Coffee, 37,500 lb" },
  { code: "080732", symbol: "SB", ticker: "SB=F", pointValue: 1120, contract: "Sugar No. 11, 112,000 lb" },
  { code: "033661", symbol: "CT", ticker: "CT=F", pointValue: 500, contract: "Cotton, 50,000 lb" },
  { code: "058644", symbol: "LBR", ticker: "LBR=F", pointValue: 27.5, contract: "Lumber, 27,500 bd ft" },
];

export type WeekBar = { week: string; open: number; high: number; low: number; close: number };
export type DemoOrder = { dir: 1 | -1; pattern: string; trigger: number; stop: number; target: number; triggerWeek: string; sigma: number };
export type DemoPosition = DemoOrder & { entry: number; entryWeek: string; riskPerContract: number };
export type DemoTrade = {
  code: string; symbol: string; dir: 1 | -1; pattern: string; entryWeek: string; entry: number; exitWeek: string; exit: number;
  how: "stop" | "target" | "time"; pnl: number; r: number; weeks: number;
};
export type DemoMarketState = { order: DemoOrder | null; position: DemoPosition | null };
export type DemoState = {
  version: number; rulesVersion: number; startedWeek: string | null; lastWeek: string | null; startBalance: number;
  markets: Record<string, DemoMarketState>; trades: DemoTrade[];
  /** Realised balance after each processed week. */
  equity: { week: string; balance: number }[];
  /** Weeks the filter could not be read (report delayed), so no new orders were placed. */
  skipped: { week: string; codes: string[] }[];
};

/** What the API serves: the account plus this week's filter states, for the setups panel. */
export type DemoPayload = DemoState & { updatedAt: string; filtersNow: { code: string; symbol: string; dir: 1 | -1; week: string }[] };

export const emptyDemo = (): DemoState => ({
  version: DEMO_STATE_VERSION, rulesVersion: DEMO_RULES_VERSION, startedWeek: null, lastWeek: null, startBalance: DEMO_START_BALANCE,
  markets: {}, trades: [], equity: [], skipped: [],
});

type BarType = "1" | "2U" | "2D" | "3";
const barType = (b: WeekBar, p: WeekBar): BarType => {
  const up = b.high > p.high, dn = b.low < p.low;
  return up && dn ? "3" : up ? "2U" : dn ? "2D" : "1";
};

/** Pattern name if bar `t` (with previous bar `p`) is a trigger bar for direction d, else null. */
export function triggerPattern(t: WeekBar, p: WeekBar, d: 1 | -1): string | null {
  const type = barType(t, p);
  if ((p.close - p.open) * d < 0) {
    if (type === "3") return "3";
    if ((d < 0 && type === "2U" && t.close < t.open) || (d > 0 && type === "2D" && t.close > t.open)) return "failed 2";
  }
  if ((t.close - t.open) * d > 0 && type !== "1") return type === "3" ? "3-2" : "2-2";
  return null;
}

/** Std of weekly close-to-close changes over the 52 weeks ending at index i (needs at least 40). */
export function weeklySigma(bars: WeekBar[], i: number) {
  const ch: number[] = [];
  for (let k = Math.max(1, i - 51); k <= i; k++) ch.push(bars[k].close - bars[k - 1].close);
  if (ch.length < 40) return null;
  const m = ch.reduce((a, b) => a + b, 0) / ch.length;
  return Math.sqrt(ch.reduce((a, b) => a + (b - m) ** 2, 0) / (ch.length - 1));
}

const weeksBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (7 * 86_400_000));

/**
 * Process one completed week for one market. `bars` ends with that week; `filter` is the filter direction for that
 * week's report (null = report not available yet). Returns the new market state and any closed trade.
 */
export function stepMarket(m: typeof DEMO_MARKETS[number], state: DemoMarketState, bars: WeekBar[], filter: 1 | -1 | 0 | null): { state: DemoMarketState; trade: DemoTrade | null } {
  const bar = bars.at(-1)!;
  let { order, position } = state;
  let trade: DemoTrade | null = null;
  const close = (exit: number, how: DemoTrade["how"]) => {
    const p = position!;
    const pnl = (exit - p.entry) * p.dir * m.pointValue;
    trade = { code: m.code, symbol: m.symbol, dir: p.dir, pattern: p.pattern, entryWeek: p.entryWeek, entry: p.entry, exitWeek: bar.week, exit, how,
      pnl: Math.round(pnl * 100) / 100, r: Math.round((pnl / (p.riskPerContract)) * 100) / 100, weeks: weeksBetween(p.entryWeek, bar.week) };
    position = null;
  };
  const trail = () => { if (position && (bar.close - bar.open) * position.dir > 0) position = { ...position, stop: position.dir < 0 ? Math.min(position.stop, bar.high) : Math.max(position.stop, bar.low) }; };

  if (position) {
    const d = position.dir;
    if (d < 0 ? bar.open >= position.stop : bar.open <= position.stop) close(bar.open, "stop");
    else if (d < 0 ? bar.high >= position.stop : bar.low <= position.stop) close(position.stop, "stop");
    else if (d < 0 ? bar.open <= position.target : bar.open >= position.target) close(bar.open, "target");
    else if (d < 0 ? bar.low <= position.target : bar.high >= position.target) close(position.target, "target");
    else if (weeksBetween(position.entryWeek, bar.week) >= 52) close(bar.close, "time");
    else trail();
  } else if (order) {
    const d = order.dir;
    if (d < 0 ? bar.low < order.trigger : bar.high > order.trigger) {
      const entry = d < 0 ? Math.min(bar.open, order.trigger) : Math.max(bar.open, order.trigger);
      // the target is measured from the actual fill, as in the backtest
      position = { ...order, entry, target: entry + d * DEMO_TARGET_SIGMA * order.sigma, entryWeek: bar.week, riskPerContract: Math.abs(order.stop - entry) * m.pointValue };
      // entry week: can stop out, cannot reach the target
      if (d < 0 ? bar.high >= position.stop : bar.low <= position.stop) close(position.stop, "stop");
      else trail();
    }
    order = null;   // an order lives for one week only
  }

  // new order for next week: flat, filter on, this bar is a trigger bar
  if (!position && !order && filter && bars.length >= 2) {
    const pattern = triggerPattern(bar, bars.at(-2)!, filter);
    const sigma = weeklySigma(bars, bars.length - 1);
    if (pattern && sigma) {
      const trigger = filter < 0 ? bar.low : bar.high, stop = filter < 0 ? bar.high : bar.low;
      if ((stop - trigger) * -filter > 0) order = { dir: filter, pattern, trigger, stop, target: trigger + filter * DEMO_TARGET_SIGMA * sigma, triggerWeek: bar.week, sigma };
    }
  }
  return { state: { order, position }, trade };
}

/**
 * Advance the account through every completed week after `state.lastWeek`. `bars` per code (oldest first, completed
 * weeks only); `filters` per code and week. A new account only records the latest completed week as its starting
 * point: the week after it may already be under way, so its first orders come at the next completed week, for the
 * full week that follows (no order can use prices from before it was published).
 */
export function advanceDemo(prev: DemoState, bars: Record<string, WeekBar[]>, filters: Record<string, Record<string, 1 | -1 | 0>>): DemoState {
  const state: DemoState = JSON.parse(JSON.stringify(prev));
  const weeks = [...new Set(Object.values(bars).flatMap(b => b.map(x => x.week)))].sort();
  if (!state.lastWeek) {
    state.lastWeek = weeks.at(-1) ?? null;
    return state;
  }
  const todo = weeks.filter(w => w > state.lastWeek!);
  for (const week of todo) {
    const skipped: string[] = [];
    for (const m of DEMO_MARKETS) {
      const series = bars[m.code];
      const i = series?.findIndex(b => b.week === week) ?? -1;
      if (!series || i < 0) continue;
      const f = filters[m.code]?.[week];
      if (f === undefined) skipped.push(m.symbol);
      const { state: next, trade } = stepMarket(m, state.markets[m.code] ?? { order: null, position: null }, series.slice(0, i + 1), f ?? null);
      state.markets[m.code] = next;
      if (trade) state.trades.push(trade);
    }
    if (skipped.length && skipped.length < DEMO_MARKETS.length) state.skipped.push({ week, codes: skipped });
    state.startedWeek ??= week;
    state.lastWeek = week;
    state.equity.push({ week, balance: Math.round((state.startBalance + state.trades.reduce((a, t) => a + t.pnl, 0)) * 100) / 100 });
  }
  return state;
}
