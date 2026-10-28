import assert from "node:assert/strict";
import test from "node:test";
import { tally, ultimateOscillator, updateCaseLog, uoPullback, williamsR, wrPullback, type Bars, type CaseInput } from "@workspace/cot-engine";

/** Daily bars from a list of closes (high/low 1 either side), dated consecutive weekdays from `start`. */
function bars(closes: number[], start = "2026-06-01"): Bars {
  const dates: string[] = [];
  let t = Date.parse(`${start}T00:00:00Z`);
  while (dates.length < closes.length) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) dates.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return { dates, close: closes, high: closes.map(c => c + 1), low: closes.map(c => c - 1) };
}

test("Williams %R and the Ultimate Oscillator follow their published formulas", () => {
  const up = bars(Array.from({ length: 40 }, (_, i) => 100 + i));
  assert.ok(Math.abs(williamsR(up, 39)! - (-1 / 15 * 100)) < 1e-9, "close 1 below the 14-day high of a steady rise");
  const down = bars(Array.from({ length: 40 }, (_, i) => 200 - i));
  assert.ok(williamsR(down, 39)! < -90, "near the low of a steady fall");
  assert.equal(williamsR(up, 5), null, "needs 14 bars");
  // steady +1 rise: buying pressure = close - min(low, prev close) = 1, true range = max(high, prev close) - min(low, prev close) = 2
  assert.ok(Math.abs(ultimateOscillator(up, 39)! - 50) < 1e-9);
  assert.equal(ultimateOscillator(up, 20), null, "needs 28 bars");
  assert.equal(uoPullback(1, 25), true); assert.equal(uoPullback(1, 50), false); assert.equal(uoPullback(-1, 75), true); assert.equal(uoPullback(0, 25), null);
  assert.equal(wrPullback(1, -85), true); assert.equal(wrPullback(-1, -10), true); assert.equal(wrPullback(-1, -50), false);
});

test("Case log: a case is added once its release Friday closes, and gets its outcome a week later", () => {
  // 300 weekdays of a gentle rise from 2025-06-02, then the report Tuesday 2026-07-14 -> release Friday 2026-07-17
  const b = bars(Array.from({ length: 300 }, (_, i) => 100 + i * 0.1), "2025-06-02");
  const input: CaseInput = { code: "X", symbol: "XX", reportDate: "2026-07-14", dir: 1, z: 2.6, commercialCycle: 90, largeCycle: 10, bars: b };
  const early = updateCaseLog(null, [input], "2026-07-16", "2026-07-01");
  assert.equal(early.cases.length, 0, "not before the release Friday's close is final");
  const added = updateCaseLog(early, [input], "2026-07-17", "2026-07-01");
  assert.equal(added.cases.length, 1);
  assert.equal(added.cases[0].releaseFriday, "2026-07-17");
  assert.equal(added.cases[0].outcome, undefined, "no outcome yet");
  assert.equal(updateCaseLog(added, [input], "2026-07-17", "2026-07-01").cases.length, 1, "never added twice");
  const done = updateCaseLog(added, [input], "2026-07-24", "2026-07-01");
  const c = done.cases[0];
  assert.equal(c.outcome?.date, "2026-07-24");
  assert.ok(c.outcome!.wentItsWay && c.outcome!.movePct > 0, "a long in a rising market went its way");
  assert.deepEqual(tally(done.cases), { cases: 1, done: 1, wentItsWay: 1, avgMoveVol: c.outcome!.moveVol });
  const before = updateCaseLog(null, [{ ...input, reportDate: "2026-06-30" }], "2026-07-24", "2026-07-01");
  assert.equal(before.cases.length, 0, "reports before the start are never logged");
  const flat = updateCaseLog(null, [{ ...input, dir: 0 }], "2026-07-24", "2026-07-01");
  assert.equal(flat.cases.length, 0, "no reading, no case");
});

test("Case log waits for the real release-Friday close (an empty Friday bar is not replaced by Thursday's)", () => {
  const b = bars(Array.from({ length: 300 }, (_, i) => 100 + i * 0.1), "2025-06-02");
  const fri = b.dates.indexOf("2026-07-17");
  const missingFriday: Bars = { dates: b.dates.slice(0, fri), close: b.close.slice(0, fri), high: b.high.slice(0, fri), low: b.low.slice(0, fri) };
  const input: CaseInput = { code: "X", symbol: "XX", reportDate: "2026-07-14", dir: 1, z: 2.6, commercialCycle: 90, largeCycle: 10, bars: missingFriday };
  assert.equal(updateCaseLog(null, [input], "2026-07-17", "2026-07-01").cases.length, 0, "Friday's close not in the data yet: wait");
  const withFriday = updateCaseLog(null, [{ ...input, bars: b }], "2026-07-17", "2026-07-01");
  assert.equal(withFriday.cases[0].entry, b.close[fri], "entry is the Friday close");
  // a holiday Friday: no bar that day, but the market traded the next Monday, so the Thursday close stands in
  const holiday: Bars = { dates: [...b.dates.slice(0, fri), ...b.dates.slice(fri + 1)], close: [...b.close.slice(0, fri), ...b.close.slice(fri + 1)],
    high: [...b.high.slice(0, fri), ...b.high.slice(fri + 1)], low: [...b.low.slice(0, fri), ...b.low.slice(fri + 1)] };
  assert.equal(updateCaseLog(null, [{ ...input, bars: holiday }], "2026-07-20", "2026-07-01").cases[0].entry, b.close[fri - 1]);
});
