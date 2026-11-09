import {
  serial,
  text,
  integer,
  bigint,
  boolean,
  doublePrecision,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { productsTable } from "./products";
import { warehousesTable } from "./inventory";

// ── Compras ───────────────────────────────────────────────────────────────────
// El camino de la mercancía hasta el almacén, en los tres pasos que pidió el
// negocio:
//   1. Pedido de compra (`purchase_requests`): la NECESIDAD interna — "hacen
//      falta 50 Procollagen en el almacén principal". La abre una persona o el
//      barrido del punto de reorden.
//   2. Orden de compra (`purchase_orders`): el compromiso con UN proveedor, con
//      cantidades y costos. Se le envía por correo.
//   3. Recepción (`purchase_receipts`): lo que de verdad llegó, con su lote de
//      producción y vencimiento. Cada línea crea un lote (capa de costo PEPS) y
//      lo suma al almacén.

export const suppliersTable = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  country: text("country"),
  // La moneda en que factura. Null = la moneda base de la instancia.
  currency: text("currency"),
  // "30 días", "contado"… informativo.
  paymentTerms: text("payment_terms"),
  // Días que tarda en entregar desde la orden: sugiere la fecha esperada.
  leadTimeDays: integer("lead_time_days"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// `open` recién abierto; `approved` listo para convertirse en orden de compra;
// `ordered` ya convertido (todas sus líneas están en alguna OC); `cancelled`.
export const purchaseRequestStatusEnum = pgEnum("purchase_request_status", ["open", "approved", "ordered", "cancelled"]);

export const purchaseRequestsTable = pgTable(
  "purchase_requests",
  {
    id: serial("id").primaryKey(),
    status: purchaseRequestStatusEnum("status").notNull().default("open"),
    // "manual" o "reorder" (lo abrió el barrido del punto de reorden). Hay a lo
    // sumo uno automático abierto por almacén: el barrido lo va completando.
    origin: text("origin").notNull().default("manual"),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "restrict" }),
    notes: text("notes"),
    requestedByAgentId: integer("requested_by_agent_id"),
    approvedAt: timestamp("approved_at"),
    approvedByAgentId: integer("approved_by_agent_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("purchase_requests_status_idx").on(t.status)],
);

export const purchaseRequestItemsTable = pgTable(
  "purchase_request_items",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => purchaseRequestsTable.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    suggestedSupplierId: integer("suggested_supplier_id"),
    // Por qué se pide ("Disponible 4, mínimo 10, objetivo 40").
    reason: text("reason"),
    // La línea de la orden de compra en que se convirtió.
    purchaseOrderItemId: integer("purchase_order_item_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("purchase_request_items_request_idx").on(t.requestId)],
);

// `draft` en preparación; `sent` enviada al proveedor; `partial` llegó una parte;
// `received` llegó todo; `closed` se cerró con faltante (no va a llegar más);
// `cancelled`.
export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
  "draft",
  "sent",
  "partial",
  "received",
  "closed",
  "cancelled",
]);

export const purchaseOrdersTable = pgTable(
  "purchase_orders",
  {
    id: serial("id").primaryKey(),
    supplierId: integer("supplier_id")
      .notNull()
      .references(() => suppliersTable.id, { onDelete: "restrict" }),
    // A qué almacén llega.
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "restrict" }),
    status: purchaseOrderStatusEnum("status").notNull().default("draft"),
    currency: text("currency").notNull(),
    // Unidades de la moneda base por 1 unidad de `currency`. Solo orienta: la
    // que vale para el costo es la de cada recepción. Null = no se sabe todavía.
    rateToBase: doublePrecision("rate_to_base"),
    orderDate: date("order_date", { mode: "string" }),
    expectedDate: date("expected_date", { mode: "string" }),
    // El número que le da el proveedor (su cotización, su pedido).
    supplierReference: text("supplier_reference"),
    notes: text("notes"),
    sentAt: timestamp("sent_at"),
    createdByAgentId: integer("created_by_agent_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("purchase_orders_status_idx").on(t.status), index("purchase_orders_supplier_idx").on(t.supplierId)],
);

export const purchaseOrderItemsTable = pgTable(
  "purchase_order_items",
  {
    id: serial("id").primaryKey(),
    purchaseOrderId: integer("purchase_order_id")
      .notNull()
      .references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    // Costo unitario en la moneda de la orden.
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull(),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    requestItemId: integer("request_item_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("purchase_order_items_order_idx").on(t.purchaseOrderId)],
);

export const purchaseReceiptsTable = pgTable(
  "purchase_receipts",
  {
    id: serial("id").primaryKey(),
    // Null = una compra que llegó sin orden (compra directa).
    purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id, { onDelete: "restrict" }),
    supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "restrict" }),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "restrict" }),
    currency: text("currency").notNull(),
    // La tasa con que se costea lo recibido: unidades base por 1 de `currency`.
    rateToBase: doublePrecision("rate_to_base").notNull().default(1),
    supplierInvoice: text("supplier_invoice"),
    notes: text("notes"),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    receivedByAgentId: integer("received_by_agent_id"),
    actorLabel: text("actor_label"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("purchase_receipts_order_idx").on(t.purchaseOrderId)],
);

export const purchaseReceiptItemsTable = pgTable(
  "purchase_receipt_items",
  {
    id: serial("id").primaryKey(),
    receiptId: integer("receipt_id")
      .notNull()
      .references(() => purchaseReceiptsTable.id, { onDelete: "cascade" }),
    purchaseOrderItemId: integer("purchase_order_item_id"),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    // En la moneda de la recepción; el lote guarda el costo ya en la base.
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull(),
    lotNumber: text("lot_number"),
    productionDate: date("production_date", { mode: "string" }),
    expiryDate: date("expiry_date", { mode: "string" }),
    lotId: integer("lot_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("purchase_receipt_items_receipt_idx").on(t.receiptId)],
);

export type Supplier = typeof suppliersTable.$inferSelect;
export type PurchaseRequest = typeof purchaseRequestsTable.$inferSelect;
export type PurchaseRequestItem = typeof purchaseRequestItemsTable.$inferSelect;
export type PurchaseRequestStatus = (typeof purchaseRequestStatusEnum.enumValues)[number];
export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;
export type PurchaseOrderItem = typeof purchaseOrderItemsTable.$inferSelect;
export type PurchaseOrderStatus = (typeof purchaseOrderStatusEnum.enumValues)[number];
export type PurchaseReceipt = typeof purchaseReceiptsTable.$inferSelect;
export type PurchaseReceiptItem = typeof purchaseReceiptItemsTable.$inferSelect;
