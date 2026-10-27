import { useQuery } from "@tanstack/react-query";
import { DEMO_MARKETS, DEMO_TARGET_SIGMA } from "@workspace/cot-engine";
import type { DemoOrder, DemoPayload, DemoPosition, DemoTrade } from "@workspace/cot-engine";

const byCode = new Map(DEMO_MARKETS.map(m => [m.code, m]));
const usd = (v: number) => `${v < 0 ? "−" : v > 0 ? "+" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
const px = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v < 0.1 ? 6 : v < 10 ? 4 : 2, minimumFractionDigits: v < 0.1 ? 6 : v < 10 ? 4 : 2 });
const wk = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const side = (d: number) => d > 0 ? "Long" : "Short";

function Orders({ rows }: { rows: [string, DemoOrder][] }) {
  return <div className="sx-scroll"><table className="sx-table da-table">
    <thead><tr><th>Mkt</th><th>Side</th><th>Setup</th><th className="num">Order</th><th className="num">Stop</th><th className="num" style={{ textTransform: "none" }}>TARGET ({DEMO_TARGET_SIGMA}σ)</th><th className="num">Risk / contract</th></tr></thead>
    <tbody>{rows.map(([code, o]) => {
      const m = byCode.get(code)!;
      return <tr key={code} data-testid={`row-demo-order-${m.symbol}`}>
        <td className="sx-tk">{m.symbol}</td><td>{side(o.dir)}</td><td>{o.pattern}</td>
        <td className="num">{o.dir > 0 ? "buy" : "sell"} stop {px(o.trigger)}</td><td className="num">{px(o.stop)}</td><td className="num">{px(o.target)}</td>
        <td className="num">${Math.round(Math.abs(o.stop - o.trigger) * m.pointValue).toLocaleString()}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

function Positions({ rows }: { rows: [string, DemoPosition][] }) {
  return <div className="sx-scroll"><table className="sx-table da-table">
    <thead><tr><th>Mkt</th><th>Side</th><th>Since</th><th className="num">Entry</th><th className="num">Stop now</th><th className="num">Target</th><th className="num">Locked in</th></tr></thead>
    <tbody>{rows.map(([code, p]) => {
      const m = byCode.get(code)!;
      return <tr key={code} data-testid={`row-demo-position-${m.symbol}`}>
        <td className="sx-tk">{m.symbol}</td><td>{side(p.dir)}</td><td>{wk(p.entryWeek)}</td>
        <td className="num">{px(p.entry)}</td><td className="num">{px(p.stop)}</td><td className="num">{px(p.target)}</td>
        <td className="num">{usd((p.stop - p.entry) * p.dir * m.pointValue)}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

function Trades({ rows }: { rows: DemoTrade[] }) {
  return <div className="sx-scroll"><table className="sx-table da-table">
    <thead><tr><th>Mkt</th><th>Side</th><th>Setup</th><th>In</th><th>Out</th><th className="num">Entry</th><th className="num">Exit</th><th>How</th><th className="num">R</th><th className="num">P&amp;L</th></tr></thead>
    <tbody>{rows.map((t, i) => <tr key={`${t.code}-${t.entryWeek}-${i}`}>
      <td className="sx-tk">{t.symbol}</td><td>{side(t.dir)}</td><td>{t.pattern}</td><td>{wk(t.entryWeek)}</td><td>{wk(t.exitWeek)}</td>
      <td className="num">{px(t.entry)}</td><td className="num">{px(t.exit)}</td><td>{t.how}</td>
      <td className={`num ${t.r > 0 ? "da-up" : "da-down"}`}>{t.r > 0 ? "+" : ""}{t.r.toFixed(2)}</td><td className={`num ${t.pnl > 0 ? "da-up" : "da-down"}`}>{usd(t.pnl)}</td>
    </tr>)}</tbody>
  </table></div>;
}

/** Public forward test of the 16-week COT filter (the site default until Oct 27, 2026; frozen) traded with weekly Strat entries; one contract per trade. */
export function DemoAccount() {
  const query = useQuery({
    queryKey: ["demo-account"],
    queryFn: async () => {
      const r = await fetch("/api/demo-account");
      if (r.status === 503) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json() as DemoPayload;
    },
    refetchInterval: 15 * 60_000,
  });
  const d = query.data;
  const orders = d ? Object.entries(d.markets).filter(([, s]) => s.order).map(([c, s]) => [c, s.order!] as [string, DemoOrder]) : [];
  const positions = d ? Object.entries(d.markets).filter(([, s]) => s.position).map(([c, s]) => [c, s.position!] as [string, DemoPosition]) : [];
  const trades = d?.trades ?? [];
  const pnl = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter(t => t.pnl > 0).length;
  return <section className="card sx-panel" aria-label="Demo account" data-testid="panel-demo">
    <div className="sx-head"><span>DEMO ACCOUNT · FORWARD TEST OF THE DEFAULT FILTER</span><b>{d?.startedWeek ? `since week of ${wk(d.startedWeek)}` : "starting soon"}</b></div>
    <div className="sx-rd">
      <p className="muted"><span className="ih-tag">Speculation</span>A public paper-trading experiment, the same for everyone: a frozen COT filter (AND gate, 16-week OI-normalized Z; the site default until Oct 27, 2026) decides the side, and weekly bar patterns (2-2, 3-2, failed 2, 3) trigger the entry. One full-size contract per trade, stop trailed to every bar that closes our way, target {DEMO_TARGET_SIGMA}σ. Rules are frozen; results are before commissions and slippage, and every loss stays on the record. Not advice: no one should copy these orders.</p>
    </div>
    {query.isLoading && <div className="sx-rd"><p className="muted">Loading the demo account…</p></div>}
    {query.isError && <div className="sx-rd"><p className="muted">The demo account is unavailable right now.</p></div>}
    {!query.isLoading && !query.isError && (!d || !d.startedWeek) && <div className="sx-rd"><p className="muted">The account starts with the first full week after launch: its first orders are placed after the next Friday close, for the week that follows, so no order can use prices from before it was published.</p></div>}
    {d?.startedWeek && <>
      <div className="sx-strip da-strip" role="group" aria-label="Demo account summary">
        <div className="sx-st"><span>BALANCE</span><b>${Math.round(d.startBalance + pnl).toLocaleString()}</b></div>
        <div className="sx-st"><span>P&amp;L</span><b className={pnl > 0 ? "up" : ""}>{usd(pnl)}</b></div>
        <div className="sx-st"><span>CLOSED TRADES</span><b>{trades.length}</b></div>
        <div className="sx-st"><span>WIN RATE</span><b>{trades.length ? `${Math.round(wins / trades.length * 100)}%` : "—"}</b></div>
        <div className="sx-st"><span>AVG R</span><b>{trades.length ? (trades.reduce((a, t) => a + t.r, 0) / trades.length).toFixed(2) : "—"}</b></div>
        <div className="sx-st"><span>BACKTEST AVG R</span><b>+0.14</b></div>
      </div>
      <div className="sx-head ih-subhead"><span>FILTER ON · WEEK OF {d.lastWeek ? wk(d.lastWeek).toUpperCase() : "—"}</span><b>{d.filtersNow.length} market{d.filtersNow.length === 1 ? "" : "s"}</b></div>
      <div className="sx-rd"><p>{d.filtersNow.length ? d.filtersNow.map(f => <span key={f.code} className={`da-chip ${f.dir > 0 ? "long" : "short"}`}>{f.symbol} {f.dir > 0 ? "▲ long only" : "▼ short only"}</span>) : <span className="muted">The filter is off in every demo market this week.</span>}</p></div>
      <div className="sx-head ih-subhead"><span>ORDERS FOR NEXT WEEK</span><b>good for one week</b></div>
      {orders.length ? <Orders rows={orders} /> : <div className="sx-rd"><p className="muted">No trigger bar in a filtered market this week, so no orders.</p></div>}
      <div className="sx-head ih-subhead"><span>OPEN POSITIONS</span><b>{positions.length}</b></div>
      {positions.length ? <Positions rows={positions} /> : <div className="sx-rd"><p className="muted">No open positions.</p></div>}
      <div className="sx-head ih-subhead"><span>CLOSED TRADES</span><b>latest first</b></div>
      {trades.length ? <Trades rows={[...trades].reverse().slice(0, 20)} /> : <div className="sx-rd"><p className="muted">No closed trades yet.</p></div>}
      <div className="sx-cap">Updated after each Friday close from weekly bars ({d.updatedAt ? new Date(d.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }) + " ET" : "—"}). Fills are conservative: when a week touches both the stop and the target, the stop counts. Prices are continuous front-month futures.</div>
    </>}
  </section>;
}
