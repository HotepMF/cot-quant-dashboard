import type { RawRow, SignalSettings } from "@workspace/cot-engine";
import type { CotSignalMarket, CotScreenerResponse } from "@workspace/api-zod";
import { cacheTtl, datasets, getMarkets, normalizeDate, queryCftc, seedMarketHistory, sqlString, type ReportKey } from "../routes/cot";
import { logger } from "../lib/logger";
import { loadSnapshot, saveSnapshot, type CotSnapshot } from "./cot-snapshots";
import { signalMarket } from "./cot-signal-model";
export { signalMarket, parseSignalSettings } from "./cot-signal-model";

type Market = { name: string; code: string };
type History = { rows: RawRow[]; error: string | null };
export type Scan = {
  report: ReportKey; reportAsOf: string; startedAt: string; updatedAt: string;
  status: "loading" | "ready" | "error"; message: string | null;
  markets: Market[]; histories: Map<string, History>; processed: number; expiresAt: number;
  views: Map<string, CotSignalMarket[]>;
  persisted: boolean;
};
type SourceRow = {
  market_and_exchange_names?: string; report_date_as_yyyy_mm_dd?: string;
  large_traders?: string; commercial_hedgers?: string; small_traders?: string; open_interest?: string;
};
const scans = new Map<ReportKey, Scan>();
const projection = [
  "market_and_exchange_names", "report_date_as_yyyy_mm_dd",
  "noncomm_positions_long_all - noncomm_positions_short_all AS large_traders",
  "comm_positions_long_all - comm_positions_short_all AS commercial_hedgers",
  "nonrept_positions_long_all - nonrept_positions_short_all AS small_traders",
  "open_interest_all AS open_interest",
].join(", ");

const numeric = (value: unknown) => value == null || value === "" ? Number.NaN : Number(value);

async function fetchBatch(scan: Scan, markets: Market[]) {
  const grouped = new Map(markets.map(m => [m.name, new Map<string, RawRow>()]));
  const bad = new Set<string>();
  const names = markets.map(m => sqlString(m.name)).join(", ");
  for (let page = 0; page < 100; page++) {
    if (scans.get(scan.report) !== scan) return;
    const query = `SELECT ${projection} WHERE market_and_exchange_names IN (${names}) AND report_date_as_yyyy_mm_dd <= ${sqlString(`${scan.reportAsOf}T00:00:00.000`)} ORDER BY market_and_exchange_names ASC, report_date_as_yyyy_mm_dd ASC LIMIT 5000 OFFSET ${page * 5000}`;
    let source: SourceRow[];
    try {
      source = await queryCftc<SourceRow>(datasets[scan.report], query, 30_000);
    } catch {
      // One bounded retry prevents a transient source failure becoming a permanent missing sector.
      await new Promise(resolve => setTimeout(resolve, 800));
      source = await queryCftc<SourceRow>(datasets[scan.report], query, 30_000);
    }
    for (const row of source) {
      const name = row.market_and_exchange_names ?? "";
      const history = grouped.get(name);
      if (!history) continue;
      const date = normalizeDate(row.report_date_as_yyyy_mm_dd);
      const large = numeric(row.large_traders), commercial = numeric(row.commercial_hedgers), small = numeric(row.small_traders), oi = numeric(row.open_interest);
      if (!date || ![large, commercial, small].every(Number.isFinite)) { bad.add(name); continue; }
      const parsed: RawRow = { date, large_traders: large, commercial_hedgers: commercial, small_traders: small, ...(Number.isFinite(oi) ? { open_interest: oi } : {}) };
      const existing = history.get(date);
      if (existing && JSON.stringify(existing) !== JSON.stringify(parsed)) bad.add(name);
      history.set(date, parsed);
    }
    if (source.length < 5000) break;
    if (page === 99) throw new Error("History exceeded the safe pagination limit; this batch was not treated as complete.");
  }
  for (const market of markets) {
    const rows = [...grouped.get(market.name)!.values()].sort((a, b) => a.date.localeCompare(b.date));
    const error = bad.has(market.name) ? "Invalid or conflicting official observations; this market was excluded." : rows.length === 0 ? "No official observations returned for this market." : null;
    scan.histories.set(market.name, { rows, error });
    if (!error) seedMarketHistory(scan.report, market.name, rows, new Date().toISOString());
  }
}

