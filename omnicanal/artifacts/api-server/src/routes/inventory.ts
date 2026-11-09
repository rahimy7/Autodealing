import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  warehousesTable,
  reorderRulesTable,
  stockAdjustmentsTable,
  stockTransfersTable,
  stockMovementsTable,
  productsTable,
} from "@workspace/db";
import {
  ListWarehousesResponse,
  ListWarehousesResponseItem,
  CreateWarehouseBody,
  UpdateWarehouseParams,
  UpdateWarehouseBody,
  UpdateWarehouseResponse,
  ListStockQueryParams,
  ListStockResponse,
  ListLotsQueryParams,
  ListLotsResponse,
  GetLotTraceParams,
  GetLotTraceResponse,
  ListStockMovementsQueryParams,
  ListStockMovementsResponse,
  ListStockAdjustmentsResponse,
  ListStockAdjustmentsResponseItem,
  CreateStockAdjustmentBody,
  ListStockTransfersResponse,
  ListStockTransfersResponseItem,
  CreateStockTransferBody,
  UpsertReorderRuleBody,
  UpsertReorderRuleResponse,
  DeleteReorderRuleParams,
  GetInventoryValuationQueryParams,
  GetInventoryValuationResponse,
  ListOrderMarginsQueryParams,
  ListOrderMarginsResponse,
} from "@workspace/api-zod";
import {
  stockSummary,
  listLots,
  lotTrace,
  listMovements,
  postAdjustment,
  postTransfer,
} from "../lib/inventory";
import { valuationReport, orderMarginsReport, dayRange } from "../lib/inventory-reports";
import { adjustmentCode, transferCode } from "../lib/codes";
import { withDomainErrors, actorFrom, badRequest } from "../lib/route-errors";

const router: IRouter = Router();

// ── Almacenes ─────────────────────────────────────────────────────────────────

router.get("/warehouses", async (_req, res): Promise<void> => {
  const rows = await db.select().from(warehousesTable).orderBy(desc(warehousesTable.isDefault), asc(warehousesTable.name));
  res.json(ListWarehousesResponse.parse(rows));
});

// Uno solo es el de por defecto: marcar otro desmarca el anterior.
async function makeDefault(id: number): Promise<void> {
  await db.update(warehousesTable).set({ isDefault: false, updatedAt: new Date() }).where(and(eq(warehousesTable.isDefault, true), ne(warehousesTable.id, id)));
  await db.update(warehousesTable).set({ isDefault: true, updatedAt: new Date() }).where(eq(warehousesTable.id, id));
}

router.post(
  "/warehouses",
  withDomainErrors(async (req, res) => {
    const parsed = CreateWarehouseBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const code = parsed.data.code.trim().toUpperCase();
    const name = parsed.data.name.trim();
    if (!code || !name) return badRequest(res, "El almacén necesita código y nombre.");
    const [clash] = await db.select({ id: warehousesTable.id }).from(warehousesTable).where(eq(warehousesTable.code, code));
    if (clash) {
      res.status(409).json({ error: `Ya hay un almacén con el código ${code}.` });
      return;
    }
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(warehousesTable);
    const [row] = await db
      .insert(warehousesTable)
      .values({ code, name, address: parsed.data.address?.trim() || null })
      .returning();
    // El primero es el de por defecto: un pedido nuevo necesita dónde comprometerse.
    if (count === 0 || parsed.data.isDefault) await makeDefault(row.id);
    const [fresh] = await db.select().from(warehousesTable).where(eq(warehousesTable.id, row.id));
    res.status(201).json(ListWarehousesResponseItem.parse(fresh));
  }),
);

