// Despachos: los pedidos salen del almacén agrupados en un VIAJE (reparto propio,
// con chofer) o con un COURIER (cada paquete con su guía). Registrar el despacho
// es lo que convierte la venta comprometida en una salida de inventario: en UNA
// transacción, cada línea sale por lotes —primero el que vence antes— al costo
// exacto de cada lote, y el pedido pasa a Enviado. Si a uno le falta stock, no
// sale ninguno.
//
// Los cargos del despacho (courier, combustible, chofer…) son el costo del envío
// (decisión del 2026-10-04): se reparten entre sus pedidos y van al margen.
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderItemsTable,
  productsTable,
  contactsTable,
  shipmentsTable,
  shipmentOrdersTable,
  shipmentChargesTable,
  carriersTable,
  uspsLabelsTable,
  shopifyLabelsTable,
  stockMovementsTable,
  stockBalancesTable,
  stockLotsTable,
  warehousesTable,
  type Order,
  type Shipment,
  type ShipmentKind,
} from "@workspace/db";
import {
  addToLot,
  componentsByKit,
  consumeStock,
  explodeLine,
  InventoryError,
  lotLabel,
  planLotPicks,
  type Actor,
  type Executor,
  type LotPick,
} from "./inventory";
import { logOrderEvent, noteOrderStatusChange, type OrderSource, type OrderStatus } from "./orders";
import { notifyOrderStage, trackingUrlFor } from "./order-notifications";
import { alignDeliveryCheckWithShipment } from "./followups";
import { orderCode, shipmentCode } from "./codes";
import { toBaseCents, BASE_CURRENCY } from "./money";
import { serializeUspsLabel } from "./usps-label-view";
import { serializeShopifyLabel } from "./shopify-label-view";
import type { Log } from "./messaging";

// ── Puras ─────────────────────────────────────────────────────────────────────

/**
 * Reparte el costo de un despacho entre sus pedidos, en centavos de la moneda
 * base. Un cargo de un pedido concreto va entero a ese pedido; el resto se
 * reparte en partes iguales y los centavos que sobran van, de uno en uno, a los
 * pedidos de id más bajo (siempre los mismos, para que recalcular no cambie nada).
 */
export function allocateShipmentCost(
  charges: Array<{ orderId: number | null; amountCents: number; rateToBase: number }>,
  orderIds: number[],
): Map<number, number> {
  const ids = [...new Set(orderIds)].sort((a, b) => a - b);
  const out = new Map<number, number>(ids.map((id) => [id, 0]));
  let shared = 0;
  for (const charge of charges) {
    const base = toBaseCents(charge.amountCents, charge.rateToBase);
    if (charge.orderId != null && out.has(charge.orderId)) out.set(charge.orderId, out.get(charge.orderId)! + base);
    else shared += base;
  }
  if (ids.length === 0 || shared === 0) return out;
  const share = Math.trunc(shared / ids.length);
  let remainder = shared - share * ids.length;
  const step = remainder >= 0 ? 1 : -1;
  for (const id of ids) {
    let extra = 0;
    if (remainder !== 0) {
      extra = step;
      remainder -= step;
    }
    out.set(id, out.get(id)! + share + extra);
  }
  return out;
}

/** Un despacho termina cuando ninguna parada sigue pendiente. */
export function isShipmentComplete(stops: Array<{ deliveryStatus: string }>): boolean {
  return stops.length > 0 && stops.every((s) => s.deliveryStatus !== "pending");
}

// ── Lectura ───────────────────────────────────────────────────────────────────

const ACTIVE_SHIPMENT_STATUSES = ["planning", "dispatched"] as const;

export const SHIPMENT_KIND_LABELS: Record<ShipmentKind, string> = { trip: "Viaje", courier: "Courier" };

