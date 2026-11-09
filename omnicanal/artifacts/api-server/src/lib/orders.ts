// Pedidos tomados por chat. Se abren solos cuando el cliente dice que pagó
// (PEDIDO_CONFIRMADO, en messaging.ts) y de ahí el equipo los lleva desde la
// vista de Pedidos hasta que llegan. Las funciones puras (código, cuál es el
// pedido "activo" de una conversación) están separadas de las que tocan la base
// de datos, igual que en reports.ts, para poder probarlas directo.
//
// 2026-10-04: el pedido pasó de texto libre a LÍNEAS del catálogo (order_items),
// para comprometer inventario al vender y descontarlo al despachar. Todo pedido
// nace por `createOrder` —chat, vista de Pedidos, Shopify, reposición de una
// devolución—, así los totales, el almacén y el expediente salen igual de
// cualquier camino. `product`/`quantity` quedan como resumen de las líneas.
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderItemsTable,
  orderEventsTable,
  contactsTable,
  agentsTable,
  messagesTable,
  productsTable,
  productComponentsTable,
  warehousesTable,
  stockMovementsTable,
  creditNotesTable,
  creditNoteApplicationsTable,
  type ExternalTracking,
  type Order,
  type OrderItem,
  type Message,
} from "@workspace/db";
import { loadSettings, type Log } from "./messaging";
import { deliverMediaMessage, deliverMessage } from "./meta";
import { signMediaUrl } from "./supabase";
import { extractOrderDetails } from "./openai-client";
import { clientConfig, isModuleEnabled } from "./client-config";
import { orderCode } from "./codes";
import { BASE_CURRENCY, rateToBaseFrom, toBaseCents } from "./money";
import { getCurrentRates } from "./exchange-rates";
import { defaultWarehouse, SYSTEM_ACTOR, type Actor, type Executor } from "./inventory";

export { orderCode };

export const ORDER_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SOURCES = ["chat", "manual", "shopify", "replacement"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

const TERMINAL_STATUSES = new Set<OrderStatus>(["delivered", "cancelled"]);

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pendiente",
  processing: "En proceso",
  shipped: "Enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export function isActiveOrderStatus(status: OrderStatus): boolean {
  return !TERMINAL_STATUSES.has(status);
}

// De los pedidos de una misma conversación, el que hay que mostrarle a quien
// está en ese chat: el más reciente que todavía no haya terminado. Pura, sin DB.
export function pickActiveOrder(orders: Order[]): Order | null {
  const active = orders.filter((o) => isActiveOrderStatus(o.status as OrderStatus));
  if (active.length === 0) return null;
  return active.reduce((latest, o) => (o.createdAt > latest.createdAt ? o : latest));
}

// ── Totales (puras) ───────────────────────────────────────────────────────────

export type PricedLine = { quantity: number; unitPriceCents: number; discountCents: number };

/**
 * Total de cada línea (cantidad × precio − su descuento, nunca negativo), el
 * subtotal, el descuento del pedido (nunca más que el subtotal) y el total con
 * lo que el cliente paga de envío.
 */
export function computeOrderTotals(
  lines: PricedLine[],
  orderDiscountCents: number,
  shippingChargeCents: number,
): { lineTotals: number[]; subtotalCents: number; discountCents: number; totalCents: number } {
  const lineTotals = lines.map((l) => Math.max(0, l.quantity * l.unitPriceCents - Math.max(0, l.discountCents)));
  const subtotalCents = lineTotals.reduce((sum, t) => sum + t, 0);
  const discountCents = Math.min(Math.max(0, orderDiscountCents), subtotalCents);
  return { lineTotals, subtotalCents, discountCents, totalCents: subtotalCents - discountCents + Math.max(0, shippingChargeCents) };
}

/** El resumen que va en `orders.product`/`quantity`: "Procollagen x2, NAD Advanced". */
export function summarizeItems(items: Array<{ description: string; quantity: number }>): { product: string | null; quantity: number } {
  if (items.length === 0) return { product: null, quantity: 1 };
  const product = items.map((i) => (i.quantity > 1 ? `${i.description} x${i.quantity}` : i.description)).join(", ");
  return { product: product.slice(0, 500), quantity: items.reduce((sum, i) => sum + i.quantity, 0) };
}

