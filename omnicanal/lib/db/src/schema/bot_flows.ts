import { serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botFlowsTable = pgTable("bot_flows", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  trigger: text("trigger").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  channels: text("channels").array().notNull().default([]),
  stepCount: integer("step_count").notNull().default(0),
  handoffToAgent: boolean("handoff_to_agent").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBotFlowSchema = createInsertSchema(botFlowsTable).omit({ id: true, createdAt: true });
export type InsertBotFlow = z.infer<typeof insertBotFlowSchema>;
export type BotFlow = typeof botFlowsTable.$inferSelect;
