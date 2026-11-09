import { serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";

// Una fila por instancia. Almacena los overrides que el portal super-admin puede
// cambiar en tiempo de ejecución, sin tocar las variables de entorno ni el código.
export const tenantOverridesTable = pgTable("tenant_overrides", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull(),

  // JSON de módulos. Si es null, se usan los del archivo de config estático.
  modulesJson: text("modules_json"),

  // JSON de branding (logoUrl, primaryColor, secondaryColor, accentColor, productName, tagline).
  brandingJson: text("branding_json"),

  // Suscripción
  subscriptionStatus: text("subscription_status").notNull().default("active"),
  subscriptionPaidUntil: timestamp("subscription_paid_until"),
  monthlyPrice: integer("monthly_price").notNull().default(0),

  // Bandera de bloqueo manual (independiente del estado de pago).
  blockedManually: boolean("blocked_manually").notNull().default(false),

  notes: text("notes"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type TenantOverrides = typeof tenantOverridesTable.$inferSelect;
export type InsertTenantOverrides = typeof tenantOverridesTable.$inferInsert;
