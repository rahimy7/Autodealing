import express, { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderItemsTable,
  contactsTable,
  shipmentOrdersTable,
  shipmentsTable,
  carriersTable,
} from "@workspace/db";
import {
  ListOrdersQueryParams,
  ListOrdersResponse,
  CreateOrderBody,
  GetOrderParams,
  GetOrderResponse,
  UpdateOrderParams,
  UpdateOrderBody,
  UpdateOrderResponse,
  GetOrderDetailParams,
  GetOrderDetailResponse,
  GetOrderDispatchPlanParams,
  GetOrderDispatchPlanResponse,
  NotifyOrderCustomerParams,
  NotifyOrderCustomerBody,
  NotifyOrderCustomerResponse,
} from "@workspace/api-zod";
import { isStorageConfigured, uploadMedia } from "../lib/supabase";
import {
  serializeOrder,
  serializeOrders,
  notifyOrderCreated,
  createOrder,
  replaceOrderItems,
  updateOrderPricing,
  orderEventsFor,
  orderMargin,
  hasStockOut,
  logOrderEvent,
} from "../lib/orders";
import { changeOrderStatus } from "../lib/order-workflow";
import { planDispatch } from "../lib/fulfillment";
import { notifyOrderStage, trackingUrlFor } from "../lib/order-notifications";
import { defaultWarehouse, listMovements } from "../lib/inventory";
import { shipmentCode } from "../lib/codes";
import { withDomainErrors, actorFrom, badRequest } from "../lib/route-errors";
import { requireView } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/orders", async (req, res): Promise<void> => {
  const parsed = ListOrdersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status, search, source } = parsed.data;

  const conditions = [];
  if (status) conditions.push(eq(ordersTable.status, status));
  if (source === "subscription") conditions.push(eq(ordersTable.isSubscription, true));
  else if (source) conditions.push(eq(ordersTable.source, source));
  const term = search?.trim();
  if (term) {
    const like = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
    // El código que ve el equipo es "PED-000123": si el término trae dígitos
    // (con o sin el prefijo), también se prueba como el id exacto. Y el número
    // de Shopify ("#1234") por su nombre.
    const digits = term.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    const idMatch = digits ? Number(digits) : null;
    const orConditions = [
      sql`exists (select 1 from ${contactsTable} where ${contactsTable.id} = ${ordersTable.contactId} and (${contactsTable.name} ilike ${like} or ${contactsTable.phone} ilike ${like}))`,
      sql`${ordersTable.externalName} ilike ${like}`,
    ];
    if (idMatch != null && Number.isInteger(idMatch) && idMatch > 0 && idMatch <= 2_147_483_647) orConditions.push(eq(ordersTable.id, idMatch));
    conditions.push(or(...orConditions)!);
  }

  const rows = await db
    .select()
    .from(ordersTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ordersTable.createdAt))
    .limit(300);
  res.json(ListOrdersResponse.parse(await serializeOrders(rows)));
});

router.post(
  "/orders",
  withDomainErrors(async (req, res) => {
    const parsed = CreateOrderBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const [contact] = await db.select({ id: contactsTable.id, name: contactsTable.name, phone: contactsTable.phone }).from(contactsTable).where(eq(contactsTable.id, parsed.data.contactId));
    if (!contact) {
      res.status(404).json({ error: "Contacto no encontrado." });
      return;
    }
    const order = await createOrder(
      {
        contactId: parsed.data.contactId,
        conversationId: parsed.data.conversationId ?? null,
        source: "manual",
        items: (parsed.data.items ?? []).map((i) => ({
          productId: i.productId ?? null,
          description: i.description ?? null,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents ?? null,
          discountCents: i.discountCents ?? null,
        })),
        product: parsed.data.product ?? null,
        quantity: parsed.data.quantity ?? 1,
        amount: parsed.data.amount ?? null,
        currency: parsed.data.currency ?? null,
        address: parsed.data.address ?? null,
        email: parsed.data.email ?? null,
        notes: parsed.data.notes ?? null,
        priceCurrency: parsed.data.priceCurrency ?? null,
        discountCents: parsed.data.discountCents ?? 0,
        discountReason: parsed.data.discountReason ?? null,
        shippingChargeCents: parsed.data.shippingChargeCents ?? 0,
        ...(parsed.data.warehouseId !== undefined ? { warehouseId: parsed.data.warehouseId } : {}),
        createdByAgentId: req.user?.agentId ?? null,
      },
      actorFrom(req.user),
    );
    void notifyOrderCreated(order, contact, req.log);
    res.status(201).json(GetOrderResponse.parse(await serializeOrder(order)));
  }),
);

