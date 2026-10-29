import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, ArrowRight, Moon, Sun } from "lucide-react";
import { CORE_GROUPS, CORE_MARKETS, SPECIALTY_MARKETS } from "@workspace/cot-engine";
import { useTheme } from "@/components/scanner/scanner-shell";
import { SiteBrand, SiteMobileNav, SiteNav } from "@/components/site-nav";

/** The sub-pages, in the sidebar's order and with its names (Workspace, then All-market scan), then using it and the data. */
const PAGES = [
  { slug: "start", label: "Start here" },
  { slug: "z-scores", label: "Z-scores explained" },
  { slug: "market-overview", label: "Market overview", group: "Workspace" },
  { slug: "positioning", label: "Positioning", group: "Workspace" },
  { slug: "weekly-readings", label: "Weekly readings", group: "Workspace" },
  { slug: "settings", label: "Settings", group: "Workspace" },
  { slug: "sector-positioning", label: "Sector positioning", group: "All-market scan" },
  { slug: "watchlist", label: "Watchlist", group: "All-market scan" },
  { slug: "spdr", label: "SPDR sectors", group: "All-market scan" },
  { slug: "invisible-hand", label: "The Invisible Hand", group: "All-market scan" },
  { slug: "using-it", label: "Using it day to day" },
  { slug: "data", label: "Data & limits" },
] as { slug: string; label: string; group?: string }[];
type Slug = string;

/** Earlier addresses (the single long page's anchors, then the first sub-pages) and where they live now. */
const OLD_ANCHORS: Record<string, string> = {
  cot: "start#groups", markets: "data#markets", consolidated: "data#consolidated", history: "data#history",
  reading: "watchlist#reading", model: "watchlist#reading", settings: "settings",
  sectors: "spdr", "invisible-hand": "invisible-hand", curve: "market-overview#curve", updates: "data", limits: "data#limits",
};
const OLD_PAGES: Record<string, string> = {
  "cot-report": "start#groups", reading: "watchlist#reading", "eight-week": "watchlist#reading", pages: "spdr", "market-detail": "market-overview",
};

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return <section id={id} className="card hiw-section" data-testid={id ? `section-${id}` : undefined}>
    <div className="card-head"><h2 className="panel-title">{title}</h2></div>
    <div className="card-body hiw-body">{children}</div>
  </section>;
}
/** Detail tucked away until asked for. */
const More = ({ label = "More", children }: { label?: string; children: ReactNode }) =>
  <details className="hiw-more"><summary>{label}</summary><div className="hiw-body">{children}</div></details>;
