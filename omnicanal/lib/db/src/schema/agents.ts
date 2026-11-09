import { serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentStatusEnum = pgEnum("agent_status", ["online", "busy", "offline"]);
export const agentTypeEnum = pgEnum("agent_type", ["human", "virtual"]);
// Role of a human user in the system. Virtual agents always keep the default "agent".
export const agentRoleEnum = pgEnum("agent_role", ["admin", "agent"]);

export const agentsTable = pgTable("agents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  avatar: text("avatar"),
  // scrypt password hash for human agents who log in. Null for virtual agents
  // and for humans whose password has not been set yet. Never returned by the API.
  passwordHash: text("password_hash"),
  status: agentStatusEnum("status").notNull().default("offline"),
  activeChats: integer("active_chats").notNull().default(0),
  channels: text("channels").array().notNull().default([]),
  // Virtual agent fields (null for human agents)
  type: agentTypeEnum("type").notNull().default("human"),
  // Access role for human users. Virtual agents always keep "agent".
  role: agentRoleEnum("role").notNull().default("agent"),
  profileType: text("profile_type"), // sales | support | reservations | qualifier | general
  systemPrompt: text("system_prompt"),
  model: text("model"), // e.g. "gpt-5-mini"
  escalateToAgentId: integer("escalate_to_agent_id"),
  // When a virtual agent can't help, it can escalate to a whole human group
  // (distribution rules pick the member). Takes precedence over escalateToAgentId.
  escalateToGroupId: integer("escalate_to_group_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({ id: true, createdAt: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;
