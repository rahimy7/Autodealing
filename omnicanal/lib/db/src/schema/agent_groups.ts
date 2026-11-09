import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// How conversations escalated to a group get distributed among its human members.
export const groupDistributionRuleEnum = pgEnum("group_distribution_rule", [
  "round_robin", // rotate through members in order
  "least_busy", // member with the fewest active conversations
  "by_capability", // member whose capabilities match the conversation's intent label
  "manual", // leave in the group queue for a supervisor to assign
]);

export const agentGroupsTable = pgTable("agent_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  distributionRule: groupDistributionRuleEnum("distribution_rule").notNull().default("round_robin"),
  // round-robin cursor, advanced each time the group hands out a conversation
  rotationIndex: integer("rotation_index").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAgentGroupSchema = createInsertSchema(agentGroupsTable).omit({ id: true, createdAt: true });
export type InsertAgentGroup = z.infer<typeof insertAgentGroupSchema>;
export type AgentGroup = typeof agentGroupsTable.$inferSelect;

export const agentGroupMembersTable = pgTable("agent_group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  agentId: integer("agent_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAgentGroupMemberSchema = createInsertSchema(agentGroupMembersTable).omit({ id: true, createdAt: true });
export type InsertAgentGroupMember = z.infer<typeof insertAgentGroupMemberSchema>;
export type AgentGroupMember = typeof agentGroupMembersTable.$inferSelect;
