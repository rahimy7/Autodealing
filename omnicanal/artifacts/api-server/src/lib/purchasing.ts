// Compras: de la necesidad a la mercancía en el almacén, en los tres pasos que
// pidió el negocio (2026-10-04):
//   1. Pedido de compra — la necesidad interna. Lo abre una persona o el barrido
//      del punto de reorden, que cada mañana completa UN pedido automático
//      abierto por almacén con lo que haga falta.
//   2. Orden de compra — el compromiso con un proveedor (se le envía por correo).
//   3. Recepción — lo que de verdad llegó. Cada línea crea un lote (capa de
//      costo PEPS) con su número de producción y vencimiento, costeado en la
//      moneda base con la tasa de la recepción, y lo suma al almacén.
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  productsTable,
  warehousesTable,
  reorderRulesTable,
  suppliersTable,
  purchaseRequestsTable,
  purchaseRequestItemsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  purchaseReceiptsTable,
  purchaseReceiptItemsTable,
  stockLotsTable,
  type PurchaseOrder,
  type PurchaseReceipt,
  type PurchaseRequest,
} from "@workspace/db";
import { addToLot, createLot, lotLabel, stockSummary, SYSTEM_ACTOR, type Actor, type StockRow } from "./inventory";
import { purchaseOrderCode, purchaseRequestCode, receiptCode } from "./codes";
import { BASE_CURRENCY, formatMoney, toBaseCents } from "./money";
import { clientConfig, isModuleEnabled } from "./client-config";
import { loadSettings, type Log } from "./messaging";
import { deliverMessage } from "./meta";
import { composeNewEmail } from "./email";
import { defaultRateToBase } from "./orders";
import { localClock, localDayKey } from "./time";

export class PurchasingError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "PurchasingError";
  }
}

// ── Puras ─────────────────────────────────────────────────────────────────────

/** El estado de una orden después de recibir: completa, en parte, o como estaba. */
export function purchaseOrderStatusAfterReceipt(
  lines: Array<{ quantity: number; receivedQuantity: number }>,
  current: PurchaseOrder["status"],
): PurchaseOrder["status"] {
  if (lines.length > 0 && lines.every((l) => l.receivedQuantity >= l.quantity)) return "received";
  if (lines.some((l) => l.receivedQuantity > 0)) return "partial";
  return current;
}

/** Por qué se pide, dicho para la persona que aprueba. */
export function reorderReason(row: Pick<StockRow, "available" | "onOrder" | "requested" | "minQuantity" | "targetQuantity">): string {
  const parts = [`Disponible ${row.available}`];
  if (row.onOrder) parts.push(`viene ${row.onOrder}`);
  if (row.requested) parts.push(`ya pedido ${row.requested}`);
  parts.push(`mínimo ${row.minQuantity}`, `objetivo ${row.targetQuantity}`);
  return parts.join(" · ");
}

// ── Pedidos de compra ────────────────────────────────────────────────────────

