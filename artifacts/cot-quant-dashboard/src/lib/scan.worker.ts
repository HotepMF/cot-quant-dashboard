import { parseSignalSettings, signalMarket, type RawRow } from "@workspace/cot-engine";
import type { CotScreenerResponse, CotSignalMarket, GetCotScreenerParams } from "@workspace/api-client-react";

type Job = { id: string; data: CotScreenerResponse; snapshot: string; params: GetCotScreenerParams; marketUrl: string; serverNow?: number };
const histories = new Map<string, RawRow[]>();
const versions = new Map<string, string>();
let current: { id: string; controller: AbortController } | undefined;

self.onmessage = ({ data }: MessageEvent<Job & { cancel?: string }>) => {
  if (data.cancel) { if (current?.id === data.cancel) current.controller.abort(); return; }
  current?.controller.abort();
  const controller = new AbortController();
  current = { id: data.id, controller };
  void scan(data, controller.signal).catch(error => {
    if (!controller.signal.aborted) self.postMessage({ id: data.id, error: error instanceof Error ? error.message : "Custom scan failed." });
  });
};

async function scan(job: Job, signal: AbortSignal) {
  const settings = parseSignalSettings(job.params);
  const prefix = `${job.data.report}|`;
  if (versions.get(job.data.report) !== job.snapshot) {
    for (const key of histories.keys()) if (key.startsWith(prefix)) histories.delete(key);
    versions.set(job.data.report, job.snapshot);
  }
  const markets: CotSignalMarket[] = [];
  for (let i = 0; i < job.data.markets.length; i += 6) {
    if (signal.aborted) return;
    const batch = await Promise.all(job.data.markets.slice(i, i + 6).map(async market => {
      const key = `${prefix}${job.snapshot}|${market.name}`;
      try {
        let rows = histories.get(key);
        if (!rows) {
          const url = new URL(job.marketUrl);
          url.searchParams.set("report", job.data.report);
          url.searchParams.set("market", market.name);
          const response = await fetch(url, { signal, headers: { "X-COT-Snapshot": job.snapshot } });
          if (response.status === 409) throw new SnapshotChanged();
          if (!response.ok) throw new Error("Official history could not be loaded.");
          const body = await response.json() as { reportAsOf: string; rows: { date: string; largeTraders: number; smallTraders: number; commercialHedgers: number; openInterest: number | null }[] };
          if (body.reportAsOf !== job.data.reportAsOf) throw new SnapshotChanged();
          rows = body.rows.map(row => ({
            date: row.date, large_traders: row.largeTraders, small_traders: row.smallTraders, commercial_hedgers: row.commercialHedgers,
            ...(row.openInterest === null ? {} : { open_interest: row.openInterest }),
          }));
          if (!signal.aborted) histories.set(key, rows);
        }
        return signalMarket(market, { rows, error: null }, job.data.reportAsOf, settings, job.serverNow);
      } catch (error) {
        if (error instanceof SnapshotChanged || signal.aborted) throw error;
        return signalMarket(market, { rows: [], error: "Official history could not be loaded; this market is unavailable. Try again." }, job.data.reportAsOf, settings, job.serverNow);
      }
    }));
    markets.push(...batch);
    self.postMessage({ id: job.id, progress: { done: markets.length, total: job.data.markets.length } });
  }
  if (!signal.aborted) self.postMessage({
    id: job.id, result: {
      ...job.data, settings, markets,
      message: markets.some(m => m.status === "error") ? "Some histories could not be loaded; failed markets are unavailable." : job.data.message,
    },
  });
}
class SnapshotChanged extends Error {
  constructor() { super("The dataset changed during this scan. Try again to use one consistent official snapshot."); }
}
