import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BREAK_HISTORY, breakTally } from "@workspace/cot-engine";
import type { SectorBreakCase, SectorBreakLog } from "@workspace/cot-engine";

async function doc<T>(path: string): Promise<T | null> {
  const r = await fetch(path);
  if (r.status === 503) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json() as T;
}
export const useSectorBreaks = () => useQuery({ queryKey: ["sector-breaks"], queryFn: () => doc<SectorBreakLog>("/api/sector-breaks"), staleTime: 15 * 60_000, refetchInterval: 30 * 60_000 });

const et = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
const wk = (v: number | null | undefined) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
const status = (c: SectorBreakCase) => c.status === "broke" ? `${c.broken.length} of ${c.others} ${c.sector.toLowerCase()} broke ${c.dir > 0 ? "up" : "down"} · ${et(c.brokeAt!)}`
  : c.status === "watching" ? `Watching: needs ${c.need} of ${c.others}` : "No sector break that week";

/** The live log of sector breaks in the week after each 8-week reading, with the intraday history it is checked against. */
export function SectorBreakRecord() {
  const q = useSectorBreaks();
  const cases = q.data?.cases ?? [];
  const t = breakTally(cases);
  const recent = [...cases].reverse().slice(0, 12);
  return <section className="card section" data-testid="sector-break-record">
    <div className="card-head"><div><h2 className="panel-title">Sector breaks after a reading: the live log</h2>
      <div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>In the week after each 8-week reading, when half the rest of its sector breaks last week's range the reading's way, and how the reading's market moved next · <Link href="/how-it-works#sector-breaks">method</Link></div></div></div>
    <div className="card-body">
      <div className="sx-scroll"><table className="sx-table">
        <thead><tr><th /><th className="num">Cases</th><th className="num">1 hour</th><th className="num">2 hours</th><th className="num">4 hours</th><th className="num">Rest of session</th></tr></thead>
        <tbody>
          <tr><td>History {BREAK_HISTORY.period} (11 markets with 15-minute data)</td><td className="num">{BREAK_HISTORY.cases}</td><td className="num">{wk(BREAK_HISTORY.h1)}</td><td className="num">{wk(BREAK_HISTORY.h2)}</td><td className="num">{wk(BREAK_HISTORY.h4)}</td>
            <td className="num">{wk(BREAK_HISTORY.session)} <span className="subtle">({BREAK_HISTORY.sessionPositive}% up)</span></td></tr>
          <tr data-testid="row-break-live"><td><b>Live</b>, all 42 sector markets{t.watching ? ` (+${t.watching} watching)` : ""}</td><td className="num">{t.broke}</td><td className="num">{wk(t.h1.mean)}</td><td className="num">{wk(t.h2.mean)}</td><td className="num">{wk(t.h4.mean)}</td>
            <td className="num">{wk(t.session.mean)}{t.session.n ? <span className="subtle"> ({Math.round(t.session.positive / t.session.n * 100)}% up)</span> : null}</td></tr>
        </tbody>
      </table></div>
      {recent.length ? <div className="sx-scroll" style={{ marginTop: 12 }}><table className="sx-table" data-testid="table-sector-breaks">
        <thead><tr><th>Market</th><th>Reading</th><th>Sector</th><th className="num">1h</th><th className="num">2h</th><th className="num">4h</th><th className="num">Session</th></tr></thead>
        <tbody>{recent.map(c => <tr key={c.id}>
          <td><b>{c.symbol}</b> <span className="subtle">{c.reportDate.slice(5)}</span></td>
          <td className={c.dir > 0 ? "change-up" : "change-down"}>{c.dir > 0 ? "Extreme long" : "Extreme short"}</td>
          <td title={c.broken.length ? `Broken: ${c.broken.join(", ")}${c.ownBreakAt ? ` · ${c.symbol} itself broke ${et(c.ownBreakAt)}` : ""}` : undefined}>{status(c)}</td>
          <td className="num">{wk(c.outcome.h1)}</td><td className="num">{wk(c.outcome.h2)}</td><td className="num">{wk(c.outcome.h4)}</td><td className="num">{wk(c.outcome.session)}</td>
        </tr>)}</tbody>
      </table></div> : <div className="subtle" style={{ fontSize: 12, marginTop: 10 }}>{q.isLoading ? "Loading…" : "No 8-week reading has been on since the log started. A case opens the Friday a reading is released."}</div>}
      <div className="chart-foot">Moves are in the reading's direction, in units of a normal day's move for that market, from the 15-minute close when the sector broke. The history is 12 cases and was not statistically significant, so the live rows are the test; every case is logged automatically.</div>
    </div>
  </section>;
}

/** Market detail: this market's latest sector-break case, if a reading is on. */
export function SectorBreakLine({ code }: { code?: string }) {
  const q = useSectorBreaks();
  const c = code ? [...(q.data?.cases ?? [])].reverse().find(x => x.code === code) : undefined;
  if (!c) return null;
  return <div className="statline"><span className="subtle">Sector break · {c.reportDate.slice(5)} reading</span>
    <b data-testid="value-sector-break" className={c.status === "broke" ? (c.dir > 0 ? "change-up" : "change-down") : ""}>{status(c)}</b></div>;
}