export async function serializePurchaseRequests(rows: PurchaseRequest[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [items, warehouses] = await Promise.all([
    db
      .select({
        item: purchaseRequestItemsTable,
        productName: productsTable.name,
        sku: productsTable.sku,
        supplierName: suppliersTable.name,
        purchaseOrderId: purchaseOrderItemsTable.purchaseOrderId,
      })
      .from(purchaseRequestItemsTable)
      .innerJoin(productsTable, eq(productsTable.id, purchaseRequestItemsTable.productId))
      .leftJoin(suppliersTable, eq(suppliersTable.id, purchaseRequestItemsTable.suggestedSupplierId))
      .leftJoin(purchaseOrderItemsTable, eq(purchaseOrderItemsTable.id, purchaseRequestItemsTable.purchaseOrderItemId))
      .where(inArray(purchaseRequestItemsTable.requestId, ids))
      .orderBy(asc(purchaseRequestItemsTable.id)),
    db.select({ id: warehousesTable.id, name: warehousesTable.name }).from(warehousesTable),
  ]);
  const warehouseName = new Map(warehouses.map((w) => [w.id, w.name] as const));
  return rows.map((r) => ({
    id: r.id,
    code: purchaseRequestCode(r.id),
    status: r.status,
    origin: r.origin as "manual" | "reorder",
    warehouseId: r.warehouseId,
    warehouseName: warehouseName.get(r.warehouseId) ?? null,
    notes: r.notes,
    approvedAt: r.approvedAt,
    items: items
      .filter((i) => i.item.requestId === r.id)
      .map(({ item, productName, sku, supplierName, purchaseOrderId }) => ({
        id: item.id,
        productId: item.productId,
        productName,
        sku,
        quantity: item.quantity,
        suggestedSupplierId: item.suggestedSupplierId,
        suggestedSupplierName: supplierName ?? null,
        reason: item.reason,
        purchaseOrderItemId: item.purchaseOrderItemId,
        purchaseOrderCode: purchaseOrderId != null ? purchaseOrderCode(purchaseOrderId) : null,
      })),
    createdAt: r.createdAt,
  }));
}

type RequestItemInput = { productId: number; quantity: number; suggestedSupplierId?: number | null; reason?: string | null };

/** El proveedor preferido de cada producto en un almacén (de su punto de reorden). */
async function preferredSuppliers(warehouseId: number, productIds: number[]): Promise<Map<number, number>> {
  if (productIds.length === 0) return new Map();
  const rules = await db
    .select({ productId: reorderRulesTable.productId, supplierId: reorderRulesTable.preferredSupplierId })
    .from(reorderRulesTable)
    .where(and(eq(reorderRulesTable.warehouseId, warehouseId), inArray(reorderRulesTable.productId, productIds)));
  return new Map(rules.filter((r) => r.supplierId != null).map((r) => [r.productId, r.supplierId!] as const));
}

export async function createPurchaseRequest(input: { warehouseId: number; notes?: string | null; items: RequestItemInput[] }, actor: Actor): Promise<PurchaseRequest> {
  const items = input.items.filter((i) => i.quantity > 0);
  if (items.length === 0) throw new PurchasingError("El pedido de compra no tiene líneas.", 400);
  const preferred = await preferredSuppliers(input.warehouseId, items.map((i) => i.productId));
  return db.transaction(async (tx) => {
    const [request] = await tx
      .insert(purchaseRequestsTable)
      .values({ warehouseId: input.warehouseId, notes: input.notes?.trim() || null, origin: "manual", requestedByAgentId: actor.agentId })
      .returning();
    await tx.insert(purchaseRequestItemsTable).values(
      items.map((i) => ({
        requestId: request.id,
        productId: i.productId,
        quantity: Math.round(i.quantity),
        suggestedSupplierId: i.suggestedSupplierId ?? preferred.get(i.productId) ?? null,
        reason: i.reason?.trim() || null,
      })),
    );
    return request;
  });
}

export async function updatePurchaseRequest(
  id: number,
  patch: { status?: "open" | "approved" | "cancelled"; notes?: string | null; items?: RequestItemInput[] },
  actor: Actor,
): Promise<PurchaseRequest> {
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(purchaseRequestsTable).where(eq(purchaseRequestsTable.id, id)).for("update");
    if (!request) throw new PurchasingError("Pedido de compra no encontrado.", 404);
    if (request.status === "ordered" || request.status === "cancelled") throw new PurchasingError("Este pedido de compra ya se convirtió o se canceló.");
    const set: Partial<typeof purchaseRequestsTable.$inferInsert> = { updatedAt: new Date() };
    if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
    if (patch.status !== undefined) {
      set.status = patch.status;
      if (patch.status === "approved") {
        set.approvedAt = new Date();
        set.approvedByAgentId = actor.agentId;
      }
    }
    if (patch.items !== undefined) {
      const items = patch.items.filter((i) => i.quantity > 0);
      await tx.delete(purchaseRequestItemsTable).where(and(eq(purchaseRequestItemsTable.requestId, id), isNull(purchaseRequestItemsTable.purchaseOrderItemId)));
      if (items.length) {
        await tx.insert(purchaseRequestItemsTable).values(
          items.map((i) => ({
            requestId: id,
            productId: i.productId,
            quantity: Math.round(i.quantity),
            suggestedSupplierId: i.suggestedSupplierId ?? null,
            reason: i.reason?.trim() || null,
          })),
        );
      }
    }
    const [updated] = await tx.update(purchaseRequestsTable).set(set).where(eq(purchaseRequestsTable.id, id)).returning();
    return updated;
  });
}

/** El último costo pagado a un proveedor por un producto, para precargar la orden. */
async function lastUnitCosts(supplierId: number, productIds: number[]): Promise<Map<number, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([purchaseOrderItemsTable.productId], { productId: purchaseOrderItemsTable.productId, unitCostCents: purchaseOrderItemsTable.unitCostCents })
    .from(purchaseOrderItemsTable)
    .innerJoin(purchaseOrdersTable, eq(purchaseOrdersTable.id, purchaseOrderItemsTable.purchaseOrderId))
    .where(and(eq(purchaseOrdersTable.supplierId, supplierId), inArray(purchaseOrderItemsTable.productId, productIds)))
    .orderBy(purchaseOrderItemsTable.productId, desc(purchaseOrderItemsTable.id));
  return new Map(rows.map((r) => [r.productId, r.unitCostCents] as const));
}

