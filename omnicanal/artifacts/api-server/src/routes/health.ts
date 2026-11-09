import { Router, type IRouter } from "express";
import { db, agentsTable } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";
import { clientConfig, coreVersion } from "../lib/client-config";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Liveness (/healthz) only proves the process is up — it answers "ok" while every
// query fails, which makes a broken database look like a healthy deploy. This
// exercises the connection so the failure is visible without digging through logs.
// `select 1` no sirve: pasa igual sin una sola tabla del esquema (por ejemplo con
// el search_path vacío que entregó el pooler de Neon el 2026-09-17, tumbando el
// servidor con este endpoint en verde). Se consulta una tabla real del esquema.
router.get("/readyz", async (req, res) => {
  try {
    await db.select({ id: agentsTable.id }).from(agentsTable).limit(1);
    // Se responde también quién es la instancia y con qué core corre: es lo que
    // deja inventariar 50 despliegues desde fuera, sin entrar a cada uno.
    res.json({ status: "ok", db: "ok", client: clientConfig.id, coreVersion });
  } catch (err) {
    const cause = err instanceof Error ? err.cause : undefined;
    req.log.error({ err, cause }, "readiness check failed");
    res.status(503).json({
      status: "error",
      db: "unreachable",
      client: clientConfig.id,
      coreVersion,
      message: err instanceof Error ? err.message : String(err),
      cause: cause instanceof Error ? cause.message : undefined,
    });
  }
});

export default router;
