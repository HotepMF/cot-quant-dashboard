import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ListOrdered } from "lucide-react";
import { CORE_GROUPS, coreMarketByCode } from "@workspace/cot-engine";
import { MARKET_SECTORS } from "@/lib/market-catalog";
import { useMarketScope } from "@/lib/settings-store";
import { MarketScopeToggle } from "@/components/market-scope-toggle";
import { useScreener } from "@/hooks/use-screener";
import { MarketTable, TableSkeleton, sortRows } from "@/components/scanner/market-table";
import { ScannerShell, ScoreExplainer } from "@/components/scanner/scanner-shell";

export function SectorSignalsPage() {
  const s = useScreener();
  const [activeOnly, setActiveOnly] = useState(false);
  const [scope] = useMarketScope();
  const coreRows = useMemo(() => s.rows.filter(r => coreMarketByCode.has(r.code)), [s.rows]);
  const groups = useMemo(() => (scope === "core"
    ? CORE_GROUPS.map(g => ({ id: g.id as string, label: g.label, all: coreRows.filter(r => coreMarketByCode.get(r.code)!.group === g.id) }))
    : MARKET_SECTORS.map(sec => ({ id: sec.id as string, label: sec.label, all: s.rows.filter(r => r.sector === sec.id) }))
  ).map(sec => {
    const all = sec.all;
    const active = sortRows(all.filter(r => r.flagged), "setupScore", true);
    const rest = sortRows(all.filter(r => !r.flagged), "label", false);
    return {
      ...sec, all, ordered: [...active, ...rest], active,
      bull: active.filter(r => r.signal === "bullish").length,
      bear: active.filter(r => r.signal === "bearish").length,
      activity: active.filter(r => !r.active).length,
      ready: all.filter(r => r.status === "ready").length,
      pending: all.filter(r => r.status === "loading").length,
      unavailable: all.filter(r => r.status !== "ready" && r.status !== "loading").length,
    };
  }).filter(g => g.all.length), [s.rows, coreRows, scope]);
  const totals = groups.reduce((t, g) => ({ bull: t.bull + g.bull, bear: t.bear + g.bear, ready: t.ready + g.ready, all: t.all + g.all.length }), { bull: 0, bear: 0, ready: 0, all: 0 });
  const jump = (id: string) => document.getElementById(`sector-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return <ScannerShell screener={s} eyebrow="All-market scan / Sector signals" title="Sector signals" lede={scope === "core" ? "The core watchlist markets, grouped like the watchlist, evaluated with the same rule set as the detail view." : "Every market in the official report, grouped by sector, evaluated with the same rule set as the detail view."}>
    <div className="scan-bar print-hidden"><MarketScopeToggle coreCount={coreRows.length} allCount={s.rows.length} /></div>
    <div className="scan-tally fade-in">
      <div><span className="eyebrow">Bullish setups</span><b className="mono change-up" data-testid="count-bullish">{totals.bull}</b></div>
      <div><span className="eyebrow">Bearish setups</span><b className="mono change-down" data-testid="count-bearish">{totals.bear}</b></div>
      <div><span className="eyebrow">Evaluated</span><b className="mono" data-testid="count-coverage">{totals.ready}<small>/{totals.all || "—"}</small></b></div>
      <Link href="/signal-watchlist" className="btn tally-link" data-testid="link-to-watchlist"><ListOrdered size={14} />Ranked watchlist</Link>
    </div>
    <ScoreExplainer />
    {!s.data && s.query.isLoading ? <div className="sector-grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="card sector-tile skel" />)}</div> :
    <div className="sector-grid" data-testid="grid-sectors">
      {groups.map(g => {
        const cov = g.all.length ? g.ready / g.all.length : 0;
        return <button key={g.id} className="card sector-tile" onClick={() => jump(g.id)} data-testid={`tile-sector-${g.id}`}>
          <span className="sector-name">{g.label}</span>
          <span className="sector-counts"><b className="change-up mono">{g.bull}</b><i>bull</i><b className="change-down mono">{g.bear}</b><i>bear</i></span>
          <span className="sector-cov"><span style={{ transform: `scaleX(${cov})` }} /></span>
          <span className="mono subtle sector-meta">{g.ready}/{g.all.length} evaluated{g.activity ? ` · ${g.activity} activity alerts` : ""}{g.pending ? ` · ${g.pending} queued` : ""}{g.unavailable ? ` · ${g.unavailable} unavailable` : ""}</span>
        </button>;
      })}
    </div>}
    <div className="scan-bar print-hidden">
      <div className="eyebrow">Per-sector tables · directional setups first, then activity alerts</div>
      <label className="switch-row compact"><span>Active signals only</span><input className="switch" type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} data-testid="toggle-active-only" /></label>
    </div>
    {!s.data && s.query.isLoading && <div className="card card-body"><TableSkeleton /></div>}
    {groups.map(g => {
      const shown = activeOnly ? g.active : g.ordered;
      return <section key={g.id} id={`sector-${g.id}`} className="card sector-section" data-testid={`section-sector-${g.id}`}>
        <div className="card-head"><div><h2 className="panel-title">{g.label}</h2><div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>{g.all.length} markets · {g.bull} bullish · {g.bear} bearish · {g.ready} evaluated</div></div></div>
        <div className="card-body" style={{ paddingTop: 10 }}>
          {shown.length ? <MarketTable rows={shown} report={s.report} lookback={s.lookback} testId={`table-sector-${g.id}`} /> :
            <div className="scan-empty">{g.pending ? `Scan still running: ${g.pending} market(s) in this sector are queued. Signals may still appear.` : "No active signals in this sector under the current rule set."}</div>}
        </div>
      </section>;
    })}
    {s.data && !groups.length && <div className="card scan-empty big">{s.scanning ? "Scan is starting. Markets will appear as the report list is read." : "The report returned no markets. Try a rescan."}</div>}
  </ScannerShell>;
}
