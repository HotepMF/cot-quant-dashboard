-- Additive only: existing official histories and snapshot pointers are preserved.
CREATE TABLE IF NOT EXISTS cot_cf_public_histories (
  run_id TEXT NOT NULL REFERENCES cot_cf_runs(id) ON DELETE CASCADE,
  market_name TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(run_id,market_name)
);
CREATE TABLE IF NOT EXISTS cot_cf_signals (
  run_id TEXT PRIMARY KEY REFERENCES cot_cf_runs(id) ON DELETE CASCADE,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  stale_payload TEXT NOT NULL CHECK(json_valid(stale_payload))
);