export async function serializeShipments(shipments: Shipment[]) {
  if (shipments.length === 0) return [];
  const ids = shipments.map((s) => s.id);
  const carrierIds = [...new Set(shipments.map((s) => s.carrierId).filter((id): id is number => id != null))];
  const [stops, charges, carriers, warehouses, labels, shopifyLabels] = await Promise.all([
    db
      .select({
        stop: shipmentOrdersTable,
        order: ordersTable,
        contactName: contactsTable.name,
        contactPhone: contactsTable.phone,
      })
      .from(shipmentOrdersTable)
      .innerJoin(ordersTable, eq(ordersTable.id, shipmentOrdersTable.orderId))
      .leftJoin(contactsTable, eq(contactsTable.id, ordersTable.contactId))
      .where(inArray(shipmentOrdersTable.shipmentId, ids))
      .orderBy(asc(shipmentOrdersTable.sequence), asc(shipmentOrdersTable.id)),
    db.select().from(shipmentChargesTable).where(inArray(shipmentChargesTable.shipmentId, ids)).orderBy(asc(shipmentChargesTable.id)),
    carrierIds.length ? db.select().from(carriersTable).where(inArray(carriersTable.id, carrierIds)) : [],
    db.select({ id: warehousesTable.id, name: warehousesTable.name }).from(warehousesTable),
    // Las etiquetas de USPS vivas de estas paradas (las anuladas no cuentan).
    db.select().from(uspsLabelsTable).where(and(inArray(uspsLabelsTable.shipmentId, ids), inArray(uspsLabelsTable.status, ["creating", "active"]))),
    db.select().from(shopifyLabelsTable).where(and(inArray(shopifyLabelsTable.shipmentId, ids), inArray(shopifyLabelsTable.status, ["creating", "active"]))),
  ]);
  const carrierById = new Map(carriers.map((c) => [c.id, c] as const));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w.name] as const));

  return shipments.map((s) => {
    const carrier = s.carrierId != null ? carrierById.get(s.carrierId) : undefined;
    const myStops = stops.filter((r) => r.stop.shipmentId === s.id);
    const myCharges = charges.filter((c) => c.shipmentId === s.id);
    return {
      id: s.id,
      code: shipmentCode(s.id),
      kind: s.kind,
      status: s.status,
      carrierId: s.carrierId,
      carrierName: carrier?.name ?? null,
      driverName: s.driverName,
      vehicle: s.vehicle,
      warehouseId: s.warehouseId,
      warehouseName: warehouseById.get(s.warehouseId) ?? null,
      plannedDate: s.plannedDate,
      dispatchedAt: s.dispatchedAt,
      completedAt: s.completedAt,
      notes: s.notes,
      totalCostCents: myCharges.reduce((sum, c) => sum + toBaseCents(c.amountCents, c.rateToBase), 0),
      costCurrency: BASE_CURRENCY,
      stops: myStops.map(({ stop, order, contactName, contactPhone }) => ({
        id: stop.id,
        orderId: order.id,
        orderCode: orderCode(order.id),
        externalName: order.externalName,
        contactName: contactName ?? null,
        contactPhone: contactPhone ?? null,
        address: order.address,
        product: order.product,
        orderStatus: order.status as OrderStatus,
        sequence: stop.sequence,
        trackingNumber: stop.trackingNumber,
        trackingUrl: trackingUrlFor(carrier?.trackingUrlTemplate, stop.trackingNumber),
        deliveryStatus: stop.deliveryStatus,
        deliveredAt: stop.deliveredAt,
        failureReason: stop.failureReason,
        allocatedCostCents: stop.allocatedCostCents,
        orderSource: order.source as OrderSource,
        externalTracking: (order.externalTracking ?? []).map((t) => ({ number: t.number, company: t.company, url: t.url, deliveredAt: t.deliveredAt })),
        uspsLabel: (() => {
          const label = labels.find((l) => l.shipmentId === s.id && l.orderId === order.id);
          return label ? serializeUspsLabel(label) : null;
        })(),
        shopifyLabel: (() => {
          const label = shopifyLabels.find((l) => l.shipmentId === s.id && l.orderId === order.id);
          return label ? serializeShopifyLabel(label) : null;
        })(),
      })),
      charges: myCharges.map((c) => ({
        id: c.id,
        orderId: c.orderId,
        orderCode: c.orderId != null ? orderCode(c.orderId) : null,
        concept: c.concept,
        amountCents: c.amountCents,
        currency: c.currency,
        rateToBase: c.rateToBase,
        baseAmountCents: toBaseCents(c.amountCents, c.rateToBase),
        notes: c.notes,
        createdAt: c.createdAt,
      })),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  });
}

export async function serializeShipment(shipment: Shipment) {
  const [out] = await serializeShipments([shipment]);
  return out;
}

/** Pedidos listos para salir: sin despachar, sin despacho abierto, del almacén pedido. */
export async function pendingDispatchOrders(filter: { warehouseId?: number; includePending?: boolean }) {
  const statuses: OrderStatus[] = filter.includePending ? ["pending", "processing"] : ["processing"];
  const busy = db
    .select({ orderId: shipmentOrdersTable.orderId })
    .from(shipmentOrdersTable)
    .innerJoin(shipmentsTable, eq(shipmentsTable.id, shipmentOrdersTable.shipmentId))
    .where(and(inArray(shipmentsTable.status, ["planning", "dispatched"]), eq(shipmentOrdersTable.deliveryStatus, "pending")));
  const rows = await db
    .select({ order: ordersTable, contactName: contactsTable.name, contactPhone: contactsTable.phone })
    .from(ordersTable)
    .leftJoin(contactsTable, eq(contactsTable.id, ordersTable.contactId))
    .where(
      and(
        inArray(ordersTable.status, statuses),
        notInArray(ordersTable.id, busy),
        ...(filter.warehouseId != null ? [sql`COALESCE(${ordersTable.warehouseId}, ${filter.warehouseId}) = ${filter.warehouseId}`] : []),
        sql`NOT EXISTS (SELECT 1 FROM ${orderItemsTable} WHERE ${orderItemsTable.orderId} = ${ordersTable.id} AND ${orderItemsTable.dispatchedQuantity} > 0)`,
      ),
    )
    .orderBy(asc(ordersTable.createdAt))
    .limit(500);
  return rows.map(({ order, contactName, contactPhone }) => ({
    id: order.id,
    code: orderCode(order.id),
    externalName: order.externalName,
    status: order.status as OrderStatus,
    contactName: contactName ?? null,
    contactPhone: contactPhone ?? null,
    address: order.address,
    product: order.product,
    warehouseId: order.warehouseId,
    isSubscription: order.isSubscription,
    createdAt: order.createdAt,
  }));
}

// ── Plan de despacho (los lotes sugeridos) ───────────────────────────────────

export type DispatchPart = {
  orderId: number;
  orderItemId: number;
  productId: number;
  productName: string;
  quantity: number;
  tracked: boolean;
  picks: Array<LotPick & { label: string; expiryDate: string | null }>;
  shortage: number;
};

/**
 * Lo que va a salir y de qué lotes, sin tocar nada: para el diálogo de "Registrar
 * despacho". Planifica los pedidos uno detrás del otro sobre el mismo saldo, así
 * dos pedidos no se reparten las mismas unidades de un lote.
 */