/**
 * Convierte un pedido de compra en órdenes de compra, una por proveedor
 * sugerido. Una línea sin proveedor no se puede pedir: hay que elegírselo antes.
 */
export async function convertPurchaseRequest(requestId: number, actor: Actor): Promise<PurchaseOrder[]> {
  const [request] = await db.select().from(purchaseRequestsTable).where(eq(purchaseRequestsTable.id, requestId));
  if (!request) throw new PurchasingError("Pedido de compra no encontrado.", 404);
  if (request.status === "ordered" || request.status === "cancelled") throw new PurchasingError("Este pedido de compra ya se convirtió o se canceló.");
  const items = await db
    .select()
    .from(purchaseRequestItemsTable)
    .where(and(eq(purchaseRequestItemsTable.requestId, requestId), isNull(purchaseRequestItemsTable.purchaseOrderItemId)));
  if (items.length === 0) throw new PurchasingError("No queda nada por pedir en este pedido de compra.");
  const missing = items.filter((i) => i.suggestedSupplierId == null);
  if (missing.length) {
    const names = await db.select({ name: productsTable.name }).from(productsTable).where(inArray(productsTable.id, missing.map((m) => m.productId)));
    throw new PurchasingError(`Elige el proveedor de: ${names.map((n) => n.name).join(", ")}.`, 400);
  }
  const bySupplier = new Map<number, typeof items>();
  for (const item of items) {
    const list = bySupplier.get(item.suggestedSupplierId!) ?? [];
    list.push(item);
    bySupplier.set(item.suggestedSupplierId!, list);
  }
  const suppliers = await db.select().from(suppliersTable).where(inArray(suppliersTable.id, [...bySupplier.keys()]));

  const orders: PurchaseOrder[] = [];
  await db.transaction(async (tx) => {
    for (const [supplierId, lines] of bySupplier) {
      const supplier = suppliers.find((s) => s.id === supplierId);
      const currency = (supplier?.currency ?? BASE_CURRENCY).toUpperCase();
      const costs = await lastUnitCosts(supplierId, lines.map((l) => l.productId));
      const today = localDayKey(new Date());
      const [po] = await tx
        .insert(purchaseOrdersTable)
        .values({
          supplierId,
          warehouseId: request.warehouseId,
          currency,
          // La de hoy, si el banco la dio; la que vale es la de la recepción.
          rateToBase: await defaultRateToBase(currency),
          orderDate: today,
          notes: `Desde el pedido de compra ${purchaseRequestCode(request.id)}.`,
          createdByAgentId: actor.agentId,
        })
        .returning();
      for (const line of lines) {
        const [poItem] = await tx
          .insert(purchaseOrderItemsTable)
          .values({
            purchaseOrderId: po.id,
            productId: line.productId,
            quantity: line.quantity,
            unitCostCents: costs.get(line.productId) ?? 0,
            requestItemId: line.id,
          })
          .returning();
        await tx.update(purchaseRequestItemsTable).set({ purchaseOrderItemId: poItem.id }).where(eq(purchaseRequestItemsTable.id, line.id));
      }
      orders.push(po);
    }
    await tx.update(purchaseRequestsTable).set({ status: "ordered", updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, requestId));
  });
  return orders;
}

// ── Punto de reorden ─────────────────────────────────────────────────────────

/**
 * Lo que hace falta pedir según el punto de reorden: completa (o abre) UN pedido
 * de compra automático por almacén. Como lo proyectado ya cuenta lo pedido y lo
 * que viene, correrlo dos veces no duplica nada. Además avisa al equipo, una
 * sola vez, de lo que acaba de cruzar el mínimo.
 */
