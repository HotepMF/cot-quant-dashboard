import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Info, Moon, Sun } from "lucide-react";
import { HAND_FOOTER } from "@workspace/cot-engine";
import type { HandCard, HandSnapshot, ParticipationRow } from "@workspace/cot-engine";
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
      <td className="sx-nm">{p.market}</td><td>{p.category}</td>
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
        <div className="ih-cards">{data.cards.map(c => <Card key={c.id} card={c} rows={data.participation.filter(p => p.card === c.id)} />)}</div>
        <footer className="sx-foot">
          {HAND_FOOTER} Positioning: CFTC Commitments of Traders, futures only (Traders in Financial Futures, Disaggregated, Legacy); net and gross positions as % of open interest; 3-yr pct = share of the last 156 weekly readings below today's; rows are withheld when fewer than 20 traders hold the category or the top 4 traders hold more than 50% of either side. Volatility: SPY 21-day realised volatility against its 3-year history (enter ±1σ, exit inside ±0.5σ), VIX ÷ VIX3M. Rates: U.S. Treasury daily par yield curve; curve label from the 13-week change in 2s10s against its 3-year history. Prices: {data.priceSource}, end of day. Past patterns come from our 1999–2026 tests and describe what happened alongside each state, not what follows it. <Link href="/how-it-works">How it works</Link>. Not investment advice.
        </footer>
      </>}
    </main>
    <SiteMobileNav />
  </div>;
}
