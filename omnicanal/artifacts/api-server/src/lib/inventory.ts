// Existencias por almacén con lotes y costo PEPS. Este archivo es la ÚNICA puerta
// para mover inventario: recepciones, despachos, devoluciones, ajustes y
// transferencias pasan por `addToLot` / `takeFromLot`, que escriben el movimiento
// y el saldo en la misma transacción. Así Σ saldos = Σ movimientos siempre, al
// centavo, y un movimiento nunca existe sin su efecto (ni al revés).
//
// Las funciones puras (orden de salida de los lotes, reparto del valor, cuánto
// pedir) van primero y sin base de datos, para probarlas directo.
import { and, asc, eq, gt, inArray, lt, sql, desc, type SQL } from "drizzle-orm";
import {
  db,
  productsTable,
  warehousesTable,
  productComponentsTable,
  reorderRulesTable,
  stockLotsTable,
  stockBalancesTable,
  stockMovementsTable,
  stockAdjustmentsTable,
  stockTransfersTable,
  ordersTable,
  contactsTable,
  suppliersTable,
  type InsertStockMovement,
  type StockLot,
  type StockMovementType,
  type StockAdjustmentReason,
  type Warehouse,
} from "@workspace/db";
import {
  orderCode,
  shipmentCode,
  receiptCode,
  returnCode,
  adjustmentCode,
  transferCode,
  purchaseOrderCode,
} from "./codes";

// Lo que acepta cualquier función que escriba: la base o una transacción abierta.
export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Actor = { agentId: number | null; label: string };

export const SYSTEM_ACTOR: Actor = { agentId: null, label: "Sistema" };

