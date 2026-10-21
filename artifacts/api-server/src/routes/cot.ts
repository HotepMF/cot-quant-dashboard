import { Router, type IRouter } from "express";
import type { RawRow } from "@workspace/cot-engine";
import { loadSnapshot, savedMarketHistory } from "../services/cot-snapshots";
import { logger } from "../lib/logger";

const router: IRouter = Router();

export type ReportKey = "futures" | "combined";
type CftcMarketRow = {
  market_and_exchange_names?: string;
  cftc_contract_market_code?: string;
  report_date_as_yyyy_mm_dd?: string;
  open_interest_all?: string;
  noncomm_positions_long_all?: string;
  noncomm_positions_short_all?: string;
  comm_positions_long_all?: string;
  comm_positions_short_all?: string;
  nonrept_positions_long_all?: string;
  nonrept_positions_short_all?: string;
  ":updated_at"?: string;
};
type CftcCache<T> = { expiresAt: number; promise: Promise<T> };

export const datasets: Record<ReportKey, string> = {
  futures: "6dca-aqww",
  combined: "jun7-fc8e",
};
const cache = new Map<string, CftcCache<unknown>>();
const positionFields = [
  "market_and_exchange_names",
  "cftc_contract_market_code",
  "report_date_as_yyyy_mm_dd",
  "open_interest_all",
  "noncomm_positions_long_all",
  "noncomm_positions_short_all",
  "comm_positions_long_all",
  "comm_positions_short_all",
  "nonrept_positions_long_all",
  "nonrept_positions_short_all",
].join(", ");

function isReleaseWindow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return weekday === "Fri" && hour >= 15 && hour < 21;
}

export function cacheTtl(normalTtl: number) {
  return isReleaseWindow() ? 10 * 60 * 1000 : normalTtl;
}

function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key) as CftcCache<T> | undefined;
  if (existing && existing.expiresAt > now) return existing.promise;

  const promise = load();
  cache.set(key, { expiresAt: now + ttl, promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

export async function queryCftc<T>(dataset: string, query: string, timeout = 15_000): Promise<T[]> {
  const url = new URL(`https://publicreporting.cftc.gov/api/v3/views/${dataset}/query.json`);
  url.searchParams.set("pageNumber", "1");
  url.searchParams.set("pageSize", "5000");
  url.searchParams.set("query", query);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.CFTC_APP_TOKEN) headers["X-App-Token"] = process.env.CFTC_APP_TOKEN;

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`CFTC returned HTTP ${response.status}. Try again later.`);
  const result: unknown = await response.json();
  if (!Array.isArray(result)) throw new Error("CFTC returned an unexpected report format.");
  return result as T[];
}

export function getReportKey(value: unknown): ReportKey | undefined {
  return value === "futures" || value === "combined" ? value : undefined;
}

export function normalizeDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function getMarkets(report: ReportKey, refresh = false, allowSaved = true) {
  const dataset = datasets[report];
  if (refresh) cache.delete(`markets:${report}`);
  try {
  return await cached(`markets:${report}`, cacheTtl(30 * 60 * 1000), async () => {
    const newest = await queryCftc<CftcMarketRow>(
      dataset,
      "SELECT report_date_as_yyyy_mm_dd ORDER BY report_date_as_yyyy_mm_dd DESC LIMIT 1",
    );
    const reportAsOf = normalizeDate(newest[0]?.report_date_as_yyyy_mm_dd);
    if (!reportAsOf) throw new Error("The latest CFTC report date could not be read.");

    const dateLiteral = `${reportAsOf}T00:00:00.000`;
    const rows = await queryCftc<CftcMarketRow>(
      dataset,
      `SELECT market_and_exchange_names, cftc_contract_market_code WHERE report_date_as_yyyy_mm_dd = ${sqlString(dateLiteral)} ORDER BY market_and_exchange_names ASC LIMIT 2000`,
    );
    const markets = Array.from(
      new Map(
        rows
          .filter((row) => row.market_and_exchange_names && row.cftc_contract_market_code)
          .map((row) => [
            `${row.cftc_contract_market_code}:${row.market_and_exchange_names}`,
            { name: row.market_and_exchange_names!, code: row.cftc_contract_market_code! },
          ]),
      ).values(),
    );
    if (!markets.length) throw new Error("No markets were returned for the latest CFTC report.");
    return { report, reportAsOf, checkedAt: new Date().toISOString(), markets, source: "official" as const };
  });
  } catch (error) {
    if (!allowSaved) throw error;
    const saved = await loadSnapshot(report);
    if (!saved) throw error;
    logger.warn({ report }, "CFTC market list unavailable; returning dated saved snapshot");
    return {
      report, reportAsOf: saved.reportAsOf, checkedAt: saved.checkedAt, markets: saved.markets, source: "saved" as const,
    };
  }
}