router.get("/orders/:id", async (req, res): Promise<void> => {
  const parsed = GetOrderParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.id));
  if (!order) {
    res.status(404).json({ error: "Pedido no encontrado." });
    return;
  }
  res.json(GetOrderResponse.parse(await serializeOrder(order)));
});

// El pedido con todo lo que lo explica: su expediente (cada etapa y cada aviso),
// su margen, los despachos en que salió y lo que movió del inventario.
router.get("/orders/:id/detail", requireView("orders", "shipments"), async (req, res): Promise<void> => {
  const parsed = GetOrderDetailParams.safeParse(req.params);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.id));
  if (!order) {
    res.status(404).json({ error: "Pedido no encontrado." });
    return;
  }
  const [serialized, events, margin, shipments, movements] = await Promise.all([
    serializeOrder(order),
    orderEventsFor(order.id),
    orderMargin(order),
    db
      .select({ stop: shipmentOrdersTable, shipment: shipmentsTable, carrier: carriersTable })
      .from(shipmentOrdersTable)
      .innerJoin(shipmentsTable, eq(shipmentsTable.id, shipmentOrdersTable.shipmentId))
      .leftJoin(carriersTable, eq(carriersTable.id, shipmentsTable.carrierId))
      .where(eq(shipmentOrdersTable.orderId, order.id))
      .orderBy(asc(shipmentOrdersTable.id)),
    listMovements({ orderId: order.id, limit: 500 }),
  ]);
  res.json(
    GetOrderDetailResponse.parse({
      order: serialized,
      events: events.map((e) => ({ id: e.id, kind: e.kind, detail: e.detail, actorLabel: e.actorLabel, createdAt: e.createdAt })),
      margin,
      shipments: shipments.map(({ stop, shipment, carrier }) => ({
        shipmentId: shipment.id,
        code: shipmentCode(shipment.id),
        kind: shipment.kind,
        status: shipment.status,
        carrierName: carrier?.name ?? null,
        trackingNumber: stop.trackingNumber,
        trackingUrl: trackingUrlFor(carrier?.trackingUrlTemplate, stop.trackingNumber),
        deliveryStatus: stop.deliveryStatus,
        allocatedCostCents: stop.allocatedCostCents,
      })),
      movements,
    }),
  );
});

router.get("/orders/:id/dispatch-plan", requireView("orders", "shipments"), async (req, res): Promise<void> => {
  const parsed = GetOrderDispatchPlanParams.safeParse(req.params);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.id));
  if (!order) {
    res.status(404).json({ error: "Pedido no encontrado." });
    return;
  }
  const warehouseId = order.warehouseId ?? (await defaultWarehouse())?.id;
  if (warehouseId == null) {
    res.status(409).json({ error: "No hay ningún almacén: crea uno en Inventario → Almacenes." });
    return;
  }
  res.json(GetOrderDispatchPlanResponse.parse(await planDispatch(warehouseId, [order.id])));
});

router.post("/orders/:id/notify", requireView("orders", "shipments"), async (req, res): Promise<void> => {
  const params = NotifyOrderCustomerParams.safeParse(req.params);
  if (!params.success) return badRequest(res, params.error.message);
  const body = NotifyOrderCustomerBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error.message);
  const result = await notifyOrderStage(params.data.id, body.data.stage, {}, req.log, { actor: actorFrom(req.user), force: true });
  res.json(NotifyOrderCustomerResponse.parse({ sent: result.sent, reason: result.reason ?? null }));
});

