import { defaultSignalSettings, signalMarket } from "@workspace/cot-engine";
import { leaseGuard, statement, type Sql } from "./database";
import { getRun } from "./repository";
import type { History, ReportKey } from "./types";

export async function stagePublicHistories(db: Sql, owner: string, report: ReportKey, histories: Map<string, History>) {
  const run = await getRun(db, owner, report);
  if (!run || run.state !== "loading") throw new Error("No active report staging run.");
  const statements = [...histories].map(([name, history]) => {
    const payload = JSON.stringify({
      report, marketName: name, reportAsOf: run.report_as_of, checkedAt: new Date().toISOString(), sourceWarning: null,
      rows: history.rows.map(row => ({ date: row.date, largeTraders: row.large_traders, smallTraders: row.small_traders, commercialHedgers: row.commercial_hedgers, openInterest: row.open_interest ?? null })),
    });
    if (new TextEncoder().encode(payload).length > 1_900_000) throw new Error("Prepared market response exceeds D1's row limit.");
    return statement(db, `INSERT INTO cot_cf_public_histories(run_id,market_name,payload) VALUES(?,?,?)
      ON CONFLICT(run_id,market_name) DO UPDATE SET payload=excluded.payload`, run.id, name, payload);
  });
  await db.batch([leaseGuard(db, owner, "EXISTS(SELECT 1 FROM cot_cf_runs WHERE id=? AND state='loading')", [run.id]), ...statements]);
}

export async function stageSignals(db: Sql, owner: string, report: ReportKey, markets: ReturnType<typeof signalMarket>[]) {
  const run = await getRun(db, owner, report);
  if (!run || run.state !== "loading" || markets.length !== run.markets.length) throw new Error("Cannot prepare an incomplete scan.");
  const data = {
    report, reportAsOf: run.report_as_of, startedAt: new Date(run.started_at).toISOString(), updatedAt: new Date().toISOString(),
    status: "ready", message: null, total: markets.length, processed: markets.length, settings: defaultSignalSettings, markets,
  };
  const expired = {
    ...data, message: "The official report is over nine days old; fresh setups are unavailable.",
    markets: markets.map(m => m.status === "ready" ? { ...m, status: "stale", signal: "unavailable", setupScore: null, message: `Official report ${run.report_as_of} is over nine days old; publication may be delayed.` } : m),
  };
  const payload = JSON.stringify(data), stale = JSON.stringify(expired);
  if (new TextEncoder().encode(payload + stale).length > 1_900_000) throw new Error("Prepared scan exceeds D1's row limit.");
  await db.batch([
    leaseGuard(db, owner, "EXISTS(SELECT 1 FROM cot_cf_runs WHERE id=? AND state='loading')", [run.id]),
    statement(db, `INSERT INTO cot_cf_signals(run_id,payload,stale_payload) VALUES(?,?,?)
      ON CONFLICT(run_id) DO UPDATE SET payload=excluded.payload,stale_payload=excluded.stale_payload`, run.id, payload, stale),
  ]);
}