// ── Transiciones (pura) ───────────────────────────────────────────────────────
// Desde que hay inventario, un estado no es solo una etiqueta: Enviado quiere
// decir que la mercancía salió del almacén. Por eso:
//   - pasar a Enviado (o directo a Entregado) DESPACHA: descuenta por lote;
//   - lo que ya salió del almacén no se cancela ni vuelve a Pendiente/En
//     proceso desde aquí: vuelve con "No entregado" en el despacho (regresa al
//     mismo lote) o con una devolución;
//   - un pedido que no ha sacado nada (o uno de antes del inventario) se mueve
//     libre como siempre.

export type OrderTransition =
  | { ok: true; effect: "none" | "dispatch" | "dispatch_then_deliver" }
  | { ok: false; error: string };

export function orderTransition(from: OrderStatus, to: OrderStatus, ctx: { stockOut: boolean }): OrderTransition {
  if (from === to) return { ok: true, effect: "none" };
  if (ctx.stockOut) {
    if (to === "delivered" || to === "shipped") return { ok: true, effect: "none" };
    return {
      ok: false,
      error:
        "Este pedido ya salió del almacén. Si no se entregó, márcalo como \"No entregado\" en su despacho para que vuelva al inventario; si el cliente lo devuelve, registra una devolución.",
    };
  }
  if (to === "shipped") return { ok: true, effect: "dispatch" };
  if (to === "delivered") return { ok: true, effect: "dispatch_then_deliver" };
  return { ok: true, effect: "none" };
}

// ── Expediente ────────────────────────────────────────────────────────────────

export type OrderEventKind =
  | "created"
  | "status"
  | "payment_confirmed"
  | "items"
  | "pricing"
  | "shipment_assigned"
  | "shipment_removed"
  | "dispatched"
  | "delivered"
  | "delivery_failed"
  | "cancelled"
  | "return"
  | "credit_note"
  | "notified"
  | "notification_skipped"
  | "shopify"
  | "usps_label"
  | "shopify_label"
  | "note";

export async function logOrderEvent(
  executor: Executor,
  orderId: number,
  kind: OrderEventKind,
  detail: string,
  actor: Actor = SYSTEM_ACTOR,
  data: Record<string, unknown> | null = null,
): Promise<void> {
  await executor.insert(orderEventsTable).values({
    orderId,
    kind,
    detail,
    data,
    actorAgentId: actor.agentId,
    actorLabel: actor.label,
  });
}

export async function orderEventsFor(orderId: number) {
  return db.select().from(orderEventsTable).where(eq(orderEventsTable.orderId, orderId)).orderBy(asc(orderEventsTable.createdAt), asc(orderEventsTable.id));
}

// ── Crear y editar ────────────────────────────────────────────────────────────

export type NewOrderItem = {
  productId?: number | null;
  description?: string | null;
  quantity: number;
  // En centavos de la moneda del pedido. Sin él, el precio del producto.
  unitPriceCents?: number | null;
  discountCents?: number | null;
  externalLineId?: string | null;
};

export type NewOrderInput = {
  contactId: number;
  conversationId?: number | null;
  source: OrderSource;
  status?: OrderStatus;
  items: NewOrderItem[];
  // Texto libre para un pedido sin líneas (lo que el chat no pudo vincular).
  product?: string | null;
  quantity?: number;
  priceCurrency?: string | null;
  rateToBase?: number | null;
  amount?: number | null;
  currency?: string | null;
  address?: string | null;
  email?: string | null;
  notes?: string | null;
  discountCents?: number;
  discountReason?: string | null;
  shippingChargeCents?: number;
  warehouseId?: number | null;
  paymentProofMessageId?: number | null;
  createdByAgentId?: number | null;
  externalId?: string | null;
  externalName?: string | null;
  isSubscription?: boolean;
  externalFinancialStatus?: string | null;
  externalNote?: string | null;
  externalTracking?: ExternalTracking[] | null;
  customerLocale?: string | null;
  replacesOrderId?: number | null;
};

const SOURCE_LABELS: Record<OrderSource, string> = {
  chat: "desde el chat (el cliente dijo que pagó)",
  manual: "a mano en la vista de Pedidos",
  shopify: "desde Shopify",
  replacement: "como reposición de una devolución",
};

/** Unidades base por 1 de `currency`: 1 si es la base; la tasa del banco si hay; null si no. */
export async function defaultRateToBase(currency: string): Promise<number | null> {
  if (currency.toUpperCase() === BASE_CURRENCY) return 1;
  const rates = await getCurrentRates().catch(() => []);
  return rateToBaseFrom(currency, Object.fromEntries(rates.map((r) => [r.currency.toUpperCase(), r.sell])));
}

