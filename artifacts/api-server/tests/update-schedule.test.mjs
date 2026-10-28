import test from "node:test";
import assert from "node:assert/strict";
import { expectedReportDate, nextCftcCheck } from "../cloudflare/update-schedule.ts";

const date = value => Date.parse(value);
const next = (now, reports, failed = false) => nextCftcCheck(date(now), reports, failed).toISOString();

test("starts the weekly release watch at 3:30pm New York, not a fixed UTC time", () => {
  assert.equal(expectedReportDate(date("2026-10-23T19:29:00Z")), "2026-10-13");
  assert.equal(expectedReportDate(date("2026-10-23T19:30:00Z")), "2026-10-20");
  assert.equal(next("2026-10-23T19:29:00Z", ["2026-10-13", "2026-10-13"]), "2026-10-23T19:30:00.000Z");
  assert.equal(next("2026-12-04T20:29:00Z", ["2026-11-24", "2026-11-24"]), "2026-12-04T20:30:00.000Z");
});
test("retries every ten minutes through Friday's release window when a report is missing", () => {
  assert.equal(next("2026-10-23T19:31:00Z", ["2026-10-13", "2026-10-13"]), "2026-10-23T19:40:00.000Z");
  assert.equal(next("2026-10-23T19:41:00Z", ["2026-10-20", "2026-10-13"]), "2026-10-23T19:50:00.000Z");
  assert.equal(next("2026-10-23T19:41:00Z", ["2026-10-20", "2026-10-20"], true), "2026-10-23T19:50:00.000Z");
});
test("continues hourly for holiday delays, weekends, and source failures", () => {
  assert.equal(next("2026-10-24T16:12:00Z", ["2026-10-13", "2026-10-13"]), "2026-10-24T17:00:00.000Z");
  assert.equal(next("2026-10-26T18:12:00Z", ["2026-10-13", "2026-10-13"]), "2026-10-26T19:00:00.000Z");
  assert.equal(next("2026-10-26T18:12:00Z", [null, null], true), "2026-10-26T19:00:00.000Z");
});
test("checks daily for missed/corrected data once both reports are current", () => {
  assert.equal(next("2026-10-23T19:31:00Z", ["2026-10-20", "2026-10-20"]), "2026-10-24T10:00:00.000Z");
  assert.equal(next("2026-11-07T16:00:00Z", ["2026-11-03", "2026-11-03"]), "2026-11-08T11:00:00.000Z");
});
test("next-day checks track daylight saving transitions", () => {
  assert.equal(next("2026-03-07T17:00:00Z", ["2026-03-03", "2026-03-03"]), "2026-03-08T10:00:00.000Z");
  assert.equal(next("2026-10-31T17:00:00Z", ["2026-10-27", "2026-10-27"]), "2026-11-01T11:00:00.000Z");
});
test("twice-weekly schedule: also checks after the Wednesday 3:30pm release", () => {
  assert.equal(next("2026-10-28T12:00:00Z", ["2026-10-20", "2026-10-20"]), "2026-10-28T19:30:00.000Z");
  assert.equal(next("2026-12-09T13:00:00Z", ["2026-12-02", "2026-12-02"]), "2026-12-09T20:30:00.000Z", "standard time");
});
