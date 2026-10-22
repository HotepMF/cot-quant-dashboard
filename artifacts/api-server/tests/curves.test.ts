import assert from "node:assert/strict";
import test from "node:test";
import { CURVE_MARKETS, DEMO_MARKETS, curveCandidates, curveCarry } from "@workspace/cot-engine";

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
