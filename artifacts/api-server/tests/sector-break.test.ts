import assert from "node:assert/strict";
import test from "node:test";
import { breakTally, nyEpoch, sessionEnd, updateSectorBreakLog, type IntradayBars, type SectorBreakInput } from "@workspace/cot-engine";

const STEP = 15 * 60_000;
/** 15-minute bars from W0's start through W1, flat at `base`, then each market's own path from `from` onwards. */
function bars(w1Start: number, base: number, path: (k: number) => number, from: number): IntradayBars {
  const out: IntradayBars = { times: [], close: [] };
  for (let t = w1Start - 7 * 86_400_000, k = 0; t < w1Start + 7 * 86_400_000; t += STEP) {
    out.times.push(t);
    out.close.push(t < from ? base + (k++ % 2) * 0.1 : path((t - from) / STEP));
  }
  return out;
}

test("New York session boundaries follow daylight saving", () => {
  assert.equal(new Date(nyEpoch("2026-07-17", 17)).toISOString(), "2026-07-17T21:00:00.000Z");
  assert.equal(new Date(nyEpoch("2026-12-18", 17)).toISOString(), "2026-12-18T22:00:00.000Z");
  assert.equal(new Date(sessionEnd(Date.parse("2026-07-20T14:00:00Z"))).toISOString(), "2026-07-20T21:00:00.000Z");
  assert.equal(new Date(sessionEnd(Date.parse("2026-07-20T22:00:00Z"))).toISOString(), "2026-07-21T21:00:00.000Z");
});

test("Sector break log: the event is when half the other markets broke the reading's way; outcomes fill as bars arrive", () => {
  const w1 = nyEpoch("2026-07-17", 17);
  const brk = Date.parse("2026-07-20T14:00:00Z");            // Monday 10:00 New York
  const up = (k: number) => 101 + k * 0.05;                  // above W0's 100.1 high from the break on
  const flat = () => 100.05;
  const b = new Map<string, IntradayBars>([
    ["CL", bars(w1, 100, up, brk + 2 * STEP)],                 // the reading's market breaks 30 minutes later
    ["RB", bars(w1, 100, up, brk)],
    ["HO", bars(w1, 100, up, brk + STEP)],                     // the second of three others: the event
    ["NG", bars(w1, 100, flat, brk)],
  ]);
  const input: SectorBreakInput = { code: "067651", symbol: "CL", reportDate: "2026-07-14", dir: 1, dailyClose: Array.from({ length: 30 }, (_, i) => 100 * Math.exp(0.01 * (i % 2))) };
  const before = updateSectorBreakLog(null, [input], b, "2026-07-01", new Date(w1 - 60_000));
  assert.equal(before.cases.length, 0, "no case before the week starts");
  const mid = updateSectorBreakLog(null, [input], b, "2026-07-01", new Date(brk + 3 * STEP));
  const c = mid.cases[0];
  assert.equal(c.status, "broke");
  assert.equal(c.brokeAt, new Date(brk + STEP).toISOString());
  assert.deepEqual(c.broken, ["RB", "HO"]);
  assert.equal(c.need, 2);
  assert.equal(c.outcome.h1, null, "an hour has not passed yet");
  const later = updateSectorBreakLog(mid, [input], b, "2026-07-01", new Date(Date.parse("2026-07-20T22:00:00Z")));
  const d = later.cases[0];
  assert.ok(d.outcome.h1! > 0 && d.outcome.h4! > d.outcome.h1! && d.outcome.session! > 0, "a rising market went the reading's way");
  assert.equal(d.ownBreakAt, new Date(brk + 2 * STEP).toISOString());
  assert.equal(breakTally(later.cases).session.n, 1);
  const short = updateSectorBreakLog(null, [{ ...input, dir: -1 }], b, "2026-07-01", new Date(w1 + 8 * 86_400_000));
  assert.equal(short.cases[0].status, "no break", "the sector never broke down: closed out after the week");
});
