import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { BENCHMARK, POSITIONING_MARKETS, SECTOR_ETFS } from "@workspace/cot-engine";
import { NOW, statement, type Sql } from "./database";
import { RestD1 } from "./rest-d1";
import { buildSnapshot } from "./sectors-compute";
import { SECTORS_JOB } from "./sectors-launcher";
import { cftcPositioning, priceSource, treasuryYields, type DailyCloses, type PositioningHistory } from "./sectors-sources";

/** Store the snapshot as the current document and in the dated history, atomically, and mark the job done. */
export async function saveSnapshot(db: Sql, key: string, asOf: string, payload: string, job = SECTORS_JOB) {
  await db.batch([
    statement(db, `INSERT INTO cot_cf_documents(key,as_of,payload,updated_at) VALUES(?,?,?,${NOW})
      ON CONFLICT(key) DO UPDATE SET as_of=excluded.as_of,payload=excluded.payload,updated_at=excluded.updated_at`, key, asOf, payload),
    statement(db, `INSERT INTO cot_cf_document_history(key,as_of,payload) VALUES(?,?,?)
      ON CONFLICT(key,as_of) DO UPDATE SET payload=excluded.payload`, key, asOf, payload),
    statement(db, `INSERT INTO cot_cf_jobs(id,last_success_at,last_error) VALUES(?,${NOW},NULL)
      ON CONFLICT(id) DO UPDATE SET last_success_at=excluded.last_success_at,last_error=NULL`, job),
  ]);
}

async function main() {
  const source = priceSource();
  const prices = new Map<string, DailyCloses>();
  const tickers = [BENCHMARK, ...SECTOR_ETFS.map(s => s.ticker)];
  for (const t of tickers) prices.set(t, await source.daily(t, true));
  for (const m of POSITIONING_MARKETS) if (m.priceTicker) prices.set(m.priceTicker, await source.daily(m.priceTicker, false));
  const positioning = new Map<string, PositioningHistory>();
  for (const m of POSITIONING_MARKETS) positioning.set(m.id, await cftcPositioning(m.report, m.code, process.env.CFTC_APP_TOKEN || undefined));
  // Yields are context only: the snapshot is still saved without them if Treasury is unreachable.
  const yields = await treasuryYields().catch(() => null);
  const snapshot = buildSnapshot({ generatedAt: new Date().toISOString(), priceSource: source.name, prices, positioning, y10: yields?.y10 ?? null, y2: yields?.y2 ?? null });

  const config = JSON.parse(await readFile(new URL("../../../wrangler.jsonc", import.meta.url), "utf8"));
  const db = new RestD1(process.env.CLOUDFLARE_ACCOUNT_ID ?? "", config.d1_databases?.[0]?.database_id ?? "", process.env.CLOUDFLARE_D1_TOKEN ?? "");
  await saveSnapshot(db, "sectors", snapshot.pricesAsOf, JSON.stringify(snapshot));
  console.info(`Sectors snapshot saved: prices ${snapshot.pricesAsOf}, positioning ${snapshot.positioningAsOf}.`);
}

if (process.argv[1]?.endsWith("sectors-cli.ts")) {
  main().catch(error => {
    // Fixed message only: provider responses and credentials are never printed.
    console.error(error instanceof Error && /^(Price source|CFTC|Treasury|Prices are|Positioning is|Benchmark|Too little|Unknown price)/.test(error.message) ? error.message : "Sectors snapshot failed.");
    process.exitCode = 1;
  });
}
