import { defaultSignalSettings, signalMarket } from "@workspace/cot-engine";
import { officialHistories, officialMarkets } from "./cftc-source";
import { statement, type Sql } from "./database";
import { stagePublicHistories, stageSignals } from "./prepared";
import { acquireUpdate, commitRun, failRun, finishUpdate, initializeRun, renewLease, stageHistories, viewMetadata } from "./repository";
import { REPORTS, type ReportKey } from "./types";

export async function retry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run(); }
    catch (error) {
      if (attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}

export async function collectReports(db: Sql, dispatchedOwner?: string, token?: string, forceRefresh = false) {
  const owner = dispatchedOwner || crypto.randomUUID();
  if (!/^[a-f0-9-]{36}$/i.test(owner)) throw new Error("Invalid collection owner.");
  if (dispatchedOwner) await renewLease(db, owner);
  else if (!await acquireUpdate(db, owner, true)) return { skipped: true, failures: [] };
  const dates: (string | null)[] = [];
  const failures: string[] = [];
  for (const report of REPORTS) {
    try {
      await renewLease(db, owner);
      const metadata = await retry(() => officialMarkets(report, token));
      const saved = await viewMetadata(db, report, true);
      const prepared = saved && await statement(db, "SELECT run_id FROM cot_cf_signals WHERE run_id=?", saved.runId).first();
      const publicCount = saved && await statement(db, "SELECT count(*) AS n FROM cot_cf_public_histories WHERE run_id=?", saved.runId).first<number>("n");
      if (saved && metadata.reportAsOf < saved.reportAsOf) throw new Error("An older official report cannot replace a newer saved snapshot.");
      if (!forceRefresh && saved && prepared && publicCount === saved.markets.length && saved.reportAsOf === metadata.reportAsOf && saved.markets.length === metadata.markets.length &&
          saved.markets.every((m, i) => m.name === metadata.markets[i]?.name && m.code === metadata.markets[i]?.code)) {
        dates.push(saved.reportAsOf);
        continue;
      }
      await initializeRun(db, owner, report, metadata);
      const signals: ReturnType<typeof signalMarket>[] = [];
      for (let i = 0; i < metadata.markets.length; i += 20) {
        await renewLease(db, owner);
        const batch = metadata.markets.slice(i, i + 20);
        const histories = await retry(() => officialHistories(report, metadata.reportAsOf, batch, token));
        await stageHistories(db, owner, report, histories);
        await stagePublicHistories(db, owner, report, histories);
        for (const market of batch) signals.push(signalMarket(market, histories.get(market.name), metadata.reportAsOf, defaultSignalSettings));
      }
      await stageSignals(db, owner, report, signals);
      await commitRun(db, owner, report, true);
      dates.push(metadata.reportAsOf);
    } catch (error) {
      // Do not print provider responses, SQL parameter values, or credentials.
      console.error("cftc-collection-report-failed", { report, kind: error instanceof Error ? error.name : "UnknownError" });
      failures.push(report);
      dates.push(null);
      await failRun(db, owner, report as ReportKey);
    }
  }
  await finishUpdate(db, owner, dates, failures);
  return { skipped: false, failures };
}
