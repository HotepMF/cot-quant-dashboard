import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, AlertTriangle, BarChart3, ChevronDown, Clock3, Info, LayoutGrid, ListOrdered, Moon, RefreshCw, Sun } from "lucide-react";
import { STORAGE_THEME, useSharedSettings } from "@/lib/settings-store";
import type { Settings } from "@/lib/settings-store";
import type { useScreener } from "@/hooks/use-screener";
import { shortDate } from "@/hooks/use-screener";
import { CftcUpdateStatus } from "@/components/cftc-update-status";
import "./scanner.css";

type Screener = ReturnType<typeof useScreener>;

const links = [
  { href: "/", label: "Market detail", short: "Detail", icon: BarChart3 },
  { href: "/sector-signals", label: "Sector signals", short: "Sectors", icon: LayoutGrid },
  { href: "/signal-watchlist", label: "Signal watchlist", short: "Watchlist", icon: ListOrdered },
];

function useTheme() {
  const [isDark, setIsDark] = useState(() => { try { return localStorage.getItem(STORAGE_THEME) !== "light"; } catch { return true; } });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    try { localStorage.setItem(STORAGE_THEME, isDark ? "dark" : "light"); } catch { /* storage unavailable */ }
  }, [isDark]);
  return [isDark, setIsDark] as const;
}

export function ScannerShell({ eyebrow, title, lede, screener, children }: { eyebrow: string; title: string; lede: string; screener: Screener; children: ReactNode }) {
  const [location] = useLocation();
  const [isDark, setIsDark] = useTheme();
  useEffect(() => { window.scrollTo(0, 0); document.title = `${title} · COT Quant`; }, [title]);
  return <div className="shell">
    <aside className="sidebar">
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "2px 8px 30px" }}>
        <div className="brand-mark"><Activity size={18} /></div>
        <div><div style={{ fontFamily: "var(--app-font-serif)", fontWeight: 800, fontSize: 14, letterSpacing: "-.04em" }}>COT / QUANT</div><div style={{ font: "9px var(--app-font-mono)", color: "rgba(244,241,232,.5)", marginTop: 3 }}>RESEARCH TERMINAL</div></div>
      </div>
      <div className="eyebrow" style={{ color: "rgba(244,241,232,.42)", padding: "0 12px 8px" }}>Workspace</div>
      <nav style={{ display: "grid", gap: 3 }}>
        {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? "active" : ""}`} data-testid={`nav-${label.toLowerCase().replace(/ /g, "-")}`}><Icon size={16} />{label}</Link>)}
      </nav>
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
      <SharedSettingsPanel />
      {children}
      <footer className="scan-foot">
        <span>COT Quant · all-market scan of the official CFTC Legacy report</span>
        <span>Setups are mechanical rule states, not recommendations.</span>
      </footer>
    </main>
    <nav className="mobile-nav print-hidden">
      {links.map(({ href, short, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? "active" : ""}`} aria-label={label} data-testid={`mobile-nav-${short.toLowerCase()}`}><Icon size={16} /><span>{short}</span></Link>)}
    </nav>
  </div>;
}

function ScanStatus({ screener }: { screener: Screener }) {
  const { data, query, scanning } = screener;
  const total = data?.total ?? 0, processed = data?.processed ?? 0;
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
            ? `${processed.toLocaleString()} of ${total ? total.toLocaleString() : "…"} markets processed. Markets not yet processed are marked queued, not counted as no-signal.`
            : data ? `${eligible.toLocaleString()} of ${data.total.toLocaleString()} markets have current, sufficient history for this rule set. ${data.total - eligible} unavailable. ${data.message ?? ""}` : "Requesting the official market list…"}
      </span>
      {scanning && <div className="scan-progress" aria-label={`Scan progress ${pct}%`}><span style={{ transform: `scaleX(${pct / 100})` }} /></div>}
      <small><Clock3 size={12} /> report as of {shortDate(data?.reportAsOf)}{lastChecked ? ` · last checked ${new Date(lastChecked).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" })} ET` : ""}</small>
      <CftcUpdateStatus />
    </div>
    {err && <button className="btn source-action" onClick={() => { if (data?.status === "error" || screener.refreshError) screener.refresh(); else void query.refetch(); }} data-testid="button-retry-scan">Retry</button>}
  </div>;
}

