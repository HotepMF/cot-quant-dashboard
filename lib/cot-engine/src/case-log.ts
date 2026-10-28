/**
 * The 8-week COT reading's forward record, and the two short-term oscillators shown next to it.
 *
 * Research (backtest/williams, 2002-2026): on the 204 weeks the 8-week reading was on, the next week moved the
 * commercials' way 59% of the time (+0.20 of a normal week). On the 28 of those weeks when the Ultimate Oscillator was
 * on the pullback side (oversold for a long, overbought for a short), 75% (+0.73). Small sample; the live log below is
 * how it gets confirmed or not.
 */
import { DEMO_MARKETS } from "./demo";

export const COT8_RECORD = {
  all: { cases: 204, wentItsWay: 59, move: 0.2 },
  pullback: { cases: 28, wentItsWay: 75, move: 0.73 },
  period: "2002-2026",
} as const;

/** Markets the log follows: the demo markets plus the Nikkei and the dollar index, with their Yahoo tickers. */
export const CASE_MARKETS: { code: string; symbol: string; ticker: string }[] = [
  ...DEMO_MARKETS.map(m => ({ code: m.code, symbol: m.symbol, ticker: m.ticker })),
  { code: "240743", symbol: "NKD", ticker: "NIY=F" },
  { code: "098662", symbol: "DX", ticker: "DX-Y.NYB" },
];

/** Daily bars, oldest first (the shape the Yahoo source returns). */
export type Bars = { dates: string[]; high: number[]; low: number[]; close: number[] };

/** Williams %R (14) at bar i: -100 (at the low of the range) to 0 (at the high). */
export function williamsR(b: Bars, i: number, n = 14): number | null {
  if (i < n - 1) return null;
  let hi = -Infinity, lo = Infinity;
  for (let k = i - n + 1; k <= i; k++) { hi = Math.max(hi, b.high[k]); lo = Math.min(lo, b.low[k]); }
  return hi > lo ? (hi - b.close[i]) / (hi - lo) * -100 : null;
}

/** Ultimate Oscillator (7, 14, 28) at bar i, 0-100. */
export function ultimateOscillator(b: Bars, i: number): number | null {
  if (i < 28) return null;
  const avg = (n: number) => {
    let bp = 0, tr = 0;
    for (let k = i - n + 1; k <= i; k++) {
      const pc = b.close[k - 1];
      bp += b.close[k] - Math.min(b.low[k], pc);
      tr += Math.max(b.high[k], pc) - Math.min(b.low[k], pc);
    }
    return tr > 0 ? bp / tr : null;
  };
  const a7 = avg(7), a14 = avg(14), a28 = avg(28);
  return a7 == null || a14 == null || a28 == null ? null : 100 * (4 * a7 + 2 * a14 + a28) / 7;
}

/** Is the oscillator on the pullback side of the reading's direction? (UO: < 30 long / > 70 short; %R: <= -80 / >= -20) */
export const uoPullback = (dir: number, uo: number | null) => uo == null || !dir ? null : dir > 0 ? uo < 30 : uo > 70;
export const wrPullback = (dir: number, wr: number | null) => wr == null || !dir ? null : dir > 0 ? wr <= -80 : wr >= -20;

export type CotCase = {
  id: string; code: string; symbol: string; reportDate: string; releaseFriday: string; dir: 1 | -1;
  z: number | null; commercialCycle: number | null; largeCycle: number | null;
  uo: number | null; wr: number | null; pullback: boolean | null;
  entry: number; weeklyVol: number | null;
  outcome?: { date: string; exit: number; movePct: number; moveVol: number | null; wentItsWay: boolean };
};
export type CaseLog = { version: 1; startedReport: string; updatedAt: string; cases: CotCase[] };
export type CaseInput = { code: string; symbol: string; reportDate: string; dir: 1 | -1 | 0; z: number | null; commercialCycle: number | null; largeCycle: number | null; bars: Bars };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lastOnOrBefore = (b: Bars, d: string) => { let i = -1; for (let k = 0; k < b.dates.length && b.dates[k] <= d; k++) i = k; return i; };
/**
 * The bar for date d once its close is final: d itself, or (when d had no session, e.g. a holiday) the last bar before
 * it, but only once a later bar shows the market has moved on. -1 while d's close is still missing.
 */
const closeFor = (b: Bars, d: string, completeThrough: string) => {
  const i = lastOnOrBefore(b, d);
  if (i < 0 || d > completeThrough) return -1;
  if (b.dates[i] === d) return i;
  return b.dates.some(x => x > d && x <= completeThrough) ? i : -1;
};

