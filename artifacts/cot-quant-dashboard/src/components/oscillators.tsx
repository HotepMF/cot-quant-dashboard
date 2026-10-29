import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { COT8_RECORD, tally } from "@workspace/cot-engine";
import type { CaseLog, OscillatorSnapshot } from "@workspace/cot-engine";

async function doc<T>(path: string): Promise<T | null> {
  const r = await fetch(path);
  if (r.status === 503) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json() as T;
}
export const useOscillators = () => useQuery({ queryKey: ["oscillators"], queryFn: () => doc<OscillatorSnapshot>("/api/oscillators"), staleTime: 15 * 60_000, refetchInterval: 30 * 60_000 });
export const useCaseLog = () => useQuery({ queryKey: ["case-log"], queryFn: () => doc<CaseLog>("/api/case-log"), staleTime: 15 * 60_000, refetchInterval: 30 * 60_000 });

/**
 * Ultimate Oscillator and %R cell for scanner rows (every market, last settled close); highlighted when the UO is on
 * the pullback side of an active 8-week reading.
 */
export function OscCell({ code }: { code: string }) {
  const q = useOscillators();
  const m = q.data?.markets[code];
  if (!m || m.uo == null) return <span className="subtle">—</span>;
  const pull = m.uoPullback === true;
  return <span className={pull ? (m.dir > 0 ? "change-up" : "change-down") : ""} data-testid="value-uo-cell"
    title={`Ultimate Oscillator ${m.uo} and Williams %R ${m.wr ?? "—"}, daily, ${m.date} settlement.${pull ? " On the pullback side of the 8-week reading: in past cases like this the next week went the commercials' way 75% of the time (28 cases)." : ""}`}>
    {Math.round(m.uo)} <span className="subtle">· {m.wr == null ? "—" : Math.round(m.wr)}</span>{pull ? " · pullback" : ""}
  </span>;
}

/** The 8-week reading's record: the 2002-2026 history and the live log since the switch. */
export function LiveRecord() {
  const q = useCaseLog();
  const t = q.data ? tally(q.data.cases) : null;
  const tp = q.data ? tally(q.data.cases.filter(c => c.pullback)) : null;
  const pct = (a: number, b: number) => b ? `${Math.round(a / b * 100)}%` : "—";
  return <section className="card section" data-testid="live-record">
    <div className="card-head"><div><h2 className="panel-title">8-week reading: the record</h2>
      <div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>How the week after each reading went, in the commercials' direction · <Link href="/how-it-works/eight-week">method</Link></div></div></div>
    <div className="card-body">
      <div className="sx-scroll"><table className="sx-table">
        <thead><tr><th /><th className="num">Cases</th><th className="num">Next week went their way</th><th className="num">Average move</th></tr></thead>
        <tbody>
          <tr><td>History {COT8_RECORD.period}, all readings</td><td className="num">{COT8_RECORD.all.cases}</td><td className="num">{COT8_RECORD.all.wentItsWay}% <span className="subtle">(normal 50%)</span></td><td className="num">+{COT8_RECORD.all.move.toFixed(2)} wk</td></tr>
          <tr><td>History, with the Ultimate Oscillator on the pullback side</td><td className="num">{COT8_RECORD.pullback.cases}</td><td className="num">{COT8_RECORD.pullback.wentItsWay}%</td><td className="num">+{COT8_RECORD.pullback.move.toFixed(2)} wk</td></tr>
          <tr data-testid="row-live-all"><td><b>Live</b> since the {new Date(`${q.data?.startedReport ?? "2026-10-20"}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} report, all readings</td><td className="num">{t ? `${t.done}${t.cases > t.done ? ` (+${t.cases - t.done} open)` : ""}` : "0"}</td><td className="num">{t && t.done ? pct(t.wentItsWay, t.done) : "—"}</td><td className="num">{t?.avgMoveVol != null ? `${t.avgMoveVol >= 0 ? "+" : ""}${t.avgMoveVol.toFixed(2)} wk` : "—"}</td></tr>
          <tr><td><b>Live</b>, pullback side</td><td className="num">{tp ? `${tp.done}${tp.cases > tp.done ? ` (+${tp.cases - tp.done} open)` : ""}` : "0"}</td><td className="num">{tp && tp.done ? pct(tp.wentItsWay, tp.done) : "—"}</td><td className="num">{tp?.avgMoveVol != null ? `${tp.avgMoveVol >= 0 ? "+" : ""}${tp.avgMoveVol.toFixed(2)} wk` : "—"}</td></tr>
        </tbody>
      </table></div>
      <div className="chart-foot">"wk" = a normal week's move for that market. The week runs from the release Friday close to the next. The history has a small sample (28 pullback cases), so the live rows are what will confirm it or not; every case is logged automatically.</div>
    </div>
  </section>;
}

/** Market detail: today's oscillators and, when the 8-week reading is on, which side they sit on. */
export function OscReadout({ code }: { code?: string }) {
  const q = useOscillators();
  const m = code ? q.data?.markets[code] : undefined;
  if (!m) return null;
  const side = m.dir === 0 ? "No 8-week reading this report" : m.uoPullback ? `Pullback side · past cases: ${COT8_RECORD.pullback.wentItsWay}% went the commercials' way (${COT8_RECORD.pullback.cases})`
    : `Not on the pullback side · all readings: ${COT8_RECORD.all.wentItsWay}% (${COT8_RECORD.all.cases})`;
  return <>
    <div className="statline"><span className="subtle">Ultimate Oscillator · %R (daily, {m.date.slice(5)} settlement)</span><b className="mono" data-testid="value-uo">{m.uo ?? "—"} · {m.wr ?? "—"}</b></div>
    <div className="statline"><span className="subtle">With the 8-week reading</span><b data-testid="value-uo-side" className={m.uoPullback ? (m.dir > 0 ? "change-up" : "change-down") : ""}>{side}</b></div>
  </>;
}
