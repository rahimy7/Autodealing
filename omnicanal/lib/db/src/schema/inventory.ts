import {
  serial,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { productsTable } from "./products";

// ── Inventario ────────────────────────────────────────────────────────────────
// Existencias por almacén con lotes y costo PEPS (decisión del 2026-10-04): cada
// lote es una CAPA DE COSTO — entra con lo que costó y sale con ese mismo costo —
// y además es la trazabilidad del lote de producción (de qué orden de compra y de
// qué proveedor vino, a qué clientes se fue).
//
// La verdad es el libro (`stock_movements`): inmutable, una fila por cada
// entrada o salida, con cantidad y valor con signo. `stock_balances` es solo la
// suma vigente por lote y almacén, que se actualiza en la MISMA transacción que
// el movimiento (lib/inventory.ts); nada escribe una sin la otra.
//
// Lo comprometido (vendido y sin despachar) NO se guarda: se calcula de las
// líneas de los pedidos abiertos. Un contador que cada camino del código tuviera
// que acordarse de mover terminaría descuadrado.
//
// Estas tablas sí llevan llaves foráneas, a diferencia del resto del esquema: un
// movimiento que apunta a un producto o a un lote borrado deja el inventario sin
// explicación posible.

export const warehousesTable = pgTable(
  "warehouses",
  {
    id: serial("id").primaryKey(),
    // Código corto para listas y documentos ("PRIN", "STGO").
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    // El que se asigna a un pedido nuevo. Uno solo a la vez (lo cuida la ruta).
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("warehouses_code_idx").on(t.code)],
);

// Un kit (el "kit de los 3 productos") no tiene existencias propias: venderlo
// compromete y despachar lo descuenta de sus componentes.
export const productComponentsTable = pgTable(
  "product_components",
  {
    id: serial("id").primaryKey(),
    kitProductId: integer("kit_product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    componentProductId: integer("component_product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => [uniqueIndex("product_components_pair_idx").on(t.kitProductId, t.componentProductId)],
);

// Punto de reorden por producto y almacén. Cuando lo proyectado (en mano −
// comprometido + lo que viene en órdenes de compra + lo ya pedido) baja al
// mínimo, se pide hasta el objetivo.
export const reorderRulesTable = pgTable(
  "reorder_rules",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "cascade" }),
    minQuantity: integer("min_quantity").notNull(),
    targetQuantity: integer("target_quantity").notNull(),
    preferredSupplierId: integer("preferred_supplier_id"),
    // Desde cuándo está por debajo del mínimo. Se llena al cruzarlo (es lo que
    // dispara el aviso al equipo, una sola vez) y se vacía al recuperarse.
    lowSince: timestamp("low_since"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reorder_rules_product_warehouse_idx").on(t.productId, t.warehouseId)],
);

// Un lote = una capa de costo. Cada línea de una recepción (o del inventario
// inicial) crea el suyo, aunque el número de lote de producción se repita en dos
// recepciones: el costo puede ser distinto. La trazabilidad agrupa por
// producto + `lotNumber`.
export const stockLotsTable = pgTable(
  "stock_lots",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "restrict" }),
    // El lote de producción impreso en el envase. Null cuando el proveedor no lo
    // da: el panel muestra entonces el código de la recepción o del ajuste.
    lotNumber: text("lot_number"),
    productionDate: date("production_date", { mode: "string" }),
    expiryDate: date("expiry_date", { mode: "string" }),
    supplierId: integer("supplier_id"),
    purchaseOrderId: integer("purchase_order_id"),
    purchaseReceiptId: integer("purchase_receipt_id"),
    adjustmentId: integer("adjustment_id"),
    initialQuantity: integer("initial_quantity").notNull(),
    // Lo que costó la capa entera, en la moneda base de la instancia.
    totalCostCents: bigint("total_cost_cents", { mode: "number" }).notNull(),
    // Desempata PEPS entre lotes sin vencimiento: sale primero el que entró antes.
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("stock_lots_product_idx").on(t.productId),
    index("stock_lots_lot_number_idx").on(t.lotNumber),
    index("stock_lots_receipt_idx").on(t.purchaseReceiptId),
  ],
);

export const stockBalancesTable = pgTable(
  "stock_balances",
  {
    id: serial("id").primaryKey(),
    lotId: integer("lot_id")
      .notNull()
      .references(() => stockLotsTable.id, { onDelete: "restrict" }),
    // Repetido del lote para sumar por producto sin un join en cada consulta.
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "restrict" }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(0),
    valueCents: bigint("value_cents", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_balances_lot_warehouse_idx").on(t.lotId, t.warehouseId),
    index("stock_balances_product_warehouse_idx").on(t.productId, t.warehouseId),
  ],
);