export async function planDispatch(warehouseId: number, orderIds: number[], executor: Executor = db) {
  const items = orderIds.length
    ? await executor
        .select({ item: orderItemsTable, productName: productsTable.name })
        .from(orderItemsTable)
        .leftJoin(productsTable, eq(productsTable.id, orderItemsTable.productId))
        .where(inArray(orderItemsTable.orderId, orderIds))
        .orderBy(asc(orderItemsTable.orderId), asc(orderItemsTable.sortOrder))
    : [];
  const kitIds = [...new Set(items.map((i) => i.item.productId).filter((id): id is number => id != null))];
  const components = await componentsByKit(executor, kitIds);
  const neededProductIds = new Set<number>();
  for (const { item } of items) {
    if (item.productId == null) continue;
    for (const part of explodeLine(item.productId, item.quantity - item.dispatchedQuantity, components)) neededProductIds.add(part.productId);
  }
  const products = neededProductIds.size
    ? await executor
        .select({ id: productsTable.id, name: productsTable.name, trackInventory: productsTable.trackInventory })
        .from(productsTable)
        .where(inArray(productsTable.id, [...neededProductIds]))
    : [];
  const productById = new Map(products.map((p) => [p.id, p] as const));
  const balances = neededProductIds.size
    ? await executor
        .select({
          lotId: stockBalancesTable.lotId,
          productId: stockBalancesTable.productId,
          quantity: stockBalancesTable.quantity,
          lot: stockLotsTable,
        })
        .from(stockBalancesTable)
        .innerJoin(stockLotsTable, eq(stockLotsTable.id, stockBalancesTable.lotId))
        .where(
          and(
            eq(stockBalancesTable.warehouseId, warehouseId),
            inArray(stockBalancesTable.productId, [...neededProductIds]),
            sql`${stockBalancesTable.quantity} > 0`,
          ),
        )
    : [];
  // Saldo simulado que se va gastando pedido a pedido.
  const remaining = new Map(balances.map((b) => [b.lotId, b.quantity] as const));
  const lotById = new Map(balances.map((b) => [b.lotId, b.lot] as const));

  const parts: DispatchPart[] = [];
  const unlinked: Array<{ orderId: number; orderItemId: number; description: string }> = [];
  for (const { item } of items) {
    const pending = item.quantity - item.dispatchedQuantity;
    if (pending <= 0) continue;
    if (item.productId == null) {
      unlinked.push({ orderId: item.orderId, orderItemId: item.id, description: item.description });
      continue;
    }
    for (const part of explodeLine(item.productId, pending, components)) {
      const product = productById.get(part.productId);
      const tracked = product?.trackInventory ?? false;
      if (!tracked) {
        parts.push({ orderId: item.orderId, orderItemId: item.id, productId: part.productId, productName: product?.name ?? "Producto", quantity: part.quantity, tracked, picks: [], shortage: 0 });
        continue;
      }
      const candidates = balances
        .filter((b) => b.productId === part.productId)
        .map((b) => ({ lotId: b.lotId, quantity: remaining.get(b.lotId) ?? 0, expiryDate: b.lot.expiryDate, receivedAt: b.lot.receivedAt }));
      const plan = planLotPicks(candidates, part.quantity);
      for (const pick of plan.picks) remaining.set(pick.lotId, (remaining.get(pick.lotId) ?? 0) - pick.quantity);
      parts.push({
        orderId: item.orderId,
        orderItemId: item.id,
        productId: part.productId,
        productName: product?.name ?? "Producto",
        quantity: part.quantity,
        tracked,
        picks: plan.picks.map((p) => {
          const lot = lotById.get(p.lotId)!;
          return { ...p, label: lotLabel(lot), expiryDate: lot.expiryDate };
        }),
        shortage: plan.shortage,
      });
    }
  }
  // Los lotes con saldo, para que quien despacha pueda elegir otro.
  const availableLots = balances.map((b) => ({
    lotId: b.lotId,
    productId: b.productId,
    label: lotLabel(b.lot),
    expiryDate: b.lot.expiryDate,
    quantity: b.quantity,
  }));
  return { warehouseId, parts, unlinked, availableLots, hasShortage: parts.some((p) => p.shortage > 0) };
}

// ── Escritura ─────────────────────────────────────────────────────────────────

export class FulfillmentError extends Error {
  readonly status: number;
  constructor(message: string, status = 409, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "FulfillmentError";
    this.status = status;
  }
}

export type LotSelection = { orderItemId: number; productId: number; picks: LotPick[] };

async function activeShipmentFor(executor: Executor, orderId: number, exceptShipmentId?: number) {
  const [row] = await executor
    .select({ shipmentId: shipmentOrdersTable.shipmentId })
    .from(shipmentOrdersTable)
    .innerJoin(shipmentsTable, eq(shipmentsTable.id, shipmentOrdersTable.shipmentId))
    .where(
      and(
        eq(shipmentOrdersTable.orderId, orderId),
        inArray(shipmentsTable.status, [...ACTIVE_SHIPMENT_STATUSES]),
        eq(shipmentOrdersTable.deliveryStatus, "pending"),
        ...(exceptShipmentId != null ? [ne(shipmentsTable.id, exceptShipmentId)] : []),
      ),
    )
    .limit(1);
  return row?.shipmentId ?? null;
}