/** "How to read it": the one-line version of a page. */
const Quick = ({ children }: { children: ReactNode }) => <div className="notice hiw-quick">{children}</div>;
/** A bell curve with the site's ±2.25 extremes shaded; drawn from the normal density, theme colors only. */
function BellCurve() {
  const W = 560, H = 190, base = 150, top = 22, xs = (z: number) => 30 + (z + 4) / 8 * (W - 60);
  const ys = (z: number) => base - Math.exp(-z * z / 2) * (base - top);
  const path = (a: number, b: number) => {
    const pts: string[] = [];
    for (let z = a; z <= b + 1e-9; z += 0.05) pts.push(`${xs(z).toFixed(1)},${ys(z).toFixed(1)}`);
    return pts;
  };
  const area = (a: number, b: number) => `M${xs(a)},${base} L${path(a, b).join(" L")} L${xs(b)},${base} Z`;
  const ticks = [-3, -2, -1, 0, 1, 2, 3];
  return <svg viewBox={`0 0 ${W} ${H}`} className="hiw-bell" role="img" aria-label="Bell curve: most weeks sit near the average; beyond plus or minus 2.25 standard deviations is shaded as extreme">
    <path d={area(-1, 1)} className="hiw-bell-mid" />
    <path d={area(-4, -2.25)} className="hiw-bell-short" />
    <path d={area(2.25, 4)} className="hiw-bell-long" />
    <path d={`M${path(-4, 4).join(" L")}`} className="hiw-bell-line" />
    <line x1={xs(-4)} x2={xs(4)} y1={base} y2={base} className="hiw-bell-axis" />
    {ticks.map(z => <g key={z}><line x1={xs(z)} x2={xs(z)} y1={base} y2={base + 5} className="hiw-bell-axis" /><text x={xs(z)} y={base + 18} textAnchor="middle" className="hiw-bell-text">{z > 0 ? `+${z}` : z}</text></g>)}
    {[-2.25, 2.25].map(z => <line key={z} x1={xs(z)} x2={xs(z)} y1={top - 6} y2={base} className="hiw-bell-dash" />)}
    <text x={xs(0)} y={base - 40} textAnchor="middle" className="hiw-bell-text hiw-bell-sub">about 2 in 3 weeks</text>
    <text x={xs(0)} y={base - 32} textAnchor="middle" className="hiw-bell-text hiw-bell-narrow">2 in 3 within ±1</text>
    <text x={xs(0)} y={base - 26} textAnchor="middle" className="hiw-bell-text hiw-bell-sub">within ±1</text>
    <text x={xs(-3.1)} y={top + 2} textAnchor="middle" className="hiw-bell-text hiw-bell-short-text">Extreme short</text>
    <text x={xs(-3.1)} y={top + 16} textAnchor="middle" className="hiw-bell-text hiw-bell-sub">below −2.25</text>
    <text x={xs(3.1)} y={top + 2} textAnchor="middle" className="hiw-bell-text hiw-bell-long-text">Extreme long</text>
    <text x={xs(3.1)} y={top + 16} textAnchor="middle" className="hiw-bell-text hiw-bell-sub">above +2.25</text>
    <text x={xs(0)} y={H - 4} textAnchor="middle" className="hiw-bell-text hiw-bell-sub">Z-score (standard deviations from the 8-week average)</text>
  </svg>;
}

const to = (slug: Slug, hash = "") => `/how-it-works/${slug}${hash ? `#${hash}` : ""}`;

export function HowItWorksPage() {
  const [isDark, setIsDark] = useTheme();
  const params = useParams<{ page?: string }>();
  const [, navigate] = useLocation();
  const current = PAGES.find(p => p.slug === params.page) ?? PAGES[0];
  const index = PAGES.indexOf(current);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    // Earlier links: the single long page's anchors and the first sub-page addresses.
    if (!params.page && hash && OLD_ANCHORS[hash]) { navigate(`/how-it-works/${OLD_ANCHORS[hash]}`, { replace: true }); return; }
    if (params.page && OLD_PAGES[params.page]) { navigate(`/how-it-works/${OLD_PAGES[params.page]}`, { replace: true }); return; }
    if (params.page && !PAGES.some(p => p.slug === params.page)) { navigate("/how-it-works", { replace: true }); return; }
    document.title = `${current.label} · How it works · COT Quant`;
    const target = hash ? document.getElementById(hash) : null;
    if (target) target.scrollIntoView({ block: "start" }); else window.scrollTo(0, 0);
  }, [params.page, current.label, navigate]);

  const prev = PAGES[index - 1], next = PAGES[index + 1];
  return <div className="shell">
    <aside className="sidebar">
      <SiteBrand />
      <SiteNav />
    </aside>
    <main className="main">
      <header className="topline">
        <div>
          <div className="eyebrow" style={{ marginBottom: 9 }}>How it works</div>
          <h1 className="page-title display">{current.label}</h1>
        </div>
        <div className="toolbar print-hidden">
          <button className="icon-btn" aria-label="Toggle dark mode" title="Toggle theme" onClick={() => setIsDark(v => !v)}>{isDark ? <Sun size={15} /> : <Moon size={15} />}</button>
        </div>
      </header>

      <nav className="hiw-toc print-hidden" aria-label="How it works pages">
        {PAGES.map((p, i) => <span key={p.slug} className="hiw-tab">
          {p.group && p.group !== PAGES[i - 1]?.group && <span className="hiw-group">{p.group}</span>}
          <Link href={to(p.slug)} className="ms-chip" aria-pressed={p.slug === current.slug} aria-current={p.slug === current.slug ? "page" : undefined}
            data-testid={`hiw-tab-${p.slug}`}>{i + 1}. {p.label}</Link>
        </span>)}
      </nav>

      <div className="hiw-page" data-testid={`hiw-page-${current.slug}`}>{CONTENT[current.slug]()}</div>

      <nav className="hiw-pager print-hidden" aria-label="Previous and next">
        {prev ? <Link href={to(prev.slug)} className="btn" data-testid="hiw-prev"><ArrowLeft size={14} />{prev.label}</Link> : <span />}
        {next ? <Link href={to(next.slug)} className="btn" data-testid="hiw-next">{next.label}<ArrowRight size={14} /></Link> : <span />}
      </nav>

      <footer className="scan-foot">
        <span>Sources: CFTC Commitments of Traders; end-of-day prices from Yahoo Finance; U.S. Treasury yields.</span>
        <span>Readings are mechanical rule states, not recommendations. Not investment advice.</span>
      </footer>
    </main>
    <SiteMobileNav />
  </div>;
}