export async function runReorderSweep(log: Log, actor: Actor = SYSTEM_ACTOR) {
  const rows = (await stockSummary()).filter((r) => r.minQuantity != null);
  const requestIds = new Set<number>();
  let linesAdded = 0;
  const byWarehouse = new Map<number, StockRow[]>();
  for (const r of rows.filter((x) => x.need > 0)) {
    const list = byWarehouse.get(r.warehouseId) ?? [];
    list.push(r);
    byWarehouse.set(r.warehouseId, list);
  }

  for (const [warehouseId, needs] of byWarehouse) {
    await db.transaction(async (tx) => {
      let [request] = await tx
        .select()
        .from(purchaseRequestsTable)
        .where(and(eq(purchaseRequestsTable.warehouseId, warehouseId), eq(purchaseRequestsTable.origin, "reorder"), eq(purchaseRequestsTable.status, "open")))
        .orderBy(desc(purchaseRequestsTable.id))
        .limit(1)
        .for("update");
      if (!request) {
        [request] = await tx
          .insert(purchaseRequestsTable)
          .values({ warehouseId, origin: "reorder", notes: "Abierto por el punto de reorden.", requestedByAgentId: actor.agentId })
          .returning();
      }
      requestIds.add(request.id);
      const existing = await tx
        .select()
        .from(purchaseRequestItemsTable)
        .where(and(eq(purchaseRequestItemsTable.requestId, request.id), isNull(purchaseRequestItemsTable.purchaseOrderItemId)));
      for (const need of needs) {
        const line = existing.find((e) => e.productId === need.productId);
        if (line) {
          await tx
            .update(purchaseRequestItemsTable)
            .set({ quantity: line.quantity + need.need, reason: reorderReason(need) })
            .where(eq(purchaseRequestItemsTable.id, line.id));
        } else {
          await tx.insert(purchaseRequestItemsTable).values({
            requestId: request.id,
            productId: need.productId,
            quantity: need.need,
            suggestedSupplierId: need.preferredSupplierId,
            reason: reorderReason(need),
          });
        }
        linesAdded += 1;
      }
      await tx.update(purchaseRequestsTable).set({ updatedAt: new Date() }).where(eq(purchaseRequestsTable.id, request.id));
    });
  }

  // Alerta de stock bajo: solo al cruzar el mínimo (lowSince vacío → lleno).
  const newlyLow: StockRow[] = [];
  const rules = await db.select().from(reorderRulesTable);
  for (const row of rows) {
    const rule = rules.find((r) => r.productId === row.productId && r.warehouseId === row.warehouseId);
    if (!rule) continue;
    const low = row.status !== "ok";
    if (low && rule.lowSince == null) {
      await db.update(reorderRulesTable).set({ lowSince: new Date() }).where(eq(reorderRulesTable.id, rule.id));
      newlyLow.push(row);
    } else if (!low && rule.lowSince != null) {
      await db.update(reorderRulesTable).set({ lowSince: null }).where(eq(reorderRulesTable.id, rule.id));
    }
  }
  const alerted = newlyLow.length > 0 ? await notifyLowStock(newlyLow, log) : false;
  if (linesAdded || newlyLow.length) log.info({ linesAdded, newlyLow: newlyLow.length, requestIds: [...requestIds] }, "reorder sweep");
  return { requestIds: [...requestIds], linesAdded, newlyLow: newlyLow.length, alerted };
}

/**
 * Avisa al equipo, por el mismo WhatsApp que recibe los pedidos nuevos
 * (business.orderNotificationPhone), de lo que acaba de bajar del mínimo. Con
 * las mismas limitaciones que ese aviso: si el número no le escribió al negocio
 * en 24 h, Meta lo rechaza; el panel muestra la alerta igual.
 */
async function notifyLowStock(rows: StockRow[], log: Log): Promise<boolean> {
  const to = clientConfig.business.orderNotificationPhone;
  if (!to) return false;
  const lines = [
    "📉 Stock bajo el punto de reorden",
    ...rows.map((r) => `• ${r.productName} (${r.warehouseName}): disponible ${r.available}, mínimo ${r.minQuantity}${r.need ? ` — pedir ${r.need}` : ""}`),
    "Revisa Compras → Necesidades en el panel.",
  ];
  try {
    const settings = await loadSettings();
    if (!settings) return false;
    const result = await deliverMessage(settings, "whatsapp", to, lines.join("\n"));
    if (!result.ok && !result.skipped) log.warn({ error: result.error }, "low stock alert not delivered");
    return result.ok;
  } catch (err) {
    log.error({ err }, "low stock alert crashed");
    return false;
  }
}

// Una vez al día, a partir de las 7:00 del negocio (la misma hora que la tasa del
// banco). En memoria: si el proceso se reinicia, vuelve a correr ese día, y
// correrlo dos veces no cambia nada.
const REORDER_HOUR = 7;
let lastReorderDay: string | null = null;

export async function sweepReorderPoints(log: Log): Promise<void> {
  if (!isModuleEnabled("inventory") || !isModuleEnabled("purchasing")) return;
  const now = new Date();
  const day = localDayKey(now);
  if (day === lastReorderDay || localClock(now).hour < REORDER_HOUR) return;
  lastReorderDay = day;
  await runReorderSweep(log);
}

// ── Órdenes de compra ────────────────────────────────────────────────────────