export async function createShipment(
  input: {
    kind: ShipmentKind;
    warehouseId: number;
    carrierId?: number | null;
    driverName?: string | null;
    vehicle?: string | null;
    plannedDate?: string | null;
    notes?: string | null;
    orderIds?: number[];
  },
  actor: Actor,
  opts: { quiet?: boolean } = {},
): Promise<Shipment> {
  const shipment = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(shipmentsTable)
      .values({
        kind: input.kind,
        warehouseId: input.warehouseId,
        carrierId: input.carrierId ?? null,
        driverName: input.driverName?.trim() || null,
        vehicle: input.vehicle?.trim() || null,
        plannedDate: input.plannedDate || null,
        notes: input.notes?.trim() || null,
        createdByAgentId: actor.agentId,
      })
      .returning();
    if (input.orderIds?.length) await addOrdersInTx(tx, created, input.orderIds, actor, opts.quiet);
    return created;
  });
  return shipment;
}

async function addOrdersInTx(tx: Executor, shipment: Shipment, orderIds: number[], actor: Actor, quiet = false): Promise<void> {
  if (shipment.status !== "planning") throw new FulfillmentError("Solo se agregan pedidos a un despacho que no ha salido.");
  const orders = await tx.select().from(ordersTable).where(inArray(ordersTable.id, orderIds));
  const [{ maxSeq }] = await tx
    .select({ maxSeq: sql<number>`COALESCE(MAX(${shipmentOrdersTable.sequence}), 0)` })
    .from(shipmentOrdersTable)
    .where(eq(shipmentOrdersTable.shipmentId, shipment.id));
  let sequence = Number(maxSeq);
  for (const order of orders) {
    if (order.status !== "pending" && order.status !== "processing") {
      throw new FulfillmentError(`El pedido ${orderCode(order.id)} no está pendiente de despacho.`);
    }
    const items = await tx.select({ dispatched: orderItemsTable.dispatchedQuantity }).from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
    if (items.some((i) => i.dispatched > 0)) throw new FulfillmentError(`El pedido ${orderCode(order.id)} ya salió del almacén.`);
    const other = await activeShipmentFor(tx, order.id, shipment.id);
    if (other != null) throw new FulfillmentError(`El pedido ${orderCode(order.id)} ya está en el despacho ${shipmentCode(other)}.`);
    sequence += 1;
    await tx
      .insert(shipmentOrdersTable)
      .values({ shipmentId: shipment.id, orderId: order.id, sequence })
      .onConflictDoNothing();
    // El pedido se compromete en el almacén desde donde va a salir.
    if (order.warehouseId !== shipment.warehouseId) {
      await tx.update(ordersTable).set({ warehouseId: shipment.warehouseId, updatedAt: new Date() }).where(eq(ordersTable.id, order.id));
    }
    // El despacho de un solo paquete (el "Enviado" de la lista) no lo anuncia: el
    // evento del despacho ya dice en cuál salió.
    if (!quiet) {
      await logOrderEvent(tx, order.id, "shipment_assigned", `Asignado al despacho ${shipmentCode(shipment.id)} (${SHIPMENT_KIND_LABELS[shipment.kind].toLowerCase()}).`, actor, {
        shipmentId: shipment.id,
      });
    }
  }
  await recalcShipmentCosts(tx, shipment.id);
}

export async function addOrdersToShipment(shipmentId: number, orderIds: number[], actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const [shipment] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.id, shipmentId)).for("update");
    if (!shipment) throw new FulfillmentError("Despacho no encontrado.", 404);
    await addOrdersInTx(tx, shipment, orderIds, actor);
  });
}

export async function removeOrderFromShipment(shipmentId: number, orderId: number, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const [shipment] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.id, shipmentId)).for("update");
    if (!shipment) throw new FulfillmentError("Despacho no encontrado.", 404);
    if (shipment.status !== "planning") throw new FulfillmentError("El despacho ya salió: lo que no se entregue se marca \"No entregado\".");
    const deleted = await tx
      .delete(shipmentOrdersTable)
      .where(and(eq(shipmentOrdersTable.shipmentId, shipmentId), eq(shipmentOrdersTable.orderId, orderId)))
      .returning({ id: shipmentOrdersTable.id });
    if (deleted.length) {
      await logOrderEvent(tx, orderId, "shipment_removed", `Se sacó del despacho ${shipmentCode(shipmentId)}.`, actor, { shipmentId });
      await recalcShipmentCosts(tx, shipmentId);
      await refreshOrderShippingCosts(tx, [orderId]);
    }
  });
}

export async function updateStop(
  shipmentId: number,
  orderId: number,
  patch: { trackingNumber?: string | null; sequence?: number },
): Promise<void> {
  const set: Partial<typeof shipmentOrdersTable.$inferInsert> = {};
  if (patch.trackingNumber !== undefined) set.trackingNumber = patch.trackingNumber?.trim() || null;
  if (patch.sequence !== undefined) set.sequence = patch.sequence;
  if (Object.keys(set).length === 0) return;
  await db.update(shipmentOrdersTable).set(set).where(and(eq(shipmentOrdersTable.shipmentId, shipmentId), eq(shipmentOrdersTable.orderId, orderId)));
}

