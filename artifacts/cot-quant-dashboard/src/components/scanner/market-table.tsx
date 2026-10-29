import { useLocation } from "wouter";
import { ArrowDown, ArrowUp, ArrowUpRight } from "lucide-react";
import { prepareDetailMarket, useSharedSettings } from "@/lib/settings-store";
import { OscCell } from "@/components/oscillators";
import type { LiveReport } from "@/lib/settings-store";
import type { ScanRow } from "@/hooks/use-screener";
import { nfmt, nsigned, sectorLabel, shortDate, unavailableReason } from "@/hooks/use-screener";

export type SortKey = "setupScore" | "label" | "zScore" | "cycle" | "weeklyChange" | "oiChange" | "reportDate";
export const sortOptions: { key: SortKey; label: string }[] = [
  { key: "setupScore", label: "Extremity score" }, { key: "label", label: "Market name" }, { key: "zScore", label: "Z-score (absolute)" },
  { key: "cycle", label: "Cycle rank" }, { key: "weeklyChange", label: "Weekly change" }, { key: "oiChange", label: "OI change" }, { key: "reportDate", label: "Report date" },
];

export function sortRows(rows: ScanRow[], key: SortKey, desc: boolean) {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (key === "label") return a.label.localeCompare(b.label) * dir;
    if (key === "reportDate") return (a.reportDate ?? "").localeCompare(b.reportDate ?? "") * dir;
    const va = key === "zScore" ? (a.zScore == null ? null : Math.abs(a.zScore)) : a[key];
    const vb = key === "zScore" ? (b.zScore == null ? null : Math.abs(b.zScore)) : b[key];
    if (va == null && vb == null) return a.label.localeCompare(b.label);
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * dir || a.label.localeCompare(b.label);
  });
}

export function SignalBadge({ row }: { row: ScanRow }) {
  if (row.status === "loading") return <span className="badge neutral scan-pulse">Queued</span>;
  if (row.status !== "ready") return <span className="badge warn">{row.status === "insufficient" ? "Short history" : row.status === "stale" ? "Stale" : "Error"}</span>;
  if (row.signal === "bullish") return <span className="badge good"><ArrowUp size={11} />Extreme long</span>;
  if (row.signal === "bearish") return <span className="badge bad"><ArrowDown size={11} />Extreme short</span>;
  if (row.signal === "unavailable") return <span className="badge warn">Unavailable</span>;
  if (row.flagged) return <span className="badge warn" title="No buy or sell setup, but something notable changed this week: see the tag beside it">Watch</span>;
  return <span className="badge neutral">No reading</span>;
}

/** Who moved, as the model reads it: the selected group's short name. */
export const participantShort = (p: string) => p === "Large Traders" ? "Large specs" : p === "Small Traders" ? "Small specs" : "Commercials";

/**
 * Positive or negative read of a large one-week change, the way the model reads that group: it follows commercials
 * and fades large and small speculators. So commercials buying, or speculators selling, reads positive.
 */
export function moveRead(participant: string, change: number | null) {
  if (change == null || change === 0) return null;
  const buying = change > 0, positive = participant === "Commercial Hedgers" ? buying : !buying;
  return { buying, positive, text: `${participantShort(participant)} ${buying ? "buying" : "selling"}` };
}

/** A large one-week change in the selected group's net position, with its read. Describes the week; not tested on its own. */
export function MoveBadge({ change }: { change: number | null }) {
  const [settings] = useSharedSettings();
  const read = moveRead(settings.participant, change);
  if (!read) return <span className="badge neutral">Large move</span>;
  const why = settings.participant === "Commercial Hedgers" ? "The model follows commercials" : "The model leans against speculators";
  return <span className={`badge ${read.positive ? "good" : "bad"}`} title={`Large one-week change: ${read.text.toLowerCase()}. ${why}, so this reads ${read.positive ? "positive" : "negative"}. It describes the week and has not been tested on its own.`} data-testid="badge-large-move">
    {read.positive ? <ArrowUp size={11} /> : <ArrowDown size={11} />}{read.text}
  </span>;
}

export function ScoreMeter({ value, tone }: { value: number | null; tone: string }) {
  if (value == null) return <span className="mono subtle">—</span>;
  return <span className="score-meter" title="Rule extremity 0–100, not confidence">
    <span className="score-track"><span className={`score-fill ${tone}`} style={{ transform: `scaleX(${Math.max(0, Math.min(100, value)) / 100})` }} /></span>
    <b className="mono">{nfmt(value, 1)}</b>
  </span>;
}

