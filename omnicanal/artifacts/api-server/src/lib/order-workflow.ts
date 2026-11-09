// El cambio de estado de un pedido, con todo lo que trae detrás. Desde el
// 2026-10-04 un estado no es solo una etiqueta: Enviado quiere decir que la
// mercancía salió del almacén. Todos los caminos que mueven un pedido —la lista y
// el diálogo de Pedidos, el app, Shopify— pasan por aquí, así el inventario, el
// expediente, la nota del chat y el aviso al cliente salen siempre igual.
import { and, eq, inArray } from "drizzle-orm";
import { db, ordersTable, orderItemsTable, shipmentOrdersTable, shipmentsTable, type Order } from "@workspace/db";
import { hasStockOut, logOrderEvent, noteOrderStatusChange, orderTransition, ORDER_STATUS_LABELS, type OrderStatus } from "./orders";
import { dispatchSingleOrder, markOrderDelivered, removeOrderFromShipment, type LotSelection } from "./fulfillment";
import { notifyOrderStage } from "./order-notifications";
import { alignDeliveryCheckWithShipment } from "./followups";
import { isModuleEnabled } from "./client-config";
import { defaultWarehouse, type Actor } from "./inventory";
import type { Log } from "./messaging";
import type { ShipmentKind } from "@workspace/db";

export type DispatchInput = {
  kind?: ShipmentKind;
  carrierId?: number | null;
  trackingNumber?: string | null;
  selections?: LotSelection[];
  allowUnlinked?: boolean;
};

class StatusError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

/**
 * Lleva un pedido a `to`. Lanza un error con `status` (409) cuando el cambio no
 * se puede hacer — un pedido que ya salió del almacén no vuelve a Pendiente
 * desde aquí, y despachar sin existencias no despacha nada.
 */
export async function changeOrderStatus(
  orderId: number,
  to: OrderStatus,
  actor: Actor,
  log: Log,
  opts: { dispatch?: DispatchInput } = {},
): Promise<Order> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) throw new StatusError("Pedido no encontrado.", 404);
  const from = order.status as OrderStatus;
  const items = await db.select({ dispatchedQuantity: orderItemsTable.dispatchedQuantity }).from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  if (from === to) return order;

  // Sin inventario en la instancia —o con el módulo encendido pero sin ningún
  // almacén creado todavía, que es como queda al desplegar—, el estado vuelve a ser
  // solo una etiqueta, como antes del 2026-10-04: no hay almacén del que despachar,
  // y exigirlo dejaría al equipo sin poder marcar un pedido como Enviado.
  if (!isModuleEnabled("inventory") || (await defaultWarehouse()) == null) {
    const [updated] = await db.update(ordersTable).set({ status: to, updatedAt: new Date() }).where(eq(ordersTable.id, orderId)).returning();
    await logOrderEvent(db, orderId, to === "processing" && from === "pending" ? "payment_confirmed" : to === "cancelled" ? "cancelled" : to === "delivered" ? "delivered" : "status", `Pasó de "${ORDER_STATUS_LABELS[from]}" a "${ORDER_STATUS_LABELS[to]}".`, actor);
    await noteOrderStatusChange(updated, log).catch((err) => log.error({ err, orderId }, "order status note failed"));
    if (to === "shipped") await alignDeliveryCheckWithShipment(updated, log).catch((err) => log.error({ err, orderId }, "delivery check align failed"));
    const stage = from === "pending" && to === "processing" ? "confirmed" : to === "shipped" ? "dispatched" : to === "delivered" ? "delivered" : to === "cancelled" ? "cancelled" : null;
    if (stage) void notifyOrderStage(orderId, stage, {}, log, { actor });
    return updated;
  }

  const transition = orderTransition(from, to, { stockOut: hasStockOut(items) });
  if (!transition.ok) throw new StatusError(transition.error);

  if (transition.effect === "dispatch") {
    return dispatchSingleOrder(orderId, opts.dispatch ?? {}, actor, log);
  }
  if (transition.effect === "dispatch_then_deliver") {
    await dispatchSingleOrder(orderId, opts.dispatch ?? {}, actor, log);
    return markOrderDelivered(orderId, actor, log);
  }
  if (to === "delivered") return markOrderDelivered(orderId, actor, log);

  // Cancelar un pedido que está en un despacho que no ha salido: sale del despacho.
  if (to === "cancelled") {
    const planning = await db
      .select({ shipmentId: shipmentOrdersTable.shipmentId })
      .from(shipmentOrdersTable)
      .innerJoin(shipmentsTable, eq(shipmentsTable.id, shipmentOrdersTable.shipmentId))
      .where(and(eq(shipmentOrdersTable.orderId, orderId), inArray(shipmentsTable.status, ["planning"])));
    for (const p of planning) await removeOrderFromShipment(p.shipmentId, orderId, actor);
  }

  const [updated] = await db.update(ordersTable).set({ status: to, updatedAt: new Date() }).where(eq(ordersTable.id, orderId)).returning();
  if (from === "pending" && to === "processing") {
    await logOrderEvent(db, orderId, "payment_confirmed", "Pago confirmado: el pedido pasa a preparación.", actor);
  } else if (to === "cancelled") {
    await logOrderEvent(db, orderId, "cancelled", "Pedido cancelado: lo comprometido vuelve a estar disponible.", actor);
  } else {
    await logOrderEvent(db, orderId, "status", `Pasó de "${ORDER_STATUS_LABELS[from]}" a "${ORDER_STATUS_LABELS[to]}".`, actor);
  }
  await noteOrderStatusChange(updated, log).catch((err) => log.error({ err, orderId }, "order status note failed"));

  if (from === "pending" && to === "processing") void notifyOrderStage(orderId, "confirmed", {}, log, { actor });
  if (to === "cancelled") void notifyOrderStage(orderId, "cancelled", {}, log, { actor });
  return updated;
}
