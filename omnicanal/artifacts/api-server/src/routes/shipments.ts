import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, shipmentsTable, carriersTable } from "@workspace/db";
import {
  ListShipmentsQueryParams,
  ListShipmentsResponse,
  CreateShipmentBody,
  GetShipmentParams,
  GetShipmentResponse,
  UpdateShipmentParams,
  UpdateShipmentBody,
  UpdateShipmentResponse,
  ListPendingDispatchOrdersQueryParams,
  ListPendingDispatchOrdersResponse,
  AddShipmentOrdersParams,
  AddShipmentOrdersBody,
  UpdateShipmentStopParams,
  UpdateShipmentStopBody,
  RemoveShipmentOrderParams,
  MarkShipmentStopDeliveredParams,
  MarkShipmentStopFailedParams,
  MarkShipmentStopFailedBody,
  AddShipmentChargeParams,
  AddShipmentChargeBody,
  DeleteShipmentChargeParams,
  GetShipmentDispatchPlanParams,
  GetShipmentDispatchPlanResponse,
  DispatchShipmentParams,
  DispatchShipmentBody,
  CancelShipmentParams,
  ListCarriersResponse,
  ListCarriersResponseItem,
  CreateCarrierBody,
  UpdateCarrierParams,
  UpdateCarrierBody,
  UpdateCarrierResponse,
} from "@workspace/api-zod";
import {
  serializeShipments,
  serializeShipment,
  pendingDispatchOrders,
  createShipment,
  addOrdersToShipment,
  removeOrderFromShipment,
  updateStop,
  markStopDelivered,
  markStopFailed,
  addShipmentCharge,
  removeShipmentCharge,
  planDispatch,
  dispatchShipment,
  cancelShipment,
} from "../lib/fulfillment";
import { shipmentOrdersTable } from "@workspace/db";
import { withDomainErrors, actorFrom, badRequest } from "../lib/route-errors";

const router: IRouter = Router();

async function sendShipment(res: Response, id: number): Promise<void> {
  const [shipment] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, id));
  if (!shipment) {
    res.status(404).json({ error: "Despacho no encontrado." });
    return;
  }
  res.json(GetShipmentResponse.parse(await serializeShipment(shipment)));
}

router.get("/shipments", async (req, res): Promise<void> => {
  const parsed = ListShipmentsQueryParams.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const rows = await db
    .select()
    .from(shipmentsTable)
    .where(parsed.data.status ? eq(shipmentsTable.status, parsed.data.status) : undefined)
    .orderBy(desc(shipmentsTable.createdAt))
    .limit(200);
  res.json(ListShipmentsResponse.parse(await serializeShipments(rows)));
});

router.post(
  "/shipments",
  withDomainErrors(async (req, res) => {
    const parsed = CreateShipmentBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const shipment = await createShipment(
      {
        kind: parsed.data.kind,
        warehouseId: parsed.data.warehouseId,
        carrierId: parsed.data.carrierId ?? null,
        driverName: parsed.data.driverName ?? null,
        vehicle: parsed.data.vehicle ?? null,
        plannedDate: parsed.data.plannedDate ?? null,
        notes: parsed.data.notes ?? null,
        orderIds: parsed.data.orderIds ?? [],
      },
      actorFrom(req.user),
    );
    res.status(201).json(GetShipmentResponse.parse(await serializeShipment(shipment)));
  }),
);

// Antes de /shipments/:id, para que "pending-orders" no se lea como un id.
router.get("/shipments/pending-orders", async (req, res): Promise<void> => {
  const parsed = ListPendingDispatchOrdersQueryParams.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const rows = await pendingDispatchOrders({ warehouseId: parsed.data.warehouseId, includePending: parsed.data.includePending });
  res.json(ListPendingDispatchOrdersResponse.parse(rows));
});

router.get("/shipments/:id", async (req, res): Promise<void> => {
  const parsed = GetShipmentParams.safeParse(req.params);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  await sendShipment(res, parsed.data.id);
});

router.patch(
  "/shipments/:id",
  withDomainErrors(async (req, res) => {
    const params = UpdateShipmentParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = UpdateShipmentBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    const update: Partial<typeof shipmentsTable.$inferInsert> = { updatedAt: new Date() };
    if (body.data.carrierId !== undefined) update.carrierId = body.data.carrierId;
    if (body.data.driverName !== undefined) update.driverName = body.data.driverName?.trim() || null;
    if (body.data.vehicle !== undefined) update.vehicle = body.data.vehicle?.trim() || null;
    if (body.data.plannedDate !== undefined) update.plannedDate = body.data.plannedDate || null;
    if (body.data.notes !== undefined) update.notes = body.data.notes?.trim() || null;
    const [row] = await db.update(shipmentsTable).set(update).where(eq(shipmentsTable.id, params.data.id)).returning();
    if (!row) {
      res.status(404).json({ error: "Despacho no encontrado." });
      return;
    }
    res.json(UpdateShipmentResponse.parse(await serializeShipment(row)));
  }),
);

router.post(
  "/shipments/:id/orders",
  withDomainErrors(async (req, res) => {
    const params = AddShipmentOrdersParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = AddShipmentOrdersBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    await addOrdersToShipment(params.data.id, body.data.orderIds, actorFrom(req.user));
    await sendShipment(res, params.data.id);
  }),
);

router.patch(
  "/shipments/:id/orders/:orderId",
  withDomainErrors(async (req, res) => {
    const params = UpdateShipmentStopParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = UpdateShipmentStopBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    await updateStop(params.data.id, params.data.orderId, {
      ...(body.data.trackingNumber !== undefined ? { trackingNumber: body.data.trackingNumber } : {}),
      ...(body.data.sequence !== undefined ? { sequence: body.data.sequence } : {}),
    });
    await sendShipment(res, params.data.id);
  }),
);

