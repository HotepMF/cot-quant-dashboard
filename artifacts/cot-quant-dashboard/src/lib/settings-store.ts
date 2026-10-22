import { useSyncExternalStore } from "react";
import { defaultSignalSettings, previousDefaultSignalSettings } from "@workspace/cot-engine";
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
/** Bumped when the site's default signal model changes; saved models from before are moved to the new default once. */
export const MODEL_VERSION = 2;
export const STORAGE_MODEL_VERSION = "cot-quant-model-version";
export const STORAGE_PREVIOUS_MODEL = "cot-quant-previous-model";
const MODEL_KEYS = Object.keys(defaultSignalSettings) as (keyof typeof defaultSignalSettings)[];

export const initialSettings: Settings = {
  ...defaultSignalSettings,
  reportType: "Legacy Futures Only", highlight: "Background Only", showSignals: true, showPaneLabel: false,
  tableSize: "Small", showLT: true, showST: true, showCH: true, showOI: true, marketLabel: "",
};

function load(): Settings {
  try {
    let saved = JSON.parse(localStorage.getItem(STORAGE_SETTINGS) ?? "{}");
    // One-time move to the Oct 2026 default model; the visitor's previous model is kept so it can be restored.
    if (Number(localStorage.getItem(STORAGE_MODEL_VERSION)) < MODEL_VERSION) {
      if (Object.keys(saved).length) {
        const previous = Object.fromEntries(MODEL_KEYS.map(k => [k, saved[k] ?? previousDefaultSignalSettings[k]]));
        localStorage.setItem(STORAGE_PREVIOUS_MODEL, JSON.stringify(previous));
        saved = { ...saved, ...defaultSignalSettings };
        localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(saved));
      }
      localStorage.setItem(STORAGE_MODEL_VERSION, String(MODEL_VERSION));
    }
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

/** The model a returning visitor had before the default changed, if any. */
export function previousModel(): Partial<Settings> | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_PREVIOUS_MODEL) ?? "null"); } catch { return null; }
}
export function dismissPreviousModel() {
  try { localStorage.removeItem(STORAGE_PREVIOUS_MODEL); } catch { /* storage unavailable */ }
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
