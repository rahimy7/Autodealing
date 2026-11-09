import { Router, type IRouter } from "express";
import { clientConfig, coreVersion, enabledChannels, enabledModules } from "../lib/client-config";
import { db, tenantOverridesTable } from "@workspace/db";
import type { ModuleKey } from "@workspace/platform-config";

const router: IRouter = Router();

// Identidad de la instancia. Es público a propósito: la pantalla de login ya
// necesita el nombre, el logo y el color del cliente, antes de que haya sesión.
// Por eso la configuración solo contiene marca y forma del producto — las
// credenciales viven en el entorno y en la base de datos, nunca aquí.
//
// Que la marca se sirva en tiempo de ejecución es lo que permite una sola imagen
// para los 50 clientes: la instancia no se compila distinto, se configura
// distinto.
router.get("/config", async (_req, res) => {
  res.set("Cache-Control", "no-store");

  // Mezcla los overrides de la BD sobre la configuración estática.
  const [row] = await db.select().from(tenantOverridesTable).orderBy(tenantOverridesTable.id).limit(1);

  let branding = clientConfig.branding;
  let modules = clientConfig.modules;

  if (row) {
    if (row.brandingJson) {
      try {
        const overrides = JSON.parse(row.brandingJson) as Partial<typeof branding>;
        branding = { ...branding, ...overrides };
      } catch { /* usa el estático */ }
    }
    if (row.modulesJson) {
      try {
        const overrides = JSON.parse(row.modulesJson) as Partial<Record<ModuleKey, boolean>>;
        modules = { ...modules, ...overrides };
      } catch { /* usa el estático */ }
    }
  }

  res.json({
    client: { ...clientConfig, branding, modules },
    channels: enabledChannels(),
    modules: enabledModules(),
    subscriptionStatus: row?.subscriptionStatus ?? "active",
    core: {
      version: coreVersion,
      environment: process.env["NODE_ENV"] ?? "development",
      commit: process.env["RAILWAY_GIT_COMMIT_SHA"]?.slice(0, 7) ?? null,
    },
  });
});

export default router;