/** Reparte los cargos del despacho entre sus paradas y deja en cada pedido la suma de lo que le tocó en todos sus despachos. */
export async function recalcShipmentCosts(executor: Executor, shipmentId: number): Promise<void> {
  const [stops, charges] = await Promise.all([
    executor.select().from(shipmentOrdersTable).where(eq(shipmentOrdersTable.shipmentId, shipmentId)),
    executor.select().from(shipmentChargesTable).where(eq(shipmentChargesTable.shipmentId, shipmentId)),
  ]);
  const allocation = allocateShipmentCost(charges, stops.map((s) => s.orderId));
  for (const stop of stops) {
    await executor
      .update(shipmentOrdersTable)
      .set({ allocatedCostCents: allocation.get(stop.orderId) ?? 0 })
      .where(eq(shipmentOrdersTable.id, stop.id));
  }
  await refreshOrderShippingCosts(executor, stops.map((s) => s.orderId));
}

/** El costo de envío de cada pedido = lo que le tocó en todos sus despachos no cancelados. */
export async function refreshOrderShippingCosts(executor: Executor, orderIds: number[]): Promise<void> {
  if (orderIds.length === 0) return;
  await executor.execute(sql`
    UPDATE ${ordersTable} AS o
    SET shipping_cost_cents = COALESCE((
      SELECT SUM(so.allocated_cost_cents) FROM ${shipmentOrdersTable} so
      JOIN ${shipmentsTable} s ON s.id = so.shipment_id
      WHERE so.order_id = o.id AND s.status <> 'cancelled'
    ), 0)
    WHERE o.id IN (${sql.join(orderIds.map((id) => sql`${id}`), sql`, `)})
  `);
}

export async function addShipmentCharge(
  shipmentId: number,
  input: { concept: string; amountCents: number; currency?: string | null; rateToBase?: number | null; orderId?: number | null; notes?: string | null },
): Promise<number> {
  return db.transaction(async (tx) => {
    const [shipment] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.id, shipmentId));
    if (!shipment) throw new FulfillmentError("Despacho no encontrado.", 404);
    if (shipment.status === "cancelled") throw new FulfillmentError("El despacho está cancelado.");
    const currency = (input.currency ?? BASE_CURRENCY).toUpperCase();
    if (currency !== BASE_CURRENCY && !(input.rateToBase && input.rateToBase > 0)) {
      throw new FulfillmentError(`Falta la tasa para llevar ${currency} a ${BASE_CURRENCY}.`, 400);
    }
    const [charge] = await tx
      .insert(shipmentChargesTable)
      .values({
        shipmentId,
        orderId: input.orderId ?? null,
        concept: input.concept.trim() || "Otro",
        amountCents: Math.max(0, Math.round(input.amountCents)),
        currency,
        rateToBase: currency === BASE_CURRENCY ? 1 : input.rateToBase!,
        notes: input.notes?.trim() || null,
      })
      .returning({ id: shipmentChargesTable.id });
    await recalcShipmentCosts(tx, shipmentId);
    return charge.id;
  });
}

export async function removeShipmentCharge(shipmentId: number, chargeId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(shipmentChargesTable).where(and(eq(shipmentChargesTable.id, chargeId), eq(shipmentChargesTable.shipmentId, shipmentId)));
    await recalcShipmentCosts(tx, shipmentId);
  });
}

type DispatchedOrder = { order: Order; lotsUsed: string[] };

/**
 * Saca del almacén lo que falta despachar de un pedido, dentro de la transacción
 * del despacho. Lo que no controla inventario (o una línea sin vincular, si se
 * permitió) se marca como salido sin movimiento.
 */
async function dispatchOrderInTx(
  tx: Executor,
  order: Order,
  shipment: Shipment,
  selections: LotSelection[],
  allowUnlinked: boolean,
  actor: Actor,
): Promise<DispatchedOrder> {
  const items = await tx.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id)).orderBy(asc(orderItemsTable.sortOrder)).for("update");
  const unlinked = items.filter((i) => i.productId == null && i.quantity > i.dispatchedQuantity);
  if (unlinked.length && !allowUnlinked) {
    throw new FulfillmentError(
      `El pedido ${orderCode(order.id)} tiene líneas sin vincular al catálogo (${unlinked.map((i) => i.description).join(", ")}): no descontarían inventario. Vincúlalas o confirma que salen igual.`,
      409,
      { orderId: order.id, unlinked: unlinked.map((i) => i.id) },
    );
  }
  const kitIds = [...new Set(items.map((i) => i.productId).filter((id): id is number => id != null))];
  const components = await componentsByKit(tx, kitIds);
  const partIds = new Set<number>();
  for (const item of items) if (item.productId != null) for (const p of explodeLine(item.productId, 1, components)) partIds.add(p.productId);
  const tracked = partIds.size
    ? new Map(
        (await tx.select({ id: productsTable.id, trackInventory: productsTable.trackInventory, name: productsTable.name }).from(productsTable).where(inArray(productsTable.id, [...partIds]))).map(
          (p) => [p.id, p] as const,
        ),
      )
    : new Map<number, { id: number; trackInventory: boolean; name: string }>();

  const lotsUsed: string[] = [];
  for (const item of items) {
    const pending = item.quantity - item.dispatchedQuantity;
    if (pending <= 0) continue;
    if (item.productId != null) {
      for (const part of explodeLine(item.productId, pending, components)) {
        const product = tracked.get(part.productId);
        if (!product?.trackInventory) continue;
        const chosen = selections.find((s) => s.orderItemId === item.id && s.productId === part.productId)?.picks ?? null;
        const consumed = await consumeStock(tx, {
          type: "dispatch",
          productId: part.productId,
          warehouseId: shipment.warehouseId,
          quantity: part.quantity,
          lotPicks: chosen,
          refs: { orderId: order.id, orderItemId: item.id, shipmentId: shipment.id },
          actor,
        }).catch((err: unknown) => {
          if (err instanceof InventoryError) {
            throw new FulfillmentError(`${orderCode(order.id)} · ${product.name}: ${err.message}`, 409, { orderId: order.id, ...err.details });
          }
          throw err;
        });
        const lots = consumed.length
          ? await tx.select().from(stockLotsTable).where(inArray(stockLotsTable.id, consumed.map((c) => c.lotId)))
          : [];
        for (const c of consumed) {
          const lot = lots.find((l) => l.id === c.lotId);
          lotsUsed.push(`${product.name}: lote ${lot ? lotLabel(lot) : c.lotId} x${c.quantity}`);
        }
      }
    }
    await tx.update(orderItemsTable).set({ dispatchedQuantity: item.quantity, updatedAt: new Date() }).where(eq(orderItemsTable.id, item.id));
  }

  const [updated] = await tx
    .update(ordersTable)
    .set({ status: "shipped", warehouseId: shipment.warehouseId, updatedAt: new Date() })
    .where(eq(ordersTable.id, order.id))
    .returning();
  return { order: updated, lotsUsed };
}

