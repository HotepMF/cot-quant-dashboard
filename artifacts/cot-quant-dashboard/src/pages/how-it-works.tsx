import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, ArrowRight, Moon, Sun } from "lucide-react";
import { COT8_RECORD, CORE_GROUPS, CORE_MARKETS, SPECIALTY_MARKETS } from "@workspace/cot-engine";
import { useTheme } from "@/components/scanner/scanner-shell";
import { SiteBrand, SiteMobileNav, SiteNav } from "@/components/site-nav";

/** The sub-pages, in reading order. Each has its own address: /how-it-works/<slug>. */
const PAGES = [
  { slug: "start", label: "Start here" },
  { slug: "cot-report", label: "The COT report" },
  { slug: "reading", label: "Reading the numbers" },
  { slug: "settings", label: "Settings" },
  { slug: "eight-week", label: "The 8-week reading" },
  { slug: "pages", label: "The other pages" },
  { slug: "data", label: "Data, accuracy & limits" },
] as const;
type Slug = typeof PAGES[number]["slug"];

/** Old single-page anchors (/how-it-works#model) and where they live now. */
const OLD_ANCHORS: Record<string, string> = {
  cot: "cot-report", markets: "cot-report#markets", consolidated: "cot-report#consolidated", history: "cot-report#history",
  reading: "reading", model: "eight-week", settings: "settings",
  sectors: "pages#sectors", "invisible-hand": "pages#invisible-hand", curve: "pages#curve",
  updates: "data", limits: "data#limits",
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
const to = (slug: Slug, hash = "") => `/how-it-works/${slug}${hash ? `#${hash}` : ""}`;

export function HowItWorksPage() {
  const [isDark, setIsDark] = useTheme();
  const params = useParams<{ page?: string }>();
  const [, navigate] = useLocation();
  const current = PAGES.find(p => p.slug === params.page) ?? PAGES[0];
  const index = PAGES.indexOf(current);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    // An old link to the single long page: send it to the sub-page that now holds that section.
    if (!params.page && hash && OLD_ANCHORS[hash]) { navigate(`/how-it-works/${OLD_ANCHORS[hash]}`, { replace: true }); return; }
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
        {PAGES.map((p, i) => <Link key={p.slug} href={to(p.slug)} className="ms-chip" aria-pressed={p.slug === current.slug} aria-current={p.slug === current.slug ? "page" : undefined}
          data-testid={`hiw-tab-${p.slug}`}>{i + 1}. {p.label}</Link>)}
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

const r = COT8_RECORD;

const CONTENT: Record<Slug, () => ReactNode> = {
  start: () => <>
    <Section title="What this site is">
      <p>A <b>data overlay</b> for futures traders: where each group of traders is positioned, how unusual that is, and what happened in the past when it looked like this. It is not a trading model and does not tell you what to do. The data is the point; colors only show which way a number leans.</p>
      <p>Three things to know first:</p>
      <ul>
        <li><b>It is weekly data.</b> Positions are reported once a week, so the site describes the backdrop for the week, not the next hour.</li>
        <li><b>Readings are mechanical.</b> An "Extreme long" is a rule being met by the numbers, not a call.</li>
        <li><b>Every record is shown with its count.</b> Where something has a history, you see how many cases it rests on, and the live record is kept automatically.</li>
      </ul>
    </Section>
    <Section title="The pages">
      <ul>
        <li><Link href="/"><b>Market detail</b></Link>: one market in depth. Positioning chart, the current reading, curve and volatility, the oscillators, and the weekly ledger.</li>
        <li><Link href="/signal-watchlist"><b>Watchlist</b></Link>: every core market in one table, ranked, with the 8-week reading's live record.</li>
        <li><Link href="/sector-signals"><b>Sector positioning</b></Link>: the same table grouped by sector.</li>
        <li><Link href="/sectors"><b>SPDR sectors</b></Link>: the 11 stock-market sectors against the S&amp;P 500, with the futures positioning under each.</li>
        <li><Link href="/invisible-hand"><b>The Invisible Hand</b></Link>: the weekly macro backdrop (credit, rates, power, volatility) and who is positioned in each.</li>
      </ul>
      <p>New to positioning data? Read <Link href={to("cot-report")}>The COT report</Link> and <Link href={to("reading")}>Reading the numbers</Link> next.</p>
    </Section>
  </>,

  "cot-report": () => <>
    <Section title="What it is">
      <p>Every week the CFTC (the U.S. futures regulator) publishes the <b>Commitments of Traders</b> report: who holds positions in each futures market. Positions are as of <b>Tuesday</b> and published <b>Friday at 3:30 p.m. ET</b>. The site picks up each release automatically within minutes.</p>
      <p>The Legacy report splits traders into three groups:</p>
      <ul>
        <li><b>Commercial hedgers</b>: producers and users of the underlying, such as oil companies, farmers, refiners and food makers, hedging their business.</li>
        <li><b>Large traders</b> (non-commercials): funds and other speculators trading for profit, many of them trend followers.</li>
        <li><b>Small traders</b>: positions too small to be reported individually.</li>
      </ul>
      <p>Commercials and large traders usually sit on opposite sides: when funds chase a trend, hedgers take the other side.</p>
      <More label="Twice-weekly reports">
        <p>The CFTC plans to publish twice a week from late 2026 (positions as of Monday on Wednesday, as of Wednesday on Friday). The site will keep one row per week, the Friday release, so every lookback still counts weeks. The Monday report will be shown separately as a mid-week update once the CFTC confirms the format.</p>
      </More>
    </Section>
    <Section id="markets" title="Which markets">
      <p><b>Core ({CORE_MARKETS.filter(m => m.code).length})</b>: the markets most traders watch ({CORE_GROUPS.map(g => g.label).join(", ")}). The Watchlist and Sector positioning cover these.</p>
      <p><b>Specialty ({SPECIALTY_MARKETS.length})</b>: markets tied to the site's analysis, such as PJM, ERCOT and CAISO power, SOFR and the Ultra Treasuries, each with a note on why. <b>Advanced</b>: every market the CFTC publishes (about 370), at the bottom of the market picker; not curated.</p>
      <More label="Quality labels">
        <p>The CFTC only publishes a market when at least 20 large traders hold reportable positions. <b>Thin</b> ({CORE_MARKETS.filter(m => m.quality === "thin").map(m => m.symbol).join(", ")}) means few reporting traders or a short history: read with care. <b>Not published</b>: COMEX aluminum rarely meets the 20-trader rule, and the dollar Nikkei is no longer published, so the site shows the yen Nikkei instead.</p>
      </More>
    </Section>
    <Section id="consolidated" title="Consolidated lines and history">
      <p>For the S&amp;P 500, Nasdaq-100 and Dow, the CFTC publishes each contract (E-mini, micro) <b>and</b> a <b>consolidated</b> line that adds them, counting a micro as one-tenth. The site uses the consolidated line, the whole market's positioning. It starts in June 2010; the single contracts are still in Advanced.</p>
      <More label="History notes">
        <ul id="history">
          <li>Markets are tracked by their CFTC <b>contract code</b>, so history continues when a contract is renamed (many were in February 2022).</li>
          <li>Corn, soybeans and wheat changed codes in January 1998; the two codes are joined, so history runs back to 1986.</li>
          <li>Some codes carry an unrelated earlier listing that is dropped: the euro starts in January 1999 (before that, the European Currency Unit), the Russell 2000 in August 2017 (its return to CME), the New Zealand dollar in August 2004.</li>
          <li>Lumber is the contract launched in August 2022; the old one is a different size and is not joined.</li>
        </ul>
      </More>
    </Section>
  </>,

  reading: () => <>
    <Section title="The core numbers">
      <ul>
        <li><b>Net position</b>: a group's longs minus its shorts.</li>
        <li><b>Z-score</b>: how far this week's net position sits from its average over the lookback (8 weeks by default), in standard deviations. The site counts <b>±2.25</b> as an extreme.</li>
        <li><b>Cycle rank</b>: where the net position sits between the lowest (0%) and highest (100%) reading in the market's full history. The table shows it for commercials, large traders and small traders (CH / LT / ST).</li>
        <li><b>Confluence</b>: commercials and large traders at opposite ends of their cycle ranks at the same time.</li>
      </ul>
    </Section>
    <Section title="States in the tables">
      <ul>
        <li><b>Extreme long / Extreme short</b>: the rule in Settings is met. With the site default: Commercials' Z-score is past ±2.25 <i>and</i> their cycle rank is at 75% or more (25% or less for short) while large traders sit at the other end.</li>
        <li><b>Watch · Commercials buying / selling</b>: no extreme, but the group's net position changed unusually much in one week (more than half the Z threshold, in standard deviations of the lookback). It describes the week; it has not been tested on its own.</li>
        <li><b>OI alert</b>: open interest changed by at least the alert percentage in Settings.</li>
        <li><b>Extremity</b> (0–100): how far past the rule a reading is. It is not a probability.</li>
        <li><b>UO · %R</b>: Larry Williams' Ultimate Oscillator (7, 14, 28 days) and %R (14 days) from the last settled daily close. Highlighted when the oscillator is on the pullback side of an active reading (see <Link href={to("eight-week")}>The 8-week reading</Link>).</li>
      </ul>
    </Section>
    <Section title="What the colors mean">
      <p><b>Green</b> leans up and <b>red</b> leans down, read the way the site reads each group: commercials in their own direction, speculators against theirs. So "Commercials buying" and "Large specs selling" are both green. <b>Amber</b> marks something unusual or a setting that differs from the site default. Colors describe the data; they are not instructions.</p>
    </Section>
  </>,

  settings: () => <>
    <Section title="One set of settings, every page">
      <p>The Settings bar sits at the top of Market detail, the Watchlist and Sector positioning, and one set drives all three. It shows the active rule in short, for example <b>Both (AND gate) · Commercial Hedgers · 8-week Z · Z ≥ 2.25σ · cycle 75%</b>. Click it to open the controls.</p>
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
          <li>On Market detail: <b>extreme labels</b> and the chart label, the highlight style and the table size. These change what you see, not the calculations.</li>
          <li>Visitors who used the site before Oct 27, 2026 were moved to the new default once and offered <b>Restore mine</b>.</li>
        </ul>
      </More>
    </Section>
  </>,

  "eight-week": () => <>
    <Section title="Why 8 weeks is the default">
      <p>Since Oct 27, 2026 the site's default is the <b>8-week reading</b>: commercials' net position at an extreme for the last two months (Z ≥ 2.25 over 8 weeks), while they sit near one end of their full history (75%) and large speculators sit at the other. It follows the rules of the TradingView indicator "Commitment of Traders: Total Enhanced + OI".</p>
      <p>We chose it by measuring 400 settings (lookbacks 8–64 weeks, Z 1.5–2.5, cycle thresholds, raw and OI-normalized) on 43 core markets, 2002–2026, by what price did in the week after each report.</p>
    </Section>
    <Section title="What the history shows">
      <table className="sx-table hiw-table"><tbody>
        <tr><td>Cases</td><td className="num"><b>{r.all.cases}</b> market-weeks, {r.period}</td></tr>
        <tr><td>Next week went the commercials' way</td><td className="num"><b>{r.all.wentItsWay}%</b> (normal 50%)</td></tr>
        <tr><td>Average move</td><td className="num"><b>+{r.all.move.toFixed(2)}</b> of a normal week (about +0.4% for the S&amp;P 500, +0.9% for crude, before costs)</td></tr>
        <tr><td>With the Ultimate Oscillator on the pullback side</td><td className="num"><b>{r.pullback.wentItsWay}%</b>, +{r.pullback.move.toFixed(2)} ({r.pullback.cases} cases)</td></tr>
      </tbody></table>
      <ul>
        <li>It held in both halves of the history (2002–2013 and 2014–2026), in 26 of 41 markets, and the neighbouring settings agreed: 29 showed a clear lean the same way, none a clear lean the other way.</li>
        <li><b>It is a one-week effect.</b> Most of it is gone by 4 weeks and none is left by 13.</li>
        <li><b>It is rare</b>: about two readings a quarter across all markets.</li>
        <li><b>It is not proven.</b> After allowing for the 400 settings we tried, the chance that the best one looks this good by luck is about 10%; the usual bar is 5%. The pullback combination rests on only {r.pullback.cases} cases.</li>
      </ul>
    </Section>
    <Section title="The live record">
      <p>Every reading since the Oct 20, 2026 report is logged automatically with how the next week went (release Friday's settled close to the next), and the running tally sits on the <Link href="/signal-watchlist">Watchlist</Link> next to the history. That record is what will confirm or overturn these numbers.</p>
      <More label="The previous default">
        <p>Until Oct 27, 2026 the default was OI-normalized Z over 16 weeks, Z 2.0, cycle 65%. In the same test it showed no lean in the week after the report. It is still available in Settings.</p>
      </More>
    </Section>
  </>,

  pages: () => <>
    <Section id="sectors" title="SPDR sectors">
      <p>The 11 Select Sector SPDR ETFs against the S&amp;P 500 (SPY), with the futures positioning linked to each underneath.</p>
      <ul>
        <li><b>Performance</b>: each sector's move relative to SPY over 1 day, 1 week, 1 month, 3 months and 1 year. <b>σ</b>: how unusual the 3-month and 1-year moves are against the sector's last three years (2σ or more is amber).</li>
        <li><b>Momentum</b>: the last 4 weeks against that norm (▲ rising, ► flat, ▼ falling). Sector trends showed no reliable tendency to continue or reverse in our tests.</li>
        <li><b>Positioning</b>: where funds sit in their 3-year range (managed money for commodities, leveraged funds for financial futures). The top or bottom 10% is labeled crowded.</li>
      </ul>
      <More label="Watch notes">
        <p>Watch notes report co-movement found between the previous default COT filter (16-week, OI-normalized) on a sector's futures and that sector against SPY, 2002–2026. Energy is the one consistent link (XLE with crude, gasoline and natural gas). Utilities moved opposite to a commercial extreme long in natural gas. Samples are small (about 30 cases per market) and many links were checked, so they are things to watch, not rules.</p>
      </More>
    </Section>
    <Section id="invisible-hand" title="The Invisible Hand">
      <p>The weekly macro backdrop and who is positioned in it.</p>
      <ul>
        <li><b>Theme cards</b>: credit, rates, power and gas, volatility, and the AI and power trade. A card shows a label (such as "steepener") only where that label passed our accuracy and stability tests; otherwise just the readings.</li>
        <li><b>Who is positioned</b>: the trader groups in the related futures, as a share of open interest, their 3-year percentile and 4-week change. Rows with fewer than 20 traders, or where four traders hold more than half of one side, are withheld.</li>
        <li><b>Expected daily range</b>: the typical and the wide (1 day in 5) ES and NQ day in the current volatility state, from 2002–2026 data. Ranges are tested; direction is not.</li>
        <li><b>Next two weeks</b>: FOMC, CPI, payrolls and expirations. FOMC and payroll days have run about 20% wider than other days in the same volatility state; CPI, expirations and the roll showed no reliable change.</li>
        <li><b>Crowded watch</b>: markets where large speculators are in the top or bottom 10% of their 3-year range. Crowded readings were not followed by bigger moves.</li>
      </ul>
    </Section>
    <Section id="curve" title="Curve and volatility (Market detail)">
      <ul>
        <li><b>Backwardation</b>: the nearest contract above the next one, usually tight supply. <b>Contango</b>: the reverse, normal when supply is ample. The gauge places today's carry in the market's own 2002–2024 history (VIX 2004–2026); the colored ends are its deepest 20%.</li>
        <li><b>Volatility</b>: the front contract's last 20 daily moves against its 5-year normal. Calm under 0.75×, Normal to 1.25×, Elevated to 1.75×, Extreme above (round bands, not tested). "Typical day" is one day's usual move at current volatility.</li>
        <li><b>What we found</b>: in commodities, volatility over the next 4 weeks ran about 19% higher in deep backwardation and 13% higher in deep contango than with a flat curve (2002–2024, 23 markets), in line with published research. Index, rate, currency and crypto curves showed no effect. As a filter on the COT reading the curve added nothing; it relates to risk, not direction.</li>
      </ul>
      <More label="Method notes">
        <p>Carry per year = ln(front ÷ second) divided by the years between the delivery months. Historical ranges come from research data that does not always use the front two contracts, so they are close, not exact. Prices are settlements (Yahoo; VIX from Cboe). The site saves every day's curve, so the ranges can move to its own data in time.</p>
      </More>
    </Section>
  </>,

  data: () => <>
    <Section title="Sources and update times">
      <ul>
        <li><b>COT positioning</b>: CFTC Commitments of Traders (Legacy, Disaggregated, Traders in Financial Futures), picked up minutes after each Friday 3:30 p.m. ET release.</li>
        <li><b>Futures prices</b> (oscillators, curves, volatility, ES/NQ ranges, the reading record): exchange settlements, updated each weekday before the open (6–9 a.m. ET) for the previous session.</li>
        <li><b>Sector ETF prices and SPY volatility</b>: end of day, updated on weekday evenings after the 4 p.m. close.</li>
        <li><b>Treasury yields</b>: the U.S. Treasury's daily par yield curve.</li>
        <li><b>Nothing is real-time.</b> Every page shows the dates its numbers are from. The SPDR page warns when prices stop updating, and Market detail flags a CFTC report that may be out of date.</li>
      </ul>
    </Section>
    <Section title="How we check it">
      <p>The site is audited against its sources with code written separately from the site's own: every core market's positions against the CFTC's published rows, every Watchlist column against an independent recalculation, ETF returns against Yahoo, yields against the Treasury, and the oscillators against settled prices. Last full audit: <b>Oct 28, 2026</b>; COT data and the Watchlist matched exactly.</p>
    </Section>
    <Section id="limits" title="What we tested that did not work">
      <p>A record only means something next to what failed. Each of these was tested on 2002–2026 data with the rules written down before the run:</p>
      <table className="sx-table hiw-table"><tbody>
        <tr><td>Positioning extremes and the size of the next move</td><td>Not followed by bigger or sharper moves; extremes can last for months.</td></tr>
        <tr><td>Day-by-day drift during an extreme</td><td>Nothing at any of 400 settings.</td></tr>
        <tr><td>Sector-wide positioning and sector ETFs</td><td>Nothing (0 of 108 tests).</td></tr>
        <tr><td>Related markets' positioning (copper, VIX and others) for ES and NQ</td><td>Nothing.</td></tr>
        <tr><td>Seasonal windows, with or without the COT reading</td><td>Did not follow through.</td></tr>
        <tr><td>The futures curve as a filter on the reading</td><td>No improvement.</td></tr>
        <tr><td>Trend tools alongside the reading</td><td>Worse, not better: the reading worked best on pullbacks.</td></tr>
        <tr><td>Weekly breaks, simultaneous sector breaks, timeframe continuity (TheStrat)</td><td>No continuation on their own. With the reading, the rest of the sector breaking first was a lead (59% of 70 cases) that did not pass the luck check.</td></tr>
      </tbody></table>
      <p>Positioning describes <b>who is crowded where</b>, not when prices turn. Use it as context alongside price. <b>Nothing on this site is investment advice.</b></p>
    </Section>
  </>,
};
