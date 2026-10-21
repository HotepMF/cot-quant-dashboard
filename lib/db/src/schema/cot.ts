import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** One atomic, last-successful official snapshot per Legacy report type. */
export const cotSnapshotsTable = pgTable("cot_snapshots", {
  report: text("report").primaryKey(),
  reportAsOf: text("report_as_of").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  payload: jsonb("payload").notNull(),
});

export const cotUpdateStateTable = pgTable("cot_update_state", {
  id: text("id").primaryKey(),
  running: boolean("running").notNull().default(false),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull(),
  lastError: text("last_error"),
});

/** Cloudflare uses expiring, fenced row leases instead of session advisory locks. */
export const cotCloudflareLeasesTable = pgTable("cot_cf_leases", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const cotCloudflareRunsTable = pgTable("cot_cf_runs", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  report: text("report").notNull(),
  reportAsOf: text("report_as_of").notNull(),
  state: text("state").notNull(),
  markets: jsonb("markets").notNull(),
  processed: integer("processed").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const cotCloudflareHistoriesTable = pgTable("cot_cf_histories", {
  runId: text("run_id").notNull().references(() => cotCloudflareRunsTable.id, { onDelete: "cascade" }),
  marketName: text("market_name").notNull(),
  history: jsonb("history").notNull(),
}, table => [primaryKey({ columns: [table.runId, table.marketName] })]);