type Props = {
  rows: ScanRow[]; report: LiveReport; lookback: number; showSector?: boolean; rank?: boolean;
  sortKey?: SortKey; desc?: boolean; onSort?: (k: SortKey) => void; testId: string;
};

export function MarketTable({ rows, report, lookback, showSector, rank, sortKey, desc, onSort, testId }: Props) {
  const [, navigate] = useLocation();
  const open = (name: string) => { prepareDetailMarket(report, name); navigate("/"); };
  const head = (key: SortKey, label: string) => onSort
    ? <th aria-sort={sortKey === key ? (desc ? "descending" : "ascending") : "none"}><button className={`th-sort ${sortKey === key ? "on" : ""}`} onClick={() => onSort(key)} data-testid={`sort-${key}`}>{label}{sortKey === key && (desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}</button></th>
    : <th>{label}</th>;
  return <div className="table-wrap scan-table-wrap">
    <table className="scan-table" data-testid={testId}>
      <thead><tr>
        {rank && <th>#</th>}
        {head("label", "Market")}
        {showSector && <th>Sector</th>}
        <th>State</th>
        {head("setupScore", "Extremity")}
        {head("zScore", "Z-score")}
        {head("cycle", "Cycle")}
        <th>CH / LT / ST cycle</th>
        <th title="Ultimate Oscillator · Williams %R, daily, from the last settled close">UO · %R</th>
        {head("weeklyChange", "Wk change")}
        {head("oiChange", "OI move")}
        {head("reportDate", "Report")}
        <th aria-label="Open" />
      </tr></thead>
      <tbody>
        {rows.map((r, i) => {
          const tone = r.signal === "bullish" ? "bull" : r.signal === "bearish" ? "bear" : "flat";
          const reason = r.message ?? (r.status !== "ready" ? unavailableReason(r, lookback) : "");
          return <tr key={r.name} className={`scan-row ${r.active ? `active ${tone}` : ""} ${r.status !== "ready" ? "dim" : ""}`} onClick={() => open(r.name)} data-testid={`row-market-${r.code}`}>
            {rank && <td className="mono subtle">{String(i + 1).padStart(2, "0")}</td>}
            <td className="scan-market">
              <button className="market-link" onClick={e => { e.stopPropagation(); open(r.name); }} title={`Open ${r.name} in Market overview`} data-testid={`button-open-${r.code}`}>{r.label}</button>
              <span className="mono subtle">{r.exchange || "—"} · {r.code}</span>
              {reason && <span className="scan-reason">{reason}</span>}
            </td>
            {showSector && <td className="subtle">{sectorLabel(r.sector)}</td>}
            <td><SignalBadge row={r} />{r.largeMove && r.status === "ready" && <span style={{ marginLeft: 5 }}><MoveBadge change={r.weeklyChange} /></span>}{r.oiAlert && <span className="badge warn" style={{ marginLeft: 5 }} title="Absolute open-interest change met the configured threshold">OI alert</span>}</td>
            <td><ScoreMeter value={r.active ? r.setupScore : null} tone={tone} /></td>
            <td className="mono">{r.zScore == null ? "—" : `${nsigned(r.zScore, 2)}σ`}</td>
            <td className="mono">{r.cycle == null ? "—" : `${nfmt(r.cycle, 0)}%`}</td>
            <td className="mono subtle">{nfmt(r.commercialCycle, 0)} / {nfmt(r.largeCycle, 0)} / {nfmt(r.smallCycle, 0)}</td>
            <td className="mono"><OscCell code={r.code} /></td>
            <td className={`mono ${r.weeklyChange == null || r.weeklyChange === 0 ? "change-flat" : r.weeklyChange > 0 ? "change-up" : "change-down"}`}>{nsigned(r.weeklyChange)}</td>
            <td className={`mono ${r.oiChange == null || r.oiChange === 0 ? "change-flat" : r.oiChange > 0 ? "change-up" : "change-down"}`}>{r.oiChange == null ? "—" : `${nsigned(r.oiChange, 1)}%`}</td>
            <td className="mono subtle">{shortDate(r.reportDate)}</td>
            <td><ArrowUpRight size={14} className="subtle" /></td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return <div className="scan-skeleton" aria-label="Loading scan rows">{Array.from({ length: rows }, (_, i) => <span key={i} style={{ animationDelay: `${i * 80}ms` }} />)}</div>;
}
