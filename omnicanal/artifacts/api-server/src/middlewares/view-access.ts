import type { RequestHandler } from "express";
import { viewsForUser } from "../lib/view-access";

// Resuelve las vistas del usuario ya autenticado y las deja en `req.views`. Está
// aparte de requireAuth porque ésta es la única que habla con la base de datos, y
// va justo detrás de ella en la cadena.
export const loadViewAccess: RequestHandler = async (req, _res, next) => {
  try {
    if (req.user) req.views = await viewsForUser(req.user);
    next();
  } catch (err) {
    next(err);
  }
};