export async function serializePurchaseOrders(rows: PurchaseOrder[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [items, suppliers, warehouses, receipts] = await Promise.all([
    db
      .select({ item: purchaseOrderItemsTable, productName: productsTable.name, sku: productsTable.sku })
      .from(purchaseOrderItemsTable)
      .innerJoin(productsTable, eq(productsTable.id, purchaseOrderItemsTable.productId))
      .where(inArray(purchaseOrderItemsTable.purchaseOrderId, ids))
      .orderBy(asc(purchaseOrderItemsTable.id)),
    db.select().from(suppliersTable).where(inArray(suppliersTable.id, [...new Set(rows.map((r) => r.supplierId))])),
    db.select({ id: warehousesTable.id, name: warehousesTable.name }).from(warehousesTable),
    db
      .select({ id: purchaseReceiptsTable.id, purchaseOrderId: purchaseReceiptsTable.purchaseOrderId, receivedAt: purchaseReceiptsTable.receivedAt })
      .from(purchaseReceiptsTable)
      .where(inArray(purchaseReceiptsTable.purchaseOrderId, ids))
      .orderBy(asc(purchaseReceiptsTable.receivedAt)),
  ]);
  const supplierById = new Map(suppliers.map((s) => [s.id, s] as const));
  const warehouseName = new Map(warehouses.map((w) => [w.id, w.name] as const));
  return rows.map((po) => {
    const lines = items.filter((i) => i.item.purchaseOrderId === po.id);
    return {
      id: po.id,
      code: purchaseOrderCode(po.id),
      supplierId: po.supplierId,
      supplierName: supplierById.get(po.supplierId)?.name ?? "Proveedor",
      supplierEmail: supplierById.get(po.supplierId)?.email ?? null,
      warehouseId: po.warehouseId,
      warehouseName: warehouseName.get(po.warehouseId) ?? null,
      status: po.status,
      currency: po.currency,
      rateToBase: po.rateToBase,
      orderDate: po.orderDate,
      expectedDate: po.expectedDate,
      supplierReference: po.supplierReference,
      notes: po.notes,
      sentAt: po.sentAt,
      totalCents: lines.reduce((sum, l) => sum + l.item.quantity * l.item.unitCostCents, 0),
      items: lines.map(({ item, productName, sku }) => ({
        id: item.id,
        productId: item.productId,
        productName,
        sku,
        quantity: item.quantity,
        unitCostCents: item.unitCostCents,
        totalCents: item.quantity * item.unitCostCents,
        receivedQuantity: item.receivedQuantity,
        pendingQuantity: Math.max(0, item.quantity - item.receivedQuantity),
      })),
      receipts: receipts.filter((r) => r.purchaseOrderId === po.id).map((r) => ({ id: r.id, code: receiptCode(r.id), receivedAt: r.receivedAt })),
      createdAt: po.createdAt,
      updatedAt: po.updatedAt,
    };
  });
}

type PoItemInput = { productId: number; quantity: number; unitCostCents: number };

export async function createPurchaseOrder(
  input: {
    supplierId: number;
    warehouseId: number;
    currency?: string | null;
    rateToBase?: number | null;
    orderDate?: string | null;
    expectedDate?: string | null;
    supplierReference?: string | null;
    notes?: string | null;
    items: PoItemInput[];
  },
  actor: Actor,
): Promise<PurchaseOrder> {
  const items = input.items.filter((i) => i.quantity > 0);
  if (items.length === 0) throw new PurchasingError("La orden no tiene líneas.", 400);
  const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, input.supplierId));
  if (!supplier) throw new PurchasingError("Proveedor no encontrado.", 404);
  const currency = (input.currency ?? supplier.currency ?? BASE_CURRENCY).toUpperCase();
  return db.transaction(async (tx) => {
    const [po] = await tx
      .insert(purchaseOrdersTable)
      .values({
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        currency,
        rateToBase: currency === BASE_CURRENCY ? 1 : (input.rateToBase ?? (await defaultRateToBase(currency))),
        orderDate: input.orderDate || localDayKey(new Date()),
        expectedDate: input.expectedDate || null,
        supplierReference: input.supplierReference?.trim() || null,
        notes: input.notes?.trim() || null,
        createdByAgentId: actor.agentId,
      })
      .returning();
    await tx.insert(purchaseOrderItemsTable).values(
      items.map((i) => ({ purchaseOrderId: po.id, productId: i.productId, quantity: Math.round(i.quantity), unitCostCents: Math.max(0, Math.round(i.unitCostCents)) })),
    );
    return po;
  });
}

