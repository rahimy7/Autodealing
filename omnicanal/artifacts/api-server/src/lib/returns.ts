// Devoluciones y notas de crédito.
//
// Una devolución es la mercancía que el cliente regresa de un pedido que ya
// salió del almacén. Lo que vuelve en buen estado (`restock`) entra al MISMO lote
// con el costo con que salió —el del movimiento de despacho—, así el costo de lo
// vendido se corrige solo; lo dañado no vuelve a existencias y queda como merma.
//
// Se resuelve con una nota de crédito (saldo a favor del cliente), devolviendo el
// dinero (una nota de crédito que nace reembolsada) o reponiendo el producto (un
// pedido nuevo a precio cero que sale por el mismo circuito de despacho).
//
// Las notas de crédito son internas —"NC-000123", con un campo para el NCF si el
// comprobante fiscal se emitió en otro sistema (decisión del 2026-10-04)— y su
// saldo nunca se guarda: es el monto menos lo aplicado a pedidos y lo reembolsado.
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderItemsTable,
  productsTable,
  contactsTable,
  warehousesTable,
  stockMovementsTable,
  stockLotsTable,
  returnsTable,
  returnItemsTable,
  creditNotesTable,
  creditNoteApplicationsTable,
  type Return,
  type CreditNote,
  type ReturnResolution,
  type CreditNoteReason,
} from "@workspace/db";
import { addToLot, componentsByKit, lotLabel, type Actor } from "./inventory";
import { createOrder, logOrderEvent, noteOnOrderConversation, type NewOrderItem } from "./orders";
import { notifyOrderStage } from "./order-notifications";
import { orderCode, returnCode, creditNoteCode } from "./codes";
import { BASE_CURRENCY, formatMoney } from "./money";
import type { Log } from "./messaging";

export class ReturnsError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "ReturnsError";
  }
}

// ── Puras ─────────────────────────────────────────────────────────────────────

/** El saldo a favor que deja una nota de crédito. Anulada no deja nada. */
export function creditNoteBalance(note: { amountCents: number; refundedCents: number; status: string }, appliedCents: number): number {
  if (note.status === "void") return 0;
  return Math.max(0, note.amountCents - note.refundedCents - appliedCents);
}

/** El costo con que vuelve a existencias lo que salió en un despacho: el mismo, por unidad. */
export function restockValue(dispatch: { quantity: number; valueCents: number }, quantity: number): number {
  const shipped = Math.abs(dispatch.quantity);
  if (shipped === 0) return 0;
  return Math.round((Math.abs(dispatch.valueCents) * quantity) / shipped);
}

/**
 * Lo que pagó el cliente por una unidad de lo que devuelve. En un kit, el precio
 * de la línea se reparte entre sus componentes por cantidad (no hay precio por
 * componente): devolver uno de los tres productos del kit vale un tercio.
 */
export function unitRefundValue(line: { totalCents: number; quantity: number }, componentShare: number): number {
  if (line.quantity <= 0) return 0;
  return Math.round((line.totalCents / line.quantity) * componentShare);
}

// ── Lo que se puede devolver ─────────────────────────────────────────────────

type ReturnableLine = {
  orderItemId: number;
  productId: number;
  productName: string;
  description: string;
  lotId: number | null;
  lotLabel: string | null;
  warehouseId: number | null;
  quantity: number;
  unitPriceCents: number;
  // El movimiento de despacho de donde sale el costo para reingresar.
  dispatchQuantity: number;
  dispatchValueCents: number;
};

/**
 * Lo que salió de un pedido y todavía no se ha devuelto, por producto y lote:
 * los despachos netos de lo que volvió sin entregarse, menos las devoluciones no
 * canceladas. Las líneas que no controlan inventario no tienen lote: se pueden
 * devolver por cantidad, sin efecto en existencias.
 */