type ResolvedLine = {
  productId: number | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  externalLineId: string | null;
};

async function resolveLines(
  executor: Executor,
  items: NewOrderItem[],
): Promise<{ lines: ResolvedLine[]; currency: string | null }> {
  const productIds = [...new Set(items.map((i) => i.productId).filter((id): id is number => id != null))];
  const products = productIds.length
    ? await executor
        .select({ id: productsTable.id, name: productsTable.name, priceCents: productsTable.priceCents, priceCurrency: productsTable.priceCurrency })
        .from(productsTable)
        .where(inArray(productsTable.id, productIds))
    : [];
  const byId = new Map(products.map((p) => [p.id, p] as const));
  // La moneda del pedido es la del primer producto con precio; un producto con
  // precio en otra moneda no se convierte a ciegas: su línea queda en cero para
  // que alguien la ponga.
  const firstPriced = items.map((i) => (i.productId != null ? byId.get(i.productId) : undefined)).find((p) => p?.priceCents != null);
  const currency = firstPriced ? (firstPriced.priceCurrency ?? BASE_CURRENCY).toUpperCase() : null;

  const lines = items
    .filter((i) => i.quantity > 0)
    .map((item) => {
      const product = item.productId != null ? byId.get(item.productId) : undefined;
      if (item.productId != null && !product) throw new Error(`Producto ${item.productId} no encontrado`);
      const productCurrency = (product?.priceCurrency ?? BASE_CURRENCY).toUpperCase();
      const catalogPrice = product?.priceCents != null && (currency == null || productCurrency === currency) ? product.priceCents : 0;
      return {
        productId: product?.id ?? null,
        description: (item.description?.trim() || product?.name || "Producto sin especificar").slice(0, 300),
        quantity: Math.round(item.quantity),
        unitPriceCents: Math.max(0, Math.round(item.unitPriceCents ?? catalogPrice)),
        discountCents: Math.max(0, Math.round(item.discountCents ?? 0)),
        externalLineId: item.externalLineId ?? null,
      };
    });
  return { lines, currency };
}

/**
 * Crea un pedido con sus líneas, sus totales, su almacén y el primer evento del
 * expediente, en una transacción. Lo comprometido no se toca: se calcula de las
 * líneas (lib/inventory.ts), así que existir ya es comprometer.
 */
export async function createOrder(input: NewOrderInput, actor: Actor, executor?: Executor): Promise<Order> {
  const run = async (tx: Executor): Promise<Order> => {
    const { lines, currency: lineCurrency } = await resolveLines(tx, input.items);
    const priceCurrency = (input.priceCurrency ?? lineCurrency ?? BASE_CURRENCY).toUpperCase();
    const rateToBase = input.rateToBase !== undefined ? input.rateToBase : await defaultRateToBase(priceCurrency);
    const totals = computeOrderTotals(lines, input.discountCents ?? 0, input.shippingChargeCents ?? 0);
    const summary = lines.length ? summarizeItems(lines) : { product: input.product?.trim() || null, quantity: input.quantity ?? 1 };
    const warehouseId =
      input.warehouseId !== undefined ? input.warehouseId : isModuleEnabled("inventory") ? ((await defaultWarehouse(tx))?.id ?? null) : null;

    const [order] = await tx
      .insert(ordersTable)
      .values({
        contactId: input.contactId,
        conversationId: input.conversationId ?? null,
        status: input.status ?? "pending",
        product: summary.product,
        quantity: summary.quantity,
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        address: input.address ?? null,
        email: input.email ?? null,
        notes: input.notes ?? null,
        paymentProofMessageId: input.paymentProofMessageId ?? null,
        createdByAgentId: input.createdByAgentId ?? null,
        source: input.source,
        warehouseId,
        priceCurrency,
        rateToBase,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        discountReason: input.discountReason ?? null,
        shippingChargeCents: Math.max(0, input.shippingChargeCents ?? 0),
        totalCents: totals.totalCents,
        externalId: input.externalId ?? null,
        externalName: input.externalName ?? null,
        isSubscription: input.isSubscription ?? false,
        externalFinancialStatus: input.externalFinancialStatus ?? null,
        externalNote: input.externalNote ?? null,
        externalTracking: input.externalTracking ?? null,
        customerLocale: input.customerLocale ?? null,
        replacesOrderId: input.replacesOrderId ?? null,
      })
      .returning();

    if (lines.length) {
      await tx.insert(orderItemsTable).values(
        lines.map((line, index) => ({
          orderId: order.id,
          productId: line.productId,
          description: line.description,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          discountCents: line.discountCents,
          totalCents: totals.lineTotals[index],
          externalLineId: line.externalLineId,
          sortOrder: index,
        })),
      );
    }

    const unlinked = lines.filter((l) => l.productId == null).length;
    await logOrderEvent(
      tx,
      order.id,
      "created",
      `Pedido creado ${SOURCE_LABELS[input.source]}${input.isSubscription ? " (suscripción)" : ""}.` +
        (unlinked ? ` ${unlinked} línea${unlinked === 1 ? "" : "s"} sin vincular al catálogo: no comprometen inventario hasta vincularlas.` : ""),
      actor,
      input.externalName ? { externalName: input.externalName } : null,
    );
    return order;
  };
  return executor ? run(executor) : db.transaction(run);
}

