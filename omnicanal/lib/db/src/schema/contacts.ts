import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contactTagEnum = pgEnum("contact_tag", ["lead", "vip", "in_process", "support", "jovenes", "junta", "visitas", "miembros"]);

export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  metaProfileName: text("meta_profile_name"),
  instagramUsername: text("instagram_username"),
  // Channel-scoped sender id from Meta (wa_id / PSID / IGSID); used to dedupe inbound senders.
  externalId: text("external_id"),
  phone: text("phone"),
  email: text("email"),
  avatar: text("avatar"),
  company: text("company"),
  address: text("address"),
  city: text("city"),
  birthday: text("birthday"),
  tag: contactTagEnum("tag"),
  channels: text("channels").array().notNull().default([]),
  notes: text("notes"),
  // ── Commercial profile (built incrementally by the AI from conversations) ──
  // Short buyer status label, e.g. "prospecto" | "comprador" | "recurrente".
  buyerStatus: text("buyer_status"),
  interests: text("interests").array().notNull().default([]),
  // Free-form one-line description of the customer's purchase profile.
  purchaseProfile: text("purchase_profile"),
  totalConversations: integer("total_conversations").notNull().default(0),
  // Cuándo pidió no recibir más promociones ("No más promociones" en una
  // plantilla). Los seguimientos de marketing no le escriben; los de su pedido sí.
  marketingOptOutAt: timestamp("marketing_opt_out_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertContactSchema = createInsertSchema(contactsTable).omit({ id: true, createdAt: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;