router.delete(
  "/shipments/:id/orders/:orderId",
  withDomainErrors(async (req, res) => {
    const params = RemoveShipmentOrderParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    await removeOrderFromShipment(params.data.id, params.data.orderId, actorFrom(req.user));
    await sendShipment(res, params.data.id);
  }),
);

router.post(
  "/shipments/:id/orders/:orderId/delivered",
  withDomainErrors(async (req, res) => {
    const params = MarkShipmentStopDeliveredParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    await markStopDelivered(params.data.id, params.data.orderId, actorFrom(req.user), req.log);
    await sendShipment(res, params.data.id);
  }),
);

router.post(
  "/shipments/:id/orders/:orderId/failed",
  withDomainErrors(async (req, res) => {
    const params = MarkShipmentStopFailedParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = MarkShipmentStopFailedBody.safeParse(req.body ?? {});
    if (!body.success) return badRequest(res, body.error.message);
    await markStopFailed(params.data.id, params.data.orderId, body.data.reason ?? null, actorFrom(req.user), req.log);
    await sendShipment(res, params.data.id);
  }),
);

router.post(
  "/shipments/:id/charges",
  withDomainErrors(async (req, res) => {
    const params = AddShipmentChargeParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = AddShipmentChargeBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    if (body.data.orderId != null) {
      const [stop] = await db
        .select({ id: shipmentOrdersTable.id })
        .from(shipmentOrdersTable)
        .where(and(eq(shipmentOrdersTable.shipmentId, params.data.id), eq(shipmentOrdersTable.orderId, body.data.orderId)));
      if (!stop) return badRequest(res, "Ese pedido no está en el despacho.");
    }
    await addShipmentCharge(params.data.id, {
      concept: body.data.concept,
      amountCents: body.data.amountCents,
      currency: body.data.currency ?? null,
      rateToBase: body.data.rateToBase ?? null,
      orderId: body.data.orderId ?? null,
      notes: body.data.notes ?? null,
    });
    await sendShipment(res, params.data.id);
  }),
);

router.delete(
  "/shipments/:id/charges/:chargeId",
  withDomainErrors(async (req, res) => {
    const params = DeleteShipmentChargeParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    await removeShipmentCharge(params.data.id, params.data.chargeId);
    await sendShipment(res, params.data.id);
  }),
);

router.get("/shipments/:id/dispatch-plan", async (req, res): Promise<void> => {
  const parsed = GetShipmentDispatchPlanParams.safeParse(req.params);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const [shipment] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, parsed.data.id));
  if (!shipment) {
    res.status(404).json({ error: "Despacho no encontrado." });
    return;
  }
  const stops = await db.select({ orderId: shipmentOrdersTable.orderId }).from(shipmentOrdersTable).where(eq(shipmentOrdersTable.shipmentId, shipment.id)).orderBy(asc(shipmentOrdersTable.sequence));
  res.json(GetShipmentDispatchPlanResponse.parse(await planDispatch(shipment.warehouseId, stops.map((s) => s.orderId))));
});

router.post(
  "/shipments/:id/dispatch",
  withDomainErrors(async (req, res) => {
    const params = DispatchShipmentParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = DispatchShipmentBody.safeParse(req.body ?? {});
    if (!body.success) return badRequest(res, body.error.message);
    await dispatchShipment(params.data.id, { selections: body.data.selections, allowUnlinked: body.data.allowUnlinked }, actorFrom(req.user), req.log);
    await sendShipment(res, params.data.id);
  }),
);

router.post(
  "/shipments/:id/cancel",
  withDomainErrors(async (req, res) => {
    const params = CancelShipmentParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    await cancelShipment(params.data.id, actorFrom(req.user));
    await sendShipment(res, params.data.id);
  }),
);

// ── Couriers ──────────────────────────────────────────────────────────────────

router.get("/carriers", async (_req, res): Promise<void> => {
  const rows = await db.select().from(carriersTable).orderBy(asc(carriersTable.name));
  res.json(ListCarriersResponse.parse(rows));
});

router.post(
  "/carriers",
  withDomainErrors(async (req, res) => {
    const parsed = CreateCarrierBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const name = parsed.data.name?.trim();
    if (!name) return badRequest(res, "El courier necesita nombre.");
    const [row] = await db
      .insert(carriersTable)
      .values({
        name,
        kind: parsed.data.kind ?? "courier",
        trackingUrlTemplate: parsed.data.trackingUrlTemplate?.trim() || null,
        active: parsed.data.active ?? true,
      })
      .returning();
    res.status(201).json(ListCarriersResponseItem.parse(row));
  }),
);

router.patch(
  "/carriers/:id",
  withDomainErrors(async (req, res) => {
    const params = UpdateCarrierParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = UpdateCarrierBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    const update: Partial<typeof carriersTable.$inferInsert> = {};
    if (body.data.name !== undefined) update.name = body.data.name.trim();
    if (body.data.kind !== undefined) update.kind = body.data.kind;
    if (body.data.trackingUrlTemplate !== undefined) update.trackingUrlTemplate = body.data.trackingUrlTemplate?.trim() || null;
    if (body.data.active !== undefined) update.active = body.data.active;
    if (Object.keys(update).length === 0) return badRequest(res, "Nada que cambiar.");
    const [row] = await db.update(carriersTable).set(update).where(eq(carriersTable.id, params.data.id)).returning();
    if (!row) {
      res.status(404).json({ error: "Courier no encontrado." });
      return;
    }
    res.json(UpdateCarrierResponse.parse(row));
  }),
);

export default router;