async function afterDispatch(dispatched: DispatchedOrder[], shipment: Shipment, log: Log, actor: Actor): Promise<void> {
  const [carrier] = shipment.carrierId != null ? await db.select().from(carriersTable).where(eq(carriersTable.id, shipment.carrierId)) : [];
  const stops = await db.select().from(shipmentOrdersTable).where(eq(shipmentOrdersTable.shipmentId, shipment.id));
  for (const { order } of dispatched) {
    try {
      await noteOrderStatusChange(order, log);
      // Recién despachado: el "¿te llegó?" espera a que haya podido llegar.
      await alignDeliveryCheckWithShipment(order, log);
    } catch (err) {
      log.error({ err, orderId: order.id }, "post-dispatch bookkeeping failed");
    }
    const stop = stops.find((s) => s.orderId === order.id);
    // Sin courier en el despacho, el transportista y el enlace son los que Shopify trae con la guía.
    const external = order.externalTracking?.find((t) => t.number === stop?.trackingNumber);
    void notifyOrderStage(
      order.id,
      "dispatched",
      {
        shipmentKind: shipment.kind,
        carrierName: carrier?.name ?? external?.company ?? null,
        trackingNumber: stop?.trackingNumber ?? null,
        trackingUrl: trackingUrlFor(carrier?.trackingUrlTemplate, stop?.trackingNumber) ?? external?.url ?? null,
      },
      log,
      { actor },
    );
  }
}

/** Registra la salida de un despacho completo: todo o nada. */
export async function dispatchShipment(
  shipmentId: number,
  opts: { selections?: LotSelection[]; allowUnlinked?: boolean },
  actor: Actor,
  log: Log,
): Promise<Shipment> {
  const { shipment, dispatched } = await db.transaction(async (tx) => {
    const [shipment] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.id, shipmentId)).for("update");
    if (!shipment) throw new FulfillmentError("Despacho no encontrado.", 404);
    if (shipment.status !== "planning") throw new FulfillmentError("Este despacho ya salió o se canceló.");
    const stops = await tx.select().from(shipmentOrdersTable).where(eq(shipmentOrdersTable.shipmentId, shipmentId)).orderBy(asc(shipmentOrdersTable.sequence));
    if (stops.length === 0) throw new FulfillmentError("El despacho no tiene pedidos.");
    const orders = await tx.select().from(ordersTable).where(inArray(ordersTable.id, stops.map((s) => s.orderId))).for("update");

    const plan = await planDispatch(shipment.warehouseId, orders.map((o) => o.id), tx);
    const shortages = plan.parts.filter((p) => p.shortage > 0 && !opts.selections?.some((s) => s.orderItemId === p.orderItemId && s.productId === p.productId));
    if (shortages.length) {
      throw new FulfillmentError(
        `No hay existencias suficientes: ${shortages.map((s) => `${orderCode(s.orderId)} · ${s.productName} (faltan ${s.shortage})`).join("; ")}.`,
        409,
        { shortages },
      );
    }

    // La guía que Shopify ya tiene del pedido (la etiqueta se compró allá) pasa a la
    // parada si no trae una: así sale en el correo y no hay que teclearla.
    for (const stop of stops) {
      const external = stop.trackingNumber ? null : orders.find((o) => o.id === stop.orderId)?.externalTracking?.[0];
      if (!external) continue;
      await tx.update(shipmentOrdersTable).set({ trackingNumber: external.number }).where(eq(shipmentOrdersTable.id, stop.id));
      stop.trackingNumber = external.number;
    }

    const dispatched: DispatchedOrder[] = [];
    for (const stop of stops) {
      const order = orders.find((o) => o.id === stop.orderId);
      if (!order) continue;
      if (order.status !== "pending" && order.status !== "processing") {
        throw new FulfillmentError(`El pedido ${orderCode(order.id)} ya no está pendiente de despacho (${order.status}).`);
      }
      const done = await dispatchOrderInTx(tx, order, shipment, opts.selections ?? [], opts.allowUnlinked ?? false, actor);
      await logOrderEvent(
        tx,
        order.id,
        "dispatched",
        `Despachado en ${shipmentCode(shipment.id)} (${SHIPMENT_KIND_LABELS[shipment.kind].toLowerCase()})${stop.trackingNumber ? `, guía ${stop.trackingNumber}` : ""}.${done.lotsUsed.length ? ` ${done.lotsUsed.join("; ")}.` : ""}`,
        actor,
        { shipmentId: shipment.id, trackingNumber: stop.trackingNumber },
      );
      dispatched.push(done);
    }
    const [updated] = await tx
      .update(shipmentsTable)
      .set({ status: "dispatched", dispatchedAt: new Date(), updatedAt: new Date() })
      .where(eq(shipmentsTable.id, shipmentId))
      .returning();
    return { shipment: updated, dispatched };
  });
  await afterDispatch(dispatched, shipment, log, actor);
  log.info({ shipmentId, orders: dispatched.length }, "shipment dispatched");
  return shipment;
}