/** Cuánto ha salido del almacén por línea. Algo > 0 = el pedido ya despachó. */
export function hasStockOut(items: Array<Pick<OrderItem, "dispatchedQuantity">>): boolean {
  return items.some((i) => i.dispatchedQuantity > 0);
}

/**
 * Reemplaza las líneas de un pedido y recalcula totales y resumen. Solo antes de
 * despachar: lo que ya salió del almacén no se reescribe.
 */
export async function replaceOrderItems(orderId: number, items: NewOrderItem[], actor: Actor): Promise<Order> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, orderId)).for("update");
    if (!order) throw Object.assign(new Error("Pedido no encontrado."), { status: 404 });
    const current = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
    if (hasStockOut(current)) {
      throw Object.assign(new Error("Este pedido ya despachó: sus líneas no se pueden cambiar."), { status: 409 });
    }
    const { lines } = await resolveLines(tx, items);
    const totals = computeOrderTotals(lines, order.discountCents, order.shippingChargeCents);
    const summary = lines.length ? summarizeItems(lines) : { product: order.product, quantity: order.quantity };

    await tx.delete(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
    if (lines.length) {
      await tx.insert(orderItemsTable).values(
        lines.map((line, index) => ({
          orderId,
          productId: line.productId,
          description: line.description,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          discountCents: line.discountCents,
          totalCents: totals.lineTotals[index],
          externalLineId: line.externalLineId,
          sortOrder: index,
        })),
      );
    }
    const [updated] = await tx
      .update(ordersTable)
      .set({
        product: summary.product,
        quantity: summary.quantity,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        totalCents: totals.totalCents,
        updatedAt: new Date(),
      })
      .where(eq(ordersTable.id, orderId))
      .returning();
    await logOrderEvent(tx, orderId, "items", `Líneas del pedido: ${summary.product ?? "sin líneas"}.`, actor);
    return updated;
  });
}

/** Cambia descuento y cargo de envío al cliente, y recalcula el total. */
export async function updateOrderPricing(
  orderId: number,
  patch: { discountCents?: number; discountReason?: string | null; shippingChargeCents?: number },
  actor: Actor,
): Promise<Order> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, orderId)).for("update");
    if (!order) throw Object.assign(new Error("Pedido no encontrado."), { status: 404 });
    const items = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId)).orderBy(asc(orderItemsTable.sortOrder));
    const shipping = patch.shippingChargeCents ?? order.shippingChargeCents;
    // Un pedido sin líneas (de antes del inventario) no tiene de dónde sacar el
    // subtotal: el descuento se guarda igual, contra un subtotal de cero.
    const totals = computeOrderTotals(items, patch.discountCents ?? order.discountCents, shipping);
    const [updated] = await tx
      .update(ordersTable)
      .set({
        discountCents: items.length ? totals.discountCents : Math.max(0, patch.discountCents ?? order.discountCents),
        discountReason: patch.discountReason !== undefined ? patch.discountReason : order.discountReason,
        shippingChargeCents: Math.max(0, shipping),
        subtotalCents: totals.subtotalCents,
        totalCents: items.length ? totals.totalCents : order.totalCents,
        updatedAt: new Date(),
      })
      .where(eq(ordersTable.id, orderId))
      .returning();
    if ((patch.discountCents ?? order.discountCents) !== order.discountCents || patch.discountReason !== undefined) {
      await logOrderEvent(
        tx,
        orderId,
        "pricing",
        `Descuento del pedido: ${(updated.discountCents / 100).toFixed(2)} ${updated.priceCurrency ?? BASE_CURRENCY}${updated.discountReason ? ` (${updated.discountReason})` : ""}.`,
        actor,
      );
    }
    return updated;
  });
}

