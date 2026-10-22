/**
 * The Invisible Hand: weekly macro backdrop (Spec v2 theme cards + participation rows). Numbers only here;
 * the weekly read is written separately. Every reading describes current conditions, never what comes next.
 */
export type HandReport = "tff" | "disagg" | "legacy";
export type HandCardId = "credit" | "rates" | "power" | "volatility" | "ai";

/** Participation rows: who is active in each theme and how crowded (Spec v2, "Positioning as participation"). */
export const HAND_PARTICIPATION = [
  { card: "rates", market: "SOFR-3M", report: "tff", code: "134741", categories: ["leveraged funds", "asset managers"] },
  { card: "rates", market: "Fed Funds", report: "tff", code: "045601", categories: ["leveraged funds", "asset managers"] },
  { card: "rates", market: "UST 2Y", report: "tff", code: "042601", categories: ["leveraged funds", "asset managers"] },
  { card: "rates", market: "UST 10Y", report: "tff", code: "043602", categories: ["leveraged funds", "asset managers"] },
  { card: "power", market: "Henry Hub NG", report: "disagg", code: "023651", categories: ["managed money", "producer/merchant"] },
  { card: "volatility", market: "VIX futures", report: "tff", code: "1170E1", categories: ["leveraged funds", "asset managers", "dealers"] },
  { card: "volatility", market: "E-mini S&P 500", report: "tff", code: "13874A", categories: ["dealers", "asset managers"] },
  { card: "volatility", market: "JPY (carry context)", report: "legacy", code: "097741", categories: ["large specs"] },
] as const satisfies readonly { card: HandCardId; market: string; report: HandReport; code: string; categories: readonly string[] }[];

/** CFTC field stems per category: positions `${long}`/`${short}`, trader counts `traders_${key}_long_all`. */
export const HAND_CATEGORIES: Record<HandReport, Record<string, { long: string; short: string; key: string }>> = {
  tff: {
    "leveraged funds": { long: "lev_money_positions_long", short: "lev_money_positions_short", key: "lev_money" },
    "asset managers": { long: "asset_mgr_positions_long", short: "asset_mgr_positions_short", key: "asset_mgr" },
    "dealers": { long: "dealer_positions_long_all", short: "dealer_positions_short_all", key: "dealer" },
  },
  disagg: {
    "producer/merchant": { long: "prod_merc_positions_long", short: "prod_merc_positions_short", key: "prod_merc" },
    "managed money": { long: "m_money_positions_long_all", short: "m_money_positions_short_all", key: "m_money" },
  },
  legacy: {
    "large specs": { long: "noncomm_positions_long_all", short: "noncomm_positions_short_all", key: "noncomm" },
  },
};

/** Power producers basket for the AI power gauge (equal-weight, each in excess of SPY). */
export const HAND_POWER_PRODUCERS = ["NRG", "VST", "CEG"] as const;
export const HAND_TICKERS = ["SPY", "SMH", ...HAND_POWER_PRODUCERS, "XLK", "XLU", "HYG", "IEF", "^VIX", "^VIX3M"] as const;

export type ParticipationRow = {
  card: HandCardId; market: string; category: string; code: string; reportDate: string;
  /** null when withheld by the thin-market rule. */
  netPct: number | null; longPct: number | null; shortPct: number | null; pct3y: number | null; chg4w: number | null;
  tradersLong: number | null; tradersShort: number | null; top4Long: number | null; top4Short: number | null;
  withheld: boolean;
};

export type Reading = { label: string; value: string; note?: string };
export type HandCard = {
  id: HandCardId; title: string;
  /** Discrete label where the card has one that passed its stability test; null otherwise. */
  state: string | null;
  /** "live" = computed this run; "pending" = waiting on a data source (reason given). */
  status: "live" | "pending";
  pendingReason?: string;
  headline: string; mechanism: string; sectorLine: string;
  readings: Reading[];
};

export type HandSnapshot = {
  version: 1; generatedAt: string; priceSource: string;
  positioningAsOf: string; pricesAsOf: string; yieldsAsOf: string | null;
  cards: HandCard[];
  participation: ParticipationRow[];
};

export const HAND_FOOTER = "Describes current conditions and what happened alongside them historically. Not a forecast or a trading signal.";
