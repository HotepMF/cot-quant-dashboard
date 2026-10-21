import { db, pool, cotSnapshotsTable, cotUpdateStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { ensureScan, waitForScan } from "./cot-screener";
import { CFTC_TIME_ZONE, expectedReportDate, nextCftcCheck } from "./cot-update-schedule";

const JOB_ID = "weekly-cftc";
const LOCK_ID = 73519302;
const reports = ["futures", "combined"] as const;
let timer: ReturnType<typeof setTimeout> | undefined;
let active = false;
let stopped = true;

async function initializeState() {
  await db.insert(cotUpdateStateTable).values({ id: JOB_ID, nextCheckAt: new Date() }).onConflictDoNothing();
}

export async function getCftcUpdateStatus() {
  const [state] = await db.select().from(cotUpdateStateTable).where(eq(cotUpdateStateTable.id, JOB_ID)).limit(1);
  const snapshots = await db.select({ report: cotSnapshotsTable.report, reportAsOf: cotSnapshotsTable.reportAsOf }).from(cotSnapshotsTable);
  const dates = Object.fromEntries(reports.map(report => [report, snapshots.find(row => row.report === report)?.reportAsOf ?? null]));
  const expected = expectedReportDate(Date.now());
  return {
    enabled: true, timeZone: CFTC_TIME_ZONE, running: state?.running ?? false,
    lastAttemptAt: state?.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
    nextCheckAt: state?.nextCheckAt?.toISOString() ?? null,
    lastError: state?.lastError ?? null, expectedReportDate: expected,
    waitingForRelease: reports.some(report => !dates[report] || dates[report]! < expected),
    reports: { futures: dates.futures, combined: dates.combined },
  };
}

/** Database lock prevents duplicate workers across restarts/processes; PostgreSQL releases it on disconnect. */
export async function runCftcUpdate() {
  const connection = await pool.connect();
  let locked = false;
  try {
    const result = await connection.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [LOCK_ID]);
    locked = result.rows[0]?.acquired ?? false;
    if (!locked) return;
    await initializeState();
    const [state] = await db.select().from(cotUpdateStateTable).where(eq(cotUpdateStateTable.id, JOB_ID)).limit(1);
    // A persisted running flag with a free lock means the previous process stopped midway: recover now.
    if (!state.running && state.nextCheckAt.getTime() > Date.now()) return;
    await db.update(cotUpdateStateTable).set({
      running: true, lastAttemptAt: new Date(), lastError: null, nextCheckAt: new Date(Date.now() + 15 * 60_000),
    }).where(eq(cotUpdateStateTable.id, JOB_ID));
    const dates: (string | null)[] = [];
    const failures: string[] = [];
    for (const report of reports) {
      try {
        // This is a strict official-source check: a saved fallback is never mistaken for a successful sync.
        const scan = await waitForScan(await ensureScan(report, true, true));
        dates.push(scan.reportAsOf);
      } catch (error) {
        dates.push(null);
        failures.push(report);
        logger.warn({ report, err: error }, "Automatic CFTC report update failed; saved snapshot retained");
      }
    }
    const lastError = failures.length ? `CFTC update could not finish for ${failures.join(", ")}. Last successful saved data has been kept; an automatic retry is scheduled.` : null;
    const nextCheckAt = nextCftcCheck(Date.now(), dates, Boolean(lastError));
    await db.update(cotUpdateStateTable).set({
      running: false, lastError, nextCheckAt, ...(!lastError ? { lastSuccessAt: new Date() } : {}),
    }).where(eq(cotUpdateStateTable.id, JOB_ID));
    logger.info({ reports: dates, failures, nextCheckAt: nextCheckAt.toISOString() }, "Automatic CFTC check finished");
  } finally {
    try { if (locked) await connection.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]); }
    finally { connection.release(); }
  }
}

export function startCftcUpdater() {
  if (!stopped) return () => {};
  stopped = false;
  const tick = async () => {
    if (stopped || active) return;
    active = true;
    try { await runCftcUpdate(); }
    catch (error) { logger.error({ err: error }, "Automatic CFTC updater could not run; retrying in one minute"); }
    finally {
      active = false;
      if (!stopped) { timer = setTimeout(() => void tick(), 60_000); timer.unref(); }
    }
  };
  void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
