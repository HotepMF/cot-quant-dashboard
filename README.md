# COT Quant Dashboard (zcot.trade)

A free research site for the CFTC Commitments of Traders report: who is positioned where in each futures
market, the core watchlist markets, an SPDR sectors page that connects positioning to the stock market, and
plain-English context on what the data can and can't tell you.

## How it runs

Everything runs on Cloudflare and GitHub:

| Piece | Where | What it does |
| --- | --- | --- |
| Website + API | Cloudflare Worker + static assets (`artifacts/api-server/cloudflare`, `artifacts/cot-quant-dashboard`) | Serves the dashboard and the `/api/*` reads from D1 |
| Database | Cloudflare D1 `cot-quant-data` (`deployment/cloudflare/migrations`) | Prepared CFTC snapshots, histories, sectors snapshot |
| CFTC collection | GitHub Actions `cftc-update.yml`, started by the Worker's 10-minute cron | Collects the weekly reports after the Friday release |
| Sectors snapshot | GitHub Actions `sectors-update.yml`, started on weekdays after 17:30 New York | End-of-day SPDR sector prices, positioning and yields |
| Invisible Hand numbers | A follow-on step in both workflows above (`hand-cli.ts`) | Weekly macro theme cards and participation rows, refreshed after each CFTC collection and each evening close |
| Deploys | Cloudflare Workers Builds on every merge to `main` | `pnpm cloudflare:build` then `pnpm cloudflare:publish-built` |

Setup, credentials and Free-plan limits: see [CLOUDFLARE.md](CLOUDFLARE.md).

## Repository map

- `artifacts/cot-quant-dashboard` — the React dashboard (Vite).
- `artifacts/api-server/cloudflare` — the Worker (API, cron launcher) and the GitHub job CLIs (`collect-cli.ts`, `sectors-cli.ts`, `hand-cli.ts`; `hand-cli.ts --dry-run` prints the snapshot without saving).
- `artifacts/api-server/tests` — Worker, collector, sectors, signal-rule and schedule tests (real D1 via Miniflare).
- `lib/cot-engine` — shared signal rules, core market list, sector and Invisible Hand definitions.
- `lib/api-spec` — the OpenAPI contract; `pnpm --filter @workspace/api-spec run codegen` regenerates `lib/api-client-react`.
- `deployment/cloudflare/migrations` — additive D1 migrations, applied on deploy.

## Developing locally

Requires Node 24. Run `corepack enable` once so the `pnpm` command (version pinned in `package.json`) is on your PATH.

```sh
pnpm install --frozen-lockfile
pnpm dev:live   # dashboard on http://127.0.0.1:5173 with /api proxied to zcot.trade (real data, read-only)
```

To work on the Worker API itself:

```sh
pnpm dev:api    # local Worker on :8787 with a local D1 (migrations applied, starts empty)
pnpm dev        # dashboard on :5173 with /api proxied to the local Worker
```

The local D1 has no CFTC data until something writes to it, so most API behavior is easiest to check
through the tests, which run the real Worker and D1 runtime:

```sh
pnpm cloudflare:test
pnpm cloudflare:check   # type checks, production build and a deploy dry run; publishes nothing
```

On Windows, run builds from PowerShell rather than Git Bash: Git Bash rewrites `BASE_PATH=/` into a Windows
path, which breaks the built site's asset URLs.
