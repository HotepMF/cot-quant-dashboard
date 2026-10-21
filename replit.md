# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

### Automatic CFTC updates

- The Node/Replit API server runs its updater without requiring any browser or visitor. Cloudflare production dispatches a GitHub collection job instead.
- The user has chosen GitHub → Cloudflare Workers Free for production hosting with D1 storage, not external PostgreSQL or a paid Workers upgrade. Follow `CLOUDFLARE.md` and the root `cloudflare:*` commands. Replit's PostgreSQL database remains separate and unchanged.
- Replit development retains the original Node updater. Reserved VM hosting is only relevant if deliberately publishing that Node target instead; its in-process timer requires an always-on server.
- Release checks start Fridays at 3:30 p.m. America/New_York and retry every ten minutes through 8 p.m. if either report is missing. Delays and failures retry hourly outside that window; daily 6 a.m. checks catch missed releases. The Free target skips history downloads for unchanged report dates; a manual full refresh can pick up same-date revisions.
- Both Legacy Futures Only and Legacy Combined reports are collected. Complete successful scans are saved atomically (PostgreSQL in Replit, D1 snapshot pointers in Cloudflare); failed/partial scans do not replace the last successful saved snapshot.
- `GET /api/cot/update-status` exposes last attempt/success, next check, errors, and report dates. The dashboard refreshes automatically after successful updates.
- Replit database schema changes are applied in development with `pnpm --filter @workspace/db run push`; Replit production schema is applied by its Publish flow, never by startup DDL. Cloudflare's separate D1 migrations live in `deployment/cloudflare/migrations` and are applied explicitly by its deployment command.
- Cloudflare Free uses lightweight Cron-to-GitHub dispatch, pre-serialized D1 responses, and twenty-market staging batches in standard public-repository GitHub runners. D1 atomic batches enforce expiring lease ownership and complete raw/public histories plus prepared scanner output before a snapshot pointer swap. Custom scanner settings run in a browser worker with the shared engine; mixed snapshots are rejected. No paid CPU setting, Cloudflare Workflow, Hyperdrive, or external PostgreSQL is required. Runtime credentials must be set in provider secret stores before unattended updates work; do not publish or upgrade billing automatically.
- Schedule and outage/restart tests are in `artifacts/api-server/tests/`. Persistence integration tests require a successful initial application sync.

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
