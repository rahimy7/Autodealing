import { serial, text, boolean, timestamp, integer, doublePrecision } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Singleton row (id = 1) holding Meta (WhatsApp/Facebook/Instagram) API credentials
// used to establish real Cloud API connections.
export const integrationSettingsTable = pgTable("integration_settings", {
  id: serial("id").primaryKey(),

  // ── Meta App (shared) ──────────────────────────────────────────────────────
  metaAppId: text("meta_app_id"),
  metaAppSecret: text("meta_app_secret"),
  webhookVerifyToken: text("webhook_verify_token"),

  // ── WhatsApp Business (Cloud API) ──────────────────────────────────────────
  whatsappEnabled: boolean("whatsapp_enabled").notNull().default(false),
  whatsappPhoneNumberId: text("whatsapp_phone_number_id"),
  whatsappBusinessAccountId: text("whatsapp_business_account_id"),
  whatsappDisplayNumber: text("whatsapp_display_number"),
  whatsappAccessToken: text("whatsapp_access_token"),

  // ── Facebook Messenger ─────────────────────────────────────────────────────
  facebookEnabled: boolean("facebook_enabled").notNull().default(false),
  facebookPageId: text("facebook_page_id"),
  facebookPageAccessToken: text("facebook_page_access_token"),

  // ── Instagram ──────────────────────────────────────────────────────────────
  instagramEnabled: boolean("instagram_enabled").notNull().default(false),
  instagramBusinessAccountId: text("instagram_business_account_id"),
  instagramAccessToken: text("instagram_access_token"),
  // Con "inicio de sesión con Instagram" (token IGAA…) Meta firma los webhooks de
  // Instagram con la clave secreta de la app de Instagram, que no es el App
  // Secret de arriba. Sin ella, cada DM de Instagram se rechaza por firma.
  instagramAppSecret: text("instagram_app_secret"),

  // ── Gmail (API de Gmail con OAuth de Google) ───────────────────────────────
  // Client ID y Client Secret salen del proyecto de Google Cloud del cliente; el
  // refresh token lo entrega Google al pulsar "Conectar" en el panel, nunca se
  // pega a mano.
  gmailEnabled: boolean("gmail_enabled").notNull().default(false),
  gmailClientId: text("gmail_client_id"),
  gmailClientSecret: text("gmail_client_secret"),
  gmailRefreshToken: text("gmail_refresh_token"),
  // La cuenta que autorizó el acceso. Es "nosotros" al leer el buzón: lo que sale
  // de esta dirección es un correo enviado, no uno de un cliente.
  gmailEmailAddress: text("gmail_email_address"),
  gmailFromName: text("gmail_from_name"),
  gmailSignature: text("gmail_signature"),
  // Enviar sin revisión la respuesta de la IA cuando la intención está marcada
  // como segura. Apagado, todo queda como borrador para un humano.
  gmailAutoReply: boolean("gmail_auto_reply").notNull().default(false),
  // Punto del historial del buzón hasta donde ya se leyó. Null significa que
  // falta la importación inicial.
  gmailHistoryId: text("gmail_history_id"),
  gmailLastSyncAt: timestamp("gmail_last_sync_at"),
  gmailLastError: text("gmail_last_error"),

  // ── Shopify (Admin API) ────────────────────────────────────────────────────
  // Se traen TODOS los pedidos de la tienda (web y suscripciones) para que el
  // inventario los comprometa (decisión del 2026-10-04). Dos formas de entrar:
  // el token de una app personalizada antigua (`shpat_…`, ya no se pueden crear
  // desde el 2026-01-01) o el Client ID/Secret de una app del Dev Dashboard, que
  // se canjean por un token que caduca a las 24 h y se renueva solo.
  shopifyEnabled: boolean("shopify_enabled").notNull().default(false),
  shopifyShopDomain: text("shopify_shop_domain"),
  shopifyAccessToken: text("shopify_access_token"),
  shopifyClientId: text("shopify_client_id"),
  shopifyClientSecret: text("shopify_client_secret"),
  // A qué almacén entran (y desde cuál se despachan) los pedidos de Shopify.
  shopifyWarehouseId: integer("shopify_warehouse_id"),
  // Solo se importan los pedidos creados desde aquí: conectar la tienda no debe
  // traer años de historial como pedidos pendientes.
  shopifySyncFrom: timestamp("shopify_sync_from"),
  // Hasta dónde se leyó (updated_at del último pedido procesado).
  shopifySyncCursor: timestamp("shopify_sync_cursor"),
  shopifyLastSyncAt: timestamp("shopify_last_sync_at"),
  shopifyLastError: text("shopify_last_error"),
  // La lista de suscriptores (shopify_subscribers): cuándo se leyó completa por
  // última vez y, si falló, por qué.
  shopifySubscribersSyncedAt: timestamp("shopify_subscribers_synced_at"),
  shopifySubscribersError: text("shopify_subscribers_error"),
  // Comprar la etiqueta de un pedido de Shopify desde el despacho, con la API de
  // etiquetas de Shopify Shipping (hace falta write_orders y
  // write_merchant_managed_fulfillment_orders en la app). Apagado hasta que se
  // pidan esos permisos: la compra cobra a la cuenta de Shopify.
  shopifyLabelsEnabled: boolean("shopify_labels_enabled").notNull().default(false),

  // ── USPS (etiquetas y franqueo de los envíos a Estados Unidos) ─────────────
  // App del portal de desarrolladores de USPS: Consumer Key/Secret (client
  // credentials). Para comprar etiquetas hace falta además una cuenta de pago
  // (Enterprise Payment Account, EPS) con su CRID y MID. `uspsEnvironment` arranca en
  // "test" (apis-tem.usps.com, el espejo de pruebas): nada se cobra de verdad
  // hasta que alguien lo pase a "production".
  uspsEnabled: boolean("usps_enabled").notNull().default(false),
  uspsEnvironment: text("usps_environment").notNull().default("test"),
  uspsClientId: text("usps_client_id"),
  uspsClientSecret: text("usps_client_secret"),
  uspsCrid: text("usps_crid"),
  uspsMid: text("usps_mid"),
  // El MID del manifiesto; casi siempre es el mismo MID.
  uspsManifestMid: text("usps_manifest_mid"),
  uspsAccountNumber: text("usps_account_number"),
  // Remitente (la dirección de la que sale el paquete).
  uspsFromName: text("usps_from_name"),
  uspsFromStreet: text("usps_from_street"),
  uspsFromStreet2: text("usps_from_street2"),
  uspsFromCity: text("usps_from_city"),
  uspsFromState: text("usps_from_state"),
  uspsFromZip: text("usps_from_zip"),
  // El paquete de siempre: lo que se propone al crear una etiqueta (se puede
  // cambiar en cada una). Peso en onzas y medidas en pulgadas.
  uspsDefaultMailClass: text("usps_default_mail_class").notNull().default("USPS_GROUND_ADVANTAGE"),
  uspsDefaultWeightOz: doublePrecision("usps_default_weight_oz"),
  uspsDefaultLengthIn: doublePrecision("usps_default_length_in"),
  uspsDefaultWidthIn: doublePrecision("usps_default_width_in"),
  uspsDefaultHeightIn: doublePrecision("usps_default_height_in"),

  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertIntegrationSettingsSchema = createInsertSchema(integrationSettingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertIntegrationSettings = z.infer<typeof insertIntegrationSettingsSchema>;
export type IntegrationSettings = typeof integrationSettingsTable.$inferSelect;