export const stockMovementTypeEnum = pgEnum("stock_movement_type", [
  "opening", // inventario inicial
  "receipt", // recepción de una compra
  "adjustment_in", // ajuste que suma (conteo con sobrante)
  "adjustment_out", // ajuste que resta (conteo con faltante, daño, vencido, pérdida)
  "transfer_out",
  "transfer_in",
  "dispatch", // despacho de un pedido: la venta sale del almacén
  "dispatch_reversal", // no se entregó y el paquete volvió al almacén
  "return", // devolución del cliente que vuelve a ser vendible
]);

export const stockMovementsTable = pgTable(
  "stock_movements",
  {
    id: serial("id").primaryKey(),
    type: stockMovementTypeEnum("type").notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "restrict" }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "restrict" }),
    lotId: integer("lot_id")
      .notNull()
      .references(() => stockLotsTable.id, { onDelete: "restrict" }),
    // Con signo: positivo entra, negativo sale. El valor sigue al mismo signo y
    // está en la moneda base, al costo exacto del lote.
    quantity: integer("quantity").notNull(),
    valueCents: bigint("value_cents", { mode: "number" }).notNull(),
    // De dónde salió el movimiento. Solo uno o dos aplican a cada tipo.
    orderId: integer("order_id"),
    orderItemId: integer("order_item_id"),
    shipmentId: integer("shipment_id"),
    purchaseReceiptId: integer("purchase_receipt_id"),
    returnId: integer("return_id"),
    adjustmentId: integer("adjustment_id"),
    transferId: integer("transfer_id"),
    // El despacho que deshace un `dispatch_reversal`.
    reversesMovementId: integer("reverses_movement_id"),
    note: text("note"),
    actorAgentId: integer("actor_agent_id"),
    // Quién, para leerlo sin join: el nombre de la persona, "Sistema" o "Shopify".
    actorLabel: text("actor_label"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("stock_movements_product_warehouse_idx").on(t.productId, t.warehouseId, t.createdAt),
    index("stock_movements_lot_idx").on(t.lotId),
    index("stock_movements_order_idx").on(t.orderId),
    index("stock_movements_shipment_idx").on(t.shipmentId),
    index("stock_movements_type_created_idx").on(t.type, t.createdAt),
  ],
);

export const stockAdjustmentReasonEnum = pgEnum("stock_adjustment_reason", [
  "opening", // inventario inicial, al empezar a llevar existencias
  "count", // conteo físico que no cuadra
  "damage",
  "expiry",
  "loss",
  "other",
]);

export const stockAdjustmentsTable = pgTable("stock_adjustments", {
  id: serial("id").primaryKey(),
  warehouseId: integer("warehouse_id")
    .notNull()
    .references(() => warehousesTable.id, { onDelete: "restrict" }),
  reason: stockAdjustmentReasonEnum("reason").notNull(),
  notes: text("notes"),
  createdByAgentId: integer("created_by_agent_id"),
  actorLabel: text("actor_label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const stockTransfersTable = pgTable("stock_transfers", {
  id: serial("id").primaryKey(),
  fromWarehouseId: integer("from_warehouse_id")
    .notNull()
    .references(() => warehousesTable.id, { onDelete: "restrict" }),
  toWarehouseId: integer("to_warehouse_id")
    .notNull()
    .references(() => warehousesTable.id, { onDelete: "restrict" }),
  notes: text("notes"),
  createdByAgentId: integer("created_by_agent_id"),
  actorLabel: text("actor_label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Warehouse = typeof warehousesTable.$inferSelect;
export type ProductComponent = typeof productComponentsTable.$inferSelect;
export type ReorderRule = typeof reorderRulesTable.$inferSelect;
export type StockLot = typeof stockLotsTable.$inferSelect;
export type StockBalance = typeof stockBalancesTable.$inferSelect;
export type StockMovement = typeof stockMovementsTable.$inferSelect;
export type InsertStockMovement = typeof stockMovementsTable.$inferInsert;
export type StockMovementType = (typeof stockMovementTypeEnum.enumValues)[number];
export type StockAdjustment = typeof stockAdjustmentsTable.$inferSelect;
export type StockAdjustmentReason = (typeof stockAdjustmentReasonEnum.enumValues)[number];
export type StockTransfer = typeof stockTransfersTable.$inferSelect;
