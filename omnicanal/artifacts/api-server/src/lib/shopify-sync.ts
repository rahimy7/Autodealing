// Sincronización de pedidos de Shopify. Decisión del 2026-10-04: las
// suscripciones se llevan en Shopify y se traen TODOS sus pedidos (web y
// suscripción), para que el inventario los comprometa — todo lo que sale del
// almacén tiene que entrar como pedido. Cada pedido llega "Pendiente" (pago por
// confirmar, lo confirma el equipo) aunque Shopify ya lo dé por pagado; el estado
// de pago de Shopify queda a la vista.
//
// Es incremental por `updated_at`, solo desde la fecha de conexión (conectar la
// tienda no puede traer años de historial como pedidos pendientes), y no
// duplica: el pedido se reconoce por su id de Shopify. Si Shopify cancela un
// pedido que aquí todavía no salió del almacén, aquí también se cancela; fuera
// de eso, el estado del pedido lo lleva el equipo desde aquí.
import { eq, or, sql } from "drizzle-orm";
import { db, integrationSettingsTable, ordersTable, orderItemsTable, productsTable, contactsTable, type ExternalTracking, type IntegrationSettings } from "@workspace/db";
import { ORDERS_QUERY, normalizeShopDomain, shopifyGraphql, type ShopifyCredentials } from "./shopify";
import { createOrder, logOrderEvent, hasStockOut, type NewOrderItem } from "./orders";
import { changeOrderStatus } from "./order-workflow";
import { phoneSuffixCondition } from "./contact-identity";
import { normalizeEmail, phonesMatch } from "./email-format";
import { isModuleEnabled } from "./client-config";
import { defaultWarehouse, type Actor } from "./inventory";
import type { Log } from "./messaging";

export const SHOPIFY_ACTOR: Actor = { agentId: null, label: "Shopify" };

type Money = { shopMoney: { amount: string } } | null | undefined;

export type ShopifyOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  email: string | null;
  phone: string | null;
  customerLocale: string | null;
  note?: string | null;
  customAttributes?: Array<{ key: string; value: string | null }>;
  sourceName: string | null;
  currencyCode: string;
  totalShippingPriceSet?: Money;
  customer: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null;
  shippingAddress: {
    name: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    zip: string | null;
    country: string | null;
    phone: string | null;
  } | null;
  // Los envíos del pedido en Shopify, con la guía de cada uno (la etiqueta que se
  // compró allá o desde aquí vía Shopify).
  fulfillments?: Array<{
    id: string;
    status: string;
    deliveredAt: string | null;
    trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }>;
  }>;
  lineItems: {
    nodes: Array<{
      id: string;
      title: string;
      quantity: number;
      sku: string | null;
      variant: { sku: string | null; product: { handle: string } | null } | null;
      originalUnitPriceSet?: Money;
      totalDiscountSet?: Money;
      sellingPlan: { name: string } | null;
    }>;
  };
};

// ── Puras ─────────────────────────────────────────────────────────────────────

