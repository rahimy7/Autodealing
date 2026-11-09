import { serial, text, integer, bigint, timestamp, index } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { warehousesTable } from "./inventory";

// ── Devoluciones y notas de crédito ──────────────────────────────────────────
// Una devolución es la mercancía que el cliente regresa de un pedido ya
// despachado. Lo que vuelve en buen estado (`restock`) entra al MISMO lote con el
// costo con que salió; lo dañado (`damaged`) no vuelve a existencias y queda
// como merma. Se resuelve devolviendo el dinero, con una nota de crédito o
// reponiendo el producto (un pedido nuevo a precio cero).
//
// Las notas de crédito son internas (decisión del 2026-10-04): "NC-000123", con
// un campo para el NCF cuando el comprobante fiscal se emitió en otro sistema.
// Su saldo no se guarda: es el monto menos lo aplicado a pedidos y lo reembolsado.

export const returnStatusEnum = pgEnum("return_status", ["requested", "received", "closed", "cancelled"]);
export const returnResolutionEnum = pgEnum("return_resolution", ["refund", "credit_note", "replacement", "none"]);
export const returnConditionEnum = pgEnum("return_condition", ["restock", "damaged"]);

export const returnsTable = pgTable(
  "returns",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").notNull(),
    contactId: integer("contact_id").notNull(),
    // El caso del que nació, cuando lo pidió el cliente por correo o chat.
    caseId: integer("case_id"),
    // Dónde se recibe lo que vuelve.
    warehouseId: integer("warehouse_id").references(() => warehousesTable.id, { onDelete: "restrict" }),
    status: returnStatusEnum("status").notNull().default("requested"),
    reason: text("reason"),
    resolution: returnResolutionEnum("resolution").notNull().default("none"),
    replacementOrderId: integer("replacement_order_id"),
    receivedAt: timestamp("received_at"),
    notes: text("notes"),
    createdByAgentId: integer("created_by_agent_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("returns_order_idx").on(t.orderId), index("returns_status_idx").on(t.status)],
);

// Una línea por producto y lote que vuelve: es el detalle que permite reingresar
// al mismo lote y al costo exacto (el de su movimiento de despacho), también en
// un kit, donde lo que vuelve son sus componentes.
export const returnItemsTable = pgTable(
  "return_items",
  {
    id: serial("id").primaryKey(),
    returnId: integer("return_id")
      .notNull()
      .references(() => returnsTable.id, { onDelete: "cascade" }),
    orderItemId: integer("order_item_id").notNull(),
    productId: integer("product_id").notNull(),
    lotId: integer("lot_id"),
    quantity: integer("quantity").notNull(),
    condition: returnConditionEnum("condition").notNull().default("restock"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("return_items_return_idx").on(t.returnId)],
);

export const creditNoteReasonEnum = pgEnum("credit_note_reason", [
  "return",
  "discount",
  "price_adjustment",
  "goodwill",
  "other",
]);
export const creditNoteStatusEnum = pgEnum("credit_note_status", ["issued", "void"]);

export const creditNotesTable = pgTable(
  "credit_notes",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id").notNull(),
    orderId: integer("order_id"),
    returnId: integer("return_id"),
    caseId: integer("case_id"),
    reason: creditNoteReasonEnum("reason").notNull(),
    currency: text("currency").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    // Lo que se le devolvió en dinero de esta nota (todo o una parte).
    refundedCents: bigint("refunded_cents", { mode: "number" }).notNull().default(0),
    refundedAt: timestamp("refunded_at"),
    refundMethod: text("refund_method"),
    // El NCF (B04/E34) si el comprobante fiscal se emitió en otro sistema.
    fiscalNumber: text("fiscal_number"),
    status: creditNoteStatusEnum("status").notNull().default("issued"),
    notes: text("notes"),
    createdByAgentId: integer("created_by_agent_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("credit_notes_contact_idx").on(t.contactId), index("credit_notes_order_idx").on(t.orderId)],
);

// Cuánto de una nota de crédito se usó para pagar un pedido.
export const creditNoteApplicationsTable = pgTable(
  "credit_note_applications",
  {
    id: serial("id").primaryKey(),
    creditNoteId: integer("credit_note_id")
      .notNull()
      .references(() => creditNotesTable.id, { onDelete: "cascade" }),
    orderId: integer("order_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    createdByAgentId: integer("created_by_agent_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("credit_note_applications_note_idx").on(t.creditNoteId),
    index("credit_note_applications_order_idx").on(t.orderId),
  ],
);

export type Return = typeof returnsTable.$inferSelect;
export type ReturnStatus = (typeof returnStatusEnum.enumValues)[number];
export type ReturnResolution = (typeof returnResolutionEnum.enumValues)[number];
export type ReturnItem = typeof returnItemsTable.$inferSelect;
export type ReturnCondition = (typeof returnConditionEnum.enumValues)[number];
export type CreditNote = typeof creditNotesTable.$inferSelect;
export type CreditNoteReason = (typeof creditNoteReasonEnum.enumValues)[number];
export type CreditNoteApplication = typeof creditNoteApplicationsTable.$inferSelect;
