import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_MARKETS, advanceDemo, emptyDemo, stepMarket, triggerPattern, type WeekBar } from "@workspace/cot-engine";
import { completedWeeks } from "../cloudflare/hand-compute";

const bar = (week: string, open: number, high: number, low: number, close: number): WeekBar => ({ week, open, high, low, close });
const ES = DEMO_MARKETS.find(m => m.symbol === "ES")!;
/** 60 quiet weeks (so sigma exists) then the given bars. */
function history(...tail: WeekBar[]) {
  const out: WeekBar[] = [];
  for (let i = 0; i < 60; i++) {
    const t = Date.UTC(2025, 0, 3) + i * 7 * 86_400_000, c = 100 + (i % 2);
    out.push(bar(new Date(t).toISOString().slice(0, 10), c, c + 1, c - 1, c));
  }
  return [...out, ...tail];
}

test("Trigger bars follow the rules: failed 2 or 3 after an opposite close; 2-2 or 3-2 on a close our way", () => {
  const green = bar("w1", 100, 105, 99, 104);
  assert.equal(triggerPattern(bar("w2", 104, 107, 101, 102), green, -1), "failed 2", "broke the green bar's high, closed red");
  assert.equal(triggerPattern(bar("w2", 104, 107, 98, 106), green, -1), "3");
  assert.equal(triggerPattern(bar("w2", 104, 107, 101, 106), green, -1), null, "a 2U that closed green has not failed");
  const red = bar("w1", 104, 105, 99, 100);
  assert.equal(triggerPattern(bar("w2", 100, 104, 97, 98), red, -1), "2-2");
  assert.equal(triggerPattern(bar("w2", 100, 106, 97, 98), red, -1), "3-2");
  assert.equal(triggerPattern(bar("w2", 100, 104, 100, 101), red, -1), null, "an inside bar is never a trigger");
  assert.equal(triggerPattern(bar("w2", 100, 104, 97, 100), red, -1), null, "a doji close is neither red nor green");
  assert.equal(triggerPattern(bar("w2", 98, 104, 97, 101), red, 1), "failed 2", "mirror: red bar, then a failed 2D (closed green) for a long");
});

test("Orders, fills, trailing and exits follow the backtest's conservative weekly rules", () => {
  // short filter; last bar is a red 2-2 trigger: sell stop at its low, stop at its high
  const trig = bar("2026-02-27", 101, 101.5, 97, 98);
  let h = history(trig);
  let r = stepMarket(ES, { order: null, position: null }, h, -1);
  assert.ok(r.state.order);
  assert.deepEqual([r.state.order!.trigger, r.state.order!.stop, r.state.order!.pattern], [97, 101.5, "2-2"]);
  // next week gaps below the trigger: fill at the open, closes red -> stop trails to that week's high
  h = [...h, bar("2026-03-06", 96, 99, 95, 95.5)];
  r = stepMarket(ES, r.state, h, -1);
  assert.equal(r.state.position!.entry, 96);
  assert.equal(r.state.position!.stop, 99, "trailed to the entry week's high");
  assert.ok(Math.abs(r.state.position!.target - (96 - 2 * r.state.position!.sigma)) < 1e-9, "target measured from the fill");
  // a week that touches both stop and target counts the stop
  h = [...h, bar("2026-03-13", 95, 99.5, 80, 90)];
  r = stepMarket(ES, r.state, h, -1);
  assert.equal(r.state.position, null);
  assert.equal(r.trade!.how, "stop");
  assert.equal(r.trade!.pnl, (96 - 99) * 50, "one E-mini contract: -3 points x $50");
  assert.equal(r.trade!.r, -0.55, "initial risk 101.5 - 96 = 5.5 points; the trailed stop lost 3 points = -0.55R");
});

test("An unfilled order lasts one week; a filter-off week places nothing", () => {
  const trig = bar("2026-02-27", 101, 101.5, 97, 98);
  let h = history(trig);
  let r = stepMarket(ES, { order: null, position: null }, h, -1);
  h = [...h, bar("2026-03-06", 99, 100, 98, 99.5)];   // never trades below 97, inside bar, filter now off
  r = stepMarket(ES, r.state, h, 0);
  assert.deepEqual(r.state, { order: null, position: null });
  r = stepMarket(ES, { order: null, position: null }, history(trig), null);
  assert.equal(r.state.order, null, "report not available: no new order");
});

test("A new account only marks its start; orders begin at the next completed week; no week is processed twice", () => {
  const start = { [ES.code]: history(bar("2026-02-20", 99, 101, 98, 100)) };
  const filters = { [ES.code]: { "2026-02-20": -1 as const, "2026-02-27": -1 as const } };
  const s = advanceDemo(emptyDemo(), start, filters);
  assert.deepEqual([s.startedWeek, s.lastWeek, s.equity.length, Object.keys(s.markets).length], [null, "2026-02-20", 0, 0],
    "the week after the start may already be under way, so nothing is placed yet");
  const bars = { [ES.code]: [...start[ES.code], bar("2026-02-27", 101, 101.5, 97, 98)] };
  const a = advanceDemo(s, bars, filters);
  assert.deepEqual([a.startedWeek, a.lastWeek, a.equity.length], ["2026-02-27", "2026-02-27", 1]);
  assert.ok(a.markets[ES.code].order, "first orders after the first full week, for the week that follows");
  assert.deepEqual(advanceDemo(a, bars, filters), a, "same inputs: nothing changes");
  const later = { [ES.code]: [...bars[ES.code], bar("2026-03-06", 99, 100, 98, 99.5)] };
  const b = advanceDemo(a, later, { [ES.code]: { "2026-02-27": -1 } });
  assert.equal(b.lastWeek, "2026-03-06");
  assert.equal(b.markets[ES.code].order, null);
  assert.deepEqual(b.skipped, [{ week: "2026-03-06", codes: ["ES"] }], "a week whose report was not available yet is recorded");
});

test("Weekly bars: Monday-Friday labelled by Friday; the current week only counts after Friday 17:30 New York", () => {
  const daily = { dates: ["2026-10-12", "2026-10-16", "2026-10-19", "2026-10-23"], open: [1, 2, 3, 4], high: [5, 6, 7, 8], low: [0.5, 1, 2, 3], close: [2, 3, 4, 5] };
  const fri1630 = new Date(Date.UTC(2026, 9, 23, 20, 30)), fri1800 = new Date(Date.UTC(2026, 9, 23, 22, 0));
  assert.deepEqual(completedWeeks(daily, fri1630).map(w => w.week), ["2026-10-16"]);
  const w = completedWeeks(daily, fri1800);
  assert.deepEqual(w.map(x => [x.week, x.open, x.high, x.low, x.close]), [["2026-10-16", 1, 6, 0.5, 3], ["2026-10-23", 3, 8, 2, 5]]);
});
