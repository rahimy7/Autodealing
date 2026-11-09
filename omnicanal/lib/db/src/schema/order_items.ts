import { serial, text, integer, bigint, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";
import { ordersTable } from "./orders";
import { productsTable } from "./products";

// Las líneas de un pedido. Hasta el 2026-10-04 un pedido era un texto libre
// ("Procollagen x2"); con inventario, cada línea apunta a un producto del
// catálogo para poder comprometerlo, despacharlo por lote y costearlo.
//
// `productId` null = una línea que no se pudo vincular (la IA leyó un producto
// que no está en el catálogo, o Shopify trajo uno sin SKU ni handle conocido).
// No compromete ni se despacha hasta que alguien la vincula.
export const orderItemsTable = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => productsTable.id, { onDelete: "restrict" }),
    // Tal como se vendió (el nombre del producto, o lo que dijo el chat/Shopify).
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    // En centavos de la moneda del pedido.
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull().default(0),
    discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    // Cuánto ya salió del almacén. Lo comprometido es quantity − dispatched.
    dispatchedQuantity: integer("dispatched_quantity").notNull().default(0),
    // La línea de Shopify, para que re-sincronizar no la duplique.
    externalLineId: text("external_line_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId), index("order_items_product_idx").on(t.productId)],
);

// El expediente del pedido: cada etapa (creado, pago confirmado, asignado a un
// despacho, despachado con su guía, entregado, devuelto…), cada aviso que se le
// mandó o no se le pudo mandar al cliente. Es la trazabilidad que ve el equipo,
// igual que `case_events` en Casos.
export const orderEventsTable = pgTable(
  "order_events",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    detail: text("detail").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    actorAgentId: integer("actor_agent_id"),
    actorLabel: text("actor_label"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

export type OrderItem = typeof orderItemsTable.$inferSelect;
export type InsertOrderItem = typeof orderItemsTable.$inferInsert;
export type OrderEvent = typeof orderEventsTable.$inferSelect;
