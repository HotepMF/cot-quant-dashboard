import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { ensureScan } from "../src/services/cot-screener";
import { getMarkets } from "../src/routes/cot";
import { loadSnapshot, saveSnapshot, savedMarketHistory } from "../src/services/cot-snapshots";
import { getCftcUpdateStatus, runCftcUpdate } from "../src/services/cot-updater";

after(async () => { await pool.end(); });

test("a fresh process restores a saved report without making any CFTC request", async t => {
  const saved = await loadSnapshot("futures");
  if (!saved || Date.now() - Date.parse(saved.checkedAt) > 6 * 60 * 60_000) {
    t.skip("Start the app to create a recent official snapshot first.");
    return;
  }
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Simulated CFTC outage"); });
  const restored = await ensureScan("futures");
  assert.equal(restored.status, "ready");
  assert.equal(restored.persisted, true);
  assert.equal(restored.reportAsOf, saved.reportAsOf);
  assert.equal(restored.markets.length, saved.markets.length);
  assert.equal(restored.updatedAt, saved.checkedAt);
  assert.equal(calls, 0);
});

test("source outages return dated saved data, but never count as a successful official sync", async t => {
  const saved = await loadSnapshot("futures");
  if (!saved) { t.skip("Start the app to create an official snapshot first."); return; }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Simulated CFTC outage"); });
  const fallback = await getMarkets("futures", true);
  assert.equal(fallback.source, "saved");
  assert.equal(fallback.checkedAt, saved.checkedAt);
  assert.equal(fallback.reportAsOf, saved.reportAsOf);
  await assert.rejects(() => getMarkets("futures", true, false), /Simulated CFTC outage/);
  const market = saved.markets.find(m => saved.histories[m.name]?.rows.length >= 3)!;
  const history = savedMarketHistory(saved, market.name)!;
  assert.equal(history.checkedAt, saved.checkedAt);
  assert.ok(history.sourceWarning);
  assert.ok(history.rows.length >= 3);
});

test("an incomplete source scan cannot overwrite the last successful database snapshot", async t => {
  const saved = await loadSnapshot("futures");
  if (!saved) { t.skip("Start the app to create an official snapshot first."); return; }
  await assert.rejects(() => saveSnapshot({ ...saved, histories: {} }), /incomplete CFTC scan/);
  const after = await loadSnapshot("futures");
  assert.equal(after!.checkedAt, saved.checkedAt);
  assert.equal(after!.markets.length, saved.markets.length);
});

test("a second updater cannot run while another process holds the database job lock", async () => {
  const connection = await pool.connect();
  try {
    await connection.query("SELECT pg_advisory_lock($1)", [73519302]);
    const before = await getCftcUpdateStatus();
    await runCftcUpdate();
    const after = await getCftcUpdateStatus();
    assert.equal(after.lastAttemptAt, before.lastAttemptAt);
    assert.equal(after.lastSuccessAt, before.lastSuccessAt);
  } finally {
    await connection.query("SELECT pg_advisory_unlock($1)", [73519302]);
    connection.release();
  }
});
