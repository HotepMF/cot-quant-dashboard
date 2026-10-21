import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { withDatabase } from "./database";
import { officialHistories, officialMarkets } from "./cftc-source";
import { commitRun, failRun, finishUpdate, getRun, initializeRun, renewLease, stageHistories } from "./repository";
import { REPORTS, type Env } from "./types";

const STEP = { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "5 minutes" } as const;

export class CftcUpdateWorkflow extends WorkflowEntrypoint<Env, { owner: string }> {
  async run(event: WorkflowEvent<{ owner: string }>, step: WorkflowStep) {
    const owner = event.payload.owner;
    if (owner !== event.instanceId) throw new Error("Workflow fencing token does not match its instance.");
    const dates: (string | null)[] = [];
    const failures: string[] = [];
    for (const report of REPORTS) {
      try {
        const metadata = await step.do(`${report}: official market list`, STEP, async () =>
          withDatabase(this.env, async sql => {
            await renewLease(sql, owner);
            const existing = await getRun(sql, owner, report);
            const run = existing ?? await initializeRun(sql, owner, report, await officialMarkets(report, this.env.CFTC_APP_TOKEN));
            // Only small metadata is persisted in Workflow step results.
            return { reportAsOf: run.report_as_of, markets: run.markets };
          }));
        for (let i = 0; i < metadata.markets.length; i += 20) {
          const batch = metadata.markets.slice(i, i + 20);
          await step.do(`${report}: history batch ${i / 20 + 1}`, STEP, async () =>
            withDatabase(this.env, async sql => {
              await renewLease(sql, owner);
              const histories = await officialHistories(report, metadata.reportAsOf, batch, this.env.CFTC_APP_TOKEN);
              await stageHistories(sql, owner, report, histories);
              return { count: histories.size };
            }));
        }
        const saved = await step.do(`${report}: commit complete snapshot`, STEP, () =>
          withDatabase(this.env, sql => commitRun(sql, owner, report)));
        dates.push(saved.reportAsOf);
      } catch (error) {
        console.error("cftc-workflow-report-failed", { report, kind: error instanceof Error ? error.name : "UnknownError" });
        failures.push(report);
        dates.push(null);
        await step.do(`${report}: preserve last good snapshot`, STEP, () =>
          withDatabase(this.env, sql => failRun(sql, owner, report)));
      }
    }
    await step.do("record completion and next Eastern-time check", STEP, () =>
      withDatabase(this.env, sql => finishUpdate(sql, owner, dates, failures)));
    return { reports: dates, failures };
  }
}
