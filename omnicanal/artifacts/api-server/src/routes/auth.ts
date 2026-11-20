import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import {
  LoginBody,
  LoginResponse,
  GetCurrentUserResponse,
  ChangePasswordBody,
  ChangePasswordResponse,
  LogoutResponse,
} from "@workspace/api-zod";
import {
  getAdminCredentials,
  verifyPassword,
  hashPassword,
  safeEqual,
  signToken,
  siteLoginOnly,
  type AuthUser,
} from "../lib/auth";
import { clearPresence, touchPresence } from "../lib/presence";
import { sortViews, viewsForUser } from "../lib/view-access";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  if (siteLoginOnly()) {
    res.status(403).json({ error: "Aquí se entra con la cuenta del sitio: abre la administración del sitio." });
    return;
  }
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const { password } = parsed.data;
  const unauthorized = () => res.status(401).json({ error: "Credenciales inválidas." });

  // 1) Administrator (credentials come from the environment)
  const admin = getAdminCredentials();
  if (admin && safeEqual(email, admin.email.trim().toLowerCase())) {
    if (!safeEqual(password, admin.password)) {
      unauthorized();
      return;
    }
    const user: AuthUser = { role: "admin", name: "Administrador", email: admin.email, agentId: null };
    res.json(LoginResponse.parse({ token: signToken(user), user: { ...user, views: sortViews(await viewsForUser(user)) } }));
    return;
  }

  // 2) Human agent (password hash stored on the agent row)
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(sql`lower(${agentsTable.email}) = ${email}`);
  if (!agent || agent.type !== "human" || !agent.isActive) {
    unauthorized();
    return;
  }
  if (!(await verifyPassword(password, agent.passwordHash))) {
    unauthorized();
    return;
  }

  // Signing in is what makes an agent appear connected; their stored status is
  // only the availability they picked last time (available or busy) and is left
  // untouched here.
  touchPresence(agent.id);

  // Human users with role "admin" get admin session capabilities; everyone else logs in as an agent.
  const user: AuthUser = {
    role: agent.role === "admin" ? "admin" : "agent",
    name: agent.name,
    email: agent.email,
    agentId: agent.id,
  };
  // Las vistas van en la respuesta (no en el token): el panel arma su menú con
  // ellas, y el servidor las vuelve a leer de la base en cada petición.
  res.json(LoginResponse.parse({ token: signToken(user), user: { ...user, views: sortViews(await viewsForUser(user)) } }));
});

// Signing out ends the session, so the roster shows the agent as disconnected
// right away instead of waiting for the heartbeat to go stale. Their stored
// availability survives for the next sign-in.
router.post("/auth/logout", requireAuth, (req, res): void => {
  const agentId = req.user?.agentId;
  if (agentId) clearPresence(agentId);
  res.json(LogoutResponse.parse({ ok: true }));
});

// También es como el panel se entera de que le cambiaron las vistas sin tener que
// cerrar sesión.
router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  res.json(GetCurrentUserResponse.parse({ ...user, views: sortViews(await viewsForUser(user)) }));
});

// Self-service password change. Only works for accounts backed by an agent row:
// the environment administrator's password lives in ADMIN_PASSWORD, not in the DB.
router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres." });
    return;
  }

  const agentId = req.user?.agentId;
  if (!agentId) {
    res.status(400).json({
      error: "Esta cuenta se administra por variables de entorno y no puede cambiar su contraseña aquí.",
    });
    return;
  }

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent || agent.type !== "human" || !agent.isActive) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }

  const { currentPassword, newPassword } = parsed.data;
  if (!(await verifyPassword(currentPassword, agent.passwordHash))) {
    res.status(401).json({ error: "La contraseña actual no es correcta." });
    return;
  }
  if (currentPassword === newPassword) {
    res.status(400).json({ error: "La nueva contraseña debe ser distinta de la actual." });
    return;
  }

  await db
    .update(agentsTable)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(agentsTable.id, agentId));

  res.json(ChangePasswordResponse.parse({ ok: true }));
});

export default router;
