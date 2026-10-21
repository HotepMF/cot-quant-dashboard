import { db, cotSnapshotsTable } from "@workspace/db";
import { eq, lte } from "drizzle-orm";
import type { RawRow } from "@workspace/cot-engine";
import type { ReportKey } from "../routes/cot";

export type SnapshotPayload = {
  version: 1;
  markets: { name: string; code: string }[];
  histories: Record<string, { rows: RawRow[]; error: string | null }>;
};
export type CotSnapshot = SnapshotPayload & { report: ReportKey; reportAsOf: string; checkedAt: string };

export async function loadSnapshot(report: ReportKey): Promise<CotSnapshot | null> {
  const [record] = await db.select().from(cotSnapshotsTable).where(eq(cotSnapshotsTable.report, report)).limit(1);
  if (!record) return null;
  const payload = record.payload as SnapshotPayload;
  if (payload?.version !== 1 || !Array.isArray(payload.markets) || !payload.histories || typeof payload.histories !== "object") {
    throw new Error("The saved CFTC snapshot has an unsupported format.");
  }
  return { ...payload, report, reportAsOf: record.reportAsOf, checkedAt: record.checkedAt.toISOString() };
}

export async function saveSnapshot(snapshot: CotSnapshot) {
  // Only a fully verified source snapshot may replace the last successful one.
  if (!snapshot.markets.length || snapshot.markets.some(m => !snapshot.histories[m.name] || snapshot.histories[m.name].error)) {
    throw new Error("An incomplete CFTC scan cannot replace the saved snapshot.");
  }
  const values = {
    report: snapshot.report, reportAsOf: snapshot.reportAsOf, checkedAt: new Date(snapshot.checkedAt),
    payload: { version: 1, markets: snapshot.markets, histories: snapshot.histories } satisfies SnapshotPayload,
  };
  await db.insert(cotSnapshotsTable).values(values).onConflictDoUpdate({
    target: cotSnapshotsTable.report,
    set: { reportAsOf: values.reportAsOf, checkedAt: values.checkedAt, payload: values.payload },
    // Never overwrite a newer report if another refresh completed out of order.
    setWhere: lte(cotSnapshotsTable.reportAsOf, snapshot.reportAsOf),
  });
}

export function savedMarketHistory(snapshot: CotSnapshot, marketName: string) {
  const rows = snapshot.histories[marketName]?.rows;
  if (!rows || rows.length < 3) return null;
  return {
    report: snapshot.report, marketName, reportAsOf: rows.at(-1)!.date, checkedAt: snapshot.checkedAt,
    sourceWarning: "CFTC is temporarily unavailable. Showing the last successfully saved observations.",
    rows: rows.map(row => ({
      date: row.date, largeTraders: row.large_traders, smallTraders: row.small_traders,
      commercialHedgers: row.commercial_hedgers, openInterest: row.open_interest ?? null,
    })),
  };
}
