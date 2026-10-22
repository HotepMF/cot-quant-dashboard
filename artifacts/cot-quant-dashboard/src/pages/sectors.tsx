import { useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Moon, Sun } from "lucide-react";
import { POSITIONING_GROUPS, SECTOR_LINKS } from "@workspace/cot-engine";
import type { PositioningRow, SectorRow, SectorsSnapshot } from "@workspace/cot-engine";
import { useTheme, workspaceLinks } from "@/components/scanner/scanner-shell";
import "./sectors.css";

const signed = (v: number | null, d = 1, unit = "") => v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}${unit}`;
const ordinal = (p: number) => `${p}${p % 100 >= 11 && p % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[p % 10] ?? "th"}`;
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Cell tint by size of the move: primary for ahead of SPY, muted for behind. */
function heat(v: number | null, scale: number) {
  if (v == null) return undefined;
  const a = (Math.min(Math.abs(v) / scale, 1) * 0.38).toFixed(2);
  return { background: v > 0 ? `hsl(var(--primary) / ${a})` : `hsl(var(--muted-foreground) / ${a})` };
}

function ZBar({ z }: { z: number | null }) {
  if (z == null) return <span className="sx-zn">—</span>;
  const w = Math.min(Math.abs(z), 3) / 3 * 22, rare = Math.abs(z) >= 2;
  return <span className="sx-zz">
    <span className="sx-zb"><span className="sx-zc" /><span className={rare ? "rare" : z > 0 ? "up" : "down"} style={{ left: z >= 0 ? 24 : 24 - w, width: w }} /></span>
    <span className={`sx-zn${rare ? " rare" : ""}`}>{signed(z, 1, "σ")}</span>
  </span>;
}

function Spark({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const x = (i: number) => (i * 64 / (values.length - 1)).toFixed(1);
  const pts = values.map((v, i) => `${x(i)},${(15 - (v - lo) / span * 14).toFixed(1)}`).join(" ");
  const k = values.length - 5;
  return <svg className="sx-spark" width="64" height="16" viewBox="0 0 64 16" aria-hidden>
    <line x1={x(k)} x2={x(k)} y1="0" y2="16" className="sx-spark-mark" />
    <polyline points={pts} fill="none" className={`sx-spark-line ${tone}`} />
  </svg>;
}

function RangeBar({ funds, other }: { funds: number; other: number }) {
  return <span className="sx-rb" aria-label={`Funds at the ${ordinal(funds)} percentile, other group at the ${ordinal(other)}`}>
    <span className="sx-rz l" /><span className="sx-rz r" />
    <span className="sx-mk other" style={{ left: `calc(${other}% - 5px)` }} />
    <span className="sx-mk funds" style={{ left: `calc(${funds}% - 5px)` }} />
  </span>;
}

function underneath(row: SectorRow, byId: Map<string, PositioningRow>) {
  const links = (SECTOR_LINKS[row.ticker] ?? []).map(id => byId.get(id)).filter((p): p is PositioningRow => !!p);
  if (!links.length) return { text: "No clean link · price only", muted: true };
  if (row.ticker === "XLRE") return { text: "10Y: basis trade · not read", muted: true };
  const notable = links.filter(p => p.label3y !== "Mid-range");
  return { text: notable.length ? notable.map(p => `${p.label} ${p.label3y.toLowerCase()}`).join(" · ") : `${links.map(p => p.symbol).join(", ")} mid-range`, muted: false };
}

function Matrix({ data }: { data: SectorsSnapshot }) {
  const byId = new Map(data.positioning.map(p => [p.id, p]));
  return <section className="card sx-panel sx-wide" aria-label="Sector matrix">
    <div className="sx-head"><span>SECTOR MATRIX · RELATIVE TO S&amp;P 500</span><b>sorted by 3 mo</b></div>
    <div className="sx-scroll"><table className="sx-table">
      <thead><tr><th>Tkr</th><th>Sector</th><th className="num">1D</th><th className="num">1W</th><th className="num">1M</th><th className="num">3M</th><th className="num">1Y</th><th>Momentum · 26 wk</th><th>3M vs norm</th><th>1Y vs norm</th><th className="hide-sm">Underneath</th></tr></thead>
      <tbody>{data.sectors.map(r => {
        const u = underneath(r, byId);
        const tone = r.momentum?.word === "Rising" ? "up" : r.momentum?.word === "Falling" ? "down" : "flat";
        return <tr key={r.ticker} data-testid={`row-sector-${r.ticker}`}>
          <td className="sx-tk">{r.ticker}</td><td className="sx-nm">{r.name}</td>
          <td className="num" style={heat(r.rel.d1, 2)}>{signed(r.rel.d1)}</td>
          <td className="num" style={heat(r.rel.w1, 4)}>{signed(r.rel.w1)}</td>
          <td className="num" style={heat(r.rel.m1, 8)}>{signed(r.rel.m1)}</td>
          <td className="num" style={heat(r.rel.m3, 16)}>{signed(r.rel.m3)}</td>
          <td className="num" style={heat(r.rel.y1, 30)}>{signed(r.rel.y1)}</td>
          <td className="sx-mo">{r.momentum && <><Spark values={r.spark} tone={tone} /><span className={`sx-ar ${tone}`}>{r.momentum.arrow} {r.momentum.word}</span><span className="sx-q">{r.momentum.qualifier}</span></>}</td>
          <td><ZBar z={r.z.w13} /></td><td><ZBar z={r.z.w52} /></td>
          <td className={`sx-ud hide-sm${u.muted ? " muted" : ""}`}>{u.text}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <div className="sx-cap">Momentum: last 4 weeks vs the sector's 3-year norm (▲ ≥ +0.5σ · ▼ ≤ −0.5σ); line = sector vs SPY over 26 weeks, dotted 4 weeks ago · σ = distance from its own 3-year norm · amber = 2σ or more</div>
  </section>;
}

function Monitor({ data }: { data: SectorsSnapshot }) {
  return <section className="card sx-panel" aria-label="Positioning monitor">
    <div className="sx-head"><span>POSITIONING MONITOR · 3-YR RANGE</span><b>CFTC {day(data.positioningAsOf)}</b></div>
    <div className="sx-scroll"><table className="sx-table">
      <thead><tr><th>Mkt</th><th></th><th className="num">13 wk</th><th>3-yr range</th><th className="num">Funds</th><th className="num">Other</th><th className="num">4 wk pp</th><th>Funds</th></tr></thead>
      <tbody>{data.positioning.map(p => {
        const tone = p.label3y.startsWith("Crowded") ? "crowd" : p.label3y === "Mid-range" ? "mid" : "lean";
        return <tr key={p.id} data-testid={`row-positioning-${p.id}`}>
          <td className="sx-tk">{p.symbol}</td><td className="sx-nm">{p.label}</td><td className="num">{signed(p.price13w, 1, "%")}</td>
          <td><RangeBar funds={p.fundsPct3y} other={p.otherPct3y} /></td>
          <td className="num">{ordinal(p.fundsPct3y)}</td><td className="num">{ordinal(p.otherPct3y)}</td><td className="num">{signed(p.fundsChg4w)}</td>
          <td className={`sx-lab ${tone}`}>{p.label3y}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <div className="sx-cap sx-legend"><span><span className="sx-mk funds static" /> funds (managed money · leveraged funds)</span><span><span className="sx-mk other static" /> producers · asset managers</span><span>shaded = top / bottom 10%</span></div>
  </section>;
}

const tests: [string, string, string][] = [
  ["Does a sector's lead last longer when positioning agrees?", "About +0.7% over 13 weeks when commercials lean with the move; a gap that size shows up by chance about 1 time in 6", "NOT RELIABLE"],
  ["Are crowded markets followed by bigger or sharper moves?", "No larger than after strong trends with ordinary positioning", "NO"],
  ["Do rising sectors keep rising?", "No reliable tendency to continue or reverse at any lookback (11 sectors, 1999–2026)", "NO"],
  ["Do unusually strong sectors give it back?", "Leaders 2σ+ above normal trailed SPY the next week, median −0.3%", "TOO SMALL"],
];

export function SectorsPage() {
  const [location] = useLocation();
  const [isDark, setIsDark] = useTheme();
  useEffect(() => { window.scrollTo(0, 0); document.title = "Sectors · COT Quant"; }, []);
  const query = useQuery({
    queryKey: ["sectors"],
    queryFn: async () => {
      const r = await fetch("/api/sectors");
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? `HTTP ${r.status}`);
      return await r.json() as SectorsSnapshot;
    },
    refetchInterval: 15 * 60_000,
  });
  const data = query.data;
  const strip = useMemo(() => {
    if (!data) return [];
    const lead = data.sectors[0], lag = data.sectors[data.sectors.length - 1];
    const crowded = data.positioning.filter(p => p.label3y.startsWith("Crowded")).map(p => p.label);
    const count = (w: string) => data.sectors.filter(s => s.momentum?.word === w).length;
    const rare = data.sectors.filter(s => [s.z.w13, s.z.w52].some(z => z != null && Math.abs(z) >= 2)).length;
    return [
      { k: "LEADER · 3M", v: `${lead.ticker} ${signed(lead.rel.m3, 1, "%")}`, tone: "up" },
      { k: "LAGGER · 3M", v: `${lag.ticker} ${signed(lag.rel.m3, 1, "%")}`, tone: "down" },
      { k: "CROWDED", v: crowded.length ? crowded.join(" · ") : "none", tone: crowded.length ? "rare" : "" },
      ...(data.yields ? [{ k: "10Y", v: `${data.yields.y10.toFixed(2)}% ${signed(data.yields.y10chg13w, 0, "bp")}`, tone: "" }] : []),
      { k: "MOMENTUM", v: `▲${count("Rising")} ►${count("Flat")} ▼${count("Falling")}`, tone: "" },
      { k: "RARE MOVES", v: `${rare} of ${data.sectors.length}`, tone: rare ? "rare" : "" },
    ];
  }, [data]);

  return <div className="shell">
    <aside className="sidebar">
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "2px 8px 30px" }}>
        <div className="brand-mark"><Activity size={18} /></div>
        <div><div style={{ fontFamily: "var(--app-font-serif)", fontWeight: 800, fontSize: 14, letterSpacing: "-.04em" }}>COT / QUANT</div><div style={{ font: "9px var(--app-font-mono)", color: "rgba(244,241,232,.5)", marginTop: 3 }}>RESEARCH TERMINAL</div></div>
      </div>
      <div className="eyebrow" style={{ color: "rgba(244,241,232,.42)", padding: "0 12px 8px" }}>Workspace</div>
      <nav style={{ display: "grid", gap: 3 }}>
        {workspaceLinks.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? "active" : ""}`}><Icon size={16} />{label}</Link>)}
      </nav>
    </aside>
    <main className="main sx-main">
      <header className="topline">
        <div>
          <div className="eyebrow" style={{ marginBottom: 9 }}>Sectors under the hood</div>
          <h1 className="page-title display">SPDR sectors</h1>
          <p className="subtle scan-lede">Each sector against the S&amp;P 500, with the futures positioning underneath it. Prices update every trading day; positioning with each weekly CFTC report.</p>
        </div>
        <div className="toolbar print-hidden">
          {data && <span className="sx-asof">Prices {day(data.pricesAsOf)} close · CFTC {day(data.positioningAsOf)}</span>}
          <button className="icon-btn" aria-label="Toggle dark mode" title="Toggle theme" onClick={() => setIsDark(v => !v)}>{isDark ? <Sun size={15} /> : <Moon size={15} />}</button>
        </div>
      </header>
      {data && /testing/i.test(data.priceSource) && <div className="sx-banner" role="note" data-testid="banner-price-source"><AlertTriangle size={14} />Preview: prices come from {data.priceSource}. This page stays unlisted until a licensed price source is connected.</div>}
      {query.isLoading && <div className="card sx-empty">Loading the sectors snapshot…</div>}
      {query.isError && <div className="card sx-empty">{query.error instanceof Error ? query.error.message : "The sectors snapshot is unavailable."}</div>}
      {data && <>
        <div className="sx-strip" role="group" aria-label="Snapshot">{strip.map(s => <div key={s.k} className="sx-st"><span>{s.k}</span><b className={s.tone}>{s.v}</b></div>)}</div>
        <Matrix data={data} />
        <div className="sx-grid">
          <Monitor data={data} />
          <section className="card sx-panel" aria-label="What our tests found">
            <div className="sx-head"><span>TEST LOG · CONTEXT, NOT SIGNALS</span><b>2007–2026</b></div>
            <table className="sx-table sx-tests"><tbody>{tests.map(([q, a, v]) => <tr key={q}><td className="sx-qn">{q}<span>{a}</span></td><td><span className="sx-vd">{v}</span></td></tr>)}</tbody></table>
            <p className="sx-rd">Read "crowded" as where the risk sits and the price columns as what is actually moving. <Link href="/how-it-works">How it works</Link></p>
          </section>
        </div>
        <div className="sx-panels">{data.panels.map(p => <section key={p.id} className="card sx-panel" data-testid={`panel-${p.id}`}>
          <div className="sx-head"><span>{p.title.toUpperCase()}</span><b>{p.headline}</b></div>
          <div className="sx-rd">{p.read.map((t, i) => <p key={i}>{t}</p>)}{p.note && <p className="muted">{p.note}</p>}</div>
        </section>)}</div>
        <footer className="sx-foot">
          Sector performance: ETF vs SPY, dividend-adjusted closes ({data.priceSource}); σ = z-score vs the trailing 156 weeks. Positioning: CFTC Commitments of Traders, Futures Only — Disaggregated ({POSITIONING_GROUPS.disagg.funds.toLowerCase()} vs {POSITIONING_GROUPS.disagg.other.toLowerCase()}) and Traders in Financial Futures ({POSITIONING_GROUPS.tff.funds.toLowerCase()} vs {POSITIONING_GROUPS.tff.other.toLowerCase()}); net % of open interest; percentile = share of the last 156 weekly readings at or below today's. Futures prices are front-month, not roll-adjusted. Yields: U.S. Treasury daily par yield curve. Context for understanding the market, not a forecast or a trading signal. Not investment advice.
        </footer>
      </>}
    </main>
    <nav className="mobile-nav print-hidden">
      {workspaceLinks.map(({ href, short, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? "active" : ""}`} aria-label={label}><Icon size={16} /><span>{short}</span></Link>)}
    </nav>
  </div>;
}
