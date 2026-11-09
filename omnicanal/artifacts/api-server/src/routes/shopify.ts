import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, integrationSettingsTable, type IntegrationSettings } from "@workspace/db";
import {
  GetShopifySettingsResponse,
  UpdateShopifySettingsBody,
  UpdateShopifySettingsResponse,
  TestShopifyConnectionResponse,
  SyncShopifyNowResponse,
} from "@workspace/api-zod";
import { SHOPIFY_API_VERSION, forgetShopifyToken, normalizeShopDomain, testShopifyConnection } from "../lib/shopify";
import { runShopifySyncNow } from "../lib/shopify-sync";
import { refreshSubscribersSoon } from "../lib/shopify-subscribers";
import { badRequest } from "../lib/route-errors";

const router: IRouter = Router();

async function getOrCreateSettings(): Promise<IntegrationSettings> {
  const [row] = await db.select().from(integrationSettingsTable).orderBy(integrationSettingsTable.id).limit(1);
  if (row) return row;
  const [created] = await db.insert(integrationSettingsTable).values({}).returning();
  return created;
}

// Los secretos nunca salen: solo si están puestos y, del token, su inicio para
// reconocerlo (como el de Meta en Configuración).
function serialize(row: IntegrationSettings) {
  return {
    enabled: row.shopifyEnabled,
    labelsEnabled: row.shopifyLabelsEnabled,
    shopDomain: row.shopifyShopDomain,
    hasAccessToken: Boolean(row.shopifyAccessToken),
    accessTokenPreview: row.shopifyAccessToken ? `${row.shopifyAccessToken.slice(0, 9)}…` : null,
    clientId: row.shopifyClientId,
    hasClientSecret: Boolean(row.shopifyClientSecret),
    warehouseId: row.shopifyWarehouseId,
    syncFrom: row.shopifySyncFrom,
    lastSyncAt: row.shopifyLastSyncAt,
    lastError: row.shopifyLastError,
    apiVersion: SHOPIFY_API_VERSION,
  };
}

router.get("/settings/shopify", async (_req, res): Promise<void> => {
  res.json(GetShopifySettingsResponse.parse(serialize(await getOrCreateSettings())));
});

router.put("/settings/shopify", async (req, res): Promise<void> => {
  const parsed = UpdateShopifySettingsBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const body = parsed.data;
  const row = await getOrCreateSettings();
  const update: Partial<typeof integrationSettingsTable.$inferInsert> = { updatedAt: new Date() };

  if (body.shopDomain !== undefined) {
    const domain = body.shopDomain ? normalizeShopDomain(body.shopDomain) : null;
    if (body.shopDomain && !domain) return badRequest(res, "La tienda va como su dominio de Shopify: mitienda.myshopify.com.");
    update.shopifyShopDomain = domain;
  }
  // Un secreto vacío deja el que está (igual que Meta y Gmail); null lo borra.
  if (body.accessToken === null) update.shopifyAccessToken = null;
  else if (typeof body.accessToken === "string" && body.accessToken.trim()) update.shopifyAccessToken = body.accessToken.trim();
  if (body.clientId !== undefined) update.shopifyClientId = body.clientId?.trim() || null;
  if (body.clientSecret === null) update.shopifyClientSecret = null;
  else if (typeof body.clientSecret === "string" && body.clientSecret.trim()) update.shopifyClientSecret = body.clientSecret.trim();
  if (body.warehouseId !== undefined) update.shopifyWarehouseId = body.warehouseId;
  if (body.syncFrom !== undefined) {
    update.shopifySyncFrom = body.syncFrom ? new Date(body.syncFrom) : null;
    // Mover la fecha de inicio vuelve a leer desde ahí (sin duplicar: los pedidos
    // ya traídos se reconocen por su id de Shopify).
    update.shopifySyncCursor = null;
  }
  if (body.labelsEnabled !== undefined) update.shopifyLabelsEnabled = body.labelsEnabled;
  if (body.enabled !== undefined) {
    update.shopifyEnabled = body.enabled;
    // Encender por primera vez sin fecha: se trae desde hoy, nunca el historial.
    if (body.enabled && !row.shopifySyncFrom && body.syncFrom === undefined) update.shopifySyncFrom = new Date();
  }

  const [saved] = await db.update(integrationSettingsTable).set(update).where(eq(integrationSettingsTable.id, row.id)).returning();
  forgetShopifyToken();
  // Otra tienda u otras credenciales: la lista de suscriptores se relee en el próximo minuto.
  if (body.shopDomain !== undefined || body.accessToken !== undefined || body.clientId !== undefined || body.clientSecret !== undefined) refreshSubscribersSoon();
  res.json(UpdateShopifySettingsResponse.parse(serialize(saved)));
});

router.post("/settings/shopify/test", async (_req, res): Promise<void> => {
  const row = await getOrCreateSettings();
  const shopDomain = normalizeShopDomain(row.shopifyShopDomain);
  if (!shopDomain) {
    res.json(TestShopifyConnectionResponse.parse({ ok: false, error: "Falta el dominio de la tienda." }));
    return;
  }
  try {
    const shop = await testShopifyConnection({
      shopDomain,
      accessToken: row.shopifyAccessToken,
      clientId: row.shopifyClientId,
      clientSecret: row.shopifyClientSecret,
    });
    res.json(TestShopifyConnectionResponse.parse({ ok: true, shopName: shop.shopName, currency: shop.currency }));
  } catch (err) {
    res.json(TestShopifyConnectionResponse.parse({ ok: false, error: err instanceof Error ? err.message : "No se pudo conectar." }));
  }
});

router.post("/settings/shopify/sync", async (req, res): Promise<void> => {
  res.json(SyncShopifyNowResponse.parse(await runShopifySyncNow(req.log)));
});

export default router;
