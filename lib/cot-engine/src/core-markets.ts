/**
 * Core watchlist markets and the CFTC contract each one reads.
 * Codes were checked against the CFTC's published Legacy reports for Oct 13, 2026.
 * The collector still stores every published market; this list only decides what the site leads with.
 */
export const CORE_GROUPS = [
  { id: "volatility", label: "Volatility" },
  { id: "equities", label: "Equities" },
  { id: "energies", label: "Energies" },
  { id: "metals", label: "Metals" },
  { id: "rates", label: "Fixed income" },
  { id: "currencies", label: "Currencies" },
  { id: "crypto", label: "Crypto" },
  { id: "livestock", label: "Livestock" },
  { id: "grains", label: "Grains & oilseeds" },
  { id: "softs", label: "Softs" },
] as const;

export type CoreGroup = typeof CORE_GROUPS[number]["id"];
/** good: deep and liquid; ok: usable; thin: few reporting traders or short history; unavailable: not published. */
export type CoreQuality = "good" | "ok" | "thin" | "unavailable";
export type CoreMarket = {
  symbol: string;
  group: CoreGroup;
  /** CFTC contract market code; null when the CFTC does not publish the market. */
  code: string | null;
  label: string;
  quality: CoreQuality;
  note?: string;
};

export const CORE_MARKETS: CoreMarket[] = [
  { symbol: "VX", group: "volatility", code: "1170E1", label: "VIX futures", quality: "good" },
  { symbol: "ES", group: "equities", code: "13874+", label: "S&P 500 (E-mini + micro)", quality: "good", note: "CFTC consolidated line: micros counted at one-tenth size." },
  { symbol: "NQ / MNQ", group: "equities", code: "20974+", label: "Nasdaq-100 (E-mini + micro)", quality: "good", note: "CFTC consolidated line: micros counted at one-tenth size." },
  { symbol: "YM", group: "equities", code: "12460+", label: "Dow (E-mini + micro)", quality: "ok", note: "CFTC consolidated line." },
  { symbol: "RTY", group: "equities", code: "239742", label: "Russell 2000 E-mini", quality: "good", note: "History from Aug 2017, when the contract returned to CME from ICE." },
  { symbol: "NKD", group: "equities", code: "240743", label: "Nikkei 225 (yen)", quality: "thin", note: "The dollar Nikkei (NKD) is no longer published; this is the yen contract (NIY)." },
  { symbol: "CL", group: "energies", code: "067651", label: "WTI crude (NYMEX)", quality: "good" },
  { symbol: "NG", group: "energies", code: "023651", label: "Natural gas (NYMEX)", quality: "good" },
  { symbol: "RB", group: "energies", code: "111659", label: "RBOB gasoline", quality: "good" },
  { symbol: "HO", group: "energies", code: "022651", label: "Heating oil / ULSD", quality: "good" },
  { symbol: "PL", group: "metals", code: "076651", label: "Platinum", quality: "good" },
  { symbol: "GC", group: "metals", code: "088691", label: "Gold", quality: "good" },
  { symbol: "HG", group: "metals", code: "085692", label: "Copper", quality: "good" },
  { symbol: "ALI", group: "metals", code: null, label: "Aluminum", quality: "unavailable", note: "The CFTC does not publish COMEX aluminum: too few large traders." },
  { symbol: "PA", group: "metals", code: "075651", label: "Palladium", quality: "ok" },
  { symbol: "SI", group: "metals", code: "084691", label: "Silver", quality: "good" },
  { symbol: "ZT", group: "rates", code: "042601", label: "2-year Treasury note", quality: "good" },
  { symbol: "ZF", group: "rates", code: "044601", label: "5-year Treasury note", quality: "good" },
  { symbol: "ZN", group: "rates", code: "043602", label: "10-year Treasury note", quality: "good" },
  { symbol: "ZB", group: "rates", code: "020601", label: "Treasury bond", quality: "good" },
  { symbol: "6N", group: "currencies", code: "112741", label: "New Zealand dollar", quality: "ok", note: "History from Aug 2004; earlier fragments are separated by gaps." },
  { symbol: "6A", group: "currencies", code: "232741", label: "Australian dollar", quality: "good" },
  { symbol: "6B", group: "currencies", code: "096742", label: "British pound", quality: "good" },
  { symbol: "6J", group: "currencies", code: "097741", label: "Japanese yen", quality: "good" },
  { symbol: "DX", group: "currencies", code: "098662", label: "US dollar index", quality: "ok" },
  { symbol: "6E", group: "currencies", code: "099741", label: "Euro", quality: "good", note: "History from Jan 1999; the code's 1986 rows are the old European Currency Unit." },
  { symbol: "6C", group: "currencies", code: "090741", label: "Canadian dollar", quality: "good" },
  { symbol: "6S", group: "currencies", code: "092741", label: "Swiss franc", quality: "ok" },
  { symbol: "BTC", group: "crypto", code: "133741", label: "Bitcoin (CME)", quality: "ok" },
  { symbol: "ETH", group: "crypto", code: "146021", label: "Ether (CME)", quality: "thin" },
  { symbol: "HE", group: "livestock", code: "054642", label: "Lean hogs", quality: "good" },
  { symbol: "GF", group: "livestock", code: "061641", label: "Feeder cattle", quality: "good" },
  { symbol: "LE", group: "livestock", code: "057642", label: "Live cattle", quality: "good" },
  { symbol: "ZR", group: "grains", code: "039601", label: "Rough rice", quality: "thin" },
  { symbol: "ZS", group: "grains", code: "005602", label: "Soybeans", quality: "good" },
  { symbol: "ZM", group: "grains", code: "026603", label: "Soybean meal", quality: "good" },
  { symbol: "ZL", group: "grains", code: "007601", label: "Soybean oil", quality: "good" },
  { symbol: "ZC", group: "grains", code: "002602", label: "Corn", quality: "good" },
  { symbol: "ZW", group: "grains", code: "001602", label: "Chicago wheat (SRW)", quality: "good" },
  { symbol: "OJ", group: "softs", code: "040701", label: "Orange juice", quality: "thin" },
  { symbol: "CC", group: "softs", code: "073732", label: "Cocoa", quality: "good" },
  { symbol: "KC", group: "softs", code: "083731", label: "Coffee", quality: "good" },
  { symbol: "SB", group: "softs", code: "080732", label: "Sugar No. 11", quality: "good" },
  { symbol: "CT", group: "softs", code: "033661", label: "Cotton", quality: "good" },
  { symbol: "LBR", group: "softs", code: "058644", label: "Lumber", quality: "thin", note: "New contract since Aug 2022; about three years of history." },
];

export const coreMarketByCode = new Map(CORE_MARKETS.filter(m => m.code).map(m => [m.code!, m]));
/** Extra search terms for a market's official code: its watchlist symbol and plain-English label. */
export const coreAliases = (code: string) => { const m = coreMarketByCode.get(code); return m ? `${m.symbol} ${m.label}` : ""; };

/**
 * History repairs applied when collecting by contract code, for every published market that needs one.
 * predecessors: earlier codes for the same contract (CBOT renumbered grains in Jan 1998).
 * trimBefore: drop rows before this date; the code's earlier rows belong to an unrelated or discontinued listing.
 */
export const HISTORY_RULES: Record<string, { predecessors?: string[]; trimBefore?: string }> = {
  "002602": { predecessors: ["002601"] },
  "005602": { predecessors: ["005601"] },
  "001602": { predecessors: ["001601"] },
  "099741": { trimBefore: "1999-01-01" },
  "239742": { trimBefore: "2017-08-01" },
  "112741": { trimBefore: "2004-08-01" },
};