/**
 * Despacha UN pedido sin armar un despacho a mano (el "Enviado" de la lista, o
 * el app): se crea su despacho de un solo paquete, así la salida queda con su
 * código y su guía igual que las demás.
 */
export async function dispatchSingleOrder(
  orderId: number,
  opts: {
    kind?: ShipmentKind;
    carrierId?: number | null;
    trackingNumber?: string | null;
    selections?: LotSelection[];
    allowUnlinked?: boolean;
  },
  actor: Actor,
  log: Log,
): Promise<Order> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) throw new FulfillmentError("Pedido no encontrado.", 404);
  // Si ya estaba en un despacho que no ha salido, sale ese despacho entero no:
  // se saca de ahí y sale solo.
  const existing = await activeShipmentFor(db, orderId);
  if (existing != null) {
    const [shipment] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, existing));
    if (shipment?.status === "planning") await removeOrderFromShipment(existing, orderId, actor);
    else throw new FulfillmentError(`El pedido ya salió en el despacho ${shipmentCode(existing)}.`);
  }
  const warehouseId = order.warehouseId ?? (await db.select({ id: warehousesTable.id }).from(warehousesTable).orderBy(desc(warehousesTable.isDefault), asc(warehousesTable.id)).limit(1))[0]?.id;
  if (warehouseId == null) throw new FulfillmentError("No hay ningún almacén: crea uno en Inventario → Almacenes.", 409);

  // Lo que se puede saber antes de crear nada: si falta stock o hay líneas sin
  // vincular, no se abre un despacho que no va a salir.
  const plan = await planDispatch(warehouseId, [orderId]);
  const shortages = plan.parts.filter((p) => p.shortage > 0 && !opts.selections?.some((s) => s.orderItemId === p.orderItemId && s.productId === p.productId));
  if (shortages.length) {
    throw new FulfillmentError(
      `No hay existencias suficientes: ${shortages.map((s) => `${orderCode(s.orderId)} · ${s.productName} (faltan ${s.shortage})`).join("; ")}.`,
      409,
      { shortages },
    );
  }
  if (plan.unlinked.length && !opts.allowUnlinked) {
    throw new FulfillmentError(
      `El pedido ${orderCode(orderId)} tiene líneas sin vincular al catálogo (${plan.unlinked.map((u) => u.description).join(", ")}): no descontarían inventario. Vincúlalas o confirma que salen igual.`,
      409,
      { orderId, unlinked: plan.unlinked.map((u) => u.orderItemId) },
    );
  }

  const shipment = await createShipment({ kind: opts.kind ?? "courier", warehouseId, carrierId: opts.carrierId ?? null, orderIds: [orderId] }, actor, { quiet: true });
  if (opts.trackingNumber) await updateStop(shipment.id, orderId, { trackingNumber: opts.trackingNumber });
  try {
    await dispatchShipment(shipment.id, { selections: opts.selections, allowUnlinked: opts.allowUnlinked }, actor, log);
  } catch (err) {
    // No salió (un lote elegido que ya no alcanza, otro despacho se llevó el
    // stock entre medio): el despacho de un solo paquete no tiene razón de existir.
    await db.delete(shipmentsTable).where(eq(shipmentsTable.id, shipment.id));
    throw err;
  }
  const [updated] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  return updated;
}

async function completeIfDone(tx: Executor, shipmentId: number): Promise<void> {
  const stops = await tx.select({ deliveryStatus: shipmentOrdersTable.deliveryStatus }).from(shipmentOrdersTable).where(eq(shipmentOrdersTable.shipmentId, shipmentId));
  if (isShipmentComplete(stops)) {
    await tx.update(shipmentsTable).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(shipmentsTable.id, shipmentId), eq(shipmentsTable.status, "dispatched")));
  }
}

/** La parada se entregó: el pedido pasa a Entregado. */
export async function markStopDelivered(shipmentId: number, orderId: number, actor: Actor, log: Log): Promise<Order> {
  const order = await db.transaction(async (tx) => {
    const [stop] = await tx
      .select()
      .from(shipmentOrdersTable)
      .where(and(eq(shipmentOrdersTable.shipmentId, shipmentId), eq(shipmentOrdersTable.orderId, orderId)))
      .for("update");
    if (!stop) throw new FulfillmentError("Ese pedido no está en el despacho.", 404);
    const [shipment] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.id, shipmentId));
    if (shipment?.status !== "dispatched" && shipment?.status !== "completed") throw new FulfillmentError("El despacho todavía no ha salido.");
    if (stop.deliveryStatus === "failed") throw new FulfillmentError("Esa parada se marcó como no entregada y el pedido volvió al almacén.");
    await tx.update(shipmentOrdersTable).set({ deliveryStatus: "delivered", deliveredAt: new Date() }).where(eq(shipmentOrdersTable.id, stop.id));
    const [updated] = await tx.update(ordersTable).set({ status: "delivered", updatedAt: new Date() }).where(eq(ordersTable.id, orderId)).returning();
    await logOrderEvent(tx, orderId, "delivered", `Entregado (despacho ${shipmentCode(shipmentId)}).`, actor, { shipmentId });
    await completeIfDone(tx, shipmentId);
    return updated;
  });
  await noteOrderStatusChange(order, log).catch(() => undefined);
  void notifyOrderStage(orderId, "delivered", {}, log, { actor });
  return order;
}