// ── Para pintar ───────────────────────────────────────────────────────────────

export type ActiveOrderSummary = {
  id: number;
  code: string;
  status: OrderStatus;
  product: string | null;
  quantity: number;
};

function toActiveSummary(o: Order): ActiveOrderSummary {
  return { id: o.id, code: orderCode(o.id), status: o.status as OrderStatus, product: o.product, quantity: o.quantity };
}

// Para pintar en la bandeja: una consulta para toda la lista de conversaciones,
// igual que hace buildConversations con contactos y agentes.
export async function activeOrdersByConversationIds(
  conversationIds: number[],
): Promise<Map<number, ActiveOrderSummary>> {
  const ids = [...new Set(conversationIds)];
  if (ids.length === 0) return new Map();

  const rows = await db.select().from(ordersTable).where(inArray(ordersTable.conversationId, ids));
  const byConversation = new Map<number, Order[]>();
  for (const row of rows) {
    if (row.conversationId == null) continue;
    const arr = byConversation.get(row.conversationId);
    if (arr) arr.push(row);
    else byConversation.set(row.conversationId, [row]);
  }

  const out = new Map<number, ActiveOrderSummary>();
  for (const [conversationId, orders] of byConversation) {
    const active = pickActiveOrder(orders);
    if (active) out.set(conversationId, toActiveSummary(active));
  }
  return out;
}

function mediaUrlFor(path: string | null): string | null {
  // Mismo servidor que ya usan las fotos y documentos del chat (/api/media/:file,
  // detrás de requireAuth): estos archivos solo los ve el panel, nunca Meta, así
  // que no hace falta una URL firmada como la de las imágenes de custom-messages.
  return path ? `/api/media/${path}` : null;
}

export type SerializedOrder = Awaited<ReturnType<typeof serializeOrders>>[number];