/** Un movimiento que no se puede hacer (falta stock, lote equivocado…). Las rutas lo devuelven como 409. */
export class InventoryError extends Error {
  readonly status = 409;
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

// ── Puras ─────────────────────────────────────────────────────────────────────

export type LotCandidate = {
  lotId: number;
  quantity: number;
  expiryDate: string | null;
  receivedAt: Date;
};

/**
 * El orden en que salen los lotes: primero el que vence antes (FEFO), los que no
 * vencen al final, y entre iguales el que entró primero (PEPS). El id desempata
 * para que el orden sea siempre el mismo.
 */
export function sortLotsForPicking<T extends LotCandidate>(lots: T[]): T[] {
  return [...lots].sort((a, b) => {
    if (a.expiryDate !== b.expiryDate) {
      if (a.expiryDate == null) return 1;
      if (b.expiryDate == null) return -1;
      return a.expiryDate < b.expiryDate ? -1 : 1;
    }
    const byReceived = a.receivedAt.getTime() - b.receivedAt.getTime();
    if (byReceived !== 0) return byReceived;
    return a.lotId - b.lotId;
  });
}

export type LotPick = { lotId: number; quantity: number };

/** De qué lotes sale `needed`, y cuánto falta si no alcanza. */
export function planLotPicks(lots: LotCandidate[], needed: number): { picks: LotPick[]; shortage: number } {
  const picks: LotPick[] = [];
  let remaining = needed;
  for (const lot of sortLotsForPicking(lots)) {
    if (remaining <= 0) break;
    if (lot.quantity <= 0) continue;
    const take = Math.min(lot.quantity, remaining);
    picks.push({ lotId: lot.lotId, quantity: take });
    remaining -= take;
  }
  return { picks, shortage: Math.max(0, remaining) };
}

/**
 * El valor que se lleva quien toma `take` unidades de un saldo: la parte
 * proporcional, y si se lo lleva entero, TODO lo que queda. Lo segundo es lo que
 * impide que los redondeos dejen centavos huérfanos en un lote vacío.
 */
export function splitValue(balance: { quantity: number; valueCents: number }, take: number): number {
  if (take <= 0 || balance.quantity <= 0) return 0;
  if (take >= balance.quantity) return balance.valueCents;
  return Math.round((balance.valueCents * take) / balance.quantity);
}

/** El costo de `quantity` unidades de un lote, a su costo unitario de entrada. */
export function lotUnitValue(lot: Pick<StockLot, "initialQuantity" | "totalCostCents">, quantity: number): number {
  if (lot.initialQuantity <= 0) return 0;
  return Math.round((lot.totalCostCents * quantity) / lot.initialQuantity);
}

/**
 * Punto de reorden. Proyectado = disponible (en mano − comprometido) + lo que
 * viene en órdenes de compra + lo ya pedido en pedidos de compra abiertos. Si
 * eso cae al mínimo o por debajo, se pide hasta el objetivo.
 */
export function reorderNeed(input: {
  available: number;
  onOrder: number;
  requested: number;
  minQuantity: number;
  targetQuantity: number;
}): { projected: number; need: number } {
  const projected = input.available + input.onOrder + input.requested;
  if (projected > input.minQuantity) return { projected, need: 0 };
  const target = Math.max(input.targetQuantity, input.minQuantity + 1);
  return { projected, need: Math.max(0, target - projected) };
}

export type StockStatus = "ok" | "low" | "negative";

/** Cómo pintar una fila de existencias: vendido de más, bajo el mínimo o bien. */
export function stockStatus(available: number, minQuantity: number | null): StockStatus {
  if (available < 0) return "negative";
  if (minQuantity != null && available <= minQuantity) return "low";
  return "ok";
}

export type ComponentRef = { componentProductId: number; quantity: number };

/** Una línea de pedido en lo que de verdad sale del almacén: un kit son sus componentes. */
export function explodeLine(
  productId: number,
  quantity: number,
  componentsByKit: Map<number, ComponentRef[]>,
): Array<{ productId: number; quantity: number }> {
  const components = componentsByKit.get(productId);
  if (!components || components.length === 0) return [{ productId, quantity }];
  return components.map((c) => ({ productId: c.componentProductId, quantity: c.quantity * quantity }));
}

// ── Almacenes ─────────────────────────────────────────────────────────────────

/** El almacén por defecto, o el primero activo si nadie marcó uno; null si no hay. */
export async function defaultWarehouse(executor: Executor = db): Promise<Warehouse | null> {
  const rows = await executor
    .select()
    .from(warehousesTable)
    .where(eq(warehousesTable.active, true))
    .orderBy(desc(warehousesTable.isDefault), asc(warehousesTable.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function componentsByKit(executor: Executor, kitIds?: number[]): Promise<Map<number, ComponentRef[]>> {
  if (kitIds && kitIds.length === 0) return new Map();
  const rows = await executor
    .select()
    .from(productComponentsTable)
    .where(kitIds ? inArray(productComponentsTable.kitProductId, kitIds) : undefined);
  const out = new Map<number, ComponentRef[]>();
  for (const r of rows) {
    const list = out.get(r.kitProductId) ?? [];
    list.push({ componentProductId: r.componentProductId, quantity: r.quantity });
    out.set(r.kitProductId, list);
  }
  return out;
}

// ── Movimientos ───────────────────────────────────────────────────────────────

export type MovementRefs = Partial<
  Pick<
    InsertStockMovement,
    | "orderId"
    | "orderItemId"
    | "shipmentId"
    | "purchaseReceiptId"
    | "returnId"
    | "adjustmentId"
    | "transferId"
    | "reversesMovementId"
    | "note"
  >
>;

export async function createLot(
  tx: Executor,
  input: {
    productId: number;
    lotNumber?: string | null;
    productionDate?: string | null;
    expiryDate?: string | null;
    supplierId?: number | null;
    purchaseOrderId?: number | null;
    purchaseReceiptId?: number | null;
    adjustmentId?: number | null;
    quantity: number;
    totalCostCents: number;
  },
): Promise<StockLot> {
  const [lot] = await tx
    .insert(stockLotsTable)
    .values({
      productId: input.productId,
      lotNumber: input.lotNumber?.trim() || null,
      productionDate: input.productionDate || null,
      expiryDate: input.expiryDate || null,
      supplierId: input.supplierId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      purchaseReceiptId: input.purchaseReceiptId ?? null,
      adjustmentId: input.adjustmentId ?? null,
      initialQuantity: input.quantity,
      totalCostCents: input.totalCostCents,
    })
    .returning();
  return lot;
}

/** Suma unidades (y su valor) a un lote en un almacén. */
export async function addToLot(
  tx: Executor,
  input: {
    type: StockMovementType;
    lotId: number;
    productId: number;
    warehouseId: number;
    quantity: number;
    valueCents: number;
    refs?: MovementRefs;
    actor: Actor;
  },
): Promise<number> {
  if (input.quantity <= 0) throw new InventoryError("La cantidad que entra tiene que ser mayor que cero.");
  await tx
    .insert(stockBalancesTable)
    .values({
      lotId: input.lotId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      valueCents: input.valueCents,
    })
    .onConflictDoUpdate({
      target: [stockBalancesTable.lotId, stockBalancesTable.warehouseId],
      set: {
        quantity: sql`${stockBalancesTable.quantity} + ${input.quantity}`,
        valueCents: sql`${stockBalancesTable.valueCents} + ${input.valueCents}`,
        updatedAt: new Date(),
      },
    });
  const [movement] = await tx
    .insert(stockMovementsTable)
    .values({
      type: input.type,
      productId: input.productId,
      warehouseId: input.warehouseId,
      lotId: input.lotId,
      quantity: input.quantity,
      valueCents: input.valueCents,
      ...(input.refs ?? {}),
      actorAgentId: input.actor.agentId,
      actorLabel: input.actor.label,
    })
    .returning({ id: stockMovementsTable.id });
  return movement.id;
}

/** Saca unidades de un lote concreto. Bloquea el saldo hasta el fin de la transacción. */
export async function takeFromLot(
  tx: Executor,
  input: {
    type: StockMovementType;
    lotId: number;
    warehouseId: number;
    quantity: number;
    refs?: MovementRefs;
    actor: Actor;
  },
): Promise<{ movementId: number; valueCents: number; productId: number }> {
  if (input.quantity <= 0) throw new InventoryError("La cantidad que sale tiene que ser mayor que cero.");
  const [balance] = await tx
    .select()
    .from(stockBalancesTable)
    .where(and(eq(stockBalancesTable.lotId, input.lotId), eq(stockBalancesTable.warehouseId, input.warehouseId)))
    .for("update");
  if (!balance || balance.quantity < input.quantity) {
    throw new InventoryError("El lote no tiene esa cantidad en este almacén.", {
      lotId: input.lotId,
      warehouseId: input.warehouseId,
      requested: input.quantity,
      available: balance?.quantity ?? 0,
    });
  }
  const valueCents = splitValue(balance, input.quantity);
  await tx
    .update(stockBalancesTable)
    .set({
      quantity: balance.quantity - input.quantity,
      valueCents: balance.valueCents - valueCents,
      updatedAt: new Date(),
    })
    .where(eq(stockBalancesTable.id, balance.id));
  const [movement] = await tx
    .insert(stockMovementsTable)
    .values({
      type: input.type,
      productId: balance.productId,
      warehouseId: input.warehouseId,
      lotId: input.lotId,
      quantity: -input.quantity,
      valueCents: -valueCents,
      ...(input.refs ?? {}),
      actorAgentId: input.actor.agentId,
      actorLabel: input.actor.label,
    })
    .returning({ id: stockMovementsTable.id });
  return { movementId: movement.id, valueCents, productId: balance.productId };
}

/** Los saldos con existencia de un producto en un almacén, bloqueados, con lo que hace falta para elegir. */
async function lockedCandidates(tx: Executor, productId: number, warehouseId: number) {
  return tx
    .select({
      lotId: stockBalancesTable.lotId,
      quantity: stockBalancesTable.quantity,
      expiryDate: stockLotsTable.expiryDate,
      receivedAt: stockLotsTable.receivedAt,
    })
    .from(stockBalancesTable)
    .innerJoin(stockLotsTable, eq(stockLotsTable.id, stockBalancesTable.lotId))
    .where(
      and(
        eq(stockBalancesTable.productId, productId),
        eq(stockBalancesTable.warehouseId, warehouseId),
        gt(stockBalancesTable.quantity, 0),
      ),
    )
    .for("update", { of: stockBalancesTable });
}

export type ConsumedPick = { lotId: number; quantity: number; valueCents: number; movementId: number };

/**
 * Saca `quantity` de un producto de un almacén por lotes: los que diga
 * `lotPicks` (lo que eligió quien despacha) o, sin eso, FEFO/PEPS. Si no alcanza
 * no saca nada y lanza InventoryError con lo que falta.
 */
export async function consumeStock(
  tx: Executor,
  input: {
    type: StockMovementType;
    productId: number;
    warehouseId: number;
    quantity: number;
    lotPicks?: LotPick[] | null;
    refs?: MovementRefs;
    actor: Actor;
  },
): Promise<ConsumedPick[]> {
  const candidates = await lockedCandidates(tx, input.productId, input.warehouseId);
  let picks: LotPick[];
  if (input.lotPicks && input.lotPicks.length > 0) {
    const total = input.lotPicks.reduce((sum, p) => sum + p.quantity, 0);
    if (total !== input.quantity) {
      throw new InventoryError("Los lotes elegidos no suman la cantidad que sale.", {
        productId: input.productId,
        expected: input.quantity,
        picked: total,
      });
    }
    const byLot = new Map(candidates.map((c) => [c.lotId, c.quantity] as const));
    for (const p of input.lotPicks) {
      if ((byLot.get(p.lotId) ?? 0) < p.quantity) {
        throw new InventoryError("Uno de los lotes elegidos no tiene esa cantidad en el almacén.", {
          productId: input.productId,
          lotId: p.lotId,
          requested: p.quantity,
          available: byLot.get(p.lotId) ?? 0,
        });
      }
    }
    picks = input.lotPicks.filter((p) => p.quantity > 0);
  } else {
    const plan = planLotPicks(candidates, input.quantity);
    if (plan.shortage > 0) {
      throw new InventoryError("No hay existencias suficientes.", {
        productId: input.productId,
        warehouseId: input.warehouseId,
        requested: input.quantity,
        available: input.quantity - plan.shortage,
        shortage: plan.shortage,
      });
    }
    picks = plan.picks;
  }

  const consumed: ConsumedPick[] = [];
  for (const pick of picks) {
    const taken = await takeFromLot(tx, {
      type: input.type,
      lotId: pick.lotId,
      warehouseId: input.warehouseId,
      quantity: pick.quantity,
      refs: input.refs,
      actor: input.actor,
    });
    consumed.push({ lotId: pick.lotId, quantity: pick.quantity, valueCents: taken.valueCents, movementId: taken.movementId });
  }
  return consumed;
}

// ── Lo comprometido, lo que viene y lo pedido ────────────────────────────────

type Key = `${number}:${number}`;
const key = (productId: number, warehouseId: number): Key => `${productId}:${warehouseId}`;

/**
 * Lo vendido sin despachar, por producto y almacén: las líneas de los pedidos
 * Pendientes y En proceso menos lo que ya salió, con los kits en sus
 * componentes. Un pedido sin almacén (de antes del inventario) cuenta en el
 * almacén por defecto. No hay contador guardado que se pueda descuadrar.
 */
export async function committedQuantities(executor: Executor = db): Promise<Map<Key, number>> {
  const fallback = (await defaultWarehouse(executor))?.id ?? null;
  const rows = await executor.execute<{ warehouse_id: number | null; product_id: number; committed: string }>(sql`
    WITH lines AS (
      SELECT COALESCE(o.warehouse_id, ${fallback}::int) AS warehouse_id,
             oi.product_id,
             (oi.quantity - oi.dispatched_quantity) AS qty
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status IN ('pending', 'processing')
        AND oi.product_id IS NOT NULL
        AND oi.quantity > oi.dispatched_quantity
    )
    SELECT l.warehouse_id,
           COALESCE(pc.component_product_id, l.product_id) AS product_id,
           SUM(l.qty * COALESCE(pc.quantity, 1))::text AS committed
    FROM lines l
    LEFT JOIN product_components pc ON pc.kit_product_id = l.product_id
    -- Solo compromete quien controla inventario (un kit lo hacen sus componentes).
    -- Sin esto, al encender el módulo todo producto vendido por chat aparecería
    -- "vendido de más" aunque nadie haya empezado a llevar sus existencias.
    JOIN products p ON p.id = COALESCE(pc.component_product_id, l.product_id) AND p.track_inventory
    GROUP BY 1, 2
  `);
  const out = new Map<Key, number>();
  for (const r of rows.rows) {
    if (r.warehouse_id == null) continue;
    out.set(key(r.product_id, r.warehouse_id), Number(r.committed));
  }
  return out;
}

/** Lo que falta por llegar de órdenes de compra abiertas (borrador, enviada o parcial). */
export async function onOrderQuantities(executor: Executor = db): Promise<Map<Key, number>> {
  const rows = await executor.execute<{ warehouse_id: number; product_id: number; qty: string }>(sql`
    SELECT po.warehouse_id, poi.product_id, SUM(poi.quantity - poi.received_quantity)::text AS qty
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE po.status IN ('draft', 'sent', 'partial') AND poi.quantity > poi.received_quantity
    GROUP BY 1, 2
  `);
  return new Map(rows.rows.map((r) => [key(r.product_id, r.warehouse_id), Number(r.qty)] as const));
}

/** Lo ya pedido en pedidos de compra abiertos que aún no se volvió orden de compra. */
export async function requestedQuantities(executor: Executor = db): Promise<Map<Key, number>> {
  const rows = await executor.execute<{ warehouse_id: number; product_id: number; qty: string }>(sql`
    SELECT pr.warehouse_id, pri.product_id, SUM(pri.quantity)::text AS qty
    FROM purchase_request_items pri
    JOIN purchase_requests pr ON pr.id = pri.request_id
    WHERE pr.status IN ('open', 'approved') AND pri.purchase_order_item_id IS NULL
    GROUP BY 1, 2
  `);
  return new Map(rows.rows.map((r) => [key(r.product_id, r.warehouse_id), Number(r.qty)] as const));
}

async function onHandQuantities(executor: Executor): Promise<Map<Key, { quantity: number; valueCents: number }>> {
  const rows = await executor
    .select({
      productId: stockBalancesTable.productId,
      warehouseId: stockBalancesTable.warehouseId,
      quantity: sql<string>`SUM(${stockBalancesTable.quantity})::text`,
      valueCents: sql<string>`SUM(${stockBalancesTable.valueCents})::text`,
    })
    .from(stockBalancesTable)
    .groupBy(stockBalancesTable.productId, stockBalancesTable.warehouseId);
  return new Map(
    rows.map((r) => [key(r.productId, r.warehouseId), { quantity: Number(r.quantity), valueCents: Number(r.valueCents) }] as const),
  );
}

export type StockRow = {
  productId: number;
  productName: string;
  sku: string | null;
  warehouseId: number;
  warehouseName: string;
  onHand: number;
  valueCents: number;
  committed: number;
  available: number;
  onOrder: number;
  requested: number;
  reorderRuleId: number | null;
  minQuantity: number | null;
  targetQuantity: number | null;
  preferredSupplierId: number | null;
  need: number;
  status: StockStatus;
  nextExpiry: string | null;
};

/**
 * La foto de existencias: cada producto que controla inventario en cada almacén
 * activo (más cualquier otro que tenga saldo o compromiso), con en mano,
 * comprometido, disponible, lo que viene, el punto de reorden y cuánto pedir.
 */
export async function stockSummary(
  filter: { warehouseId?: number; productId?: number; productIds?: number[] } = {},
  executor: Executor = db,
): Promise<StockRow[]> {
  const [products, warehouses, rules, onHand, committed, onOrder, requested, expiries] = await Promise.all([
    executor
      .select({ id: productsTable.id, name: productsTable.name, sku: productsTable.sku, trackInventory: productsTable.trackInventory })
      .from(productsTable),
    executor.select().from(warehousesTable).where(eq(warehousesTable.active, true)).orderBy(desc(warehousesTable.isDefault), asc(warehousesTable.name)),
    executor.select().from(reorderRulesTable),
    onHandQuantities(executor),
    committedQuantities(executor),
    onOrderQuantities(executor),
    requestedQuantities(executor),
    executor.execute<{ product_id: number; warehouse_id: number; next_expiry: string | null }>(sql`
      SELECT b.product_id, b.warehouse_id, MIN(l.expiry_date)::text AS next_expiry
      FROM stock_balances b JOIN stock_lots l ON l.id = b.lot_id
      WHERE b.quantity > 0
      GROUP BY 1, 2
    `),
  ]);

  const ruleByKey = new Map(rules.map((r) => [key(r.productId, r.warehouseId), r] as const));
  const expiryByKey = new Map(expiries.rows.map((r) => [key(r.product_id, r.warehouse_id), r.next_expiry] as const));
  const productIdsWithData = new Set<number>();
  for (const k of [...onHand.keys(), ...committed.keys(), ...onOrder.keys(), ...ruleByKey.keys()]) {
    productIdsWithData.add(Number(k.split(":")[0]));
  }

  const rows: StockRow[] = [];
  for (const p of products) {
    if (!p.trackInventory && !productIdsWithData.has(p.id)) continue;
    if (filter.productId != null && p.id !== filter.productId) continue;
    if (filter.productIds && !filter.productIds.includes(p.id)) continue;
    for (const w of warehouses) {
      if (filter.warehouseId != null && w.id !== filter.warehouseId) continue;
      const k = key(p.id, w.id);
      const hand = onHand.get(k) ?? { quantity: 0, valueCents: 0 };
      const rule = ruleByKey.get(k) ?? null;
      const c = committed.get(k) ?? 0;
      const o = onOrder.get(k) ?? 0;
      const r = requested.get(k) ?? 0;
      const available = hand.quantity - c;
      const { need } = rule
        ? reorderNeed({ available, onOrder: o, requested: r, minQuantity: rule.minQuantity, targetQuantity: rule.targetQuantity })
        : { need: 0 };
      // Un producto sin control de inventario y sin nada en este almacén no aporta una fila.
      if (!p.trackInventory && hand.quantity === 0 && c === 0 && o === 0 && !rule) continue;
      rows.push({
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        warehouseId: w.id,
        warehouseName: w.name,
        onHand: hand.quantity,
        valueCents: hand.valueCents,
        committed: c,
        available,
        onOrder: o,
        requested: r,
        reorderRuleId: rule?.id ?? null,
        minQuantity: rule?.minQuantity ?? null,
        targetQuantity: rule?.targetQuantity ?? null,
        preferredSupplierId: rule?.preferredSupplierId ?? null,
        need,
        status: stockStatus(available, rule?.minQuantity ?? null),
        nextExpiry: expiryByKey.get(k) ?? null,
      });
    }
  }
  return rows.sort((a, b) => a.productName.localeCompare(b.productName, "es") || a.warehouseName.localeCompare(b.warehouseName, "es"));
}

// ── Lotes, kárdex y trazabilidad ─────────────────────────────────────────────

/** Cómo se llama un lote en pantalla: su número de producción, o el documento con que entró. */
export function lotLabel(lot: Pick<StockLot, "id" | "lotNumber" | "purchaseReceiptId" | "adjustmentId">): string {
  if (lot.lotNumber) return lot.lotNumber;
  if (lot.purchaseReceiptId) return receiptCode(lot.purchaseReceiptId);
  if (lot.adjustmentId) return adjustmentCode(lot.adjustmentId);
  return `Lote ${lot.id}`;
}

export type LotRow = {
  id: number;
  label: string;
  lotNumber: string | null;
  productId: number;
  productName: string;
  productionDate: string | null;
  expiryDate: string | null;
  supplierName: string | null;
  purchaseOrderCode: string | null;
  receiptCode: string | null;
  initialQuantity: number;
  unitCostCents: number;
  receivedAt: Date;
  balances: Array<{ warehouseId: number; warehouseName: string; quantity: number; valueCents: number }>;
  quantity: number;
};

export async function listLots(filter: { productId?: number; warehouseId?: number; withStock?: boolean; search?: string } = {}): Promise<LotRow[]> {
  const conditions: SQL[] = [];
  if (filter.productId != null) conditions.push(eq(stockLotsTable.productId, filter.productId));
  const term = filter.search?.trim();
  if (term) {
    const like = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(sql`(${stockLotsTable.lotNumber} ilike ${like} or exists (select 1 from ${productsTable} where ${productsTable.id} = ${stockLotsTable.productId} and ${productsTable.name} ilike ${like}))`);
  }
  const lots = await db
    .select({
      lot: stockLotsTable,
      productName: productsTable.name,
      supplierName: suppliersTable.name,
    })
    .from(stockLotsTable)
    .innerJoin(productsTable, eq(productsTable.id, stockLotsTable.productId))
    .leftJoin(suppliersTable, eq(suppliersTable.id, stockLotsTable.supplierId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(stockLotsTable.receivedAt))
    .limit(500);
  if (lots.length === 0) return [];

  const balances = await db
    .select({ balance: stockBalancesTable, warehouseName: warehousesTable.name })
    .from(stockBalancesTable)
    .innerJoin(warehousesTable, eq(warehousesTable.id, stockBalancesTable.warehouseId))
    .where(inArray(stockBalancesTable.lotId, lots.map((l) => l.lot.id)));
  const byLot = new Map<number, LotRow["balances"]>();
  for (const b of balances) {
    if (filter.warehouseId != null && b.balance.warehouseId !== filter.warehouseId) continue;
    if (b.balance.quantity === 0) continue;
    const list = byLot.get(b.balance.lotId) ?? [];
    list.push({ warehouseId: b.balance.warehouseId, warehouseName: b.warehouseName, quantity: b.balance.quantity, valueCents: b.balance.valueCents });
    byLot.set(b.balance.lotId, list);
  }

  const rows = lots.map(({ lot, productName, supplierName }) => {
    const lotBalances = byLot.get(lot.id) ?? [];
    return {
      id: lot.id,
      label: lotLabel(lot),
      lotNumber: lot.lotNumber,
      productId: lot.productId,
      productName,
      productionDate: lot.productionDate,
      expiryDate: lot.expiryDate,
      supplierName: supplierName ?? null,
      purchaseOrderCode: lot.purchaseOrderId ? purchaseOrderCode(lot.purchaseOrderId) : null,
      receiptCode: lot.purchaseReceiptId ? receiptCode(lot.purchaseReceiptId) : null,
      initialQuantity: lot.initialQuantity,
      unitCostCents: lotUnitValue(lot, 1),
      receivedAt: lot.receivedAt,
      balances: lotBalances,
      quantity: lotBalances.reduce((sum, b) => sum + b.quantity, 0),
    };
  });
  return filter.withStock ? rows.filter((r) => r.quantity > 0) : rows;
}

/** De dónde viene un movimiento, dicho como lo lee el equipo ("Despacho DES-000004 · PED-000120"). */
function movementReference(m: {
  orderId: number | null;
  shipmentId: number | null;
  purchaseReceiptId: number | null;
  returnId: number | null;
  adjustmentId: number | null;
  transferId: number | null;
}): string | null {
  const parts: string[] = [];
  if (m.purchaseReceiptId) parts.push(receiptCode(m.purchaseReceiptId));
  if (m.shipmentId) parts.push(shipmentCode(m.shipmentId));
  if (m.orderId) parts.push(orderCode(m.orderId));
  if (m.returnId) parts.push(returnCode(m.returnId));
  if (m.adjustmentId) parts.push(adjustmentCode(m.adjustmentId));
  if (m.transferId) parts.push(transferCode(m.transferId));
  return parts.length ? parts.join(" · ") : null;
}

export type MovementRow = {
  id: number;
  type: StockMovementType;
  productId: number;
  productName: string;
  warehouseId: number;
  warehouseName: string;
  lotId: number;
  lotLabel: string;
  expiryDate: string | null;
  quantity: number;
  valueCents: number;
  orderId: number | null;
  contactName: string | null;
  reference: string | null;
  note: string | null;
  actorLabel: string | null;
  createdAt: Date;
  balanceQuantity: number | null;
  balanceValueCents: number | null;
};

/**
 * Movimientos con filtros. Con producto (y almacén) es el KÁRDEX: viene en orden
 * cronológico y con el saldo corrido después de cada movimiento.
 */
export async function listMovements(filter: {
  productId?: number;
  warehouseId?: number;
  lotIds?: number[];
  orderId?: number;
  type?: StockMovementType;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<MovementRow[]> {
  const conditions: SQL[] = [];
  if (filter.productId != null) conditions.push(eq(stockMovementsTable.productId, filter.productId));
  if (filter.warehouseId != null) conditions.push(eq(stockMovementsTable.warehouseId, filter.warehouseId));
  if (filter.lotIds) conditions.push(inArray(stockMovementsTable.lotId, filter.lotIds.length ? filter.lotIds : [-1]));
  if (filter.orderId != null) conditions.push(eq(stockMovementsTable.orderId, filter.orderId));
  if (filter.type) conditions.push(eq(stockMovementsTable.type, filter.type));
  if (filter.from) conditions.push(sql`${stockMovementsTable.createdAt} >= ${filter.from}`);
  if (filter.to) conditions.push(lt(stockMovementsTable.createdAt, filter.to));

  const isKardex = filter.productId != null;
  const rows = await db
    .select({
      m: stockMovementsTable,
      productName: productsTable.name,
      warehouseName: warehousesTable.name,
      lot: stockLotsTable,
      contactName: contactsTable.name,
    })
    .from(stockMovementsTable)
    .innerJoin(productsTable, eq(productsTable.id, stockMovementsTable.productId))
    .innerJoin(warehousesTable, eq(warehousesTable.id, stockMovementsTable.warehouseId))
    .innerJoin(stockLotsTable, eq(stockLotsTable.id, stockMovementsTable.lotId))
    .leftJoin(ordersTable, eq(ordersTable.id, stockMovementsTable.orderId))
    .leftJoin(contactsTable, eq(contactsTable.id, ordersTable.contactId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(isKardex ? asc(stockMovementsTable.id) : desc(stockMovementsTable.id))
    .limit(Math.min(filter.limit ?? 500, 5000));

  // El saldo de partida del kárdex: lo que había antes del primer movimiento listado.
  let runningQty = 0;
  let runningValue = 0;
  if (isKardex && filter.from) {
    const opening = await db
      .select({
        quantity: sql<string>`COALESCE(SUM(${stockMovementsTable.quantity}), 0)::text`,
        valueCents: sql<string>`COALESCE(SUM(${stockMovementsTable.valueCents}), 0)::text`,
      })
      .from(stockMovementsTable)
      .where(
        and(
          eq(stockMovementsTable.productId, filter.productId!),
          ...(filter.warehouseId != null ? [eq(stockMovementsTable.warehouseId, filter.warehouseId)] : []),
          lt(stockMovementsTable.createdAt, filter.from),
        ),
      );
    runningQty = Number(opening[0]?.quantity ?? 0);
    runningValue = Number(opening[0]?.valueCents ?? 0);
  }

  return rows.map(({ m, productName, warehouseName, lot, contactName }) => {
    if (isKardex) {
      runningQty += m.quantity;
      runningValue += m.valueCents;
    }
    return {
      id: m.id,
      type: m.type,
      productId: m.productId,
      productName,
      warehouseId: m.warehouseId,
      warehouseName,
      lotId: m.lotId,
      lotLabel: lotLabel(lot),
      expiryDate: lot.expiryDate,
      quantity: m.quantity,
      valueCents: m.valueCents,
      orderId: m.orderId,
      contactName: contactName ?? null,
      reference: movementReference(m),
      note: m.note,
      actorLabel: m.actorLabel,
      createdAt: m.createdAt,
      balanceQuantity: isKardex ? runningQty : null,
      balanceValueCents: isKardex ? runningValue : null,
    };
  });
}

/**
 * Trazabilidad de un lote de producción: de qué proveedor y orden de compra
 * vino, dónde queda, y a qué clientes y pedidos se fue (y qué volvió). Junta
 * todas las capas del mismo producto con el mismo número de lote.
 */
export async function lotTrace(lotId: number) {
  const [lot] = await db.select().from(stockLotsTable).where(eq(stockLotsTable.id, lotId));
  if (!lot) return null;
  const group = lot.lotNumber
    ? await db
        .select({ id: stockLotsTable.id })
        .from(stockLotsTable)
        .where(and(eq(stockLotsTable.productId, lot.productId), eq(stockLotsTable.lotNumber, lot.lotNumber)))
    : [{ id: lot.id }];
  const lotIds = group.map((g) => g.id);
  const [lots, movements] = await Promise.all([
    listLots({ productId: lot.productId }).then((rows) => rows.filter((r) => lotIds.includes(r.id))),
    listMovements({ lotIds, limit: 5000 }),
  ]);
  const customers = new Map<number, { orderId: number; orderCode: string; contactName: string | null; quantity: number; date: Date }>();
  for (const m of movements) {
    if (m.orderId == null || (m.type !== "dispatch" && m.type !== "dispatch_reversal" && m.type !== "return")) continue;
    const entry = customers.get(m.orderId) ?? { orderId: m.orderId, orderCode: orderCode(m.orderId), contactName: m.contactName, quantity: 0, date: m.createdAt };
    entry.quantity += -m.quantity;
    customers.set(m.orderId, entry);
  }
  return {
    lotNumber: lot.lotNumber,
    label: lotLabel(lot),
    productId: lot.productId,
    lots,
    movements,
    customers: [...customers.values()].filter((c) => c.quantity !== 0),
  };
}

// ── Ajustes e inventario inicial ─────────────────────────────────────────────

export type AdjustmentLine = {
  productId: number;
  // Con signo: positivo entra, negativo sale.
  quantity: number;
  // Lote existente al que se suma o del que se resta. Sin él: si entra, se crea
  // un lote nuevo (hace falta el costo); si sale, se toma FEFO/PEPS.
  lotId?: number | null;
  lotNumber?: string | null;
  productionDate?: string | null;
  expiryDate?: string | null;
  unitCostCents?: number | null;
};

export async function postAdjustment(input: {
  warehouseId: number;
  reason: StockAdjustmentReason;
  notes?: string | null;
  lines: AdjustmentLine[];
  actor: Actor;
}): Promise<{ adjustmentId: number }> {
  const lines = input.lines.filter((l) => l.quantity !== 0);
  if (lines.length === 0) throw new InventoryError("El ajuste no tiene líneas.");
  if (input.reason === "opening" && lines.some((l) => l.quantity < 0)) {
    throw new InventoryError("El inventario inicial solo suma existencias.");
  }

  return db.transaction(async (tx) => {
    const [adjustment] = await tx
      .insert(stockAdjustmentsTable)
      .values({
        warehouseId: input.warehouseId,
        reason: input.reason,
        notes: input.notes?.trim() || null,
        createdByAgentId: input.actor.agentId,
        actorLabel: input.actor.label,
      })
      .returning();
    const refs: MovementRefs = { adjustmentId: adjustment.id, note: input.notes?.trim() || null };

    for (const line of lines) {
      if (line.quantity > 0) {
        const type: StockMovementType = input.reason === "opening" ? "opening" : "adjustment_in";
        if (line.lotId) {
          const [lot] = await tx.select().from(stockLotsTable).where(eq(stockLotsTable.id, line.lotId));
          if (!lot || lot.productId !== line.productId) throw new InventoryError("El lote no es de ese producto.");
          await addToLot(tx, {
            type,
            lotId: lot.id,
            productId: lot.productId,
            warehouseId: input.warehouseId,
            quantity: line.quantity,
            valueCents: lotUnitValue(lot, line.quantity),
            refs,
            actor: input.actor,
          });
        } else {
          if (line.unitCostCents == null || line.unitCostCents < 0) {
            throw new InventoryError("Para crear un lote hace falta su costo unitario.", { productId: line.productId });
          }
          const totalCostCents = line.unitCostCents * line.quantity;
          const lot = await createLot(tx, {
            productId: line.productId,
            lotNumber: line.lotNumber,
            productionDate: line.productionDate,
            expiryDate: line.expiryDate,
            adjustmentId: adjustment.id,
            quantity: line.quantity,
            totalCostCents,
          });
          await addToLot(tx, {
            type,
            lotId: lot.id,
            productId: line.productId,
            warehouseId: input.warehouseId,
            quantity: line.quantity,
            valueCents: totalCostCents,
            refs,
            actor: input.actor,
          });
        }
      } else {
        await consumeStock(tx, {
          type: "adjustment_out",
          productId: line.productId,
          warehouseId: input.warehouseId,
          quantity: -line.quantity,
          lotPicks: line.lotId ? [{ lotId: line.lotId, quantity: -line.quantity }] : null,
          refs,
          actor: input.actor,
        });
      }
    }
    return { adjustmentId: adjustment.id };
  });
}

export async function postTransfer(input: {
  fromWarehouseId: number;
  toWarehouseId: number;
  notes?: string | null;
  lines: Array<{ productId: number; quantity: number; lotId?: number | null }>;
  actor: Actor;
}): Promise<{ transferId: number }> {
  if (input.fromWarehouseId === input.toWarehouseId) throw new InventoryError("El almacén de origen y el de destino son el mismo.");
  const lines = input.lines.filter((l) => l.quantity > 0);
  if (lines.length === 0) throw new InventoryError("La transferencia no tiene líneas.");

  return db.transaction(async (tx) => {
    const [transfer] = await tx
      .insert(stockTransfersTable)
      .values({
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        notes: input.notes?.trim() || null,
        createdByAgentId: input.actor.agentId,
        actorLabel: input.actor.label,
      })
      .returning();
    const refs: MovementRefs = { transferId: transfer.id, note: input.notes?.trim() || null };
    for (const line of lines) {
      // Cada unidad viaja con su lote y su valor: el destino recibe exactamente lo
      // que el origen soltó.
      const picks = await consumeStock(tx, {
        type: "transfer_out",
        productId: line.productId,
        warehouseId: input.fromWarehouseId,
        quantity: line.quantity,
        lotPicks: line.lotId ? [{ lotId: line.lotId, quantity: line.quantity }] : null,
        refs,
        actor: input.actor,
      });
      for (const pick of picks) {
        await addToLot(tx, {
          type: "transfer_in",
          lotId: pick.lotId,
          productId: line.productId,
          warehouseId: input.toWarehouseId,
          quantity: pick.quantity,
          valueCents: pick.valueCents,
          refs,
          actor: input.actor,
        });
      }
    }
    return { transferId: transfer.id };
  });
}

// ── Valuación ─────────────────────────────────────────────────────────────────

/** El valor del inventario a costo PEPS, por almacén. */
export async function inventoryValuation() {
  const rows = await db
    .select({
      warehouseId: stockBalancesTable.warehouseId,
      warehouseName: warehousesTable.name,
      quantity: sql<string>`SUM(${stockBalancesTable.quantity})::text`,
      valueCents: sql<string>`SUM(${stockBalancesTable.valueCents})::text`,
    })
    .from(stockBalancesTable)
    .innerJoin(warehousesTable, eq(warehousesTable.id, stockBalancesTable.warehouseId))
    .groupBy(stockBalancesTable.warehouseId, warehousesTable.name)
    .orderBy(asc(warehousesTable.name));
  const byWarehouse = rows.map((r) => ({
    warehouseId: r.warehouseId,
    warehouseName: r.warehouseName,
    quantity: Number(r.quantity),
    valueCents: Number(r.valueCents),
  }));
  // El libro tiene que dar lo mismo que los saldos: si no, algo escribió uno sin el otro.
  const [ledger] = await db
    .select({ valueCents: sql<string>`COALESCE(SUM(${stockMovementsTable.valueCents}), 0)::text` })
    .from(stockMovementsTable);
  return {
    byWarehouse,
    totalValueCents: byWarehouse.reduce((sum, w) => sum + w.valueCents, 0),
    ledgerValueCents: Number(ledger?.valueCents ?? 0),
  };
}
