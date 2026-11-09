import { serial, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Qué gestión es. Cada una la dispara un nodo "trigger" de un workflow y la
// ejecuta el agente virtual conectado a ese nodo:
//   - winback:        el chat cerró en Saludo/Ventas sin venta → agente de ventas.
//   - delivery_check: post-venta, ¿recibió el pedido?
//   - satisfaction:   post-venta, ¿cómo le fue?
//   - repurchase:     post-venta, recordatorio de recompra.
//   - unanswered:     el cliente escribió y nadie le contestó → atención al cliente.
export const followupKindEnum = pgEnum("followup_kind", [
  "winback",
  "delivery_check",
  "satisfaction",
  "repurchase",
  "unanswered",
]);

// scheduled → sent → replied es el camino feliz. skipped/cancelled no llegaron a
// salir por una razón que queda en `detail` (el cliente volvió a escribir, se dio
// de baja, alguien lo canceló desde el chat); failed es que Meta lo rechazó.
export const followupStatusEnum = pgEnum("followup_status", [
  "scheduled",
  "sent",
  "replied",
  "skipped",
  "cancelled",
  "failed",
]);

export const followupsTable = pgTable(
  "followups",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull(),
    contactId: integer("contact_id").notNull(),
    // El agente virtual que escribe y que atiende la respuesta del cliente.
    agentId: integer("agent_id"),
    // El flujo cuyo disparador lo programó: si se apaga, lo pendiente se cancela.
    workflowId: integer("workflow_id"),
    kind: followupKindEnum("kind").notNull(),
    status: followupStatusEnum("status").notNull().default("scheduled"),
    dueAt: timestamp("due_at").notNull(),
    // Veces que se pospuso (chat en curso, plantilla aún sin aprobar).
    attempts: integer("attempts").notNull().default(0),
    // El producto de la venta o del interés, cuando se sabe. Va en la plantilla.
    product: text("product"),
    // Lo que el agente necesita saber para escribir y para seguir la conversación
    // cuando el cliente conteste: el análisis del chat que lo motivó.
    context: text("context"),
    // La sesión de la conversación a la que pertenece. Junto con el tipo, impide
    // programar dos veces la misma gestión para la misma conversación.
    sessionStartedAt: timestamp("session_started_at").notNull(),
    templateName: text("template_name"),
    messageId: integer("message_id"),
    sentAt: timestamp("sent_at"),
    repliedAt: timestamp("replied_at"),
    detail: text("detail"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("followups_due_idx").on(t.status, t.dueAt),
    index("followups_conversation_idx").on(t.conversationId),
    uniqueIndex("followups_once_per_session").on(t.conversationId, t.kind, t.sessionStartedAt),
  ],
);

export const insertFollowupSchema = createInsertSchema(followupsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFollowup = z.infer<typeof insertFollowupSchema>;
export type Followup = typeof followupsTable.$inferSelect;
export type FollowupKind = Followup["kind"];
