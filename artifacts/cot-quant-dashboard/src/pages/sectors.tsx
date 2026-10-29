import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Moon, Sun } from "lucide-react";
import { POSITIONING_GROUPS, SECTOR_LINKS, SECTOR_WATCH } from "@workspace/cot-engine";
import type { PositioningRow, SectorRow, SectorsSnapshot } from "@workspace/cot-engine";
import { useTheme } from "@/components/scanner/scanner-shell";
import { SiteBrand, SiteMobileNav, SiteNav } from "@/components/site-nav";
import { EventTags } from "@/components/event-tags";
import "./sectors.css";

const signed = (v: number | null, d = 1, unit = "") => v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}${unit}`;
const ordinal = (p: number) => `${p}${p % 100 >= 11 && p % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[p % 10] ?? "th"}`;
/**
 * Closing prices missing since `asOf`: weekdays after it up to the latest close that should be in
 * (today once the evening job has run, about 18:00 New York; otherwise the previous weekday).
 */
export function missedCloses(asOf: string, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map(x => [x.type, x.value]));
  let last = Date.parse(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
  if (Number(p.hour) < 18) last -= 86_400_000;
  let missed = 0;
  for (let d = Date.parse(`${asOf}T00:00:00Z`) + 86_400_000; d <= last; d += 86_400_000) {
    const wd = new Date(d).getUTCDay();
    if (wd !== 0 && wd !== 6) missed++;
  }
  return missed;
}

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
          <td className="sx-tk">{p.symbol}</td><td className="sx-nm">{p.label}<EventTags code={p.code} reportDate={p.reportDate} /></td><td className="num">{signed(p.price13w, 1, "%")}</td>
          <td><RangeBar funds={p.fundsPct3y} other={p.otherPct3y} /></td>
          <td className="num">{ordinal(p.fundsPct3y)}</td><td className="num">{ordinal(p.otherPct3y)}</td><td className="num">{signed(p.fundsChg4w)}</td>
          <td className={`sx-lab ${tone}`}>{p.label3y}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <div className="sx-cap sx-legend"><span><span className="ev-tag up">FOMC Wed</span> scheduled next 7 days · <span className="ev-tag data">in data</span> during this report's week</span><span><span className="sx-mk funds static" /> funds (managed money · leveraged funds)</span><span><span className="sx-mk other static" /> producers · asset managers</span><span>shaded = top / bottom 10%</span></div>
  </section>;
}

const tests: [string, string, string][] = [
  ["Does a sector's lead last longer when positioning agrees?", "About +0.7% over 13 weeks when commercials lean with the move; a gap that size shows up by chance about 1 time in 6", "NOT RELIABLE"],
  ["Are crowded markets followed by bigger or sharper moves?", "No larger than after strong trends with ordinary positioning", "NO"],
  ["Do rising sectors keep rising?", "No reliable tendency to continue or reverse at any lookback (11 sectors, 1999–2026)", "NO"],
  ["Do unusually strong sectors give it back?", "Leaders 2σ+ above normal trailed SPY the next week, median −0.3%", "TOO SMALL"],
  ["Does XLE follow the COT filter on energy futures?", "Same direction vs SPY over 4–13 weeks after commercial extremes on crude, gasoline and natural gas (previous 16-week default); small samples, found by testing many links", "LEAD · SMALL SAMPLE"],
];

export function SectorsPage() {
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
      <SiteBrand />
      <SiteNav />
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
      {/* Two or more missing closes (one may be a market holiday): say so rather than show stale numbers silently. */}
      {data && missedCloses(data.pricesAsOf) >= 2 && <div className="sx-banner" role="alert" data-testid="banner-stale-prices"><AlertTriangle size={14} />Prices were last updated at the {day(data.pricesAsOf)} close; the price source hasn't updated since, so the price columns may be out of date. Positioning is unaffected.</div>}
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
            <p className="sx-rd">Read "crowded" as where the risk sits and the price columns as what is actually moving. <Link href="/how-it-works/spdr">How it works</Link></p>
          </section>
        </div>
        <div className="sx-panels">{data.panels.map(p => <section key={p.id} className="card sx-panel" data-testid={`panel-${p.id}`}>
          <div className="sx-head"><span>{p.title.toUpperCase()}</span><b>{p.headline}</b></div>
          <div className="sx-rd">{p.read.map((t, i) => <p key={i}>{t}</p>)}{p.note && <p className="muted">{p.note}</p>}
            {SECTOR_WATCH[p.id as keyof typeof SECTOR_WATCH] && <p className="sx-watch" data-testid={`watch-${p.id}`}><span className="sx-vd">WATCH · PAST CO-MOVEMENT</span> {SECTOR_WATCH[p.id as keyof typeof SECTOR_WATCH]}</p>}</div>
        </section>)}</div>
        <footer className="sx-foot">
          Sector performance: ETF vs SPY, dividend-adjusted closes ({data.priceSource}); σ = z-score vs the trailing 156 weeks. Positioning: CFTC Commitments of Traders, Futures Only — Disaggregated ({POSITIONING_GROUPS.disagg.funds.toLowerCase()} vs {POSITIONING_GROUPS.disagg.other.toLowerCase()}) and Traders in Financial Futures ({POSITIONING_GROUPS.tff.funds.toLowerCase()} vs {POSITIONING_GROUPS.tff.other.toLowerCase()}); net % of open interest; percentile = share of the last 156 weekly readings at or below today's. Futures prices are front-month, not roll-adjusted. Yields: U.S. Treasury daily par yield curve. Context for understanding the market, not a forecast or a trading signal. Not investment advice.
        </footer>
      </>}
    </main>
    <SiteMobileNav />
  </div>;
}
