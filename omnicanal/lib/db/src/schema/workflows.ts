import { serial, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { channelEnum } from "./conversations";

// A node in the visual escalation flow. Rendered/edited with reactflow on the
// frontend; interpreted by the workflow engine on the backend.
export type WorkflowNodeKind = "start" | "label" | "agent" | "group" | "escalation" | "trigger";

// Lo que dispara un nodo "trigger". A diferencia de "label", que enruta el
// mensaje que acaba de entrar, un disparador programa una gestión proactiva que
// ejecuta el agente virtual conectado a él:
//   - closed_no_sale: el chat cerró con una de `labelIds` y sin venta.
//   - sale_closed:    el chat terminó en venta → secuencia de post-venta.
//   - unanswered:     el cliente lleva `delayHours` sin respuesta del equipo.
export type WorkflowTriggerEvent = "closed_no_sale" | "sale_closed" | "unanswered";

export type WorkflowNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: {
    kind: WorkflowNodeKind;
    title?: string | null;
    labelId?: number | null;
    agentId?: number | null;
    groupId?: number | null;
    // Solo en nodos "trigger".
    event?: WorkflowTriggerEvent | null;
    labelIds?: number[] | null;
    delayHours?: number | null;
    deliveryDays?: number | null;
    satisfactionDays?: number | null;
    repurchaseDays?: number | null;
  };
};
export type WorkflowEdge = { id: string; source: string; target: string };
export type WorkflowGraph = { nodes: WorkflowNode[]; edges: WorkflowEdge[] };

// An escalation flow: given the intent label detected on a conversation, the graph
// decides which agent/group handles it. `channels` is the set of channels the flow
// applies to; null/empty means it applies to every channel (a "general" flow). A
// flow that lists a channel takes precedence over a general one for that channel.
// Several active flows may target the same channel as long as each one covers a
// different intent label (one flow per use-case), so they never compete — see the
// (channel, label) conflict guard in routes/workflows.ts.
export const workflowsTable = pgTable("workflows", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  channels: channelEnum("channels").array(),
  isActive: boolean("is_active").notNull().default(true),
  graph: jsonb("graph")
    .$type<WorkflowGraph>()
    .notNull()
    .default(sql`'{"nodes":[],"edges":[]}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWorkflowSchema = createInsertSchema(workflowsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWorkflow = z.infer<typeof insertWorkflowSchema>;
export type Workflow = typeof workflowsTable.$inferSelect;