router.patch(
  "/warehouses/:id",
  withDomainErrors(async (req, res) => {
    const params = UpdateWarehouseParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = UpdateWarehouseBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    const [existing] = await db.select().from(warehousesTable).where(eq(warehousesTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Almacén no encontrado." });
      return;
    }
    const update: Partial<typeof warehousesTable.$inferInsert> = { updatedAt: new Date() };
    if (body.data.code !== undefined) update.code = body.data.code.trim().toUpperCase();
    if (body.data.name !== undefined) update.name = body.data.name.trim();
    if (body.data.address !== undefined) update.address = body.data.address?.trim() || null;
    if (body.data.active !== undefined) {
      if (!body.data.active && existing.isDefault) {
        res.status(409).json({ error: "Marca otro almacén por defecto antes de desactivar este." });
        return;
      }
      update.active = body.data.active;
    }
    await db.update(warehousesTable).set(update).where(eq(warehousesTable.id, existing.id));
    if (body.data.isDefault) await makeDefault(existing.id);
    const [fresh] = await db.select().from(warehousesTable).where(eq(warehousesTable.id, existing.id));
    res.json(UpdateWarehouseResponse.parse(fresh));
  }),
);

// ── Existencias, lotes y movimientos ─────────────────────────────────────────

router.get("/inventory/stock", async (req, res): Promise<void> => {
  const parsed = ListStockQueryParams.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  let rows = await stockSummary({ warehouseId: parsed.data.warehouseId, productId: parsed.data.productId });
  if (parsed.data.status === "low") rows = rows.filter((r) => r.status !== "ok");
  res.json(ListStockResponse.parse(rows));
});

router.get("/inventory/lots", async (req, res): Promise<void> => {
  const parsed = ListLotsQueryParams.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const rows = await listLots({
    productId: parsed.data.productId,
    warehouseId: parsed.data.warehouseId,
    withStock: parsed.data.withStock,
    search: parsed.data.search,
  });
  res.json(ListLotsResponse.parse(rows));
});

router.get("/inventory/lots/:id/trace", async (req, res): Promise<void> => {
  const parsed = GetLotTraceParams.safeParse(req.params);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const trace = await lotTrace(parsed.data.id);
  if (!trace) {
    res.status(404).json({ error: "Lote no encontrado." });
    return;
  }
  res.json(GetLotTraceResponse.parse(trace));
});

router.get("/inventory/movements", async (req, res): Promise<void> => {
  const parsed = ListStockMovementsQueryParams.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const range = dayRange(parsed.data.from, parsed.data.to);
  const rows = await listMovements({
    productId: parsed.data.productId,
    warehouseId: parsed.data.warehouseId,
    orderId: parsed.data.orderId,
    type: parsed.data.type,
    from: range.from ?? undefined,
    to: range.to ?? undefined,
    limit: parsed.data.limit,
  });
  res.json(ListStockMovementsResponse.parse(rows));
});

// ── Ajustes y transferencias ─────────────────────────────────────────────────

async function adjustmentSummaries(ids?: number[]) {
  const rows = await db
    .select({ adjustment: stockAdjustmentsTable, warehouseName: warehousesTable.name })
    .from(stockAdjustmentsTable)
    .innerJoin(warehousesTable, eq(warehousesTable.id, stockAdjustmentsTable.warehouseId))
    .where(ids ? inArray(stockAdjustmentsTable.id, ids) : undefined)
    .orderBy(desc(stockAdjustmentsTable.createdAt))
    .limit(200);
  if (rows.length === 0) return [];
  const totals = await db
    .select({
      adjustmentId: stockMovementsTable.adjustmentId,
      lines: sql<number>`count(*)::int`,
      value: sql<string>`SUM(${stockMovementsTable.valueCents})::text`,
    })
    .from(stockMovementsTable)
    .where(inArray(stockMovementsTable.adjustmentId, rows.map((r) => r.adjustment.id)))
    .groupBy(stockMovementsTable.adjustmentId);
  const byId = new Map(totals.map((t) => [t.adjustmentId!, t] as const));
  return rows.map(({ adjustment, warehouseName }) => ({
    id: adjustment.id,
    code: adjustmentCode(adjustment.id),
    warehouseId: adjustment.warehouseId,
    warehouseName,
    reason: adjustment.reason,
    notes: adjustment.notes,
    lineCount: byId.get(adjustment.id)?.lines ?? 0,
    valueCents: Number(byId.get(adjustment.id)?.value ?? 0),
    actorLabel: adjustment.actorLabel,
    createdAt: adjustment.createdAt,
  }));
}

router.get("/inventory/adjustments", async (_req, res): Promise<void> => {
  res.json(ListStockAdjustmentsResponse.parse(await adjustmentSummaries()));
});

router.post(
  "/inventory/adjustments",
  withDomainErrors(async (req, res) => {
    const parsed = CreateStockAdjustmentBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const { adjustmentId } = await postAdjustment({
      warehouseId: parsed.data.warehouseId,
      reason: parsed.data.reason,
      notes: parsed.data.notes ?? null,
      lines: parsed.data.lines,
      actor: actorFrom(req.user),
    });
    const [summary] = await adjustmentSummaries([adjustmentId]);
    res.status(201).json(ListStockAdjustmentsResponseItem.parse(summary));
  }),
);

async function transferSummaries(ids?: number[]) {
  const rows = await db
    .select()
    .from(stockTransfersTable)
    .where(ids ? inArray(stockTransfersTable.id, ids) : undefined)
    .orderBy(desc(stockTransfersTable.createdAt))
    .limit(200);
  if (rows.length === 0) return [];
  const [warehouses, units] = await Promise.all([
    db.select({ id: warehousesTable.id, name: warehousesTable.name }).from(warehousesTable),
    db
      .select({ transferId: stockMovementsTable.transferId, units: sql<string>`SUM(${stockMovementsTable.quantity})::text` })
      .from(stockMovementsTable)
      .where(and(inArray(stockMovementsTable.transferId, rows.map((r) => r.id)), eq(stockMovementsTable.type, "transfer_in")))
      .groupBy(stockMovementsTable.transferId),
  ]);
  const name = new Map(warehouses.map((w) => [w.id, w.name] as const));
  const unitsBy = new Map(units.map((u) => [u.transferId!, Number(u.units)] as const));
  return rows.map((t) => ({
    id: t.id,
    code: transferCode(t.id),
    fromWarehouseId: t.fromWarehouseId,
    fromWarehouseName: name.get(t.fromWarehouseId) ?? "—",
    toWarehouseId: t.toWarehouseId,
    toWarehouseName: name.get(t.toWarehouseId) ?? "—",
    units: unitsBy.get(t.id) ?? 0,
    notes: t.notes,
    actorLabel: t.actorLabel,
    createdAt: t.createdAt,
  }));
}

router.get("/inventory/transfers", async (_req, res): Promise<void> => {
  res.json(ListStockTransfersResponse.parse(await transferSummaries()));
});

router.post(
  "/inventory/transfers",
  withDomainErrors(async (req, res) => {
    const parsed = CreateStockTransferBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const { transferId } = await postTransfer({ ...parsed.data, notes: parsed.data.notes ?? null, actor: actorFrom(req.user) });
    const [summary] = await transferSummaries([transferId]);
    res.status(201).json(ListStockTransfersResponseItem.parse(summary));
  }),
);

// ── Punto de reorden ─────────────────────────────────────────────────────────

router.put(
  "/inventory/reorder-rules",
  withDomainErrors(async (req, res) => {
    const parsed = UpsertReorderRuleBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const { productId, warehouseId, minQuantity, targetQuantity } = parsed.data;
    if (minQuantity < 0 || targetQuantity <= minQuantity) {
      return badRequest(res, "El stock objetivo tiene que ser mayor que el punto de reorden.");
    }
    const [product] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product) {
      res.status(404).json({ error: "Producto no encontrado." });
      return;
    }
    const values = {
      productId,
      warehouseId,
      minQuantity,
      targetQuantity,
      preferredSupplierId: parsed.data.preferredSupplierId ?? null,
      updatedAt: new Date(),
    };
    const [row] = await db
      .insert(reorderRulesTable)
      .values(values)
      .onConflictDoUpdate({ target: [reorderRulesTable.productId, reorderRulesTable.warehouseId], set: values })
      .returning();
    // Fijar un punto de reorden es empezar a controlar el inventario del producto.
    await db.update(productsTable).set({ trackInventory: true, updatedAt: new Date() }).where(and(eq(productsTable.id, productId), eq(productsTable.trackInventory, false)));
    res.json(UpsertReorderRuleResponse.parse(row));
  }),
);

router.delete("/inventory/reorder-rules/:id", async (req, res): Promise<void> => {
  const parsed = DeleteReorderRuleParams.safeParse(req.params);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  await db.delete(reorderRulesTable).where(eq(reorderRulesTable.id, parsed.data.id));
  res.status(204).end();
});

// ── Costos ────────────────────────────────────────────────────────────────────

router.get("/inventory/valuation", async (req, res): Promise<void> => {
  const parsed = GetInventoryValuationQueryParams.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  res.json(GetInventoryValuationResponse.parse(await valuationReport(parsed.data.from, parsed.data.to)));
});

router.get("/inventory/margins", async (req, res): Promise<void> => {
  const parsed = ListOrderMarginsQueryParams.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  res.json(ListOrderMarginsResponse.parse(await orderMarginsReport(parsed.data.from, parsed.data.to)));
});

export default router;