// Serializa en bloque: una consulta por tabla relacionada para toda la lista,
// igual que buildConversations. `orders` puede ser la lista completa o solo una.
export async function serializeOrders(orders: Order[]) {
  const orderIds = orders.map((o) => o.id);
  const contactIds = [...new Set(orders.map((o) => o.contactId))];
  const agentIds = [...new Set(orders.map((o) => o.createdByAgentId).filter((id): id is number => id != null))];
  const warehouseIds = [...new Set(orders.map((o) => o.warehouseId).filter((id): id is number => id != null))];
  const proofMessageIds = [
    ...new Set(orders.map((o) => o.paymentProofMessageId).filter((id): id is number => id != null)),
  ];

  const [contacts, agents, proofMessages, items, warehouses, credits] = await Promise.all([
    contactIds.length
      ? db
          .select({ id: contactsTable.id, name: contactsTable.name, phone: contactsTable.phone, email: contactsTable.email })
          .from(contactsTable)
          .where(inArray(contactsTable.id, contactIds))
      : [],
    agentIds.length
      ? db.select({ id: agentsTable.id, name: agentsTable.name }).from(agentsTable).where(inArray(agentsTable.id, agentIds))
      : [],
    proofMessageIds.length
      ? db.select().from(messagesTable).where(inArray(messagesTable.id, proofMessageIds))
      : [],
    orderIds.length
      ? db
          .select({
            item: orderItemsTable,
            productName: productsTable.name,
            sku: productsTable.sku,
            trackInventory: productsTable.trackInventory,
          })
          .from(orderItemsTable)
          .leftJoin(productsTable, eq(productsTable.id, orderItemsTable.productId))
          .where(inArray(orderItemsTable.orderId, orderIds))
          .orderBy(asc(orderItemsTable.sortOrder), asc(orderItemsTable.id))
      : [],
    warehouseIds.length
      ? db.select({ id: warehousesTable.id, name: warehousesTable.name }).from(warehousesTable).where(inArray(warehousesTable.id, warehouseIds))
      : [],
    orderIds.length
      ? db
          .select({ orderId: creditNoteApplicationsTable.orderId, total: sql<string>`SUM(${creditNoteApplicationsTable.amountCents})::text` })
          .from(creditNoteApplicationsTable)
          .where(inArray(creditNoteApplicationsTable.orderId, orderIds))
          .groupBy(creditNoteApplicationsTable.orderId)
      : [],
  ]);
  const creditByOrder = new Map(credits.map((c) => [c.orderId, Number(c.total)] as const));
  const kitIds = new Set(
    (
      await (items.length
        ? db
            .selectDistinct({ id: productComponentsTable.kitProductId })
            .from(productComponentsTable)
            .where(inArray(productComponentsTable.kitProductId, items.map((i) => i.item.productId).filter((id): id is number => id != null).concat(-1)))
        : Promise.resolve([] as Array<{ id: number }>))
    ).map((k) => k.id),
  );
  const contactById = new Map(contacts.map((c) => [c.id, c] as const));
  const agentById = new Map(agents.map((a) => [a.id, a] as const));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w] as const));
  const proofMessageById = new Map<number, Message>(proofMessages.map((m) => [m.id, m] as const));
  const itemsByOrder = new Map<number, typeof items>();
  for (const row of items) {
    const list = itemsByOrder.get(row.item.orderId) ?? [];
    list.push(row);
    itemsByOrder.set(row.item.orderId, list);
  }

  return orders.map((o) => {
    const contact = contactById.get(o.contactId);
    const proofMessage = o.paymentProofMessageId != null ? proofMessageById.get(o.paymentProofMessageId) : undefined;
    const orderItems = itemsByOrder.get(o.id) ?? [];
    return {
      id: o.id,
      code: orderCode(o.id),
      contactId: o.contactId,
      contactName: contact?.name ?? null,
      contactPhone: contact?.phone ?? null,
      contactEmail: contact?.email ?? null,
      conversationId: o.conversationId,
      status: o.status as OrderStatus,
      product: o.product,
      quantity: o.quantity,
      amount: o.amount,
      currency: o.currency,
      address: o.address,
      email: o.email,
      // El comprobante subido a mano manda; si el pedido lo abrió el chat, cae al
      // mensaje con la imagen o el documento que el cliente mandó.
      paymentProofUrl: mediaUrlFor(o.paymentProofPath) ?? proofMessage?.mediaUrl ?? null,
      shippingLabelUrl: mediaUrlFor(o.shippingLabelPath),
      notes: o.notes,
      createdByAgentName: o.createdByAgentId != null ? (agentById.get(o.createdByAgentId)?.name ?? null) : null,
      source: o.source as OrderSource,
      warehouseId: o.warehouseId,
      warehouseName: o.warehouseId != null ? (warehouseById.get(o.warehouseId)?.name ?? null) : null,
      priceCurrency: o.priceCurrency ?? BASE_CURRENCY,
      rateToBase: o.rateToBase,
      subtotalCents: o.subtotalCents,
      discountCents: o.discountCents,
      discountReason: o.discountReason,
      shippingChargeCents: o.shippingChargeCents,
      totalCents: o.totalCents,
      shippingCostCents: o.shippingCostCents,
      externalName: o.externalName,
      isSubscription: o.isSubscription,
      externalFinancialStatus: o.externalFinancialStatus,
      externalNote: o.externalNote,
      externalTracking: (o.externalTracking ?? []).map((t) => ({ number: t.number, company: t.company, url: t.url, deliveredAt: t.deliveredAt })),
      replacesOrderId: o.replacesOrderId,
      hasUnlinkedItems: orderItems.some((i) => i.item.productId == null),
      stockOut: hasStockOut(orderItems.map((i) => i.item)),
      creditAppliedCents: creditByOrder.get(o.id) ?? 0,
      items: orderItems.map(({ item, productName, sku, trackInventory }) => ({
        id: item.id,
        productId: item.productId,
        productName: productName ?? null,
        sku: sku ?? null,
        isKit: item.productId != null && kitIds.has(item.productId),
        trackInventory: trackInventory ?? false,
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountCents: item.discountCents,
        totalCents: item.totalCents,
        dispatchedQuantity: item.dispatchedQuantity,
      })),
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    };
  });
}

export async function serializeOrder(order: Order) {
  const [out] = await serializeOrders([order]);
  return out;
}

/**
 * Lo que costó el pedido y lo que dejó, en la moneda base: el costo de lo que
 * salió del almacén (sus movimientos, a costo PEPS: despacho menos lo que volvió),
 * el costo de envío repartido y las notas de crédito.
 */
