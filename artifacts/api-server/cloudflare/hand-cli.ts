import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { CASE_MARKETS, CORE_MARKETS, HAND_PARTICIPATION, HAND_RANGE_TICKERS, HAND_TICKERS, sectorOf, updateSectorBreakLog, type CaseLog, type IntradayBars, type SectorBreakLog } from "@workspace/cot-engine";
import { buildHand, caseInputs, completeThrough, oscillatorSnapshot } from "./hand-compute";
import { updateCaseLog } from "@workspace/cot-engine";
import { cftcParticipation, siteHistories, treasuryCurve, upTo, yahooBars, yahooIntraday, type DailyBars } from "./hand-sources";
import { statement } from "./database";
import { RestD1 } from "./rest-d1";
import { saveSnapshot } from "./sectors-cli";
import { priceSource, type DailyCloses } from "./sectors-sources";

export const HAND_JOB = "invisible-hand";
/** The demo account was retired on Oct 27, 2026; its last saved record stays in D1 under "demo-account". */
export const CASE_LOG_JOB = "case-log";
export const OSC_JOB = "oscillators";
/** The live record starts with the first report under the 8-week default. */
export const CASE_LOG_START = "2026-10-20";
export const SECTOR_BREAK_JOB = "sector-breaks";

/**
 * The Invisible Hand numbers. Runs right after each CFTC collection (positioning) and after each evening
 * sectors job (prices and yields), so the page has fresh positioning minutes after Friday's release.
 * `--dry-run` prints the snapshot instead of saving it.
 */
async function main() {
  const token = process.env.CFTC_APP_TOKEN || undefined;
  const source = priceSource();
  const prices = new Map<string, DailyCloses>();
  for (const t of HAND_TICKERS) {
    // VIX indexes and single stocks are context: one missing ticker leaves its reading blank, not the whole run.
    try { prices.set(t, await source.daily(t, !t.startsWith("^"))); }
    catch (error) { if (t === "SPY") throw error; console.warn(`Price unavailable: ${t}`); }
  }
  const participation = new Map<string, Awaited<ReturnType<typeof cftcParticipation>>>();
  for (const spec of HAND_PARTICIPATION) participation.set(spec.code, await cftcParticipation(spec.report, spec.code, spec.categories, token));
  const curve = await treasuryCurve().catch(() => null);
  // Day-trader backdrop: context only, so a failure here leaves those panels empty rather than failing the run.
  // Completed sessions only: in the evening Yahoo already carries tonight's live session as a bar dated tomorrow.
  const rangeBars = new Map<"ES" | "NQ", DailyBars>();
  for (const [market, ticker] of Object.entries(HAND_RANGE_TICKERS) as ["ES" | "NQ", string][]) {
    try { rangeBars.set(market, upTo(await yahooBars(ticker), completeThrough())); } catch { console.warn(`Price unavailable: ${ticker}`); }
  }
  const coreCodes = new Map(CORE_MARKETS.filter(m => m.code).map(m => [m.code!, m.symbol]));
  const histories = await siteHistories(coreCodes).catch(() => { console.warn("Site histories unavailable."); return undefined; });
  const snapshot = buildHand({ generatedAt: new Date().toISOString(), priceSource: source.name, prices, curve, participation, rangeBars, siteHistories: histories });
  const daily = new Map<string, DailyBars>();
  for (const m of CASE_MARKETS) {
    try { daily.set(m.code, await yahooBars(m.ticker, "2y")); } catch { console.warn(`Price unavailable: ${m.ticker}`); }
  }
  // The 8-week reading's live record and today's oscillators (shown next to the reading on the site).
  const through = completeThrough();
  const inputs = histories ? caseInputs(histories, daily) : [];
  const osc = oscillatorSnapshot(inputs, through);
  // Sector breaks in the week after each reading: 15-minute closes for every market that has a sector.
  const intraday = new Map<string, IntradayBars>();
  for (const m of CASE_MARKETS.filter(m => sectorOf(m.symbol))) {
    try { intraday.set(m.symbol, await yahooIntraday(m.ticker)); } catch { console.warn(`Intraday prices unavailable: ${m.ticker}`); }
  }
  const breakInputs = inputs.map(x => ({ code: x.code, symbol: x.symbol, reportDate: x.reportDate, dir: x.dir, dailyClose: x.bars.close.slice(0, x.bars.dates.filter(d => d <= through).length) }));
  if (process.argv.includes("--dry-run")) {
    console.info(JSON.stringify({ oscillators: osc, caseLog: updateCaseLog(null, inputs, through, CASE_LOG_START), sectorBreaks: updateSectorBreakLog(null, breakInputs, intraday, CASE_LOG_START) }, null, 2));
    console.info(JSON.stringify(snapshot, null, 2));
    return;
  }

  const config = JSON.parse(await readFile(new URL("../../../wrangler.jsonc", import.meta.url), "utf8"));
  const db = new RestD1(process.env.CLOUDFLARE_ACCOUNT_ID ?? "", config.d1_databases?.[0]?.database_id ?? "", process.env.CLOUDFLARE_D1_TOKEN ?? "");
  // One history row per CFTC week: later price refreshes in the same week update it in place.
  await saveSnapshot(db, HAND_JOB, snapshot.positioningAsOf, JSON.stringify(snapshot), HAND_JOB);
  console.info(`Invisible Hand numbers saved: positioning ${snapshot.positioningAsOf}, prices ${snapshot.pricesAsOf}.`);
  // Oscillators and the case log: context only; a failure here never affects the numbers above.
  try {
    if (inputs.length) {
      await saveSnapshot(db, OSC_JOB, osc.asOf, JSON.stringify(osc), OSC_JOB);
      const saved = await statement(db, "SELECT payload FROM cot_cf_documents WHERE key=?", CASE_LOG_JOB).first<{ payload: string }>();
      const prev: CaseLog | null = saved ? JSON.parse(saved.payload) : null;
      const next = updateCaseLog(prev, inputs, through, CASE_LOG_START);
      await saveSnapshot(db, CASE_LOG_JOB, through, JSON.stringify(next), CASE_LOG_JOB);
      console.info(`Case log: ${next.cases.length} cases, ${next.cases.filter(c => c.outcome).length} with outcomes.`);
    }
  } catch { console.warn("Oscillator / case-log update failed; it will catch up on the next run."); }
  try {
    if (inputs.length && intraday.size) {
      const saved = await statement(db, "SELECT payload FROM cot_cf_documents WHERE key=?", SECTOR_BREAK_JOB).first<{ payload: string }>();
      const prev: SectorBreakLog | null = saved ? JSON.parse(saved.payload) : null;
      const next = updateSectorBreakLog(prev, breakInputs, intraday, CASE_LOG_START);
      await saveSnapshot(db, SECTOR_BREAK_JOB, through, JSON.stringify(next), SECTOR_BREAK_JOB);
      console.info(`Sector break log: ${next.cases.length} reading weeks, ${next.cases.filter(c => c.status === "broke").length} with a sector break.`);
    }
  } catch { console.warn("Sector break log update failed; it will catch up on the next run."); }
}

if (process.argv[1]?.endsWith("hand-cli.ts")) {
  main().catch(error => {
    // Fixed message only: provider responses and credentials are never printed.
    console.error(error instanceof Error && /^(Price source|CFTC|Treasury|Benchmark|Positioning is|Too little|Unknown price)/.test(error.message) ? error.message : "Invisible Hand job failed.");
    process.exitCode = 1;
  });
}
