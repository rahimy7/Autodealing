import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, suppliersTable, purchaseRequestsTable, purchaseOrdersTable, purchaseReceiptsTable } from "@workspace/db";
import {
  ListSuppliersResponse,
  ListSuppliersResponseItem,
  CreateSupplierBody,
  UpdateSupplierParams,
  UpdateSupplierBody,
  UpdateSupplierResponse,
  ListPurchaseRequestsQueryParams,
  ListPurchaseRequestsResponse,
  ListPurchaseRequestsResponseItem,
  CreatePurchaseRequestBody,
  UpdatePurchaseRequestParams,
  UpdatePurchaseRequestBody,
  UpdatePurchaseRequestResponse,
  ConvertPurchaseRequestParams,
  ConvertPurchaseRequestResponse,
  RunReorderSweepResponse,
  ListPurchaseOrdersQueryParams,
  ListPurchaseOrdersResponse,
  CreatePurchaseOrderBody,
  GetPurchaseOrderParams,
  GetPurchaseOrderResponse,
  UpdatePurchaseOrderParams,
  UpdatePurchaseOrderBody,
  UpdatePurchaseOrderResponse,
  SendPurchaseOrderParams,
  SendPurchaseOrderBody,
  SendPurchaseOrderResponse,
  CancelPurchaseOrderParams,
  CancelPurchaseOrderResponse,
  ClosePurchaseOrderParams,
  ClosePurchaseOrderResponse,
  ListPurchaseReceiptsResponse,
  ListPurchaseReceiptsResponseItem,
  CreatePurchaseReceiptBody,
} from "@workspace/api-zod";
import {
  serializePurchaseRequests,
  createPurchaseRequest,
  updatePurchaseRequest,
  convertPurchaseRequest,
  runReorderSweep,
  serializePurchaseOrders,
  createPurchaseOrder,
  updatePurchaseOrder,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  receiveGoods,
  serializeReceipts,
  listPurchaseRequests,
  listPurchaseOrders,
  listReceipts,
} from "../lib/purchasing";
import { withDomainErrors, actorFrom, badRequest } from "../lib/route-errors";

const router: IRouter = Router();

// ── Proveedores ──────────────────────────────────────────────────────────────

function supplierValues(data: {
  name?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  currency?: string | null;
  paymentTerms?: string | null;
  leadTimeDays?: number | null;
  notes?: string | null;
  active?: boolean;
}) {
  const out: Partial<typeof suppliersTable.$inferInsert> = {};
  if (data.name !== undefined) out.name = data.name.trim();
  if (data.contactName !== undefined) out.contactName = data.contactName?.trim() || null;
  if (data.email !== undefined) out.email = data.email?.trim().toLowerCase() || null;
  if (data.phone !== undefined) out.phone = data.phone?.trim() || null;
  if (data.country !== undefined) out.country = data.country?.trim() || null;
  if (data.currency !== undefined) out.currency = data.currency?.trim().toUpperCase() || null;
  if (data.paymentTerms !== undefined) out.paymentTerms = data.paymentTerms?.trim() || null;
  if (data.leadTimeDays !== undefined) out.leadTimeDays = data.leadTimeDays;
  if (data.notes !== undefined) out.notes = data.notes?.trim() || null;
  if (data.active !== undefined) out.active = data.active;
  return out;
}

router.get("/suppliers", async (_req, res): Promise<void> => {
  const rows = await db.select().from(suppliersTable).orderBy(asc(suppliersTable.name));
  res.json(ListSuppliersResponse.parse(rows));
});

router.post(
  "/suppliers",
  withDomainErrors(async (req, res) => {
    const parsed = CreateSupplierBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const values = supplierValues(parsed.data);
    if (!values.name) return badRequest(res, "El proveedor necesita nombre.");
    const [row] = await db.insert(suppliersTable).values({ ...values, name: values.name }).returning();
    res.status(201).json(ListSuppliersResponseItem.parse(row));
  }),
);

router.patch(
  "/suppliers/:id",
  withDomainErrors(async (req, res) => {
    const params = UpdateSupplierParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = UpdateSupplierBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    const values = supplierValues(body.data);
    if (values.name !== undefined && !values.name) return badRequest(res, "El proveedor necesita nombre.");
    const [row] = await db.update(suppliersTable).set({ ...values, updatedAt: new Date() }).where(eq(suppliersTable.id, params.data.id)).returning();
    if (!row) {
      res.status(404).json({ error: "Proveedor no encontrado." });
      return;
    }
    res.json(UpdateSupplierResponse.parse(row));
  }),
);

// ── Pedidos de compra ────────────────────────────────────────────────────────

async function serializedRequest(id: number) {
  const [row] = await db.select().from(purchaseRequestsTable).where(eq(purchaseRequestsTable.id, id));
  const [out] = await serializePurchaseRequests(row ? [row] : []);
  return out;
}

router.get("/purchasing/requests", async (req, res): Promise<void> => {
  const parsed = ListPurchaseRequestsQueryParams.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  res.json(ListPurchaseRequestsResponse.parse(await serializePurchaseRequests(await listPurchaseRequests(parsed.data.status))));
});

