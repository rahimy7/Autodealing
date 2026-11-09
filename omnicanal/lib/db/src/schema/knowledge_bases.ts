import { serial, text, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A named knowledge document that can be linked to an agent capability. Its
// content is injected into the virtual agent's system prompt so the AI answers
// in line with it.
export const knowledgeBasesTable = pgTable("knowledge_bases", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  content: text("content").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertKnowledgeBaseSchema = createInsertSchema(knowledgeBasesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertKnowledgeBase = z.infer<typeof insertKnowledgeBaseSchema>;
export type KnowledgeBase = typeof knowledgeBasesTable.$inferSelect;