/** Marca Entregado un pedido Enviado, buscando su despacho (para el cambio de estado de la lista y el app). */
export async function markOrderDelivered(orderId: number, actor: Actor, log: Log): Promise<Order> {
  const [stop] = await db
    .select({ shipmentId: shipmentOrdersTable.shipmentId })
    .from(shipmentOrdersTable)
    .where(and(eq(shipmentOrdersTable.orderId, orderId), eq(shipmentOrdersTable.deliveryStatus, "pending")))
    .orderBy(desc(shipmentOrdersTable.id))
    .limit(1);
  if (stop) return markStopDelivered(stop.shipmentId, orderId, actor, log);
  // Un pedido que se envió antes de que existieran los despachos.
  const [order] = await db.update(ordersTable).set({ status: "delivered", updatedAt: new Date() }).where(eq(ordersTable.id, orderId)).returning();
  await logOrderEvent(db, orderId, "delivered", "Entregado.", actor);
  await noteOrderStatusChange(order, log).catch(() => undefined);
  void notifyOrderStage(orderId, "delivered", {}, log, { actor });
  return order;
}

/**
 * La parada no se entregó y el paquete volvió: se deshace la salida sobre los
 * MISMOS lotes y valores (dispatch_reversal) y el pedido vuelve a En proceso,
 * listo para otro despacho. El costo del envío fallido se queda con el pedido.
 */
export async function markStopFailed(shipmentId: number, orderId: number, reason: string | null, actor: Actor, log: Log): Promise<Order> {
  const order = await db.transaction(async (tx) => {
    const [stop] = await tx
      .select()
      .from(shipmentOrdersTable)
      .where(and(eq(shipmentOrdersTable.shipmentId, shipmentId), eq(shipmentOrdersTable.orderId, orderId)))
      .for("update");
    if (!stop) throw new FulfillmentError("Ese pedido no está en el despacho.", 404);
    if (stop.deliveryStatus !== "pending") throw new FulfillmentError("Esa parada ya se cerró.");
    const [shipment] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.id, shipmentId));
    if (shipment?.status !== "dispatched") throw new FulfillmentError("El despacho todavía no ha salido.");

    // Las salidas de este pedido en este despacho que todavía no se han deshecho.
    const movements = await tx
      .select()
      .from(stockMovementsTable)
      .where(
        and(
          eq(stockMovementsTable.type, "dispatch"),
          eq(stockMovementsTable.orderId, orderId),
          eq(stockMovementsTable.shipmentId, shipmentId),
          sql`${stockMovementsTable.id} NOT IN (SELECT reverses_movement_id FROM stock_movements WHERE type = 'dispatch_reversal' AND order_id = ${orderId} AND reverses_movement_id IS NOT NULL)`,
        ),
      );
    for (const m of movements) {
      await addToLot(tx, {
        type: "dispatch_reversal",
        lotId: m.lotId,
        productId: m.productId,
        warehouseId: m.warehouseId,
        quantity: -m.quantity,
        valueCents: -m.valueCents,
        refs: { orderId, orderItemId: m.orderItemId, shipmentId, reversesMovementId: m.id, note: reason },
        actor,
      });
    }
    await tx.update(orderItemsTable).set({ dispatchedQuantity: 0, updatedAt: new Date() }).where(eq(orderItemsTable.orderId, orderId));
    await tx
      .update(shipmentOrdersTable)
      .set({ deliveryStatus: "failed", failureReason: reason?.trim() || null })
      .where(eq(shipmentOrdersTable.id, stop.id));
    const [updated] = await tx.update(ordersTable).set({ status: "processing", updatedAt: new Date() }).where(eq(ordersTable.id, orderId)).returning();
    await logOrderEvent(
      tx,
      orderId,
      "delivery_failed",
      `No se entregó (despacho ${shipmentCode(shipmentId)})${reason?.trim() ? `: ${reason.trim()}` : ""}. Volvió al almacén y queda listo para otro despacho.`,
      actor,
      { shipmentId },
    );
    await completeIfDone(tx, shipmentId);
    return updated;
  });
  await noteOrderStatusChange(order, log).catch(() => undefined);
  return order;
}

export async function cancelShipment(shipmentId: number, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const [shipment] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.id, shipmentId)).for("update");
    if (!shipment) throw new FulfillmentError("Despacho no encontrado.", 404);
    if (shipment.status !== "planning") throw new FulfillmentError("Solo se cancela un despacho que no ha salido.");
    const stops = await tx.select().from(shipmentOrdersTable).where(eq(shipmentOrdersTable.shipmentId, shipmentId));
    await tx.update(shipmentsTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(shipmentsTable.id, shipmentId));
    for (const stop of stops) {
      await logOrderEvent(tx, stop.orderId, "shipment_removed", `Se canceló el despacho ${shipmentCode(shipmentId)}.`, actor, { shipmentId });
    }
    await tx.delete(shipmentOrdersTable).where(eq(shipmentOrdersTable.shipmentId, shipmentId));
    await refreshOrderShippingCosts(tx, stops.map((s) => s.orderId));
  });
}
