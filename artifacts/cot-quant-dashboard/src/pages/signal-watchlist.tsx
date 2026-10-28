import { LiveRecord } from "@/components/oscillators";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, Search, X } from "lucide-react";
import { CORE_GROUPS, coreMarketByCode } from "@workspace/cot-engine";
import type { CoreGroup } from "@workspace/cot-engine";
import { filterMarketCatalog } from "@/lib/market-catalog";
import { useScreener } from "@/hooks/use-screener";
import { MarketTable, TableSkeleton, sortOptions, sortRows } from "@/components/scanner/market-table";
import type { SortKey } from "@/components/scanner/market-table";
import { ScannerShell, ScoreExplainer } from "@/components/scanner/scanner-shell";

type StatusFilter = "active" | "all" | "ready" | "unavailable" | "loading";
type Direction = "all" | "bullish" | "bearish" | "none";
type SignalType = "all" | "directional" | "position" | "oi";

function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return <div className="wl-chipset" role="group" aria-label={label}>
    {options.map(o => <button key={o.id} type="button" className="ms-chip" aria-pressed={value === o.id} onClick={() => onChange(o.id)} data-testid={`chip-${label.toLowerCase().replace(/\s+/g, "-")}-${o.id}`}>{o.label}</button>)}
  </div>;
}

export function SignalWatchlistPage() {
  const s = useScreener();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<CoreGroup | "all">("all");
  const [direction, setDirection] = useState<Direction>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [signalType, setSignalType] = useState<SignalType>("all");
  const [sortKey, setSortKey] = useState<SortKey>("setupScore");
  const [desc, setDesc] = useState(true);
  // The scanners cover the core watchlist only; the rest of the report stays in the backend and advanced search.
  const rows = useMemo(() => s.rows.filter(r => coreMarketByCode.has(r.code)), [s.rows]);
  const onSort = (k: SortKey) => { if (k === sortKey) setDesc(d => !d); else { setSortKey(k); setDesc(k !== "label"); } };

  const filtered = useMemo(() => {
    const byName = new Map(rows.map(r => [r.name, r]));
    const matched = filterMarketCatalog(rows, q, "all").map(c => byName.get(c.name)!);
    return sortRows(matched.filter(r => {
      if (group !== "all" && coreMarketByCode.get(r.code)?.group !== group) return false;
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
  }, [rows, q, group, direction, status, signalType, sortKey, desc]);
  const counts = useMemo(() => ({
    active: rows.filter(r => r.flagged).length,
    pending: rows.filter(r => r.status === "loading").length,
    unavailable: rows.filter(r => r.status !== "ready" && r.status !== "loading").length,
  }), [rows]);
  const reset = () => { setQ(""); setGroup("all"); setDirection("all"); setSignalType("all"); setStatus("all"); };
  const statusOptions: { id: StatusFilter; label: string }[] = [
    { id: "active", label: `Active ${counts.active}` }, { id: "all", label: `All ${rows.length}` },
    ...(counts.unavailable ? [{ id: "unavailable" as const, label: `Unavailable ${counts.unavailable}` }] : []),
    ...(counts.pending ? [{ id: "loading" as const, label: `Queued ${counts.pending}` }] : []),
  ];

  return <ScannerShell screener={s} eyebrow="Core markets / Watchlist" title="Watchlist" lede="Directional setups and positioning / open-interest alerts across the core watchlist markets. Directional setups rank by rule extremity.">
    <ScoreExplainer />
    <div className="card wl-filters print-hidden">
      <div className="wl-row">
        <label className="ms-search wl-search"><Search size={14} aria-hidden /><input placeholder="Search symbol or market (es, gold, 10 year)…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search markets" data-testid="input-search" />
          {q && <button type="button" className="ms-clear" onClick={() => setQ("")} aria-label="Clear search"><X size={13} /></button>}</label>
        <select className="select wl-select" value={group} onChange={e => setGroup(e.target.value as CoreGroup | "all")} aria-label="Group" data-testid="select-sector"><option value="all">All groups</option>{CORE_GROUPS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        <div className="sort-pair"><select className="select wl-select" value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} aria-label="Sort by" data-testid="select-sort">{sortOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select><button className="icon-btn" onClick={() => setDesc(d => !d)} aria-label={desc ? "Descending" : "Ascending"} title={desc ? "Descending" : "Ascending"} data-testid="button-sort-direction">{desc ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}</button></div>
      </div>
      <div className="wl-chips">
        <Chips<StatusFilter> label="Status" value={status} onChange={setStatus} options={statusOptions} />
        <span className="wl-sep" aria-hidden />
        <Chips<Direction> label="Direction" value={direction} onChange={setDirection} options={[{ id: "all", label: "Any" }, { id: "bullish", label: "Extreme long" }, { id: "bearish", label: "Extreme short" }, { id: "none", label: "No reading" }]} />
        <span className="wl-sep" aria-hidden />
        <Chips<SignalType> label="Type" value={signalType} onChange={setSignalType} options={[{ id: "all", label: "All" }, { id: "directional", label: "Extremes" }, { id: "position", label: "Position moves" }, { id: "oi", label: "OI alerts" }]} />
      </div>
    </div>
    <div className="scan-bar">
      <div className="eyebrow" data-testid="text-result-count">{filtered.length} of {rows.length} markets{s.scanning ? " · scan in progress" : ""}</div>
      <Link href="/sector-signals" className="btn" data-testid="link-to-sectors"><LayoutGrid size={14} />Sector breakdown</Link>
    </div>
    <LiveRecord />
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
