import { Router, type IRouter } from "express";
import { viewsForUser } from "../lib/view-access";
import { isModuleEnabled } from "../lib/client-config";
import { navEntries } from "../lib/nav";

const router: IRouter = Router();

// El menú de quien tiene sesión. Lo pide la administración del sitio, que muestra
// estas pantallas dentro de su propio menú (ver server/crm.js en el sitio).
router.get("/nav", async (req, res): Promise<void> => {
  const views = await viewsForUser(req.user!);
  res.json({ entries: navEntries(views, isModuleEnabled) });
});

export default router;