export async function returnableLines(orderId: number): Promise<{ order: typeof ordersTable.$inferSelect; lines: ReturnableLine[] }> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) throw new ReturnsError("Pedido no encontrado.", 404);
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId)).orderBy(asc(orderItemsTable.sortOrder));
  const [movements, previous] = await Promise.all([
    db
      .select({
        orderItemId: stockMovementsTable.orderItemId,
        productId: stockMovementsTable.productId,
        lotId: stockMovementsTable.lotId,
        warehouseId: stockMovementsTable.warehouseId,
        quantity: sql<string>`SUM(${stockMovementsTable.quantity})::text`,
        valueCents: sql<string>`SUM(${stockMovementsTable.valueCents})::text`,
      })
      .from(stockMovementsTable)
      .where(and(eq(stockMovementsTable.orderId, orderId), inArray(stockMovementsTable.type, ["dispatch", "dispatch_reversal"])))
      .groupBy(stockMovementsTable.orderItemId, stockMovementsTable.productId, stockMovementsTable.lotId, stockMovementsTable.warehouseId),
    db
      .select({
        orderItemId: returnItemsTable.orderItemId,
        productId: returnItemsTable.productId,
        lotId: returnItemsTable.lotId,
        quantity: sql<string>`SUM(${returnItemsTable.quantity})::text`,
      })
      .from(returnItemsTable)
      .innerJoin(returnsTable, eq(returnsTable.id, returnItemsTable.returnId))
      .where(and(eq(returnsTable.orderId, orderId), ne(returnsTable.status, "cancelled")))
      .groupBy(returnItemsTable.orderItemId, returnItemsTable.productId, returnItemsTable.lotId),
  ]);
  const returnedKey = (i: number, p: number, l: number | null) => `${i}:${p}:${l ?? "-"}`;
  const returned = new Map(previous.map((r) => [returnedKey(r.orderItemId, r.productId, r.lotId), Number(r.quantity)] as const));

  const productIds = new Set<number>(movements.map((m) => m.productId));
  for (const i of items) if (i.productId != null) productIds.add(i.productId);
  const [products, lots] = await Promise.all([
    productIds.size ? db.select({ id: productsTable.id, name: productsTable.name }).from(productsTable).where(inArray(productsTable.id, [...productIds])) : [],
    movements.length ? db.select().from(stockLotsTable).where(inArray(stockLotsTable.id, movements.map((m) => m.lotId))) : [],
  ]);
  const productName = new Map(products.map((p) => [p.id, p.name] as const));
  const lotById = new Map(lots.map((l) => [l.id, l] as const));
  const components = await componentsByKit(db, [...productIds]);

  const lines: ReturnableLine[] = [];
  for (const item of items) {
    if (item.productId == null || item.dispatchedQuantity <= 0) continue;
    const kitParts = components.get(item.productId);
    const perKitUnits = kitParts?.reduce((s, c) => s + c.quantity, 0) ?? 1;
    const itemMovements = movements.filter((m) => m.orderItemId === item.id && Number(m.quantity) < 0);
    if (itemMovements.length > 0) {
      for (const m of itemMovements) {
        const shipped = -Number(m.quantity);
        const left = shipped - (returned.get(returnedKey(item.id, m.productId, m.lotId)) ?? 0);
        if (left <= 0) continue;
        const lot = lotById.get(m.lotId);
        lines.push({
          orderItemId: item.id,
          productId: m.productId,
          productName: productName.get(m.productId) ?? "Producto",
          description: item.description,
          lotId: m.lotId,
          lotLabel: lot ? lotLabel(lot) : null,
          warehouseId: m.warehouseId,
          quantity: left,
          // En un kit, cada unidad de componente vale su parte del precio del kit.
          unitPriceCents: unitRefundValue(item, kitParts ? 1 / perKitUnits : 1),
          dispatchQuantity: Number(m.quantity),
          dispatchValueCents: Number(m.valueCents),
        });
      }
    } else if (!kitParts) {
      // Sin movimientos: no controla inventario (o salió antes del inventario).
      const left = item.dispatchedQuantity - (returned.get(returnedKey(item.id, item.productId, null)) ?? 0);
      if (left <= 0) continue;
      lines.push({
        orderItemId: item.id,
        productId: item.productId,
        productName: productName.get(item.productId) ?? item.description,
        description: item.description,
        lotId: null,
        lotLabel: null,
        warehouseId: null,
        quantity: left,
        unitPriceCents: unitRefundValue(item, 1),
        dispatchQuantity: 0,
        dispatchValueCents: 0,
      });
    }
  }
  return { order, lines };
}

