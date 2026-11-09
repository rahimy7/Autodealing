import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A discrete, relevant profile datum about a contact (e.g. "Proyecto": "Pintar
// fachada de 120m²"). The AI adds one only when it detects something relevant, so
// that when the agent talks to the contact it can consult these facts.
export const contactFactsTable = pgTable("contact_facts", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull(),
  label: text("label").notNull(),
  value: text("value").notNull(),
  source: text("source").notNull().default("ai"), // "ai" | "manual"
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertContactFactSchema = createInsertSchema(contactFactsTable).omit({ id: true, createdAt: true });
export type InsertContactFact = z.infer<typeof insertContactFactSchema>;
export type ContactFact = typeof contactFactsTable.$inferSelect;
