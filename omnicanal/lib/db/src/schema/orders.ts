import { serial, text, integer, bigint, boolean, doublePrecision, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// El ciclo del pedido, de más a menos avanzado: se abre en cuanto el cliente dice
// que pagó (Pendiente, a que el equipo verifique la transferencia), pasa a
// En proceso mientras se arma/despacha, Enviado con el paquete ya en camino y
// Entregado al confirmarlo. Cancelado es la salida cuando no se concreta.
// Una guía de envío que Shopify ya tiene del pedido (la etiqueta se compró allá, o
// desde aquí vía Shopify): sale del cumplimiento (fulfillment) del pedido.
export type ExternalTracking = {
  fulfillmentId: string;
  number: string;
  company: string | null;
  url: string | null;
  deliveredAt: string | null;
};

export const orderStatusEnum = pgEnum("order_status", ["pending", "processing", "shipped", "delivered", "cancelled"]);

// Un pedido tomado por chat. `PEDIDO_CONFIRMADO` (el cliente dice que pagó o
// manda el comprobante, en messaging.ts) crea la fila sola, en Pendiente; de ahí
// el equipo la lleva hasta Entregado desde la vista de Pedidos. No hay columna
// `code`: el código que ve el equipo ("PED-000123") se arma a partir del id al
// servir el pedido (lib/orders.ts), así nunca hay dos con el mismo código que
// reconciliar ni una columna que se pueda desincronizar del id.
export const ordersTable = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id").notNull(),
    // La conversación de la que salió el pedido. Null en uno cargado a mano sin
    // chat de por medio.
    conversationId: integer("conversation_id"),
    status: orderStatusEnum("status").notNull().default("pending"),
    product: text("product"),
    quantity: integer("quantity").notNull().default(1),
    // Monto que el cliente transfirió, tal como quedó en el chat — no siempre en
    // la misma moneda que el precio de catálogo (pesos al día, dólares…). Quien
    // verifica el pago lo confirma o corrige contra la transferencia real.
    amount: integer("amount"),
    currency: text("currency"),
    address: text("address"),
    // Solo se pide en el chat para envíos a Estados Unidos (para el rastreo). Se
    // usa también para decidir si el aviso de pedido lo incluye.
    email: text("email"),
    // El mensaje del chat con el comprobante (imagen o documento), cuando el
    // pedido salió de una conversación. `paymentProofPath` es un archivo propio
    // del pedido en el mismo storage de medios (uploadMedia/signMediaUrl): lo que
    // se sube a mano, o una copia si ese mensaje se llega a borrar.
    paymentProofMessageId: integer("payment_proof_message_id"),
    paymentProofPath: text("payment_proof_path"),
    // La guía/etiqueta de envío (Vimenpaq, Domex, UPS…) que se pega en el
    // paquete al despacharlo.
    shippingLabelPath: text("shipping_label_path"),
    notes: text("notes"),
    // Quién lo creó a mano desde la vista de Pedidos. Null en el que abre solo
    // PEDIDO_CONFIRMADO.
    createdByAgentId: integer("created_by_agent_id"),

    // ── Líneas, totales e inventario (2026-10-04) ────────────────────────────
    // `product`/`quantity` de arriba quedan como el RESUMEN de las líneas
    // (order_items), para que lo que ya los lee —el aviso al equipo, el badge del
    // chat, la app— siga igual.
    // De dónde salió: "chat" (PEDIDO_CONFIRMADO), "manual" (vista de Pedidos),
    // "shopify" (sincronización) o "replacement" (reposición de una devolución).
    source: text("source").notNull().default("chat"),
    // El almacén que lo despacha y donde queda comprometido.
    warehouseId: integer("warehouse_id"),
    // La moneda de los precios y totales del pedido. No es `currency` de arriba,
    // que es la del monto TRANSFERIDO: un cliente de RD paga en pesos el
    // equivalente de un precio en dólares. Null = la moneda base.
    priceCurrency: text("price_currency"),
    // Unidades de la moneda base por 1 unidad de `priceCurrency`, fijada al
    // crearlo, para llevar el pedido a la moneda del inventario en los márgenes.
    rateToBase: doublePrecision("rate_to_base"),
    // Todo en centavos de `priceCurrency`. total = Σ líneas − descuento + envío.
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull().default(0),
    discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
    discountReason: text("discount_reason"),
    // Lo que el CLIENTE paga por el envío (cero cuando el envío es gratis).
    shippingChargeCents: bigint("shipping_charge_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    // Lo que el envío NOS costó: la parte de los cargos del viaje o del courier
    // que le tocó a este pedido, en la moneda base. Va al margen.
    shippingCostCents: bigint("shipping_cost_cents", { mode: "number" }).notNull().default(0),
    // El hilo de correo de los avisos al cliente: el primero lo abre y los
    // siguientes van en el mismo, así su respuesta llega a la vista de Correo.
    emailThreadId: integer("email_thread_id"),
    // El pedido en Shopify (id GID) y su nombre visible ("#1234").
    externalId: text("external_id"),
    externalName: text("external_name"),
    isSubscription: boolean("is_subscription").notNull().default(false),
    // El estado del pago según Shopify (PAID, PENDING…), solo para informar: el
    // pedido entra Pendiente igual y el equipo confirma.
    externalFinancialStatus: text("external_financial_status"),
    // El comentario del pedido en Shopify: la nota que dejó el cliente al pagar (o
    // el equipo allá) y los datos que pide la tienda en el carrito. Es de Shopify y
    // se actualiza con cada sincronización; `notes` es del equipo aquí.
    externalNote: text("external_note"),
    // Las guías del pedido en Shopify (de sus envíos no cancelados), para
    // llevarlas al despacho en vez de teclearlas. Null = ninguna.
    externalTracking: jsonb("external_tracking").$type<ExternalTracking[]>(),
    // Idioma del cliente cuando lo sabemos (Shopify), para el idioma del correo.
    customerLocale: text("customer_locale"),
    // La reposición apunta al pedido que repone.
    replacesOrderId: integer("replaces_order_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("orders_contact_idx").on(t.contactId),
    index("orders_conversation_idx").on(t.conversationId),
    index("orders_status_idx").on(t.status),
    uniqueIndex("orders_external_id_idx").on(t.externalId),
    index("orders_warehouse_status_idx").on(t.warehouseId, t.status),
  ],
);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
