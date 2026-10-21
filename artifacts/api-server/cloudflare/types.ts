import type { RawRow } from "@workspace/cot-engine";

export type ReportKey = "futures" | "combined";
export type Market = { name: string; code: string };
export type History = { rows: RawRow[]; error: string | null };
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CFTC_UPDATER: Workflow<{ owner: string }>;
  CFTC_APP_TOKEN?: string;
}
export const JOB_ID = "weekly-cftc";
export const REPORTS = ["futures", "combined"] as const;
export const reportKey = (value: unknown): ReportKey | undefined => value === "futures" || value === "combined" ? value : undefined;