// ── Devoluciones ─────────────────────────────────────────────────────────────

export async function createReturn(
  input: {
    orderId: number;
    caseId?: number | null;
    warehouseId?: number | null;
    reason?: string | null;
    notes?: string | null;
    lines: Array<{ orderItemId: number; productId: number; lotId?: number | null; quantity: number; condition: "restock" | "damaged" }>;
  },
  actor: Actor,
): Promise<Return> {
  const { order, lines: available } = await returnableLines(input.orderId);
  const wanted = input.lines.filter((l) => l.quantity > 0);
  if (wanted.length === 0) throw new ReturnsError("La devolución no tiene líneas.", 400);
  for (const line of wanted) {
    const match = available.find((a) => a.orderItemId === line.orderItemId && a.productId === line.productId && (a.lotId ?? null) === (line.lotId ?? null));
    if (!match) throw new ReturnsError("Una de las líneas no salió en este pedido (o ya se devolvió).");
    if (line.quantity > match.quantity) throw new ReturnsError(`De ${match.productName} se pueden devolver como mucho ${match.quantity}.`);
  }
  // Lo que vuelve entra, por defecto, al almacén de donde salió.
  const warehouseId = input.warehouseId ?? available.find((a) => a.warehouseId != null)?.warehouseId ?? order.warehouseId ?? null;

  return db.transaction(async (tx) => {
    const [ret] = await tx
      .insert(returnsTable)
      .values({
        orderId: order.id,
        contactId: order.contactId,
        caseId: input.caseId ?? null,
        warehouseId,
        reason: input.reason?.trim() || null,
        notes: input.notes?.trim() || null,
        createdByAgentId: actor.agentId,
      })
      .returning();
    await tx.insert(returnItemsTable).values(
      wanted.map((l) => ({
        returnId: ret.id,
        orderItemId: l.orderItemId,
        productId: l.productId,
        lotId: l.lotId ?? null,
        quantity: l.quantity,
        condition: l.condition,
      })),
    );
    await logOrderEvent(tx, order.id, "return", `Devolución ${returnCode(ret.id)} abierta${ret.reason ? `: ${ret.reason}` : ""}.`, actor, { returnId: ret.id });
    return ret;
  });
}

export async function cancelReturn(returnId: number, actor: Actor): Promise<Return> {
  const [ret] = await db.select().from(returnsTable).where(eq(returnsTable.id, returnId));
  if (!ret) throw new ReturnsError("Devolución no encontrada.", 404);
  if (ret.status !== "requested") throw new ReturnsError("Solo se cancela una devolución que no se ha recibido.");
  const [updated] = await db.update(returnsTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(returnsTable.id, returnId)).returning();
  await logOrderEvent(db, ret.orderId, "return", `Devolución ${returnCode(ret.id)} cancelada.`, actor, { returnId });
  return updated;
}

/** Lo que vale para el cliente lo que devuelve: el monto que se le sugiere acreditar. */
export async function suggestedReturnAmount(returnId: number): Promise<number> {
  const [ret] = await db.select().from(returnsTable).where(eq(returnsTable.id, returnId));
  if (!ret) return 0;
  const items = await db.select().from(returnItemsTable).where(eq(returnItemsTable.returnId, returnId));
  // Lo devuelto ya no figura como "devolvible": se cuenta contra las líneas del pedido.
  const orderItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, ret.orderId));
  const components = await componentsByKit(db, orderItems.map((i) => i.productId).filter((id): id is number => id != null));
  let total = 0;
  for (const it of items) {
    const line = orderItems.find((o) => o.id === it.orderItemId);
    if (!line) continue;
    const parts = line.productId != null ? components.get(line.productId) : undefined;
    const perKitUnits = parts?.reduce((s, c) => s + c.quantity, 0) ?? 1;
    total += unitRefundValue(line, parts ? 1 / perKitUnits : 1) * it.quantity;
  }
  return total;
}

