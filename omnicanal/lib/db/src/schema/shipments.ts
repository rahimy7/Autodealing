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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { warehousesTable } from "./inventory";
import { ordersTable } from "./orders";

// ── Despachos ─────────────────────────────────────────────────────────────────
// Los pedidos salen del almacén agrupados: en un VIAJE (vehículo propio con su
// chofer, la entrega a domicilio) o con un COURIER (Vimenpaq, Domex, UPS…, cada
// paquete con su guía). Registrar el despacho es lo que descuenta el inventario
// (por lote, PEPS) y pasa los pedidos a Enviado.
//
// Los cargos del despacho (lo que cobra el courier, combustible, chofer, peajes)
// son el COSTO DEL ENVÍO: se reparten entre sus pedidos y van al margen de cada
// uno (decisión del 2026-10-04 — no son costo de la mercancía).

export const carriersTable = pgTable("carriers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // "courier" (un tercero, con guía) u "own" (reparto propio).
  kind: text("kind").notNull().default("courier"),
  // Enlace de rastreo con {tracking} donde va la guía; null si no tiene rastreo
  // en línea. Sale en el correo de "tu pedido va en camino".
  trackingUrlTemplate: text("tracking_url_template"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const shipmentKindEnum = pgEnum("shipment_kind", ["trip", "courier"]);

// `planning` se está armando (se agregan y quitan pedidos); `dispatched` salió y
// el inventario ya se descontó; `completed` todas sus paradas se entregaron o
// volvieron; `cancelled` antes de salir.
export const shipmentStatusEnum = pgEnum("shipment_status", ["planning", "dispatched", "completed", "cancelled"]);

export const shipmentsTable = pgTable(
  "shipments",
  {
    id: serial("id").primaryKey(),
    kind: shipmentKindEnum("kind").notNull(),
    carrierId: integer("carrier_id"),
    driverName: text("driver_name"),
    vehicle: text("vehicle"),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "restrict" }),
    plannedDate: date("planned_date", { mode: "string" }),
    status: shipmentStatusEnum("status").notNull().default("planning"),
    dispatchedAt: timestamp("dispatched_at"),
    completedAt: timestamp("completed_at"),
    notes: text("notes"),
    createdByAgentId: integer("created_by_agent_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("shipments_status_idx").on(t.status)],
);

export const shipmentDeliveryStatusEnum = pgEnum("shipment_delivery_status", ["pending", "delivered", "failed"]);

// Las paradas (viaje) o los paquetes (courier) del despacho.
export const shipmentOrdersTable = pgTable(
  "shipment_orders",
  {
    id: serial("id").primaryKey(),
    shipmentId: integer("shipment_id")
      .notNull()
      .references(() => shipmentsTable.id, { onDelete: "cascade" }),
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    // El orden de la parada en un viaje.
    sequence: integer("sequence").notNull().default(0),
    // La guía del paquete con el courier.
    trackingNumber: text("tracking_number"),
    deliveryStatus: shipmentDeliveryStatusEnum("delivery_status").notNull().default("pending"),
    deliveredAt: timestamp("delivered_at"),
    failureReason: text("failure_reason"),
    // La parte de los cargos del despacho que le tocó a este pedido, en la moneda
    // base. Se recalcula al cambiar cargos o paradas.
    allocatedCostCents: bigint("allocated_cost_cents", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shipment_orders_pair_idx").on(t.shipmentId, t.orderId),
    index("shipment_orders_order_idx").on(t.orderId),
  ],
);

export const shipmentChargesTable = pgTable(
  "shipment_charges",
  {
    id: serial("id").primaryKey(),
    shipmentId: integer("shipment_id")
      .notNull()
      .references(() => shipmentsTable.id, { onDelete: "cascade" }),
    // Un cargo de UN paquete (lo que cobró el courier por esa guía) va entero a
    // ese pedido; sin pedido se reparte entre todos los del despacho.
    orderId: integer("order_id"),
    // "Courier", "Combustible", "Chofer", "Peaje", "Empaque", "Otro".
    concept: text("concept").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    rateToBase: doublePrecision("rate_to_base").notNull().default(1),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("shipment_charges_shipment_idx").on(t.shipmentId)],
);

export type Carrier = typeof carriersTable.$inferSelect;
export type Shipment = typeof shipmentsTable.$inferSelect;
export type ShipmentKind = (typeof shipmentKindEnum.enumValues)[number];
export type ShipmentStatus = (typeof shipmentStatusEnum.enumValues)[number];
export type ShipmentOrder = typeof shipmentOrdersTable.$inferSelect;
export type ShipmentDeliveryStatus = (typeof shipmentDeliveryStatusEnum.enumValues)[number];
export type ShipmentCharge = typeof shipmentChargesTable.$inferSelect;
