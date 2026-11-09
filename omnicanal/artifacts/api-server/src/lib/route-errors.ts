import type { NextFunction, Request, Response } from "express";
import type { AuthUser } from "./auth";
import type { Actor } from "./inventory";

// Los errores de negocio de inventario, despachos, compras y postventa (falta
// stock, un pedido que ya salió, un despacho cerrado) llevan su `status` (409,
// 404, 400) y un mensaje para la persona. El manejador global de la app los
// convertiría en un 500 genérico; este envoltorio los devuelve tal cual y deja
// pasar lo demás.
type DomainError = Error & { status: number; details?: Record<string, unknown> };

function isDomainError(err: unknown): err is DomainError {
  if (!(err instanceof Error)) return false;
  const status = (err as unknown as { status?: unknown }).status;
  return typeof status === "number" && status < 500;
}

export function withDomainErrors(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handler(req, res);
    } catch (err) {
      if (isDomainError(err)) {
        res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
        return;
      }
      next(err);
    }
  };
}

/** Quién hace el movimiento, para el libro y el expediente. */
export function actorFrom(user: AuthUser | undefined): Actor {
  return { agentId: user?.agentId ?? null, label: user?.name?.trim() || "Equipo" };
}

export function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}
