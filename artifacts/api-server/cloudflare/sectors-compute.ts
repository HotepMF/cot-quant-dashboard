import {
  BENCHMARK, POSITIONING_GROUPS, POSITIONING_MARKETS, SECTOR_ETFS, SECTOR_PANELS, rangeLabel,
  type Momentum, type PositioningRow, type SectorRow, type SectorsSnapshot,
} from "@workspace/cot-engine";
import type { DailyCloses, PositioningHistory, YieldSeries } from "./sectors-sources";

/** Same windows as the research: z of the L-week relative move against its trailing 156 weeks (min 104). */
const Z_WEEKS = 156, Z_MIN = 104, SPARK_WEEKS = 27;
const DAYS = { d1: 1, w1: 5, m1: 21, m3: 63, y1: 252 } as const;

const round = (v: number | null, d = 2) => v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

/** ln(ticker / benchmark) on the dates both traded. */
export function relativeSeries(asset: DailyCloses, bench: DailyCloses) {
  const b = new Map(bench.dates.map((d, i) => [d, bench.closes[i]]));
  const dates: string[] = [], rel: number[] = [];
  asset.dates.forEach((d, i) => { const x = b.get(d); if (x) { dates.push(d); rel.push(Math.log(asset.closes[i] / x)); } });
  return { dates, rel };
}

/** Last value of each Monday-to-Sunday week; the current week may be partial. */
export function weeklyLast(dates: string[], values: number[]) {
  const out: { week: string; date: string; value: number }[] = [];
  dates.forEach((d, i) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    const monday = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    if (out.length && out[out.length - 1].week === monday) out[out.length - 1] = { week: monday, date: d, value: values[i] };
    else out.push({ week: monday, date: d, value: values[i] });
  });
  return out;
}

export function latestZ(weekly: number[], lag: number) {
  const t = weekly.length - 1;
  if (t - lag < 0) return null;
  const moves: number[] = [];
  for (let i = Math.max(lag, t - Z_WEEKS + 1); i <= t; i++) moves.push(weekly[i] - weekly[i - lag]);
  if (moves.length < Z_MIN) return null;
  const mean = moves.reduce((a, b) => a + b, 0) / moves.length;
  const sd = Math.sqrt(moves.reduce((a, b) => a + (b - mean) ** 2, 0) / moves.length);
  if (!sd) return 0;
  return Math.max(-4, Math.min(4, (moves[moves.length - 1] - mean) / sd));
}

/** Last 4 weeks vs the sector's own norm: >= +0.5 sigma rising, <= -0.5 falling; qualifier against the 3-month move. */
export function momentum(z4: number | null, rel3m: number | null): Momentum | null {
  if (z4 == null || rel3m == null) return null;
  if (z4 >= 0.5) return { arrow: "▲", word: "Rising", qualifier: rel3m < 0 ? "turning up" : "gaining" };
  if (z4 <= -0.5) return { arrow: "▼", word: "Falling", qualifier: rel3m > 0 ? "fading" : "still falling" };
  return { arrow: "►", word: "Flat", qualifier: "steady" };
}

export function sectorRow(ticker: string, name: string, asset: DailyCloses, bench: DailyCloses): SectorRow {
  const { dates, rel } = relativeSeries(asset, bench);
  const ret = (n: number) => rel.length > n ? (Math.exp(rel[rel.length - 1] - rel[rel.length - 1 - n]) - 1) * 100 : null;
  const weekly = weeklyLast(dates, rel).map(w => w.value);
  const r = { d1: ret(DAYS.d1), w1: ret(DAYS.w1), m1: ret(DAYS.m1), m3: ret(DAYS.m3), y1: ret(DAYS.y1) };
  const z = { w4: latestZ(weekly, 4), w13: latestZ(weekly, 13), w52: latestZ(weekly, 52) };
  return {
    ticker, name,
    rel: { d1: round(r.d1), w1: round(r.w1), m1: round(r.m1), m3: round(r.m3), y1: round(r.y1) },
    z: { w4: round(z.w4), w13: round(z.w13), w52: round(z.w52) },
    momentum: momentum(z.w4, r.m3),
    spark: weekly.slice(-SPARK_WEEKS).map(v => round(v, 5)!),
  };
}

export function positioningRow(market: typeof POSITIONING_MARKETS[number], history: PositioningHistory, price?: DailyCloses): PositioningRow {
  const last = history.slice(-157);
  const now = last[last.length - 1];
  const pct = (key: "fundsNetPct" | "otherNetPct") => last.filter(r => r[key] <= now[key]).length / last.length * 100;
  const fundsPct3y = pct("fundsNetPct");
  let price13w: number | null = null;
  if (price) {
    const weekly = weeklyLast(price.dates, price.closes).map(w => w.value);
    if (weekly.length > 13) price13w = (weekly[weekly.length - 1] / weekly[weekly.length - 14] - 1) * 100;
  }
  return {
    id: market.id, label: market.label, symbol: market.symbol, code: market.code, report: market.report, reportDate: now.date,
    fundsNetPct: round(now.fundsNetPct, 1)!, fundsPct3y: Math.round(fundsPct3y), otherPct3y: Math.round(pct("otherNetPct")),
    fundsChg4w: round(now.fundsNetPct - history[history.length - 5].fundsNetPct, 1)!,
    label3y: rangeLabel(fundsPct3y), price13w: round(price13w, 1),
  };
}

