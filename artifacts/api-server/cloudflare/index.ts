import { handleApi } from "./api";
import { withDatabase } from "./database";
import { launchUpdate } from "./launcher";
import type { Env } from "./types";
export { CftcUpdateWorkflow } from "./workflow";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (path === "/api" || path.startsWith("/api/")) return handleApi(request, env, ctx, caches.default);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    await withDatabase(env, sql => launchUpdate(sql, env));
  },
} satisfies ExportedHandler<Env>;
