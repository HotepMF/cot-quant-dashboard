export type RawRow = { date: string; large_traders: number; small_traders: number; commercial_hedgers: number; open_interest?: number };
export type CalcRow = RawRow & {
  ltDelta: number; stDelta: number; chDelta: number; ltZ: number | null; stZ: number | null; chZ: number | null;
  ltDeltaPct: number | null; stDeltaPct: number | null; chDeltaPct: number | null;
  ltDeltaZ: number | null; stDeltaZ: number | null; chDeltaZ: number | null;
  ltCycle: number; stCycle: number; chCycle: number; oiMove: number | null;
  buy: boolean; sell: boolean; confluenceBull: boolean; confluenceBear: boolean;
  largeMove: boolean; moveDirection: string;
};
export type SignalSettings = {
  lookback: number; zThreshold: number; zEnabled: boolean; confluenceThreshold: number;
  requireSmall: boolean; changeEnabled: boolean; oiThreshold: number; participant: string; signalMode: string;
  /** "Standard Z-Score" (raw net) or "Open Interest Normalization" (net / that week's open interest), as in the indicator. */
  zMethod: string;
};
export const Z_METHODS = ["Standard Z-Score", "Open Interest Normalization"] as const;
/**
 * Site defaults (Oct 27, 2026): the AND gate on commercials, standard Z over 8 weeks >= 2.25, cycle 75. Best plateau of
 * 400 settings on the week after each report, 2002-2026 (backtest/state/findings.md, weekly unit).
 */
export const defaultSignalSettings: SignalSettings = {
  lookback: 8, zThreshold: 2.25, zEnabled: true, confluenceThreshold: 75,
  requireSmall: false, changeEnabled: true, oiThreshold: 25,
  participant: "Commercial Hedgers", signalMode: "Both (AND gate)", zMethod: "Standard Z-Score",
};
/** The previous site default (Oct 22-27, 2026), kept so visitors can switch back: OI-normalised Z over 16 weeks. */
export const previousDefaultSignalSettings: SignalSettings = {
  ...defaultSignalSettings, lookback: 16, zThreshold: 2, confluenceThreshold: 65, zMethod: "Open Interest Normalization",
};
/** The demo account's filter, frozen with its rules: it does not follow later changes to the site default. */
export const DEMO_FILTER_SETTINGS: SignalSettings = {
  lookback: 16, zThreshold: 2, zEnabled: true, confluenceThreshold: 65,
  requireSmall: false, changeEnabled: true, oiThreshold: 25,
  participant: "Commercial Hedgers", signalMode: "Both (AND gate)", zMethod: "Open Interest Normalization",
};
const metricKeys = ["large_traders", "small_traders", "commercial_hedgers"] as const;
type MetricKey = typeof metricKeys[number];
function mean(values: number[]) { return values.reduce((a, b) => a + b, 0) / values.length; }
function zScore(values: number[], length: number): number | null {
  const window = values.slice(-length).filter(Number.isFinite);
  if (window.length < length) return null;
  const avg = mean(window);
  const sd = Math.sqrt(window.reduce((s, v) => s + (v - avg) ** 2, 0) / length);
  return sd ? (window[window.length - 1] - avg) / sd : 0;
}
function cycleRanks(values: number[]) {
  let max = -Infinity, min = Infinity;
  return values.map(value => {
    max = Math.max(max, value); min = Math.min(min, value);
    return max === min ? 50 : ((value - min) / (max - min)) * 100;
  });
}