export async function orderMargin(order: Order) {
  const [cogsRow] = await db
    .select({ value: sql<string>`COALESCE(SUM(${stockMovementsTable.valueCents}), 0)::text` })
    .from(stockMovementsTable)
    .where(
      and(
        eq(stockMovementsTable.orderId, order.id),
        inArray(stockMovementsTable.type, ["dispatch", "dispatch_reversal", "return"]),
      ),
    );
  const [creditRow] = await db
    .select({ value: sql<string>`COALESCE(SUM(${creditNotesTable.amountCents}), 0)::text` })
    .from(creditNotesTable)
    .where(and(eq(creditNotesTable.orderId, order.id), eq(creditNotesTable.status, "issued")));
  const revenueCents = toBaseCents(order.totalCents, order.rateToBase);
  const costOfGoodsCents = -Number(cogsRow?.value ?? 0);
  const creditNotesCents = toBaseCents(Number(creditRow?.value ?? 0), order.rateToBase);
  return {
    currency: BASE_CURRENCY,
    revenueCents,
    costOfGoodsCents,
    shippingCostCents: order.shippingCostCents,
    creditNotesCents,
    marginCents: revenueCents - costOfGoodsCents - order.shippingCostCents - creditNotesCents,
    rateMissing: order.priceCurrency != null && order.priceCurrency !== BASE_CURRENCY && order.rateToBase == null,
  };
}

async function note(conversationId: number, content: string): Promise<void> {
  await db.insert(messagesTable).values({ conversationId, sender: "bot", content, type: "text", isAiSuggestion: false, isInternal: true });
}

// Deja constancia del cambio en el propio chat: quien lo esté viendo ve por qué
// el badge de pedido cambió, sin tener que ir a la vista de Pedidos a
// enterarse. Solo cuando el pedido salió de una conversación.
export async function noteOrderStatusChange(order: Order, log: Log): Promise<void> {
  if (order.conversationId == null) return;
  const label = ORDER_STATUS_LABELS[order.status as OrderStatus];
  await note(order.conversationId, `📦 Pedido ${orderCode(order.id)} pasó a "${label}".`);
  log.info({ orderId: order.id, conversationId: order.conversationId, status: order.status }, "order status changed");
}

/** Una nota interna en el chat del pedido (si salió de uno). */
export async function noteOnOrderConversation(order: Pick<Order, "conversationId">, content: string): Promise<void> {
  if (order.conversationId == null) return;
  await note(order.conversationId, content);
}

const NOTIFICATION_PROOF_TTL_SECONDS = 600;

function summarizeProduct(product: string | null, quantity: number): string {
  if (!product) return `${quantity} unidad${quantity === 1 ? "" : "es"} (sin especificar)`;
  return quantity > 1 && !/ x\d/.test(product) ? `${product} x${quantity}` : product;
}

// Avisa por WhatsApp, a un número fijo del equipo (business.orderNotificationPhone
// — nadie si no está configurado), que entró un pedido: el comprobante, qué y
// cuánto se vendió, a quién y a dónde, y el correo cuando el pedido lo trae —
// hoy eso solo pasa en los envíos a Estados Unidos, que son los únicos donde el
// agente lo pide. No bloquea la creación del pedido si Meta rechaza el envío o
// la instancia no tiene el número configurado.
export async function notifyOrderCreated(
  order: Order,
  contact: { name: string | null; phone: string | null },
  log: Log,
): Promise<void> {
  const to = clientConfig.business.orderNotificationPhone;
  if (!to) return;

  const lines = [
    `📦 Nuevo pedido ${orderCode(order.id)}`,
    `Producto: ${summarizeProduct(order.product, order.quantity)}`,
    `Cliente: ${contact.name ?? "Sin nombre"}`,
    `Teléfono: ${contact.phone ?? "—"}`,
    `Dirección: ${order.address ?? "Pendiente de confirmar"}`,
  ];
  if (order.email) lines.push(`Correo: ${order.email}`);
  const text = lines.join("\n");

  try {
    const settings = await loadSettings();
    if (!settings) {
      log.warn({ orderId: order.id }, "order notification skipped: no integration settings configured");
      return;
    }

    const proofPath = order.paymentProofPath ?? (await proofPathFromMessage(order.paymentProofMessageId));
    const proofUrl = proofPath ? await signMediaUrl(proofPath, NOTIFICATION_PROOF_TTL_SECONDS) : null;

    const result = proofUrl
      ? await deliverMediaMessage(settings, "whatsapp", to, { type: "image", url: proofUrl, caption: text })
      : await deliverMessage(settings, "whatsapp", to, text);
    if (!result.ok && !result.skipped) {
      log.error({ orderId: order.id, error: result.error }, "order notification failed to send");
    }
  } catch (err) {
    log.error({ err, orderId: order.id }, "order notification crashed");
  }
}