/** 52-week vol of weekly (Friday) log returns up to and including date d. */
function weeklyVol(b: Bars, d: string): number | null {
  const fr: number[] = [];
  let week = "";
  for (let k = 0; k < b.dates.length && b.dates[k] <= d; k++) {
    const t = Date.parse(`${b.dates[k]}T00:00:00Z`);
    const w = new Date(t + ((5 - new Date(t).getUTCDay() + 7) % 7) * 86_400_000).toISOString().slice(0, 10);
    if (w !== week) { fr.push(b.close[k]); week = w; } else fr[fr.length - 1] = b.close[k];
  }
  const r = fr.slice(-53).slice(1).map((c, i, a) => Math.log(c / fr.slice(-53)[i]));
  if (r.length < 40) return null;
  const m = r.reduce((a, x) => a + x, 0) / r.length;
  return Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1));
}

/**
 * Adds a case for every market whose reading is on in its latest report (once its release Friday's close is in the
 * bars), and fills the outcome one week later (the next release Friday's close). `completeThrough` is the last date
 * whose close is final. Reports before `startedReport` are never added.
 */
export function updateCaseLog(prev: CaseLog | null, inputs: CaseInput[], completeThrough: string, startedReport: string, now = new Date()): CaseLog {
  const log: CaseLog = prev ? { ...prev, cases: prev.cases.map(c => ({ ...c })) } : { version: 1, startedReport, updatedAt: "", cases: [] };
  const byId = new Map(log.cases.map(c => [c.id, c]));
  for (const x of inputs) {
    if (x.dir !== 0 && x.reportDate >= log.startedReport && !byId.has(`${x.code}:${x.reportDate}`)) {
      const fri = addDays(x.reportDate, 3);
      const i = closeFor(x.bars, fri, completeThrough);
      if (i >= 0 && x.bars.dates[i] >= addDays(fri, -4)) {
        const uo = ultimateOscillator(x.bars, i), wr = williamsR(x.bars, i);
        const c: CotCase = { id: `${x.code}:${x.reportDate}`, code: x.code, symbol: x.symbol, reportDate: x.reportDate, releaseFriday: fri, dir: x.dir,
          z: x.z, commercialCycle: x.commercialCycle, largeCycle: x.largeCycle, uo: uo == null ? null : Number(uo.toFixed(1)), wr: wr == null ? null : Number(wr.toFixed(1)),
          pullback: uoPullback(x.dir, uo), entry: x.bars.close[i], weeklyVol: weeklyVol(x.bars, fri) };
        log.cases.push(c); byId.set(c.id, c);
      }
    }
  }
  const barsByCode = new Map(inputs.map(x => [x.code, x.bars]));
  for (const c of log.cases) {
    if (c.outcome) continue;
    const b = barsByCode.get(c.code);
    const target = addDays(c.releaseFriday, 7);
    if (!b) continue;
    const j = closeFor(b, target, completeThrough);
    if (j < 0 || b.dates[j] <= c.releaseFriday) continue;
    const move = c.dir * Math.log(b.close[j] / c.entry);
    c.outcome = { date: b.dates[j], exit: b.close[j], movePct: Number((move * 100).toFixed(3)), moveVol: c.weeklyVol ? Number((move / c.weeklyVol).toFixed(3)) : null, wentItsWay: move > 0 };
  }
  log.cases.sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.symbol.localeCompare(b.symbol));
  log.updatedAt = now.toISOString();
  return log;
}

export type Tally = { cases: number; done: number; wentItsWay: number; avgMoveVol: number | null };
export function tally(cases: CotCase[]): Tally {
  const done = cases.filter(c => c.outcome);
  const vols = done.map(c => c.outcome!.moveVol).filter((v): v is number => v != null);
  return { cases: cases.length, done: done.length, wentItsWay: done.filter(c => c.outcome!.wentItsWay).length,
    avgMoveVol: vols.length ? vols.reduce((a, v) => a + v, 0) / vols.length : null };
}

/** Today's oscillator readings per market, for display next to the reading. */
export type OscillatorSnapshot = {
  generatedAt: string; asOf: string;
  markets: Record<string, { symbol: string; date: string; uo: number | null; wr: number | null; dir: 1 | -1 | 0; reportDate: string | null; uoPullback: boolean | null; wrPullback: boolean | null }>;
};
