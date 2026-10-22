import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { CORE_MARKETS, DEMO_MARKETS, DEMO_STATE_VERSION, HAND_PARTICIPATION, HAND_RANGE_TICKERS, HAND_TICKERS, advanceDemo, emptyDemo, type DemoPayload, type DemoState, type WeekBar } from "@workspace/cot-engine";
import { buildHand, completedWeeks, filterByWeek } from "./hand-compute";
import { cftcParticipation, siteHistories, treasuryCurve, yahooBars, type DailyBars } from "./hand-sources";
import { statement } from "./database";
import { RestD1 } from "./rest-d1";
import { saveSnapshot } from "./sectors-cli";
import { priceSource, type DailyCloses } from "./sectors-sources";

export const HAND_JOB = "invisible-hand";
export const DEMO_JOB = "demo-account";

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
  const rangeBars = new Map<"ES" | "NQ", DailyBars>();
  for (const [market, ticker] of Object.entries(HAND_RANGE_TICKERS) as ["ES" | "NQ", string][]) {
    try { rangeBars.set(market, await yahooBars(ticker)); } catch { console.warn(`Price unavailable: ${ticker}`); }
  }
  const coreCodes = new Map(CORE_MARKETS.filter(m => m.code).map(m => [m.code!, m.symbol]));
  const histories = await siteHistories(coreCodes).catch(() => { console.warn("Site histories unavailable."); return undefined; });
  const snapshot = buildHand({ generatedAt: new Date().toISOString(), priceSource: source.name, prices, curve, participation, rangeBars, siteHistories: histories });
  // Demo account inputs: completed weekly bars and the default filter per week, for every demo market.
  const demoBars: Record<string, WeekBar[]> = {}, filters: Record<string, Record<string, 1 | -1 | 0>> = {};
  for (const m of DEMO_MARKETS) {
    try { demoBars[m.code] = completedWeeks(await yahooBars(m.ticker, "2y")); } catch { console.warn(`Price unavailable: ${m.ticker}`); }
    const h = histories?.get(m.code);
    if (h) filters[m.code] = filterByWeek(h);
  }
  if (process.argv.includes("--dry-run")) {
    console.info(JSON.stringify(snapshot, null, 2));
    const demo = advanceDemo(emptyDemo(), demoBars, filters);
    console.info(JSON.stringify({ demo: { ...demo, markets: Object.fromEntries(Object.entries(demo.markets).filter(([, s]) => s.order || s.position)) } }, null, 2));
    return;
  }

  const config = JSON.parse(await readFile(new URL("../../../wrangler.jsonc", import.meta.url), "utf8"));
  const db = new RestD1(process.env.CLOUDFLARE_ACCOUNT_ID ?? "", config.d1_databases?.[0]?.database_id ?? "", process.env.CLOUDFLARE_D1_TOKEN ?? "");
  // One history row per CFTC week: later price refreshes in the same week update it in place.
  await saveSnapshot(db, HAND_JOB, snapshot.positioningAsOf, JSON.stringify(snapshot), HAND_JOB);
  console.info(`Invisible Hand numbers saved: positioning ${snapshot.positioningAsOf}, prices ${snapshot.pricesAsOf}.`);
  // The demo account advances once per completed week; a failure here never affects the numbers above.
  try {
    const saved = await statement(db, "SELECT payload FROM cot_cf_documents WHERE key=?", DEMO_JOB).first<{ payload: string }>();
    const stored: DemoState | null = saved ? JSON.parse(saved.payload) : null;
    // An account saved in an older format restarts clean (v1 could place orders for a week already under way).
    const prev: DemoState = stored && stored.version >= DEMO_STATE_VERSION ? stored : emptyDemo();
    const next = advanceDemo(prev, demoBars, filters);
    if (next.lastWeek && (next.lastWeek !== prev.lastWeek || stored?.version !== next.version)) {
      const filtersNow = DEMO_MARKETS.flatMap(m => {
        const dir = filters[m.code]?.[next.lastWeek!];
        return dir ? [{ code: m.code, symbol: m.symbol, dir, week: next.lastWeek! }] : [];
      });
      const payload: DemoPayload = { ...next, updatedAt: new Date().toISOString(), filtersNow };
      await saveSnapshot(db, DEMO_JOB, next.lastWeek, JSON.stringify(payload), DEMO_JOB);
      console.info(`Demo account advanced to week ending ${next.lastWeek}: ${next.trades.length} closed trades.`);
    }
  } catch { console.warn("Demo account update failed; it will catch up on the next run."); }
}

if (process.argv[1]?.endsWith("hand-cli.ts")) {
  main().catch(error => {
    // Fixed message only: provider responses and credentials are never printed.
    console.error(error instanceof Error && /^(Price source|CFTC|Treasury|Benchmark|Positioning is|Too little|Unknown price)/.test(error.message) ? error.message : "Invisible Hand job failed.");
    process.exitCode = 1;
  });
}