async function runScan(scan: Scan) {
  const batches: Market[][] = [];
  for (let i = 0; i < scan.markets.length; i += 20) batches.push(scan.markets.slice(i, i + 20));
  let next = 0;
  const worker = async () => {
    while (next < batches.length && scans.get(scan.report) === scan) {
      const batch = batches[next++];
      try { await fetchBatch(scan, batch); }
      catch (error) {
        const message = error instanceof Error ? error.message : "CFTC history request failed.";
        for (const market of batch) scan.histories.set(market.name, { rows: [], error: message });
        logger.warn({ report: scan.report, markets: batch.length, error: message }, "CFTC scan batch failed");
      }
      scan.processed += batch.length;
      scan.updatedAt = new Date().toISOString();
      scan.views.clear();
    }
  };
  try {
    await Promise.all(Array.from({ length: 3 }, worker));
    if (scans.get(scan.report) !== scan) return;
    const failed = [...scan.histories.values()].filter(h => h.error).length;
    scan.message = failed ? `${failed} market histories could not be verified; their signals are unavailable.` : null;
    if (!failed) {
      await saveSnapshot({
        version: 1, report: scan.report, reportAsOf: scan.reportAsOf, checkedAt: new Date().toISOString(),
        markets: scan.markets, histories: Object.fromEntries(scan.histories),
      });
      scan.persisted = true;
    }
    scan.status = "ready";
    scan.expiresAt = Date.now() + cacheTtl(6 * 60 * 60 * 1000);
    scan.updatedAt = new Date().toISOString();
    logger.info({ report: scan.report, total: scan.markets.length, failed }, "CFTC market-wide scan completed");
  } catch (error) {
    scan.status = "error";
    scan.message = error instanceof Error ? error.message : "Report-wide scan failed.";
    scan.expiresAt = Date.now() + 60_000;
  }
}

const restoring = new Map<ReportKey, Promise<void>>();
function restoreSnapshot(snapshot: CotSnapshot): Scan {
  for (const market of snapshot.markets) {
    const history = snapshot.histories[market.name];
    if (history && !history.error) seedMarketHistory(snapshot.report, market.name, history.rows, snapshot.checkedAt);
  }
  return {
    report: snapshot.report, reportAsOf: snapshot.reportAsOf, startedAt: snapshot.checkedAt, updatedAt: snapshot.checkedAt,
    status: "ready", message: null, markets: snapshot.markets, histories: new Map(Object.entries(snapshot.histories)),
    processed: snapshot.markets.length, expiresAt: Date.parse(snapshot.checkedAt) + cacheTtl(6 * 60 * 60 * 1000),
    views: new Map(), persisted: true,
  };
}
export async function ensureScan(report: ReportKey, refresh = false, officialOnly = false): Promise<Scan> {
  if (!scans.has(report)) {
    let pending = restoring.get(report);
    if (!pending) {
      pending = loadSnapshot(report).then(saved => {
        if (saved && !scans.has(report)) scans.set(report, restoreSnapshot(saved));
      }).finally(() => restoring.delete(report));
      restoring.set(report, pending);
    }
    await pending;
  }
  const existing = scans.get(report);
  // Coalesce visitors/refresh clicks, rather than fan out duplicate upstream scans.
  if (existing?.status === "loading") return existing;
  if (!refresh && existing && existing.expiresAt > Date.now()) return existing;
  if (refresh && existing?.status === "ready" && Date.now() - Date.parse(existing.startedAt) < 30_000) return existing;
  const latest = await getMarkets(report, refresh, !officialOnly);
  if (latest.source === "saved" && existing) {
    existing.message = "CFTC is temporarily unavailable; showing the last successful saved scan with its original report date.";
    existing.expiresAt = Date.now() + 5 * 60_000;
    return existing;
  }
  if (!refresh && existing && existing.reportAsOf === latest.reportAsOf && existing.expiresAt > Date.now()) return existing;
  // A concurrent caller might have started a job while this caller awaited the market list.
  const pending = scans.get(report);
  if (pending?.status === "loading") return pending;
  const startedAt = new Date().toISOString();
  const scan: Scan = {
    report, reportAsOf: latest.reportAsOf, startedAt, updatedAt: startedAt,
    status: "loading", message: null, markets: latest.markets, histories: new Map(), processed: 0,
    expiresAt: 0, views: new Map(), persisted: false,
  };
  scans.set(report, scan);
  void runScan(scan);
  return scan;
}

export async function waitForScan(scan: Scan) {
  while (scan.status === "loading") await new Promise(resolve => setTimeout(resolve, 200));
  if (scan.status !== "ready" || !scan.persisted || [...scan.histories.values()].some(history => history.error)) {
    throw new Error(scan.message ?? "The CFTC scan did not complete and save successfully.");
  }
  return scan;
}

// Zod's generated server types use Date, while the HTTP wire contract uses ISO date strings.
type WireResponse = Omit<CotScreenerResponse, "reportAsOf" | "startedAt" | "updatedAt"> & {
  reportAsOf: string; startedAt: string; updatedAt: string;
};
export function scanResponse(scan: Scan, settings: SignalSettings): WireResponse {
  const key = `${JSON.stringify(settings)}:${new Date().toISOString().slice(0, 10)}`;
  let markets = scan.views.get(key);
  if (!markets) {
    markets = scan.markets.map(market => signalMarket(market, scan.histories.get(market.name), scan.reportAsOf, settings));
    if (scan.views.size >= 20) scan.views.clear();
    scan.views.set(key, markets);
  }
  return {
    report: scan.report, reportAsOf: scan.reportAsOf, startedAt: scan.startedAt, updatedAt: scan.updatedAt,
    status: scan.status,
    message: scan.message ?? (Math.floor((Date.now() - Date.parse(`${scan.reportAsOf}T00:00:00Z`)) / 86_400_000) > 9 ? "The official report is over nine days old; fresh setups are unavailable." : null),
    total: scan.markets.length, processed: scan.processed,
    settings, markets,
  };
}
