import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Clock3, Info, Moon, RefreshCw, Sun } from "lucide-react";
import { SiteBrand, SiteMobileNav, SiteNav } from "@/components/site-nav";
import { SettingsBar } from "@/components/settings-bar";
import { STORAGE_THEME } from "@/lib/settings-store";
import type { useScreener } from "@/hooks/use-screener";
import { shortDate } from "@/hooks/use-screener";
import { CftcUpdateStatus } from "@/components/cftc-update-status";
import "./scanner.css";

type Screener = ReturnType<typeof useScreener>;


function useTheme() {
  const [isDark, setIsDark] = useState(() => { try { return localStorage.getItem(STORAGE_THEME) !== "light"; } catch { return true; } });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    try { localStorage.setItem(STORAGE_THEME, isDark ? "dark" : "light"); } catch { /* storage unavailable */ }
  }, [isDark]);
  return [isDark, setIsDark] as const;
}

export { useTheme };

export function ScannerShell({ eyebrow, title, lede, screener, children }: { eyebrow: string; title: string; lede: string; screener: Screener; children: ReactNode }) {
  const [isDark, setIsDark] = useTheme();
  useEffect(() => { window.scrollTo(0, 0); document.title = `${title} · COT Quant`; }, [title]);
  return <div className="shell">
    <aside className="sidebar">
      <SiteBrand />
      <SiteNav />
      <div style={{ marginTop: "auto", borderTop: "1px solid hsl(var(--sidebar-border))", padding: "18px 8px 0" }}>
        <div className="eyebrow" style={{ color: "rgba(244,241,232,.42)" }}>Scanner source</div>
        <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}><span className="dot" style={{ background: screener.query.isError ? "#e27667" : screener.scanning ? "#e6a752" : "#65c7a4" }} />Official CFTC data</div>
        <div style={{ color: "rgba(244,241,232,.45)", fontSize: 10, lineHeight: 1.55, marginTop: 8 }}>Scanner pages always read the official report, even when the detail view uses a local CSV.</div>
      </div>
    </aside>
    <main className="main">
      <header className="topline">
        <div>
          <div className="eyebrow" style={{ marginBottom: 9 }}>{eyebrow}</div>
          <h1 className="page-title display">{title}</h1>
          <p className="subtle scan-lede">{lede}</p>
        </div>
        <div className="toolbar print-hidden">
          <label className="field scan-report"><span className="eyebrow">CFTC report</span>
            <select className="select" value={screener.report} onChange={e => screener.setReport(e.target.value as "futures" | "combined")} data-testid="select-scan-report"><option value="futures">Legacy Futures Only</option><option value="combined">Legacy Combined</option></select>
          </label>
          <button className="btn" onClick={screener.refresh} disabled={screener.refreshing || screener.data?.status === "loading"} data-testid="button-refresh-scan"><RefreshCw size={14} className={screener.refreshing || screener.scanning ? "animate-spin" : ""} />{screener.scanning ? "Scanning…" : "Rescan CFTC"}</button>
          <button className="icon-btn" aria-label="Toggle dark mode" title="Toggle theme" onClick={() => setIsDark(v => !v)} data-testid="button-theme">{isDark ? <Sun size={15} /> : <Moon size={15} />}</button>
        </div>
      </header>
      <ScanStatus screener={screener} />
      <SettingsBar />
      {children}
      <footer className="scan-foot">
        <span>COT Quant · all-market scan of the official CFTC Legacy report</span>
        <span>Readings are mechanical rule states, not recommendations.</span>
      </footer>
    </main>
    <SiteMobileNav />
  </div>;
}

function ScanStatus({ screener }: { screener: Screener }) {
  const { data, query, scanning } = screener;
  const progress = scanning ? screener.scanProgress : null;
  const total = progress?.total ?? data?.total ?? 0, processed = progress?.done ?? data?.processed ?? 0;
  const pct = total ? Math.round(processed / total * 100) : 0;
  const err = query.isError || data?.status === "error" || screener.refreshError;
  const warning = !err && Boolean(data?.message);
  const eligible = data?.markets.filter(market => market.status === "ready").length ?? 0;
  const lastChecked = data?.updatedAt ?? data?.startedAt;
  return <div className={`source-banner scan-status ${err ? "source-error" : ""}`} role={err ? "alert" : "status"} data-testid="status-scan">
    {err || warning ? <AlertTriangle size={17} /> : <Clock3 size={17} />}
    <div className="source-copy">
      <strong>{err ? "Scan problem" : scanning ? "Scan in progress · partial results" : data ? warning ? "Scan complete · coverage warning" : "Scan complete" : "Starting scan"}</strong>
      <span>
        {err
          ? (screener.refreshError instanceof Error ? screener.refreshError.message : data?.message ?? (query.error instanceof Error ? query.error.message : "The screener request failed.")) + (data?.markets.length ? " Previously returned rows remain visible with their original dates." : "")
          : scanning
            ? `${processed.toLocaleString()} of ${total ? total.toLocaleString() : "…"} core markets processed. Markets not yet processed are marked queued, not counted as no reading.`
            : data ? `${eligible.toLocaleString()} of ${data.total.toLocaleString()} core markets have current, sufficient history for this rule set${data.total - eligible ? `; ${data.total - eligible} unavailable` : ""}. ${data.message ?? ""}` : "Requesting the official market list…"}
      </span>
      {scanning && <div className="scan-progress" aria-label={`Scan progress ${pct}%`}><span style={{ transform: `scaleX(${pct / 100})` }} /></div>}
      <small><Clock3 size={12} /> report as of {shortDate(data?.reportAsOf)}{lastChecked ? ` · last checked ${new Date(lastChecked).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" })} ET` : ""}</small>
      <CftcUpdateStatus />
    </div>
    {err && <button className="btn source-action" onClick={() => { if (data?.status === "error" || screener.refreshError) screener.refresh(); else void query.refetch(); }} data-testid="button-retry-scan">Retry</button>}
  </div>;
}

export function ScoreExplainer() {
  return <div className="scan-explain" data-testid="text-score-explainer">
    <Info size={15} />
    <div><b>Extremity score 0–100</b> measures how far past the rule a reading is: average cycle-rank extremity for confluence, Z-score size relative to its threshold for Z mode, and the mean of both for the AND gate. It is <b>not a confidence level or a probability of return</b>. Position / OI alerts without an extreme reading have no score. Only current-report markets with at least the configured lookback of weekly observations can show a reading; cycle ranks use the history available from CFTC.</div>
  </div>;
}
