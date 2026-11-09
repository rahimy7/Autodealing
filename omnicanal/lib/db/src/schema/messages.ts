import { serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const messageSenderEnum = pgEnum("message_sender", ["contact", "agent", "bot"]);
export const messageTypeEnum = pgEnum("message_type", ["text", "image", "document", "audio", "video", "template"]);
// Solo importa para lo que salió de nuestro lado: "failed" es lo que Meta
// rechazó al enviarlo (canal apagado no cuenta como fallo, ese ni se marca) —
// típicamente la ventana de 24h cerrada. Los mensajes del cliente siempre
// quedan "sent", porque ya llegaron.
export const messageStatusEnum = pgEnum("message_status", ["sent", "failed"]);

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  sender: messageSenderEnum("sender").notNull(),
  content: text("content").notNull(),
  type: messageTypeEnum("type").notNull().default("text"),
  mediaUrl: text("media_url"),
  // Nombre original del archivo adjunto ("cotizacion.pdf"). El archivo guardado
  // lleva un nombre único que no le dice nada a nadie; este es el que se muestra.
  mediaName: text("media_name"),
  isAiSuggestion: boolean("is_ai_suggestion").notNull().default(false),
  // Panel-only audit note (routing, escalation, takeover, session closure). Never
  // delivered to the customer and never fed to the AI as conversation history.
  isInternal: boolean("is_internal").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),

  // ── Edición y borrado (solo dentro del panel) ────────────────────────────
  // Ni WhatsApp Cloud API, ni Messenger, ni Instagram permiten editar o borrar
  // para el cliente un mensaje que el negocio ya envió por su API; esas
  // acciones solo existen en las apps de consumidor. Por eso `content` (y
  // `mediaUrl`/`mediaName`) nunca se tocan: siguen siendo el mensaje tal como
  // salió o llegó de verdad, consultable directo por columna. Editar guarda el
  // texto nuevo aparte y borrar solo marca la bandera; ninguno de los dos
  // vuelve a escribirle a Meta.
  editedContent: text("edited_content"),
  isEdited: boolean("is_edited").notNull().default(false),
  isDeleted: boolean("is_deleted").notNull().default(false),
  editedAt: timestamp("edited_at"),
  deletedAt: timestamp("deleted_at"),
  // Quién lo hizo (FK a agents.id), para el rastro de auditoría. No es de quién
  // es el mensaje: eso no se guarda hoy, así que cualquiera con permiso para
  // escribir en la conversación puede editar o borrar dentro de ella.
  editedByAgentId: integer("edited_by_agent_id"),
  deletedByAgentId: integer("deleted_by_agent_id"),
  // Id del mensaje en el canal (wamid en WhatsApp, mid en Messenger/Instagram):
  // el que Meta le dio a uno nuestro al aceptarlo, o con el que llegó uno del
  // cliente. Null si nunca pasó por Meta. Es lo que permite citarlo al responder
  // y reconocer a qué mensaje contesta el cliente cuando cita uno.
  externalMessageId: text("external_message_id"),
  // El mensaje al que este responde (FK a messages.id), como la cita de WhatsApp.
  replyToMessageId: integer("reply_to_message_id"),
  // "failed" cuando Meta rechazó el envío (ventana de 24h cerrada, número
  // inválido, etc.) — es lo que pinta el iconito de fallido en el panel.
  status: messageStatusEnum("status").notNull().default("sent"),
  failedReason: text("failed_reason"),
}, (t) => [
  index("messages_external_message_id_idx").on(t.externalMessageId),
]);

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
