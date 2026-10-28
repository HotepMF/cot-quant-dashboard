import { defaultSignalSettings, parseSignalSettings } from "@workspace/cot-engine";
import { statement, withDatabase } from "./database";
import { automationConfigured, launchUpdate } from "./launcher";
import { updateStatus, viewMetadata } from "./repository";
import { reportKey, type Env } from "./types";

export const json = (body: unknown, status = 200) => response(JSON.stringify(body), status);
const response = (payload: string, status = 200, snapshot?: string) => new Response(payload, {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-COT-Server-Time": String(Date.now()), ...(snapshot ? { "X-COT-Snapshot": snapshot } : {}) },
});
/** Snapshot documents served as stored. */
const DOCUMENTS: Record<string, { key: string; name: string }> = {
  "/api/sectors": { key: "sectors", name: "sectors snapshot" },
  "/api/invisible-hand": { key: "invisible-hand", name: "Invisible Hand snapshot" },
  "/api/demo-account": { key: "demo-account", name: "demo account" },
  "/api/curves": { key: "curves", name: "futures curve snapshot" },
  "/api/oscillators": { key: "oscillators", name: "oscillator snapshot" },
  "/api/case-log": { key: "case-log", name: "8-week reading record" },
};
const unavailable = () => json({ message: "No complete prepared CFTC data is available yet. Configure GitHub automation and run the initial update." }, 503);

export async function handleApi(request: Request, env: Env, ctx?: ExecutionContext, cache?: Cache, database = withDatabase): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/healthz") return request.method === "GET" ? json({ status: "ok" }) : json({ message: "Method not allowed." }, 405);
  const document = DOCUMENTS[path];
  if (document) {
    if (request.method !== "GET") return json({ message: "Method not allowed." }, 405);
    try {
      // Pre-serialized snapshot written by a GitHub job; the Worker only forwards it.
      return await database(env, async sql => {
        const saved = await statement(sql, "SELECT payload FROM cot_cf_documents WHERE key=?", document.key).first<{ payload: string }>();
        return saved ? response(saved.payload) : json({ message: `The ${document.name} has not been prepared yet.` }, 503);
      });
    } catch (error) {
      console.error("document-api-failed", { key: document.key, kind: error instanceof Error ? error.name : "UnknownError" });
      return json({ message: `${document.name[0].toUpperCase()}${document.name.slice(1)} storage is temporarily unavailable.` }, 503);
    }
  }
  if (!["/api/cot/update-status", "/api/cot/markets", "/api/cot/market", "/api/cot/screener", "/api/cot/screener/refresh"].includes(path)) return json({ message: "API route not found." }, 404);
  if (request.method !== (path.endsWith("/refresh") ? "POST" : "GET")) return json({ message: "Method not allowed." }, 405);
  try {
    if (path === "/api/cot/update-status") return await database(env, async sql => {
      const status = await updateStatus(sql);
      const enabled = automationConfigured(env);
      return json({ ...status, enabled, lastError: enabled ? status.lastError : "Automatic updates are not configured. Connect the GitHub workflow and its scoped credentials." });
    });
    if (path.endsWith("/refresh")) {
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return json({ message: "Cross-origin refresh is not allowed." }, 403);
      const text = await request.text();
      if (text.length > 4096) return json({ message: "Request body is too large." }, 413);
      let body: { report?: unknown } | null;
      try { body = JSON.parse(text); } catch { return json({ message: "Expected a JSON request body." }, 400); }
      if (!reportKey(body?.report)) return json({ message: "Choose futures or combined." }, 400);
      if (!automationConfigured(env)) return json({ message: "Automatic updates require the GitHub workflow connection before collection can start." }, 503);
      return await database(env, async sql => {
        const launched = await launchUpdate(sql, env, true);
        const status = await updateStatus(sql);
        return json({ status: launched || status.running ? "loading" : "ready", startedAt: status.lastAttemptAt ?? new Date().toISOString() });
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
    if (path === "/api/cot/screener" && Object.entries(defaultSignalSettings).some(([k, v]) => settings[k as keyof typeof settings] !== v)) {
      return json({ message: "The Free-plan API serves the default prepared scan. The website evaluates custom settings locally in a background browser worker." }, 400);
    }
    return await database(env, async sql => {
      // Never expose partially staged histories during a background update.
      const view = await viewMetadata(sql, report, true);
      if (!view) return unavailable();
      const requestedSnapshot = request.headers.get("X-COT-Snapshot");
      if (requestedSnapshot && requestedSnapshot !== view.runId) return json({ message: "The official dataset changed during this scan. Try again to use one consistent snapshot." }, 409);
      if (path === "/api/cot/markets") return json({ report, reportAsOf: view.reportAsOf, checkedAt: view.updatedAt, markets: view.markets });
      // Overdue only once the next Friday release has passed (day 11 from the Tuesday as-of date), matching signals.ts.
      const old = Date.now() - Date.parse(`${view.reportAsOf}T00:00:00Z`) >= 11 * 86_400_000;
      if (path === "/api/cot/market" && !view.markets.some(m => m.name === marketName)) return json({ message: "Market is not in this official report." }, 404);
      const cacheKey = new Request(new URL(`/__cot_prepared/${encodeURIComponent(view.runId)}/${old ? "stale" : "current"}/${encodeURIComponent(marketName ?? "scan")}`, url.origin));
      const hit = cache ? await cache.match(cacheKey) : undefined;
      if (hit) return response(await hit.text(), 200, view.runId);
      const saved = path === "/api/cot/market"
        ? await statement(sql, "SELECT payload FROM cot_cf_public_histories WHERE run_id=? AND market_name=?", view.runId, marketName!).first<{ payload: string }>()
        : await statement(sql, `SELECT ${old ? "stale_payload" : "payload"} AS payload FROM cot_cf_signals WHERE run_id=?`, view.runId).first<{ payload: string }>();
      if (!saved) return unavailable();
      // Forward pre-serialized data: no history parsing, mapping or quant work here.
      const result = response(saved.payload, 200, view.runId);
      if (cache && ctx) {
        const cached = result.clone();
        cached.headers.set("Cache-Control", "public, max-age=300");
        ctx.waitUntil(cache.put(cacheKey, cached));
      }
      return result;
    });
  } catch (error) {
    console.error("cftc-api-failed", { path, kind: error instanceof Error ? error.name : "UnknownError" });
    return json({ message: path.endsWith("/refresh")
      ? "The GitHub update job could not be started. Check automation permissions and Worker logs. Last-good data has been retained."
      : "CFTC storage is temporarily unavailable. Check database migrations and Worker logs." }, 503);
  }
}
