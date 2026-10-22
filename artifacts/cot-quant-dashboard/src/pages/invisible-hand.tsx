import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Info, Moon, Sun } from "lucide-react";
import { HAND_FOOTER, curatedMarketByCode, marketEvents } from "@workspace/cot-engine";
import type { CrowdedRow, HandCard, HandSnapshot, MarketEvent, ParticipationRow, RangeRow } from "@workspace/cot-engine";
import { EventTags, eventDay, newYorkToday } from "@/components/event-tags";
import { DemoAccount } from "@/components/demo-account";
import { useTheme } from "@/components/scanner/scanner-shell";
import { SiteBrand, SiteMobileNav, SiteNav } from "@/components/site-nav";
import "./sectors.css";
import "./invisible-hand.css";

const signed = (v: number | null, d = 1) => v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;
const ordinal = (p: number) => `${p}${p % 100 >= 11 && p % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[p % 10] ?? "th"}`;
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const crowded = (p: ParticipationRow) => p.pct3y != null && (p.pct3y >= 90 || p.pct3y <= 10);
const count = (v: number | null) => v == null ? "suppressed" : String(v);

function Participation({ rows }: { rows: ParticipationRow[] }) {
  if (!rows.length) return null;
  return <div className="sx-scroll"><table className="sx-table ih-part">
    <thead><tr><th>Market</th><th>Category</th><th className="num">Net % OI</th><th className="num">Long / short</th><th className="num">3-yr pct</th><th className="num">4 wk pp</th><th className="num hide-sm">Traders L / S</th></tr></thead>
    <tbody>{rows.map(p => <tr key={`${p.code}-${p.category}`} data-testid={`row-participation-${p.code}-${p.category.replace(/\W+/g, "-")}`}>
      <td className="sx-nm">{p.market}<EventTags code={p.code} reportDate={p.reportDate} /></td><td>{p.category}</td>
      {p.withheld
        ? <td className="num ih-withheld" colSpan={4}>withheld · thin market</td>
        : <>
          <td className="num">{signed(p.netPct)}</td>
          <td className="num">{p.longPct?.toFixed(1)} / {p.shortPct?.toFixed(1)}</td>
          <td className={`num${crowded(p) ? " ih-crowd" : ""}`}>{p.pct3y == null ? "—" : ordinal(p.pct3y)}</td>
          <td className="num">{signed(p.chg4w)}</td>
        </>}
      <td className="num hide-sm">{count(p.tradersLong)} / {count(p.tradersShort)}</td>
    </tr>)}</tbody>
  </table></div>;
}

const plus = (e: MarketEvent, r: RangeRow) => e.effect?.verdict === "wider" && e.effect[r.market === "ES" ? "es" : "nq"] != null
  ? r.medianPct * (1 + e.effect[r.market === "ES" ? "es" : "nq"]! / 100) : null;
const touched = (e: MarketEvent) => e.codes.length > 12 ? "All financial futures" : [...new Set(e.codes.map(c => curatedMarketByCode.get(c)?.symbol).filter(Boolean))].join(" · ");

