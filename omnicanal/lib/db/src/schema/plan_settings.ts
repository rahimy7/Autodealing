import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Single-row table (id = 1) holding the active plan's name, price and configurable
// usage limits. Real usage is computed on read from messages/agents.
export const planSettingsTable = pgTable("plan_settings", {
  id: serial("id").primaryKey(),
  planName: text("plan_name").notNull().default("Plan Mensual"),
  monthlyPrice: integer("monthly_price").notNull().default(300),
  messagesLimit: integer("messages_limit").notNull().default(1000),
  agentsLimit: integer("agents_limit").notNull().default(5),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPlanSettingsSchema = createInsertSchema(planSettingsTable).omit({ id: true, updatedAt: true });
export type InsertPlanSettings = z.infer<typeof insertPlanSettingsSchema>;
export type PlanSettings = typeof planSettingsTable.$inferSelect;
