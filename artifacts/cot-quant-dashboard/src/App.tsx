import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine,
  ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import Papa from "papaparse";
import { MarketSelector } from "@/components/market-selector";
import { CftcUpdateStatus } from "@/components/cftc-update-status";
import { Link, Route, Switch } from "wouter";
import { CONSOLIDATED_COMPONENTS, computeRows } from "@workspace/cot-engine";
import type { RawRow } from "@workspace/cot-engine";
import { useSharedSettings, STORAGE_SOURCE_MODE } from "@/lib/settings-store";
import type { Settings } from "@/lib/settings-store";
import { SectorSignalsPage } from "@/pages/sector-signals";
import { SignalWatchlistPage } from "@/pages/signal-watchlist";
import { HowItWorksPage } from "@/pages/how-it-works";
import { SectorsPage } from "@/pages/sectors";
import NotFound from "@/pages/not-found";
import {
  Activity, BarChart3, CircleHelp, Download, FileUp, Moon, Printer, RefreshCw,
  Settings2, Sun, Upload, Waves, Database, AlertTriangle, Clock3, LayoutGrid, ListOrdered,
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
const STORAGE_DATA = "cot-quant-local-rows-v1";
const STORAGE_THEME = "cot-quant-theme-v2";
const STORAGE_SOURCE = "cot-quant-source-selection-v1";
const STORAGE_CONSOLIDATED_DEFAULT = "cot-quant-consolidated-default-v1";
const sections = [
  { id: "summary", label: "Market overview", icon: BarChart3 },
  { id: "positioning", label: "Positioning", icon: Waves },
  { id: "signals", label: "Signal analysis", icon: Activity },
  { id: "configuration", label: "Configuration", icon: Settings2 },
];
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
function normalizeHeader(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }
const aliases: Record<string, string[]> = {
  date: ["date", "reportdate", "weeklydate", "asofdate", "reportdateasyyyymmdd", "reportdateasmmddyyyy"],
  large_traders: ["largetraders", "noncommercial", "netnoncommercial", "noncommercialnet", "noncommnet"],
  small_traders: ["smalltraders", "nonreportable", "netnonreportable", "nonreportablenet", "nonreptnet"],
  commercial_hedgers: ["commercialhedgers", "commercial", "netcommercial", "commercialnet", "commnet"],
  open_interest: ["openinterest"],
};
function normalizeDate(raw: string) {
  const value = raw.trim();
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}
function normalizeCSV(text: string): { rows: RawRow[]; raw: Record<string, unknown>[] } {
  const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, dynamicTyping: false, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(`CSV could not be read: ${parsed.errors[0].message}. Check delimiter, quoting, and the header row.`);
  const raw = parsed.data;
  if (!raw.length) throw new Error("No data rows found. Add weekly rows below the header.");
  if (raw.length > 10000) throw new Error("This CSV has more than 10,000 rows. Split it into smaller histories before importing.");
  const fields = Object.keys(raw[0] ?? {});
  const map: Record<string, string | undefined> = {};
  Object.entries(aliases).forEach(([key, names]) => { map[key] = fields.find(f => names.includes(normalizeHeader(f))); });
  map.open_interest = fields.find((field) => normalizeHeader(field).includes("openinterest"));
  const findPositionPair = (group: MetricKey) => {
    const matches = fields.filter((field) => {
      const name = normalizeHeader(field);
      if (!name.includes("position") || (!name.includes("long") && !name.includes("short"))) return false;
      if (group === "large_traders") return name.includes("noncomm");
      if (group === "small_traders") return name.includes("nonreportable") || name.includes("nonrept") || name.includes("nonreporting");
      return (name.includes("commercial") || name.startsWith("comm")) && !name.includes("noncomm");
    });
    const aggregateFields = matches.filter((field) => normalizeHeader(field).includes("all"));
    const selectedFields = aggregateFields.length
      ? aggregateFields
      : matches.filter((field) => !/old|other|spreading/.test(normalizeHeader(field)));
    return {
      long: selectedFields.find((field) => normalizeHeader(field).includes("long")),
      short: selectedFields.find((field) => normalizeHeader(field).includes("short")),
    };
  };
  const positionPairs = Object.fromEntries(metricKeys.map((key) => [key, findPositionPair(key)])) as Record<MetricKey, { long?: string; short?: string }>;
  const required = ["date", ...metricKeys];
  const missing = required.filter((key) => !map[key] && (key === "date" || !positionPairs[key as MetricKey].long || !positionPairs[key as MetricKey].short));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}. Include net long-minus-short fields, or CFTC long and short position columns for each participant.`);
  const usable: RawRow[] = [];
  let invalid = 0;
  const numeric = (record: Record<string, unknown>, field?: string): number | null => {
    if (!field) return null;
    const value = String(record[field] ?? "").trim().replace(/,/g, "");
    if (!value) return null;
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  };
  raw.forEach((record, i) => {
    const dateRaw = String(record[map.date!] ?? "").trim();
    const date = normalizeDate(dateRaw);
    const position = (key: MetricKey) => {
      const direct = numeric(record, map[key]);
      if (direct != null) return direct;
      const pair = positionPairs[key];
      const long = numeric(record, pair.long), short = numeric(record, pair.short);
      return long != null && short != null ? long - short : null;
    };
    const large = position("large_traders"), small = position("small_traders"), commercial = position("commercial_hedgers");
    if (!date || large == null || small == null || commercial == null) { invalid++; return; }
    const oi = numeric(record, map.open_interest);
    usable.push({ date, large_traders: large, small_traders: small, commercial_hedgers: commercial, ...(oi != null ? { open_interest: oi } : {}) });
  });
  usable.sort((a, b) => a.date.localeCompare(b.date));
  const duplicate = usable.find((row, index) => index > 0 && row.date === usable[index - 1]?.date);
  if (duplicate) throw new Error(`Duplicate report date found: ${duplicate.date}. Remove duplicate weekly rows and import again.`);
  if (usable.length < 3) throw new Error(`Only ${usable.length} usable rows found. At least 3 chronologically ordered weekly rows are required; ${invalid} row(s) were skipped for invalid date or numeric values.`);
  if (invalid) throw new Error(`${invalid} row(s) could not be used. Fix blank/invalid dates or participant values, then import again. At least 3 usable rows are required.`);
  return { rows: usable, raw };
}

function Dashboard() {
  useEffect(() => { document.title = "COT Quant Dashboard"; }, []);
  const [rows, setRows] = useState<RawRow[]>(() => {
    try { const v = localStorage.getItem(STORAGE_DATA); if (v) return JSON.parse(v).rows as RawRow[]; } catch { /* keep sample data */ }
    return DEMO_ROWS;
  });
  const [isImported, setIsImported] = useState(() => { try { return !!localStorage.getItem(STORAGE_DATA) && localStorage.getItem(STORAGE_SOURCE_MODE) !== "live"; } catch { return false; } });
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
  const [chartWeeks, setChartWeeks] = useState(26);
  const [uploadError, setUploadError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMark, setRefreshMark] = useState("");
  const [tablePage, setTablePage] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const marketsQuery = useGetCotMarkets(
    { report: liveReport },
    { query: { queryKey: getGetCotMarketsQueryKey({ report: liveReport }), enabled: !isImported, refetchOnMount: "always", refetchInterval: releaseWindowActive ? 60_000 : 5 * 60_000 } },
  );
  const marketList = marketsQuery.data?.markets ?? [];
  const preferredMarket = marketList.find(m => m.code === "13874+") ?? marketList.find(m => /E-MINI S&P 500/i.test(m.name));
  const effectiveMarket = marketList.find(m => m.name === selectedMarket) ?? preferredMarket ?? marketList[0];
  const historyQuery = useGetCotMarketHistory(
    { report: liveReport, market: effectiveMarket?.name ?? "" },
    {
      query: {
        queryKey: getGetCotMarketHistoryQueryKey({ report: liveReport, market: effectiveMarket?.name ?? "" }),
        enabled: Boolean(effectiveMarket) && !isImported,
        refetchOnMount: "always",
        refetchInterval: releaseWindowActive ? 60_000 : 5 * 60_000,
      },
    },
  );
  const analysisRows = useMemo<RawRow[]>(() => {
    if (isImported) return rows;
    if (!historyQuery.data?.rows.length) return DEMO_ROWS;
    return historyQuery.data.rows.map(row => ({
      date: row.date,
      large_traders: row.largeTraders,
      small_traders: row.smallTraders,
      commercial_hedgers: row.commercialHedgers,
      ...(row.openInterest != null ? { open_interest: row.openInterest } : {}),
    }));
  }, [isImported, rows, historyQuery.data]);
  const computed = useMemo(() => computeRows(analysisRows, settings), [analysisRows, settings]);
  const latest = computed[computed.length - 1];
  const previous = computed[computed.length - 2];
  const visible = chartWeeks === 0 ? computed : computed.slice(-chartWeeks);
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
  useEffect(() => { setTablePage(0); }, [historyQuery.data, isImported]);
  useEffect(() => {
    let wasInWindow = isCftcReleaseWindow();
    const timer = window.setInterval(() => {
      const inWindow = isCftcReleaseWindow();
      setReleaseWindowActive(inWindow);
      if (inWindow && !wasInWindow) {
        void marketsQuery.refetch();
        if (!isImported) void historyQuery.refetch();
      }
      wasInWindow = inWindow;
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [isImported, liveReport, effectiveMarket?.name]);
  useEffect(() => { try { localStorage.setItem(STORAGE_SOURCE_MODE, isImported ? "csv" : "live"); } catch { /* storage unavailable */ } }, [isImported]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const visibleSection = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visibleSection) setActiveSection(visibleSection.target.id);
    }, { rootMargin: "-15% 0px -65% 0px", threshold: [0, .2, .5] });
    sections.forEach(s => { const el = document.getElementById(s.id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);
  function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) { setSettings(s => ({ ...s, [key]: value })); }
  function navigate(id: string) { setActiveSection(id); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  function handleRefresh() {
    setRefreshing(true);
    void Promise.all([marketsQuery.refetch(), !isImported ? historyQuery.refetch() : Promise.resolve(null)]).finally(() => {
      setRefreshMark(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
      setRefreshing(false);
    });
  }
  function resetData() {
    setIsImported(false); setUploadError(""); setUploadMessage("Switched back to the official CFTC data.");
    try { localStorage.removeItem(STORAGE_DATA); } catch { /* storage unavailable */ }
    if (fileRef.current) fileRef.current.value = "";
    if (historyQuery.data?.rows.length) {
      setRows(historyQuery.data.rows.map(row => ({
        date: row.date, large_traders: row.largeTraders, small_traders: row.smallTraders,
        commercial_hedgers: row.commercialHedgers, ...(row.openInterest != null ? { open_interest: row.openInterest } : {}),
      })));
    } else setRows(DEMO_ROWS);
  }
  function importFile(file?: File) {
    setUploadError(""); setUploadMessage("");
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setUploadError("This file exceeds 15 MB. Split the weekly history into smaller CSV files and retry."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const source = String(reader.result ?? "");
        const parsed = normalizeCSV(source);
        setRows(parsed.rows); setIsImported(true); setTablePage(0);
        let persisted = true;
        try { localStorage.setItem(STORAGE_DATA, JSON.stringify({ rows: parsed.rows, raw: parsed.raw, sourceName: file.name, importedAt: new Date().toISOString() })); } catch { persisted = false; }
        if (persisted) setUploadMessage(`${parsed.rows.length.toLocaleString()} weekly rows loaded from ${file.name}. Data remains in this browser.`);
        else setUploadError("Import analyzed, but browser storage is unavailable. The data will not persist after reload.");
      } catch (e) { setUploadError(e instanceof Error ? e.message : "Could not parse this file. Review the CSV format and try again."); }
    };
    reader.onerror = () => setUploadError("The browser could not read this file. Choose a local .csv file and retry.");
    reader.readAsText(file);
  }
  const exportRows = (rowsToExport = computed) => rowsToExport.map(r => ({
    date: r.date, large_traders_net: r.large_traders, small_traders_net: r.small_traders,
    commercial_hedgers_net: r.commercial_hedgers, open_interest: r.open_interest ?? "",
    large_z: r.ltZ, small_z: r.stZ, commercial_z: r.chZ, large_cycle_pct: r.ltCycle, small_cycle_pct: r.stCycle, commercial_cycle_pct: r.chCycle,
    commercial_delta: r.chDelta, commercial_delta_percentile: r.chDeltaPct, commercial_delta_z: r.chDeltaZ,
    signal: r.buy ? (settings.signalMode === "Z-Score Only" ? "Bullish Z-score" : "Bullish confluence") : r.sell ? (settings.signalMode === "Z-Score Only" ? "Bearish Z-score" : "Bearish confluence") : "No signal", oi_change_pct: r.oiMove,
  }));
  const exportButton = (name: string, records: Record<string, unknown>[] = exportRows()) => <button className="icon-btn print-hidden" title={`Export ${name} chart data as CSV`} aria-label={`Export ${name} chart data as CSV`} data-testid={`export-${name}-csv`} onClick={() => makeCsv(records, `cot-${name}.csv`)}><Download size={15} /></button>;
  const chartTick = { fill: "hsl(var(--muted-foreground))", fontSize: 11, fontFamily: "DM Mono" };
  const TooltipBox = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    return <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 7, padding: "10px 12px", color: "hsl(var(--foreground))", fontSize: 12 }}>
      <div style={{ fontFamily: "DM Mono", marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ display: "flex", gap: 14, justifyContent: "space-between" }}><span style={{ color: p.color }}>{p.name}</span><b className="mono">{fmt(p.value)}</b></div>)}
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
  const signalLabel = latest?.buy ? `Bullish ${signalPrefix}` : latest?.sell ? `Bearish ${signalPrefix}` : "No aligned signal";
  const signalTone = latest?.buy ? "good" : latest?.sell ? "bad" : "neutral";
  const selectedPosition = latest ? (settings.participant === "Large Traders" ? latest.large_traders : settings.participant === "Small Traders" ? latest.small_traders : latest.commercial_hedgers) : 0;
  const showSignalMark = Boolean(latest && ((settings.showSignals && (latest.buy || latest.sell)) || latest.largeMove));
  const signalMarkText = latest?.buy ? "BUY" : latest?.sell ? "SELL" : latest?.largeMove ? (latest.moveDirection === "Net positioning increased" ? "POSITION +" : "POSITION −") : "";
  const signalMarkColor = latest?.buy ? C.large : latest?.sell ? C.red : C.small;
  const liveActive = !isImported && Boolean(historyQuery.data?.rows.length);
  const liveFailure = !isImported && (marketsQuery.isError || historyQuery.isError);
  const reportName = liveReport === "futures" ? "Legacy Futures Only" : "Legacy Combined";
  const checkTime = historyQuery.data?.checkedAt ?? marketsQuery.data?.checkedAt;
  const isReportStale = reportAgeDays(historyQuery.data?.reportAsOf) > 9;
  const dataMarketLabel = isImported ? settings.marketLabel || "Local CSV dataset" : liveActive ? historyQuery.data!.marketName : "Illustrative sample · not market data";

  return <div className="shell">
    <aside className="sidebar">
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "2px 8px 30px" }}>
        <div className="brand-mark"><Activity size={18} /></div>
        <div><div style={{ fontFamily: "var(--app-font-serif)", fontWeight: 800, fontSize: 14, letterSpacing: "-.04em" }}>COT / QUANT</div><div style={{ font: "9px var(--app-font-mono)", color: "rgba(244,241,232,.5)", marginTop: 3 }}>RESEARCH TERMINAL</div></div>
      </div>
      <div className="eyebrow" style={{ color: "rgba(244,241,232,.42)", padding: "0 12px 8px" }}>Workspace</div>
      <nav style={{ display: "grid", gap: 3 }}>
        {sections.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-link ${activeSection === id ? "active" : ""}`} onClick={() => navigate(id)} data-testid={`nav-${id}`}><Icon size={16} />{label}</button>)}
      </nav>
      <div className="eyebrow" style={{ color: "rgba(244,241,232,.42)", padding: "22px 12px 8px" }}>All-market scan</div>
      <nav style={{ display: "grid", gap: 3 }}>
        <Link href="/sector-signals" className="nav-link" data-testid="nav-sector-signals"><LayoutGrid size={16} />Sector signals</Link>
        <Link href="/signal-watchlist" className="nav-link" data-testid="nav-signal-watchlist"><ListOrdered size={16} />Signal watchlist</Link>
        <Link href="/how-it-works" className="nav-link" data-testid="nav-how-it-works"><CircleHelp size={16} />How it works</Link>
      </nav>
      <div style={{ marginTop: "auto", borderTop: "1px solid hsl(var(--sidebar-border))", padding: "18px 8px 0" }}>
        <div className="eyebrow" style={{ color: "rgba(244,241,232,.42)" }}>Data mode</div>
        <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span className="dot" style={{ background: isImported ? "#65c7a4" : liveActive ? "#65c7a4" : liveFailure ? "#e27667" : "#e6a752" }} />{isImported ? "Local CSV import" : liveActive ? "Official CFTC data" : liveFailure ? "CFTC connection issue" : "Connecting to CFTC"}
        </div>
        <div style={{ color: "rgba(244,241,232,.45)", fontSize: 10, lineHeight: 1.55, marginTop: 8 }}>{isImported ? "CSV imports stay on this device." : "Official weekly CFTC reports · Tuesday positions, usually posted Friday."}</div>
      </div>
    </aside>

    <main className="main">
      <header className="topline">
        <div>
          <div className="eyebrow" style={{ marginBottom: 9 }}>Positioning intelligence <span style={{ margin: "0 6px" }}>/</span> {isImported ? "Local CSV" : effectiveMarket?.name ?? "CFTC markets"}</div>
          <h1 className="page-title display">COT Quant Dashboard</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 9, flexWrap: "wrap" }}>
            <span className={`badge ${isImported ? "good" : liveFailure ? "bad" : liveActive && !isReportStale ? "good" : "warn"}`} data-testid="status-data-mode"><span className="dot" style={{ background: isImported ? "#69c8a7" : liveFailure ? "#e27667" : liveActive && !isReportStale ? "#69c8a7" : "#e6a752" }} />{isImported ? "Local CSV import" : liveFailure ? "CFTC request failed" : liveActive && isReportStale ? "CFTC report may be stale" : liveActive ? "Official CFTC data · weekly" : "Illustrative demo fallback"}</span>
            <span className="subtle" style={{ fontSize: 12 }}>{computed.length} weekly observations · latest report date {latest ? formatDate(latest.date) : "—"}</span>
          </div>
        </div>
        <div className="toolbar print-hidden">
          <button className="btn" onClick={() => navigate("configuration")}><FileUp size={14} />Import COT data</button>
          <button className="btn" onClick={handleRefresh} disabled={refreshing} data-testid="button-refresh"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />{refreshing ? "Checking…" : "Check CFTC"}</button>
          <button className="icon-btn" aria-label="Print or export PDF" title="Print / Save as PDF" onClick={() => window.print()} data-testid="button-print"><Printer size={15} /></button>
          <button className="icon-btn" aria-label="Toggle dark mode" title="Toggle theme" onClick={() => setIsDark(v => !v)} data-testid="button-theme">{isDark ? <Sun size={15} /> : <Moon size={15} />}</button>
        </div>
      </header>
      <div className={`source-banner ${liveFailure ? "source-error" : isImported ? "source-local" : ""}`} role={liveFailure ? "alert" : "status"} data-testid="status-cftc-source">
        {liveFailure ? <AlertTriangle size={17} /> : isImported ? <FileUp size={17} /> : <Database size={17} />}
        <div className="source-copy">
          <strong>{isImported ? "Local CSV is active" : liveFailure ? "CFTC source unavailable" : liveActive ? "Official CFTC source" : "CFTC source status"}</strong>
          <span>{isImported
            ? "Periodic CFTC checks will not replace this import. Switch back when you want the official CFTC report."
            : liveFailure
              ? `${historyQuery.isError ? "Weekly history request" : "Market list request"} failed${historyQuery.error instanceof Error ? `: ${historyQuery.error.message}` : marketsQuery.error instanceof Error ? `: ${marketsQuery.error.message}` : "."} ${liveActive ? "Existing returned CFTC history remains displayed with its original report date." : "Any displayed rows remain clearly labelled illustrative fallback, not current CFTC data."}`
              : liveActive
                ? `${reportName} · ${effectiveMarket?.name ?? historyQuery.data?.marketName} · Tuesday report date ${formatDate(historyQuery.data!.reportAsOf)}. ${isReportStale ? "No newer release has been returned; the latest report is over nine days old. CFTC publication may be delayed." : "This is the Tuesday as-of date, not the Friday publication date."}`
                : "Loading the latest official feed. Any demo rows shown are synthetic and are not relabelled as current CFTC observations."}
          </span>
          <small><Clock3 size={12} /> {checkTime ? `Last checked ${new Date(checkTime).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" })} ET` : "Last check pending"}{historyQuery.data?.reportAsOf ? ` · report as of ${formatDate(historyQuery.data.reportAsOf)}` : marketsQuery.data?.reportAsOf ? ` · market list as of ${formatDate(marketsQuery.data.reportAsOf)}` : ""}</small>
          {!isImported && <CftcUpdateStatus />}
          {!isImported && historyQuery.data?.sourceWarning && <small style={{ color: "#e6a752" }}>{historyQuery.data.sourceWarning}</small>}
        </div>
        {isImported && <button className="btn source-action print-hidden" onClick={resetData} data-testid="button-switch-to-cftc">Switch to CFTC data</button>}
      </div>
      <div className="toolbar source-controls print-hidden" style={{ justifyContent: "space-between", marginBottom: 18 }}>
        <div className="source-selects">
          <label className="field"><span className="eyebrow">CFTC report</span><select className="select" value={liveReport} onChange={e => { setLiveReport(e.target.value as "futures" | "combined"); setSelectedMarket(""); }} aria-label="CFTC report type" data-testid="select-cftc-report" disabled={isImported}><option value="futures">Legacy Futures Only</option><option value="combined">Legacy Combined</option></select></label>
          <div className="field field-market"><span className="eyebrow" id="label-cftc-market">Market</span><MarketSelector markets={marketList} value={effectiveMarket?.name ?? ""} onChange={setSelectedMarket} disabled={isImported} loading={marketsQuery.isLoading} /></div>
        </div>
        <div className="source-summary">
          <span className="eyebrow">{isImported ? "Active dataset" : "Selected source"}</span>
          <b>{isImported ? "Browser CSV · local only" : `${reportName} / ${effectiveMarket?.name ?? "Market pending"}`}</b>
          <small>{isImported ? "CFTC history polling paused for this dataset" : `Tuesday observations · ${historyQuery.data?.rows.length ?? "—"} rows`}</small>
        </div>
      </div>
      <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 18 }}>
        <div className="eyebrow">Calculation profile <span style={{ color: "hsl(var(--foreground))", marginLeft: 8 }}>{isImported ? settings.reportType : reportName}</span> <span className="subtle" style={{ margin: "0 8px" }}>·</span> Legacy net positioning · Long − Short</div>
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
            <div className="card-head"><div><h2 className="panel-title">Weekly net positioning</h2><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>{dataMarketLabel} · {isImported ? "Local CSV" : reportName} · Long − Short</div></div><div className="toolbar"><select className="select print-hidden" style={{ width: 115, minHeight: 32, padding: "5px 8px", fontSize: 11 }} value={chartWeeks} onChange={e => setChartWeeks(Number(e.target.value))} aria-label="Chart history range" data-testid="select-chart-range"><option value={13}>13 weeks</option><option value={26}>26 weeks</option><option value={52}>52 weeks</option><option value={0}>All rows</option></select>{exportButton("weekly-positioning", exportRows(visible))}</div></div>
            <div className="card-body">
              <div className="control-group" style={{ marginBottom: 8 }}>
                {([["showLT", "Large", C.large], ["showST", "Small", C.small], ["showCH", "Commercial", C.commercial]] as const).map(([key, label, color]) => <button key={key} className={`seg ${settings[key] ? "active" : ""}`} style={settings[key] ? { background: color, borderColor: color, color: "#fff" } : {}} onClick={() => setSetting(key, !settings[key])}>{label}</button>)}
              </div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={visible} margin={{ top: 10, right: 10, bottom: 0, left: 5 }}>
                    <CartesianGrid stroke={C.grid} strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="date" tick={chartTick} tickFormatter={d => String(d).slice(2, 7)} minTickGap={35} axisLine={false} tickLine={false} />
                    <YAxis tick={chartTick} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={43} />
                    <Tooltip content={<TooltipBox />} isAnimationActive={false} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={.5} />
                    {showSignalMark && latest && settings.highlight !== "Shapes Only" && <ReferenceArea x1={latest.date} x2={latest.date} fill={signalMarkColor} fillOpacity={0.14} />}
                    {settings.showLT && <Line type="monotone" dataKey="large_traders" name="Large traders" stroke={C.large} strokeWidth={2} dot={false} isAnimationActive={false} />}
                    {settings.showST && <Line type="monotone" dataKey="small_traders" name="Small traders" stroke={C.small} strokeWidth={2} dot={false} isAnimationActive={false} />}
                    {settings.showCH && <Line type="monotone" dataKey="commercial_hedgers" name="Commercial hedgers" stroke={C.commercial} strokeWidth={2.3} dot={false} isAnimationActive={false} />}
                    {showSignalMark && latest && settings.highlight !== "Background Only" && <ReferenceDot x={latest.date} y={selectedPosition} r={6} fill={signalMarkColor} stroke="hsl(var(--card))" strokeWidth={2} ifOverflow="visible" label={{ value: signalMarkText, position: "top", fill: signalMarkColor, fontSize: 10, fontFamily: "DM Mono" }} />}
                  </LineChart>
              </ResponsiveContainer>
              </div>{settings.showPaneLabel && <div className="eyebrow" style={{ marginTop: 8 }}>{dataMarketLabel} · {isImported ? settings.reportType : reportName} · Long − Short</div>}<div className="chart-foot">Most recent {visible.length} of {computed.length} weekly rows · {dataMarketLabel} · {isImported ? "local import" : reportName} · same observations as analysis table · highlight: {settings.highlight}</div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div><h2 className="panel-title">Current readout</h2><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>Derived from the selected latest row</div></div><Activity size={16} className="subtle" /></div>
            <div className="card-body">
              <div className="eyebrow">Configured signal mode</div>
              <div style={{ marginTop: 9 }}><span className={`badge ${signalTone}`} data-testid="status-signal"><span className="dot" style={{ background: latest?.buy ? "#2a8b79" : latest?.sell ? "#c95b4c" : "hsl(var(--muted-foreground))" }} />{signalLabel}</span></div>
              <div style={{ marginTop: 19, display: "grid", gap: 13 }}>
                <div className="statline"><span className="subtle">Monitored participant</span><b>{settings.participant}</b></div>
                <div className="statline"><span className="subtle">Position Z-score</span><b className="mono">{selectedZ == null ? "Insufficient lookback" : `${signed(selectedZ, 2)}σ`}</b></div>
                <div className="statline"><span className="subtle">Confluence</span><b>{latest?.confluenceBull ? "Opposing extremes · bullish" : latest?.confluenceBear ? "Opposing extremes · bearish" : "Not aligned"}</b></div>
                <div className="statline"><span className="subtle">OI threshold</span><b className="mono">{latest?.oiMove != null && Math.abs(latest.oiMove) >= settings.oiThreshold ? `${signed(latest.oiMove, 1)}% alert` : "No threshold breach"}</b></div>
              </div>
              <div className="notice" style={{ marginTop: 19 }}>A signal state is a mechanical indicator output—not a recommendation. Position extremes and confluence are descriptive inputs only.</div>
            </div>
          </div>
        </div>
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
        <div style={{ marginBottom: 13 }}><div className="eyebrow">Indicator semantics</div><h2 className="display" style={{ fontSize: 24, margin: "4px 0 0" }}>Signals &amp; weekly ledger</h2></div>
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-head"><div><h3 className="panel-title">Signal interpretation</h3><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>Pine-compatible direction conventions applied to local weekly rows</div></div><span className="badge">{settings.signalMode}</span></div>
          <div className="card-body signal-explainer">
            <div className="notice"><b>Z-score only</b><br />Large and small trader extremes are contrarian: negative Z is bullish, positive Z bearish. Commercial extremes follow positioning: positive Z bullish, negative Z bearish.</div>
            <div className="notice"><b>COT confluence</b><br />Commercial and large-trader cycle ranks must sit at opposing configurable extremes. Small trader agreement is optional confirmation.</div>
            <div className="notice"><b>Both (AND gate)</b><br />Requires the selected participant Z-score direction and opposing-cycle confluence to agree in the same week.</div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h3 className="panel-title">Weekly calculations</h3><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>{dataMarketLabel} · {isImported ? settings.reportType : reportName} · one record per Tuesday report date; latest row drives readout</div></div>
            <div className="toolbar print-hidden">{exportButton("weekly-ledger")}<button className="btn" onClick={() => setTablePage(p => Math.max(0, p - 1))} disabled={tablePage === 0}>Previous</button><button className="btn" onClick={() => setTablePage(p => Math.min(Math.ceil(computed.length / 10) - 1, p + 1))} disabled={(tablePage + 1) * 10 >= computed.length}>Next</button></div>
          </div>
          <div className="card-body" style={{ paddingTop: 12 }}>
            {computed.length === 0 ? <div className="file-drop">No usable rows. Import a weekly COT CSV to begin.</div> : <div className="table-wrap"><table>
              <thead><tr><th>Report date</th><th>Large net</th><th>Small net</th><th>Commercial net</th><th>Δ commercial</th><th>CH Z</th><th>CH Δ score</th><th>Cycle LT / CH</th><th>OI move</th><th>Indicator state</th></tr></thead>
              <tbody style={{ fontSize: ({ Tiny: 10, Small: 12, Normal: 13, Large: 15, Huge: 17, Auto: 12 } as Record<string, number>)[settings.tableSize] }} >{tableRows.map((r, i) => <tr key={r.date} data-testid={`row-ledger-${i}`}>
                <td className="mono">{formatDate(r.date)}</td><td className={`mono ${changeTone(r.large_traders)}`}>{signed(r.large_traders)}</td><td className={`mono ${changeTone(r.small_traders)}`}>{signed(r.small_traders)}</td><td className={`mono ${changeTone(r.commercial_hedgers)}`}>{signed(r.commercial_hedgers)}</td>
                <td className={`mono weekly-change ${changeTone(r.chDelta)}`}>{signed(r.chDelta)}</td><td className="mono">{r.chZ == null ? "—" : `${signed(r.chZ, 2)}σ`}</td><td className="mono">{r.chDeltaPct == null ? "—" : `${fmt(r.chDeltaPct, 0)}th / ${signed(r.chDeltaZ, 2)}σ`}</td>
                <td className="mono"><span className={cycleTone(r.ltCycle)}>{fmt(r.ltCycle, 0)}</span> / <span className={cycleTone(r.chCycle)}>{fmt(r.chCycle, 0)}%</span></td><td className={`mono weekly-change ${changeTone(r.oiMove)}`}>{r.oiMove == null ? "—" : `${signed(r.oiMove, 1)}%`}</td>
                <td><span className={`badge ${r.buy ? "good" : r.sell ? "bad" : "neutral"}`}>{!settings.showSignals && (r.buy || r.sell) ? "Signal labels hidden" : r.buy ? `Bullish ${signalPrefix}` : r.sell ? `Bearish ${signalPrefix}` : r.largeMove ? "Large position change" : "No signal"}</span></td>
              </tr>)}</tbody>
            </table></div>}
            <div className="chart-foot">Position Z uses SMA and population standard deviation of the configured rolling window including the current week. Cycle rank uses the full available history.</div>
          </div>
        </div>
      </section>

      <section id="configuration" className="section">
        <div style={{ marginBottom: 13 }}><div className="eyebrow">Controls &amp; local data</div><h2 className="display" style={{ fontSize: 24, margin: "4px 0 0" }}>Configuration</h2></div>
        <div className="setting-grid">
          <div className="card"><div className="card-head"><div><h3 className="panel-title">Core settings</h3><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>Market context and signal selection</div></div></div>
            <div className="card-body" style={{ display: "grid", gap: 14 }}>
              {isImported ? <>
                <div className="field"><label htmlFor="market-label">CSV dataset label (optional)</label><input id="market-label" className="input" placeholder="e.g. S&amp;P 500 E-mini" value={settings.marketLabel} onChange={e => setSetting("marketLabel", e.target.value.slice(0, 80))} data-testid="input-market-label" /></div>
                <div className="field"><label htmlFor="report-type">CSV report type</label><select id="report-type" className="select" value={settings.reportType} onChange={e => setSetting("reportType", e.target.value)} data-testid="select-report-type"><option>Legacy Futures Only</option><option>Legacy Combined</option></select></div>
                <div className="notice">These labels describe the imported CSV. The selected report data itself is not transformed.</div>
              </> : <div className="notice">Source: official CFTC Legacy reports, published weekly. Choose the report and market above; the dashboard loads the weekly history automatically.</div>}
              <div className="field"><label htmlFor="participant-type">Participant for Z-score signals</label><select id="participant-type" className="select" value={settings.participant} onChange={e => setSetting("participant", e.target.value)} data-testid="select-participant"><option>Large Traders</option><option>Small Traders</option><option>Commercial Hedgers</option></select></div>
              <div className="field"><label htmlFor="signal-mode">Signal mode</label><select id="signal-mode" className="select" value={settings.signalMode} onChange={e => setSetting("signalMode", e.target.value)} data-testid="select-signal-mode"><option>Z-Score Only</option><option>COT Confluence</option><option>Both (AND gate)</option></select></div>
            </div>
          </div>
          <div className="card"><div className="card-head"><div><h3 className="panel-title">Calculation thresholds</h3><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>Rolling window and cycle extremes</div></div></div>
            <div className="card-body" style={{ display: "grid", gap: 14 }}>
              <div className="field"><label htmlFor="lookback">Lookback period · weeks</label><input id="lookback" className="input mono" type="number" min="3" max="500" value={settings.lookback} onChange={e => setSetting("lookback", Math.max(3, Math.min(500, Number(e.target.value) || 3)))} data-testid="input-lookback" /></div>
              <div className="field"><label htmlFor="z-threshold">Z-score threshold · standard deviations</label><input id="z-threshold" className="input mono" type="number" min="0" max="20" step=".1" value={settings.zThreshold} onChange={e => setSetting("zThreshold", Math.max(0, Math.min(20, Number(e.target.value) || 0)))} data-testid="input-z-threshold" /></div>
              <div className="field"><label htmlFor="conf-threshold">Confluence cycle threshold · %</label><input id="conf-threshold" className="input mono" type="number" min="50" max="95" step="5" value={settings.confluenceThreshold} onChange={e => setSetting("confluenceThreshold", Math.max(50, Math.min(95, Number(e.target.value) || 50)))} data-testid="input-confluence-threshold" /></div>
              <div className="field"><label htmlFor="oi-threshold">Open interest move threshold · %</label><input id="oi-threshold" className="input mono" type="number" min="1" max="100" value={settings.oiThreshold} onChange={e => setSetting("oiThreshold", Math.max(1, Math.min(100, Number(e.target.value) || 1)))} data-testid="input-oi-threshold" /></div>
            </div>
          </div>
          <div className="card"><div className="card-head"><div><h3 className="panel-title">Display controls</h3><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>Participant visibility and highlight style</div></div></div>
            <div className="card-body">
              {[["Enable Z-score detection", "zEnabled"], ["Require small trader confirmation", "requireSmall"], ["Enable large position change", "changeEnabled"], ["Show buy / sell labels", "showSignals"], ["Show pane label", "showPaneLabel"]].map(([label, key]) => <div className="switch-row" key={key}><span>{label}</span><input className="switch" type="checkbox" checked={Boolean(settings[key as keyof Settings])} onChange={e => setSetting(key as keyof Settings, e.target.checked as never)} aria-label={label} /></div>)}
              <div className="field" style={{ marginTop: 14 }}><label htmlFor="highlight">Highlight style</label><select id="highlight" className="select" value={settings.highlight} onChange={e => setSetting("highlight", e.target.value)}><option>Shapes + Background</option><option>Shapes Only</option><option>Background Only</option></select></div>
              <div className="field" style={{ marginTop: 12 }}><label htmlFor="table-size">Table density</label><select id="table-size" className="select" value={settings.tableSize} onChange={e => setSetting("tableSize", e.target.value)}>{["Tiny", "Small", "Normal", "Large", "Huge", "Auto"].map(x => <option key={x}>{x}</option>)}</select></div>
            </div>
          </div>
        </div>
        <div className="card section">
          <div className="card-head"><div><h3 className="panel-title">Import weekly COT rows</h3><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>CSV is parsed and stored locally in this browser only</div></div><FileUp size={17} className="subtle" /></div>
          <div className="card-body">
            <div className="import-grid">
              <div>
                <div className="file-drop">
                  <Upload size={20} style={{ color: "hsl(var(--primary))", margin: "0 auto 9px" }} />
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Choose a weekly CSV file</div>
                  <div className="subtle" style={{ fontSize: 11, margin: "5px 0 12px" }}>Weekly rows · sorted by report date · up to 15 MB</div>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="Import COT CSV file" data-testid="input-csv-file" onChange={e => importFile(e.target.files?.[0])} />
                  {uploadError && <div className="error" role="alert" data-testid="text-import-error">{uploadError}</div>}
                  {uploadMessage && <div className="success" role="status" data-testid="text-import-success">{uploadMessage}</div>}
                </div>
                <div className="toolbar" style={{ marginTop: 11 }}>
                  <button className="btn" onClick={() => makeCsv(DEMO_ROWS.map(r => ({ date: r.date, large_traders: r.large_traders, small_traders: r.small_traders, commercial_hedgers: r.commercial_hedgers, open_interest: r.open_interest })), "cot-illustrative-template.csv")} data-testid="button-download-template"><Download size={14} />Download example CSV</button>
                  {isImported && <button className="btn" onClick={resetData} data-testid="button-reset-demo">Switch back to CFTC data</button>}
                </div>
              </div>
              <div>
                <div className="eyebrow" style={{ marginBottom: 9 }}>Accepted columns</div>
                <div className="notice" style={{ marginBottom: 12 }}><b>Required:</b> report date and net long-minus-short positions for large, small, and commercial traders, or raw CFTC Long/Short positions for each group.<br /><b>Optional:</b> open interest</div>
                <div className="subtle" style={{ fontSize: 11, lineHeight: 1.8 }}>Aliases include <span className="mono">report_date</span>, <span className="mono">noncommercial</span>, <span className="mono">nonreportable</span>, <span className="mono">commercial</span>, and <span className="mono">openinterest</span>. Standard CFTC long/short columns are converted to net values.</div>
                <div className="notice" style={{ marginTop: 12 }}>Rows are sorted by report date. Duplicate dates and invalid participant values are rejected with an actionable message. Imported records are kept in this browser only; no upload request is made.</div>
              </div>
            </div>
          </div>
        </div>
        <footer style={{ marginTop: 24, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
          <span>COT Quant · CFTC public-data research surface</span><span>{isImported ? "Imported CSV is stored on this device" : liveActive ? "CFTC source · calculations run in this browser" : "Fallback sample is synthetic and not actual CFTC data"}</span>
        </footer>
      </section>
    </main>
    <nav className="mobile-nav print-hidden">
      {sections.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-link ${activeSection === id ? "active" : ""}`} onClick={() => navigate(id)} aria-label={label} data-testid={`mobile-nav-${id}`}><Icon size={16} /><span>{label.split(" ")[0]}</span></button>)}
      <Link href="/sector-signals" className="nav-link" aria-label="Sector signals" data-testid="mobile-nav-sector-signals"><LayoutGrid size={16} /><span>Sectors</span></Link>
      <Link href="/signal-watchlist" className="nav-link" aria-label="Signal watchlist" data-testid="mobile-nav-signal-watchlist"><ListOrdered size={16} /><span>Watchlist</span></Link>
      <Link href="/how-it-works" className="nav-link" aria-label="How it works" data-testid="mobile-nav-how-it-works"><CircleHelp size={16} /><span>Info</span></Link>
    </nav>
  </div>;
}

function App() {
  return <Switch>
    <Route path="/" component={Dashboard} />
    <Route path="/sector-signals" component={SectorSignalsPage} />
    <Route path="/signal-watchlist" component={SignalWatchlistPage} />
    <Route path="/how-it-works" component={HowItWorksPage} />
    {/* Unlisted until a licensed price source is connected. */}
    <Route path="/sectors" component={SectorsPage} />
    <Route component={NotFound} />
  </Switch>;
}

export default App;