/** Expected ranges, the next two weeks of scheduled events, and the crowded watch. */
function DayTrader({ data }: { data: HandSnapshot }) {
  const today = newYorkToday();
  const two = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10);
  const events = marketEvents(today, two);
  const ranges = data.ranges ?? [], crowd = data.crowded ?? [];
  const es = ranges.find(r => r.market === "ES");
  return <>
    <div className="sx-grid ih-dt">
      <section className="card sx-panel" aria-label="Expected ranges" data-testid="panel-ranges">
        <div className="sx-head"><span>EXPECTED DAILY RANGE · ES / NQ</span><b>volatility {ranges[0]?.state ?? "—"}</b></div>
        {ranges.length ? <div className="sx-scroll"><table className="sx-table ih-ranges"><thead><tr><th>Mkt</th><th className="num">Typical day</th><th className="num">Wide day</th><th className="num">Last 20 days</th><th className="num hide-sm">Last</th></tr></thead>
          <tbody>{ranges.map(r => <tr key={r.market} data-testid={`row-range-${r.market}`}>
            <td className="sx-tk">{r.market}</td>
            <td className="num">{r.medianPct.toFixed(2)}% <span className="ih-pts">{r.medianPts.toLocaleString()} pts</span></td>
            <td className="num">{r.p80Pct.toFixed(2)}% <span className="ih-pts">{r.p80Pts.toLocaleString()} pts</span></td>
            <td className="num">{r.recent20Pct == null ? "—" : `${r.recent20Pct.toFixed(2)}%`}</td>
            <td className="num hide-sm">{r.last.toLocaleString()}</td>
          </tr>)}</tbody></table></div> : <div className="sx-rd"><p className="muted">Range data is unavailable this run.</p></div>}
        <div className="sx-rd"><p className="muted"><span className="ih-tag">Validated</span>High − low as % of the prior close, in this volatility state, 2002–2026. Typical = median day; wide = 1 day in 5 is larger. Ranges are tested; direction is not. FOMC and payrolls days have run about 20% wider.</p></div>
      </section>
      <section className="card sx-panel" aria-label="Next two weeks" data-testid="panel-calendar">
        <div className="sx-head"><span>NEXT TWO WEEKS · SCHEDULED</span><b>{eventDay(today, false)} – {eventDay(two, false)}</b></div>
        <table className="sx-table ih-cal"><tbody>{events.length ? events.map(e => <tr key={`${e.kind}-${e.date}-${e.label}`} data-testid={`row-event-${e.kind}-${e.date}`}>
          <td className="ih-cd">{eventDay(e.date)}</td>
          <td><b className={e.effect?.verdict === "wider" ? "ih-wide" : ""}>{e.label}</b>{e.time && <span className="ih-pts"> {e.time}</span>}
            <span className="ih-sub">{touched(e)}{e.effect && <> · {e.effect.text}{es && plus(e, es) != null ? `: typical ES day ≈ ${plus(e, es)!.toFixed(2)}% (${Math.round(es.last * plus(e, es)! / 100)} pts)` : ""}</>}</span></td>
        </tr>) : <tr><td className="muted">No scheduled events in the next two weeks.</td></tr>}</tbody></table>
        <div className="sx-cap">Sources: Federal Reserve and BLS release schedules; expirations from exchange rules. CFTC positioning is released Fridays at 3:30 pm ET.</div>
      </section>
    </div>
    <section className="card sx-panel" aria-label="Crowded watch" data-testid="panel-crowded">
      <div className="sx-head"><span>CROWDED WATCH · CORE MARKETS AT A 3-YEAR EXTREME</span><b>CFTC {crowd[0] ? day(crowd[0].reportDate) : "—"}</b></div>
      {crowd.length ? <div className="sx-scroll"><table className="sx-table ih-crowdtab"><thead><tr><th>Mkt</th><th>Market</th><th className="num">Large specs net % OI</th><th className="num">Specs 3-yr pct</th><th className="num">Commercials pct</th><th className="num">4 wk pp</th></tr></thead>
        <tbody>{crowd.map((c: CrowdedRow) => <tr key={c.code} data-testid={`row-crowded-${c.code}`}>
          <td className="sx-tk">{c.symbol}</td><td className="sx-nm">{c.label}<EventTags code={c.code} reportDate={c.reportDate} today={today} /></td>
          <td className="num">{signed(c.specNetPct)}</td><td className="num ih-crowd">{ordinal(c.specPct3y)}</td><td className="num">{ordinal(c.commPct3y)}</td><td className="num">{signed(c.chg4w)}</td>
        </tr>)}</tbody></table></div> : <div className="sx-rd"><p className="muted">No core market is at a 3-year extreme this week.</p></div>}
      <div className="sx-rd"><p className="muted"><span className="ih-tag">Validated</span>Crowded readings were not followed by bigger moves in our tests, so this is where risk sits, not a timing signal. Tags: solid = scheduled in the next 7 days; outlined = happened inside the week this report covers.</p></div>
    </section>
  </>;
}

function Card({ card, rows }: { card: HandCard; rows: ParticipationRow[] }) {
  return <section className="card sx-panel" aria-label={card.title} data-testid={`card-${card.id}`}>
    <div className="sx-head"><span>{card.title.toUpperCase()}</span><b className={card.status === "pending" ? "ih-pending" : ""}>{card.status === "pending" ? "data pending" : card.state ?? "—"}</b></div>
    <div className="sx-rd">
      {card.pendingReason && <p className="ih-note"><Info size={13} />{card.pendingReason}</p>}
      <p className="ih-headline">{card.headline}</p>
      {card.mechanism && <p className="muted">{card.mechanism}</p>}
    </div>
    {card.readings.length > 0 && <table className="sx-table ih-readings"><tbody>{card.readings.map(r => <tr key={r.label}>
      <td className="ih-rl">{r.label}</td><td className="num">{r.value}</td><td className="ih-rn hide-sm">{r.note}</td>
    </tr>)}</tbody></table>}
    {card.sectorLine && <div className="sx-rd"><p><span className="ih-tag">Past pattern</span>{card.sectorLine}</p></div>}
    {rows.length > 0 && <>
      <div className="sx-head ih-subhead"><span>WHO IS POSITIONED · CFTC {day(rows[0].reportDate)}</span><b>participation, not a forecast</b></div>
      <Participation rows={rows} />
    </>}
  </section>;
}

