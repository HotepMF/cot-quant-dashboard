import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Moon, Sun } from "lucide-react";
import { CORE_GROUPS, CORE_MARKETS, SPECIALTY_MARKETS } from "@workspace/cot-engine";
import { useTheme } from "@/components/scanner/scanner-shell";
import { SiteBrand, SiteMobileNav, SiteNav } from "@/components/site-nav";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="card hiw-section" data-testid={`section-${id}`}>
    <div className="card-head"><h2 className="panel-title">{title}</h2></div>
    <div className="card-body hiw-body">{children}</div>
  </section>;
}

export function HowItWorksPage() {
  const [isDark, setIsDark] = useTheme();
  useEffect(() => {
    document.title = "How it works · COT Quant";
    // Links like /how-it-works#model open at that section; otherwise start at the top.
    const target = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    if (target) target.scrollIntoView({ block: "start" }); else window.scrollTo(0, 0);
  }, []);
  const thin = CORE_MARKETS.filter(m => m.quality === "thin").map(m => m.symbol).join(", ");

  return <div className="shell">
    <aside className="sidebar">
      <SiteBrand />
      <SiteNav />
    </aside>
    <main className="main">
      <header className="topline">
        <div>
          <div className="eyebrow" style={{ marginBottom: 9 }}>Reference</div>
          <h1 className="page-title display">How it works</h1>
          <p className="subtle scan-lede">What the COT report is, how this site reads it, which markets it shows, how the SPDR sectors and Invisible Hand pages work, when data updates, and what it can't tell you.</p>
        </div>
        <div className="toolbar print-hidden">
          <button className="icon-btn" aria-label="Toggle dark mode" title="Toggle theme" onClick={() => setIsDark(v => !v)}>{isDark ? <Sun size={15} /> : <Moon size={15} />}</button>
        </div>
      </header>

      <nav className="hiw-toc print-hidden" aria-label="On this page">
        {[["cot", "The COT report"], ["reading", "Reading the site"], ["model", "The default model"], ["settings", "Settings"], ["markets", "Which markets"], ["sectors", "SPDR sectors"], ["invisible-hand", "The Invisible Hand"], ["curve", "Futures curve"], ["updates", "Data & updates"], ["consolidated", "Consolidated lines"], ["history", "History notes"], ["limits", "What it can't tell you"]].map(([id, label]) =>
          <a key={id} href={`#${id}`} className="ms-chip" onClick={e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{label}</a>)}
      </nav>

      <div className="hiw-grid">
        <Section id="cot" title="The COT report">
          <p>Every week the CFTC (the U.S. futures regulator) publishes the <b>Commitments of Traders</b> report: who holds positions in each futures market. Positions are as of <b>Tuesday</b> and published <b>Friday at 3:30 p.m. ET</b>; this site updates automatically after each release.</p>
          <p>The Legacy report this site uses splits traders into three groups:</p>
          <ul>
            <li><b>Commercial hedgers</b>: producers and users of the underlying, such as oil companies, farmers, refiners and food makers, hedging their business. Their reason for trading is fundamentally different from everyone else's.</li>
            <li><b>Large traders</b> (non-commercials): funds and other speculators trading for profit, many of them trend followers.</li>
            <li><b>Small traders</b>: positions too small to be reported individually.</li>
          </ul>
          <p>Commercials and large traders usually sit on opposite sides: when funds chase a trend, hedgers take the other side.</p>
        </Section>

        <Section id="reading" title="Reading the site">
          <ul>
            <li><b>Net position</b>: longs minus shorts for each group.</li>
            <li><b>Z-score</b>: how far today's net position sits from its average over the lookback (16 weeks by default, using net as a share of open interest; see The default model), in standard deviations. ±2 marks an extreme.</li>
            <li><b>Cycle rank</b>: where today's net position sits between the lowest (0%) and highest (100%) reading in the market's full history.</li>
            <li><b>Confluence</b>: commercials and large traders at opposite extremes of their cycle ranks at the same time.</li>
          </ul>
          <p>Signals and setups are <b>mechanical rule states</b>, not recommendations.</p>
        </Section>

        <Section id="model" title="The default model">
          <p>Market detail, Sector signals and Signal watchlist use the same rules as the TradingView indicator "Commitment of Traders: Total Enhanced + OI". Since Oct 2026 the site default is <b>Both (AND gate)</b> on <b>Commercial Hedgers</b>, with <b>OI-normalized Z</b> (each week's net position divided by that week's open interest) over <b>16 weeks</b>, a Z threshold of <b>2.0</b> and a confluence cycle threshold of <b>65%</b>. You can change any setting; the site remembers yours.</p>
          <p><b>Why these settings.</b> We tested 1,067 combinations (lookbacks 16, 32, 48 and 64; Z 1.5–2.5; confluence 50–100; standard and OI-normalized) on 42 core markets, 2002–2026, choosing on 2002–2013 and checking on 2014–2026:</p>
          <ul>
            <li>No setting passed both periods, and the grid as a whole did not beat random timing. The previous default (COT Confluence, 63 weeks) showed nothing.</li>
            <li>One area led in every test: the AND gate with OI-normalized Z over 16 weeks. Used as a filter for weekly bar-pattern entries (2-2, 3-2, failed 2, 3), it averaged +0.14R per trade with a 2σ target in both 2002–2013 and 2014–2026, before costs, over about 450 trades.</li>
            <li>Longer lookbacks (32, 48, 64) did not show it, and keeping the filter open after the signal ended diluted it.</li>
          </ul>
          <p>That makes it our <b>best-tested setting, labeled Speculation</b>: it was found by searching, so it is not validated. It is being forward-tested in a public demo account on <Link href="/invisible-hand">The Invisible Hand</Link>, with frozen rules and every loss shown. Positioning still does not time moves by itself; read setups as context, not instructions.</p>
        </Section>

        <Section id="settings" title="Settings">
          <p>The settings bar sits under the market picker on market detail and at the top of Sector signals and Signal watchlist. One set of settings drives all three pages, and the site remembers yours. Click the bar to open it; "site default" or "custom" shows which you are using.</p>
          <ul>
            <li><b>Participant</b>: the group whose Z-score gates the signal. Commercial hedgers are followed (an extreme long is bullish); large and small traders are faded (an extreme long is bearish).</li>
            <li><b>Signal mode</b>: <b>Z-Score Only</b> fires when the participant's net position is an extreme for the lookback. <b>COT Confluence</b> fires when commercials and large traders sit at opposite ends of their full history (cycle rank), with small traders as optional confirmation. <b>Both (AND gate)</b> needs the two to agree in the same week. It is the strictest mode and the site default.</li>
            <li><b>Z calculation</b>: <b>Standard</b> uses the raw net position. <b>OI normalization</b> divides each week's net position by that week's open interest first, so a market that has grown or shrunk is compared fairly. A week with missing open interest leaves no Z until the window is complete again.</li>
            <li><b>Lookback</b>: how many weeks the Z-score compares against (16 by default).</li>
            <li><b>Z threshold</b>: how many standard deviations count as an extreme (2.0 by default).</li>
            <li><b>Confluence cycle</b>: how far toward the ends of their history commercials and large traders must be (65% means commercials at or above 65% and large traders at or below 35%, or the reverse).</li>
            <li><b>OI move alert</b>: flags a week when open interest changes by at least this percentage.</li>
            <li><b>Switches</b>: Z-score detection on or off; small trader confirmation for confluence; large position change flags a weekly change larger than half the Z threshold in standard deviations.</li>
            <li><b>Market detail display</b>: buy / sell labels and the chart label, the chart highlight style (shapes, background or both), and the table text size. These change what you see, not the calculations.</li>
          </ul>
          <p>A signal is a mechanical rule state, not a recommendation. See The default model above for what our tests found about these settings.</p>
        </Section>

        <Section id="markets" title="Which markets">
          <p><b>Core ({CORE_MARKETS.filter(m => m.code).length})</b>: the markets most traders watch, grouped like a futures watchlist ({CORE_GROUPS.map(g => g.label).join(", ")}). The scanners cover these.</p>
          <p><b>Specialty ({SPECIALTY_MARKETS.length})</b>: markets that tie into the site's analysis, such as PJM, ERCOT and CAISO power, SOFR and the Ultra Treasuries. They're in the market picker, each with a note on why.</p>
          <p><b>Advanced</b>: every market the CFTC publishes (about 370), reachable from the bottom of the market picker. Not curated; many are regional swaps or thinly traded.</p>
          <p><b>Quality labels.</b> The CFTC only publishes a market when at least 20 large traders hold reportable positions. <b>Thin</b> ({thin}) means few reporting traders or a short history: read with care. <b>Not published</b>: COMEX aluminum (ALI) rarely meets the 20-trader rule, and the dollar Nikkei (NKD) dropped out in March 2026, so the site shows the yen Nikkei instead.</p>
        </Section>

        <Section id="sectors" title="SPDR sectors">
          <p>The <Link href="/sectors">SPDR sectors</Link> page connects positioning to the stock market: each of the 11 Select Sector SPDR ETFs against the S&amp;P 500 (SPY), with the futures positioning underneath it.</p>
          <ul>
            <li><b>Performance</b>: each sector's move relative to SPY over 1 day, 1 week, 1 month, 3 months and 1 year.</li>
            <li><b>How unusual (σ)</b>: how far the 3-month and 1-year relative moves sit from the sector's own norm over the past three years. 2σ or more is rare and shown in amber.</li>
            <li><b>Momentum</b>: the last 4 weeks against that norm. ▲ rising, ► flat or ▼ falling, with "turning up" or "fading" when it differs from the 3-month trend. Our tests found no reliable tendency for sector trends to continue or reverse.</li>
            <li><b>Underneath</b>: the futures linked to each sector, such as crude, gasoline and diesel for energy, copper for industrials, power and gas for utilities, and Nasdaq-100 for tech. Health care, staples and discretionary have no clean futures link and are shown on price only.</li>
            <li><b>Positioning monitor</b>: where funds sit in their 3-year range, as a percentile. Funds are managed money for commodities and leveraged funds for financial futures, shown against producers or asset managers. The 90th percentile or above, or the 10th or below, is labeled crowded. A low reading can still be a net long.</li>
          </ul>
          <p>Panel text is generated from the numbers each day and describes what is happening, not what comes next.</p>
          <p><b>Watch notes</b> (labeled Speculation) report co-movement we found between the site's default COT filter on a sector's futures and that sector versus SPY, 2002–2026. Energy is the one consistent link: XLE has tended to move with the filter on crude, gasoline and natural gas. Utilities moved the opposite way to a bullish natural-gas filter. Metals showed nothing for materials or industrials. Samples are small (about 30 signals per market) and we checked many links, so treat these as things to watch, not rules.</p>
        </Section>

        <Section id="invisible-hand" title="The Invisible Hand">
          <p><Link href="/invisible-hand">The Invisible Hand</Link> is the weekly macro backdrop: the broad forces behind the market and who is positioned in each.</p>
          <ul>
            <li><b>Theme cards</b>: credit, rates, power and gas, volatility, and the AI and power trade. A card shows a label (such as "steepener" or "high volatility") only where that label passed our accuracy and stability tests; otherwise it shows the readings alone. Cards waiting on a data source say so.</li>
            <li><b>Who is positioned</b>: for each theme, the trader groups active in the related futures, with their net and gross positions as a share of open interest, where that sits in its 3-year range, and the 4-week change. Rows with fewer than 20 traders, or where four traders hold more than half of one side, are withheld because they would describe a few firms, not a market.</li>
            <li><b>Past pattern</b>: what sectors did alongside each state in our 1999–2026 tests, shown only where the pattern beat chance. It describes what happened at the same time, not what came next.</li>
            <li><b>Expected daily range</b>: the typical (median) and wide (1 day in 5) ES and NQ day in the current volatility state, in percent and in points, from 2002–2026 data, next to what the last 20 sessions actually did. Ranges are tested; direction is not.</li>
            <li><b>Next two weeks</b>: FOMC decisions, CPI and payrolls (from the Federal Reserve and BLS schedules) and expirations (from exchange rules), each with what our tests found. FOMC and payrolls days have run about 20% wider than other days in the same volatility state. CPI days, options expirations, quarterly "witching" and the ES/NQ roll showed no reliable change in the day's range.</li>
            <li><b>Crowded watch</b>: core markets where large speculators sit in the top or bottom 10% of their 3-year range. Crowded readings were not followed by bigger moves in our tests, so treat this as where risk sits, not a timing signal.</li>
            <li><b>Event tags</b>: market rows here and on the SPDR sectors page carry a solid tag for scheduled events in the next 7 days and an outlined "in data" tag for events that fell inside the week the latest CFTC report covers, so a position change can be read next to the release that happened that week.</li>
            <li><b>Demo account</b>: a public paper-trading forward test of the default model. The COT filter decides the side, weekly bar patterns (2-2, 3-2, failed 2, 3) trigger entries, one full-size contract per trade, stop trailed to every week that closes our way, target 2σ. The rules are frozen, results are before commissions and slippage, and every trade stays on the record. Each week's orders are placed after the Friday close for the following week, so no order can use prices from before it was published.</li>
            <li><b>Timing</b>: positioning updates minutes after each Friday CFTC release; prices and yields after each close.</li>
            <li><b>Our read</b> (coming soon): a short weekly read. Every statement will be labeled Validated (backed by our tested data) or Speculation (our judgment, with the reasoning shown).</li>
          </ul>
        </Section>

        <Section id="curve" title="Futures curve">
          <p>Each market detail page has a <b>futures curve</b> gauge, and The Invisible Hand lists the curves that are stretched. All of it is labeled <b>Measured · not a signal</b>.</p>
          <ul>
            <li><b>Backwardation</b>: the nearest contract trades above the next one. Buyers pay up for delivery now, which usually means tight supply. <b>Contango</b> is the reverse, the normal shape when supply is ample and storage costs money.</li>
            <li><b>EOD spread</b>: front contract minus second contract at the day's close, in price and in dollars per contract. Positive = backwardation. The small line shows the same two contracts over about 3 months.</li>
            <li><b>Carry per year</b>: ln(front ÷ second), divided by the years between the two delivery months, so markets with monthly and quarterly contracts compare fairly.</li>
            <li><b>The gauge</b> places today's carry within that market's own 2002–2024 history (VIX: 2004–2026). The colored ends are its deepest 20% each way. A gold curve near flat can read "deep backwardation for gold" while still in contango, because gold is almost always in contango.</li>
            <li><b>Volatility now</b>: the front contract's last 20 daily moves, annualised, and how that compares with the market's own 5-year normal (roll days removed).</li>
            <li><b>What we found</b>: in commodities, volatility over the next 4 weeks ran about 19% above a flat curve in deep backwardation, and about 13% above in deep contango (2002–2024, 23 markets). That matches published research: tight inventories make prices jumpier (Fama and French 1988; Ng and Pirrong 1994), and volatility rises with the curve's slope in both directions (Kogan, Livdan and Yaron 2009). For index, rate, currency and crypto futures the curve mostly reflects interest rates and dividends, and we found no effect.</li>
            <li><b>What we did not find</b>: using the curve as a filter on the site's COT signals did not improve them in our pre-registered test. Commercials are usually positioned against the curve, so the COT signal already carries most of what the curve says. Use the curve for risk (stops, size), not for direction.</li>
            <li><b>Limits</b>: the historical ranges come from research data that does not always use the front two contracts, so they are close, not exact. Prices are Yahoo end-of-day (VIX: Cboe settlements). Lumber has too little history for a range. The site saves every day's curve, so the ranges can move to our own data once there is enough.</li>
          </ul>
        </Section>

        <Section id="updates" title="Data & updates">
          <ul>
            <li><b>Nothing here is real-time.</b> The site shows end-of-day and weekly data, built for understanding the backdrop, not for timing trades.</li>
            <li><b>COT positioning</b>: weekly. Positions as of Tuesday are published Friday at 3:30 p.m. ET, and the site checks for the release automatically.</li>
            <li><b>Sector and futures prices</b>: end of day, updated on weekday evenings after the U.S. close. During the trading day the page shows the previous close. The page header shows both dates, for example "Prices Oct 21 close · CFTC Oct 13".</li>
            <li><b>If prices stop updating</b>, the page shows a warning with the last update date instead of quietly showing old numbers.</li>
            <li><b>The Invisible Hand</b>: positioning minutes after each Friday CFTC release; prices, volatility and yields after each weekday close. The demo account advances once a week, after the Friday close.</li>
            <li><b>Sources</b>: CFTC Commitments of Traders (Legacy, Disaggregated and Traders in Financial Futures); end-of-day prices from Yahoo Finance (futures curves: individual contracts; VIX futures: Cboe settlements); Treasury yields from the U.S. Treasury's daily par yield curve.</li>
          </ul>
        </Section>

        <Section id="consolidated" title="Consolidated lines">
          <p>For the S&amp;P 500, Nasdaq-100 and Dow, the CFTC publishes each contract separately (E-mini, micro, Dow x$5) <b>and</b> a <b>consolidated</b> line that adds them together, counting each micro as one-tenth of an E-mini. The site uses the consolidated line, because that is the whole market's positioning.</p>
          <p>The single contracts are still available in Advanced, marked "Part of … consolidated". They tell nearly the same story: the E-mini alone is about 99% of the S&amp;P consolidated total. The trade-off is history: consolidated lines start in June 2010.</p>
        </Section>

        <Section id="history" title="History notes">
          <ul>
            <li>Markets are tracked by their CFTC <b>contract code</b>, so history continues when the CFTC renames a contract (many were renamed in February 2022).</li>
            <li>Corn, soybeans and wheat changed codes in January 1998; the two codes are joined, so history runs back to 1986.</li>
            <li>A few codes carry an unrelated earlier listing that is dropped: the euro starts in January 1999 (before that the code held the European Currency Unit), the Russell 2000 in August 2017 (when it returned to CME from ICE), and the New Zealand dollar in August 2004.</li>
            <li>Lumber is the new contract launched in August 2022; the old contract is a different size and isn't joined.</li>
          </ul>
        </Section>

        <Section id="limits" title="What it can't tell you">
          <p>Positioning describes <b>who is crowded where</b>, not when prices turn. In our tests on 2007–2026 data:</p>
          <ul>
            <li>Positioning extremes were not reliably followed by bigger or sharper moves.</li>
            <li>Sectors on the commercials' side of an extreme did modestly better, but not by enough to rule out chance.</li>
            <li>Extremes can last for weeks or months while prices keep going.</li>
          </ul>
          <p>Use it as context alongside price, not as a timing signal. Nothing on this site is investment advice.</p>
        </Section>
      </div>

      <footer className="scan-foot">
        <span>Sources: CFTC Commitments of Traders; end-of-day prices from Yahoo Finance; U.S. Treasury yields.</span>
        <span>Setups are mechanical rule states, not recommendations.</span>
      </footer>
    </main>
    <SiteMobileNav />
  </div>;
}
