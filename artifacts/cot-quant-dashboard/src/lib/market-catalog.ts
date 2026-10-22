export const MARKET_SECTORS = [
  { id: "equities", label: "Equity indices" },
  { id: "rates", label: "Interest rates & credit" },
  { id: "currencies", label: "Currencies" },
  { id: "metals", label: "Metals" },
  { id: "energy", label: "Energy" },
  { id: "power", label: "Power & electricity" },
  { id: "environment", label: "Carbon & renewables" },
  { id: "grains", label: "Grains & oilseeds" },
  { id: "softs", label: "Softs & forest products" },
  { id: "livestock", label: "Livestock & dairy" },
  { id: "crypto", label: "Crypto" },
  { id: "other", label: "Other markets" },
] as const;

export type MarketSector = typeof MARKET_SECTORS[number]["id"];
export type CatalogMarket = {
  /** The exact publisher identity, including exchange; never use the display label to fetch data. */
  name: string;
  code: string;
  label: string;
  exchange: string;
  sector: MarketSector;
  searchText: string;
};

function normalize(value: string) {
  return value.toLowerCase()
    .replace(/s\s*&\s*p/g, "sp")
    .replace(/\be[\s-]?mini\b/g, "emini")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function splitName(name: string) {
  // Some instruments contain " - " internally. Only the final part is the exchange.
  const separator = name.lastIndexOf(" - ");
  return separator < 0
    ? { instrument: name, exchange: "" }
    : { instrument: name.slice(0, separator), exchange: name.slice(separator + 3) };
}

/** Internal discovery categories, not a replacement for CFTC report classifications. */
function classify(instrument: string, exchange: string): MarketSector {
  const n = instrument.toUpperCase();
  const e = exchange.toUpperCase();
  if (/COINBASE/.test(e) || /\b(BITCOIN|ETHER|ETHEREUM|SOLANA|XRP)\b/.test(n) || /^(MICRO )?SOL$/.test(n)) return "crypto";
  if (/\b(SOFR|UST|TREASURY|FED FUNDS|ERIS|EURO SHORT TERM RATE|CREDIT|DURATION.HEDGED|ADJUSTED INT RATE)\b/.test(n)) return "rates";
  if (/\b(S&P|NASDAQ|RUSSELL|DJIA|DOW JONES|MSCI|NIKKEI|VIX)\b/.test(n)) return "equities";
  if (/\b(DOLLAR|EURO FX|BRITISH POUND|JAPANESE YEN|SWISS FRANC|MEXICAN PESO|BRAZILIAN REAL|AFRICAN RAND|USD INDEX)\b/.test(n)) return "currencies";
  if (/\b(CORN|WHEAT|SOYBEAN[S]?|SOYBEAN MEAL|SOYBEAN OIL|CANOLA|RICE|OATS|PALM OIL)\b/.test(n)) return "grains";
  if (/\b(CATTLE|HOGS|PORK|MILK|BUTTER|CHEESE|WHEY)\b/.test(n)) return "livestock";
  if (/\b(COCOA|COFFEE|COTTON|SUGAR|ORANGE JUICE|LUMBER)\b/.test(n)) return "softs";
  if (/\b(GOLD|SILVER|COPPER|PLATINUM|PALLADIUM|ALUMINUM|ALUMINIUM|COBALT|LITHIUM|STEEL)\b/.test(n)) return "metals";
  if (/\b(CARBON|RECS?|SRECS?|AECS?|RINS?|RGGI|SOLAR)\b/.test(n)) return "environment";
  if (/\b(ERCOT|CAISO|MISO|PJM|NYISO|ISONE|ISO NE|NEPOOL|MID-C|PALO VERDE|SP15|AEP DAYTON|ELECTRICITY|POWER)\b/.test(n) || e === "NODAL EXCHANGE") return "power";
  if (/ICE FUTURES ENERGY/.test(e) || /\b(CRUDE|WTI|BRENT|HENRY HUB|NATURAL GAS|NAT GAS|GASOLINE|GASLNE|RBOB|ULSD|FUEL OIL|HEAT OIL|JET|HSFO|PROPANE|BUTANE|ETHANE|ETHANOL|CONDENSATE|PROPYLENE)\b/.test(n)) return "energy";
  return "other";
}

const aliasRules: { test: RegExp; aliases: string }[] = [
  { test: /S&P\s*500/i, aliases: "sp500 spx s and p 500 standard poors" },
  { test: /^E-MINI S&P 500$/i, aliases: "es es1" },
  { test: /^MICRO E-MINI S&P 500/i, aliases: "mes mes1" },
  { test: /NASDAQ/i, aliases: "nasdaq100 nasdaq 100 ndx tech stocks" },
  { test: /^NASDAQ MINI$/i, aliases: "nq nq1" },
  { test: /^MICRO E-MINI NASDAQ/i, aliases: "mnq mnq1" },
  { test: /RUSSELL.*2000|^RUSSELL E-MINI$/i, aliases: "russell2000 rut small cap stocks" },
  { test: /^RUSSELL E-MINI$/i, aliases: "rty rty1" },
  { test: /DJIA/i, aliases: "dow dow30 dow jones industrial average ym" },
  { test: /\bVIX\b/i, aliases: "volatility fear index vx" },
  { test: /^GOLD$/i, aliases: "gc gc1 xau xauusd precious metal" },
  { test: /^MICRO GOLD$/i, aliases: "mgc mgc1" },
  { test: /^SILVER$/i, aliases: "si si1 xag xagusd precious metal" },
  { test: /^COPPER/i, aliases: "hg hg1 industrial metal" },
  { test: /^PLATINUM$/i, aliases: "pl xpt" },
  { test: /^PALLADIUM$/i, aliases: "pa xpd" },
  { test: /CRUDE|WTI/i, aliases: "crude oil petroleum west texas intermediate" },
  { test: /^WTI-PHYSICAL$/i, aliases: "cl cl1" },
  { test: /\bBRENT\b/i, aliases: "brent crude oil brn" },
  { test: /HENRY HUB|\bNAT(URAL)? GAS\b/i, aliases: "natural gas natgas ng ng1" },
  { test: /RBOB|GASOLINE/i, aliases: "gasoline petrol rb" },
  { test: /ULSD|HEAT OIL/i, aliases: "heating oil diesel ho" },
  { test: /\bSOFR\b/i, aliases: "interest rates secured overnight financing sr3" },
  { test: /\bUST\b|TREASURY/i, aliases: "treasury treasuries interest rates government bonds" },
  { test: /^UST 10Y/i, aliases: "10 year ten year zn zn1" },
  { test: /^ULTRA UST 10Y/i, aliases: "10 year ten year tn" },
  { test: /UST 2Y/i, aliases: "2 year two year zt" },
  { test: /UST 5Y/i, aliases: "5 year five year zf" },
  { test: /^UST BOND/i, aliases: "30 year thirty year zb" },
  { test: /^ULTRA UST BOND/i, aliases: "30 year thirty year ub" },
  { test: /FED FUNDS/i, aliases: "federal funds interest rates zq" },
  { test: /EURO FX/i, aliases: "eur euro eurusd 6e" },
  { test: /BRITISH POUND/i, aliases: "gbp sterling cable gbpusd 6b" },
  { test: /JAPANESE YEN/i, aliases: "jpy usdjpy 6j" },
  { test: /AUSTRALIAN DOLLAR/i, aliases: "aud aussie audusd 6a" },
  { test: /CANADIAN DOLLAR/i, aliases: "cad loonie usdcad 6c" },
  { test: /SWISS FRANC/i, aliases: "chf swissy usdchf 6s" },
  { test: /NZ DOLLAR/i, aliases: "nzd new zealand kiwi nzdusd 6n" },
  { test: /USD INDEX/i, aliases: "dxy dx us dollar dollar index" },
  { test: /MEXICAN PESO/i, aliases: "mxn usdmxn" },
  { test: /BRAZILIAN REAL/i, aliases: "brl usdbrl" },
  { test: /AFRICAN RAND/i, aliases: "zar usdzar" },
  { test: /^CORN$/i, aliases: "zc zc1 maize" },
  { test: /^SOYBEANS$/i, aliases: "zs zs1 soy" },
  { test: /SOYBEAN MEAL/i, aliases: "zm soybean soymeal" },
  { test: /SOYBEAN OIL/i, aliases: "zl soybean soyoil" },
  { test: /WHEAT/i, aliases: "zw wheat grain" },
  { test: /COFFEE/i, aliases: "kc arabica" },
  { test: /COCOA/i, aliases: "cc chocolate" },
  { test: /COTTON/i, aliases: "ct" },
  { test: /SUGAR/i, aliases: "sb" },
  { test: /ORANGE JUICE/i, aliases: "oj" },
  { test: /LIVE CATTLE/i, aliases: "le beef" },
  { test: /FEEDER CATTLE/i, aliases: "gf beef" },
  { test: /LEAN HOGS/i, aliases: "he pork" },
  { test: /BITCOIN/i, aliases: "btc btcusd bitcoin" },
  { test: /\bETHER\b/i, aliases: "eth ethusd ethereum" },
  { test: /\bSOL(ANA)?\b/i, aliases: "sol solusd solana" },
  { test: /\bXRP\b/i, aliases: "ripple" },
  { test: /DOGE/i, aliases: "doge" },
];

// Avoid short discovery symbols accidentally matching substrings in exchange names.
const exactSearchTokens = new Set(["es", "mes", "nq", "mnq", "rty", "ym", "vx", "gc", "mgc", "si", "hg", "pl", "pa", "cl", "ng", "rb", "ho", "zn", "tn", "ub", "zt", "zf", "zb", "zq", "6e", "6b", "6j", "6a", "6c", "6s", "6n", "dx", "zc", "zs", "zm", "zl", "zw", "kc", "cc", "ct", "sb", "oj", "le", "gf", "he"]);

function exchangeAliases(exchange: string) {
  if (/CHICAGO MERCANTILE/i.test(exchange)) return "CME";
  if (/CHICAGO BOARD OF TRADE/i.test(exchange)) return "CBOT";
  if (/COMMODITY EXCHANGE/i.test(exchange)) return "COMEX";
  if (/NEW YORK MERCANTILE/i.test(exchange)) return "NYMEX";
  if (/CBOE FUTURES/i.test(exchange)) return "CFE CBOE";
  return exchange;
}

/** extraAliases lets callers add search terms per official code (e.g. core watchlist symbols). */
export function buildMarketCatalog(markets: { name: string; code: string }[], extraAliases?: (code: string) => string): CatalogMarket[] {
  return markets.map(market => {
    const { instrument, exchange } = splitName(market.name);
    const sector = classify(instrument, exchange);
    const aliases = [...aliasRules.filter(rule => rule.test.test(instrument)).map(rule => rule.aliases), extraAliases?.(market.code) ?? ""].join(" ");
    const sectorLabel = MARKET_SECTORS.find(item => item.id === sector)!.label;
    return {
      ...market,
      label: instrument,
      exchange,
      sector,
      searchText: normalize(`${market.name} ${market.code} ${sectorLabel} ${aliases} ${exchangeAliases(exchange)}`),
    };
  }).sort((a, b) => a.label.localeCompare(b.label) || a.exchange.localeCompare(b.exchange));
}

export function filterMarketCatalog(catalog: CatalogMarket[], query: string, sector: MarketSector | "all"): CatalogMarket[] {
  const normalizedQuery = normalize(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return catalog.filter(market => {
    if (sector !== "all" && market.sector !== sector) return false;
    const words = market.searchText.split(" ");
    return tokens.every(token => exactSearchTokens.has(token)
      ? words.includes(token)
      : market.searchText.includes(token));
  }).sort((a, b) => {
    if (!normalizedQuery) return 0;
    const rank = (market: CatalogMarket) => {
      const label = normalize(market.label);
      return label === normalizedQuery ? 0 : label.startsWith(normalizedQuery) ? 1 : label.includes(normalizedQuery) ? 2 : 3;
    };
    return rank(a) - rank(b);
  });
}
