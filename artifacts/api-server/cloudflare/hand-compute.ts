import {
  CASE_MARKETS, CORE_MARKETS, DEMO_FILTER_SETTINGS, HAND_PARTICIPATION, HAND_POWER_PRODUCERS, HAND_RANGES, computeRows, defaultSignalSettings, ultimateOscillator, uoPullback, williamsR, wrPullback,
  type CaseInput, type OscillatorSnapshot, type RawRow, type WeekBar,
  type CrowdedRow, type HandCard, type HandSnapshot, type ParticipationRow, type RangeRow,
} from "@workspace/cot-engine";
import type { CategoryHistory, CurvePoint, DailyBars, LatestCounts, SiteHistory } from "./hand-sources";
import { weeklyLast } from "./sectors-compute";
import type { DailyCloses } from "./sectors-sources";

/** Spec v2 conventions: trailing 156-week windows (min 104), enter at |z| >= 1.0, exit inside ±0.5. */
const Z_WEEKS = 156, Z_MIN = 104, ENTER = 1, EXIT = 0.5;
const THEME_START = "2022-01-03";

const round = (v: number | null, d = 1) => v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;
const signed = (v: number | null, d = 1, unit = "") => v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}${unit}`;
const ordinal = (p: number) => `${p}${p % 100 >= 11 && p % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[p % 10] ?? "th"}`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function zOf(window: number[]) {
  if (window.length < Z_MIN) return null;
  const m = mean(window);
  const sd = Math.sqrt(window.reduce((a, b) => a + (b - m) ** 2, 0) / window.length);
  return sd ? Math.max(-4, Math.min(4, (window[window.length - 1] - m) / sd)) : 0;
}

/** z of each value against its own trailing 156 values (levels). */
export function levelZ(values: number[]) {
  return values.map((_, t) => zOf(values.slice(Math.max(0, t - Z_WEEKS + 1), t + 1)));
}

/** z of each lag-week change against the trailing 156 changes. */
export function changeZ(values: number[], lag: number) {
  const moves = values.map((v, t) => t >= lag ? v - values[t - lag] : null);
  return moves.map((m, t) => {
    if (m == null) return null;
    const w = moves.slice(Math.max(lag, t - Z_WEEKS + 1), t + 1).filter((x): x is number => x != null);
    return zOf(w);
  });
}

/** Enter at ±1.0, stay until the reading falls back inside ±0.5. */
export function hysteresis(z: (number | null)[], up: string, down: string, neutral: string) {
  let hi = false, lo = false;
  return z.map(v => {
    if (v == null) { hi = lo = false; return null; }
    hi = v >= ENTER || (hi && v >= EXIT);
    lo = v <= -ENTER || (lo && v <= -EXIT);
    return hi ? up : lo ? down : neutral;
  });
}

export function volatilityCard(spy: DailyCloses, vix: DailyCloses | undefined, vix3m: DailyCloses | undefined): HandCard {
  const r = spy.closes.slice(1).map((c, i) => Math.log(c / spy.closes[i]));
  const rv: number[] = [], dates: string[] = [];
  for (let i = 20; i < r.length; i++) {
    const w = r.slice(i - 20, i + 1), m = mean(w);
    rv.push(Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1)) * Math.sqrt(252));
    dates.push(spy.dates[i + 1]);
  }
  const weekly = weeklyLast(dates, rv.map(Math.log)).map(w => w.value);
  const z = levelZ(weekly);
  const state = hysteresis(z, "high", "low", "normal").at(-1) ?? null;
  const zNow = round(z.at(-1) ?? null, 2);
  const rvNow = (rv.at(-1)! * 100).toFixed(1);
  const last156 = weekly.slice(-Z_WEEKS);
  const pct = Math.round(last156.filter(v => v <= weekly.at(-1)!).length / last156.length * 100);
  let ratio: number | null = null, ratioDate: string | null = null;
  if (vix && vix3m) {
    const m3 = new Map(vix3m.dates.map((d, i) => [d, vix3m.closes[i]]));
    for (let i = vix.dates.length - 1; i >= 0; i--) {
      const b = m3.get(vix.dates[i]);
      if (b) { ratio = round(vix.closes[i] / b, 2); ratioDate = vix.dates[i]; break; }
    }
  }
  const ratioText = ratio == null ? "" : `; VIX ÷ VIX3M ${ratio.toFixed(2)}`;
  const text = {
    high: { headline: `Equity volatility is elevated: SPY 21-day vol ${rvNow}% (${signed(zNow, 2)} z)${ratioText}.`, mechanism: "Higher volatility usually accompanies falling prices and tighter risk budgets.", sector: "Past high-vol phases: staples, utilities and health care held up; financials lagged." },
    low: { headline: `Equity volatility is subdued: SPY 21-day vol ${rvNow}% (${signed(zNow, 2)} z)${ratioText}.`, mechanism: "Calm markets support leverage and risk-taking.", sector: "Past low-vol phases: financials did slightly better; defensives lagged." },
    normal: { headline: `Equity volatility is in its normal range: SPY 21-day vol ${rvNow}% (${signed(zNow, 2)} z)${ratioText}.`, mechanism: "Neither a stressed nor an unusually calm market by its own 3-year history.", sector: "The sector patterns for this card apply only in the high and low states." },
  }[state ?? "normal"]!;
  return {
    id: "volatility", title: "Volatility", state, status: "live",
    headline: text.headline, mechanism: text.mechanism, sectorLine: text.sector,
    readings: [
      { label: "SPY 21-day realised vol", value: `${rvNow}%`, note: `${signed(zNow, 2)} z vs 3 years · ${ordinal(pct)} percentile` },
      { label: "VIX ÷ VIX3M", value: ratio == null ? "—" : ratio.toFixed(2), note: ratio == null ? "unavailable this run" : ratio > 1 ? `inverted term structure (stress) · ${ratioDate}` : `upward-sloping term structure · ${ratioDate}` },
    ],
  };
}

export function ratesCard(curve: CurvePoint[]): HandCard {
  const weekly = <K extends keyof CurvePoint>(k: K) => weeklyLast(curve.map(c => c.date), curve.map(c => c[k] as number)).map(w => w.value);
  const y10 = weekly("y10"), y2 = weekly("y2"), m3 = weekly("m3");
  const s210 = y10.map((v, i) => (v - y2[i]) * 100);
  const policy = y2.map((v, i) => (v - m3[i]) * 100);
  const curveZ = changeZ(s210, 13), policyZ = changeZ(policy, 13);
  const state = hysteresis(curveZ, "steepener", "flattener", "none").at(-1) ?? null;
  const t = s210.length - 1;
  const d13 = (xs: number[]) => xs[t] - xs[t - 13];
  const curveBp = round(d13(s210), 0)!, policyBp = round(d13(policy), 0)!, y10Bp = round(d13(y10) * 100, 0)!;
  const bullBear = y10Bp < 0 ? "bull" : y10Bp > 0 ? "bear" : "flat 10-year";
  const pz = round(policyZ[t], 2), cz = round(curveZ[t], 2);
  const repriced = policyBp > 0 ? "repriced the policy path higher" : policyBp < 0 ? "repriced the policy path lower" : "held the policy path";
  const text = {
    steepener: { headline: `The curve is steepening: 2s10s ${signed(curveBp, 0)} bp over 13 weeks (${bullBear}).`, mechanism: "A steeper curve widens lending margins and usually reflects growth or term-premium repricing.", sector: "Past steepeners: financials and materials led, tech lagged." },
    flattener: { headline: `The curve is flattening: 2s10s ${signed(curveBp, 0)} bp over 13 weeks (${bullBear}).`, mechanism: "Flattening squeezes bank margins and often accompanies tighter policy or slower growth.", sector: "Past flatteners: utilities led, financials lagged." },
    none: { headline: `The curve has no clear trend: 2s10s ${signed(curveBp, 0)} bp over 13 weeks (${bullBear}).`, mechanism: "The front end prices the expected policy rate; the 2s10s slope reflects growth and term premium.", sector: "Curve sector patterns apply only while the curve is steepening or flattening." },
  }[state ?? "none"]!;
  const policyLine = pz != null && Math.abs(pz) >= ENTER
    ? ` Markets ${repriced}: 2y − 3m ${signed(policyBp, 0)} bp over 13 weeks (${signed(pz, 2)} z). When repricing was hawkish, energy and materials led and utilities and staples lagged, roughly in proportion to its size.`
    : "";
  const last = curve.at(-1)!;
  return {
    id: "rates", title: "Rates", state: state === "none" ? "no trend" : state, status: "live",
    headline: text.headline, mechanism: text.mechanism, sectorLine: text.sector + policyLine,
    readings: [
      { label: "2s10s slope", value: `${signed(round(s210[t], 0), 0)} bp`, note: `${signed(curveBp, 0)} bp in 13 weeks · ${signed(cz, 2)} z` },
      { label: "Policy path (2y − 3m)", value: `${signed(round(policy[t], 0), 0)} bp`, note: `${signed(policyBp, 0)} bp in 13 weeks · ${signed(pz, 2)} z` },
      { label: "10-year yield", value: `${last.y10.toFixed(2)}%`, note: `${signed(y10Bp, 0)} bp in 13 weeks` },
      { label: "2-year · 3-month", value: `${last.y2.toFixed(2)}% · ${last.m3.toFixed(2)}%`, note: `Treasury par curve, ${last.date}` },
    ],
  };
}

/** Weekly log returns on the dates both series have, in excess of the benchmark. */
function weeklyExcess(asset: DailyCloses, bench: DailyCloses) {
  const b = new Map(weeklyLast(bench.dates, bench.closes).map(w => [w.week, w.value]));
  const a = weeklyLast(asset.dates, asset.closes);
  const out = new Map<string, number>();
  for (let i = 1; i < a.length; i++) {
    const b0 = b.get(a[i - 1].week), b1 = b.get(a[i].week);
    if (b0 && b1) out.set(a[i].week, Math.log(a[i].value / a[i - 1].value) - Math.log(b1 / b0));
  }
  return out;
}

function correlation(x: number[], y: number[]) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  x.forEach((v, i) => { sxy += (v - mx) * (y[i] - my); sxx += (v - mx) ** 2; syy += (y[i] - my) ** 2; });
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

export function aiPowerCard(prices: Map<string, DailyCloses>): HandCard {
  const spy = prices.get("SPY")!;
  const ex = (t: string) => prices.has(t) ? weeklyExcess(prices.get(t)!, spy) : new Map<string, number>();
  const semis = ex("SMH");
  const producers = HAND_POWER_PRODUCERS.map(ex);
  const weeks = [...semis.keys()].filter(w => w >= THEME_START).sort();
  const basket = new Map<string, number>();
  for (const w of weeks) {
    const xs = producers.map(p => p.get(w)).filter((v): v is number => v != null);
    if (xs.length) basket.set(w, mean(xs));
  }
  const both = weeks.filter(w => basket.has(w));
  const last26 = both.slice(-26);
  const corr = round(correlation(last26.map(w => semis.get(w)!), last26.map(w => basket.get(w)!)), 2);
  const phase = corr == null ? null : corr >= 0.4 ? "linked" : corr >= 0 ? "loose" : "unlinked";
  const fromHigh = (series: Map<string, number>) => {
    let cum = 0, peak = -Infinity;
    for (const w of both) { cum += series.get(w)!; peak = Math.max(peak, cum); }
    return round((Math.exp(cum - peak) - 1) * 100, 0);
  };
  const rel13 = (series: Map<string, number>) => {
    const ws = [...series.keys()].sort().slice(-13);
    return ws.length === 13 ? round((Math.exp(ws.reduce((a, w) => a + series.get(w)!, 0)) - 1) * 100, 1) : null;
  };
  const xlk = ex("XLK"), xlu = ex("XLU");
  const semisHigh = fromHigh(semis), powerHigh = fromHigh(basket);
  const highText = (v: number | null) => v == null ? "—" : v === 0 ? "at its relative high" : `${Math.abs(v)}% below its relative high`;
  return {
    id: "ai", title: "AI power demand", state: phase, status: "live",
    headline: corr == null ? "The AI and power gauge is unavailable this run." : `AI and power are trading ${phase === "linked" ? "as one theme" : phase === "loose" ? "loosely together" : "as separate stories"}: 26-week correlation ${corr.toFixed(2)}.`,
    mechanism: "When the market trades \"AI needs power\" as one idea, semis and merchant power producers move together.",
    sectorLine: "One full cycle so far (2022–2026): the correlation peaked in July 2025, a week before power producers topped; semis kept leading for another eleven months. One cycle is not a rule, and the gauge does not call tops.",
    readings: [
      { label: "Theme strength", value: corr == null ? "—" : corr.toFixed(2), note: "26-week correlation of SMH and NRG/VST/CEG weekly returns, each in excess of SPY · ≥ 0.4 linked, 0–0.4 loose, < 0 unlinked" },
      { label: "Semis (SMH) vs SPY", value: signed(rel13(semis), 1, "%"), note: `13 weeks · ${highText(semisHigh)}` },
      { label: "Power producers vs SPY", value: signed(rel13(basket), 1, "%"), note: `13 weeks · ${highText(powerHigh)}` },
      { label: "Tech (XLK) · Utilities (XLU) vs SPY", value: `${signed(rel13(xlk), 1, "%")} · ${signed(rel13(xlu), 1, "%")}`, note: "13 weeks" },
    ],
  };
}

export function creditCard(prices: Map<string, DailyCloses>): HandCard {
  const hyg = prices.get("HYG"), ief = prices.get("IEF");
  let trend: number | null = null;
  if (hyg && ief) {
    const ex = weeklyExcess(hyg, ief);
    const ws = [...ex.keys()].sort().slice(-13);
    if (ws.length === 13) trend = round((Math.exp(ws.reduce((a, w) => a + ex.get(w)!, 0)) - 1) * 100, 1);
  }
  return {
    id: "credit", title: "Credit conditions", state: null, status: "pending",
    pendingReason: "The credit label uses the Baa corporate bond spread from FRED, which isn't connected yet. Until then the card shows the high-yield vs Treasury ETF trend only.",
    headline: trend == null ? "Credit readings are unavailable this run." : `High-yield bonds ${trend >= 0 ? "outperformed" : "underperformed"} Treasuries by ${Math.abs(trend).toFixed(1)}% over 13 weeks (HYG ÷ IEF).`,
    mechanism: "Wider spreads raise borrowing costs for leveraged companies; tighter spreads support refinancing and risk-taking.",
    sectorLine: "Credit sector patterns did not beat chance in our tests, so none is shown.",
    readings: [{ label: "HYG ÷ IEF", value: signed(trend, 1, "%"), note: "13 weeks · confirmation line, not the label" }],
  };
}

export function powerCard(): HandCard {
  return {
    id: "power", title: "Power and gas cost", state: null, status: "pending",
    pendingReason: "Power prices, Henry Hub spot, heat rate and power-region positioning arrive with the power data update. Henry Hub futures positioning is live below.",
    headline: "Power and gas cost readings are not connected yet.",
    mechanism: "Power rising faster than gas points to scarcity or wider generation margins; both rising together points to fuel cost.",
    sectorLine: "Energy stocks moved with gas and power; other links are mixed.",
    readings: [],
  };
}

/** Share of the trailing 156 weeks (excluding today) strictly below today's reading, as in the research. */
function pct3y(series: { date: string; v: number }[]) {
  const last = series.at(-1)!;
  const cutoff = Date.parse(`${last.date}T00:00:00Z`) - Z_WEEKS * 7 * 86_400_000;
  const w = series.filter(s => Date.parse(`${s.date}T00:00:00Z`) > cutoff);
  if (w.length <= 52) return null;
  return Math.round(w.slice(0, -1).filter(s => s.v < last.v).length / (w.length - 1) * 100);
}

export function participationRow(spec: typeof HAND_PARTICIPATION[number], category: string, history: CategoryHistory, counts: LatestCounts): ParticipationRow {
  const net = history.map(h => ({ date: h.date, v: (h.long - h.short) / h.oi * 100 }));
  const last = history.at(-1)!, now = net.at(-1)!;
  const fourBack = Date.parse(`${now.date}T00:00:00Z`) - 28 * 86_400_000;
  const prev = [...net].reverse().find(n => Date.parse(`${n.date}T00:00:00Z`) <= fourBack);
  const traders = counts.traders[category] ?? { long: null, short: null };
  const total = (traders.long ?? 0) + (traders.short ?? 0);
  const withheld = total < 20 || (counts.top4Long ?? 0) > 50 || (counts.top4Short ?? 0) > 50;
  return {
    card: spec.card, market: spec.market, category, code: spec.code, reportDate: now.date,
    netPct: withheld ? null : round(now.v), longPct: withheld ? null : round(last.long / last.oi * 100),
    shortPct: withheld ? null : round(last.short / last.oi * 100), pct3y: withheld ? null : pct3y(net),
    chg4w: withheld || !prev ? null : round(now.v - prev.v),
    tradersLong: traders.long, tradersShort: traders.short, top4Long: counts.top4Long, top4Short: counts.top4Short, withheld,
  };
}

/** Expected ES / NQ day for the current volatility state, in % and in points at the last close. */
export function rangeRows(state: string | null, bars: Map<"ES" | "NQ", DailyBars>): RangeRow[] {
  const s = (state === "high" || state === "low" ? state : "normal") as "high" | "normal" | "low";
  return (["ES", "NQ"] as const).flatMap(market => {
    const b = bars.get(market);
    if (!b || b.close.length < 2) return [];
    const last = b.close.at(-1)!;
    const daily = b.close.slice(1).map((_, i) => (b.high[i + 1] - b.low[i + 1]) / b.close[i] * 100).slice(-20).sort((x, y) => x - y);
    const recent = daily.length >= 10 ? (daily[(daily.length - 1) >> 1] + daily[daily.length >> 1]) / 2 : null;
    const r = HAND_RANGES[market][s];
    return [{ market, state: s, medianPct: r.median, p80Pct: r.p80, last: round(last, 2)!, medianPts: Math.round(last * r.median / 100), p80Pts: Math.round(last * r.p80 / 100), recent20Pct: round(recent, 2), asOf: b.dates.at(-1)! }];
  });
}

/** Core markets whose large speculators sit in the top or bottom 10% of their 3-year range. */
export function crowdedRows(histories: Map<string, SiteHistory>): CrowdedRow[] {
  const out: CrowdedRow[] = [];
  for (const m of CORE_MARKETS) {
    const h = m.code ? histories.get(m.code)?.filter(r => r.openInterest) : undefined;
    if (!h || h.length < 60) continue;
    const spec = h.map(r => ({ date: r.date, v: r.largeTraders / r.openInterest! * 100 }));
    const comm = h.map(r => ({ date: r.date, v: r.commercialHedgers / r.openInterest! * 100 }));
    const sp = pct3y(spec), cp = pct3y(comm);
    if (sp == null || cp == null || (sp > 10 && sp < 90)) continue;
    const now = spec.at(-1)!;
    const four = Date.parse(`${now.date}T00:00:00Z`) - 28 * 86_400_000;
    const prev = [...spec].reverse().find(r => Date.parse(`${r.date}T00:00:00Z`) <= four);
    out.push({ code: m.code!, symbol: m.symbol, label: m.label, group: m.group, reportDate: now.date, specNetPct: round(now.v)!, specPct3y: sp, commPct3y: cp, chg4w: prev ? round(now.v - prev.v) : null, side: sp >= 90 ? "top" : "bottom" });
  }
  return out.sort((a, b) => Math.abs(b.specPct3y - 50) - Math.abs(a.specPct3y - 50));
}

/** Monday-Friday bars labelled by their Friday, completed weeks only (a week is complete after Friday 17:30 New York). */
export function completedWeeks(b: DailyBars, now = new Date()): WeekBar[] {
  const ny = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map(p => [p.type, p.value]));
  const today = `${ny.year}-${ny.month}-${ny.day}`, late = Number(ny.hour) * 60 + Number(ny.minute) >= 17 * 60 + 30;
  const out: WeekBar[] = [];
  b.dates.forEach((d, i) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    const week = new Date(t + ((5 - new Date(t).getUTCDay() + 7) % 7) * 86_400_000).toISOString().slice(0, 10);
    const last = out.at(-1);
    if (last?.week === week) { last.high = Math.max(last.high, b.high[i]); last.low = Math.min(last.low, b.low[i]); last.close = b.close[i]; }
    else out.push({ week, open: b.open[i], high: b.high[i], low: b.low[i], close: b.close[i] });
  });
  return out.filter(w => w.week < today || (w.week === today && late));
}

/** Last date whose daily close is final in New York (today after 17:30, otherwise the previous day). */
export function completeThrough(now = new Date()): string {
  const ny = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map(p => [p.type, p.value]));
  const today = `${ny.year}-${ny.month}-${ny.day}`;
  return Number(ny.hour) * 60 + Number(ny.minute) >= 17 * 60 + 30 ? today : new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Per case market: the site default's latest reading (the 8-week reading) and its daily bars. */
export function caseInputs(histories: Map<string, SiteHistory>, daily: Map<string, DailyBars>): CaseInput[] {
  const out: CaseInput[] = [];
  for (const m of CASE_MARKETS) {
    const h = histories.get(m.code), bars = daily.get(m.code);
    if (!h?.length || !bars) continue;
    const rows: RawRow[] = h.map(r => ({ date: r.date, large_traders: r.largeTraders, small_traders: r.smallTraders ?? 0, commercial_hedgers: r.commercialHedgers, ...(r.openInterest ? { open_interest: r.openInterest } : {}) }));
    const last = computeRows(rows, defaultSignalSettings).at(-1);
    if (!last) continue;
    out.push({ code: m.code, symbol: m.symbol, reportDate: last.date, dir: last.buy && !last.sell ? 1 : last.sell && !last.buy ? -1 : 0,
      z: last.chZ, commercialCycle: last.chCycle, largeCycle: last.ltCycle, bars });
  }
  return out;
}

/** Today's Ultimate Oscillator and %R per market (last final close), with their side relative to the reading. */
export function oscillatorSnapshot(inputs: CaseInput[], through: string): OscillatorSnapshot {
  const markets: OscillatorSnapshot["markets"] = {};
  let asOf = "";
  for (const x of inputs) {
    let i = -1;
    for (let k = 0; k < x.bars.dates.length && x.bars.dates[k] <= through; k++) i = k;
    if (i < 0) continue;
    const uo = ultimateOscillator(x.bars, i), wr = williamsR(x.bars, i);
    markets[x.code] = { symbol: x.symbol, date: x.bars.dates[i], uo: uo == null ? null : Number(uo.toFixed(1)), wr: wr == null ? null : Number(wr.toFixed(1)),
      dir: x.dir, reportDate: x.reportDate, uoPullback: uoPullback(x.dir, uo), wrPullback: wrPullback(x.dir, wr) };
    if (x.bars.dates[i] > asOf) asOf = x.bars.dates[i];
  }
  return { generatedAt: new Date().toISOString(), asOf, markets };
}

/** The demo account's frozen filter per report week (keyed by that week's Friday) from the site's own Legacy histories. */
export function filterByWeek(history: SiteHistory): Record<string, 1 | -1 | 0> {
  const rows: RawRow[] = history.map(r => ({ date: r.date, large_traders: r.largeTraders, small_traders: r.smallTraders ?? 0, commercial_hedgers: r.commercialHedgers, ...(r.openInterest ? { open_interest: r.openInterest } : {}) }));
  const out: Record<string, 1 | -1 | 0> = {};
  computeRows(rows, DEMO_FILTER_SETTINGS).forEach(r => {
    const t = Date.parse(`${r.date}T00:00:00Z`);
    const fri = new Date(t + ((5 - new Date(t).getUTCDay() + 7) % 7) * 86_400_000).toISOString().slice(0, 10);
    out[fri] = r.buy && !r.sell ? 1 : r.sell && !r.buy ? -1 : 0;
  });
  return out;
}

export type HandInputs = {
  generatedAt: string; priceSource: string;
  prices: Map<string, DailyCloses>;
  curve: CurvePoint[] | null;
  participation: Map<string, { histories: Record<string, CategoryHistory>; counts: LatestCounts }>;
  rangeBars?: Map<"ES" | "NQ", DailyBars>;
  siteHistories?: Map<string, SiteHistory>;
};

export function buildHand(input: HandInputs): HandSnapshot {
  const spy = input.prices.get("SPY");
  if (!spy) throw new Error("Benchmark prices are missing.");
  const participation = HAND_PARTICIPATION.flatMap(spec => {
    const got = input.participation.get(spec.code);
    if (!got) throw new Error(`Positioning is missing for ${spec.code}.`);
    return spec.categories.map(c => participationRow(spec, c, got.histories[c], got.counts));
  });
  const rates: HandCard = input.curve ? ratesCard(input.curve) : {
    id: "rates", title: "Rates", state: null, status: "pending", pendingReason: "Treasury yields were unavailable this run.",
    headline: "Rates readings are unavailable this run.", mechanism: "", sectorLine: "", readings: [],
  };
  const volatility = volatilityCard(spy, input.prices.get("^VIX"), input.prices.get("^VIX3M"));
  return {
    version: 1, generatedAt: input.generatedAt, priceSource: input.priceSource,
    positioningAsOf: participation.map(p => p.reportDate).sort().at(-1)!,
    pricesAsOf: spy.dates.at(-1)!, yieldsAsOf: input.curve?.at(-1)?.date ?? null,
    cards: [creditCard(input.prices), rates, powerCard(), volatility, aiPowerCard(input.prices)],
    participation,
    ranges: input.rangeBars ? rangeRows(volatility.state, input.rangeBars) : [],
    crowded: input.siteHistories ? crowdedRows(input.siteHistories) : [],
  };
}