/**
 * Recibe la devolución: lo vendible entra al mismo lote con el costo con que
 * salió, y se resuelve (nota de crédito, reembolso, reposición o nada). Un solo
 * aviso al cliente con todo lo que pasó.
 */
export async function receiveReturn(
  returnId: number,
  input: { resolution: ReturnResolution; amountCents?: number | null; refundMethod?: string | null; fiscalNumber?: string | null; notes?: string | null },
  actor: Actor,
  log: Log,
): Promise<Return> {
  const [ret] = await db.select().from(returnsTable).where(eq(returnsTable.id, returnId));
  if (!ret) throw new ReturnsError("Devolución no encontrada.", 404);
  if (ret.status !== "requested") throw new ReturnsError("Esta devolución ya se recibió o se canceló.");
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, ret.orderId));
  if (!order) throw new ReturnsError("El pedido de la devolución no existe.", 404);
  const items = await db.select().from(returnItemsTable).where(eq(returnItemsTable.returnId, returnId));
  const currency = (order.priceCurrency ?? BASE_CURRENCY).toUpperCase();
  const amountCents = input.amountCents ?? (await suggestedReturnAmount(returnId));
  if ((input.resolution === "credit_note" || input.resolution === "refund") && amountCents <= 0) {
    throw new ReturnsError("Para acreditar o reembolsar hace falta un monto mayor que cero.", 400);
  }

  const result = await db.transaction(async (tx) => {
    // Lo que vuelve en buen estado entra al lote de donde salió, a su costo: se
    // busca el despacho de ese producto y lote para tomar su costo unitario.
    const dispatches = await tx
      .select({
        orderItemId: stockMovementsTable.orderItemId,
        productId: stockMovementsTable.productId,
        lotId: stockMovementsTable.lotId,
        warehouseId: stockMovementsTable.warehouseId,
        quantity: sql<string>`SUM(${stockMovementsTable.quantity})::text`,
        valueCents: sql<string>`SUM(${stockMovementsTable.valueCents})::text`,
      })
      .from(stockMovementsTable)
      .where(and(eq(stockMovementsTable.orderId, ret.orderId), eq(stockMovementsTable.type, "dispatch")))
      .groupBy(stockMovementsTable.orderItemId, stockMovementsTable.productId, stockMovementsTable.lotId, stockMovementsTable.warehouseId);
    for (const item of items) {
      if (item.condition !== "restock" || item.lotId == null) continue;
      const dispatch = dispatches.find((d) => d.orderItemId === item.orderItemId && d.productId === item.productId && d.lotId === item.lotId);
      if (!dispatch) continue;
      const warehouseId = ret.warehouseId ?? dispatch.warehouseId;
      await addToLot(tx, {
        type: "return",
        lotId: item.lotId,
        productId: item.productId,
        warehouseId,
        quantity: item.quantity,
        valueCents: restockValue({ quantity: Number(dispatch.quantity), valueCents: Number(dispatch.valueCents) }, item.quantity),
        refs: { orderId: ret.orderId, orderItemId: item.orderItemId, returnId: ret.id, note: input.notes?.trim() || null },
        actor,
      });
    }

    let creditNote: CreditNote | null = null;
    if (input.resolution === "credit_note" || input.resolution === "refund") {
      [creditNote] = await tx
        .insert(creditNotesTable)
        .values({
          contactId: ret.contactId,
          orderId: ret.orderId,
          returnId: ret.id,
          caseId: ret.caseId,
          reason: "return",
          currency,
          amountCents,
          refundedCents: input.resolution === "refund" ? amountCents : 0,
          refundedAt: input.resolution === "refund" ? new Date() : null,
          refundMethod: input.resolution === "refund" ? input.refundMethod?.trim() || null : null,
          fiscalNumber: input.fiscalNumber?.trim() || null,
          notes: input.notes?.trim() || null,
          createdByAgentId: actor.agentId,
        })
        .returning();
    }

    const [updated] = await tx
      .update(returnsTable)
      .set({ status: "received", resolution: input.resolution, receivedAt: new Date(), updatedAt: new Date(), notes: input.notes?.trim() || ret.notes })
      .where(eq(returnsTable.id, ret.id))
      .returning();

    const restocked = items.filter((i) => i.condition === "restock").reduce((s, i) => s + i.quantity, 0);
    const damaged = items.filter((i) => i.condition === "damaged").reduce((s, i) => s + i.quantity, 0);
    const parts = [`Devolución ${returnCode(ret.id)} recibida`];
    if (restocked) parts.push(`${restocked} vuelven a existencias`);
    if (damaged) parts.push(`${damaged} dañadas (merma)`);
    if (creditNote) {
      parts.push(
        input.resolution === "refund"
          ? `reembolso de ${formatMoney(amountCents, currency)} (${creditNoteCode(creditNote.id)})`
          : `nota de crédito ${creditNoteCode(creditNote.id)} por ${formatMoney(amountCents, currency)}`,
      );
    }
    await logOrderEvent(tx, ret.orderId, "return", `${parts.join(", ")}.`, actor, { returnId: ret.id, creditNoteId: creditNote?.id ?? null });
    if (creditNote) {
      await logOrderEvent(tx, ret.orderId, "credit_note", `Nota de crédito ${creditNoteCode(creditNote.id)}: ${formatMoney(amountCents, currency)}.`, actor, { creditNoteId: creditNote.id });
    }
    return { updated, creditNote };
  });

  // La reposición es un pedido nuevo a precio cero que sale por el mismo circuito.
  if (input.resolution === "replacement") {
    const replacementItems: NewOrderItem[] = [];
    for (const item of items) {
      replacementItems.push({ productId: item.productId, quantity: item.quantity, unitPriceCents: 0 });
    }
    const replacement = await createOrder(
      {
        contactId: ret.contactId,
        conversationId: order.conversationId,
        source: "replacement",
        status: "processing",
        items: replacementItems,
        priceCurrency: currency,
        address: order.address,
        email: order.email,
        customerLocale: order.customerLocale,
        warehouseId: ret.warehouseId ?? order.warehouseId,
        replacesOrderId: order.id,
        notes: `Reposición de ${returnCode(ret.id)} (pedido ${orderCode(order.id)}).`,
      },
      actor,
    );
    await db.update(returnsTable).set({ replacementOrderId: replacement.id }).where(eq(returnsTable.id, ret.id));
    await logOrderEvent(db, ret.orderId, "return", `Reposición: pedido ${orderCode(replacement.id)} listo para despachar.`, actor, { replacementOrderId: replacement.id });
  }

  await noteOnOrderConversation(order, `↩️ Devolución ${returnCode(ret.id)} del pedido ${orderCode(order.id)} recibida.`).catch(() => undefined);
  void notifyOrderStage(
    ret.orderId,
    "refund",
    {
      returnCode: returnCode(ret.id),
      creditNote: result.creditNote && input.resolution === "credit_note" ? { code: creditNoteCode(result.creditNote.id), amount: formatMoney(amountCents, currency) } : null,
      refundAmount: input.resolution === "refund" ? formatMoney(amountCents, currency) : null,
    },
    log,
    { actor },
  );
  const [fresh] = await db.select().from(returnsTable).where(eq(returnsTable.id, returnId));
  return fresh;
}

