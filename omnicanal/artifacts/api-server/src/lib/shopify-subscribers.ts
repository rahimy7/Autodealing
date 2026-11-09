// La lista de suscriptores de Shopify (2026-10-06): quién tiene la suscripción
// activa, pausada, con el pago fallido, cancelada o vencida.
//
// De dónde sale: Shopify da a cualquier app con read_customers el estado de
// suscripción de cada cliente (Customer.productSubscriberStatus). Los contratos
// —próximo cobro, frecuencia— son de la app de suscripciones de la tienda y
// Shopify no deja leerlos a otra (read_own_subscription_contracts es solo para los
// contratos propios y pide aprobación), así que el resto se completa con el último
// pedido de suscripción del cliente: qué lleva y con qué plan de venta.
//
// La búsqueda de clientes de Shopify no filtra por ese estado: se recorre la
// tienda entera pidiendo solo id y estado (lo más barato que hay) y después se
// piden los datos de los suscriptores. Corre sola cada 6 horas y a pedido desde la
// vista, con la tienda conectada aunque la sincronización de pedidos esté apagada:
// solo lee, nunca escribe en Shopify ni crea contactos.
import { eq, inArray } from "drizzle-orm";
import { db, integrationSettingsTable, shopifySubscribersTable, type ShopifySubscriber } from "@workspace/db";
import { shopifyGraphql, type ShopifyCredentials } from "./shopify";
import { credentialsFrom, findContactByEmailOrPhone, isSubscriptionOrder, loadShopifySettings } from "./shopify-sync";
import { normalizeEmail } from "./email-format";
import { isModuleEnabled } from "./client-config";
import type { Log } from "./messaging";

export const SUBSCRIBER_STATUSES = ["ACTIVE", "PAUSED", "FAILED", "CANCELLED", "EXPIRED"] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];

export function isSubscriberStatus(value: unknown): value is SubscriberStatus {
  return typeof value === "string" && (SUBSCRIBER_STATUSES as readonly string[]).includes(value);
}

// Los que todavía se mueven: cada ciclo traen pedido nuevo o pueden cambiar.
const LIVE_STATUSES: ReadonlySet<string> = new Set<SubscriberStatus>(["ACTIVE", "PAUSED", "FAILED"]);

// Un nodo de cliente sin más que id y estado cuesta 1 punto: 250 por página.
export const CUSTOMER_STATUS_QUERY = `
query CustomerSubscriberStatus($after: String) {
  customers(first: 250, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id productSubscriberStatus }
  }
}`;

// ~45 puntos por cliente (sus 3 últimos pedidos con 5 líneas): de 20 en 20 queda
// por debajo del máximo de 1000 por consulta.
export const SUBSCRIBER_DETAILS_QUERY = `
query SubscriberDetails($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Customer {
      id
      firstName
      lastName
      defaultEmailAddress { emailAddress }
      defaultPhoneNumber { phoneNumber }
      numberOfOrders
      amountSpent { amount currencyCode }
      createdAt
      productSubscriberStatus
      orders(first: 3, sortKey: CREATED_AT, reverse: true) {
        nodes {
          name
          createdAt
          sourceName
          lineItems(first: 5) { nodes { title quantity sellingPlan { name } } }
        }
      }
    }
  }
}`;

const DETAILS_BATCH = 20;
// 100.000 clientes: más que eso no se recorre de una vez.
const MAX_CUSTOMER_PAGES = 400;

type ShopifyCustomerOrder = {
  name: string;
  createdAt: string;
  sourceName: string | null;
  lineItems: { nodes: Array<{ title: string; quantity: number; sellingPlan: { name: string } | null }> };
};

export type ShopifySubscriberNode = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  defaultEmailAddress: { emailAddress: string | null } | null;
  defaultPhoneNumber: { phoneNumber: string | null } | null;
  // UnsignedInt64: llega como texto.
  numberOfOrders: string | number | null;
  amountSpent: { amount: string; currencyCode: string } | null;
  createdAt: string;
  productSubscriberStatus: string;
  orders: { nodes: ShopifyCustomerOrder[] } | null;
};

export type SubscriptionOrder = { name: string; at: Date; products: string; sellingPlan: string | null };

// ── Puras ─────────────────────────────────────────────────────────────────────