const CONTENT: Record<Slug, () => ReactNode> = {
  start: () => <>
    <Section title="What this site is">
      <p>A <b>data overlay</b> for futures traders: where each group of traders is positioned, how unusual that is against its own history, and what is happening in prices around it. It is not a trading model and does not tell you what to do. Colors only show which way a number leans.</p>
      <ul>
        <li><b>It is weekly data.</b> Positions are reported once a week, so the site describes the backdrop for the week, not the next hour.</li>
        <li><b>Readings are mechanical.</b> "Extreme long" means the numbers met a rule, not that anyone made a call.</li>
        <li><b>Settings are yours.</b> They are saved in your browser, and the page tells you when they differ from the site default.</li>
      </ul>
    </Section>
    <Section id="groups" title="The report behind it">
      <p>Every week the CFTC (the U.S. futures regulator) publishes the <b>Commitments of Traders</b> report: positions as of <b>Tuesday</b>, published <b>Friday at 3:30 p.m. ET</b>. The site picks up each release within minutes. It splits traders into three groups:</p>
      <ul>
        <li><b>Commercial hedgers</b>: producers and users of the underlying (oil companies, farmers, refiners, food makers) hedging their business.</li>
        <li><b>Large traders</b>: funds and other speculators trading for profit, many of them trend followers.</li>
        <li><b>Small traders</b>: positions too small to be reported individually.</li>
      </ul>
      <p>Commercials and large traders usually sit on opposite sides: when funds chase a trend, hedgers take the other side. The site reads commercials in their own direction and speculators against theirs.</p>
    </Section>
    <Section title="The pages">
      <p>Each item in the sidebar has its own page here, with the same name and in the same order. <b>Workspace</b> is one market in depth: <Link href={to("market-overview")}>Market overview</Link>, <Link href={to("positioning")}>Positioning</Link>, <Link href={to("weekly-readings")}>Weekly readings</Link> and <Link href={to("settings")}>Settings</Link>. <b>All-market scan</b> covers every core market: <Link href={to("sector-positioning")}>Sector positioning</Link>, <Link href={to("watchlist")}>Watchlist</Link>, <Link href={to("spdr")}>SPDR sectors</Link> and <Link href={to("invisible-hand")}>The Invisible Hand</Link>. <Link href={to("using-it")}>Using it day to day</Link> puts it all together. New to Z-scores? Read <Link href={to("z-scores")}>Z-scores explained</Link> first.</p>
    </Section>
  </>,

  "z-scores": () => <>
    <Quick><b>The short version:</b> a Z-score says how unusual this week is compared with the last 8 weeks. 0 is normal, ±1 is common, ±2 is unusual, and past ±2.25 the site calls it an extreme.</Quick>
    <Section title="Standard deviation: what normal looks like">
      <p>Every market moves differently. Crude oil positions can swing by tens of thousands of contracts in a week; a small market might move by a few hundred. The <b>standard deviation</b> measures how much a number usually moves away from its own average. It is that market's "normal amount of change".</p>
      <p>The site works out each group's average net position and standard deviation over the last <b>8 weeks</b>, so "normal" is always measured against the market's own recent behavior.</p>
    </Section>
    <Section title="The Z-score: how many normal moves away">
      <p><b>Z-score = (this week − the 8-week average) ÷ the standard deviation.</b></p>
      <p>Example: commercials in a market have averaged 100,000 contracts net long over 8 weeks, and they usually sit about 10,000 contracts from that average. This week they are at 125,000. That is 25,000 above average, or 2.5 standard deviations: a <b>Z-score of +2.5</b>, past the +2.25 line.</p>
      <p>A positive Z means the group is more long (or less short) than usual; a negative Z means more short than usual.</p>
    </Section>
    <Section title="The bell curve: where extremes sit">
      <BellCurve />
      <p>When you collect lots of measurements, most of them land near the middle and fewer land far out, which draws a bell-shaped <b>distribution curve</b>. On a bell curve about <b>2 in 3</b> values sit within ±1 standard deviation, about <b>95 in 100</b> within ±2, and only about <b>1 in 80</b> lands beyond +2.25 (the same on the short side). That is why the site uses ±2.25 as its extreme: it marks a week that stands far outside the usual spread.</p>
      <More label="Real data and the 8-week window">
        <ul>
          <li>Positioning does not follow a perfect bell curve. Big shifts happen more often than the curve suggests, so treat the percentages as a guide to how rare a reading is, not an exact count.</li>
          <li>With only 8 weeks in the window, a Z-score cannot go much past ±2.65. A reading at ±2.25 means this week stands well apart from the other seven.</li>
          <li>The site's Z-score includes the current week in the average and uses the population standard deviation (dividing by 8, not 7).</li>
        </ul>
      </More>
    </Section>
    <Section title="Why the site uses them">
      <ul>
        <li><b>One scale for every market.</b> A Z of +2.5 means the same thing for crude, gold, the euro or corn, so markets can be compared side by side and ranked on the Watchlist.</li>
        <li><b>Each market judged by its own normal.</b> A quiet market and a busy one are both measured against how they usually behave.</li>
        <li><b>It keeps up.</b> The 8-week window moves every week, so the yardstick follows what the market is doing now rather than what it did years ago.</li>
        <li><b>It pairs with cycle rank.</b> The Z-score says how unusual this week is against the last two months; the cycle rank says where the position sits in the market's whole history. An extreme reading needs both.</li>
      </ul>
    </Section>
  </>,

  "market-overview": () => <>
    <Quick><b>How to read it:</b> pick a market and start with the <b>Current readout</b> (is there a reading, how extreme is it), then the chart to see how it got there, then curve and volatility to see how big moves are right now.</Quick>
    <Section title="What's on it">
      <ul>
        <li><b>Weekly net positioning</b> (the chart): each group's net position (longs minus shorts) week by week. The shaded band is the 8-week window the Z-score uses; the dashed lines mark the ±2.25 extremes.</li>
        <li><b>Current readout</b>: the latest week in words. The reading (Extreme long, Extreme short or none), the Z-score, whether commercials and large traders sit at opposite ends of their history (confluence), any open-interest alert, and the <b>Ultimate Oscillator · %R</b> (short-term overbought / oversold on daily prices).</li>
        <li id="curve"><b>Curve &amp; volatility</b>: the dial shows whether the nearest contract trades above the next (<b>backwardation</b>, usually tight supply) or below it (<b>contango</b>), against the market's own history. The volatility gauge compares the last 20 days of moves with the market's 5-year normal (Calm, Normal, Elevated, Extreme), and <b>typical day</b> is one day's usual move in percent and dollars per contract.</li>
      </ul>
    </Section>
  </>,

  positioning: () => <>
    <Quick><b>How to read it:</b> one card per trader group. Compare the groups: who moved most this week, and who is near the edge of their range.</Quick>
    <Section title="What's on it">
      <ul>
        <li><b>Group cards</b>: commercials, large traders and small traders, each with the weekly net change, Z-score, delta score (how big this week's change is against recent weeks) and where it sits in its observed range.</li>
        <li><b>Weekly position change</b>: each week's change as a bar. Tall bars are big shifts.</li>
        <li><b>Open interest profile</b>: total contracts open. Rising open interest means new money coming in; falling means positions closing.</li>
      </ul>
    </Section>
  </>,

  "weekly-readings": () => <>
    <Quick><b>How to read it:</b> the newest week is at the top. Read down to see how a reading built up week by week.</Quick>
    <Section title="What's on it">
      <p>One row per report with every number the Market overview uses: each group's net position and change, the Z-score, cycle ranks, open interest, and the reading for that week. Each table can be downloaded.</p>
    </Section>
  </>,

  watchlist: () => <>
    <Quick><b>How to read it:</b> every core market in one table. Start with the rows marked <b>Extreme</b>, then <b>Watch</b>. Read across: how extreme (Z, cycle), which way this week went (Wk change), and where price sits short term (UO · %R).</Quick>
    <Section id="reading" title="The columns">
      <ul>
        <li><b>State</b>: <b>Extreme long / short</b> when the 8-week reading is met (with the site default: commercials' Z-score past ±2.25 over 8 weeks, commercials at 75% or more of their history and large traders at 25% or less, or the reverse). <b>Watch · Commercials buying / selling</b> when there is no extreme but the week's change was unusually large. <b>OI alert</b> when open interest jumped.</li>
        <li><b>Extremity</b> (0–100): how far past the rule a reading is. Not a probability.</li>
        <li><b>Z-score</b>: how far this week's net position is from its 8-week average, in standard deviations.</li>
        <li><b>Cycle</b> and <b>CH / LT / ST cycle</b>: where commercials, large traders and small traders sit between the lowest (0%) and highest (100%) reading in the market's history.</li>
        <li><b>UO · %R</b>: the Ultimate Oscillator and Williams %R on daily prices. Highlighted when the oscillator is on the pullback side of an active reading: oversold (under 30) for a long, overbought (over 70) for a short.</li>
        <li><b>Wk change</b>, <b>OI move</b>, <b>Report</b>: this week's change in net position, the change in open interest, and the report date.</li>
      </ul>
    </Section>
    <Section title="Filters and the record">
      <p>Filter by group, by state (Active shows only markets with something going on), by direction and by type, and sort by any column. The <b>8-week reading: the record</b> card logs every reading since Oct 20, 2026 with how the next week went, so the tally builds as the weeks go by.</p>
    </Section>
  </>,

  "sector-positioning": () => <>
    <Quick><b>How to read it:</b> the same readings as the Watchlist, grouped by sector. Look at the counts at the top, then any sector where several markets lean the same way.</Quick>
    <Section title="What's on it">
      <ul>
        <li><b>Counts</b>: how many markets show Extreme long and Extreme short, and how many were evaluated.</li>
        <li><b>Sector tables</b>: equity indices, energy, metals, Treasuries, currencies, crypto, grains, livestock and softs, each with its markets, extreme readings first, then large weekly changes.</li>
        <li><b>Extreme readings only</b>: a switch that hides the quiet markets.</li>
      </ul>
      <p>When several markets in one sector lean the same way, the positioning is broad rather than one market's story.</p>
    </Section>
  </>,

  spdr: () => <>
    <Quick><b>How to read it:</b> each row is a stock sector against the S&amp;P 500. Green is beating SPY, red is lagging, amber σ means the move is unusual for that sector. Underneath, see who is positioned in the futures tied to it.</Quick>
    <Section title="What's on it">
      <ul>
        <li><b>Performance</b>: each Select Sector SPDR ETF's move relative to SPY over 1 day, 1 week, 1 month, 3 months and 1 year.</li>
        <li><b>σ</b>: how unusual the 3-month and 1-year moves are against the sector's last three years (2σ or more is amber).</li>
        <li><b>Momentum</b>: the last 4 weeks against that norm (▲ rising, ► flat, ▼ falling).</li>
        <li><b>Underneath</b>: the futures linked to each sector (crude and gasoline for energy, copper for materials and industrials, power and gas for utilities, Nasdaq-100 for tech) and where funds sit in their 3-year range. The top or bottom 10% is labeled <b>crowded</b>.</li>
        <li><b>Watch notes</b>: links between a sector and its futures worth keeping an eye on, such as energy stocks and crude.</li>
        <li><b>Yields</b>: 2-year and 10-year Treasury yields and their 13-week change.</li>
      </ul>
    </Section>
  </>,

  "invisible-hand": () => <>
    <Quick><b>How to read it:</b> the big picture for the week. Read the theme cards for the backdrop, the calendar for what is coming, and the expected range for how big an ES or NQ day usually is right now.</Quick>
    <Section title="What's on it">
      <ul>
        <li><b>Theme cards</b>: credit, rates, power and gas, volatility, and the AI and power trade, each with its current readings and, where one applies, a short label such as "steepener".</li>
        <li><b>Who is positioned</b>: the trader groups in the related futures, their position as a share of open interest, their 3-year percentile and 4-week change. Rows with fewer than 20 traders, or where four traders hold more than half of one side, are withheld.</li>
        <li><b>Expected daily range</b>: the typical and the wide (1 day in 5) ES and NQ day for the current volatility state, in percent and points, next to what the last 20 sessions did.</li>
        <li><b>Next two weeks</b>: FOMC, CPI, payrolls and expirations on the calendar. Solid tags are coming up; outlined tags fell inside the week the latest report covers.</li>
        <li><b>Crowded watch</b>: markets where large speculators sit in the top or bottom 10% of their 3-year range.</li>
      </ul>
    </Section>
  </>,

  settings: () => <>
    <Section title="One set of settings, every page">
      <p>The Settings bar sits in the Workspace and at the top of Sector positioning and the Watchlist, and one set drives all three. It shows the active rule in short, for example <b>Both (AND gate) · Commercial Hedgers · 8-week Z · Z ≥ 2.25σ · cycle 75%</b>. Click it to open the controls.</p>
      <p><b>Your settings are saved in your browser.</b> If they differ from the site default, an amber note says so, with <b>Use the site default</b> to switch back. Two people on different settings see different readings.</p>
    </Section>
    <Section title="The controls">
      <ul>
        <li><b>Participant</b>: the group whose Z-score sets the reading (commercial hedgers by default).</li>
        <li><b>Reading mode</b>: <b>Z-Score Only</b> uses the Z-score alone. <b>COT Confluence</b> uses cycle ranks alone (commercials and large traders at opposite ends of their history, small traders as optional confirmation). <b>Both (AND gate)</b>, the default, needs both in the same week.</li>
        <li><b>Z calculation</b>: <b>Standard</b> (the default) uses the raw net position. <b>OI normalization</b> divides each week's net position by that week's open interest first.</li>
        <li><b>Lookback</b>: weeks the Z-score compares against (8). <b>Z threshold</b>: standard deviations that count as extreme (2.25). <b>Confluence cycle</b>: how close to the ends of their history the groups must be (75%).</li>
        <li><b>OI move alert</b>: the open-interest change that raises an OI alert.</li>
      </ul>
      <More label="Switches and display options">
        <ul>
          <li><b>Z-score detection</b> on or off; <b>small trader confirmation</b> for confluence; <b>large position change</b> turns the Watch tags on or off.</li>
          <li>In the Workspace: <b>extreme labels</b> and the chart label, the highlight style and the table size. These change what you see, not the calculations.</li>
          <li>Until Oct 27, 2026 the default was OI-normalized Z over 16 weeks, Z 2.0, cycle 65%. Visitors from before then were moved to the new default once and offered <b>Restore mine</b>.</li>
        </ul>
      </More>
    </Section>
  </>,

  "using-it": () => <>
    <Section title="Fitting it around a short-term strategy">
      <p>The site does not give entries or exits. It gives the weekly backdrop that any short-term approach, from scalping to swing trading, can be read against. A simple routine:</p>
      <ol className="hiw-steps">
        <li><b>After Friday's report</b>, open the <b>Watchlist</b>: note the markets you trade that show an Extreme reading or a Watch tag, and which way.</li>
        <li><b>Know which side the hedgers are on.</b> A reading shows which way commercials have pushed hard over the last two months. Your own setup decides when and where; the reading tells you whether that trade sits with them or with the crowd on the other side.</li>
        <li><b>Check how big moves are.</b> The volatility gauge and typical day on <b>Market overview</b>, and the expected ES / NQ range on <b>The Invisible Hand</b>, show what a normal day looks like right now, which helps size positions and set stops and targets that fit the market.</li>
        <li><b>Check the calendar.</b> The Invisible Hand lists FOMC, CPI, payrolls and expirations for the next two weeks.</li>
        <li><b>Check short-term stretch.</b> The UO · %R column shows whether price is already overbought or oversold on the daily chart.</li>
        <li><b>Trading stocks?</b> The <b>SPDR sectors</b> page shows which sectors lead or lag the S&amp;P 500 and who is positioned in the futures behind them.</li>
        <li><b>Re-check each Friday.</b> Positions change once a week; prices and volatility update every day.</li>
      </ol>
      <p>In short: use your own strategy for timing, and use this site to know the backdrop it is trading into: who is positioned where, how stretched that is, how big moves are, and what is on the calendar. <b>Nothing on this site is investment advice.</b></p>
    </Section>
  </>,

  data: () => <>
    <Section title="Sources and update times">
      <ul>
        <li><b>COT positioning</b>: CFTC Commitments of Traders (Legacy, Disaggregated, Traders in Financial Futures), picked up minutes after each Friday 3:30 p.m. ET release.</li>
        <li><b>Futures prices</b> (oscillators, curves, volatility, ES/NQ ranges, the reading record): exchange settlements, updated each weekday before the open (6–9 a.m. ET) for the previous session.</li>
        <li><b>Sector ETF prices and SPY volatility</b>: end of day, updated on weekday evenings after the 4 p.m. close.</li>
        <li><b>Treasury yields</b>: the U.S. Treasury's daily par yield curve.</li>
        <li><b>Nothing is real-time.</b> Every page shows the dates its numbers are from. The SPDR page warns when prices stop updating, and Market overview flags a CFTC report that may be out of date.</li>
        <li><b>Accuracy</b>: the numbers are checked against their sources: positions against the CFTC's published rows, ETF returns against Yahoo, yields against the Treasury.</li>
      </ul>
      <More label="Twice-weekly reports">
        <p>The CFTC plans to publish twice a week from late 2026 (positions as of Monday on Wednesday, as of Wednesday on Friday). The site will keep one row per week, the Friday release, so every lookback still counts weeks. The Monday report will be shown separately as a mid-week update once the CFTC confirms the format.</p>
      </More>
    </Section>
    <Section id="markets" title="Which markets">
      <p><b>Core ({CORE_MARKETS.filter(m => m.code).length})</b>: the markets most traders watch ({CORE_GROUPS.map(g => g.label).join(", ")}), covered by the Watchlist and Sector positioning. <b>Specialty ({SPECIALTY_MARKETS.length})</b>: markets tied to the site's analysis, such as PJM, ERCOT and CAISO power, SOFR and the Ultra Treasuries. <b>Advanced</b>: every market the CFTC publishes (about 370), at the bottom of the market picker; not curated.</p>
      <More label="Quality labels">
        <p>The CFTC only publishes a market when at least 20 large traders hold reportable positions. <b>Thin</b> ({CORE_MARKETS.filter(m => m.quality === "thin").map(m => m.symbol).join(", ")}) means few reporting traders or a short history: read with care. COMEX aluminum rarely meets the 20-trader rule, and the dollar Nikkei is no longer published, so the site shows the yen Nikkei instead.</p>
      </More>
      <More label="Consolidated lines">
        <p id="consolidated">For the S&amp;P 500, Nasdaq-100 and Dow, the CFTC publishes each contract (E-mini, micro) <b>and</b> a <b>consolidated</b> line that adds them, counting a micro as one-tenth. The site uses the consolidated line, the whole market's positioning. It starts in June 2010; the single contracts are still in Advanced.</p>
      </More>
      <More label="History notes">
        <ul id="history">
          <li>Markets are tracked by their CFTC <b>contract code</b>, so history continues when a contract is renamed (many were in February 2022).</li>
          <li>Corn, soybeans and wheat changed codes in January 1998; the two codes are joined, so history runs back to 1986.</li>
          <li>Some codes carry an unrelated earlier listing that is dropped: the euro starts in January 1999 (before that, the European Currency Unit), the Russell 2000 in August 2017 (its return to CME), the New Zealand dollar in August 2004.</li>
          <li>Lumber is the contract launched in August 2022; the old one is a different size and is not joined.</li>
        </ul>
      </More>
    </Section>
    <Section id="limits" title="What it can't tell you">
      <p>Positioning describes <b>who is crowded where</b>, not when prices turn. Extremes can last for weeks or months while prices keep going. Use it as context alongside price. <b>Nothing on this site is investment advice.</b></p>
    </Section>
  </>,
};
