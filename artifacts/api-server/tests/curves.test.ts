import assert from "node:assert/strict";
import test from "node:test";
import { CURVE_MARKETS, DEMO_MARKETS, curveCandidates, curveCarry, curveGauge, curveZone, realisedVol } from "@workspace/cot-engine";

const market = (symbol: string) => CURVE_MARKETS.find(m => m.symbol === symbol)!;

test("Curve candidates follow each market's listed months, from this month on, across the year end", () => {
  assert.deepEqual(curveCandidates(market("ES"), "2026-10-22", 3).map(c => c.ticker), ["ESZ26.CME", "ESH27.CME", "ESM27.CME"]);
  assert.deepEqual(curveCandidates(market("CL"), "2026-11-30", 3).map(c => c.month), ["202611", "202612", "202701"]);
  assert.deepEqual(curveCandidates(market("SB"), "2026-10-22", 2).map(c => c.ticker), ["SBV26.NYB", "SBH27.NYB"]);
  assert.equal(curveCandidates(market("GC"), "2026-10-01", 1)[0].ticker, "GCV26.CMX", "the current month is a candidate; the job drops it once expired");
});

test("Carry is ln(near / far) per year: positive in backwardation, negative in contango", () => {
  const c = (month: string, close: number) => ({ month, ticker: "", date: "2026-10-22", close });
  assert.ok(Math.abs(curveCarry([c("202612", 110), c("202701", 100)])! - Math.log(1.1) * 12) < 1e-9, "one month apart, backwardation");
  assert.ok(curveCarry([c("202612", 100), c("202703", 101)])! < 0, "contango");
  assert.equal(curveCarry([c("202612", 100)]), null, "needs two contracts");
});

test("Every demo-account market has a curve entry", () => {
  const curve = new Set(CURVE_MARKETS.map(m => m.symbol));
  const missing = DEMO_MARKETS.filter(m => !curve.has(m.symbol)).map(m => m.symbol);
  assert.deepEqual(missing, []);
});

test("Gauge and zones place carry within the market's own history", () => {
  // Crude cutoffs: 5th -0.17, 20th -0.073, 80th 0.096, 95th 0.168.
  assert.equal(curveZone("CL", 0.2), "deep-backwardation");
  assert.equal(curveZone("CL", 0), "normal");
  assert.equal(curveZone("CL", -0.1), "deep-contango");
  assert.equal(curveZone("LBR", 0.1), null, "no history, no zone");
  assert.ok(Math.abs(curveGauge("CL", 0.096)! - 0.8) < 1e-9);
  assert.ok(Math.abs(curveGauge("CL", -0.073)! - 0.2) < 1e-9);
  assert.equal(curveGauge("CL", 5), 1, "clamped");
  // Gold is almost always in contango: a near-flat gold curve is deep backwardation for gold.
  assert.equal(curveZone("GC", 0), "deep-backwardation");
});

test("Realised vol: annualised from daily log moves; too little data gives null", () => {
  const v = realisedVol([100, ...Array.from({ length: 20 }, (_, i) => (i % 2 ? 100 : 101))]);
  assert.ok(v != null && v > 0.1 && v < 0.2, `alternating 1% moves ≈ 16% a year, got ${v}`);
  assert.equal(realisedVol([100, 101, 100, 101, 100]), null);
});
