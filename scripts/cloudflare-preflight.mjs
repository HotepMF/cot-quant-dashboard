import { readFileSync } from "node:fs";
const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const id = /"database_id"\s*:\s*"([^"]+)"/.exec(config)?.[1];
if (!id || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || /^0[-0]*$/.test(id)) {
  console.error("Cloudflare setup is incomplete. Configure the D1 database ID in wrangler.jsonc and apply its migrations. Follow CLOUDFLARE.md. Nothing has been published.");
  process.exit(1);
}