// El comprobante de un pedido nacido en el chat vive como cualquier otro
// adjunto: mismo bucket que uploadMedia, con la ruta guardada en `mediaUrl`
// como "/api/media/<archivo>". Se le quita el prefijo para volver a firmarlo.
async function proofPathFromMessage(messageId: number | null): Promise<string | null> {
  if (messageId == null) return null;
  const [message] = await db.select({ mediaUrl: messagesTable.mediaUrl }).from(messagesTable).where(eq(messagesTable.id, messageId));
  return message?.mediaUrl?.replace(/^\/api\/media\//, "") ?? null;
}

/** Los productos que la IA puede elegir al leer un pedido del chat: los activos del catálogo. */
async function sellableCatalog(): Promise<Array<{ id: number; slug: string; name: string }>> {
  return db
    .select({ id: productsTable.id, slug: productsTable.slug, name: productsTable.name })
    .from(productsTable)
    .where(eq(productsTable.active, true))
    .orderBy(asc(productsTable.name))
    .limit(300);
}

// Se llama al detectar PEDIDO_CONFIRMADO: crea el pedido en Pendiente con lo que
// se pueda leer del chat (producto, cantidad, dirección, correo si lo dio, y el
// comprobante que el cliente mandó), para que el equipo no tenga que
// transcribirlo a mano, y avisa por WhatsApp al número del equipo. El monto no
// se extrae aquí — quien verifica el pago lo pone contra la transferencia real.
// Con el catálogo, la IA además elige los productos (líneas vinculadas, que
// comprometen inventario); lo que no case queda como línea sin vincular.
// Nunca lanza: un pedido a medias no debe tumbar el resto del flujo.
export async function createOrderFromConversation(
  conv: { id: number; contactId: number },
  history: Message[],
  log: Log,
): Promise<void> {
  try {
    // El comprobante es el último adjunto del cliente antes de la confirmación:
    // la foto o el documento del pago.
    const proofMessage = [...history].reverse().find((m) => m.sender === "contact" && (m.type === "image" || m.type === "document"));

    const transcript = history
      .filter((m) => !m.isInternal)
      .map((m) => `${m.sender === "contact" ? "Cliente" : "Nosotros"}: ${m.content}`)
      .join("\n");
    const catalog = await sellableCatalog();
    const details = await extractOrderDetails(transcript, catalog);
    const idBySlug = new Map(catalog.map((p) => [p.slug, p.id] as const));

    const items: NewOrderItem[] = details.items.length
      ? details.items.map((i) => ({ productId: idBySlug.get(i.slug) ?? null, quantity: i.quantity }))
      : details.product
        ? [{ productId: null, description: details.product, quantity: details.quantity }]
        : [];

    const order = await createOrder(
      {
        contactId: conv.contactId,
        conversationId: conv.id,
        source: "chat",
        status: "pending",
        items,
        product: details.product,
        quantity: details.quantity,
        address: details.address,
        email: details.email,
        paymentProofMessageId: proofMessage?.id ?? null,
      },
      SYSTEM_ACTOR,
    );

    log.info({ orderId: order.id, conversationId: conv.id, product: order.product }, "order created from conversation");

    const [contact] = await db.select({ name: contactsTable.name, phone: contactsTable.phone }).from(contactsTable).where(eq(contactsTable.id, conv.contactId));
    void notifyOrderCreated(order, contact ?? { name: null, phone: null }, log);
  } catch (err) {
    log.error({ err, conversationId: conv.id }, "order creation from conversation failed");
  }
}

/** Para listados que necesitan el último pedido de un contacto (post-venta, devoluciones). */
export async function latestOrderFor(contactId: number): Promise<Order | null> {
  const [row] = await db.select().from(ordersTable).where(eq(ordersTable.contactId, contactId)).orderBy(desc(ordersTable.createdAt)).limit(1);
  return row ?? null;
}

// Los pedidos de antes del 2026-10-04 no tenían origen: los que creó una persona
// en la vista de Pedidos son "manual"; el resto los abrió el chat. Solo toca los
// que siguen marcados como chat con autor, así que después del primer arranque
// no cambia nada.
export async function backfillOrderSources(log: Log): Promise<void> {
  const updated = await db
    .update(ordersTable)
    .set({ source: "manual" })
    .where(and(eq(ordersTable.source, "chat"), isNotNull(ordersTable.createdByAgentId)))
    .returning({ id: ordersTable.id });
  if (updated.length) log.info({ updated: updated.length }, "backfilled order sources");
}
