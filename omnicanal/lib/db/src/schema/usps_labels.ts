import { serial, text, integer, bigint, doublePrecision, timestamp, date, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { sql } from "drizzle-orm";
import { ordersTable } from "./orders";
import { shipmentsTable } from "./shipments";

// ── Etiquetas de USPS ─────────────────────────────────────────────────────────
// Una etiqueta comprada a USPS para el paquete de un pedido (la parada de un
// despacho con courier). Comprarla cobra el franqueo de la cuenta de pago de
// USPS, así que cada paso queda aquí: `creating` mientras se espera a USPS (con
// ella no se puede pedir otra para la misma parada, que sería pagar dos veces),
// `active` con su guía y su PDF, `voided` cuando USPS aceptó anularla y
// reembolsarla (solo si no se ha usado).

export const uspsLabelStatusEnum = pgEnum("usps_label_status", ["creating", "active", "voided"]);

export type UspsLabelAddress = {
  firstName: string;
  lastName: string;
  streetAddress: string;
  secondaryAddress: string | null;
  city: string;
  state: string;
  ZIPCode: string;
  ZIPPlus4: string | null;
};

export const uspsLabelsTable = pgTable(
  "usps_labels",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    shipmentId: integer("shipment_id").references(() => shipmentsTable.id, { onDelete: "set null" }),
    status: uspsLabelStatusEnum("status").notNull().default("creating"),
    // "test" (apis-tem.usps.com) o "production": una etiqueta de pruebas no es
    // un paquete real ni un cobro real, y no entra al costo del envío.
    environment: text("environment").notNull(),
    trackingNumber: text("tracking_number"),
    mailClass: text("mail_class").notNull(),
    rateIndicator: text("rate_indicator").notNull().default("SP"),
    processingCategory: text("processing_category").notNull().default("MACHINABLE"),
    weightLb: doublePrecision("weight_lb").notNull(),
    lengthIn: doublePrecision("length_in").notNull(),
    widthIn: doublePrecision("width_in").notNull(),
    heightIn: doublePrecision("height_in").notNull(),
    // La dirección que se mandó a USPS (ya validada), para poder reconstruir
    // qué se compró aunque el pedido cambie después.
    toAddress: jsonb("to_address").$type<UspsLabelAddress>().notNull(),
    postageCents: bigint("postage_cents", { mode: "number" }).notNull().default(0),
    // Extras y recargos que USPS reporta aparte del franqueo.
    extraCents: bigint("extra_cents", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    commitmentName: text("commitment_name"),
    commitmentDate: date("commitment_date", { mode: "string" }),
    // El PDF de la etiqueta en base64: es lo que se pagó, no puede depender de que
    // el almacenamiento de archivos esté arriba al reimprimirla.
    labelPdf: text("label_pdf"),
    // La copia en el almacenamiento de archivos (la que muestra el pedido como su
    // etiqueta de envío); se quita del pedido al anular.
    labelPath: text("label_path"),
    // El cargo que se anotó en el despacho por este franqueo; se quita al anular.
    chargeId: integer("charge_id"),
    voidNote: text("void_note"),
    // Último estado conocido del rastreo en USPS.
    trackingStatus: text("tracking_status"),
    trackingCategory: text("tracking_category"),
    trackingSummary: text("tracking_summary"),
    trackingCheckedAt: timestamp("tracking_checked_at"),
    createdByAgentId: integer("created_by_agent_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    voidedAt: timestamp("voided_at"),
  },
  (t) => [
    index("usps_labels_order_idx").on(t.orderId),
    index("usps_labels_shipment_idx").on(t.shipmentId),
    uniqueIndex("usps_labels_tracking_idx").on(t.trackingNumber),
    // Una sola etiqueta viva por parada: la anterior hay que anularla antes.
    uniqueIndex("usps_labels_live_stop_idx")
      .on(t.shipmentId, t.orderId)
      .where(sql`${t.status} in ('creating', 'active')`),
  ],
);

export type UspsLabel = typeof uspsLabelsTable.$inferSelect;
export type UspsLabelStatus = (typeof uspsLabelStatusEnum.enumValues)[number];
