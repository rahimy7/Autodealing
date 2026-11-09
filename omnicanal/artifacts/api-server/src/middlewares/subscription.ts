import type { RequestHandler } from "express";
import { db, tenantOverridesTable } from "@workspace/db";

// Rutas que no se bloquean aunque la suscripción esté suspendida.
const PUBLIC_PATHS = ["/config", "/health", "/auth/login", "/platform-admin/tenant"];

let cachedStatus: { blocked: boolean; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // re-verifica cada 60 s

async function isBlocked(): Promise<boolean> {
  const now = Date.now();
  if (cachedStatus && now - cachedStatus.fetchedAt < CACHE_TTL_MS) {
    return cachedStatus.blocked;
  }

  const [row] = await db.select().from(tenantOverridesTable).orderBy(tenantOverridesTable.id).limit(1);
  if (!row) {
    cachedStatus = { blocked: false, fetchedAt: now };
    return false;
  }

  const manualBlock = row.blockedManually;
  const suspended = row.subscriptionStatus === "suspended";
  const overduePayment =
    row.subscriptionPaidUntil !== null && new Date() > row.subscriptionPaidUntil && row.subscriptionStatus !== "trial";

  const blocked = manualBlock || suspended || overduePayment;
  cachedStatus = { blocked, fetchedAt: now };
  return blocked;
}

/** Invalida el caché para que el próximo request vuelva a consultar la BD. */
export function invalidateSubscriptionCache() {
  cachedStatus = null;
}

export const checkSubscription: RequestHandler = async (req, res, next) => {
  const path = req.path;
  if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    next();
    return;
  }

  try {
    const blocked = await isBlocked();
    if (blocked) {
      res.status(402).json({
        error: "Servicio suspendido. Regulariza el pago o contacta al administrador de la plataforma.",
        code: "SUBSCRIPTION_SUSPENDED",
      });
      return;
    }
  } catch {
    // Si la BD falla no bloqueamos: es mejor dejar pasar que tirar el servicio.
  }

  next();
};
