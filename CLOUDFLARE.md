# Cloudflare Free + GitHub Actions

This target uses **Workers Free, Static Assets, the existing D1 database, and standard
GitHub Actions runners in a public repository**. It does not use paid CPU limits,
Cloudflare Workflows, Hyperdrive, an external PostgreSQL provider, or a Replit
process to keep production updated. Replit's PostgreSQL preview stays separate.

## How it works

- Cloudflare serves the React dashboard and lightweight `/api/*` reads.
- A Free-plan Cron runs every ten minutes. A timezone-aware gate checks for the
  Friday 3:30 p.m. America/New_York release, daily catch-up, and delayed-report
  retries. The timer dispatches a GitHub workflow; it does not collect or calculate.
- The GitHub job downloads both official Legacy Futures Only and Combined reports.
  It prepares the default scanner and public history responses outside Workers.
- D1 stages immutable per-market records. A fenced atomic batch switches a
  report's pointer only after raw histories, public histories, and scanner output
  are complete. Failed jobs retain last-good reports. Expired leases recover.
- Unchanged report dates normally require metadata checks only. The website's
  Rescan CFTC button requests a full refresh, with a shared fifteen-minute cooldown.
- Default sector/watchlist scans use prepared responses. Custom rule settings use
  a background browser worker and the same shared calculation engine. Histories
  are cached in that worker by immutable snapshot. Mixed snapshots are rejected.
- Stale reports never produce active setups, even if every later collection fails.

GitHub's `schedule` event is intentionally not the primary timer: scheduled public
workflows can be disabled after repository inactivity. This workflow uses
`workflow_dispatch`, called by Cloudflare. GitHub jobs can still queue or fail;
retry timing is not a guarantee of an exact publication minute.

## Build and test without publishing

```sh
pnpm install --frozen-lockfile
pnpm cloudflare:test
pnpm cloudflare:check
```

The check type-checks, builds the dashboard and browser worker, then dry-runs the
Worker bundle. It does not publish. Tests use a local real D1 emulator, a REST
transport against it, and the bundled browser-worker code. They do not mutate
the production database or use real credentials.

## Cloudflare Git build settings

The active repository is the one shown in **Worker → Settings → Builds**.
Cloudflare onboarding can create a copy; do not assume an earlier source-export
repository is still the active build source.

| Setting | Value |
| --- | --- |
| Worker name | `cot-quant-dashboard` |
| Production branch | `main` |
| Root directory | `/` (repository root) |
| Build command | `pnpm cloudflare:build` |
| Deploy command | `pnpm cloudflare:publish-built` |
| Node | `24` |

Use Worker + Static Assets, not a frontend-only Pages deployment. Do not use
`pnpm run build`: it includes development-only packages that are not the
Cloudflare app. The Cloudflare-specific build supplies its own PORT and BASE_PATH.

`wrangler.jsonc` already names `cot-quant-data`. The publish command applies
additive D1 migrations, then publishes. Existing snapshots and histories are not
dropped. The new prepared-response tables are initially empty; the first GitHub
collection fills them before the Free-plan API can serve scans.

The Cloudflare build credential needs Workers deployment and account-scoped
**D1 Edit** permission for migrations. It does not need a Workflows permission.
Do not expose production bindings or deployment credentials to untrusted PR jobs.
Disable automatic preview builds before pushing a review branch if necessary.

## One-time automation permissions

Never paste credentials into chat, source files, Git URLs, or screenshots.
Use the providers' encrypted secret fields. Agent integrations are for setup;
these runtimes need their own narrowly scoped credentials.

### GitHub repository

Under the active repository's **Settings → Secrets and variables → Actions**:

1. Add repository **variable** `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.
2. Add repository **secret** `CLOUDFLARE_D1_TOKEN`: a Cloudflare API token with
   Account → D1 → Edit for the account containing `cot-quant-data`.
3. Optionally add **secret** `CFTC_APP_TOKEN` for an official Socrata app token.
   The collector works without it, subject to the source's rate limits.

The database ID comes from `wrangler.jsonc`, not another credential.
Enable GitHub Actions for the repository. Use standard `ubuntu-latest` runners;
do not enable larger runners, paid storage, or upload history artifacts. The
workflow has read-only source permissions and never commits data or publishes code.

### Cloudflare Worker

In **Worker → Settings → Variables and Secrets**:

1. Set encrypted **secret** `GITHUB_ACTIONS_TOKEN` to a fine-grained GitHub token,
   limited to the active repository with **Actions: Read and write** permission.
2. Confirm non-secret `GITHUB_REPOSITORY` matches the actual connected
   `owner/repository`. The checked-in configuration supplies it.
3. Leave `CFTC_WORKFLOW_REF` as `main`, or the trusted published branch.

The dispatch credential does not need permission to write repository contents.
Choose an expiry policy and rotate before expiry. Do not store a deployment token
in the browser. Missing automation credentials explicitly show updates disabled;
refresh requests return a setup error rather than claiming collection started.

## Final launch (user action)

1. Review/merge the prepared code into the connected repository when ready to
   publish, or use the Cloudflare dashboard's build/deploy action.
2. Confirm the build and additive migrations succeed. No Workers Paid upgrade
   is required by this configuration.
3. Configure the runtime permissions above and publish those settings yourself.
4. Under GitHub **Actions → Update official CFTC data**, use **Run workflow** for
   the first collection, leaving `owner` empty. Alternatively, use the website's
   Rescan CFTC button after the Worker dispatch credential is configured.
5. Check `/api/healthz`, `/api/cot/update-status`, both scanner report modes,
   sector/watchlist pages, a custom setting, and single-market details.
6. Check real Cloudflare CPU metrics after launch: local tests cannot certify
   production's 10 ms CPU budget. Check D1 usage and GitHub job completion too.

Data updates change D1, not the code branch. They do not require republishing the
website. GitHub Actions remains the compute dependency; runner/service outages
are surfaced as stale or failed data, not fabricated neutral signals.

## Free limits and operational boundaries

- Workers Free: 100,000 dynamic requests/day and 10 ms CPU per invocation.
- Static asset requests are free and unlimited when they do not invoke the Worker.
- D1 Free: 500 MB per database, 5 GB total storage, 5 million rows read/day,
  and 100,000 rows written/day. Indexes and cleanup count toward usage.
- Custom scans initially download market histories. Slow devices/networks can
  take longer; progress is visible and calculations run off the UI thread.
- Keep one complete snapshot per report plus bounded staging/cleanup retention.
  Never delete the last-good report to recover from a failed collection.
- Free quotas are not unlimited capacity. Exceeding them can interrupt service;
  do not automatically enable billing or silently switch to a paid plan.
- Browser CSVs and preferences do not move to a new domain automatically. Export
  saved CSVs before changing domains. Production collection never deletes them.

References: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
