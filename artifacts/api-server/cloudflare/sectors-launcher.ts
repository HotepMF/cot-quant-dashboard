import { statement, type Sql } from "./database";
import type { Env } from "./types";

export const SECTORS_JOB = "daily-sectors";
const WINDOWS = [[6 * 60, 9 * 60], [17 * 60 + 30, 23 * 60 + 30]] as const, RETRY_MS = 90 * 60_000;

/** Minutes since midnight and weekday in New York; DST handled by Intl. */
function newYork(now: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return { weekday: parts.weekday as string, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/**
 * Two runs each weekday, each retried every 90 minutes until it succeeds:
 *   pre-open (06:00-09:00 New York)  futures numbers from the previous day's settlements (oscillators, curves, case log);
 *   evening (17:30-23:30 New York)   the SPDR page after the 16:00 close; Friday's run also picks up the CFTC release.
 */
export function sectorsDue(now: number, lastDispatchAt: number | null, lastSuccessAt: number | null) {
  const { weekday, minutes } = newYork(now);
  const win = WINDOWS.find(([a, b]) => minutes >= a && minutes < b);
  if (weekday === "Sat" || weekday === "Sun" || !win) return false;
  const windowStart = now - (minutes - win[0]) * 60_000 - (now % 60_000);
  if (lastSuccessAt != null && lastSuccessAt >= windowStart) return false;
  return lastDispatchAt == null || lastDispatchAt < windowStart || now - lastDispatchAt >= RETRY_MS;
}

export async function launchSectors(sql: Sql, env: Env, now = Date.now()) {
  const job = await statement(sql, "SELECT last_dispatch_at, last_success_at FROM cot_cf_jobs WHERE id=?", SECTORS_JOB)
    .first<{ last_dispatch_at: number | null; last_success_at: number | null }>();
  if (!sectorsDue(now, job?.last_dispatch_at ?? null, job?.last_success_at ?? null)) return false;
  await statement(sql, `INSERT INTO cot_cf_jobs(id,last_dispatch_at) VALUES(?,?)
    ON CONFLICT(id) DO UPDATE SET last_dispatch_at=excluded.last_dispatch_at`, SECTORS_JOB, now).run();
  let githubStatus: number | undefined;
  try {
    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/sectors-update.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "cot-sectors-updater" },
      body: JSON.stringify({ ref: env.CFTC_WORKFLOW_REF ?? "main" }),
      signal: AbortSignal.timeout(10_000),
    });
    githubStatus = response.status;
    if (!response.ok) throw new Error(`GitHub sectors dispatch failed (HTTP ${response.status}).`);
    return true;
  } catch (error) {
    // Fixed fields only, as for the CFTC dispatch: no credentials, bodies or raw messages.
    console.error("sectors-dispatch-failed", { phase: githubStatus === undefined ? "transport" : "http", httpStatus: githubStatus ?? null });
    await statement(sql, "UPDATE cot_cf_jobs SET last_error=? WHERE id=?", "dispatch failed", SECTORS_JOB).run();
    throw error;
  }
}