/** El pedido de suscripción más nuevo entre los que trae Shopify (vienen del más nuevo al más viejo). */
export function lastSubscriptionOrder(orders: ShopifyCustomerOrder[]): SubscriptionOrder | null {
  for (const order of orders) {
    if (!isSubscriptionOrder(order)) continue;
    const lines = order.lineItems.nodes;
    // Las líneas con plan de venta son la suscripción; si el pedido lo creó la app
    // sin plan en las líneas, van todas.
    const subscribed = lines.some((l) => l.sellingPlan) ? lines.filter((l) => l.sellingPlan) : lines;
    return {
      name: order.name,
      at: new Date(order.createdAt),
      products: subscribed.map((l) => `${l.title}${l.quantity > 1 ? ` x${l.quantity}` : ""}`).join(", "),
      sellingPlan: subscribed.find((l) => l.sellingPlan)?.sellingPlan?.name ?? null,
    };
  }
  return null;
}

export type SubscriberSnapshot = {
  shopifyCustomerId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  ordersCount: number;
  amountSpentCents: number;
  currency: string | null;
  customerSince: Date | null;
  lastOrder: SubscriptionOrder | null;
};

export function subscriberFromShopify(node: ShopifySubscriberNode): SubscriberSnapshot {
  const spent = Number(node.amountSpent?.amount ?? 0);
  const since = new Date(node.createdAt);
  return {
    shopifyCustomerId: node.id,
    name: [node.firstName, node.lastName].map((p) => p?.trim()).filter(Boolean).join(" ") || null,
    email: normalizeEmail(node.defaultEmailAddress?.emailAddress ?? null),
    phone: node.defaultPhoneNumber?.phoneNumber?.trim() || null,
    status: node.productSubscriberStatus,
    ordersCount: Number(node.numberOfOrders) || 0,
    amountSpentCents: Number.isFinite(spent) ? Math.round(spent * 100) : 0,
    currency: node.amountSpent?.currencyCode ?? null,
    customerSince: Number.isNaN(since.getTime()) ? null : since,
    lastOrder: lastSubscriptionOrder(node.orders?.nodes ?? []),
  };
}

// ── Base de datos ─────────────────────────────────────────────────────────────

/** Guarda lo leído de un suscriptor. Devuelve si cambió de estado. */
async function saveSubscriber(snap: SubscriberSnapshot, row: ShopifySubscriber | undefined, now: Date): Promise<boolean> {
  const statusChanged = row != null && row.status !== snap.status;
  const order = snap.lastOrder;
  // Un pedido que ya salió de la ventana de 60 días no borra el último que se vio.
  const takeOrder = order != null && !(row?.lastOrderAt && row.lastOrderAt > order.at);
  const contactId = row?.contactId ?? (await findContactByEmailOrPhone(snap.email, snap.phone))?.id ?? null;
  const values = {
    contactId,
    name: snap.name,
    email: snap.email,
    phone: snap.phone,
    status: snap.status,
    ordersCount: snap.ordersCount,
    amountSpentCents: snap.amountSpentCents,
    currency: snap.currency,
    customerSince: snap.customerSince,
    ...(takeOrder ? { lastOrderName: order.name, lastOrderAt: order.at, lastOrderProducts: order.products, sellingPlan: order.sellingPlan } : {}),
    ...(statusChanged ? { previousStatus: row.status, statusChangedAt: now } : {}),
    checkedAt: now,
  };
  if (row) await db.update(shopifySubscribersTable).set(values).where(eq(shopifySubscribersTable.id, row.id));
  else await db.insert(shopifySubscribersTable).values({ shopifyCustomerId: snap.shopifyCustomerId, firstSeenAt: now, ...values });
  return statusChanged;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type SubscriberSyncResult = { scanned: number; subscribers: number; changed: number; error: string | null };

/** Recorre la tienda y rehace la lista. Lanza si Shopify falla: quien llama guarda el error. */
export async function syncSubscribersWith(creds: ShopifyCredentials, now = new Date()): Promise<Omit<SubscriberSyncResult, "error">> {
  // 1) Quién es o fue suscriptor, y con qué estado.
  const statusById = new Map<string, SubscriberStatus>();
  let scanned = 0;
  let after: string | null = null;
  for (let page = 0; ; page++) {
    if (page >= MAX_CUSTOMER_PAGES) throw new Error("La tienda tiene demasiados clientes para recorrerla de una vez.");
    const data: { customers: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ id: string; productSubscriberStatus: string }> } } =
      await shopifyGraphql(creds, CUSTOMER_STATUS_QUERY, { after });
    for (const customer of data.customers.nodes) {
      scanned += 1;
      if (isSubscriberStatus(customer.productSubscriberStatus)) statusById.set(customer.id, customer.productSubscriberStatus);
    }
    if (!data.customers.pageInfo.hasNextPage) break;
    after = data.customers.pageInfo.endCursor;
  }

  // 2) Los datos: de los nuevos, de los que cambiaron de estado y de los que siguen
  // vivos. Un cancelado o vencido que ya conocemos no se mueve: no se vuelve a pedir.
  const existing = await db.select().from(shopifySubscribersTable);
  const existingById = new Map(existing.map((r) => [r.shopifyCustomerId, r] as const));
  const needDetails: string[] = [];
  const unchanged: string[] = [];
  for (const [id, status] of statusById) {
    const row = existingById.get(id);
    if (!row || row.status !== status || LIVE_STATUSES.has(status)) needDetails.push(id);
    else unchanged.push(id);
  }

  let changed = 0;
  for (const ids of chunks(needDetails, DETAILS_BATCH)) {
    const data = await shopifyGraphql<{ nodes: Array<ShopifySubscriberNode | null> }>(creds, SUBSCRIBER_DETAILS_QUERY, { ids });
    for (const node of data.nodes) {
      // Un cliente borrado entre una consulta y la otra llega como null.
      if (!node?.id || !isSubscriberStatus(node.productSubscriberStatus)) continue;
      if (await saveSubscriber(subscriberFromShopify(node), existingById.get(node.id), now)) changed += 1;
    }
  }
  for (const ids of chunks(unchanged, 1000)) {
    await db.update(shopifySubscribersTable).set({ checkedAt: now }).where(inArray(shopifySubscribersTable.shopifyCustomerId, ids));
  }

  // 3) Quien ya no está en la tienda (cliente borrado o fusionado) sale de la lista.
  const gone = existing.filter((r) => !statusById.has(r.shopifyCustomerId)).map((r) => r.id);
  for (const ids of chunks(gone, 1000)) {
    await db.delete(shopifySubscribersTable).where(inArray(shopifySubscribersTable.id, ids));
  }

  return { scanned, subscribers: statusById.size, changed };
}