function SharedSettingsPanel() {
  const [settings, setSettings] = useSharedSettings();
  const [open, setOpen] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings(s => ({ ...s, [k]: v }));
  return <section className="card scan-settings print-hidden">
    <button className="scan-settings-head" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="button-toggle-settings">
      <span className="eyebrow">Shared rule set</span>
      <span className="scan-rule-chips">
        <b>{settings.signalMode}</b><i>{settings.participant}</i><i>{settings.lookback}w</i><i>Z {settings.zEnabled ? `≥ ${settings.zThreshold}σ` : "off"}</i><i>cycle {settings.confluenceThreshold}%</i>{settings.requireSmall && <i>small confirm</i>}
      </span>
      <ChevronDown size={15} className={open ? "rot" : ""} />
    </button>
    {open && <div className="scan-settings-body">
      <div className="field"><label htmlFor="s-mode">Signal mode</label><select id="s-mode" className="select" value={settings.signalMode} onChange={e => set("signalMode", e.target.value)} data-testid="select-scan-mode"><option>Z-Score Only</option><option>COT Confluence</option><option>Both (AND gate)</option></select></div>
      <div className="field"><label htmlFor="s-part">Participant</label><select id="s-part" className="select" value={settings.participant} onChange={e => set("participant", e.target.value)} data-testid="select-scan-participant"><option>Large Traders</option><option>Small Traders</option><option>Commercial Hedgers</option></select></div>
      <div className="field"><label htmlFor="s-lb">Lookback · weeks</label><input id="s-lb" className="input mono" type="number" min="3" max="500" value={settings.lookback} onChange={e => set("lookback", Math.max(3, Math.min(500, Number(e.target.value) || 3)))} data-testid="input-scan-lookback" /></div>
      <div className="field"><label htmlFor="s-z">Z threshold · σ</label><input id="s-z" className="input mono" type="number" min="0" max="20" step=".1" value={settings.zThreshold} onChange={e => set("zThreshold", Math.max(0, Math.min(20, Number(e.target.value) || 0)))} data-testid="input-scan-z" /></div>
      <div className="field"><label htmlFor="s-c">Confluence cycle · %</label><input id="s-c" className="input mono" type="number" min="50" max="95" step="5" value={settings.confluenceThreshold} onChange={e => set("confluenceThreshold", Math.max(50, Math.min(95, Number(e.target.value) || 50)))} data-testid="input-scan-confluence" /></div>
      <div className="field"><label htmlFor="s-oi">OI move threshold · %</label><input id="s-oi" className="input mono" type="number" min="1" max="100" value={settings.oiThreshold} onChange={e => set("oiThreshold", Math.max(1, Math.min(100, Number(e.target.value) || 1)))} data-testid="input-scan-oi" /></div>
      <div className="scan-switches">
        <label className="switch-row"><span>Z-score detection</span><input className="switch" type="checkbox" checked={settings.zEnabled} onChange={e => set("zEnabled", e.target.checked)} data-testid="toggle-scan-z" /></label>
        <label className="switch-row"><span>Require small trader confirmation</span><input className="switch" type="checkbox" checked={settings.requireSmall} onChange={e => set("requireSmall", e.target.checked)} data-testid="toggle-scan-small" /></label>
        <label className="switch-row"><span>Large position change flag</span><input className="switch" type="checkbox" checked={settings.changeEnabled} onChange={e => set("changeEnabled", e.target.checked)} data-testid="toggle-scan-change" /></label>
      </div>
      <div className="notice scan-settings-note">These are the same settings the market detail page uses. Changing them here re-runs the scan and updates the detail view.</div>
    </div>}
  </section>;
}

export function ScoreExplainer() {
  return <div className="scan-explain" data-testid="text-score-explainer">
    <Info size={15} />
    <div><b>Setup score 0–100</b> measures directional rule extremity: average cycle-rank extremity for confluence, Z-score size relative to its threshold for Z mode, and the mean of both for the AND gate. It is <b>not a confidence level or a probability of return</b>. Position / OI alerts without a directional setup have no setup score. Only current-report markets with at least the configured lookback of weekly observations can produce active signals; cycle ranks use the history available from CFTC.</div>
  </div>;
}
