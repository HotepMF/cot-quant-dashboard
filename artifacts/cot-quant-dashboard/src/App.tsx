import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine,
  ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import Papa from "papaparse";
import { MarketSelector } from "@/components/market-selector";
import { CftcUpdateStatus } from "@/components/cftc-update-status";
import { Route, Switch } from "wouter";
import { CONSOLIDATED_COMPONENTS, computeRows } from "@workspace/cot-engine";
import type { RawRow } from "@workspace/cot-engine";
import { useSharedSettings, STORAGE_SOURCE_MODE } from "@/lib/settings-store";
import { OscReadout } from "@/components/oscillators";
import { SectorBreakLine } from "@/components/sector-breaks";
import { moveRead } from "@/components/scanner/market-table";
import { CurvePanel } from "@/components/curve-gauge";
import { SettingsBar } from "@/components/settings-bar";
import { Link } from "wouter";
import type { Settings } from "@/lib/settings-store";
import { SectorSignalsPage } from "@/pages/sector-signals";
import { SignalWatchlistPage } from "@/pages/signal-watchlist";
import { HowItWorksPage } from "@/pages/how-it-works";
import { SectorsPage } from "@/pages/sectors";
import { InvisibleHandPage } from "@/pages/invisible-hand";
import { SiteBrand, SiteMobileNav, SiteNav, workspaceSections } from "@/components/site-nav";
import NotFound from "@/pages/not-found";
import {
  Activity, Download, Moon, Printer, RefreshCw,
  Sun, Database, AlertTriangle, Clock3,
} from "lucide-react";
import {
  getGetCotMarketHistoryQueryKey, getGetCotMarketsQueryKey,
  useGetCotMarketHistory, useGetCotMarkets,
} from "@workspace/api-client-react";


const C = { large: "#56b7a3", small: "#dfa958", commercial: "#829fce", oi: "#a68cc8", red: "#df766b", grid: "rgba(145,160,174,.16)" };
const metricNames = {
  large_traders: "Large Traders", small_traders: "Small Traders", commercial_hedgers: "Commercial Hedgers",
} as const;
const metricKeys = ["large_traders", "small_traders", "commercial_hedgers"] as const;
type MetricKey = typeof metricKeys[number];

