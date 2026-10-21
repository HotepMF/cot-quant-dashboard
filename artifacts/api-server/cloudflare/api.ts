import { parseSignalSettings, signalMarket } from "../src/services/cot-signal-model";
import { withDatabase } from "./database";
import { launchUpdate } from "./launcher";
import { readHistories, updateStatus, viewMetadata } from "./repository";
import { reportKey, type Env } from "./types";

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const unavailable = () => json({ message: "No complete CFTC data is available yet. Start the initial collection and check /api/cot/update-status." }, 503);

export async function handleApi(request: Request, env: Env, ctx?: ExecutionContext, cache?: Cache, database = withDatabase): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/healthz") return request.method === "GET" ? json({ status: "ok" }) : json({ message: "Method not allowed." }, 405);
  const known = ["/api/cot/update-status", "/api/cot/markets", "/api/cot/market", "/api/cot/screener", "/api/cot/screener/refresh"];
  if (!known.includes(path)) return json({ message: "API route not found." }, 404);
  if (request.method !== (path.endsWith("/refresh") ? "POST" : "GET")) return json({ message: "Method not allowed." }, 405);
  try {
    if (path === "/api/cot/update-status") return await database(env, async sql => json(await updateStatus(sql)));
    if (path.endsWith("/refresh")) {
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return json({ message: "Cross-origin refresh is not allowed." }, 403);
      const text = await request.text();
      if (text.length > 4096) return json({ message: "Request body is too large." }, 413);
      let body: { report?: unknown } | null;
      try { body = JSON.parse(text); } catch { return json({ message: "Expected a JSON request body." }, 400); }
      if (!reportKey(body?.report)) return json({ message: "Choose futures or combined." }, 400);
      return await database(env, async sql => {
        const launched = await launchUpdate(sql, env, true);
        const status = await updateStatus(sql);
        return json({
          status: launched || status.running ? "loading" : "ready",
          startedAt: status.lastAttemptAt ?? new Date().toISOString(),
        });
      });
    }
    const query: Record<string, string> = Object.create(null);
    for (const [key, value] of url.searchParams) {
      if (Object.hasOwn(query, key)) return json({ message: `Duplicate query parameter: ${key}.` }, 400);
      query[key] = value;
    }
    const report = reportKey(query.report);
    if (!report) return json({ message: "Choose futures or combined." }, 400);
    let settings;
    try { settings = parseSignalSettings(query); }
    catch (error) { return json({ message: error instanceof Error ? error.message : "Invalid settings." }, 400); }
    const marketName = query.market?.trim();
    if (path === "/api/cot/market" && (!marketName || marketName.length > 200)) return json({ message: "Choose a valid CFTC market." }, 400);
    return await database(env, async sql => {
      const view = await viewMetadata(sql, report);
      if (!view) return unavailable();
      if (path === "/api/cot/markets") return json({
        report, reportAsOf: view.reportAsOf, checkedAt: view.updatedAt, markets: view.markets,
      });
      if (path === "/api/cot/market") {
        if (!view.markets.some(m => m.name === marketName)) return json({ message: "Market is not in this official report." }, 404);
        const history = (await readHistories(sql, view, [marketName!])).get(marketName!);
        if (!history || history.error || !history.rows.length) return json({ message: "This market's official history has not finished collecting. Try again shortly." }, 503);
        return json({
          report, marketName, reportAsOf: view.reportAsOf, checkedAt: view.updatedAt,
          sourceWarning: view.status === "error" ? view.message : null,
          rows: history.rows.map(row => ({
            date: row.date, largeTraders: row.large_traders, smallTraders: row.small_traders,
            commercialHedgers: row.commercial_hedgers, openInterest: row.open_interest ?? null,
          })),
        });
      }
      const cacheUrl = new URL("/__cot_signal_cache", url.origin);
      cacheUrl.searchParams.set("view", JSON.stringify([report, view.updatedAt, new Date().toISOString().slice(0, 10), settings]));
      const cacheKey = new Request(cacheUrl);
      if (view.status === "ready" && cache) {
        const cached = await cache.match(cacheKey);
        if (cached) {
          const response = new Response(cached.body, cached);
          response.headers.set("Cache-Control", "no-store");
          return response;
        }
      }
      const markets = [];
      // Fetch and compute one bounded batch at a time; never load all raw histories.
      for (let i = 0; i < view.markets.length; i += 20) {
        const batch = view.markets.slice(i, i + 20);
        const histories = await readHistories(sql, view, batch.map(m => m.name));
        for (const market of batch) markets.push(signalMarket(market, histories.get(market.name), view.reportAsOf, settings));
      }
      const oldReport = Date.now() - Date.parse(`${view.reportAsOf}T00:00:00Z`) >= 10 * 86_400_000;
      const response = json({
        report, reportAsOf: view.reportAsOf, startedAt: view.startedAt, updatedAt: view.updatedAt,
        status: view.status, message: view.message ?? (oldReport ? "The official report is over nine days old; fresh setups are unavailable." : null),
        total: view.markets.length, processed: view.processed, settings, markets,
      });
      if (view.status === "ready" && cache && ctx) {
        const stored = response.clone();
        stored.headers.set("Cache-Control", "public, max-age=300");
        ctx.waitUntil(cache.put(cacheKey, stored));
      }
      return response;
    });
  } catch (error) {
    // Do not expose database errors, SQL, tokens, or credentials.
    console.error("cftc-api-failed", { path, kind: error instanceof Error ? error.name : "UnknownError" });
    return json({ message: "CFTC storage is temporarily unavailable. Check the Cloudflare database binding, schema setup, and Worker logs." }, 503);
  }
}
