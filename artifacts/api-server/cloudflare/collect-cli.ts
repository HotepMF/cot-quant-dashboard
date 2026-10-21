import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { collectReports } from "./collector";
import { RestD1 } from "./rest-d1";

async function main() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const token = process.env.CLOUDFLARE_D1_TOKEN ?? "";
  const config = JSON.parse(await readFile(new URL("../../../wrangler.jsonc", import.meta.url), "utf8"));
  const db = new RestD1(account, config.d1_databases?.[0]?.database_id ?? "", token);
  const result = await collectReports(db, process.env.CFTC_JOB_OWNER, process.env.CFTC_APP_TOKEN, process.env.CFTC_FORCE_REFRESH === "true");
  if (result.failures.length) throw new Error("A report could not be completed; last-good data is preserved and the scheduler will retry.");
  console.info(result.skipped ? "Another collection is already running or the refresh cooldown is active." : "Both official CFTC reports are complete and ready.");
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : "CFTC collection failed.");
  process.exitCode = 1;
});