router.patch(
  "/orders/:id",
  withDomainErrors(async (req, res) => {
    const params = UpdateOrderParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = UpdateOrderBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    const [existing] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Pedido no encontrado." });
      return;
    }
    const actor = actorFrom(req.user);
    const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, existing.id));

    const update: Partial<typeof ordersTable.$inferInsert> = { updatedAt: new Date() };
    // Con líneas, producto y cantidad son su resumen: se cambian cambiando las líneas.
    if (items.length === 0) {
      if (body.data.product !== undefined) update.product = body.data.product;
      if (body.data.quantity !== undefined) update.quantity = body.data.quantity;
    }
    if (body.data.amount !== undefined) update.amount = body.data.amount;
    if (body.data.currency !== undefined) update.currency = body.data.currency;
    if (body.data.address !== undefined) update.address = body.data.address;
    if (body.data.email !== undefined) update.email = body.data.email;
    if (body.data.notes !== undefined) update.notes = body.data.notes;
    if (body.data.warehouseId !== undefined && body.data.warehouseId !== existing.warehouseId) {
      if (hasStockOut(items)) {
        res.status(409).json({ error: "El pedido ya salió del almacén: no se le cambia el almacén." });
        return;
      }
      update.warehouseId = body.data.warehouseId;
      await logOrderEvent(db, existing.id, "note", "Se cambió el almacén del pedido.", actor);
    }
    await db.update(ordersTable).set(update).where(eq(ordersTable.id, existing.id));

    if (body.data.items !== undefined) {
      await replaceOrderItems(
        existing.id,
        body.data.items.map((i) => ({
          productId: i.productId ?? null,
          description: i.description ?? null,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents ?? null,
          discountCents: i.discountCents ?? null,
        })),
        actor,
      );
    }
    if (body.data.discountCents !== undefined || body.data.discountReason !== undefined || body.data.shippingChargeCents !== undefined) {
      await updateOrderPricing(
        existing.id,
        {
          ...(body.data.discountCents !== undefined ? { discountCents: body.data.discountCents } : {}),
          ...(body.data.discountReason !== undefined ? { discountReason: body.data.discountReason } : {}),
          ...(body.data.shippingChargeCents !== undefined ? { shippingChargeCents: body.data.shippingChargeCents } : {}),
        },
        actor,
      );
    }

    // El estado al final: despachar usa las líneas y el almacén ya guardados.
    if (body.data.status !== undefined && body.data.status !== existing.status) {
      await changeOrderStatus(existing.id, body.data.status, actor, req.log, {
        dispatch: body.data.dispatch
          ? {
              kind: body.data.dispatch.kind,
              carrierId: body.data.dispatch.carrierId ?? null,
              trackingNumber: body.data.dispatch.trackingNumber ?? null,
              selections: body.data.dispatch.selections,
              allowUnlinked: body.data.dispatch.allowUnlinked,
            }
          : undefined,
      });
    }

    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, existing.id));
    res.json(UpdateOrderResponse.parse(await serializeOrder(order)));
  }),
);

// ── Adjuntos (comprobante, guía de envío) ────────────────────────────────────
// Fuera del contrato de OpenAPI, como los adjuntos del chat y del correo: el
// cuerpo es el archivo crudo, y el tipo se lee del content-type.
function orderExtFromMime(mimeType: string): string | null {
  const map: Record<string, string> = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  return map[mimeType] ?? null;
}

function orderUploadHandler(column: "paymentProofPath" | "shippingLabelPath", slug: "comprobante" | "etiqueta") {
  return async (req: express.Request, res: express.Response): Promise<void> => {
    if (!isStorageConfigured()) {
      res.status(503).json({ error: "El almacenamiento de archivos no está configurado." });
      return;
    }
    const parsed = GetOrderParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [existing] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.id));
    if (!existing) {
      res.status(404).json({ error: "Pedido no encontrado." });
      return;
    }
    const contentType = req.header("content-type")?.split(";")[0].trim() ?? "";
    const ext = orderExtFromMime(contentType);
    if (!ext) {
      res.status(415).json({ error: "Formato no admitido. Usa JPEG, PNG, WebP o PDF." });
      return;
    }
    const data: unknown = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) {
      res.status(400).json({ error: "El archivo está vacío." });
      return;
    }
    const path = `order-${existing.id}-${slug}-${crypto.randomUUID()}.${ext}`;
    if (!(await uploadMedia(path, data, contentType))) {
      res.status(502).json({ error: "No se pudo guardar el archivo." });
      return;
    }
    const [order] = await db
      .update(ordersTable)
      .set({ [column]: path, updatedAt: new Date() })
      .where(eq(ordersTable.id, existing.id))
      .returning();
    res.status(201).json(GetOrderResponse.parse(await serializeOrder(order)));
  };
}

const rawBody = express.raw({ type: () => true, limit: 15 * 1024 * 1024 });

router.post("/orders/:id/payment-proof", rawBody, orderUploadHandler("paymentProofPath", "comprobante"));
router.post("/orders/:id/shipping-label", rawBody, orderUploadHandler("shippingLabelPath", "etiqueta"));

export default router;
