import type { RequestHandler } from "express";
import type { ViewKey } from "@workspace/platform-config";
import { verifyToken, type AuthUser } from "../lib/auth";
import { touchPresence } from "../lib/presence";
import { hasAnyView, viewsForPath } from "../lib/view-gates";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Vistas del panel que tiene el usuario (tabla view_access); las pone loadViewAccess. */
      views?: ReadonlySet<ViewKey>;
    }
  }
}

// Rejects the request unless it carries a valid `Authorization: Bearer <token>`.
export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const user = token ? verifyToken(token) : null;

  if (!user) {
    res.status(401).json({ error: "No autenticado." });
    return;
  }

  req.user = user;
  // Any authenticated call is proof the session is alive, so presence follows the
  // session rather than one dedicated endpoint: a panel that is loading chats
  // counts as connected even if its heartbeat timer was throttled, and after a
  // server restart the roster refills on the next request instead of waiting out
  // a full beat.
  if (user.agentId) touchPresence(user.agentId);
  next();
};

// Deja pasar solo a quien tenga alguna de estas vistas: un endpoint que es de una
// pantalla lo abre quien tiene esa pantalla, sea cual sea su rol (antes era
// "solo administradores"). Corre después de loadViewAccess.
export const requireView =
  (...views: ViewKey[]): RequestHandler =>
  (req, res, next) => {
    if (hasAnyView(req.views, views)) {
      next();
      return;
    }
    res.status(403).json({ error: "Tu usuario no tiene acceso a esta vista." });
  };

// Cierra por prefijo los endpoints que son de una pantalla (ver VIEW_GATES): los
// routers cuyos endpoints son todos de una vista no repiten la comprobación uno
// por uno. Corre después de loadViewAccess.
export const viewGatedPaths: RequestHandler = (req, res, next) => {
  const needed = viewsForPath(req.path);
  if (!needed) {
    next();
    return;
  }
  requireView(...needed)(req, res, next);
};

// Super-admin: protege las rutas del portal de plataforma (/platform-admin/*).
// Usa un token estático en lugar de sesión: es una clave de API que solo conoce
// el operador de la plataforma, separada por completo de las credenciales de los
// clientes finales.
export const requirePlatformAdmin: RequestHandler = (req, res, next) => {
  const token = process.env["PLATFORM_ADMIN_TOKEN"];
  if (!token) {
    res.status(503).json({ error: "Portal de plataforma no habilitado en esta instancia." });
    return;
  }
  const header = req.header("x-platform-token");
  if (!header || header !== token) {
    res.status(401).json({ error: "Token de plataforma inválido." });
    return;
  }
  next();
};