export async function updatePurchaseOrder(
  id: number,
  patch: Partial<{
    supplierId: number;
    warehouseId: number;
    currency: string;
    rateToBase: number;
    orderDate: string | null;
    expectedDate: string | null;
    supplierReference: string | null;
    notes: string | null;
    items: PoItemInput[];
  }>,
): Promise<PurchaseOrder> {
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id)).for("update");
    if (!po) throw new PurchasingError("Orden de compra no encontrada.", 404);
    if (po.status !== "draft" && po.status !== "sent") throw new PurchasingError("Una orden que ya recibió mercancía, se cerró o se canceló no se edita.");
    const set: Partial<typeof purchaseOrdersTable.$inferInsert> = { updatedAt: new Date() };
    if (patch.supplierId !== undefined) set.supplierId = patch.supplierId;
    if (patch.warehouseId !== undefined) set.warehouseId = patch.warehouseId;
    if (patch.currency !== undefined) set.currency = patch.currency.toUpperCase();
    if (patch.rateToBase !== undefined) set.rateToBase = patch.rateToBase;
    if (patch.orderDate !== undefined) set.orderDate = patch.orderDate || null;
    if (patch.expectedDate !== undefined) set.expectedDate = patch.expectedDate || null;
    if (patch.supplierReference !== undefined) set.supplierReference = patch.supplierReference?.trim() || null;
    if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
    if (patch.items !== undefined) {
      const items = patch.items.filter((i) => i.quantity > 0);
      if (items.length === 0) throw new PurchasingError("La orden no puede quedar sin líneas.", 400);
      // Las líneas que venían de un pedido de compra se sueltan: vuelven a contar como pedidas.
      const old = await tx.select({ id: purchaseOrderItemsTable.id }).from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, id));
      if (old.length) {
        await tx.update(purchaseRequestItemsTable).set({ purchaseOrderItemId: null }).where(inArray(purchaseRequestItemsTable.purchaseOrderItemId, old.map((o) => o.id)));
      }
      await tx.delete(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, id));
      await tx.insert(purchaseOrderItemsTable).values(
        items.map((i) => ({ purchaseOrderId: id, productId: i.productId, quantity: Math.round(i.quantity), unitCostCents: Math.max(0, Math.round(i.unitCostCents)) })),
      );
    }
    const [updated] = await tx.update(purchaseOrdersTable).set(set).where(eq(purchaseOrdersTable.id, id)).returning();
    return updated;
  });
}

/** El texto de la orden para el correo al proveedor. */
export function purchaseOrderEmail(po: Awaited<ReturnType<typeof serializePurchaseOrders>>[number], businessName: string, message?: string | null): { subject: string; body: string } {
  const lines = po.items.map((i) => `- ${i.productName}${i.sku ? ` (${i.sku})` : ""}: ${i.quantity} x ${formatMoney(i.unitCostCents, po.currency)} = ${formatMoney(i.totalCents, po.currency)}`);
  const body = [
    message?.trim() || "Buenas, les enviamos nuestra orden de compra:",
    "",
    `Orden ${po.code}${po.supplierReference ? ` (su referencia ${po.supplierReference})` : ""}`,
    `Entregar en: ${po.warehouseName ?? "—"}${po.expectedDate ? ` · fecha esperada ${po.expectedDate}` : ""}`,
    "",
    ...lines,
    "",
    `Total: ${formatMoney(po.totalCents, po.currency)}`,
    ...(po.notes ? ["", po.notes] : []),
    "",
    "Gracias,",
    businessName,
  ].join("\n");
  return { subject: `Orden de compra ${po.code} — ${businessName}`, body };
}

export async function sendPurchaseOrder(id: number, opts: { byEmail?: boolean; to?: string | null; message?: string | null }, actor: Actor, log: Log): Promise<PurchaseOrder> {
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
  if (!po) throw new PurchasingError("Orden de compra no encontrada.", 404);
  if (po.status === "cancelled" || po.status === "closed") throw new PurchasingError("La orden está cancelada o cerrada.");
  if (opts.byEmail) {
    const [serialized] = await serializePurchaseOrders([po]);
    const to = opts.to?.trim() || serialized.supplierEmail;
    if (!to) throw new PurchasingError("El proveedor no tiene correo: escríbelo o márcala como enviada.", 400);
    if (!isModuleEnabled("email")) throw new PurchasingError("El correo no está activo en esta instancia.");
    const { subject, body } = purchaseOrderEmail(serialized, clientConfig.business.displayName, opts.message);
    const sent = await composeNewEmail({ to, subject, content: body, authorAgentId: actor.agentId }, log);
    if (!sent.ok) throw new PurchasingError(sent.error, sent.status >= 500 ? 409 : sent.status);
  }
  const [updated] = await db
    .update(purchaseOrdersTable)
    .set({ status: po.status === "draft" ? "sent" : po.status, sentAt: new Date(), updatedAt: new Date() })
    .where(eq(purchaseOrdersTable.id, id))
    .returning();
  return updated;
}