export function moneyToCents(money: Money): number {
  const amount = Number(money?.shopMoney?.amount ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

/** Un pedido es de suscripción si alguna línea trae plan de venta, o si lo creó la app de suscripciones. */
export function isSubscriptionOrder(node: { lineItems: { nodes: Array<{ sellingPlan: { name: string } | null }> }; sourceName: string | null }): boolean {
  return node.lineItems.nodes.some((l) => l.sellingPlan != null) || /subscription/i.test(node.sourceName ?? "");
}

/**
 * El comentario del pedido: la nota de Shopify y, debajo, los datos que la tienda
 * pide en el carrito ("Mensaje de regalo: …"). Los atributos que empiezan por "_"
 * son internos de las apps (ids de suscripción, de seguimiento) y no se muestran.
 */
export function shopifyOrderNote(node: Pick<ShopifyOrderNode, "note" | "customAttributes">): string | null {
  const parts = [
    node.note?.trim(),
    ...(node.customAttributes ?? [])
      .filter((a) => a.key?.trim() && !a.key.trim().startsWith("_") && a.value?.trim())
      .map((a) => `${a.key.trim()}: ${a.value!.trim()}`),
  ].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join("\n") : null;
}

/** Estados de un envío de Shopify que no cuentan: no hay paquete en camino. */
const DEAD_FULFILLMENT_STATUSES = new Set(["CANCELLED", "ERROR", "FAILURE"]);

/**
 * Si dos listas de guías son la misma. Se compara campo por campo y no con
 * JSON.stringify: Postgres (jsonb) devuelve las claves en otro orden que como se
 * guardaron, y cada sincronización vería un cambio que no existe.
 */
export function sameExternalTracking(a: ExternalTracking[] | null | undefined, b: ExternalTracking[] | null | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((t, i) => t.fulfillmentId === y[i].fulfillmentId && t.number === y[i].number && t.company === y[i].company && t.url === y[i].url && t.deliveredAt === y[i].deliveredAt);
}

/**
 * Las guías de los envíos de un pedido de Shopify (sin los cancelados ni los
 * repetidos), o null si no hay ninguna. Un envío puede traer varias guías.
 */
export function shopifyExternalTracking(node: Pick<ShopifyOrderNode, "fulfillments">): ExternalTracking[] | null {
  const out: ExternalTracking[] = [];
  for (const f of node.fulfillments ?? []) {
    if (DEAD_FULFILLMENT_STATUSES.has(f.status?.toUpperCase())) continue;
    for (const t of f.trackingInfo ?? []) {
      const number = t.number?.trim();
      if (!number || out.some((e) => e.number === number)) continue;
      out.push({ fulfillmentId: f.id, number, company: t.company?.trim() || null, url: t.url?.trim() || null, deliveredAt: f.deliveredAt ?? null });
    }
  }
  return out.length ? out : null;
}

export function formatShopifyAddress(addr: ShopifyOrderNode["shippingAddress"]): string | null {
  if (!addr) return null;
  const parts = [addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country].map((p) => p?.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return `${parts.join(", ")}${addr.phone ? ` · Tel. ${addr.phone}` : ""}`;
}

export function customerName(node: Pick<ShopifyOrderNode, "customer" | "shippingAddress">): string | null {
  const fromCustomer = [node.customer?.firstName, node.customer?.lastName].filter(Boolean).join(" ").trim();
  return fromCustomer || node.shippingAddress?.name?.trim() || null;
}

export type CatalogIndex = { bySku: Map<string, number>; bySlug: Map<string, number> };

/**
 * Las líneas del pedido de Shopify como líneas nuestras: por SKU y, si no, por
 * el handle del producto (que es nuestro `slug`, porque el catálogo se importa
 * de la misma tienda). Lo que no casa queda sin vincular, con su título.
 */
export function mapShopifyLines(node: Pick<ShopifyOrderNode, "lineItems">, catalog: CatalogIndex): NewOrderItem[] {
  return node.lineItems.nodes
    .filter((l) => l.quantity > 0)
    .map((l) => {
      const sku = (l.variant?.sku ?? l.sku ?? "").trim().toLowerCase();
      const handle = l.variant?.product?.handle?.trim().toLowerCase() ?? "";
      const productId = (sku && catalog.bySku.get(sku)) || (handle && catalog.bySlug.get(handle)) || null;
      return {
        productId,
        description: l.title,
        quantity: l.quantity,
        unitPriceCents: moneyToCents(l.originalUnitPriceSet),
        discountCents: moneyToCents(l.totalDiscountSet),
        externalLineId: l.id,
      };
    });
}

// ── Base de datos ─────────────────────────────────────────────────────────────

async function catalogIndex(): Promise<CatalogIndex> {
  const rows = await db.select({ id: productsTable.id, sku: productsTable.sku, slug: productsTable.slug }).from(productsTable);
  return {
    bySku: new Map(rows.filter((r) => r.sku).map((r) => [r.sku!.trim().toLowerCase(), r.id] as const)),
    bySlug: new Map(rows.map((r) => [r.slug.toLowerCase(), r.id] as const)),
  };
}

/** El contacto con ese correo o, si no, con ese teléfono (o su id de WhatsApp). */
export async function findContactByEmailOrPhone(email: string | null, phone: string | null) {
  if (email) {
    const [byEmail] = await db.select().from(contactsTable).where(sql`lower(${contactsTable.email}) = ${email}`).limit(1);
    if (byEmail) return byEmail;
  }
  if (phone) {
    const candidates = await db
      .select()
      .from(contactsTable)
      .where(or(phoneSuffixCondition(contactsTable.phone, [phone]), phoneSuffixCondition(contactsTable.externalId, [phone]))!);
    const match = candidates.find((c) => phonesMatch(c.phone, phone) || phonesMatch(c.externalId, phone));
    if (match) return match;
  }
  return null;
}

/** El contacto del cliente de Shopify: por correo, si no por teléfono; si no existe, se crea. */
async function resolveShopifyContact(node: ShopifyOrderNode): Promise<number> {
  const email = normalizeEmail(node.email ?? node.customer?.email ?? null);
  const phone = node.phone ?? node.customer?.phone ?? node.shippingAddress?.phone ?? null;
  const name = customerName(node);
  const found = await findContactByEmailOrPhone(email, phone);
  if (found) {
    if (email && !found.email) await db.update(contactsTable).set({ email }).where(eq(contactsTable.id, found.id));
    return found.id;
  }
  const [created] = await db
    .insert(contactsTable)
    .values({ name: name ?? (email ? `Cliente ${email.split("@")[0]}` : "Cliente de Shopify"), email, phone, channels: email ? ["email"] : [] })
    .returning();
  return created.id;
}

export function credentialsFrom(settings: IntegrationSettings): ShopifyCredentials | null {
  const shopDomain = normalizeShopDomain(settings.shopifyShopDomain);
  if (!shopDomain) return null;
  if (!settings.shopifyAccessToken && !(settings.shopifyClientId && settings.shopifyClientSecret)) return null;
  return { shopDomain, accessToken: settings.shopifyAccessToken, clientId: settings.shopifyClientId, clientSecret: settings.shopifyClientSecret };
}

export async function loadShopifySettings(): Promise<IntegrationSettings | null> {
  const [row] = await db.select().from(integrationSettingsTable).orderBy(integrationSettingsTable.id).limit(1);
  return row ?? null;
}

export type ShopifySyncResult = { imported: number; updated: number; cancelled: number; skipped: number; error: string | null };

/** Trae lo nuevo de Shopify. Nunca lanza: el error queda en la configuración para verlo en el panel. */
export async function syncShopifyOrders(log: Log, opts: { maxPages?: number } = {}): Promise<ShopifySyncResult> {
  const result: ShopifySyncResult = { imported: 0, updated: 0, cancelled: 0, skipped: 0, error: null };
  const settings = await loadShopifySettings();
  if (!settings?.shopifyEnabled) return { ...result, error: "La sincronización con Shopify está apagada." };
  const creds = credentialsFrom(settings);
  if (!creds) return { ...result, error: "Falta la tienda o sus credenciales." };
  const syncFrom = settings.shopifySyncFrom ?? new Date();
  const since = settings.shopifySyncCursor ?? syncFrom;

  try {
    const catalog = await catalogIndex();
    const warehouseId = settings.shopifyWarehouseId ?? (isModuleEnabled("inventory") ? ((await defaultWarehouse())?.id ?? null) : null);
    let cursor: string | null = null;
    let newest = since;
    const filter = `updated_at:>='${since.toISOString()}'`;
    for (let page = 0; page < (opts.maxPages ?? 10); page++) {
      const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyOrderNode[] } } = await shopifyGraphql(creds, ORDERS_QUERY, { first: 50, after: cursor, query: filter });
      for (const node of data.orders.nodes) {
        const updatedAt = new Date(node.updatedAt);
        if (updatedAt > newest) newest = updatedAt;
        await applyShopifyOrder(node, { syncFrom, catalog, warehouseId, log, result });
      }
      if (!data.orders.pageInfo.hasNextPage) break;
      cursor = data.orders.pageInfo.endCursor;
    }
    await db
      .update(integrationSettingsTable)
      .set({ shopifySyncCursor: newest, shopifyLastSyncAt: new Date(), shopifyLastError: null, updatedAt: new Date() })
      .where(eq(integrationSettingsTable.id, settings.id));
    if (result.imported || result.cancelled || result.updated) log.info(result, "shopify sync");
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "error inesperado";
    log.error({ err }, "shopify sync failed");
    await db.update(integrationSettingsTable).set({ shopifyLastSyncAt: new Date(), shopifyLastError: message, updatedAt: new Date() }).where(eq(integrationSettingsTable.id, settings.id));
    return { ...result, error: message };
  }
}

/** Un pedido de Shopify contra la base: lo importa, lo cancela o refleja su pago y su comentario. Exportada para las pruebas. */
export async function applyShopifyOrder(
  node: ShopifyOrderNode,
  ctx: { syncFrom: Date; catalog: CatalogIndex; warehouseId: number | null; log: Log; result: ShopifySyncResult },
): Promise<void> {
  const [existing] = await db.select().from(ordersTable).where(eq(ordersTable.externalId, node.id));
  if (existing) {
    const items = await db.select({ dispatchedQuantity: orderItemsTable.dispatchedQuantity }).from(orderItemsTable).where(eq(orderItemsTable.orderId, existing.id));
    if (node.cancelledAt && (existing.status === "pending" || existing.status === "processing") && !hasStockOut(items)) {
      await logOrderEvent(db, existing.id, "shopify", `Shopify canceló el pedido ${node.name}.`, SHOPIFY_ACTOR);
      await changeOrderStatus(existing.id, "cancelled", SHOPIFY_ACTOR, ctx.log);
      ctx.result.cancelled += 1;
      return;
    }
    // Lo que es de Shopify se refleja tal cual: el estado del pago y el comentario.
    const patch: Partial<typeof ordersTable.$inferInsert> = {};
    const events: string[] = [];
    if (node.displayFinancialStatus && node.displayFinancialStatus !== existing.externalFinancialStatus) {
      patch.externalFinancialStatus = node.displayFinancialStatus;
      events.push(`Shopify: el pago está "${node.displayFinancialStatus}".`);
    }
    // Las guías del envío: se llevan al despacho en vez de teclearlas.
    const tracking = shopifyExternalTracking(node);
    if (!sameExternalTracking(tracking, existing.externalTracking)) {
      patch.externalTracking = tracking;
      const before = new Set((existing.externalTracking ?? []).map((t) => t.number));
      const added = (tracking ?? []).filter((t) => !before.has(t.number));
      if (added.length) events.push(`Shopify: guía ${added.map((t) => `${t.number}${t.company ? ` (${t.company})` : ""}`).join(", ")}.`);
      else if (!tracking) events.push("Shopify: el pedido ya no tiene guía.");
      else events.push("Shopify: cambió el estado del envío.");
    }
    const note = shopifyOrderNote(node);
    if (note !== existing.externalNote) {
      patch.externalNote = note;
      events.push(note ? "Shopify: cambió el comentario del pedido." : "Shopify: se borró el comentario del pedido.");
    }
    if (events.length === 0) {
      ctx.result.skipped += 1;
      return;
    }
    await db.update(ordersTable).set({ ...patch, updatedAt: new Date() }).where(eq(ordersTable.id, existing.id));
    for (const event of events) await logOrderEvent(db, existing.id, "shopify", event, SHOPIFY_ACTOR);
    ctx.result.updated += 1;
    return;
  }
  // Lo creado antes de conectar la tienda, o ya cancelado, no se trae.
  if (new Date(node.createdAt) < ctx.syncFrom || node.cancelledAt) {
    ctx.result.skipped += 1;
    return;
  }

  const contactId = await resolveShopifyContact(node);
  const items = mapShopifyLines(node, ctx.catalog);
  const order = await createOrder(
    {
      contactId,
      source: "shopify",
      status: "pending",
      items,
      priceCurrency: node.currencyCode,
      shippingChargeCents: moneyToCents(node.totalShippingPriceSet),
      address: formatShopifyAddress(node.shippingAddress),
      email: normalizeEmail(node.email ?? node.customer?.email ?? null),
      customerLocale: node.customerLocale,
      externalId: node.id,
      externalName: node.name,
      isSubscription: isSubscriptionOrder(node),
      externalFinancialStatus: node.displayFinancialStatus,
      externalNote: shopifyOrderNote(node),
      externalTracking: shopifyExternalTracking(node),
      warehouseId: ctx.warehouseId,
    },
    SHOPIFY_ACTOR,
  );
  await logOrderEvent(
    db,
    order.id,
    "shopify",
    `Importado de Shopify ${node.name}${isSubscriptionOrder(node) ? " (suscripción)" : ""}. Pago en Shopify: ${node.displayFinancialStatus ?? "—"}; aquí queda Pendiente hasta que el equipo lo confirme.`,
    SHOPIFY_ACTOR,
  );
  ctx.result.imported += 1;
}

// Cada 15 minutos, con guarda para no correr dos a la vez (el programador corre
// cada minuto y una sincronización puede tardar más que eso).
const SYNC_EVERY_MS = 15 * 60 * 1000;
let lastSync = 0;
let running = false;

export async function sweepShopifyOrders(log: Log): Promise<void> {
  if (!isModuleEnabled("orders") || running || Date.now() - lastSync < SYNC_EVERY_MS) return;
  running = true;
  lastSync = Date.now();
  try {
    const settings = await loadShopifySettings();
    if (!settings?.shopifyEnabled || !credentialsFrom(settings)) return;
    await syncShopifyOrders(log);
  } finally {
    running = false;
  }
}

/** Si una sincronización a mano no se cruza con la del programador. */
export function isShopifySyncRunning(): boolean {
  return running;
}

export async function runShopifySyncNow(log: Log): Promise<ShopifySyncResult> {
  if (running) return { imported: 0, updated: 0, cancelled: 0, skipped: 0, error: "Ya hay una sincronización en curso." };
  running = true;
  try {
    lastSync = Date.now();
    return await syncShopifyOrders(log);
  } finally {
    running = false;
  }
}

