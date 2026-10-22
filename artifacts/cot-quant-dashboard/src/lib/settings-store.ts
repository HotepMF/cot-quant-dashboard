import { useSyncExternalStore } from "react";
import { defaultSignalSettings } from "@workspace/cot-engine";
import type { SignalSettings } from "@workspace/cot-engine";

/** UI settings extend the shared engine settings so detail and scanner stay on one rule set. */
export type Settings = SignalSettings & {
  reportType: string; highlight: string; showSignals: boolean;
  showPaneLabel: boolean; tableSize: string; showLT: boolean; showST: boolean; showCH: boolean; showOI: boolean;
  marketLabel: string;
};

export const STORAGE_SETTINGS = "cot-quant-settings-v1";
export const STORAGE_SOURCE = "cot-quant-source-selection-v1";
export const STORAGE_SOURCE_MODE = "cot-quant-source-mode";
export const STORAGE_THEME = "cot-quant-theme-v2";

export const initialSettings: Settings = {
  ...defaultSignalSettings,
  reportType: "Legacy Futures Only", highlight: "Background Only", showSignals: true, showPaneLabel: false,
  tableSize: "Small", showLT: true, showST: true, showCH: true, showOI: true, marketLabel: "",
};

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_SETTINGS) ?? "{}");
    const savedReport = saved.reportType;
    return {
      ...initialSettings, ...saved,
      lookback: Number.isFinite(Number(saved.lookback)) ? Math.max(3, Math.min(500, Math.round(Number(saved.lookback)))) : initialSettings.lookback,
      reportType: savedReport === "Legacy Combined" || savedReport === "Futures + Options" ? "Legacy Combined" : "Legacy Futures Only",
    };
  } catch { return initialSettings; }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export function setSharedSettings(update: Settings | ((s: Settings) => Settings)) {
  current = typeof update === "function" ? update(current) : update;
  current = { ...current, lookback: Math.max(3, Math.min(500, Math.round(current.lookback))) };
  try { localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(current)); } catch { /* storage unavailable */ }
  listeners.forEach(l => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSharedSettings(): [Settings, typeof setSharedSettings] {
  const value = useSyncExternalStore(subscribe, () => current, () => current);
  return [value, setSharedSettings];
}

/** Which markets the picker and scanners lead with: the core watchlist, or every published market. */
export type MarketScope = "core" | "all";
export const STORAGE_MARKET_SCOPE = "cot-quant-market-scope-v1";
let currentScope: MarketScope = (() => {
  try { return localStorage.getItem(STORAGE_MARKET_SCOPE) === "all" ? "all" : "core"; } catch { return "core"; }
})();
const scopeListeners = new Set<() => void>();

export function setMarketScope(scope: MarketScope) {
  currentScope = scope;
  try { localStorage.setItem(STORAGE_MARKET_SCOPE, scope); } catch { /* storage unavailable */ }
  scopeListeners.forEach(l => l());
}

export function useMarketScope(): [MarketScope, typeof setMarketScope] {
  const value = useSyncExternalStore(
    listener => { scopeListeners.add(listener); return () => { scopeListeners.delete(listener); }; },
    () => currentScope, () => currentScope,
  );
  return [value, setMarketScope];
}

export type LiveReport = "futures" | "combined";
export function readLiveReport(): LiveReport {
  try { return localStorage.getItem(STORAGE_SOURCE) === "combined" ? "combined" : "futures"; } catch { return "futures"; }
}
export function writeLiveReport(report: LiveReport) {
  try { localStorage.setItem(STORAGE_SOURCE, report); } catch { /* storage unavailable */ }
}

/** Point the detail dashboard at an exact official market. A stored CSV is kept, only the mode switches to CFTC. */
export function prepareDetailMarket(report: LiveReport, name: string) {
  try {
    localStorage.setItem(STORAGE_SOURCE, report);
    localStorage.setItem(`${STORAGE_SOURCE}:market`, name);
    localStorage.setItem(STORAGE_SOURCE_MODE, "live");
  } catch { /* storage unavailable */ }
}
