import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const channelEnum = pgEnum("channel", ["whatsapp", "instagram", "facebook"]);
export const conversationStatusEnum = pgEnum("conversation_status", ["open", "resolved", "bot", "pending"]);
export const conversationLabelEnum = pgEnum("conversation_label", ["lead", "vip", "in_process", "support"]);

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  channel: channelEnum("channel").notNull(),
  status: conversationStatusEnum("status").notNull().default("open"),
  contactId: integer("contact_id").notNull(),
  agentId: integer("agent_id"),
  // Channel-scoped recipient id used to deliver outbound replies via Meta
  // (WhatsApp phone / Messenger PSID / Instagram IGSID). Null for internal/demo convos.
  externalId: text("external_id"),
  // El número de la instancia por el que entró esta conversación (FK a
  // whatsapp_numbers.id). Es lo que hace que la respuesta salga por el mismo
  // número que recibió el mensaje, en vez de por uno fijo.
  //
  // Null en Instagram y Facebook, que tienen una sola cuenta por instancia, y en
  // las conversaciones anteriores a la tabla de números: en ese caso el envío cae
  // al número principal, que es exactamente el comportamiento que tenían.
  whatsappNumberId: integer("whatsapp_number_id"),
  // Legacy fixed-enum intent label, kept for backward compatibility.
  label: conversationLabelEnum("label"),
  // Dynamic intent label (FK to labels.id). Assigned by the AI intent classifier
  // and used by the workflow engine to route/escalate the conversation.
  labelId: integer("label_id"),
  // Locality label (FK to labels.id, kind "locality"): the branch this customer
  // belongs to, resolved from the zone they gave. Kept apart from `labelId`
  // because the two answer different questions — what they want vs. where they
  // are — and a handoff needs both.
  localityLabelId: integer("locality_label_id"),
  // Group (FK to agent_groups.id) the conversation was routed to. Set when a
  // workflow escalates to a group; with the "manual" rule it stays queued here
  // (agentId null, status pending) until a supervisor assigns a member.
  groupId: integer("group_id"),
  // Running AI summary of the CURRENT session only, used to give the agent context
  // beyond the last few raw messages.
  contextSummary: text("context_summary"),
  // Condensed summaries of previous CLOSED sessions of this same chat. Handed to
  // the agent as background reference only — never as the thread it is continuing.
  historySummary: text("history_summary"),
  // Start of the current session. Everything older belongs to a closed conversation
  // and is excluded from the agent's working history.
  sessionStartedAt: timestamp("session_started_at").notNull().defaultNow(),
  // When the current session was closed (by inactivity or by resolving it). While
  // set, the next inbound message opens a brand-new session.
  closedAt: timestamp("closed_at"),
  // Cuándo escribió el cliente por última vez. Es lo que abre y cierra la
  // ventana de 24h de Meta para mensajes libres: pasadas 24h desde esta fecha,
  // el canal solo acepta una plantilla aprobada. Se actualiza en cada mensaje
  // entrante real (ingestInboundMessage) y en el simulado desde el panel.
  lastCustomerMessageAt: timestamp("last_customer_message_at"),
  // La venta de la sesión actual. La marca el agente humano con "Venta cerrada"
  // (source "agent") o la IA al leer el chat cerrado (source "ai"); la del humano
  // manda. Decide si al cerrar entra el agente de ventas o arranca el post-venta.
  // Se limpia al abrirse una sesión nueva: cada conversación tiene su venta.
  saleClosedAt: timestamp("sale_closed_at"),
  saleProduct: text("sale_product"),
  saleSource: text("sale_source"), // agent | ai
  saleMarkedByAgentId: integer("sale_marked_by_agent_id"),
  // El seguimiento (FK a followups.id) al que el cliente está respondiendo en esta
  // sesión. Mientras esté puesto, el agente de ese seguimiento lleva la
  // conversación y el flujo no la re-enruta por etiqueta.
  followupId: integer("followup_id"),
  lastMessage: text("last_message"),
  unreadCount: integer("unread_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertConversationSchema = createInsertSchema(conversationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversationsTable.$inferSelect;
