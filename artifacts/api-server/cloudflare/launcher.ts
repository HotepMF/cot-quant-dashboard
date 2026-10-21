import type { Sql } from "./database";
import { acquireUpdate, finishUpdate } from "./repository";
import { REPORTS, type Env } from "./types";

export const automationConfigured = (env: Env) =>
  !!env.GITHUB_ACTIONS_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? "");

export async function launchUpdate(sql: Sql, env: Env, force = false) {
  if (!automationConfigured(env)) throw new Error("GitHub automation has not been configured.");
  const owner = crypto.randomUUID();
  if (!await acquireUpdate(sql, owner, force)) return false;
  let githubStatus: number | undefined;
  try {
    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/cftc-update.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "cot-cftc-updater" },
      body: JSON.stringify({ ref: env.CFTC_WORKFLOW_REF ?? "main", inputs: { owner, full_refresh: String(force) } }),
      signal: AbortSignal.timeout(10_000),
    });
    githubStatus = response.status;
    if (!response.ok) throw new Error(`GitHub update dispatch failed (HTTP ${response.status}).`);
    return true;
  } catch (error) {
    // Fixed fields only: never log credentials, request/response bodies, headers,
    // URLs or raw exception messages (transport errors may include those).
    console.error("github-dispatch-failed", {
      phase: githubStatus === undefined ? "transport" : "http",
      httpStatus: githubStatus ?? null,
    });
    await finishUpdate(sql, owner, [null, null], [...REPORTS]);
    throw error;
  }
}
