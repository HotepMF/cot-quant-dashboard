-- Additive only. Prepared page documents (e.g. the daily sectors snapshot), their dated history,
-- and bookkeeping for jobs other than the weekly CFTC collection.
CREATE TABLE IF NOT EXISTS cot_cf_documents (
  key TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cot_cf_document_history (
  key TEXT NOT NULL,
  as_of TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(key, as_of)
);
CREATE TABLE IF NOT EXISTS cot_cf_jobs (
  id TEXT PRIMARY KEY,
  last_dispatch_at INTEGER,
  last_success_at INTEGER,
  last_error TEXT
);