/** Keep detail and report-wide views on the same successfully fetched source snapshot. */
export function seedMarketHistory(report: ReportKey, marketName: string, raw: RawRow[], checkedAt: string) {
  if (raw.length < 3) return;
  const rows = raw.map(row => ({
    date: row.date, largeTraders: row.large_traders, smallTraders: row.small_traders,
    commercialHedgers: row.commercial_hedgers, openInterest: row.open_interest ?? null,
  }));
  cache.set(`series:${report}:${marketName}`, {
    expiresAt: Date.now() + cacheTtl(6 * 60 * 60 * 1000),
    promise: Promise.resolve({ report, marketName, reportAsOf: rows[rows.length - 1].date, checkedAt, rows }),
  });
}

router.get("/cot/markets", async (req, res) => {
  const report = getReportKey(req.query.report);
  if (!report) return res.status(400).json({ message: "Choose a supported CFTC report: futures or combined." });
  try {
    const result = await getMarkets(report);
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json(result);
  } catch (error) {
    return res.status(502).json({ message: error instanceof Error ? error.message : "CFTC market lookup failed." });
  }
});

router.get("/cot/market", async (req, res) => {
  const report = getReportKey(req.query.report);
  const marketName = typeof req.query.market === "string" ? req.query.market.trim() : "";
  if (!report) return res.status(400).json({ message: "Choose a supported CFTC report: futures or combined." });
  if (!marketName || marketName.length > 200) return res.status(400).json({ message: "Choose a valid market from the CFTC market list." });

  try {
    const result = await cached(`series:${report}:${marketName}`, cacheTtl(6 * 60 * 60 * 1000), async () => {
      const dataset = datasets[report];
      const rows = await queryCftc<CftcMarketRow>(
        dataset,
        `SELECT ${positionFields} WHERE market_and_exchange_names = ${sqlString(marketName)} ORDER BY report_date_as_yyyy_mm_dd ASC LIMIT 5000`,
      );
      const series = rows.flatMap((row) => {
        const date = normalizeDate(row.report_date_as_yyyy_mm_dd);
        const largeLong = Number(row.noncomm_positions_long_all);
        const largeShort = Number(row.noncomm_positions_short_all);
        const commercialLong = Number(row.comm_positions_long_all);
        const commercialShort = Number(row.comm_positions_short_all);
        const smallLong = Number(row.nonrept_positions_long_all);
        const smallShort = Number(row.nonrept_positions_short_all);
        const openInterest = Number(row.open_interest_all);
        if (!date || ![largeLong, largeShort, commercialLong, commercialShort, smallLong, smallShort].every(Number.isFinite)) return [];
        return [{
          date,
          largeTraders: largeLong - largeShort,
          smallTraders: smallLong - smallShort,
          commercialHedgers: commercialLong - commercialShort,
          openInterest: Number.isFinite(openInterest) ? openInterest : null,
        }];
      });
      if (series.length < 3) throw new Error("CFTC returned fewer than three usable weekly observations for this market.");
      const reportAsOf = series[series.length - 1]?.date;
      return { report, marketName, reportAsOf, checkedAt: new Date().toISOString(), rows: series };
    });
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json(result);
  } catch (error) {
    const saved = await loadSnapshot(report).catch(() => null);
    const fallback = saved && savedMarketHistory(saved, marketName);
    if (fallback) {
      res.setHeader("Cache-Control", "no-store");
      res.json(fallback);
      return;
    }
    return res.status(502).json({ message: error instanceof Error ? error.message : "CFTC market history could not be loaded." });
  }
});

export default router;
