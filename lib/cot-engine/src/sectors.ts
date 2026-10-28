/**
 * Sectors page: SPDR sector ETFs relative to SPY, and the futures positioning underneath them.
 * Prices refresh daily; positioning weekly with each CFTC report. Context, not signals.
 */
export const SECTOR_ETFS = [
  { ticker: "XLE", name: "Energy" }, { ticker: "XLV", name: "Health care" }, { ticker: "XLK", name: "Technology" },
  { ticker: "XLP", name: "Staples" }, { ticker: "XLB", name: "Materials" }, { ticker: "XLC", name: "Communication" },
  { ticker: "XLF", name: "Financials" }, { ticker: "XLY", name: "Discretionary" }, { ticker: "XLU", name: "Utilities" },
  { ticker: "XLI", name: "Industrials" }, { ticker: "XLRE", name: "Real estate" },
] as const;
export const BENCHMARK = "SPY";

/** Positioning series, read from the CFTC Disaggregated ("disagg") or Traders in Financial Futures ("tff") report. */
export const POSITIONING_MARKETS = [
  { id: "crude", label: "WTI crude", symbol: "CL", code: "067651", report: "disagg", priceTicker: "CL=F" },
  { id: "ulsd", label: "Diesel (ULSD)", symbol: "HO", code: "022651", report: "disagg", priceTicker: "HO=F" },
  { id: "natgas", label: "Natural gas", symbol: "NG", code: "023651", report: "disagg", priceTicker: "NG=F" },
  { id: "rbob", label: "Gasoline", symbol: "RB", code: "111659", report: "disagg", priceTicker: "RB=F" },
  { id: "copper", label: "Copper", symbol: "HG", code: "085692", report: "disagg", priceTicker: "HG=F" },
  { id: "gold", label: "Gold", symbol: "GC", code: "088691", report: "disagg", priceTicker: "GC=F" },
  { id: "nasdaq", label: "Nasdaq-100", symbol: "NQ", code: "20974+", report: "tff", priceTicker: "NQ=F" },
  { id: "pjm", label: "PJM West power", symbol: "PJM", code: "0643DF", report: "disagg", priceTicker: null },
  { id: "sofr", label: "SOFR 3-month", symbol: "SR3", code: "134741", report: "tff", priceTicker: null },
  { id: "ust10y", label: "10-year Treasury", symbol: "ZN", code: "043602", report: "tff", priceTicker: null },
] as const;
export type PositioningMarketId = typeof POSITIONING_MARKETS[number]["id"];

/** Which group is "funds" and which is "other" in each report. */
export const POSITIONING_GROUPS = {
  disagg: { funds: "Managed money", other: "Producers" },
  tff: { funds: "Leveraged funds", other: "Asset managers" },
} as const;

/** Sector panels: which ETFs, which futures underneath, and a fixed context note. */
export const SECTOR_PANELS = [
  { id: "energy", title: "Energy", tickers: ["XLE"], markets: ["crude", "ulsd", "natgas", "rbob"], note: "" },
  { id: "industrials-materials", title: "Industrials · Materials", tickers: ["XLI", "XLB"], markets: ["copper", "gold"], note: "Copper is a loose link for industrials, which are mostly aerospace, machinery and transportation companies." },
  { id: "utilities-rates", title: "Utilities · Rates", tickers: ["XLU", "XLRE", "XLF"], markets: ["pjm", "natgas", "sofr", "ust10y"], note: "Treasury futures positioning mostly reflects the basis trade, so it is shown but not read as a sector signal." },
  { id: "tech-communication", title: "Tech · Communication", tickers: ["XLK", "XLC"], markets: ["nasdaq"], note: "The Nasdaq-100 holds communication's biggest names but much else too, so that link is partial." },
  { id: "no-link", title: "No clean futures link", tickers: ["XLV", "XLP", "XLY"], markets: [], note: "No futures market maps cleanly onto health care, staples or discretionary, so they are shown on price only." },
] as const;

/**
 * "Watch" notes: co-movement between the site's default COT filter (AND gate, OI-normalised Z, 16 weeks) on linked
 * futures and the sector vs SPY, 2002-2026 (backtest/indicator_grid/sector_links.py). Observed, not validated.
 */
export const SECTOR_WATCH: Partial<Record<typeof SECTOR_PANELS[number]["id"], string>> = {
  energy: "Tested on the site's previous default (AND gate on commercials, 16-week OI-normalized Z), not today's 8-week reading: when it reached a commercial extreme long or short on crude, gasoline or natural gas, XLE tended to move the same way versus SPY over the next 4 to 13 weeks (natural gas: +2.3% over 4 weeks; gasoline: +1.5%). About 30 cases per market since 2002, and these markets often reach extremes together.",
  "utilities-rates": "Tested on the site's previous default (AND gate on commercials, 16-week OI-normalized Z), not today's 8-week reading: when it reached a commercial extreme long on natural gas, XLU tended to lag SPY (about −1.7% over 4 weeks), the opposite of what we expected; higher gas is a fuel cost for utilities. About 30 cases since 2002.",
};

/** Futures shown in each sector's matrix row ("underneath"); sectors not listed have no clean link. */
export const SECTOR_LINKS: Record<string, PositioningMarketId[]> = {
  XLE: ["crude", "ulsd", "natgas", "rbob"], XLB: ["copper", "gold"], XLI: ["copper"], XLU: ["pjm", "natgas"],
  XLRE: ["ust10y"], XLF: ["sofr"], XLK: ["nasdaq"], XLC: ["nasdaq"],
};

export type RangeLabel = "Crowded · top" | "High" | "Mid-range" | "Low" | "Crowded · bottom";
/** Funds' 3-year percentile: >= 90 or <= 10 crowded, 80-90 high, 10-20 low. Descriptive only. */
export const rangeLabel = (pct: number): RangeLabel =>
  pct >= 90 ? "Crowded · top" : pct >= 80 ? "High" : pct <= 10 ? "Crowded · bottom" : pct <= 20 ? "Low" : "Mid-range";

export type Momentum = { arrow: "▲" | "►" | "▼"; word: "Rising" | "Flat" | "Falling"; qualifier: "gaining" | "turning up" | "fading" | "still falling" | "steady" };

export type SectorRow = {
  ticker: string; name: string;
  /** Relative to SPY, percent, over 1 day, 1 week (5 days), 1 month (21), 3 months (63), 1 year (252 trading days). */
  rel: { d1: number | null; w1: number | null; m1: number | null; m3: number | null; y1: number | null };
  /** z-score of the 4-, 13- and 52-week relative move against its trailing 156 weeks. */
  z: { w4: number | null; w13: number | null; w52: number | null };
  momentum: Momentum | null;
  /** ln(sector / SPY) on the last 27 weekly closes, the latest week possibly partial. */
  spark: number[];
};
export type PositioningRow = {
  id: PositioningMarketId; label: string; symbol: string; code: string; report: "disagg" | "tff"; reportDate: string;
  fundsNetPct: number; fundsPct3y: number; fundsChg4w: number; otherPct3y: number; label3y: RangeLabel;
  /** Front-month futures, 13 weeks, percent; null where no price series is used. */
  price13w: number | null;
};
export type SectorsSnapshot = {
  version: 1;
  generatedAt: string;
  pricesAsOf: string;
  positioningAsOf: string;
  priceSource: string;
  sectors: SectorRow[];
  positioning: PositioningRow[];
  yields: { y10: number; y10chg13w: number; y2: number; y2chg13w: number; asOf: string } | null;
  panels: { id: string; title: string; headline: string; read: string[]; note: string }[];
};