export async function serializeReturns(rows: Return[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const orders = await db
    .select({ id: ordersTable.id, priceCurrency: ordersTable.priceCurrency })
    .from(ordersTable)
    .where(inArray(ordersTable.id, [...new Set(rows.map((r) => r.orderId))]));
  const currencyByOrder = new Map(orders.map((o) => [o.id, (o.priceCurrency ?? BASE_CURRENCY).toUpperCase()] as const));
  const suggested = new Map<number, number>();
  for (const r of rows) suggested.set(r.id, await suggestedReturnAmount(r.id));
  const [items, contacts, warehouses, notes] = await Promise.all([
    db
      .select({ item: returnItemsTable, productName: productsTable.name, lot: stockLotsTable })
      .from(returnItemsTable)
      .innerJoin(productsTable, eq(productsTable.id, returnItemsTable.productId))
      .leftJoin(stockLotsTable, eq(stockLotsTable.id, returnItemsTable.lotId))
      .where(inArray(returnItemsTable.returnId, ids)),
    db.select({ id: contactsTable.id, name: contactsTable.name }).from(contactsTable).where(inArray(contactsTable.id, [...new Set(rows.map((r) => r.contactId))])),
    db.select({ id: warehousesTable.id, name: warehousesTable.name }).from(warehousesTable),
    db.select({ id: creditNotesTable.id, returnId: creditNotesTable.returnId }).from(creditNotesTable).where(inArray(creditNotesTable.returnId, ids)),
  ]);
  const contactName = new Map(contacts.map((c) => [c.id, c.name] as const));
  const warehouseName = new Map(warehouses.map((w) => [w.id, w.name] as const));
  return rows.map((r) => ({
    id: r.id,
    code: returnCode(r.id),
    orderId: r.orderId,
    orderCode: orderCode(r.orderId),
    contactId: r.contactId,
    contactName: contactName.get(r.contactId) ?? null,
    caseId: r.caseId,
    warehouseId: r.warehouseId,
    warehouseName: r.warehouseId != null ? (warehouseName.get(r.warehouseId) ?? null) : null,
    status: r.status,
    reason: r.reason,
    resolution: r.resolution,
    replacementOrderId: r.replacementOrderId,
    replacementOrderCode: r.replacementOrderId != null ? orderCode(r.replacementOrderId) : null,
    creditNoteCode: (() => {
      const note = notes.find((n) => n.returnId === r.id);
      return note ? creditNoteCode(note.id) : null;
    })(),
    receivedAt: r.receivedAt,
    notes: r.notes,
    currency: currencyByOrder.get(r.orderId) ?? BASE_CURRENCY,
    suggestedAmountCents: suggested.get(r.id) ?? 0,
    items: items
      .filter((i) => i.item.returnId === r.id)
      .map(({ item, productName, lot }) => ({
        id: item.id,
        orderItemId: item.orderItemId,
        productId: item.productId,
        productName,
        lotId: item.lotId,
        lotLabel: lot ? lotLabel(lot) : null,
        quantity: item.quantity,
        condition: item.condition,
      })),
    createdAt: r.createdAt,
  }));
}

// ── Notas de crédito ─────────────────────────────────────────────────────────

export async function issueCreditNote(
  input: {
    contactId: number;
    orderId?: number | null;
    caseId?: number | null;
    reason: CreditNoteReason;
    currency?: string | null;
    amountCents: number;
    fiscalNumber?: string | null;
    notes?: string | null;
  },
  actor: Actor,
  log: Log,
): Promise<CreditNote> {
  if (input.amountCents <= 0) throw new ReturnsError("El monto tiene que ser mayor que cero.", 400);
  const [contact] = await db.select({ id: contactsTable.id }).from(contactsTable).where(eq(contactsTable.id, input.contactId));
  if (!contact) throw new ReturnsError("Cliente no encontrado.", 404);
  let currency = (input.currency ?? BASE_CURRENCY).toUpperCase();
  if (input.orderId != null) {
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, input.orderId));
    if (!order || order.contactId !== input.contactId) throw new ReturnsError("Ese pedido no es de este cliente.", 400);
    currency = (input.currency ?? order.priceCurrency ?? BASE_CURRENCY).toUpperCase();
  }
  const [note] = await db
    .insert(creditNotesTable)
    .values({
      contactId: input.contactId,
      orderId: input.orderId ?? null,
      caseId: input.caseId ?? null,
      reason: input.reason,
      currency,
      amountCents: Math.round(input.amountCents),
      fiscalNumber: input.fiscalNumber?.trim() || null,
      notes: input.notes?.trim() || null,
      createdByAgentId: actor.agentId,
    })
    .returning();
  if (note.orderId != null) {
    await logOrderEvent(db, note.orderId, "credit_note", `Nota de crédito ${creditNoteCode(note.id)}: ${formatMoney(note.amountCents, currency)}.`, actor, { creditNoteId: note.id });
    void notifyOrderStage(note.orderId, "refund", { creditNote: { code: creditNoteCode(note.id), amount: formatMoney(note.amountCents, currency) } }, log, { actor });
  }
  return note;
}