// ── Cuándo corre ──────────────────────────────────────────────────────────────

const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;
let lastRun = 0;
let running = false;

export function isSubscriberSyncRunning(): boolean {
  return running;
}

async function runSubscriberSync(log: Log): Promise<SubscriberSyncResult> {
  const settings = await loadShopifySettings();
  const creds = settings ? credentialsFrom(settings) : null;
  if (!settings || !creds) return { scanned: 0, subscribers: 0, changed: 0, error: "Shopify no está conectado." };
  try {
    const result = await syncSubscribersWith(creds);
    await db
      .update(integrationSettingsTable)
      .set({ shopifySubscribersSyncedAt: new Date(), shopifySubscribersError: null, updatedAt: new Date() })
      .where(eq(integrationSettingsTable.id, settings.id));
    log.info(result, "shopify subscribers synced");
    return { ...result, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "error inesperado";
    log.error({ err }, "shopify subscribers sync failed");
    await db.update(integrationSettingsTable).set({ shopifySubscribersError: message, updatedAt: new Date() }).where(eq(integrationSettingsTable.id, settings.id));
    return { scanned: 0, subscribers: 0, changed: 0, error: message };
  }
}

/**
 * Arranca la lectura en segundo plano: recorrer la tienda puede tardar minutos y
 * no puede frenar al programador ni dejar colgada la petición de la vista.
 * Devuelve false si ya había una en curso.
 */
export function startShopifySubscriberSync(log: Log): boolean {
  if (running) return false;
  running = true;
  lastRun = Date.now();
  void runSubscriberSync(log)
    .catch((err) => log.error({ err }, "shopify subscribers sync crashed"))
    .finally(() => {
      running = false;
    });
  return true;
}

/** Al cambiar la tienda o sus credenciales: que el próximo ciclo del programador la relea. */
export function refreshSubscribersSoon(): void {
  lastRun = 0;
}

/** Desde el programador: cada 6 horas (y al arrancar), si la instancia tiene Pedidos. */
export function sweepShopifySubscribers(log: Log): void {
  if (!isModuleEnabled("orders") || running || Date.now() - lastRun < SYNC_EVERY_MS) return;
  startShopifySubscriberSync(log);
}