function yieldChange(series: YieldSeries) {
  const last = series[series.length - 1];
  const cutoff = Date.parse(`${last.date}T00:00:00Z`) - 91 * 86_400_000;
  const before = [...series].reverse().find(r => Date.parse(`${r.date}T00:00:00Z`) <= cutoff);
  return { value: last.value, date: last.date, chg: before ? Math.round((last.value - before.value) * 100) : 0 };
}

const signed = (v: number | null, d = 1, unit = "") => v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}${unit}`;
const ordinal = (p: number) => `${p}${p % 100 >= 11 && p % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[p % 10] ?? "th"}`;
const rangeWords: Record<string, string> = {
  "Crowded · top": "crowded at the top of its 3-year range", "High": "high in its 3-year range",
  "Low": "low in its 3-year range", "Crowded · bottom": "crowded at the bottom of its 3-year range",
};

/** Rule-based panel text: facts from the snapshot only, no forecasts. */
export function panels(sectors: SectorRow[], positioning: PositioningRow[], yields: SectorsSnapshot["yields"]): SectorsSnapshot["panels"] {
  const bySector = new Map(sectors.map(s => [s.ticker, s]));
  const byMarket = new Map(positioning.map(p => [p.id, p]));
  return SECTOR_PANELS.map(panel => {
    const rows = panel.tickers.map(t => bySector.get(t)).filter((s): s is SectorRow => !!s);
    const headline = rows.map(s => signed(s.rel.m3, 1, "%")).join(" / ") + " vs SPY · 3 mo";
    const read: string[] = [];
    read.push(rows.map(s => {
      const z = s.z.w13 != null && Math.abs(s.z.w13) >= 1 ? ` (${signed(s.z.w13, 1)}σ vs its norm)` : "";
      return `${s.name}: ${signed(s.rel.m3, 1, "%")} vs SPY over 3 months${z}`;
    }).join("; ") + ".");
    const markets = panel.markets.map(id => byMarket.get(id)).filter((p): p is PositioningRow => !!p);
    const priced = markets.filter(m => m.price13w != null);
    if (priced.length) read.push(`Futures over 13 weeks: ${priced.map(m => `${m.label} ${signed(m.price13w, 1, "%")}`).join(", ")}.`);
    if (panel.id === "utilities-rates" && yields) read.push(`10-year yield ${yields.y10.toFixed(2)}% (${signed(yields.y10chg13w, 0, " bp")} in 13 weeks); 2-year ${yields.y2.toFixed(2)}% (${signed(yields.y2chg13w, 0, " bp")}).`);
    const notable = markets.filter(m => m.label3y !== "Mid-range");
    if (markets.length) read.push(notable.length
      ? notable.map(m => `${m.label}: the ${POSITIONING_GROUPS[m.report].funds.toLowerCase()} position is ${rangeWords[m.label3y]} (${ordinal(m.fundsPct3y)} percentile)`).join("; ") + "."
      : "Fund positioning is mid-range in every linked market.");
    return { id: panel.id, title: panel.title, headline, read, note: panel.note };
  });
}

export type SectorsInputs = {
  generatedAt: string; priceSource: string;
  prices: Map<string, DailyCloses>;
  positioning: Map<string, PositioningHistory>;
  y10: YieldSeries | null; y2: YieldSeries | null;
};

export function buildSnapshot(input: SectorsInputs): SectorsSnapshot {
  const bench = input.prices.get(BENCHMARK);
  if (!bench) throw new Error("Benchmark prices are missing.");
  const sectors = SECTOR_ETFS.map(s => {
    const p = input.prices.get(s.ticker);
    if (!p) throw new Error(`Prices are missing for ${s.ticker}.`);
    return sectorRow(s.ticker, s.name, p, bench);
  }).sort((a, b) => (b.rel.m3 ?? -Infinity) - (a.rel.m3 ?? -Infinity));
  const positioning = POSITIONING_MARKETS.map(m => {
    const h = input.positioning.get(m.id);
    if (!h) throw new Error(`Positioning is missing for ${m.id}.`);
    return positioningRow(m, h, m.priceTicker ? input.prices.get(m.priceTicker) : undefined);
  });
  let yields: SectorsSnapshot["yields"] = null;
  if (input.y10?.length && input.y2?.length) {
    const a = yieldChange(input.y10), b = yieldChange(input.y2);
    yields = { y10: a.value, y10chg13w: a.chg, y2: b.value, y2chg13w: b.chg, asOf: a.date };
  }
  return {
    version: 1, generatedAt: input.generatedAt, priceSource: input.priceSource,
    pricesAsOf: bench.dates[bench.dates.length - 1],
    positioningAsOf: positioning.map(p => p.reportDate).sort().at(-1)!,
    sectors, positioning, yields, panels: panels(sectors, positioning, yields),
  };
}