async function appliedFor(noteIds: number[]): Promise<Map<number, number>> {
  if (noteIds.length === 0) return new Map();
  const rows = await db
    .select({ id: creditNoteApplicationsTable.creditNoteId, total: sql<string>`SUM(${creditNoteApplicationsTable.amountCents})::text` })
    .from(creditNoteApplicationsTable)
    .where(inArray(creditNoteApplicationsTable.creditNoteId, noteIds))
    .groupBy(creditNoteApplicationsTable.creditNoteId);
  return new Map(rows.map((r) => [r.id, Number(r.total)] as const));
}

export async function applyCreditNote(noteId: number, orderId: number, amountCents: number, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const [note] = await tx.select().from(creditNotesTable).where(eq(creditNotesTable.id, noteId)).for("update");
    if (!note) throw new ReturnsError("Nota de crédito no encontrada.", 404);
    const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, orderId));
    if (!order) throw new ReturnsError("Pedido no encontrado.", 404);
    if (order.contactId !== note.contactId) throw new ReturnsError("La nota de crédito es de otro cliente.", 400);
    if ((order.priceCurrency ?? BASE_CURRENCY).toUpperCase() !== note.currency) throw new ReturnsError(`La nota está en ${note.currency} y el pedido en ${order.priceCurrency}.`, 400);
    const [applied] = await tx
      .select({ total: sql<string>`COALESCE(SUM(${creditNoteApplicationsTable.amountCents}), 0)::text` })
      .from(creditNoteApplicationsTable)
      .where(eq(creditNoteApplicationsTable.creditNoteId, noteId));
    const balance = creditNoteBalance(note, Number(applied?.total ?? 0));
    if (amountCents <= 0 || amountCents > balance) throw new ReturnsError(`El saldo de la nota es ${formatMoney(balance, note.currency)}.`, 400);
    await tx.insert(creditNoteApplicationsTable).values({ creditNoteId: noteId, orderId, amountCents, createdByAgentId: actor.agentId });
    await logOrderEvent(tx, orderId, "credit_note", `Se pagó ${formatMoney(amountCents, note.currency)} con la nota de crédito ${creditNoteCode(noteId)}.`, actor, { creditNoteId: noteId });
  });
}

