import { computeRows, defaultSignalSettings, setupScore, type RawRow, type SignalSettings } from "./index";

export function parseSignalSettings(query: Record<string, unknown>): SignalSettings {
  const settings = { ...defaultSignalSettings };
  for (const [key, min, max] of [
    ["lookback", 3, 520], ["zThreshold", 0, 20], ["confluenceThreshold", 50, 95], ["oiThreshold", 0, 100],
  ] as const) {
    const value = query[key];
    if (value === undefined) continue;
    if ((typeof value !== "string" && typeof value !== "number") || value === "") throw new Error(`Invalid ${key}.`);
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max || (key === "lookback" && !Number.isInteger(n))) throw new Error(`Invalid ${key}: expected ${min}–${max}.`);
    settings[key] = n;
  }
  for (const key of ["zEnabled", "requireSmall", "changeEnabled"] as const) {
    if (query[key] === undefined) continue;
    if (![true, false, "true", "false"].includes(query[key] as string | boolean)) throw new Error(`Invalid ${key}.`);
    settings[key] = query[key] === true || query[key] === "true";
  }
  for (const [key, allowed] of [
    ["participant", ["Large Traders", "Small Traders", "Commercial Hedgers"]],
    ["signalMode", ["Z-Score Only", "COT Confluence", "Both (AND gate)"]],
  ] as const) {
    if (query[key] === undefined) continue;
    if (typeof query[key] !== "string" || !(allowed as readonly string[]).includes(query[key])) throw new Error(`Invalid ${key}.`);
    settings[key] = query[key];
  }
  return settings;
}

export function signalMarket(
  market: { name: string; code: string },
  history: { rows: RawRow[]; error: string | null } | undefined,
  reportAsOf: string, settings: SignalSettings, now = Date.now(),
) {
  const rows = history?.rows ?? [];
  const latestDate = rows.at(-1)?.date ?? null;
  const oldReport = Math.floor((now - Date.parse(`${reportAsOf}T00:00:00Z`)) / 86_400_000) > 9;
  const status = !history ? "loading" : history.error ? "error" : rows.length < Math.max(3, settings.lookback) ? "insufficient" : latestDate !== reportAsOf || oldReport ? "stale" : "ready";
  let message = !history ? "Waiting for official history." : history.error ?? (status === "insufficient" ? `Needs ${settings.lookback} weekly observations; ${rows.length} available.` : status === "stale" ? oldReport ? `Official report ${reportAsOf} is over nine days old; publication may be delayed.` : `Latest observation ${latestDate ?? "missing"} does not match report ${reportAsOf}.` : null);
  const latest = history && !history.error && rows.length ? computeRows(rows, settings, true).at(-1) : undefined;
  if (status === "ready" && latest?.buy && latest.sell) message = "Both directional conditions met; no unambiguous setup.";
  const selectedZ = settings.participant === "Large Traders" ? latest?.ltZ : settings.participant === "Small Traders" ? latest?.stZ : latest?.chZ;
  const selectedCycle = settings.participant === "Large Traders" ? latest?.ltCycle : settings.participant === "Small Traders" ? latest?.stCycle : latest?.chCycle;
  const selectedDelta = settings.participant === "Large Traders" ? latest?.ltDelta : settings.participant === "Small Traders" ? latest?.stDelta : latest?.chDelta;
  return {
    ...market, status: status as "loading" | "error" | "insufficient" | "stale" | "ready", message, historyRows: rows.length, historyStart: rows[0]?.date ?? null, reportDate: latestDate,
    signal: (status !== "ready" ? "unavailable" : latest?.buy && !latest.sell ? "bullish" : latest?.sell && !latest.buy ? "bearish" : "none") as "unavailable" | "bullish" | "bearish" | "none",
    setupScore: status === "ready" && latest ? setupScore(latest, settings) : null,
    zScore: selectedZ ?? null, cycle: selectedCycle ?? null,
    weeklyChange: selectedDelta != null && Number.isFinite(selectedDelta) ? selectedDelta : null,
    oiChange: latest?.oiMove ?? null,
    commercialCycle: latest?.chCycle ?? null, largeCycle: latest?.ltCycle ?? null, smallCycle: latest?.stCycle ?? null,
    commercialNet: latest?.commercial_hedgers ?? null, largeNet: latest?.large_traders ?? null, smallNet: latest?.small_traders ?? null,
    confluence: (latest?.confluenceBull && !latest.confluenceBear ? "bullish" : latest?.confluenceBear && !latest.confluenceBull ? "bearish" : "none") as "bullish" | "bearish" | "none",
    largeMove: latest?.largeMove ?? false,
  };
}
