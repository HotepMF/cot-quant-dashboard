/**
 * Live log of simultaneous sector breaks in the week after each 8-week COT reading.
 *
 * Rules are the pre-registered intraday test's (backtest/strat/preregistration_intraday.md):
 *   W0      the week ending at 17:00 New York on the release Friday; W1 the 7 days after it (evening sessions included).
 *   Break   the first W1 15-minute close beyond W0's highest / lowest 15-minute close, if the other side was not
 *           closed beyond first.
 *   Event   the first W1 bar at which at least half (rounded up) of the OTHER markets in the sector have broken in the
 *           reading's direction. Entry = the reading's market's close on that bar.
 *   Outcome the signed move over the next 4, 8 and 16 bars (1, 2, 4 hours) and to the end of that session (the last bar
 *           before 17:00 New York), in units of the market's normal daily move (20-day standard deviation).
 * History (2010-2026, 11 markets with 15-minute data): 12 cases, all horizons positive, not significant.
 */
import { releaseFriday } from "./release";

/** Sectors of the core markets (the research's groups). DX has none: it moves against the currency group. */
export const BREAK_SECTORS: Record<string, string[]> = {
  Equities: ["ES", "NQ", "YM", "RTY", "NKD"], Energy: ["CL", "NG", "RB", "HO"], Metals: ["GC", "SI", "HG", "PL", "PA"],
  Rates: ["ZT", "ZF", "ZN", "ZB"], Currencies: ["6E", "6J", "6B", "6A", "6C", "6S", "6N"], Crypto: ["BTC", "ETH"],
  Grains: ["ZC", "ZS", "ZW", "ZM", "ZL", "ZR"], Livestock: ["LE", "GF", "HE"], Softs: ["SB", "KC", "CC", "CT", "OJ", "LBR"],
};
export const sectorOf = (symbol: string) => Object.keys(BREAK_SECTORS).find(s => BREAK_SECTORS[s].includes(symbol));

/** The intraday history the live log is checked against (backtest/strat/findings_intraday.md). */
export const BREAK_HISTORY = { cases: 12, period: "2010-2026", h1: 0.10, h2: 0.21, h4: 0.36, session: 0.63, sessionPositive: 58 } as const;

/** 15-minute bars, oldest first: bar open times (epoch ms) and closes. */
export type IntradayBars = { times: number[]; close: number[] };
export const BAR_MS = 15 * 60_000;
const HOURS = { h1: 4, h2: 8, h4: 16 } as const;

const nyHour = (t: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(t));
const nyDate = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(t);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Epoch ms of `hour`:00 New York time on `date` (handles daylight saving). */
export function nyEpoch(date: string, hour: number): number {
  for (const off of [4, 5]) {
    const t = Date.parse(`${date}T00:00:00Z`) + (hour + off) * 3_600_000;
    if (nyHour(t) === hour && nyDate(t) === date) return t;
  }
  return Date.parse(`${date}T00:00:00Z`) + (hour + 5) * 3_600_000;
}
/** The 17:00 New York close that ends the session a bar at time t belongs to. */
export const sessionEnd = (t: number) => nyHour(t) < 17 ? nyEpoch(nyDate(t), 17) : nyEpoch(addDays(nyDate(t), 1), 17);

/** First W1 break times (up, down) against W0's closing range; null when W0 has too few bars. */
export function firstBreaks(b: IntradayBars, w1Start: number, w1End: number): { up: number | null; down: number | null } | null {
  const w0Start = w1Start - 7 * 86_400_000;
  let hi = -Infinity, lo = Infinity, n0 = 0;
  for (let i = 0; i < b.times.length; i++) if (b.times[i] >= w0Start && b.times[i] < w1Start) { hi = Math.max(hi, b.close[i]); lo = Math.min(lo, b.close[i]); n0++; }
  if (n0 < 20) return null;
  let up: number | null = null, down: number | null = null;
  for (let i = 0; i < b.times.length; i++) {
    const t = b.times[i];
    if (t < w1Start || t >= w1End) continue;
    if (up == null && b.close[i] > hi) up = t;
    if (down == null && b.close[i] < lo) down = t;
  }
  return { up, down };
}
const brokenBy = (f: { up: number | null; down: number | null } | null, t: number, dir: number) => {
  if (!f) return false;
  const u = f.up != null && f.up <= t, d = f.down != null && f.down <= t;
  return dir > 0 ? u && !d : d && !u;
};

export type SectorBreakCase = {
  id: string; code: string; symbol: string; sector: string; reportDate: string; releaseFriday: string; dir: 1 | -1;
  status: "watching" | "broke" | "no break";
  /** When the rest of the sector broke the reading's way (bar open time, ISO), and which markets had. */
  brokeAt: string | null; broken: string[]; others: number; need: number;
  /** The reading's own market: when it broke the reading's way first (descriptive). */
  ownBreakAt: string | null;
  entry: number | null; dayStd: number | null;
  /** Signed moves in normal-day units; filled as each horizon completes. */
  outcome: { h1: number | null; h2: number | null; h4: number | null; session: number | null };
};
export type SectorBreakLog = { version: 1; startedReport: string; updatedAt: string; cases: SectorBreakCase[] };
export type SectorBreakInput = { code: string; symbol: string; reportDate: string; dir: 1 | -1 | 0; dailyClose: number[] };