export async function refundCreditNote(noteId: number, amountCents: number, method: string | null, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const [note] = await tx.select().from(creditNotesTable).where(eq(creditNotesTable.id, noteId)).for("update");
    if (!note) throw new ReturnsError("Nota de crédito no encontrada.", 404);
    const applied = (await appliedFor([noteId])).get(noteId) ?? 0;
    const balance = creditNoteBalance(note, applied);
    if (amountCents <= 0 || amountCents > balance) throw new ReturnsError(`El saldo de la nota es ${formatMoney(balance, note.currency)}.`, 400);
    await tx
      .update(creditNotesTable)
      .set({ refundedCents: note.refundedCents + amountCents, refundedAt: new Date(), refundMethod: method?.trim() || note.refundMethod, updatedAt: new Date() })
      .where(eq(creditNotesTable.id, noteId));
    if (note.orderId != null) {
      await logOrderEvent(tx, note.orderId, "credit_note", `Reembolso de ${formatMoney(amountCents, note.currency)} de la nota ${creditNoteCode(noteId)}${method ? ` (${method})` : ""}.`, actor);
    }
  });
}

export async function voidCreditNote(noteId: number, actor: Actor): Promise<void> {
  const [note] = await db.select().from(creditNotesTable).where(eq(creditNotesTable.id, noteId));
  if (!note) throw new ReturnsError("Nota de crédito no encontrada.", 404);
  const applied = (await appliedFor([noteId])).get(noteId) ?? 0;
  if (applied > 0 || note.refundedCents > 0) throw new ReturnsError("La nota ya se usó o se reembolsó: no se puede anular.");
  await db.update(creditNotesTable).set({ status: "void", updatedAt: new Date() }).where(eq(creditNotesTable.id, noteId));
  if (note.orderId != null) await logOrderEvent(db, note.orderId, "credit_note", `Nota de crédito ${creditNoteCode(noteId)} anulada.`, actor);
}

