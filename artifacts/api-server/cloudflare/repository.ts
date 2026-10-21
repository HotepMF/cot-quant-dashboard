import { expectedReportDate, nextCftcCheck } from "../src/services/cot-update-schedule";
import { leaseGuard, NOW, statement, type Sql } from "./database";
import { JOB_ID, REPORTS, type History, type Market, type ReportKey } from "./types";

export type View = {
  report: ReportKey; reportAsOf: string; markets: Market[]; runId: string;
  status: "loading" | "ready" | "error"; startedAt: string; updatedAt: string; processed: number; message: string | null;
};
type StoredRun = {
  id: string; owner: string; report: ReportKey; report_as_of: string; state: View["status"];
  markets: string; processed: number; error: string | null; started_at: number; updated_at: number;
};
const runValue = (r: StoredRun) => ({ ...r, markets: JSON.parse(r.markets) as Market[] });
const iso = (time: number | null | undefined) => time == null ? null : new Date(time).toISOString();

export async function acquireUpdate(db: Sql, owner: string, force = false) {
  const due = force ? `(last_attempt_at IS NULL OR last_attempt_at<${NOW}-900000)` : `(next_check_at<=${NOW} OR running=1)`;
  const result = await db.batch([
    statement(db, `INSERT INTO cot_update_state(id,next_check_at) VALUES(?,${NOW}) ON CONFLICT DO NOTHING`, JOB_ID),
    statement(db, `INSERT INTO cot_cf_leases(id,owner,expires_at)
      SELECT ?,?,${NOW}+1800000 WHERE EXISTS(SELECT 1 FROM cot_update_state WHERE id=? AND ${due})
      ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
      WHERE cot_cf_leases.expires_at<=${NOW} RETURNING owner`, JOB_ID, owner, JOB_ID),
    statement(db, `UPDATE cot_update_state SET running=1,last_attempt_at=${NOW},last_error=NULL,next_check_at=${NOW}+1800000
      WHERE id=? AND EXISTS(SELECT 1 FROM cot_cf_leases WHERE id=? AND owner=?)`, JOB_ID, JOB_ID, owner),
  ]);
  return result[1].results.length > 0;
}

export async function renewLease(db: Sql, owner: string) {
  const result = await statement(db, `UPDATE cot_cf_leases SET expires_at=${NOW}+1800000
    WHERE id=? AND owner=? AND expires_at>${NOW} RETURNING owner`, JOB_ID, owner).all();
  if (!result.results.length) throw new Error("Update lease expired or was replaced; this workflow may no longer write.");
}

export async function getRun(db: Sql, owner: string, report: ReportKey) {
  const row = await statement(db, "SELECT * FROM cot_cf_runs WHERE id=?", `${owner}:${report}`).first<StoredRun>();
  return row ? runValue(row) : null;
}

export async function initializeRun(db: Sql, owner: string, report: ReportKey, metadata: { reportAsOf: string; markets: Market[] }) {
  if (!metadata.markets.length) throw new Error("An empty official market list cannot initialize a report.");
  await db.batch([
    leaseGuard(db, owner),
    statement(db, `INSERT INTO cot_cf_runs(id,owner,report,report_as_of,state,markets,started_at,updated_at)
      VALUES(?,?,?,?,'loading',?,${NOW},${NOW}) ON CONFLICT(id) DO NOTHING`,
    `${owner}:${report}`, owner, report, metadata.reportAsOf, JSON.stringify(metadata.markets)),
  ]);
  return (await getRun(db, owner, report))!;
}

