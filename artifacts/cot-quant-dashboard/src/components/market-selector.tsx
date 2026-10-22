import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { CORE_GROUPS, CORE_MARKETS, SPECIALTY_MARKETS, coreAliases, curatedMarketByCode } from "@workspace/cot-engine";
import { MARKET_SECTORS, buildMarketCatalog, filterMarketCatalog } from "@/lib/market-catalog";
import type { CatalogMarket, MarketSector } from "@/lib/market-catalog";
import "./market-selector.css";

const curatedOrder = new Map([...CORE_MARKETS, ...SPECIALTY_MARKETS].map((m, i) => [m.code, i]));
const CURATED_GROUPS = [...CORE_GROUPS, { id: "specialty", label: "Specialty" }] as const;

type Props = {
  markets: { name: string; code: string }[];
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
  loading?: boolean;
};

type SectorFilter = MarketSector | "all";

export function MarketSelector({ markets, value, onChange, disabled, loading }: Props) {
  const uid = useId().replace(/:/g, "");
  const listId = `ms-list-${uid}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState<SectorFilter>("all");
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState({ side: "below", height: 520 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Curated (core + specialty) by default; every published market only through an explicit advanced search.
  const [advanced, setAdvanced] = useState(false);
  const catalog = useMemo(() => buildMarketCatalog(markets, coreAliases), [markets]);
  const curatedCatalog = useMemo(() => catalog.filter(m => curatedMarketByCode.has(m.code)), [catalog]);
  const pool = advanced ? catalog : curatedCatalog;
  const selected = useMemo(() => catalog.find(m => m.name === value), [catalog, value]);
  const selectedCore = selected && curatedMarketByCode.get(selected.code);
  const searched = useMemo(() => filterMarketCatalog(pool, query, "all"), [pool, query]);
  const searchedAll = useMemo(() => filterMarketCatalog(catalog, query, "all"), [catalog, query]);
  const results = useMemo(() => filterMarketCatalog(pool, query, advanced ? sector : "all"), [pool, query, sector, advanced]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of searched) c.set(m.sector, (c.get(m.sector) ?? 0) + 1);
    return c;
  }, [searched]);
  const groups = useMemo(() => {
    const out: { id: string; label: string; items: CatalogMarket[] }[] = [];
    if (!advanced) {
      for (const g of CURATED_GROUPS) {
        const items = results.filter(m => curatedMarketByCode.get(m.code)?.group === g.id)
          .sort((a, b) => (curatedOrder.get(a.code) ?? 0) - (curatedOrder.get(b.code) ?? 0));
        if (items.length) out.push({ id: g.id, label: g.label, items });
      }
      return out;
    }
    for (const s of MARKET_SECTORS) {
      const items = results.filter(m => m.sector === s.id);
      if (items.length) out.push({ id: s.id, label: s.label, items });
    }
    return out;
  }, [results, advanced]);
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  const isDisabled = disabled || (!markets.length && !loading) || (loading && !markets.length);
  const optId = (i: number) => `ms-opt-${uid}-${i}`;

  const openPanel = () => {
    if (isDisabled) return;
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    setQuery("");
    setSector("all");
    setAdvanced(false);
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (m: CatalogMarket) => {
    if (m.name !== value) onChange(m.name);
    close();
  };

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const idx = flat.findIndex(m => m.name === value);
    setActive(idx >= 0 ? idx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { setActive(0); }, [query, sector, advanced]);

  useEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const side = below < 340 && above > below ? "above" : "below";
      setPlacement({ side, height: Math.max(240, Math.min(640, side === "above" ? above : below)) });
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`#${CSS.escape(optId(active))}`)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) close(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { if (disabled && open) close(false); /* CSV mode */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.max(0, Math.min(flat.length - 1, a + 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === "Home" && e.ctrlKey) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && e.ctrlKey) { e.preventDefault(); setActive(Math.max(0, flat.length - 1)); }
    else if (e.key === "PageDown") { e.preventDefault(); setActive(a => Math.max(0, Math.min(flat.length - 1, a + 8))); }
    else if (e.key === "PageUp") { e.preventDefault(); setActive(a => Math.max(0, a - 8)); }
    else if (e.key === "Enter") { e.preventDefault(); const m = flat[active]; if (m) choose(m); }
    else if (e.key === "Escape") { e.preventDefault(); if (query) setQuery(""); else close(); }
  };

  const sectorKey = (e: ReactKeyboardEvent<HTMLButtonElement>, idx: number) => {
    const ids: SectorFilter[] = ["all", ...MARKET_SECTORS.map(s => s.id)];
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % ids.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + ids.length) % ids.length;
    else if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (next >= 0) {
      e.preventDefault();
      setSector(ids[next]);
      (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
    }
  };

  const triggerLabel = (selectedCore ? `${selectedCore.symbol} · ${selectedCore.label}` : selected?.label) ?? (value || (loading ? "Loading markets…" : markets.length ? "Choose a market" : "No markets available"));
  let running = -1;

  return (
    <div
      className="ms"
      ref={rootRef}
      data-open={open || undefined}
      onBlur={e => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) close(false);
      }}
      onKeyDown={e => {
        if (open && e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); close(); }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="ms-trigger"
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={e => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openPanel(); } }}
        disabled={isDisabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`CFTC market: ${triggerLabel}`}
        data-testid="select-cftc-market"
      >
        <span className="ms-trigger-text">
          <span className="ms-trigger-name">{loading && !markets.length ? <span className="ms-skel" /> : triggerLabel}</span>
          {selected && <span className="ms-trigger-meta">{selected.exchange} · {selected.code}</span>}
        </span>
        <ChevronDown size={14} className="ms-chev" aria-hidden />
      </button>

      {open && (
        <div className="ms-panel" role="dialog" aria-label="Browse CFTC markets" data-testid="panel-market-selector" data-side={placement.side} style={{ "--ms-height": `${placement.height}px` } as CSSProperties}>
          <div className="ms-panel-head">
            <span>Find a market <small>Browse sectors or search</small></span>
            <button type="button" className="ms-close" onClick={() => close()} aria-label="Close market picker" data-testid="button-close-market-selector"><X size={15} /></button>
          </div>
          <div className="ms-search">
            <Search size={14} aria-hidden />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={flat.length ? optId(active) : undefined}
              aria-label="Search markets by name, exchange, code or alias"
              placeholder="Search name, exchange, code, alias…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKey}
              spellCheck={false}
              autoComplete="off"
              data-testid="input-market-search"
            />
            {query && (
              <button type="button" className="ms-clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }} aria-label="Clear search" data-testid="button-clear-market-search">
                <X size={13} />
              </button>
            )}
          </div>

          {advanced && (
            <div className="ms-advanced" role="note">
              <span>All {catalog.length} CFTC markets. Not curated; some are thinly traded.</span>
              <button type="button" className="btn" onClick={() => { setAdvanced(false); setSector("all"); inputRef.current?.focus(); }} data-testid="button-market-curated">Back to curated</button>
            </div>
          )}
          {advanced && <div className="ms-sectors" role="toolbar" aria-label="Filter by sector">
            {(["all", ...MARKET_SECTORS.map(s => s.id)] as SectorFilter[]).map((id, i) => {
              const label = id === "all" ? "All" : MARKET_SECTORS.find(s => s.id === id)!.label;
              const n = id === "all" ? searched.length : counts.get(id) ?? 0;
              return (
                <button
                  key={id}
                  type="button"
                  className="ms-chip"
                  aria-pressed={sector === id}
                  tabIndex={sector === id ? 0 : -1}
                  onClick={() => { setSector(id); inputRef.current?.focus(); }}
                  onKeyDown={e => sectorKey(e, i)}
                  data-empty={n === 0 || undefined}
                  data-testid={`button-sector-${id}`}
                >
                  {label}<span className="ms-count">{n}</span>
                </button>
              );
            })}
          </div>}

          <div className="ms-list" id={listId} role="listbox" aria-label="Markets" ref={listRef}>
            {groups.map(g => (
              <div key={g.id} role="group" aria-labelledby={`ms-g-${uid}-${g.id}`} className="ms-group">
                <div className="ms-group-head" id={`ms-g-${uid}-${g.id}`} role="presentation">
                  <span>{g.label}</span><span>{g.items.length}</span>
                </div>
                {g.items.map(m => {
                  running += 1;
                  const i = running;
                  const isSel = m.name === value;
                  const core = advanced ? undefined : curatedMarketByCode.get(m.code);
                  return (
                    <div
                      key={`${m.code}:${m.name}`}
                      title={core?.note}
                      id={optId(i)}
                      role="option"
                      aria-selected={isSel}
                      className="ms-opt"
                      data-active={i === active || undefined}
                      onMouseMove={() => i !== active && setActive(i)}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => choose(m)}
                      data-testid={`option-market-${m.code}`}
                       data-market-name={m.name}
                    >
                      <span className="ms-opt-main">
                        <span className="ms-opt-name">
                          {core ? <><b className="mono">{core.symbol}</b> {core.label}{core.quality === "thin" && <span className="quality-pill" title={core.note}>thin</span>}</> : m.label}
                        </span>
                        <span className="ms-opt-meta">{core ? `${m.label} · ${m.exchange}` : m.exchange}</span>
                      </span>
                      <span className="ms-opt-code">{m.code}</span>
                      <Check size={13} className="ms-check" aria-hidden />
                    </div>
                  );
                })}
              </div>
            ))}
            {!flat.length && (
              <div className="ms-empty" data-testid="status-market-empty">
                <b>No markets match{query ? ` “${query}”` : ""}{sector !== "all" ? ` in ${MARKET_SECTORS.find(s => s.id === sector)?.label}` : ""}.</b>
                <span>Try an exchange (CME, ICE), a contract code, or a common alias like “gold” or “ES”.</span>
                <div className="ms-empty-actions">
                  {!advanced && query && searchedAll.length > 0 && (
                    <button type="button" className="btn" onClick={() => { setAdvanced(true); inputRef.current?.focus(); }} data-testid="button-market-search-all">
                      Search all CFTC markets ({searchedAll.length})
                    </button>
                  )}
                  {advanced && sector !== "all" && searched.length > 0 && (
                    <button type="button" className="btn" onClick={() => { setSector("all"); inputRef.current?.focus(); }} data-testid="button-market-all-sectors">
                      Search all sectors ({searched.length})
                    </button>
                  )}
                  {query && (
                    <button type="button" className="btn" onClick={() => { setQuery(""); inputRef.current?.focus(); }} data-testid="button-market-reset-search">
                      Clear search
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="ms-foot" aria-live="polite">
            {advanced
              ? <span>{flat.length} of {pool.length} markets</span>
              : <span>{flat.length} curated · <button type="button" className="ms-link" onClick={() => { setAdvanced(true); inputRef.current?.focus(); }} data-testid="button-market-advanced">Advanced: all CFTC markets</button></span>}
            <span className="ms-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> select <kbd>Esc</kbd> close</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default MarketSelector;