/** Shared verbatim rule implementation for the single-market dashboard and market-wide scanner. */
export function computeRows(raw: RawRow[], settings: SignalSettings, latestOnly = false): CalcRow[] {
  const vals = (k: MetricKey) => raw.map(r => r[k]);
  const allVals = { large_traders: vals("large_traders"), small_traders: vals("small_traders"), commercial_hedgers: vals("commercial_hedgers") };
  // Z-score input: raw net, or net / that week's open interest (missing OI leaves the window incomplete -> no Z).
  const oiNorm = settings.zMethod === "Open Interest Normalization";
  const zVals = oiNorm
    ? Object.fromEntries(metricKeys.map(k => [k, raw.map(r => r.open_interest != null && r.open_interest > 0 ? r[k] / r.open_interest : Number.NaN)])) as Record<MetricKey, number[]>
    : allVals;
  const deltas = Object.fromEntries(metricKeys.map(k => [k, allVals[k].map((v, i) => i ? v - allVals[k][i - 1] : Number.NaN)])) as Record<MetricKey, number[]>;
  const cycleSeries = { large_traders: cycleRanks(allVals.large_traders), small_traders: cycleRanks(allVals.small_traders), commercial_hedgers: cycleRanks(allVals.commercial_hedgers) };
  return (latestOnly ? raw.slice(-1) : raw).map((r, index) => {
    const i = latestOnly ? raw.length - 1 : index;
    const selectedKey: MetricKey = settings.participant === "Large Traders" ? "large_traders" : settings.participant === "Small Traders" ? "small_traders" : "commercial_hedgers";
    const z = {
      large_traders: zScore(zVals.large_traders.slice(0, i + 1), settings.lookback),
      small_traders: zScore(zVals.small_traders.slice(0, i + 1), settings.lookback),
      commercial_hedgers: zScore(zVals.commercial_hedgers.slice(0, i + 1), settings.lookback),
    };
    const dz = Object.fromEntries(metricKeys.map(k => [k, zScore(deltas[k].slice(0, i + 1), settings.lookback)])) as Record<MetricKey, number | null>;
    const dp = Object.fromEntries(metricKeys.map(k => {
      const current = deltas[k][i], prior = deltas[k].slice(Math.max(0, i - settings.lookback), i).filter(Number.isFinite);
      return [k, i === 0 ? 0 : prior.filter(v => current > v).length / settings.lookback * 100];
    })) as Record<MetricKey, number | null>;
    const cycles = { large_traders: cycleSeries.large_traders[i], small_traders: cycleSeries.small_traders[i], commercial_hedgers: cycleSeries.commercial_hedgers[i] };
    const low = 100 - settings.confluenceThreshold;
    const bull = cycles.commercial_hedgers >= settings.confluenceThreshold && cycles.large_traders <= low && (!settings.requireSmall || cycles.small_traders <= low);
    const bear = cycles.commercial_hedgers <= low && cycles.large_traders >= settings.confluenceThreshold && (!settings.requireSmall || cycles.small_traders >= settings.confluenceThreshold);
    const zSignal = settings.zEnabled && z[selectedKey] != null && Math.abs(z[selectedKey]!) >= settings.zThreshold;
    const zBull = zSignal && (selectedKey === "commercial_hedgers" ? z[selectedKey]! > 0 : z[selectedKey]! < 0);
    const zBear = zSignal && (selectedKey === "commercial_hedgers" ? z[selectedKey]! < 0 : z[selectedKey]! > 0);
    const mode = settings.signalMode;
    const buy = mode === "Z-Score Only" ? zBull : mode === "Both (AND gate)" ? zBull && bull : bull;
    const sell = mode === "Z-Score Only" ? zBear : mode === "Both (AND gate)" ? zBear && bear : bear;
    const prevOI = raw[i - 1]?.open_interest;
    const oiMove = r.open_interest != null && prevOI != null && prevOI !== 0 ? (r.open_interest - prevOI) / prevOI * 100 : null;
    const delta = deltas[selectedKey][i];
    const selectedStd = (() => {
      const w = allVals[selectedKey].slice(Math.max(0, i - settings.lookback + 1), i + 1);
      if (w.length < settings.lookback) return null;
      const avg = mean(w);
      return Math.sqrt(w.reduce((s, v) => s + (v - avg) ** 2, 0) / settings.lookback);
    })();
    const largeMove = settings.changeEnabled && selectedStd != null && Math.abs(delta) > selectedStd * settings.zThreshold / 2;
    return {
      ...r,
      ltDelta: deltas.large_traders[i], stDelta: deltas.small_traders[i], chDelta: deltas.commercial_hedgers[i],
      ltZ: z.large_traders, stZ: z.small_traders, chZ: z.commercial_hedgers,
      ltDeltaPct: dp.large_traders, stDeltaPct: dp.small_traders, chDeltaPct: dp.commercial_hedgers,
      ltDeltaZ: dz.large_traders, stDeltaZ: dz.small_traders, chDeltaZ: dz.commercial_hedgers,
      ltCycle: cycles.large_traders, stCycle: cycles.small_traders, chCycle: cycles.commercial_hedgers,
      oiMove, buy, sell, confluenceBull: bull, confluenceBear: bear, largeMove,
      moveDirection: delta > 0 ? "Net positioning increased" : "Net positioning decreased",
    };
  });
}