export async function stageHistories(db: Sql, owner: string, report: ReportKey, histories: Map<string, History>) {
  const run = await getRun(db, owner, report);
  if (!run || run.state !== "loading") throw new Error("Report scan is not accepting observations.");
  const allowed = new Set(run.markets.map(m => m.name));
  const inserts = [];
  for (const [name, history] of histories) {
    if (!allowed.has(name) || history.error || !history.rows.length || history.rows.at(-1)!.date !== run.report_as_of) {
      throw new Error("Refusing invalid, incomplete, or mismatched staging observations.");
    }
    const payload = JSON.stringify(history);
    if (new TextEncoder().encode(payload).length > 1_900_000) throw new Error("Market history exceeds D1's row limit; previous saved data has been retained.");
    inserts.push(statement(db, `INSERT INTO cot_cf_histories(run_id,market_name,history) VALUES(?,?,?)
      ON CONFLICT(run_id,market_name) DO UPDATE SET history=excluded.history`, run.id, name, payload));
  }
  await db.batch([
    leaseGuard(db, owner, "EXISTS(SELECT 1 FROM cot_cf_runs WHERE id=? AND state='loading')", [run.id]),
    ...inserts,
    statement(db, `UPDATE cot_cf_runs SET processed=(SELECT count(*) FROM cot_cf_histories WHERE run_id=?),
      updated_at=${NOW} WHERE id=?`, run.id, run.id),
  ]);
}

export async function commitRun(db: Sql, owner: string, report: ReportKey, requirePrepared = false) {
  await renewLease(db, owner);
  const run = await getRun(db, owner, report);
  if (!run) throw new Error("Report scan was not initialized.");
  if (run.state === "ready") return { reportAsOf: run.report_as_of };
  const count = await statement(db, "SELECT count(*) AS n FROM cot_cf_histories WHERE run_id=?", run.id).first<{ n: number }>();
  if (count?.n !== run.markets.length) throw new Error("Incomplete scan cannot replace the last saved snapshot.");
  const newer = await statement(db, "SELECT 1 FROM cot_snapshots WHERE report=? AND report_as_of>?", report, run.report_as_of).first();
  if (newer) throw new Error("A newer official snapshot is already saved.");
  const preparedGuard = requirePrepared
    ? "AND EXISTS(SELECT 1 FROM cot_cf_signals WHERE run_id=r.id) AND (SELECT count(*) FROM cot_cf_public_histories p WHERE p.run_id=r.id)=json_array_length(r.markets)"
    : "";
  // A pointer swap commits the report atomically, without building a multi-MB JSON
  // row (D1 has a 2MB row limit). Immutable per-market histories stay in place.
  await db.batch([
    leaseGuard(db, owner, `EXISTS(SELECT 1 FROM cot_cf_runs r WHERE r.id=? AND r.state='loading'
      AND (SELECT count(*) FROM cot_cf_histories h WHERE h.run_id=r.id)=json_array_length(r.markets) ${preparedGuard})
      AND NOT EXISTS(SELECT 1 FROM cot_snapshots WHERE report=? AND report_as_of>?)`, [run.id, report, run.report_as_of]),
    statement(db, `INSERT INTO cot_snapshots(report,report_as_of,checked_at,run_id) VALUES(?,?,${NOW},?)
      ON CONFLICT(report) DO UPDATE SET report_as_of=excluded.report_as_of,checked_at=excluded.checked_at,run_id=excluded.run_id`,
    report, run.report_as_of, run.id),
    statement(db, `UPDATE cot_cf_runs SET state='ready',updated_at=${NOW},error=NULL WHERE id=?`, run.id),
  ]);
  return { reportAsOf: run.report_as_of };
}

export async function failRun(db: Sql, owner: string, report: ReportKey) {
  await db.batch([
    leaseGuard(db, owner),
    statement(db, `UPDATE cot_cf_runs SET state='error',
      error='Official CFTC collection failed. Last complete saved data has been retained.',updated_at=${NOW} WHERE id=? AND state='loading'`, `${owner}:${report}`),
  ]);
}

