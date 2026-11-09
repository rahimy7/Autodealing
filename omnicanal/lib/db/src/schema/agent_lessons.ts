import { serial, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Memoria de aprendizaje de los agentes virtuales (lib/agent-learning.ts). Dos
// señales dicen que una respuesta del agente no fue la adecuada:
//   - frustration:      el cliente reacciona molesto (repite la pregunta, dice que
//                       no le entienden, pide una persona, contesta seco).
//   - human_correction: una persona del equipo entra justo después del agente y
//                       contesta distinto a lo mismo — la comparación entre lo que
//                       dijo el bot y lo que dijo la persona es la lección.
// Cada caso queda como evidencia y la IA redacta la lección: una regla corta que
// el agente puede seguir la próxima vez. Las parecidas se suman en vez de
// duplicarse.
//
//   - suggested: vista una vez; el equipo la revisa en Aprendizajes.
//   - active:    el agente la lee en su prompt. Pasa sola a activa cuando se
//                repite en otra conversación, o la activa el equipo a mano.
//   - dismissed: el equipo la descartó; si vuelve a pasar, suma evidencia a
//                esta misma y no se reactiva sola.
export const agentLessonStatusEnum = pgEnum("agent_lesson_status", ["suggested", "active", "dismissed"]);

export const agentLessonsTable = pgTable(
  "agent_lessons",
  {
    id: serial("id").primaryKey(),
    // La regla, en imperativo, tal como la lee el agente.
    lesson: text("lesson").notNull(),
    // Qué hizo mal el agente, para el equipo.
    diagnosis: text("diagnosis"),
    status: agentLessonStatusEnum("status").notNull().default("suggested"),
    // En cuántas conversaciones distintas se vio.
    occurrences: integer("occurrences").notNull().default(1),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("agent_lessons_status_idx").on(t.status)],
);

// La evidencia: la respuesta del agente y la reacción (del cliente o de la persona
// del equipo que lo corrigió), lado a lado, para comparar lo que se dijo con cómo
// cayó.
export const agentFeedbackTable = pgTable(
  "agent_feedback",
  {
    id: serial("id").primaryKey(),
    lessonId: integer("lesson_id"),
    conversationId: integer("conversation_id").notNull(),
    contactId: integer("contact_id"),
    // El agente virtual a cargo cuando respondió.
    agentId: integer("agent_id"),
    // "frustration" | "human_correction"
    signal: text("signal").notNull(),
    botMessageId: integer("bot_message_id"),
    // El mensaje que delata el problema: el del cliente molesto o el de la
    // persona que contestó distinto. Se evalúa una sola vez.
    reactionMessageId: integer("reaction_message_id").notNull(),
    severity: text("severity").notNull().default("low"),
    aiReply: text("ai_reply").notNull(),
    reaction: text("reaction").notNull(),
    diagnosis: text("diagnosis"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("agent_feedback_lesson_idx").on(t.lessonId),
    index("agent_feedback_conversation_idx").on(t.conversationId),
    uniqueIndex("agent_feedback_once_per_message").on(t.reactionMessageId),
  ],
);

export const insertAgentLessonSchema = createInsertSchema(agentLessonsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAgentLesson = z.infer<typeof insertAgentLessonSchema>;
export type AgentLesson = typeof agentLessonsTable.$inferSelect;
export type AgentFeedback = typeof agentFeedbackTable.$inferSelect;
export type AgentLessonStatus = AgentLesson["status"];
