import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, Search } from "lucide-react";
import { coreMarketByCode } from "@workspace/cot-engine";
import { MARKET_SECTORS, filterMarketCatalog } from "@/lib/market-catalog";
import { useMarketScope } from "@/lib/settings-store";
import { MarketScopeToggle } from "@/components/market-scope-toggle";
import type { MarketSector } from "@/lib/market-catalog";
import { useScreener } from "@/hooks/use-screener";
import { MarketTable, TableSkeleton, sortOptions, sortRows } from "@/components/scanner/market-table";
import type { SortKey } from "@/components/scanner/market-table";
import { ScannerShell, ScoreExplainer } from "@/components/scanner/scanner-shell";

type StatusFilter = "active" | "all" | "ready" | "unavailable" | "loading";
type Direction = "all" | "bullish" | "bearish" | "none";

export function SignalWatchlistPage() {
  const s = useScreener();
  const [q, setQ] = useState("");
  const [sector, setSector] = useState<MarketSector | "all">("all");
  const [direction, setDirection] = useState<Direction>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [signalType, setSignalType] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("setupScore");
  const [desc, setDesc] = useState(true);
  const [scope] = useMarketScope();
  const coreRows = useMemo(() => s.rows.filter(r => coreMarketByCode.has(r.code)), [s.rows]);
  const rows = scope === "core" ? coreRows : s.rows;
  const onSort = (k: SortKey) => { if (k === sortKey) setDesc(d => !d); else { setSortKey(k); setDesc(k !== "label"); } };

  const filtered = useMemo(() => {
    const byName = new Map(rows.map(r => [r.name, r]));
    const matched = filterMarketCatalog(rows, q, sector).map(c => byName.get(c.name)!);
    return sortRows(matched.filter(r => {
      if (status === "active" && !r.flagged) return false;
      if (signalType === "directional" && !r.active) return false;
      if (signalType === "position" && !(r.status === "ready" && r.largeMove)) return false;
      if (signalType === "oi" && !r.oiAlert) return false;
      if (status === "ready" && r.status !== "ready") return false;
      if (status === "loading" && r.status !== "loading") return false;
      if (status === "unavailable" && (r.status === "ready" || r.status === "loading")) return false;
      if (direction === "bullish" && r.signal !== "bullish") return false;
      if (direction === "bearish" && r.signal !== "bearish") return false;
      if (direction === "none" && r.signal !== "none") return false;
      return true;
    }), sortKey, desc);
  }, [rows, q, sector, direction, status, signalType, sortKey, desc]);
  const counts = useMemo(() => ({
    active: rows.filter(r => r.flagged).length,
    pending: rows.filter(r => r.status === "loading").length,
    unavailable: rows.filter(r => r.status !== "ready" && r.status !== "loading").length,
  }), [rows]);
  const reset = () => { setQ(""); setSector("all"); setDirection("all"); setSignalType("all"); setStatus("all"); };

  return <ScannerShell screener={s} eyebrow="All-market scan / Signal watchlist" title="Signal watchlist" lede="Directional setups and positioning / open-interest alerts across the whole report. Directional setups rank by rule extremity; filter by signal type or widen the view to every market.">
    <ScoreExplainer />
    <div className="card scan-filters print-hidden">
      <label className="scan-search"><Search size={15} /><input className="input" placeholder="Search market, code, alias (es, gold, 10 year)…" value={q} onChange={e => setQ(e.target.value)} data-testid="input-search" /></label>
      <div className="field"><span className="eyebrow">Status</span><select className="select" value={status} onChange={e => setStatus(e.target.value as StatusFilter)} data-testid="select-status"><option value="active">Active signals ({counts.active})</option><option value="all">All markets ({rows.length})</option><option value="ready">Evaluated</option><option value="unavailable">Unavailable ({counts.unavailable})</option><option value="loading">Queued ({counts.pending})</option></select></div>
      <div className="field"><span className="eyebrow">Signal type</span><select className="select" value={signalType} onChange={e => setSignalType(e.target.value)} data-testid="select-signal-type"><option value="all">All signals</option><option value="directional">Directional setups</option><option value="position">Large position moves</option><option value="oi">Open-interest alerts</option></select></div>
      <div className="field"><span className="eyebrow">Direction</span><select className="select" value={direction} onChange={e => setDirection(e.target.value as Direction)} data-testid="select-direction"><option value="all">Any</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option><option value="none">No setup</option></select></div>
      <div className="field"><span className="eyebrow">Sector</span><select className="select" value={sector} onChange={e => setSector(e.target.value as MarketSector | "all")} data-testid="select-sector"><option value="all">All sectors</option>{MARKET_SECTORS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
      <div className="field"><span className="eyebrow">Sort by</span><div className="sort-pair"><select className="select" value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} data-testid="select-sort">{sortOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select><button className="icon-btn" onClick={() => setDesc(d => !d)} aria-label={desc ? "Descending" : "Ascending"} title={desc ? "Descending" : "Ascending"} data-testid="button-sort-direction">{desc ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}</button></div></div>
    </div>
    <div className="scan-bar">
      <div className="eyebrow" data-testid="text-result-count">{filtered.length} of {rows.length} markets{s.scanning ? " · scan in progress" : ""}</div>
      <MarketScopeToggle coreCount={coreRows.length} allCount={s.rows.length} />
      <Link href="/sector-signals" className="btn" data-testid="link-to-sectors"><LayoutGrid size={14} />Sector breakdown</Link>
    </div>
    <section className="card">
      <div className="card-body" style={{ paddingTop: 10 }}>
        {!s.data && s.query.isLoading ? <TableSkeleton rows={10} /> :
          filtered.length ? <MarketTable rows={filtered} report={s.report} lookback={s.lookback} showSector rank sortKey={sortKey} desc={desc} onSort={onSort} testId="table-watchlist" /> :
          <div className="scan-empty big">
            {s.scanning
              ? <><b>Scan still running</b><span>{s.data?.processed ?? 0} of {s.data?.total || "…"} markets processed. Matching setups may still appear; this is not a no-signal result.</span></>
              : s.query.isError && !s.rows.length
                ? <><b>Scan unavailable</b><span>The screener could not be loaded. Use Retry above.</span></>
                 : <><b>No markets match</b><span>{status === "active" ? "No active signals under the current rule set and filters." : "Nothing matches these filters."}</span><button className="btn" onClick={reset} data-testid="button-reset-filters">Show all markets</button></>}
          </div>}
      </div>
    </section>
  </ScannerShell>;
}