export async function cancelPurchaseOrder(id: number): Promise<PurchaseOrder> {
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
  if (!po) throw new PurchasingError("Orden de compra no encontrada.", 404);
  if (po.status !== "draft" && po.status !== "sent") throw new PurchasingError("Solo se cancela una orden que no ha recibido nada.");
  const items = await db.select({ id: purchaseOrderItemsTable.id }).from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, id));
  // Lo que venía de un pedido de compra vuelve a estar pendiente de pedir.
  if (items.length) await db.update(purchaseRequestItemsTable).set({ purchaseOrderItemId: null }).where(inArray(purchaseRequestItemsTable.purchaseOrderItemId, items.map((i) => i.id)));
  const [updated] = await db.update(purchaseOrdersTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, id)).returning();
  return updated;
}

export async function closePurchaseOrder(id: number): Promise<PurchaseOrder> {
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
  if (!po) throw new PurchasingError("Orden de compra no encontrada.", 404);
  if (po.status !== "partial" && po.status !== "sent") throw new PurchasingError("Solo se cierra una orden enviada o recibida en parte.");
  const [updated] = await db.update(purchaseOrdersTable).set({ status: "closed", updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, id)).returning();
  return updated;
}

// ── Recepciones ──────────────────────────────────────────────────────────────

export type ReceiptLineInput = {
  purchaseOrderItemId?: number | null;
  productId: number;
  quantity: number;
  unitCostCents?: number | null;
  lotNumber?: string | null;
  productionDate?: string | null;
  expiryDate?: string | null;
};

/**
 * Recibe mercancía: cada línea crea su lote (capa de costo) con el costo
 * convertido a la moneda base con la tasa de la recepción, lo suma al almacén y
 * avanza la orden de compra. Todo en una transacción.
 */
export async function receiveGoods(
  input: {
    purchaseOrderId?: number | null;
    supplierId?: number | null;
    warehouseId?: number | null;
    currency?: string | null;
    rateToBase?: number | null;
    supplierInvoice?: string | null;
    notes?: string | null;
    lines: ReceiptLineInput[];
  },
  actor: Actor,
): Promise<PurchaseReceipt> {
  const lines = input.lines.filter((l) => l.quantity > 0);
  if (lines.length === 0) throw new PurchasingError("La recepción no tiene líneas.", 400);

  return db.transaction(async (tx) => {
    let po: PurchaseOrder | null = null;
    if (input.purchaseOrderId != null) {
      [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, input.purchaseOrderId)).for("update");
      if (!po) throw new PurchasingError("Orden de compra no encontrada.", 404);
      if (po.status === "cancelled" || po.status === "closed" || po.status === "received") throw new PurchasingError("Esa orden ya está completa, cerrada o cancelada.");
    }
    const warehouseId = input.warehouseId ?? po?.warehouseId;
    if (warehouseId == null) throw new PurchasingError("Elige el almacén donde se recibe.", 400);
    const currency = (input.currency ?? po?.currency ?? BASE_CURRENCY).toUpperCase();
    const rateToBase = currency === BASE_CURRENCY ? 1 : (input.rateToBase ?? po?.rateToBase ?? (await defaultRateToBase(currency)));
    if (rateToBase == null || !(rateToBase > 0)) throw new PurchasingError(`Falta la tasa para costear ${currency} en ${BASE_CURRENCY}.`, 400);
    const poItems = po ? await tx.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, po.id)).for("update") : [];

    const [receipt] = await tx
      .insert(purchaseReceiptsTable)
      .values({
        purchaseOrderId: po?.id ?? null,
        supplierId: input.supplierId ?? po?.supplierId ?? null,
        warehouseId,
        currency,
        rateToBase,
        supplierInvoice: input.supplierInvoice?.trim() || null,
        notes: input.notes?.trim() || null,
        receivedByAgentId: actor.agentId,
        actorLabel: actor.label,
      })
      .returning();

    for (const line of lines) {
      const poItem = line.purchaseOrderItemId != null ? poItems.find((i) => i.id === line.purchaseOrderItemId) : po ? poItems.find((i) => i.productId === line.productId && i.receivedQuantity < i.quantity) : undefined;
      if (po && !poItem) throw new PurchasingError("Una línea no está en la orden de compra.", 400);
      if (poItem && line.quantity > poItem.quantity - poItem.receivedQuantity) {
        throw new PurchasingError(`Llegan más de las que faltan en la orden (${poItem.quantity - poItem.receivedQuantity}). Recibe lo extra aparte, sin orden.`, 400);
      }
      const unitCostCents = line.unitCostCents ?? poItem?.unitCostCents;
      if (unitCostCents == null || unitCostCents < 0) throw new PurchasingError("Cada línea necesita su costo unitario.", 400);
      const totalBase = toBaseCents(unitCostCents * line.quantity, rateToBase);
      const lot = await createLot(tx, {
        productId: line.productId,
        lotNumber: line.lotNumber,
        productionDate: line.productionDate,
        expiryDate: line.expiryDate,
        supplierId: receipt.supplierId,
        purchaseOrderId: po?.id ?? null,
        purchaseReceiptId: receipt.id,
        quantity: line.quantity,
        totalCostCents: totalBase,
      });
      await addToLot(tx, {
        type: "receipt",
        lotId: lot.id,
        productId: line.productId,
        warehouseId,
        quantity: line.quantity,
        valueCents: totalBase,
        refs: { purchaseReceiptId: receipt.id, note: input.notes?.trim() || null },
        actor,
      });
      await tx.insert(purchaseReceiptItemsTable).values({
        receiptId: receipt.id,
        purchaseOrderItemId: poItem?.id ?? null,
        productId: line.productId,
        quantity: line.quantity,
        unitCostCents,
        lotNumber: line.lotNumber?.trim() || null,
        productionDate: line.productionDate || null,
        expiryDate: line.expiryDate || null,
        lotId: lot.id,
      });
      if (poItem) {
        poItem.receivedQuantity += line.quantity;
        await tx.update(purchaseOrderItemsTable).set({ receivedQuantity: poItem.receivedQuantity }).where(eq(purchaseOrderItemsTable.id, poItem.id));
      }
      // Recibir es empezar a controlar el inventario del producto.
      await tx.update(productsTable).set({ trackInventory: true, updatedAt: new Date() }).where(and(eq(productsTable.id, line.productId), eq(productsTable.trackInventory, false)));
    }

    if (po) {
      const status = purchaseOrderStatusAfterReceipt(poItems, po.status);
      await tx.update(purchaseOrdersTable).set({ status, updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, po.id));
    }
    return receipt;
  });
}

