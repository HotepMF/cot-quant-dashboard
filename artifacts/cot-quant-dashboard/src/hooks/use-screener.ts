import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getGetCotScreenerQueryKey, useRefreshCotScan } from "@workspace/api-client-react";
import { loadScreener } from "@/lib/browser-scan";
import type { CotSignalMarket, GetCotScreenerParams } from "@workspace/api-client-react";
import { coreAliases } from "@workspace/cot-engine";
import { buildMarketCatalog, MARKET_SECTORS } from "@/lib/market-catalog";
import type { MarketSector } from "@/lib/market-catalog";
import { readLiveReport, useSharedSettings, writeLiveReport } from "@/lib/settings-store";
import type { LiveReport } from "@/lib/settings-store";

export type ScanRow = CotSignalMarket & { label: string; exchange: string; sector: MarketSector; searchText: string; active: boolean; oiAlert: boolean; flagged: boolean };

export const isActive = (m: CotSignalMarket) => m.status === "ready" && (m.signal === "bullish" || m.signal === "bearish");

export function unavailableReason(m: CotSignalMarket, lookback: number) {
  if (m.message) return m.message;
  switch (m.status) {
    case "loading": return "Queued in current scan";
    case "insufficient": return `${m.historyRows} weekly rows, below ${lookback}-week lookback`;
    case "stale": return `Latest row ${m.reportDate ?? "unknown"} is older than the report date`;
    case "error": return "Publisher history could not be read";
    default: return "";
  }
}

export function useScreener() {
  const [settings] = useSharedSettings();
  const [report, setReportState] = useState<LiveReport>(() => readLiveReport());
  const setReport = (r: LiveReport) => { setReportState(r); writeLiveReport(r); };
  const params: GetCotScreenerParams = {
    report,
    lookback: Math.max(3, Math.min(520, settings.lookback)),
    zThreshold: settings.zThreshold,
    zEnabled: settings.zEnabled,
    confluenceThreshold: Math.max(50, Math.min(95, settings.confluenceThreshold)),
    requireSmall: settings.requireSmall,
    changeEnabled: settings.changeEnabled,
    oiThreshold: settings.oiThreshold,
    participant: settings.participant as GetCotScreenerParams["participant"],
    signalMode: settings.signalMode as GetCotScreenerParams["signalMode"],
    zMethod: settings.zMethod as GetCotScreenerParams["zMethod"],
  };
  const queryKey = getGetCotScreenerQueryKey(params);
  const qc = useQueryClient();
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const query = useQuery({
      queryKey,
      queryFn: ({ signal }) => {
        setScanProgress(null);
        return loadScreener(params, signal, (done, total) => setScanProgress({ done, total }));
      },
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchInterval: q => (q.state.data?.status === "loading" ? 2000 : 5 * 60 * 1000),
  });
  const refresh = useRefreshCotScan({
    mutation: { onSuccess: () => { void qc.invalidateQueries({ queryKey }); } },
  });
  const data = query.data;
  const rows = useMemo<ScanRow[]>(() => {
    const markets = data?.markets ?? [];
    const byName = new Map(markets.map(m => [m.name, m]));
    return buildMarketCatalog(markets.map(m => ({ name: m.name, code: m.code })), coreAliases).map(c => {
      const m = byName.get(c.name)!;
      const active = isActive(m);
      const oiAlert = m.status === "ready" && m.oiChange != null && Math.abs(m.oiChange) >= settings.oiThreshold;
      return { ...m, label: c.label, exchange: c.exchange, sector: c.sector, searchText: c.searchText, active, oiAlert, flagged: active || (m.status === "ready" && m.largeMove) || oiAlert };
    });
  }, [data?.markets, settings.oiThreshold]);
  const scanning = data?.status === "loading" || query.isFetching;
  const settled = data?.status === "ready" && !rows.some(r => r.status === "loading");
  return {
    settings, report, setReport, query, data, rows, scanning, settled, scanProgress,
    lookback: params.lookback ?? settings.lookback,
    refresh: () => refresh.mutate({ data: { report } }),
    refreshing: refresh.isPending,
    refreshError: refresh.error,
  };
}

export const sectorLabel = (id: MarketSector) => MARKET_SECTORS.find(s => s.id === id)?.label ?? id;
export const nfmt = (n: number | null | undefined, d = 0) => n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
export const nsigned = (n: number | null | undefined, d = 0) => n == null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${nfmt(n, d)}`;
export const shortDate = (s?: string | null) => s ? new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
