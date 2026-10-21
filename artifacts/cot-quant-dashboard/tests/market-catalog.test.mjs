import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketCatalog, filterMarketCatalog } from "../src/lib/market-catalog.ts";

const fixture = [
  ["E-MINI S&P 500", "CHICAGO MERCANTILE EXCHANGE", "equities"],
  ["UST 10Y NOTE", "CHICAGO BOARD OF TRADE", "rates"],
  ["EURO FX", "CHICAGO MERCANTILE EXCHANGE", "currencies"],
  ["GOLD", "COMMODITY EXCHANGE INC.", "metals"],
  ["WTI-PHYSICAL", "NEW YORK MERCANTILE EXCHANGE", "energy"],
  ["SOYBEAN OIL", "CHICAGO BOARD OF TRADE", "grains"],
  ["USD Malaysian Crude Palm Oil C", "CHICAGO MERCANTILE EXCHANGE", "grains"],
  ["PJM WESTERN HUB DA PEAK", "ICE FUTURES ENERGY DIV", "power"],
  ["PJM TRI-RECs CLASS 1", "ICE FUTURES ENERGY DIV", "environment"],
  ["CALIF CARBON ALL VINTAGE 2026", "ICE FUTURES ENERGY DIV", "environment"],
  ["SUGAR NO. 11", "ICE FUTURES U.S.", "softs"],
  ["MILK, Class III", "CHICAGO MERCANTILE EXCHANGE", "livestock"],
  ["PAX GOLD PERP STYLE", "COINBASE DERIVATIVES, LLC", "crypto"],
  ["MICRO SOL", "CHICAGO MERCANTILE EXCHANGE", "crypto"],
  ["DOMINION - SOUTH POINT (BASIS)", "ICE FUTURES ENERGY DIV", "energy"],
];
const markets = fixture.map(([label, exchange], index) => ({ name: `${label} - ${exchange}`, code: String(index) }));
const catalog = buildMarketCatalog(markets);

test("classifies instruments without confusing energy, currencies, or crypto names", () => {
  for (const [label, , sector] of fixture) {
    assert.equal(catalog.find(market => market.label === label)?.sector, sector, label);
  }
});
test("preserves exact publisher names and splits only the final exchange separator", () => {
  const market = catalog.find(market => market.label.startsWith("DOMINION"));
  assert.equal(market.name, "DOMINION - SOUTH POINT (BASIS) - ICE FUTURES ENERGY DIV");
  assert.equal(market.label, "DOMINION - SOUTH POINT (BASIS)");
  assert.equal(market.exchange, "ICE FUTURES ENERGY DIV");
});
test("finds common names, discovery symbols, exchange abbreviations and official codes", () => {
  for (const [query, expected] of [
    ["S&P 500", "E-MINI S&P 500"], ["SP500", "E-MINI S&P 500"], ["ES", "E-MINI S&P 500"],
    ["GC", "GOLD"], ["crude oil", "WTI-PHYSICAL"], ["CL", "WTI-PHYSICAL"],
    ["10 year", "UST 10Y NOTE"], ["EURUSD", "EURO FX"],
  ]) {
    assert.ok(filterMarketCatalog(catalog, query, "all").some(market => market.label === expected), query);
  }
  assert.ok(filterMarketCatalog(catalog, "COMEX", "all").some(market => market.label === "GOLD"));
  assert.equal(filterMarketCatalog(catalog, "ES", "all").length, 1);
  assert.equal(filterMarketCatalog(catalog, "3", "metals")[0]?.label, "GOLD");
});
test("combines search and sector and leaves the input catalog unchanged", () => {
  const before = JSON.stringify(catalog);
  assert.equal(filterMarketCatalog(catalog, "gold", "metals").length, 1);
  assert.equal(filterMarketCatalog(catalog, "gold", "energy").length, 0);
  assert.equal(filterMarketCatalog(catalog, "nonexistent", "all").length, 0);
  assert.equal(filterMarketCatalog(catalog, "", "all").length, fixture.length);
  assert.equal(JSON.stringify(catalog), before);
});
test("does not assign discovery symbols to similarly named but different instruments", () => {
  const variants = buildMarketCatalog([
    { name: "EMINI RUSSELL 1000 VALUE INDEX - CHICAGO MERCANTILE EXCHANGE", code: "a" },
    { name: "MT BELV NAT GASOLINE OPIS - NEW YORK MERCANTILE EXCHANGE", code: "b" },
    { name: "ULTRA UST 10Y - CHICAGO BOARD OF TRADE", code: "c" },
    { name: "DOW JONES U.S. REAL ESTATE IDX - CHICAGO BOARD OF TRADE", code: "d" },
  ]);
  for (const query of ["russell2000", "ng", "zn", "ym"]) {
    assert.equal(filterMarketCatalog(variants, query, "all").length, 0, query);
  }
});
