# COT Quant Dashboard: GitHub → Cloudflare

The Cloudflare target uses **Workers + Static Assets + D1 + Workflows + Cron**.
No Neon, Supabase, Hyperdrive, or separate database account is needed.
Replit development keeps its original Node server and PostgreSQL database.
Preparing this repository does not publish a Worker.

## Database

`wrangler.jsonc` binds `DB` to the dedicated `cot-quant-data` D1 database.
Its database ID is a resource identifier, not a password.
The initial schema is in `deployment/cloudflare/migrations/0001_cot.sql`.
The deployment command applies pending D1 migrations before publishing the Worker.
This does not run migrations against Replit PostgreSQL.

The Cloudflare database starts empty. It will collect official CFTC data itself
after publishing; no Replit database dump or credentials need to be exported.
Do not commit `.env`, `.dev.vars`, credentials, database backups, or generated output.

## Verify without publishing

Run from the repository root with Node 24 and pnpm 10.26.1:

```sh
pnpm install --frozen-lockfile
pnpm cloudflare:test
pnpm cloudflare:check
```

Tests exercise real local D1 through Wrangler's Miniflare runtime. They do not
connect to Replit PostgreSQL or mutate the Cloudflare production database.
`cloudflare:check` type-checks shared libraries and Worker code, builds the React
dashboard, and bundles the Worker in dry-run mode. It does not publish.

## Connect the GitHub repository in Cloudflare

In **Workers & Pages**, create a Worker by importing the GitHub repository.
Authorize Cloudflare's GitHub app for this repository if prompted; Replit's GitHub
authorization is separate from the GitHub authorization used by Cloudflare Builds.

Use:

| Setting | Value |
| --- | --- |
| Worker name | `cot-quant-dashboard` |
| Root directory | repository root |
| Build command | `pnpm cloudflare:build` |
| Deploy command | `pnpm cloudflare:publish-built` |
| Node version | `24` |
| Production branch | `main` |

The build sets `PORT=5173` and `BASE_PATH=/` itself. Dashboard output is
`artifacts/cot-quant-dashboard/dist/public`. Do not select a frontend-only Pages
deployment: the API, Cron, and Workflow must also be deployed.

Review current Cloudflare pricing and usage limits before enabling paid service.
Workers Paid is recommended for full-market signal computation; the free HTTP
CPU limit is too restrictive for this workload. D1 and Workflows also have usage
limits. This preparation does not upgrade the account or approve charges.

Limit automatic production deployments to the intended release branch.
Do not bind production D1, Cron, or Workflows to untrusted pull-request previews.
Click Cloudflare's deploy action only when ready to publish.

## What publishing does

`cloudflare:publish-built` validates the configured D1 ID, applies pending D1
migrations, and publishes the already-built Worker. For a trusted manual terminal,
`pnpm cloudflare:deploy` builds first, then runs the same publishing command.
These commands **publish to Cloudflare**; do not run them as a local check.
Authentication belongs in Cloudflare's secure browser/CI setup, never in code.

Wrangler configures the D1 binding, the `cot-cftc-updater` Workflow, static assets,
and the ten-minute Cron schedule together. No always-on Node process is required.

## Initial collection and verification

Use the actual URL shown by Cloudflare after publishing; do not invent a hostname.
The next scheduled invocation starts collection within approximately ten minutes.
To start immediately, use the dashboard refresh control, or POST:

```sh
curl -X POST https://YOUR-ACTUAL-WORKER-URL/api/cot/screener/refresh \
  -H 'Content-Type: application/json' --data '{"report":"futures"}'
```

Either report's refresh starts the shared futures + combined Workflow. Requests
coalesce and have a global fifteen-minute cooldown.
Until initial collection finishes, data endpoints return explicit HTTP 503
responses rather than fabricated data. Follow progress at `/api/cot/update-status`
and in the Cloudflare Workflows dashboard.

Verify:

- `/api/healthz` returns `{"status":"ok"}`.
- `/api/cot/update-status` shows both report dates, success, and the next check.
- `/api/cot/markets?report=futures` and `?report=combined` show exact market names.
- `/api/cot/screener?report=futures` shows genuine signals and coverage.
- `/`, `/sector-signals`, and `/signal-watchlist` survive direct navigation/reload.
- Individual markets, sector filters, signal settings, and CSV mode work.
- Scheduled collection runs without an open browser.
- A failed or partial collection preserves the last complete saved snapshot.

Browser-local CSV imports and preferences do not automatically transfer to a new
hostname. Export any CSV data you want to keep before changing domains.

## Storage and scheduling safeguards

- D1 stores one bounded history per market, not an oversized whole-report JSON row.
- Atomic D1 batches guard lease ownership and complete market coverage before
  changing the saved snapshot pointer. Retries are idempotent.
- All coordination starts with a primary-consistent D1 session.
- Old/expired workflows and older report dates cannot replace newer saved data.
- Last-good snapshots are retained indefinitely. Unreferenced staging runs expire
  after an hour when a later collection finishes, allowing in-flight reads to settle.
- Cron runs in UTC; due-time calculations use `America/New_York` with DST handling.
- Friday checks start at 15:30 Eastern and retry delayed releases. Daily checks
  catch corrections, including after a missed release.
- API reads use twenty-market batches. Completed signal responses are internally
  cached for five minutes by snapshot timestamp, settings, report, and UTC day.
- Browser API responses remain `Cache-Control: no-store`.

Add a custom domain only after the temporary Cloudflare URL passes verification.
Preserve email DNS records and do not apply blanket caching to `/api/*`.

References:
[D1](https://developers.cloudflare.com/d1/),
[Static assets](https://developers.cloudflare.com/workers/static-assets/),
[Workflows](https://developers.cloudflare.com/workflows/),
[Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
