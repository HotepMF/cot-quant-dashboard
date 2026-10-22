import { useMarketScope } from "@/lib/settings-store";

/** Core watchlist vs every published market; shared by the picker and both scanner pages. */
export function MarketScopeToggle({ coreCount, allCount }: { coreCount: number; allCount: number }) {
  const [scope, setScope] = useMarketScope();
  return (
    <div className="scope-toggle" role="group" aria-label="Markets shown">
      <button type="button" className={`seg${scope === "core" ? " active" : ""}`} aria-pressed={scope === "core"} onClick={() => setScope("core")} data-testid="button-scope-core">
        Core markets <span className="mono">{coreCount}</span>
      </button>
      <button type="button" className={`seg${scope === "all" ? " active" : ""}`} aria-pressed={scope === "all"} onClick={() => setScope("all")} data-testid="button-scope-all">
        All markets <span className="mono">{allCount}</span>
      </button>
    </div>
  );
}
