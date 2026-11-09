import { serial, text, integer, bigint, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";

// Los clientes de Shopify que tienen o tuvieron una suscripción (2026-10-06), con
// el estado que da Shopify por cliente (Customer.productSubscriberStatus). Los
// contratos en sí —próximo cobro, frecuencia— son de la app de suscripciones de la
// tienda y Shopify no deja leerlos a otra app, así que esto va por cliente, no por
// contrato: un cliente con una suscripción activa y otra cancelada sale Activo.
//
// Se rehace entera cada pocas horas desde Shopify (lib/shopify-subscribers.ts):
// es una copia para ver y filtrar, no un dato que se edite aquí.
export const shopifySubscribersTable = pgTable(
  "shopify_subscribers",
  {
    id: serial("id").primaryKey(),
    // gid://shopify/Customer/…
    shopifyCustomerId: text("shopify_customer_id").notNull(),
    // El contacto de aquí con el mismo correo o teléfono, si ya existe (no se crea).
    contactId: integer("contact_id"),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    // ACTIVE · PAUSED · FAILED (pago fallido) · CANCELLED · EXPIRED
    status: text("status").notNull(),
    // El estado anterior y cuándo se VIO el cambio: Shopify no dice cuándo pasó,
    // se detecta al releer. Null mientras no haya cambiado desde que se conoce.
    previousStatus: text("previous_status"),
    statusChangedAt: timestamp("status_changed_at"),
    ordersCount: integer("orders_count").notNull().default(0),
    // En centavos de `currency` (la moneda de la tienda).
    amountSpentCents: bigint("amount_spent_cents", { mode: "number" }).notNull().default(0),
    currency: text("currency"),
    customerSince: timestamp("customer_since"),
    // El último pedido de suscripción que se le conoce. Shopify solo deja leer los
    // pedidos de los últimos 60 días: si es más viejo, queda el último que se vio.
    lastOrderName: text("last_order_name"),
    lastOrderAt: timestamp("last_order_at"),
    lastOrderProducts: text("last_order_products"),
    // El plan de venta de ese pedido ("Entrega cada mes, 15 % de descuento").
    sellingPlan: text("selling_plan"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    checkedAt: timestamp("checked_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("shopify_subscribers_customer_idx").on(t.shopifyCustomerId), index("shopify_subscribers_status_idx").on(t.status)],
);

export type ShopifySubscriber = typeof shopifySubscribersTable.$inferSelect;