export function InvisibleHandPage() {
  const [isDark, setIsDark] = useTheme();
  useEffect(() => { window.scrollTo(0, 0); document.title = "The Invisible Hand · COT Quant"; }, []);
  const query = useQuery({
    queryKey: ["invisible-hand"],
    queryFn: async () => {
      const r = await fetch("/api/invisible-hand");
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? `HTTP ${r.status}`);
      return await r.json() as HandSnapshot;
    },
    refetchInterval: 15 * 60_000,
  });
  const data = query.data;
  const strip = useMemo(() => {
    if (!data) return [];
    const card = (id: string) => data.cards.find(c => c.id === id);
    const state = (id: string) => { const c = card(id); return c?.status === "pending" ? "pending" : c?.state ?? "—"; };
    const crowd = data.participation.filter(crowded);
    return [
      { k: "VOLATILITY", v: state("volatility"), tone: state("volatility") === "high" ? "rare" : "" },
      { k: "CURVE", v: state("rates"), tone: "" },
      { k: "AI × POWER", v: state("ai"), tone: "" },
      { k: "CREDIT", v: state("credit"), tone: "" },
      { k: "POWER & GAS", v: state("power"), tone: "" },
      { k: "CROWDED ROWS", v: `${crowd.length} of ${data.participation.filter(p => !p.withheld).length}`, tone: crowd.length ? "rare" : "" },
    ];
  }, [data]);

  return <div className="shell">
    <aside className="sidebar">
      <SiteBrand />
      <SiteNav />
    </aside>
    <main className="main sx-main">
      <header className="topline">
        <div>
          <div className="eyebrow" style={{ marginBottom: 9 }}>Weekly macro backdrop</div>
          <h1 className="page-title display">The Invisible Hand</h1>
          <p className="subtle scan-lede">The forces behind the market this week: rates, credit, volatility, power and the AI trade, and who is positioned in each. Positioning updates minutes after each Friday CFTC release; prices and yields after each close.</p>
        </div>
        <div className="toolbar print-hidden">
          {data && <span className="sx-asof">CFTC {day(data.positioningAsOf)} · prices {day(data.pricesAsOf)} close</span>}
          <button className="icon-btn" aria-label="Toggle dark mode" title="Toggle theme" onClick={() => setIsDark(v => !v)}>{isDark ? <Sun size={15} /> : <Moon size={15} />}</button>
        </div>
      </header>
      <div className="sx-banner ih-disclaimer" data-testid="banner-disclaimer"><Info size={14} />Research and opinion, not financial advice. We show the data and our reasoning so you can check it. Do your own research and make your own decisions.</div>
      {query.isLoading && <div className="card sx-empty">Loading this week's numbers…</div>}
      {query.isError && <div className="card sx-empty">{query.error instanceof Error ? query.error.message : "The Invisible Hand snapshot is unavailable."}</div>}
      {data && <>
        <div className="sx-strip" role="group" aria-label="This week">{strip.map(s => <div key={s.k} className="sx-st"><span>{s.k}</span><b className={s.tone}>{s.v}</b></div>)}</div>
        <section className="card sx-panel" aria-label="Our read" data-testid="panel-read">
          <div className="sx-head"><span>OUR READ</span><b className="ih-pending">coming soon</b></div>
          <div className="sx-rd"><p className="muted">A short weekly read is on its way: what the numbers below add up to, how we lean, and what would change our mind. Every statement will be labeled <b>Validated</b> (backed by our tested data) or <b>Speculation</b> (with the reasoning shown). For now this page shows the numbers only.</p></div>
        </section>
        <DayTrader data={data} />
        <DemoAccount />
        <div className="ih-cards">{data.cards.map(c => <Card key={c.id} card={c} rows={data.participation.filter(p => p.card === c.id)} />)}</div>
        <footer className="sx-foot">
          {HAND_FOOTER} Positioning: CFTC Commitments of Traders, futures only (Traders in Financial Futures, Disaggregated, Legacy); net and gross positions as % of open interest; 3-yr pct = share of the last 156 weekly readings below today's; rows are withheld when fewer than 20 traders hold the category or the top 4 traders hold more than 50% of either side. Volatility: SPY 21-day realised volatility against its 3-year history (enter ±1σ, exit inside ±0.5σ), VIX ÷ VIX3M. Rates: U.S. Treasury daily par yield curve; curve label from the 13-week change in 2s10s against its 3-year history. Prices: {data.priceSource}, end of day. Past patterns come from our 1999–2026 tests and describe what happened alongside each state, not what follows it. <Link href="/how-it-works">How it works</Link>. Not investment advice.
        </footer>
      </>}
    </main>
    <SiteMobileNav />
  </div>;
}