export async function finishUpdate(db: Sql, owner: string, dates: (string | null)[], failures: string[]) {
  const next = nextCftcCheck(Date.now(), dates, failures.length > 0);
  const error = failures.length ? `CFTC update could not finish for ${failures.join(", ")}. Last successful saved data has been kept; an automatic retry is scheduled.` : null;
  await db.batch([
    leaseGuard(db, owner),
    statement(db, `UPDATE cot_update_state SET running=0,last_error=?,next_check_at=?,
      last_success_at=CASE WHEN ? IS NULL THEN ${NOW} ELSE last_success_at END WHERE id=?`, error, next.getTime(), error, JOB_ID),
    statement(db, "DELETE FROM cot_cf_leases WHERE id=? AND owner=?", JOB_ID, owner),
    // Readers may have an older snapshot pointer. Retain unreferenced runs for an
    // hour, but never delete a last-good report, no matter how old the source is.
    statement(db, `DELETE FROM cot_cf_runs WHERE updated_at<${NOW}-3600000
      AND NOT EXISTS(SELECT 1 FROM cot_snapshots WHERE run_id=cot_cf_runs.id)`),
  ]);
}

const asView = (r: ReturnType<typeof runValue>, status = r.state): View => ({
  report: r.report, reportAsOf: r.report_as_of, markets: r.markets, runId: r.id, status,
  processed: r.processed, startedAt: iso(r.started_at)!, updatedAt: iso(r.updated_at)!, message: r.error,
});

export async function viewMetadata(db: Sql, report: ReportKey, savedFirst = false): Promise<View | null> {
  if (savedFirst) {
    const saved = await statement(db, "SELECT r.* FROM cot_snapshots s JOIN cot_cf_runs r ON r.id=s.run_id WHERE s.report=?", report).first<StoredRun>();
    if (saved) return asView(runValue(saved), "ready");
  }
  const active = await statement(db, `SELECT r.* FROM cot_cf_runs r JOIN cot_cf_leases l ON l.owner=r.owner AND l.id=?
    WHERE r.report=? AND r.state='loading' AND l.expires_at>${NOW} ORDER BY r.started_at DESC LIMIT 1`, JOB_ID, report).first<StoredRun>();
  if (active) return asView(runValue(active));
  const saved = await statement(db, `SELECT r.* FROM cot_snapshots s JOIN cot_cf_runs r ON r.id=s.run_id WHERE s.report=?`, report).first<StoredRun>();
  if (saved) return asView(runValue(saved), "ready");
  const failed = await statement(db, "SELECT * FROM cot_cf_runs WHERE report=? AND state='error' ORDER BY updated_at DESC LIMIT 1", report).first<StoredRun>();
  return failed ? asView(runValue(failed)) : null;
}

export async function readHistories(db: Sql, view: View, names: string[]) {
  if (!names.length) return new Map<string, History>();
  const result = await statement(db, `SELECT market_name,history FROM cot_cf_histories
    WHERE run_id=? AND market_name IN (${names.map(() => "?").join(",")})`, view.runId, ...names).all<{ market_name: string; history: string }>();
  return new Map(result.results.map(r => [r.market_name, JSON.parse(r.history) as History]));
}

export async function updateStatus(db: Sql) {
  const state = await statement(db, "SELECT * FROM cot_update_state WHERE id=?", JOB_ID).first<{
    running: number; last_attempt_at: number | null; last_success_at: number | null; next_check_at: number; last_error: string | null;
  }>();
  const snapshots = await statement(db, "SELECT report,report_as_of FROM cot_snapshots").all<{ report: string; report_as_of: string }>();
  const reports = {
    futures: snapshots.results.find(r => r.report === "futures")?.report_as_of ?? null,
    combined: snapshots.results.find(r => r.report === "combined")?.report_as_of ?? null,
  };
  const expected = expectedReportDate(Date.now());
  return {
    enabled: true, timeZone: "America/New_York", running: !!state?.running,
    lastAttemptAt: iso(state?.last_attempt_at), lastSuccessAt: iso(state?.last_success_at),
    nextCheckAt: iso(state?.next_check_at), lastError: state?.last_error ?? null,
    expectedReportDate: expected, waitingForRelease: REPORTS.some(report => !reports[report] || reports[report]! < expected), reports,
  };
}