/** Standard deviation of the last 20 daily log returns. */
export function dailyStd(close: number[]): number | null {
  const c = close.slice(-21);
  if (c.length < 16) return null;
  const r = c.slice(1).map((x, i) => Math.log(x / c[i]));
  const m = r.reduce((a, x) => a + x, 0) / r.length;
  const s = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1));
  return s > 0 ? s : null;
}

/**
 * Adds a case for each market with a reading in its latest report (once its W1 has started), finds the sector break
 * as W1 unfolds, and fills the outcomes as bars arrive. Only completed bars (open time + 15 min <= now) are used.
 */
export function updateSectorBreakLog(prev: SectorBreakLog | null, inputs: SectorBreakInput[], bars: Map<string, IntradayBars>, startedReport: string, now = new Date()): SectorBreakLog {
  const log: SectorBreakLog = prev ? { ...prev, cases: prev.cases.map(c => ({ ...c, broken: [...c.broken], outcome: { ...c.outcome } })) } : { version: 1, startedReport, updatedAt: "", cases: [] };
  const nowMs = now.getTime();
  const done = new Map<string, IntradayBars>();
  for (const [s, b] of bars) {
    const n = b.times.filter(t => t + BAR_MS <= nowMs).length;
    done.set(s, { times: b.times.slice(0, n), close: b.close.slice(0, n) });
  }
  const byId = new Map(log.cases.map(c => [c.id, c]));
  for (const x of inputs) {
    const sector = sectorOf(x.symbol);
    if (!x.dir || !sector || x.reportDate < log.startedReport) continue;
    const fri = releaseFriday(x.reportDate), w1Start = nyEpoch(fri, 17);
    const id = `${x.code}:${x.reportDate}`;
    if (byId.has(id) || nowMs < w1Start) continue;
    const others = BREAK_SECTORS[sector].filter(s => s !== x.symbol);
    const c: SectorBreakCase = { id, code: x.code, symbol: x.symbol, sector, reportDate: x.reportDate, releaseFriday: fri, dir: x.dir, status: "watching",
      brokeAt: null, broken: [], others: others.length, need: Math.ceil(others.length / 2), ownBreakAt: null, entry: null,
      dayStd: dailyStd(x.dailyClose), outcome: { h1: null, h2: null, h4: null, session: null } };
    log.cases.push(c); byId.set(id, c);
  }
  for (const c of log.cases) {
    const w1Start = nyEpoch(c.releaseFriday, 17), w1End = w1Start + 7 * 86_400_000;
    const own = done.get(c.symbol);
    if (c.status === "watching") {
      const others = BREAK_SECTORS[c.sector].filter(s => s !== c.symbol);
      const fo = others.map(s => [s, done.has(s) ? firstBreaks(done.get(s)!, w1Start, w1End) : null] as const);
      const cand = fo.flatMap(([, f]) => f ? [f.up, f.down] : []).filter((t): t is number => t != null).sort((a, b) => a - b);
      const T = cand.find(t => fo.filter(([, f]) => brokenBy(f, t, c.dir)).length >= c.need);
      const ownF = own ? firstBreaks(own, w1Start, w1End) : null;
      const ownT = ownF ? (c.dir > 0 ? ownF.up : ownF.down) : null, ownOther = ownF ? (c.dir > 0 ? ownF.down : ownF.up) : null;
      if (ownT != null && (ownOther == null || ownT < ownOther)) c.ownBreakAt = new Date(ownT).toISOString();
      if (T != null && own) {
        const i = own.times.findIndex(t => t >= T);
        if (i >= 0 && own.times[i] < w1End) {
          c.status = "broke"; c.brokeAt = new Date(T).toISOString(); c.entry = own.close[i];
          c.broken = fo.filter(([, f]) => brokenBy(f, T, c.dir)).map(([s]) => s);
        }
      }
      if (c.status === "watching" && nowMs >= w1End) c.status = "no break";
    }
    if (c.status === "broke" && own && c.entry != null && c.dayStd) {
      const T = Date.parse(c.brokeAt!), i = own.times.findIndex(t => t >= T);
      if (i < 0) continue;
      const move = (j: number) => Number((c.dir * Math.log(own.close[j] / c.entry!) / c.dayStd!).toFixed(3));
      for (const [k, n] of Object.entries(HOURS) as [keyof typeof HOURS, number][]) if (c.outcome[k] == null && i + n < own.times.length) c.outcome[k] = move(i + n);
      const end = sessionEnd(own.times[i]);
      if (c.outcome.session == null && nowMs >= end) {
        let j = i;
        while (j + 1 < own.times.length && own.times[j + 1] < end) j++;
        c.outcome.session = j > i ? move(j) : 0;
      }
    }
  }
  log.cases.sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.symbol.localeCompare(b.symbol));
  log.updatedAt = now.toISOString();
  return log;
}

/** Averages over cases whose horizon has completed. */
export function breakTally(cases: SectorBreakCase[]) {
  const broke = cases.filter(c => c.status === "broke");
  const avg = (k: keyof SectorBreakCase["outcome"]) => {
    const v = broke.map(c => c.outcome[k]).filter((x): x is number => x != null);
    return { n: v.length, mean: v.length ? v.reduce((a, x) => a + x, 0) / v.length : null, positive: v.length ? v.filter(x => x > 0).length : 0 };
  };
  return { weeks: cases.length, broke: broke.length, noBreak: cases.filter(c => c.status === "no break").length, watching: cases.filter(c => c.status === "watching").length,
    h1: avg("h1"), h2: avg("h2"), h4: avg("h4"), session: avg("session") };
}
