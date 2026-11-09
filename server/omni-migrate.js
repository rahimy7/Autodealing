// `npm run omnicanal:migrate`: brings Omnicanal's database up to its schema now, in a terminal,
// so a change that would drop data can be confirmed. The site also does it on each start
// (server/omni-embed.js), where nobody can answer that question.
import { omniConfig } from "./omnicanal.js";
import { migrateOmnicanal } from "./omni-embed.js";

const cfg = omniConfig();
if (!cfg?.embedded) {
  console.log("Omnicanal no corre dentro de este servicio (falta OMNICANAL_DATABASE_URL): nada que actualizar.");
  process.exit(0);
}
const ok = await migrateOmnicanal(cfg, { stdio: "inherit", timeoutMs: 30 * 60_000 });
process.exit(ok ? 0 : 1);
