import { serial, text, integer, doublePrecision, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { sql } from "drizzle-orm";
import { ordersTable } from "./orders";
import { shipmentsTable } from "./shipments";

// ── Etiquetas compradas con Shopify ───────────────────────────────────────────
// La etiqueta del paquete de un pedido de Shopify, comprada con la API de
// etiquetas de Shopify Shipping (la tarifa y su cobro los pone Shopify). Shopify
// no informa el costo ni permite anularla por API: el costo se anota a mano en
// los cargos del despacho y una etiqueta anulada en Shopify se "descarta" aquí.
// `creating` mientras se espera a Shopify (bloquea una segunda compra), `active`
// con su guía y su PDF, `discarded` cuando ya no vale.

export const shopifyLabelStatusEnum = pgEnum("shopify_label_status", ["creating", "active", "discarded"]);

export const shopifyLabelsTable = pgTable(
  "shopify_labels",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "restrict" }),
    shipmentId: integer("shipment_id").references(() => shipmentsTable.id, { onDelete: "set null" }),
    status: shopifyLabelStatusEnum("status").notNull().default("creating"),
    // Los ids de Shopify (GID): el envío (fulfillment order), el resultado de la
    // compra, que es asíncrona, y la etiqueta.
    fulfillmentOrderId: text("fulfillment_order_id"),
    purchaseResultId: text("purchase_result_id"),
    shopifyLabelId: text("shopify_label_id"),
    trackingNumber: text("tracking_number"),
    trackingCompany: text("tracking_company"),
    trackingUrl: text("tracking_url"),
    // El peso total que se pidió (opcional: sin él, Shopify lo calcula).
    weightOz: doublePrecision("weight_oz"),
    // El PDF en base64 y la dirección de donde se bajó. Es lo que se pagó: no puede
    // depender de que el enlace de Shopify siga vivo.
    labelPdf: text("label_pdf"),
    documentUrl: text("document_url"),
    // Si Shopify todavía deja anularla (se refresca al consultarla).
    cancellable: boolean("cancellable"),
    note: text("note"),
    createdByAgentId: integer("created_by_agent_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    discardedAt: timestamp("discarded_at"),
  },
  (t) => [
    index("shopify_labels_order_idx").on(t.orderId),
    index("shopify_labels_shipment_idx").on(t.shipmentId),
    uniqueIndex("shopify_labels_label_id_idx").on(t.shopifyLabelId),
    // Una sola etiqueta viva por parada.
    uniqueIndex("shopify_labels_live_stop_idx")
      .on(t.shipmentId, t.orderId)
      .where(sql`${t.status} in ('creating', 'active')`),
  ],
);

export type ShopifyLabel = typeof shopifyLabelsTable.$inferSelect;
export type ShopifyLabelStatus = (typeof shopifyLabelStatusEnum.enumValues)[number];
