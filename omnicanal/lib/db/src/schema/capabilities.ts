import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A skill an agent (human or virtual) can handle. For virtual agents it extends
// what the AI does and can link a knowledge base; for humans it feeds the
// "by capability" group distribution rule.
export const capabilitiesTable = pgTable("capabilities", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  knowledgeBaseId: integer("knowledge_base_id"),
  // Structured fields that give the capability better shape. category + keywords
  // sharpen the "by capability" group routing; examples + level enrich the AI prompt.
  category: text("category"), // e.g. producto | ventas | soporte | proceso | general
  keywords: text("keywords").array().notNull().default([]),
  examples: text("examples"),
  level: text("level"), // básico | intermedio | experto
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCapabilitySchema = createInsertSchema(capabilitiesTable).omit({ id: true, createdAt: true });
export type InsertCapability = z.infer<typeof insertCapabilitySchema>;
export type Capability = typeof capabilitiesTable.$inferSelect;
