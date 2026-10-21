-- Cloudflare D1 only. Replit's development PostgreSQL database is untouched.
CREATE TABLE IF NOT EXISTS cot_cf_assertion (
  id INTEGER PRIMARY KEY CHECK(id=1),
  ok INTEGER NOT NULL CHECK(ok=1)
);
CREATE TABLE IF NOT EXISTS cot_update_state (
  id TEXT PRIMARY KEY,
  running INTEGER NOT NULL DEFAULT 0 CHECK(running IN (0,1)),
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  next_check_at INTEGER NOT NULL,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS cot_cf_leases (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cot_cf_runs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  report TEXT NOT NULL CHECK(report IN ('futures','combined')),
  report_as_of TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('loading','ready','error')),
  markets TEXT NOT NULL CHECK(json_valid(markets)),
  processed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cot_cf_runs_report_updated_idx ON cot_cf_runs(report, updated_at DESC);
CREATE TABLE IF NOT EXISTS cot_cf_histories (
  run_id TEXT NOT NULL REFERENCES cot_cf_runs(id) ON DELETE CASCADE,
  market_name TEXT NOT NULL,
  history TEXT NOT NULL CHECK(json_valid(history)),
  PRIMARY KEY(run_id,market_name)
);
CREATE TABLE IF NOT EXISTS cot_snapshots (
  report TEXT PRIMARY KEY,
  report_as_of TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  run_id TEXT NOT NULL REFERENCES cot_cf_runs(id)
);
