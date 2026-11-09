import { Router, type IRouter } from "express";
import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, shopifySubscribersTable, type ShopifySubscriber } from "@workspace/db";
import { ListShopifySubscribersQueryParams, ListShopifySubscribersResponse, SyncShopifySubscribersResponse } from "@workspace/api-zod";
import { credentialsFrom, loadShopifySettings } from "../lib/shopify-sync";
import { SUBSCRIBER_STATUSES, isSubscriberSyncRunning, startShopifySubscriberSync } from "../lib/shopify-subscribers";
import { normalizeShopDomain } from "../lib/shopify";
import { badRequest } from "../lib/route-errors";

// La vista de Suscripciones (2026-10-06): los clientes de Shopify con suscripción
// y su estado. La lista la rehace lib/shopify-subscribers.ts; aquí solo se lee.
const router: IRouter = Router();

// Hasta aquí se muestra de una vez; con la búsqueda se llega al resto.
const LIST_LIMIT = 500;

/** El cliente en el admin de Shopify ("0mb3y5-cu.myshopify.com" → admin.shopify.com/store/0mb3y5-cu/customers/123). */
export function shopifyCustomerAdminUrl(shopDomain: string | null, customerGid: string): string | null {
  const store = shopDomain?.replace(/\.myshopify\.com$/, "");
  const id = customerGid.split("/").pop();
  return store && id && /^\d+$/.test(id) ? `https://admin.shopify.com/store/${store}/customers/${id}` : null;
}

function serialize(row: ShopifySubscriber, shopDomain: string | null) {
  return {
    id: row.id,
    shopifyCustomerId: row.shopifyCustomerId,
    shopifyAdminUrl: shopifyCustomerAdminUrl(shopDomain, row.shopifyCustomerId),
    contactId: row.contactId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    previousStatus: row.previousStatus,
    statusChangedAt: row.statusChangedAt,
    ordersCount: row.ordersCount,
    amountSpentCents: row.amountSpentCents,
    currency: row.currency,
    customerSince: row.customerSince,
    lastOrderName: row.lastOrderName,
    lastOrderAt: row.lastOrderAt,
    lastOrderProducts: row.lastOrderProducts,
    sellingPlan: row.sellingPlan,
    firstSeenAt: row.firstSeenAt,
    checkedAt: row.checkedAt,
  };
}

router.get("/subscriptions", async (req, res): Promise<void> => {
  const parsed = ListShopifySubscribersQueryParams.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const { status, search } = parsed.data;
  const t = shopifySubscribersTable;

  const term = search?.trim();
  const like = term ? `%${term.replace(/[%_\\]/g, "\\$&")}%` : null;
  const matches: SQL | undefined = like ? or(ilike(t.name, like), ilike(t.email, like), ilike(t.phone, like)) : undefined;

  const [rows, byStatus, settings] = await Promise.all([
    db
      .select()
      .from(t)
      .where(and(status ? eq(t.status, status) : undefined, matches))
      // Lo que acaba de cambiar arriba (la cancelación de ayer antes que la de hace
      // un año), y luego quien compró más recientemente.
      .orderBy(sql`${t.statusChangedAt} desc nulls last`, sql`${t.lastOrderAt} desc nulls last`, asc(t.name))
      .limit(LIST_LIMIT),
    db.select({ status: t.status, count: sql<number>`count(*)::int` }).from(t).where(matches).groupBy(t.status),
    loadShopifySettings(),
  ]);

  const counts = Object.fromEntries(SUBSCRIBER_STATUSES.map((s) => [s, 0])) as Record<(typeof SUBSCRIBER_STATUSES)[number], number>;
  for (const r of byStatus) if (r.status in counts) counts[r.status as keyof typeof counts] = r.count;
  const shopDomain = normalizeShopDomain(settings?.shopifyShopDomain);

  res.json(
    ListShopifySubscribersResponse.parse({
      items: rows.map((r) => serialize(r, shopDomain)),
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      connected: Boolean(settings && credentialsFrom(settings)),
      refreshing: isSubscriberSyncRunning(),
      syncedAt: settings?.shopifySubscribersSyncedAt ?? null,
      error: settings?.shopifySubscribersError ?? null,
    }),
  );
});

router.post("/subscriptions/sync", async (req, res): Promise<void> => {
  const settings = await loadShopifySettings();
  if (!settings || !credentialsFrom(settings)) {
    res.json(SyncShopifySubscribersResponse.parse({ started: false, refreshing: false, error: "Shopify no está conectado: ponlo en Configuración → Shopify." }));
    return;
  }
  const started = startShopifySubscriberSync(req.log);
  res.json(SyncShopifySubscribersResponse.parse({ started, refreshing: true, error: null }));
});

export default router;
