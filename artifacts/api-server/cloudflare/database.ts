import type { Env } from "./types";

export type Sql = Pick<D1DatabaseSession, "prepare" | "batch">;

export async function withDatabase<T>(env: Pick<Env, "DB">, run: (sql: Sql) => Promise<T>): Promise<T> {
  if (!env.DB) throw new Error("Cloudflare D1 binding has not been configured.");
  // Coordination and snapshot pointers must start from the latest primary state.
  return run(env.DB.withSession("first-primary"));
}

export const NOW = "(CAST(strftime('%s','now') AS INTEGER)*1000)";
export const statement = (db: Sql, query: string, ...params: (string | number | null)[]) =>
  db.prepare(query).bind(...params);

// D1 batch() is atomic. A failed CHECK aborts ALL statements, including a lease
// renewal. Never simulate a transaction with separate BEGIN/COMMIT requests.
export const leaseGuard = (db: Sql, owner: string, extra = "1", params: (string | number)[] = []) =>
  statement(db, `INSERT INTO cot_cf_assertion(id,ok) VALUES(1,CASE WHEN
    EXISTS(SELECT 1 FROM cot_cf_leases WHERE id='weekly-cftc' AND owner=? AND expires_at>${NOW})
    AND (${extra}) THEN 1 ELSE 0 END) ON CONFLICT(id) DO UPDATE SET ok=excluded.ok`, owner, ...params);
