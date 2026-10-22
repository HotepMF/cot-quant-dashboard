import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Moon, Sun } from "lucide-react";
import { CORE_GROUPS, CORE_MARKETS, SPECIALTY_MARKETS } from "@workspace/cot-engine";
import { useTheme, workspaceLinks } from "@/components/scanner/scanner-shell";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="card hiw-section" data-testid={`section-${id}`}>
    <div className="card-head"><h2 className="panel-title">{title}</h2></div>
    <div className="card-body hiw-body">{children}</div>
  </section>;
}

export function HowItWorksPage() {
  const [location] = useLocation();
  const [isDark, setIsDark] = useTheme();
  useEffect(() => { window.scrollTo(0, 0); document.title = "How it works · COT Quant"; }, []);
  const thin = CORE_MARKETS.filter(m => m.quality === "thin").map(m => m.symbol).join(", ");

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
    <main className="main">
      <header className="topline">
        <div>
          <div className="eyebrow" style={{ marginBottom: 9 }}>Reference</div>
          <h1 className="page-title display">How it works</h1>
          <p className="subtle scan-lede">What the COT report is, how this site reads it, which markets it shows, how the SPDR sectors page works, when data updates, and what it can't tell you.</p>
        </div>
        <div className="toolbar print-hidden">
          <button className="icon-btn" aria-label="Toggle dark mode" title="Toggle theme" onClick={() => setIsDark(v => !v)}>{isDark ? <Sun size={15} /> : <Moon size={15} />}</button>
        </div>
      </header>

      <nav className="hiw-toc print-hidden" aria-label="On this page">
        {[["cot", "The COT report"], ["reading", "Reading the site"], ["markets", "Which markets"], ["sectors", "SPDR sectors"], ["updates", "Data & updates"], ["consolidated", "Consolidated lines"], ["history", "History notes"], ["limits", "What it can't tell you"]].map(([id, label]) =>
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
            <li><b>Z-score</b>: how far today's net position sits from its average over the lookback (63 weeks by default), in standard deviations. ±2 marks an extreme.</li>
            <li><b>Cycle rank</b>: where today's net position sits between the lowest (0%) and highest (100%) reading in the market's full history.</li>
            <li><b>Confluence</b>: commercials and large traders at opposite extremes of their cycle ranks at the same time.</li>
          </ul>
          <p>Signals and setups are <b>mechanical rule states</b>, not recommendations.</p>
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
        </Section>

        <Section id="updates" title="Data & updates">
          <ul>
            <li><b>Nothing here is real-time.</b> The site shows end-of-day and weekly data, built for understanding the backdrop, not for timing trades.</li>
            <li><b>COT positioning</b>: weekly. Positions as of Tuesday are published Friday at 3:30 p.m. ET, and the site checks for the release automatically.</li>
            <li><b>Sector and futures prices</b>: end of day, updated on weekday evenings after the U.S. close. During the trading day the page shows the previous close. The page header shows both dates, for example "Prices Oct 21 close · CFTC Oct 13".</li>
            <li><b>If prices stop updating</b>, the page shows a warning with the last update date instead of quietly showing old numbers.</li>
            <li><b>Sources</b>: CFTC Commitments of Traders (Legacy, Disaggregated and Traders in Financial Futures); end-of-day prices from Yahoo Finance; Treasury yields from the U.S. Treasury's daily par yield curve.</li>
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
    <nav className="mobile-nav print-hidden">
      {workspaceLinks.map(({ href, short, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? "active" : ""}`} aria-label={label}><Icon size={16} /><span>{short}</span></Link>)}
    </nav>
  </div>;
}