function makeDemo(): RawRow[] {
  // Fixed, synthetic values: the demo is intentionally not sourced from CFTC or current market data.
  return Array.from({ length: 84 }, (_, i) => {
    const d = new Date(Date.UTC(2023, 6, 7 + 7 * i));
    const date = d.toISOString().slice(0, 10);
    const phase = i / 83;
    return {
      date,
      large_traders: Math.round(51000 + 42000 * Math.sin(i / 8.7) + 17000 * Math.sin(i / 3.9) + i * 190),
      small_traders: Math.round(-19000 + 28000 * Math.sin(i / 7.2 + 2.2) + 9000 * Math.sin(i / 3.5) - phase * 4000),
      commercial_hedgers: Math.round(-23000 - 37000 * Math.sin(i / 8.7 + .35) - 14000 * Math.sin(i / 4.1) - i * 70),
      open_interest: Math.round(1780000 + 195000 * Math.sin(i / 10.5) + 2800 * i + 52000 * Math.sin(i / 4.8)),
    };
  });
}
const DEMO_ROWS = makeDemo();
/** Browser CSV imports were retired in Oct 2026; leftover rows are cleared on load. */
const STORAGE_DATA = "cot-quant-local-rows-v1";
const STORAGE_THEME = "cot-quant-theme-v2";
const STORAGE_SOURCE = "cot-quant-source-selection-v1";
const STORAGE_CONSOLIDATED_DEFAULT = "cot-quant-consolidated-default-v1";
const signalKind = (mode: string) => mode === "Z-Score Only" ? "Z-score" : mode === "Both (AND gate)" ? "AND-gate" : "confluence";
const fmt = (n: number | null | undefined, digits = 0) => n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const signed = (n: number | null | undefined, digits = 0) => n == null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${fmt(n, digits)}`;
const formatDate = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const changeTone = (value: number | null | undefined) => value == null || value === 0 ? "change-flat" : value > 0 ? "change-up" : "change-down";
const cycleTone = (value: number) => value >= 85 ? "cycle-high" : value <= 15 ? "cycle-low" : "cycle-mid";
function isCftcReleaseWindow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const minuteOfDay = Number(value.hour) * 60 + Number(value.minute);
  return value.weekday === "Fri" && minuteOfDay >= 15 * 60 + 30 && minuteOfDay < 20 * 60;
}
function reportAgeDays(date?: string) {
  if (!date) return 0;
  const nowParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const parts = Object.fromEntries(nowParts.map(p => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
}
const makeCsv = (rows: Record<string, unknown>[], fileName: string) => {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url);
};
function Dashboard() {
  useEffect(() => { document.title = "COT Quant Dashboard"; }, []);
  const [settings, setSettings] = useSharedSettings();
  const [isDark, setIsDark] = useState(() => { try { return localStorage.getItem(STORAGE_THEME) !== "light"; } catch { return true; } });
  const [liveReport, setLiveReport] = useState<"futures" | "combined">(() => {
    try { return localStorage.getItem(STORAGE_SOURCE) === "combined" ? "combined" : "futures"; } catch { return "futures"; }
  });
  const [releaseWindowActive, setReleaseWindowActive] = useState(() => isCftcReleaseWindow());
  const [selectedMarket, setSelectedMarket] = useState(() => {
    try { return localStorage.getItem(`${STORAGE_SOURCE}:market`) ?? ""; } catch { return ""; }
  });
  const [activeSection, setActiveSection] = useState("summary");
  // Chart ranges follow the 16-week time grades; 32 shows the lookback window next to the 16 weeks before it.
  const [chartWeeks, setChartWeeks] = useState(32);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMark, setRefreshMark] = useState("");
  const [tablePage, setTablePage] = useState(0);
  const marketsQuery = useGetCotMarkets(
    { report: liveReport },
    { query: { queryKey: getGetCotMarketsQueryKey({ report: liveReport }), refetchOnMount: "always", refetchInterval: releaseWindowActive ? 60_000 : 5 * 60_000 } },
  );
  const marketList = marketsQuery.data?.markets ?? [];
  const preferredMarket = marketList.find(m => m.code === "13874+") ?? marketList.find(m => /E-MINI S&P 500/i.test(m.name));
  const effectiveMarket = marketList.find(m => m.name === selectedMarket) ?? preferredMarket ?? marketList[0];
  const historyQuery = useGetCotMarketHistory(
    { report: liveReport, market: effectiveMarket?.name ?? "" },
    {
      query: {
        queryKey: getGetCotMarketHistoryQueryKey({ report: liveReport, market: effectiveMarket?.name ?? "" }),
        enabled: Boolean(effectiveMarket),
        refetchOnMount: "always",
        refetchInterval: releaseWindowActive ? 60_000 : 5 * 60_000,
      },
    },
  );
  const analysisRows = useMemo<RawRow[]>(() => {
    if (!historyQuery.data?.rows.length) return DEMO_ROWS;
    return historyQuery.data.rows.map(row => ({
      date: row.date,
      large_traders: row.largeTraders,
      small_traders: row.smallTraders,
      commercial_hedgers: row.commercialHedgers,
      ...(row.openInterest != null ? { open_interest: row.openInterest } : {}),
    }));
  }, [historyQuery.data]);
  const computed = useMemo(() => computeRows(analysisRows, settings), [analysisRows, settings]);
  const latest = computed[computed.length - 1];
  const previous = computed[computed.length - 2];
  const visible = chartWeeks === 0 ? computed : computed.slice(-chartWeeks);
  // The positioning chart shows what the model reads: net as % of open interest when the Z calculation is
  // OI-normalised, contracts otherwise (the default); plus the lookback window and the selected participant's +/-Z band.
  const oiNorm = settings.zMethod === "Open Interest Normalization";
  const modelKey: MetricKey = settings.participant === "Large Traders" ? "large_traders" : settings.participant === "Small Traders" ? "small_traders" : "commercial_hedgers";
  const asModel = (r: RawRow, k: MetricKey) => oiNorm ? (r.open_interest ? r[k] / r.open_interest * 100 : null) : r[k];
  const chartRows = visible.map(r => oiNorm ? { ...r, large_traders: asModel(r, "large_traders"), small_traders: asModel(r, "small_traders"), commercial_hedgers: asModel(r, "commercial_hedgers") } : r);
  const zBand = useMemo(() => {
    const win = computed.slice(-settings.lookback);
    if (!settings.zEnabled || win.length < settings.lookback) return null;
    const vals = win.map(r => asModel(r, modelKey));
    if (vals.some(v => v == null || !Number.isFinite(v))) return null;
    const v = vals as number[], mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
    return { start: win[0].date, end: win[win.length - 1].date, upper: mean + settings.zThreshold * sd, lower: mean - settings.zThreshold * sd };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computed, settings.lookback, settings.zEnabled, settings.zThreshold, oiNorm, modelKey]);
  const bandStart = zBand && visible.length ? (zBand.start < visible[0].date ? visible[0].date : zBand.start) : null;
  const tableRows = [...computed].reverse().slice(tablePage * 10, tablePage * 10 + 10);
  const participantStats = useMemo(() => metricKeys.map((key) => {
    const val = latest?.[key] ?? 0;
    const prev = previous?.[key] ?? val;
    const deltaKey = key === "large_traders" ? "ltDelta" : key === "small_traders" ? "stDelta" : "chDelta";
    const zKey = key === "large_traders" ? "ltZ" : key === "small_traders" ? "stZ" : "chZ";
    const cycleKey = key === "large_traders" ? "ltCycle" : key === "small_traders" ? "stCycle" : "chCycle";
    const max = Math.max(...analysisRows.map(r => r[key])), min = Math.min(...analysisRows.map(r => r[key]));
    return { key, label: metricNames[key], value: val, prev, delta: latest?.[deltaKey] ?? 0, z: latest?.[zKey] ?? null, cycle: latest?.[cycleKey] ?? 50, max, min };
  }), [latest, previous, analysisRows]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    try { localStorage.setItem(STORAGE_THEME, isDark ? "dark" : "light"); } catch { /* storage unavailable */ }
  }, [isDark]);
  useEffect(() => {
    if (effectiveMarket && selectedMarket !== effectiveMarket.name) setSelectedMarket(effectiveMarket.name);
  }, [effectiveMarket, selectedMarket]);
  useEffect(() => {
    // One time: a saved E-mini / micro / Dow x$5 selection (the old default) moves to its consolidated line,
    // which is what the site leads with. Choosing a single contract again afterwards is kept.
    if (!marketList.length || !selectedMarket) return;
    try { if (localStorage.getItem(STORAGE_CONSOLIDATED_DEFAULT)) return; localStorage.setItem(STORAGE_CONSOLIDATED_DEFAULT, "1"); } catch { return; }
    const target = CONSOLIDATED_COMPONENTS[marketList.find(m => m.name === selectedMarket)?.code ?? ""];
    const replacement = target && marketList.find(m => m.code === target);
    if (replacement) setSelectedMarket(replacement.name);
  }, [marketList, selectedMarket]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SOURCE, liveReport);
      localStorage.setItem(`${STORAGE_SOURCE}:market`, selectedMarket);
    } catch { /* source preferences remain session-only */ }
  }, [liveReport, selectedMarket]);
  useEffect(() => { setTablePage(0); }, [historyQuery.data]);
  useEffect(() => {
    let wasInWindow = isCftcReleaseWindow();
    const timer = window.setInterval(() => {
      const inWindow = isCftcReleaseWindow();
      setReleaseWindowActive(inWindow);
      if (inWindow && !wasInWindow) {
        void marketsQuery.refetch();
        void historyQuery.refetch();
      }
      wasInWindow = inWindow;
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [liveReport, effectiveMarket?.name]);
  useEffect(() => { try { localStorage.removeItem(STORAGE_DATA); localStorage.setItem(STORAGE_SOURCE_MODE, "live"); } catch { /* storage unavailable */ } }, []);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const visibleSection = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visibleSection) setActiveSection(visibleSection.target.id);
    }, { rootMargin: "-15% 0px -65% 0px", threshold: [0, .2, .5] });
    workspaceSections.forEach(s => { const el = document.getElementById(s.id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);
  function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) { setSettings(s => ({ ...s, [key]: value })); }
  function navigate(id: string) { setActiveSection(id); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  // Arriving from another page's workspace link (/#positioning): scroll there once the section has rendered.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!workspaceSections.some(s => s.id === id)) return;
    let tries = 0, timer = 0;
    const go = () => {
      const el = document.getElementById(id);
      if (el) { setActiveSection(id); el.scrollIntoView({ block: "start" }); }
      else if (tries++ < 40) timer = window.setTimeout(go, 50);
    };
    go();
    return () => window.clearTimeout(timer);
  }, []);
  function handleRefresh() {
    setRefreshing(true);
    void Promise.all([marketsQuery.refetch(), historyQuery.refetch()]).finally(() => {
      setRefreshMark(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
      setRefreshing(false);
    });
  }
  const exportRows = (rowsToExport = computed) => rowsToExport.map(r => ({
    date: r.date, large_traders_net: r.large_traders, small_traders_net: r.small_traders,
    commercial_hedgers_net: r.commercial_hedgers, open_interest: r.open_interest ?? "",
    large_z: r.ltZ, small_z: r.stZ, commercial_z: r.chZ, large_cycle_pct: r.ltCycle, small_cycle_pct: r.stCycle, commercial_cycle_pct: r.chCycle,
    commercial_delta: r.chDelta, commercial_delta_percentile: r.chDeltaPct, commercial_delta_z: r.chDeltaZ,
    signal: r.buy ? `Extreme long (${signalKind(settings.signalMode)})` : r.sell ? `Extreme short (${signalKind(settings.signalMode)})` : "No reading", oi_change_pct: r.oiMove,
  }));
  const exportButton = (name: string, records: Record<string, unknown>[] = exportRows()) => <button className="icon-btn print-hidden" title={`Export ${name} chart data as CSV`} aria-label={`Export ${name} chart data as CSV`} data-testid={`export-${name}-csv`} onClick={() => makeCsv(records, `cot-${name}.csv`)}><Download size={15} /></button>;
  const chartTick = { fill: "hsl(var(--muted-foreground))", fontSize: 11, fontFamily: "DM Mono" };
  const TooltipBox = ({ active, payload, label, unit = "" }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string; unit?: string }) => {
    if (!active || !payload?.length) return null;
    return <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 7, padding: "10px 12px", color: "hsl(var(--foreground))", fontSize: 12 }}>
      <div style={{ fontFamily: "DM Mono", marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ display: "flex", gap: 14, justifyContent: "space-between" }}><span style={{ color: p.color }}>{p.name}</span><b className="mono">{fmt(p.value, unit ? 1 : 0)}{unit}</b></div>)}
    </div>;
  };
  const getStatus = (cycle: number) => {
    const high = cycle >= 85, low = cycle <= 15;
    if (cycle >= 100) return { text: "Extreme long", className: "warn" };
    if (cycle <= 0) return { text: "Extreme short", className: "good" };
    if (cycle >= 85) return { text: "Very long", className: "warn" };
    if (cycle >= 65) return { text: "Long", className: "" };
    if (cycle >= 35) return { text: "Neutral", className: "" };
    if (cycle >= 15) return { text: "Short", className: "" };
    return { text: "Very short", className: "good" };
  };
  const selectedZ = latest ? (settings.participant === "Large Traders" ? latest.ltZ : settings.participant === "Small Traders" ? latest.stZ : latest.chZ) : null;
  const signalPrefix = settings.signalMode === "Z-Score Only" ? "Z-score" : settings.signalMode === "Both (AND gate)" ? "AND-gate" : "confluence";
  const signalLabel = latest?.buy ? `Extreme long · ${signalPrefix}` : latest?.sell ? `Extreme short · ${signalPrefix}` : "No reading this report";
  const signalTone = latest?.buy ? "good" : latest?.sell ? "bad" : "neutral";
  const selectedPosition = latest ? asModel(latest, modelKey) ?? 0 : 0;
  const showSignalMark = Boolean(latest && ((settings.showSignals && (latest.buy || latest.sell)) || latest.largeMove));
  const signalMarkText = latest?.buy ? "EXT LONG" : latest?.sell ? "EXT SHORT" : latest?.largeMove ? (latest.moveDirection === "Net positioning increased" ? "POSITION +" : "POSITION −") : "";
  const signalMarkColor = latest?.buy ? C.large : latest?.sell ? C.red : C.small;
  const liveActive = Boolean(historyQuery.data?.rows.length);
  const liveFailure = marketsQuery.isError || historyQuery.isError;
  const reportName = liveReport === "futures" ? "Legacy Futures Only" : "Legacy Combined";
  const checkTime = historyQuery.data?.checkedAt ?? marketsQuery.data?.checkedAt;
  const isReportStale = reportAgeDays(historyQuery.data?.reportAsOf) > 10;
  const dataMarketLabel = liveActive ? historyQuery.data!.marketName : "Illustrative sample · not market data";

  return <div className="shell">
    <aside className="sidebar">
      <SiteBrand />
      <SiteNav activeSection={activeSection} onSection={navigate} />
      <div style={{ marginTop: "auto", borderTop: "1px solid hsl(var(--sidebar-border))", padding: "18px 8px 0" }}>
        <div className="eyebrow" style={{ color: "rgba(244,241,232,.42)" }}>Data mode</div>
        <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span className="dot" style={{ background: liveActive ? "#65c7a4" : liveFailure ? "#e27667" : "#e6a752" }} />{liveActive ? "Official CFTC data" : liveFailure ? "CFTC connection issue" : "Connecting to CFTC"}
        </div>
        <div style={{ color: "rgba(244,241,232,.45)", fontSize: 10, lineHeight: 1.55, marginTop: 8 }}>Official weekly CFTC reports · positions as of Tuesday, usually posted Friday.</div>
      </div>
    </aside>

    <main className="main">
      <header className="topline">
        <div>
          <div className="eyebrow" style={{ marginBottom: 9 }}>Positioning intelligence <span style={{ margin: "0 6px" }}>/</span> {effectiveMarket?.name ?? "CFTC markets"}</div>
          <h1 className="page-title display">COT Quant Dashboard</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 9, flexWrap: "wrap" }}>
            <span className={`badge ${liveFailure ? "bad" : liveActive && !isReportStale ? "good" : "warn"}`} data-testid="status-data-mode"><span className="dot" style={{ background: liveFailure ? "#e27667" : liveActive && !isReportStale ? "#69c8a7" : "#e6a752" }} />{liveFailure ? "CFTC request failed" : liveActive && isReportStale ? "CFTC report may be stale" : liveActive ? "Official CFTC data · weekly" : "Illustrative demo fallback"}</span>
            <span className="subtle" style={{ fontSize: 12 }}>{computed.length} weekly observations · latest report date {latest ? formatDate(latest.date) : "—"}</span>
          </div>
        </div>
        <div className="toolbar print-hidden">
          <button className="btn" onClick={handleRefresh} disabled={refreshing} data-testid="button-refresh"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />{refreshing ? "Checking…" : "Check CFTC"}</button>
          <button className="icon-btn" aria-label="Print or export PDF" title="Print / Save as PDF" onClick={() => window.print()} data-testid="button-print"><Printer size={15} /></button>
          <button className="icon-btn" aria-label="Toggle dark mode" title="Toggle theme" onClick={() => setIsDark(v => !v)} data-testid="button-theme">{isDark ? <Sun size={15} /> : <Moon size={15} />}</button>
        </div>
      </header>
      <div className={`source-banner ${liveFailure ? "source-error" : ""}`} role={liveFailure ? "alert" : "status"} data-testid="status-cftc-source">
        {liveFailure ? <AlertTriangle size={17} /> : <Database size={17} />}
        <div className="source-copy">
          <strong>{liveFailure ? "CFTC source unavailable" : liveActive ? "Official CFTC source" : "CFTC source status"}</strong>
          <span>{liveFailure
              ? `${historyQuery.isError ? "Weekly history request" : "Market list request"} failed${historyQuery.error instanceof Error ? `: ${historyQuery.error.message}` : marketsQuery.error instanceof Error ? `: ${marketsQuery.error.message}` : "."} ${liveActive ? "Existing returned CFTC history remains displayed with its original report date." : "Any displayed rows remain clearly labelled illustrative fallback, not current CFTC data."}`
              : liveActive
                ? `${reportName} · ${effectiveMarket?.name ?? historyQuery.data?.marketName} · report as of ${formatDate(historyQuery.data!.reportAsOf)}. ${isReportStale ? "No newer release has been returned; the latest report is over ten days old. CFTC publication may be delayed." : "This is the as-of date (positions on that day), not the Friday publication date."}`
                : "Loading the latest official feed. Any demo rows shown are synthetic and are not relabelled as current CFTC observations."}
          </span>
          <small><Clock3 size={12} /> {checkTime ? `Last checked ${new Date(checkTime).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" })} ET` : "Last check pending"}{historyQuery.data?.reportAsOf ? ` · report as of ${formatDate(historyQuery.data.reportAsOf)}` : marketsQuery.data?.reportAsOf ? ` · market list as of ${formatDate(marketsQuery.data.reportAsOf)}` : ""}</small>
          <CftcUpdateStatus />
          {historyQuery.data?.sourceWarning && <small style={{ color: "#e6a752" }}>{historyQuery.data.sourceWarning}</small>}
        </div>
      </div>
      <div className="toolbar source-controls print-hidden" style={{ justifyContent: "space-between", marginBottom: 18 }}>
        <div className="source-selects">
          <label className="field"><span className="eyebrow">CFTC report</span><select className="select" value={liveReport} onChange={e => { setLiveReport(e.target.value as "futures" | "combined"); setSelectedMarket(""); }} aria-label="CFTC report type" data-testid="select-cftc-report"><option value="futures">Legacy Futures Only</option><option value="combined">Legacy Combined</option></select></label>
          <div className="field field-market"><span className="eyebrow" id="label-cftc-market">Market</span><MarketSelector markets={marketList} value={effectiveMarket?.name ?? ""} onChange={setSelectedMarket} loading={marketsQuery.isLoading} /></div>
        </div>
        <div className="source-summary">
          <span className="eyebrow">Selected source</span>
          <b>{`${reportName} / ${effectiveMarket?.name ?? "Market pending"}`}</b>
          <small>{`Weekly observations · ${historyQuery.data?.rows.length ?? "—"} rows`}</small>
        </div>
      </div>
      <SettingsBar display id="configuration" />
      <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 18 }}>
        <div className="eyebrow">Calculation profile <span style={{ color: "hsl(var(--foreground))", marginLeft: 8 }}>{reportName}</span> <span className="subtle" style={{ margin: "0 8px" }}>·</span> Legacy net positioning · Long − Short</div>
        <div className="subtle mono" style={{ fontSize: 10 }}>{refreshMark ? `CFTC checked ${refreshMark}` : "Automatic server updates · no open browser required"}</div>
      </div>

      <section id="summary" className="section fade-in">
        <div className="kpi-grid">
          <div className="card kpi" style={{ "--kpi-accent": C.commercial } as CSSProperties}><div className="eyebrow">Commercial net</div><div className={`kpi-value ${changeTone(latest?.commercial_hedgers)}`} data-testid="value-commercial">{signed(latest?.commercial_hedgers)}</div><div className="subtle" style={{ fontSize: 11 }}>week-over-week <span className={`mono weekly-change ${changeTone(latest?.chDelta)}`} title="Descriptive change in reported commercial net positioning">{signed(latest?.chDelta)}</span></div></div>
          <div className="card kpi" style={{ "--kpi-accent": C.large } as CSSProperties}><div className="eyebrow">Large traders net</div><div className={`kpi-value ${changeTone(latest?.large_traders)}`}>{signed(latest?.large_traders)}</div><div className="subtle" style={{ fontSize: 11 }}>cycle rank <span className={`mono ${cycleTone(latest?.ltCycle ?? 50)}`}>{fmt(latest?.ltCycle, 1)}%</span></div></div>
          <div className="card kpi" style={{ "--kpi-accent": C.small } as CSSProperties}><div className="eyebrow">Small traders net</div><div className={`kpi-value ${changeTone(latest?.small_traders)}`}>{signed(latest?.small_traders)}</div><div className="subtle" style={{ fontSize: 11 }}>cycle rank <span className={`mono ${cycleTone(latest?.stCycle ?? 50)}`}>{fmt(latest?.stCycle, 1)}%</span></div></div>
          <div className="card kpi" style={{ "--kpi-accent": C.oi } as CSSProperties}><div className="eyebrow">Open interest</div><div className="kpi-value">{fmt(latest?.open_interest)}</div><div className="subtle" style={{ fontSize: 11 }}>weekly move <span className={`mono weekly-change ${changeTone(latest?.oiMove)}`}>{latest?.oiMove == null ? "—" : `${signed(latest.oiMove, 2)}%`}</span></div></div>
        </div>
        <div className="section overview-grid">
          <div className="card">
            <div className="card-head"><div><h2 className="panel-title">Weekly net positioning</h2><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>{dataMarketLabel} · {reportName} · {oiNorm ? "net as % of open interest" : "net contracts, long − short"}</div></div><div className="toolbar"><select className="select print-hidden" style={{ width: 115, minHeight: 32, padding: "5px 8px", fontSize: 11 }} value={chartWeeks} onChange={e => setChartWeeks(Number(e.target.value))} aria-label="Chart history range" data-testid="select-chart-range"><option value={16}>16 weeks</option><option value={32}>32 weeks</option><option value={48}>48 weeks</option><option value={64}>64 weeks</option><option value={0}>All rows</option></select>{exportButton("weekly-positioning", exportRows(visible))}</div></div>
            <div className="card-body">
              <div className="control-group" style={{ marginBottom: 8 }}>
                {([["showLT", "Large", C.large], ["showST", "Small", C.small], ["showCH", "Commercial", C.commercial]] as const).map(([key, label, color]) => <button key={key} className={`seg ${settings[key] ? "active" : ""}`} style={settings[key] ? { background: color, borderColor: color, color: "#fff" } : {}} onClick={() => setSetting(key, !settings[key])}>{label}</button>)}
              </div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 10, right: 10, bottom: 0, left: 5 }}>
                    <CartesianGrid stroke={C.grid} strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="date" tick={chartTick} tickFormatter={d => String(d).slice(2, 7)} minTickGap={35} axisLine={false} tickLine={false} />
                    <YAxis tick={chartTick} tickFormatter={v => oiNorm ? `${Math.round(v)}%` : `${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={43} />
                    <Tooltip content={<TooltipBox unit={oiNorm ? "%" : ""} />} isAnimationActive={false} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={.5} />
                    {zBand && bandStart && <ReferenceArea x1={bandStart} x2={zBand.end} fill="hsl(var(--primary))" fillOpacity={0.05} ifOverflow="hidden" />}
                    {zBand && bandStart && <ReferenceLine segment={[{ x: bandStart, y: zBand.upper }, { x: zBand.end, y: zBand.upper }]} stroke={modelKey === "large_traders" ? C.large : modelKey === "small_traders" ? C.small : C.commercial} strokeDasharray="4 4" strokeOpacity={0.9} ifOverflow="extendDomain" label={{ value: `+${settings.zThreshold}σ`, position: "insideTopLeft", fill: "hsl(var(--muted-foreground))", fontSize: 10, fontFamily: "DM Mono" }} />}
                    {zBand && bandStart && <ReferenceLine segment={[{ x: bandStart, y: zBand.lower }, { x: zBand.end, y: zBand.lower }]} stroke={modelKey === "large_traders" ? C.large : modelKey === "small_traders" ? C.small : C.commercial} strokeDasharray="4 4" strokeOpacity={0.9} ifOverflow="extendDomain" label={{ value: `−${settings.zThreshold}σ`, position: "insideBottomLeft", fill: "hsl(var(--muted-foreground))", fontSize: 10, fontFamily: "DM Mono" }} />}
                    {showSignalMark && latest && settings.highlight !== "Shapes Only" && <ReferenceArea x1={latest.date} x2={latest.date} fill={signalMarkColor} fillOpacity={0.14} />}
                    {settings.showLT && <Line type="monotone" dataKey="large_traders" name="Large traders" stroke={C.large} strokeWidth={2} dot={false} isAnimationActive={false} />}
                    {settings.showST && <Line type="monotone" dataKey="small_traders" name="Small traders" stroke={C.small} strokeWidth={2} dot={false} isAnimationActive={false} />}
                    {settings.showCH && <Line type="monotone" dataKey="commercial_hedgers" name="Commercial hedgers" stroke={C.commercial} strokeWidth={2.3} dot={false} isAnimationActive={false} />}
                    {showSignalMark && latest && settings.highlight !== "Background Only" && <ReferenceDot x={latest.date} y={selectedPosition} r={6} fill={signalMarkColor} stroke="hsl(var(--card))" strokeWidth={2} ifOverflow="visible" label={{ value: signalMarkText, position: "top", fill: signalMarkColor, fontSize: 10, fontFamily: "DM Mono" }} />}
                  </LineChart>
              </ResponsiveContainer>
              </div>{settings.showPaneLabel && <div className="eyebrow" style={{ marginTop: 8 }}>{dataMarketLabel} · {reportName} · {oiNorm ? "net as % of open interest" : "Long − Short"}</div>}<div className="chart-foot">{zBand ? <>Shaded: the {settings.lookback}-week window the Z-score uses · dashed: ±{settings.zThreshold}σ for {settings.participant.toLowerCase()}, so a line beyond it is a Z extreme. </> : null}Most recent {visible.length} of {computed.length} weekly rows · {reportName}.</div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div><h2 className="panel-title">Current readout</h2><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>Derived from the selected latest row</div></div><Activity size={16} className="subtle" /></div>
            <div className="card-body">
              <div className="eyebrow">Configured reading mode</div>
              <div style={{ marginTop: 9 }}><span className={`badge ${signalTone}`} data-testid="status-signal"><span className="dot" style={{ background: latest?.buy ? "#2a8b79" : latest?.sell ? "#c95b4c" : "hsl(var(--muted-foreground))" }} />{signalLabel}</span></div>
              <div style={{ marginTop: 19, display: "grid", gap: 13 }}>
                <div className="statline"><span className="subtle">Monitored participant</span><b>{settings.participant}</b></div>
                <div className="statline"><span className="subtle">Position Z-score</span><b className="mono">{selectedZ == null ? "Insufficient lookback" : `${signed(selectedZ, 2)}σ`}</b></div>
                <div className="statline"><span className="subtle">Confluence</span><b>{latest?.confluenceBull ? "Opposing extremes · commercials long" : latest?.confluenceBear ? "Opposing extremes · commercials short" : "Not aligned"}</b></div>
                <div className="statline"><span className="subtle">OI threshold</span><b className="mono">{latest?.oiMove != null && Math.abs(latest.oiMove) >= settings.oiThreshold ? `${signed(latest.oiMove, 1)}% alert` : "No threshold breach"}</b></div>
                <OscReadout code={effectiveMarket?.code} />
                <SectorBreakLine code={effectiveMarket?.code} />
              </div>
              <div className="notice" style={{ marginTop: 19 }}>A reading is a mechanical rule state, not a recommendation. Position extremes and confluence are descriptive inputs only.</div>
            </div>
          </div>
        </div>
        {liveActive && <CurvePanel code={effectiveMarket?.code} />}
      </section>

      <section id="positioning" className="section">
        <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div><div className="eyebrow">Participant detail</div><h2 className="display" style={{ fontSize: 24, margin: "4px 0 0" }}>Positioning profile</h2></div>
          <button className="btn print-hidden" onClick={() => makeCsv(exportRows(), "cot-positioning-analysis.csv")}><Download size={14} />Export analysis</button>
        </div>
        <div className="participant-grid">
          {participantStats.map((p, index) => {
            const s = getStatus(p.cycle);
            const deltaPct = index === 0 ? latest?.ltDeltaPct : index === 1 ? latest?.stDeltaPct : latest?.chDeltaPct;
            const deltaZ = index === 0 ? latest?.ltDeltaZ : index === 1 ? latest?.stDeltaZ : latest?.chDeltaZ;
            const color = index === 0 ? C.large : index === 1 ? C.small : C.commercial;
            return <article className="card participant-card" key={p.key} data-testid={`participant-${p.key}`}>
              <div className="participant-head"><span className="dot" style={{ background: color }} />{p.label}<span style={{ marginLeft: "auto" }} className={`badge ${s.className}`}>{s.text}</span></div>
              <div className={`participant-value ${changeTone(p.value)}`}>{signed(p.value)}</div>
              <div className="statline"><span className="subtle">Weekly net change</span><b className={`mono weekly-change ${changeTone(p.delta)}`} title="Descriptive change in reported net positioning">{signed(p.delta)}</b></div>
              <div className="statline"><span className="subtle">Position Z-score</span><b className="mono">{p.z == null ? "—" : `${signed(p.z, 2)}σ`}</b></div>
              <div className="statline"><span className="subtle">Delta score</span><b className="mono">{deltaPct == null ? "—" : `${fmt(deltaPct, 0)}th · ${signed(deltaZ, 2)}σ`}</b></div>
              <div className="statline" style={{ marginTop: 14 }}><span className="subtle">Cycle rank · available history</span><b className={`mono ${cycleTone(p.cycle)}`}>{fmt(p.cycle, 1)}%</b></div>
              <div className="progress"><span style={{ width: `${Math.max(0, Math.min(100, p.cycle))}%`, background: color }} /></div>
              <div className="statline"><span className="subtle">Observed range</span><span className="mono">{fmt(p.min)} – {fmt(p.max)}</span></div>
            </article>;
          })}
        </div>
        <div className="section positioning-grid">
          <div className="card">
            <div className="card-head"><div><h3 className="panel-title">Weekly position change</h3><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>Net positioning delta · no smoothing</div></div>{exportButton("weekly-delta", exportRows(visible))}</div>
            <div className="card-body"><div className="chart-box short">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={visible} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                  <defs><linearGradient id="deltaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.commercial} stopOpacity={.26} /><stop offset="100%" stopColor={C.commercial} stopOpacity={.02} /></linearGradient></defs>
                  <CartesianGrid stroke={C.grid} strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="date" tick={chartTick} tickFormatter={d => String(d).slice(2, 7)} minTickGap={35} axisLine={false} tickLine={false} />
                  <YAxis tick={chartTick} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={43} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={.5} />
                  <Tooltip content={<TooltipBox />} isAnimationActive={false} />
                  <Area type="monotone" dataKey="chDelta" name="Commercial weekly change" stroke={C.commercial} fill="url(#deltaFill)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div><div className="chart-foot">Delta percentile ranks current weekly change against preceding lookback deltas (denominator: configured weeks).</div></div>
          </div>
          <div className="card">
            <div className="card-head"><div><h3 className="panel-title">Open interest profile</h3><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>Weekly open interest with alert bands in analysis</div></div>{exportButton("open-interest", visible.map(r => ({ date: r.date, open_interest: r.open_interest ?? "", weekly_move_pct: r.oiMove ?? "" })))}</div>
            <div className="card-body"><div className="switch-row" style={{ paddingTop: 0, border: 0 }}><span>Show open-interest line</span><input className="switch" type="checkbox" checked={settings.showOI} onChange={e => setSetting("showOI", e.target.checked)} aria-label="Show open-interest chart" data-testid="toggle-open-interest" /></div>
              {settings.showOI && <div className="chart-box short"><ResponsiveContainer width="100%" height="100%">
                <LineChart data={visible} margin={{ top: 10, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={C.grid} strokeDasharray="3 5" vertical={false} /><XAxis dataKey="date" tick={chartTick} tickFormatter={d => String(d).slice(2, 7)} minTickGap={35} axisLine={false} tickLine={false} />
                  <YAxis tick={chartTick} tickFormatter={v => `${(v / 1e6).toFixed(2)}m`} axisLine={false} tickLine={false} width={47} /><Tooltip content={<TooltipBox />} isAnimationActive={false} />
                  <Line type="monotone" dataKey="open_interest" name="Open interest" stroke={C.oi} strokeWidth={2.2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer></div>}
              {!settings.showOI && <div className="notice" style={{ marginTop: 12 }}>Open-interest display is hidden. Data remains included in calculations and exports.</div>}
              <div className="chart-foot">OI move = (current − prior) ÷ prior × 100. Alert when absolute move meets configured threshold.</div>
            </div>
          </div>
        </div>
      </section>

      <section id="signals" className="section">
        <div style={{ marginBottom: 13, display: "flex", alignItems: "end", justifyContent: "space-between", gap: 12 }}><div><div className="eyebrow">Indicator semantics</div><h2 className="display" style={{ fontSize: 24, margin: "4px 0 0" }}>Readings &amp; weekly ledger</h2></div><Link href="/how-it-works/settings" className="subtle print-hidden" style={{ fontSize: 12 }}>How the reading modes work</Link></div>
        <div className="card">
          <div className="card-head"><div><h3 className="panel-title">Weekly calculations</h3><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>{dataMarketLabel} · {reportName} · one record per week report date; latest row drives readout</div></div>
            <div className="toolbar print-hidden">{exportButton("weekly-ledger")}<button className="btn" onClick={() => setTablePage(p => Math.max(0, p - 1))} disabled={tablePage === 0}>Previous</button><button className="btn" onClick={() => setTablePage(p => Math.min(Math.ceil(computed.length / 10) - 1, p + 1))} disabled={(tablePage + 1) * 10 >= computed.length}>Next</button></div>
          </div>
          <div className="card-body" style={{ paddingTop: 12 }}>
            {computed.length === 0 ? <div className="file-drop">No usable weekly rows for this market.</div> : <div className="table-wrap"><table>
              <thead><tr><th>Report date</th><th>Large net</th><th>Small net</th><th>Commercial net</th><th>Δ commercial</th><th>CH Z</th><th>CH Δ score</th><th>Cycle LT / CH</th><th>OI move</th><th>Indicator state</th></tr></thead>
              <tbody style={{ fontSize: ({ Tiny: 10, Small: 12, Normal: 13, Large: 15, Huge: 17, Auto: 12 } as Record<string, number>)[settings.tableSize] }} >{tableRows.map((r, i) => <tr key={r.date} data-testid={`row-ledger-${i}`}>
                <td className="mono">{formatDate(r.date)}</td><td className={`mono ${changeTone(r.large_traders)}`}>{signed(r.large_traders)}</td><td className={`mono ${changeTone(r.small_traders)}`}>{signed(r.small_traders)}</td><td className={`mono ${changeTone(r.commercial_hedgers)}`}>{signed(r.commercial_hedgers)}</td>
                <td className={`mono weekly-change ${changeTone(r.chDelta)}`}>{signed(r.chDelta)}</td><td className="mono">{r.chZ == null ? "—" : `${signed(r.chZ, 2)}σ`}</td><td className="mono">{r.chDeltaPct == null ? "—" : `${fmt(r.chDeltaPct, 0)}th / ${signed(r.chDeltaZ, 2)}σ`}</td>
                <td className="mono"><span className={cycleTone(r.ltCycle)}>{fmt(r.ltCycle, 0)}</span> / <span className={cycleTone(r.chCycle)}>{fmt(r.chCycle, 0)}%</span></td><td className={`mono weekly-change ${changeTone(r.oiMove)}`}>{r.oiMove == null ? "—" : `${signed(r.oiMove, 1)}%`}</td>
                <td><span className={`badge ${r.buy ? "good" : r.sell ? "bad" : r.largeMove ? (moveRead(settings.participant, settings.participant === "Large Traders" ? r.ltDelta : settings.participant === "Small Traders" ? r.stDelta : r.chDelta)?.positive ? "good" : "bad") : "neutral"}`}>{!settings.showSignals && (r.buy || r.sell) ? "Labels hidden" : r.buy ? `Extreme long · ${signalPrefix}` : r.sell ? `Extreme short · ${signalPrefix}` : r.largeMove ? `Large change · ${moveRead(settings.participant, settings.participant === "Large Traders" ? r.ltDelta : settings.participant === "Small Traders" ? r.stDelta : r.chDelta)?.text.toLowerCase() ?? "no direction"}` : "No reading"}</span></td>
              </tr>)}</tbody>
            </table></div>}
            <div className="chart-foot">Position Z uses SMA and population standard deviation of the configured rolling window including the current week. Cycle rank uses the full available history.</div>
          </div>
        </div>
      </section>

      <footer style={{ marginTop: 24, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
          <span>COT Quant · CFTC public-data research surface</span><span>{liveActive ? "CFTC source · calculations run in this browser" : "Fallback sample is synthetic and not actual CFTC data"}</span>
      </footer>
    </main>
    <SiteMobileNav activeSection={activeSection} onSection={navigate} />
  </div>;
}

function App() {
  return <Switch>
    <Route path="/" component={Dashboard} />
    <Route path="/sector-signals" component={SectorSignalsPage} />
    <Route path="/signal-watchlist" component={SignalWatchlistPage} />
    <Route path="/how-it-works/:page?" component={HowItWorksPage} />
    <Route path="/sectors" component={SectorsPage} />
    <Route path="/invisible-hand" component={InvisibleHandPage} />
    <Route component={NotFound} />
  </Switch>;
}

export default App;
