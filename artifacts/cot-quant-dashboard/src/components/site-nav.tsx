import { Link, useLocation } from "wouter";
import { Activity, BarChart3, CircleHelp, Hand, Layers, LayoutGrid, ListOrdered, Settings2, Waves } from "lucide-react";

/** Market detail sections: always listed, so they stay reachable from every page. */
export const workspaceSections = [
  { id: "summary", label: "Market overview", icon: BarChart3 },
  { id: "positioning", label: "Positioning", icon: Waves },
  { id: "signals", label: "Signal analysis", icon: Activity },
  { id: "configuration", label: "Settings", icon: Settings2 },
];

export const researchLinks = [
  { href: "/sector-signals", label: "Sector signals", short: "Sectors", id: "sector-signals", icon: LayoutGrid },
  { href: "/signal-watchlist", label: "Signal watchlist", short: "Watchlist", id: "signal-watchlist", icon: ListOrdered },
  { href: "/sectors", label: "SPDR sectors", short: "SPDR", id: "sectors", icon: Layers },
  { href: "/invisible-hand", label: "The Invisible Hand", short: "Hand", id: "invisible-hand", icon: Hand },
  { href: "/how-it-works", label: "How it works", short: "Info", id: "how-it-works", icon: CircleHelp },
];

type SectionProps = { activeSection?: string; onSection?: (id: string) => void };

export function SiteBrand() {
  return <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "2px 8px 30px" }}>
    <div className="brand-mark"><Activity size={18} /></div>
    <div><div style={{ fontFamily: "var(--app-font-serif)", fontWeight: 800, fontSize: 14, letterSpacing: "-.04em" }}>COT / QUANT</div><div style={{ font: "9px var(--app-font-mono)", color: "rgba(244,241,232,.5)", marginTop: 3 }}>RESEARCH TERMINAL</div></div>
  </div>;
}

/**
 * Sidebar navigation shared by every page. On market detail the workspace items scroll to their section
 * (`onSection`); elsewhere they link back to market detail at that section.
 */
export function SiteNav({ activeSection, onSection }: SectionProps) {
  const [location] = useLocation();
  return <>
    <div className="eyebrow" style={{ color: "rgba(244,241,232,.42)", padding: "0 12px 8px" }}>Workspace</div>
    <nav style={{ display: "grid", gap: 3 }}>
      {workspaceSections.map(({ id, label, icon: Icon }) => onSection
        ? <button key={id} className={`nav-link ${activeSection === id ? "active" : ""}`} onClick={() => onSection(id)} data-testid={`nav-${id}`}><Icon size={16} />{label}</button>
        : <Link key={id} href={`/#${id}`} className="nav-link" data-testid={`nav-${id}`}><Icon size={16} />{label}</Link>)}
    </nav>
    <div className="eyebrow" style={{ color: "rgba(244,241,232,.42)", padding: "22px 12px 8px" }}>All-market scan</div>
    <nav style={{ display: "grid", gap: 3 }}>
      {researchLinks.map(({ href, label, id, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? "active" : ""}`} data-testid={`nav-${id}`}><Icon size={16} />{label}</Link>)}
    </nav>
  </>;
}

export function SiteMobileNav({ activeSection, onSection }: SectionProps) {
  const [location] = useLocation();
  return <nav className="mobile-nav print-hidden">
    {workspaceSections.map(({ id, label, icon: Icon }) => onSection
      ? <button key={id} className={`nav-link ${activeSection === id ? "active" : ""}`} onClick={() => onSection(id)} aria-label={label} data-testid={`mobile-nav-${id}`}><Icon size={16} /><span>{label.split(" ")[0]}</span></button>
      : <Link key={id} href={`/#${id}`} className="nav-link" aria-label={label} data-testid={`mobile-nav-${id}`}><Icon size={16} /><span>{label.split(" ")[0]}</span></Link>)}
    {researchLinks.map(({ href, short, label, id, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href ? "active" : ""}`} aria-label={label} data-testid={`mobile-nav-${id}`}><Icon size={16} /><span>{short}</span></Link>)}
  </nav>;
}
