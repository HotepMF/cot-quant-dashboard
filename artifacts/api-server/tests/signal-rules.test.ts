import test from "node:test";
import assert from "node:assert/strict";
import { computeRows, defaultSignalSettings, parseSignalSettings, setupScore, signalMarket, type RawRow } from "@workspace/cot-engine";

const reportDate = "2026-10-13";
const now = Date.parse("2026-10-20T12:00:00Z");
const market = { name: "TEST MARKET - TEST EXCHANGE", code: "test" };
function history(direction = 1, count = 90): RawRow[] {
  return Array.from({ length: count }, (_, i) => {
    const n = direction * (i === count - 1 ? 1000 : i + 1);
    return {
      date: new Date(Date.parse(`${reportDate}T00:00:00Z`) - (count - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10),
      commercial_hedgers: n, large_traders: -n, small_traders: -n / 2, open_interest: 10000 + i * 100,
    };
  });
}
test("scanner uses the identical dashboard engine for direction, metrics and ranking", () => {
  for (const direction of [1, -1]) {
    const rows = history(direction);
    const latest = computeRows(rows, defaultSignalSettings).at(-1)!;
    const result = signalMarket(market, { rows, error: null }, reportDate, defaultSignalSettings, now);
    assert.equal(result.status, "ready");
    assert.equal(result.signal, direction > 0 ? "bullish" : "bearish");
    assert.equal(result.zScore, latest.chZ);
    assert.equal(result.cycle, latest.chCycle);
    assert.equal(result.weeklyChange, latest.chDelta);
    assert.equal(result.oiChange, latest.oiMove);
    assert.equal(result.setupScore, setupScore(latest, defaultSignalSettings));
    assert.equal(result.name, market.name);
  }
});
test("Z-score and AND gate respect selected participant and disabled Z detection", () => {
  const rows = history();
  for (const participant of ["Large Traders", "Small Traders", "Commercial Hedgers"]) {
    for (const signalMode of ["Z-Score Only", "Both (AND gate)"]) {
      const settings = { ...defaultSignalSettings, participant, signalMode, requireSmall: true };
      assert.equal(signalMarket(market, { rows, error: null }, reportDate, settings, now).signal, "bullish");
      assert.equal(signalMarket(market, { rows, error: null }, reportDate, { ...settings, zEnabled: false }, now).signal, "none");
    }
  }
});
test("missing, failed, short and stale histories never masquerade as active or neutral signals", () => {
  const fixtures = [
    [undefined, "loading"],
    [{ rows: [], error: "Source failed" }, "error"],
    [{ rows: history(1, 10), error: null }, "insufficient"],
    [{ rows: history().slice(0, -1), error: null }, "stale"],
  ] as const;
  for (const [data, status] of fixtures) {
    const result = signalMarket(market, data, reportDate, defaultSignalSettings, now);
    assert.equal(result.status, status);
    assert.equal(result.signal, "unavailable");
    assert.equal(result.setupScore, null);
    assert.ok(result.message);
  }
  assert.equal(signalMarket(market, { rows: history(), error: null }, reportDate, defaultSignalSettings, now + 14 * 86_400_000).status, "stale");
});
test("ambiguous threshold boundary does not arbitrarily rank a bullish setup", () => {
  const rows = history().map(row => ({ ...row, commercial_hedgers: 5, large_traders: 5, small_traders: 5 }));
  const result = signalMarket(market, { rows, error: null }, reportDate, { ...defaultSignalSettings, confluenceThreshold: 50 }, now);
  assert.equal(result.signal, "none");
  assert.equal(result.setupScore, 0);
});
test("query validation preserves booleans and rejects malformed settings", () => {
  assert.equal(parseSignalSettings({ zEnabled: "false", requireSmall: "true" }).zEnabled, false);
  assert.equal(parseSignalSettings({ zEnabled: "false", requireSmall: "true" }).requireSmall, true);
  for (const input of [{ lookback: "0" }, { lookback: "3.5" }, { zThreshold: "NaN" }, { requireSmall: "yes" }, { signalMode: "invalid" }]) {
    assert.throws(() => parseSignalSettings(input));
  }
});

test("OI normalization matches the indicator: Z of net / open interest, only with a full window of valid OI", async () => {
  const { computeRows, defaultSignalSettings, parseSignalSettings, previousDefaultSignalSettings } = await import("@workspace/cot-engine");
  const rows = Array.from({ length: 40 }, (_, i) => ({ date: `2026-${String(1 + (i % 12)).padStart(2, "0")}-01`, large_traders: 0, small_traders: 0,
    commercial_hedgers: 1000 + 37 * ((i * 7) % 11), open_interest: 20000 + 900 * ((i * 5) % 9) }));
  const L = 16, s = { ...defaultSignalSettings, lookback: L };
  const last = computeRows(rows, s).at(-1)!;
  const norm = rows.slice(-L).map(r => r.commercial_hedgers / r.open_interest);
  const mean = norm.reduce((a, b) => a + b, 0) / L;
  const sd = Math.sqrt(norm.reduce((a, b) => a + (b - mean) ** 2, 0) / L);
  assert.ok(Math.abs(last.chZ! - (norm[L - 1] - mean) / sd) < 1e-9, "population stdev of the normalised series, as ta.stdev");
  const std = computeRows(rows, { ...s, zMethod: "Standard Z-Score" }).at(-1)!;
  assert.notEqual(std.chZ, last.chZ, "the two methods differ");
  const gap = rows.map((r, i) => i === 35 ? { ...r, open_interest: undefined } : r);
  assert.equal(computeRows(gap, s).at(-1)!.chZ, null, "a missing OI inside the window leaves no Z (no bridging)");
  assert.equal(computeRows(gap, { ...s, zMethod: "Standard Z-Score" }).at(-1)!.chZ, std.chZ, "standard Z ignores OI");
  assert.deepEqual([defaultSignalSettings.signalMode, defaultSignalSettings.zMethod, defaultSignalSettings.lookback], ["Both (AND gate)", "Open Interest Normalization", 16]);
  assert.equal(previousDefaultSignalSettings.lookback, 63);
  assert.equal(parseSignalSettings({ zMethod: "Standard Z-Score" }).zMethod, "Standard Z-Score");
  assert.throws(() => parseSignalSettings({ zMethod: "Winsorized" }), /Invalid zMethod/);
});