export async function serializeCreditNotes(rows: CreditNote[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [applications, contacts] = await Promise.all([
    db.select().from(creditNoteApplicationsTable).where(inArray(creditNoteApplicationsTable.creditNoteId, ids)).orderBy(asc(creditNoteApplicationsTable.createdAt)),
    db.select({ id: contactsTable.id, name: contactsTable.name }).from(contactsTable).where(inArray(contactsTable.id, [...new Set(rows.map((r) => r.contactId))])),
  ]);
  const contactName = new Map(contacts.map((c) => [c.id, c.name] as const));
  return rows.map((n) => {
    const mine = applications.filter((a) => a.creditNoteId === n.id);
    const appliedCents = mine.reduce((s, a) => s + a.amountCents, 0);
    return {
      id: n.id,
      code: creditNoteCode(n.id),
      contactId: n.contactId,
      contactName: contactName.get(n.contactId) ?? null,
      orderId: n.orderId,
      orderCode: n.orderId != null ? orderCode(n.orderId) : null,
      returnId: n.returnId,
      returnCode: n.returnId != null ? returnCode(n.returnId) : null,
      caseId: n.caseId,
      reason: n.reason,
      currency: n.currency,
      amountCents: n.amountCents,
      refundedCents: n.refundedCents,
      refundedAt: n.refundedAt,
      refundMethod: n.refundMethod,
      appliedCents,
      balanceCents: creditNoteBalance(n, appliedCents),
      fiscalNumber: n.fiscalNumber,
      status: n.status,
      notes: n.notes,
      applications: mine.map((a) => ({ orderId: a.orderId, orderCode: orderCode(a.orderId), amountCents: a.amountCents, createdAt: a.createdAt })),
      createdAt: n.createdAt,
    };
  });
}

/** Lo pagado con notas de crédito, por pedido (para la lista de Pedidos). */
export async function creditAppliedByOrder(orderIds: number[]): Promise<Map<number, number>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select({ orderId: creditNoteApplicationsTable.orderId, total: sql<string>`SUM(${creditNoteApplicationsTable.amountCents})::text` })
    .from(creditNoteApplicationsTable)
    .where(inArray(creditNoteApplicationsTable.orderId, orderIds))
    .groupBy(creditNoteApplicationsTable.orderId);
  return new Map(rows.map((r) => [r.orderId, Number(r.total)] as const));
}

export async function listReturnsFor(filter: { status?: Return["status"]; orderId?: number }) {
  const conditions = [];
  if (filter.status) conditions.push(eq(returnsTable.status, filter.status));
  if (filter.orderId != null) conditions.push(eq(returnsTable.orderId, filter.orderId));
  return db
    .select()
    .from(returnsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(returnsTable.createdAt))
    .limit(300);
}