router.post(
  "/purchasing/requests",
  withDomainErrors(async (req, res) => {
    const parsed = CreatePurchaseRequestBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const request = await createPurchaseRequest({ warehouseId: parsed.data.warehouseId, notes: parsed.data.notes ?? null, items: parsed.data.items }, actorFrom(req.user));
    res.status(201).json(ListPurchaseRequestsResponseItem.parse(await serializedRequest(request.id)));
  }),
);

router.patch(
  "/purchasing/requests/:id",
  withDomainErrors(async (req, res) => {
    const params = UpdatePurchaseRequestParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = UpdatePurchaseRequestBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    await updatePurchaseRequest(params.data.id, body.data, actorFrom(req.user));
    res.json(UpdatePurchaseRequestResponse.parse(await serializedRequest(params.data.id)));
  }),
);

router.post(
  "/purchasing/requests/:id/convert",
  withDomainErrors(async (req, res) => {
    const params = ConvertPurchaseRequestParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const orders = await convertPurchaseRequest(params.data.id, actorFrom(req.user));
    res.json(ConvertPurchaseRequestResponse.parse(await serializePurchaseOrders(orders)));
  }),
);

router.post(
  "/purchasing/reorder/run",
  withDomainErrors(async (req, res) => {
    res.json(RunReorderSweepResponse.parse(await runReorderSweep(req.log, actorFrom(req.user))));
  }),
);

// ── Órdenes de compra ────────────────────────────────────────────────────────

async function serializedOrder(id: number) {
  const [row] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
  const [out] = await serializePurchaseOrders(row ? [row] : []);
  return out;
}

router.get("/purchasing/orders", async (req, res): Promise<void> => {
  const parsed = ListPurchaseOrdersQueryParams.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  res.json(ListPurchaseOrdersResponse.parse(await serializePurchaseOrders(await listPurchaseOrders(parsed.data.status))));
});

router.post(
  "/purchasing/orders",
  withDomainErrors(async (req, res) => {
    const parsed = CreatePurchaseOrderBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const po = await createPurchaseOrder({ ...parsed.data }, actorFrom(req.user));
    res.status(201).json(GetPurchaseOrderResponse.parse(await serializedOrder(po.id)));
  }),
);

router.get("/purchasing/orders/:id", async (req, res): Promise<void> => {
  const parsed = GetPurchaseOrderParams.safeParse(req.params);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const out = await serializedOrder(parsed.data.id);
  if (!out) {
    res.status(404).json({ error: "Orden de compra no encontrada." });
    return;
  }
  res.json(GetPurchaseOrderResponse.parse(out));
});

router.patch(
  "/purchasing/orders/:id",
  withDomainErrors(async (req, res) => {
    const params = UpdatePurchaseOrderParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = UpdatePurchaseOrderBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    await updatePurchaseOrder(params.data.id, body.data);
    res.json(UpdatePurchaseOrderResponse.parse(await serializedOrder(params.data.id)));
  }),
);

router.post(
  "/purchasing/orders/:id/send",
  withDomainErrors(async (req, res) => {
    const params = SendPurchaseOrderParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = SendPurchaseOrderBody.safeParse(req.body ?? {});
    if (!body.success) return badRequest(res, body.error.message);
    await sendPurchaseOrder(params.data.id, { byEmail: body.data.byEmail, to: body.data.to ?? null, message: body.data.message ?? null }, actorFrom(req.user), req.log);
    res.json(SendPurchaseOrderResponse.parse(await serializedOrder(params.data.id)));
  }),
);

router.post(
  "/purchasing/orders/:id/cancel",
  withDomainErrors(async (req, res) => {
    const params = CancelPurchaseOrderParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    await cancelPurchaseOrder(params.data.id);
    res.json(CancelPurchaseOrderResponse.parse(await serializedOrder(params.data.id)));
  }),
);

router.post(
  "/purchasing/orders/:id/close",
  withDomainErrors(async (req, res) => {
    const params = ClosePurchaseOrderParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    await closePurchaseOrder(params.data.id);
    res.json(ClosePurchaseOrderResponse.parse(await serializedOrder(params.data.id)));
  }),
);

// ── Recepciones ──────────────────────────────────────────────────────────────

router.get("/purchasing/receipts", async (_req, res): Promise<void> => {
  res.json(ListPurchaseReceiptsResponse.parse(await serializeReceipts(await listReceipts())));
});

router.post(
  "/purchasing/receipts",
  withDomainErrors(async (req, res) => {
    const parsed = CreatePurchaseReceiptBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const receipt = await receiveGoods(parsed.data, actorFrom(req.user));
    const [row] = await db.select().from(purchaseReceiptsTable).where(eq(purchaseReceiptsTable.id, receipt.id));
    const [out] = await serializeReceipts([row]);
    res.status(201).json(ListPurchaseReceiptsResponseItem.parse(out));
  }),
);

export default router;
