import type { Sql } from "./database";
import { acquireUpdate, finishUpdate } from "./repository";
import { REPORTS, type Env } from "./types";

export async function launchUpdate(sql: Sql, env: Env, force = false) {
  const owner = crypto.randomUUID();
  if (!await acquireUpdate(sql, owner, force)) return false;
  try {
    await env.CFTC_UPDATER.create({ id: owner, params: { owner } });
    return true;
  } catch (error) {
    await finishUpdate(sql, owner, [null, null], [...REPORTS]);
    throw error;
  }
}
