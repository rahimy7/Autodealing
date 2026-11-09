// Contabilidad de costo del inventario: lo que vale hoy (a PEPS), lo que costó lo
// vendido en un periodo y el margen de cada pedido. No es un libro mayor: son
// las cifras que salen del libro de movimientos, para que cuadren con él.
//
// Ojo: esto NO es la "venta" de Reportes ni del Dashboard (la nota 🧾 de la
// venta cerrada en el chat). Aquí se habla de lo que salió del almacén y de su
// costo; las dos cifras miden cosas distintas a propósito.
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db, stockMovementsTable, orderEventsTable, ordersTable, contactsTable, creditNotesTable } from "@workspace/db";
import { inventoryValuation } from "./inventory";
import { BASE_CURRENCY, toBaseCents } from "./money";
import { orderCode } from "./codes";
import { addDaysToKey, startOfLocalDay } from "./time";
import type { OrderStatus } from "./orders";

/** El rango [desde, hasta) en instantes, a partir de días del negocio inclusivos. */
export function dayRange(from?: string | null, to?: string | null): { from: Date | null; to: Date | null } {
  const valid = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const f = valid(from);
  const t = valid(to);
  return { from: f ? startOfLocalDay(f) : null, to: t ? startOfLocalDay(addDaysToKey(t, 1)) : null };
}

function rangeConditions(column: typeof stockMovementsTable.createdAt, range: { from: Date | null; to: Date | null }): SQL[] {
  const out: SQL[] = [];
  if (range.from) out.push(gte(column, range.from));
  if (range.to) out.push(lt(column, range.to));
  return out;
}

export async function valuationReport(from?: string | null, to?: string | null) {
  const range = dayRange(from, to);
  const [valuation, sums] = await Promise.all([
    inventoryValuation(),
    db
      .select({ type: stockMovementsTable.type, value: sql<string>`COALESCE(SUM(${stockMovementsTable.valueCents}), 0)::text` })
      .from(stockMovementsTable)
      .where(rangeConditions(stockMovementsTable.createdAt, range).length ? and(...rangeConditions(stockMovementsTable.createdAt, range)) : undefined)
      .groupBy(stockMovementsTable.type),
  ]);
  const by = new Map(sums.map((r) => [r.type, Number(r.value)] as const));
  const v = (t: string) => by.get(t as never) ?? 0;
  return {
    currency: BASE_CURRENCY,
    totalValueCents: valuation.totalValueCents,
    ledgerValueCents: valuation.ledgerValueCents,
    byWarehouse: valuation.byWarehouse,
    // Lo despachado sale en negativo; lo que volvió sin entregarse lo compensa.
    costOfSalesCents: -(v("dispatch") + v("dispatch_reversal")),
    returnsCents: v("return"),
    adjustmentsCents: v("adjustment_in") + v("adjustment_out"),
    receiptsCents: v("receipt"),
  };
}

/**
 * Margen de cada pedido despachado en el periodo (por la fecha de su último
 * despacho), en la moneda base: ingreso − costo PEPS de lo que salió (neto de lo
 * que volvió) − costo de envío − notas de crédito.
 */
export async function orderMarginsReport(from?: string | null, to?: string | null) {
  const range = dayRange(from, to);
  const conditions: SQL[] = [eq(orderEventsTable.kind, "dispatched")];
  if (range.from) conditions.push(gte(orderEventsTable.createdAt, range.from));
  if (range.to) conditions.push(lt(orderEventsTable.createdAt, range.to));
  const dispatched = await db
    .select({ orderId: orderEventsTable.orderId, at: sql<Date>`MAX(${orderEventsTable.createdAt})` })
    .from(orderEventsTable)
    .where(and(...conditions))
    .groupBy(orderEventsTable.orderId)
    .orderBy(desc(sql`MAX(${orderEventsTable.createdAt})`))
    .limit(2000);
  if (dispatched.length === 0) return [];
  const ids = dispatched.map((d) => d.orderId);

  const [orders, cogs, credits] = await Promise.all([
    db
      .select({ order: ordersTable, contactName: contactsTable.name })
      .from(ordersTable)
      .leftJoin(contactsTable, eq(contactsTable.id, ordersTable.contactId))
      .where(inArray(ordersTable.id, ids)),
    db
      .select({ orderId: stockMovementsTable.orderId, value: sql<string>`SUM(${stockMovementsTable.valueCents})::text` })
      .from(stockMovementsTable)
      .where(and(inArray(stockMovementsTable.orderId, ids), inArray(stockMovementsTable.type, ["dispatch", "dispatch_reversal", "return"])))
      .groupBy(stockMovementsTable.orderId),
    db
      .select({ orderId: creditNotesTable.orderId, value: sql<string>`SUM(${creditNotesTable.amountCents})::text` })
      .from(creditNotesTable)
      .where(and(inArray(creditNotesTable.orderId, ids), eq(creditNotesTable.status, "issued")))
      .groupBy(creditNotesTable.orderId),
  ]);
  const cogsBy = new Map(cogs.map((r) => [r.orderId!, -Number(r.value)] as const));
  const creditBy = new Map(credits.map((r) => [r.orderId!, Number(r.value)] as const));
  const orderBy = new Map(orders.map((r) => [r.order.id, r] as const));

  return dispatched
    .map((d) => {
      const row = orderBy.get(d.orderId);
      if (!row || row.order.status === "cancelled") return null;
      const o = row.order;
      const revenueCents = toBaseCents(o.totalCents, o.rateToBase);
      const costOfGoodsCents = cogsBy.get(o.id) ?? 0;
      const creditNotesCents = toBaseCents(creditBy.get(o.id) ?? 0, o.rateToBase);
      return {
        orderId: o.id,
        orderCode: orderCode(o.id),
        externalName: o.externalName,
        contactName: row.contactName ?? null,
        status: o.status as OrderStatus,
        dispatchedAt: new Date(d.at),
        currency: BASE_CURRENCY,
        revenueCents,
        costOfGoodsCents,
        shippingCostCents: o.shippingCostCents,
        creditNotesCents,
        marginCents: revenueCents - costOfGoodsCents - o.shippingCostCents - creditNotesCents,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);
}