export async function serializeReceipts(rows: PurchaseReceipt[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [items, suppliers, warehouses] = await Promise.all([
    db
      .select({ item: purchaseReceiptItemsTable, productName: productsTable.name, lot: stockLotsTable })
      .from(purchaseReceiptItemsTable)
      .innerJoin(productsTable, eq(productsTable.id, purchaseReceiptItemsTable.productId))
      .leftJoin(stockLotsTable, eq(stockLotsTable.id, purchaseReceiptItemsTable.lotId))
      .where(inArray(purchaseReceiptItemsTable.receiptId, ids))
      .orderBy(asc(purchaseReceiptItemsTable.id)),
    db.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable),
    db.select({ id: warehousesTable.id, name: warehousesTable.name }).from(warehousesTable),
  ]);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name] as const));
  const warehouseName = new Map(warehouses.map((w) => [w.id, w.name] as const));
  return rows.map((r) => {
    const mine = items.filter((i) => i.item.receiptId === r.id);
    const total = mine.reduce((s, i) => s + i.item.unitCostCents * i.item.quantity, 0);
    return {
      id: r.id,
      code: receiptCode(r.id),
      purchaseOrderId: r.purchaseOrderId,
      purchaseOrderCode: r.purchaseOrderId != null ? purchaseOrderCode(r.purchaseOrderId) : null,
      supplierId: r.supplierId,
      supplierName: r.supplierId != null ? (supplierName.get(r.supplierId) ?? null) : null,
      warehouseId: r.warehouseId,
      warehouseName: warehouseName.get(r.warehouseId) ?? null,
      currency: r.currency,
      rateToBase: r.rateToBase,
      supplierInvoice: r.supplierInvoice,
      notes: r.notes,
      actorLabel: r.actorLabel,
      totalCents: total,
      totalBaseCents: toBaseCents(total, r.rateToBase),
      items: mine.map(({ item, productName, lot }) => ({
        id: item.id,
        productId: item.productId,
        productName,
        quantity: item.quantity,
        unitCostCents: item.unitCostCents,
        lotNumber: item.lotNumber,
        productionDate: item.productionDate,
        expiryDate: item.expiryDate,
        lotId: item.lotId,
        lotLabel: lot ? lotLabel(lot) : null,
      })),
      receivedAt: r.receivedAt,
    };
  });
}

export async function listPurchaseRequests(status?: PurchaseRequest["status"]) {
  return db
    .select()
    .from(purchaseRequestsTable)
    .where(status ? eq(purchaseRequestsTable.status, status) : undefined)
    .orderBy(desc(purchaseRequestsTable.createdAt))
    .limit(200);
}

export async function listPurchaseOrders(status?: PurchaseOrder["status"]) {
  return db
    .select()
    .from(purchaseOrdersTable)
    .where(status ? eq(purchaseOrdersTable.status, status) : undefined)
    .orderBy(desc(purchaseOrdersTable.createdAt))
    .limit(200);
}

export async function listReceipts() {
  return db.select().from(purchaseReceiptsTable).orderBy(desc(purchaseReceiptsTable.receivedAt)).limit(200);
}

