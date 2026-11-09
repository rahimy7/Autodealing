import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import { ListViewAccessResponse, UpdateViewAccessBody, UpdateViewAccessParams, UpdateViewAccessResponse } from "@workspace/api-zod";
import { isViewKey } from "@workspace/platform-config";
import { listViewAccess, setViews } from "../lib/view-access";

// Quién ve qué (2026-10-06). Lo cierra el prefijo /view-access de VIEW_GATES: solo
// entra quien tenga la vista Administración.
const router: IRouter = Router();

router.get("/view-access", async (_req, res): Promise<void> => {
  const humans = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.type, "human"));
  const access = await listViewAccess(humans.map((h) => h.id));
  res.json(ListViewAccessResponse.parse({ users: [...access].map(([agentId, views]) => ({ agentId, views })) }));
});

router.put("/view-access/:agentId", async (req, res): Promise<void> => {
  const params = UpdateViewAccessParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateViewAccessBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const unknown = body.data.views.filter((view) => !isViewKey(view));
  if (unknown.length > 0) {
    res.status(400).json({ error: `Vistas que no existen: ${unknown.join(", ")}.` });
    return;
  }
  const views = body.data.views.filter(isViewKey);
  if (views.length === 0) {
    res.status(400).json({ error: "Deja al menos una vista: sin ninguna, el usuario entraría a un panel vacío." });
    return;
  }

  const { agentId } = params.data;
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent || agent.type !== "human") {
    res.status(404).json({ error: "Usuario no encontrado." });
    return;
  }
  // Quitarse a sí mismo Administración es la forma de dejar el sistema sin quien
  // pueda devolver el acceso (el administrador de entorno siempre puede, pero no
  // todas las instancias lo tienen a mano).
  if (agentId === req.user?.agentId && !views.includes("admin")) {
    res.status(400).json({ error: "No puedes quitarte a ti mismo la vista Administración." });
    return;
  }

  res.json(UpdateViewAccessResponse.parse({ agentId, views: await setViews(agentId, views) }));
});

export default router;