export { parseSignalSettings, signalMarket } from "./signals";
export { CONSOLIDATED_COMPONENTS, CORE_GROUPS, CORE_MARKETS, HISTORY_RULES, SPECIALTY_MARKETS, coreAliases, coreMarketByCode, curatedMarketByCode } from "./core-markets";
export type { CoreGroup, CoreMarket, CoreQuality, CuratedGroup } from "./core-markets";

/** Descriptive rule extremity, never a probability or a prediction of returns. */
export function setupScore(row: CalcRow, settings: SignalSettings) {
  if (row.buy === row.sell) return 0;
  const values = row.buy
    ? [row.chCycle, 100 - row.ltCycle, ...(settings.requireSmall ? [100 - row.stCycle] : [])]
    : [100 - row.chCycle, row.ltCycle, ...(settings.requireSmall ? [row.stCycle] : [])];
  const confluence = mean(values);
  const z = settings.participant === "Large Traders" ? row.ltZ : settings.participant === "Small Traders" ? row.stZ : row.chZ;
  const zStrength = Math.min(100, Math.abs(z ?? 0) / Math.max(settings.zThreshold, 0.01) * 50);
  const score = settings.signalMode === "Z-Score Only" ? zStrength : settings.signalMode === "Both (AND gate)" ? (confluence + zStrength) / 2 : confluence;
  return Math.round(score * 10) / 10;
}
export { BENCHMARK, POSITIONING_GROUPS, POSITIONING_MARKETS, SECTOR_ETFS, SECTOR_LINKS, SECTOR_PANELS, SECTOR_WATCH, rangeLabel } from "./sectors";
export type { Momentum, PositioningMarketId, PositioningRow, RangeLabel, SectorRow, SectorsSnapshot } from "./sectors";
export { HAND_CATEGORIES, HAND_FOOTER, HAND_PARTICIPATION, HAND_POWER_PRODUCERS, HAND_RANGES, HAND_RANGE_TICKERS, HAND_TICKERS } from "./invisible-hand";
export type { CrowdedRow, HandCard, HandCardId, HandReport, HandSnapshot, ParticipationRow, RangeRow, Reading } from "./invisible-hand";
export { CALENDAR_THROUGH, EVENT_EFFECTS, eventTags, marketEvents } from "./calendar";
export type { EventKind, EventTags, MarketEvent, RangeEffect } from "./calendar";
export { CURVE_CUTOFFS, CURVE_DEPTH, CURVE_MARKETS, CURVE_VOL_EFFECT, curveCandidates, curveCarry, curveGauge, curveKind, curveSpread, curveZone, realisedVol, VOL_STATES, volGauge, volState } from "./curves";
export type { CurveContract, CurvePairHistory, CurveRow, CurveSnapshot, CurveZone, VolState } from "./curves";
export { DEMO_MARKETS, DEMO_RULES_VERSION, DEMO_STATE_VERSION, DEMO_START_BALANCE, DEMO_TARGET_SIGMA, advanceDemo, emptyDemo, stepMarket, triggerPattern, weeklySigma } from "./demo";
export type { DemoMarketState, DemoOrder, DemoPayload, DemoPosition, DemoState, DemoTrade, WeekBar } from "./demo";
