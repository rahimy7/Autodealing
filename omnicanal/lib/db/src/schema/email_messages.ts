import { serial, text, integer, boolean, timestamp, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailDirectionEnum = pgEnum("email_direction", ["in", "out"]);

// Lo que se guarda de un adjunto. El archivo en sí se queda en Gmail y se pide al
// descargarlo: `partId` es estable dentro del mensaje, a diferencia del
// attachmentId, que Gmail puede cambiar entre lecturas.
export type EmailAttachment = {
  partId: string;
  filename: string;
  mimeType: string;
  size: number;
};

export const emailMessagesTable = pgTable(
  "email_messages",
  {
    id: serial("id").primaryKey(),
    threadId: integer("thread_id").notNull(),
    // Id del mensaje en Gmail. Null solo en borradores que aún no se enviaron.
    gmailMessageId: text("gmail_message_id"),
    // Cabecera Message-ID: la que se cita en In-Reply-To para que la respuesta
    // quede en el mismo hilo en el buzón del cliente.
    rfcMessageId: text("rfc_message_id"),
    references: text("references"),
    direction: emailDirectionEnum("direction").notNull(),
    fromAddress: text("from_address"),
    fromName: text("from_name"),
    toAddresses: text("to_addresses").array().notNull().default([]),
    ccAddresses: text("cc_addresses").array().notNull().default([]),
    replyTo: text("reply_to"),
    subject: text("subject"),
    bodyText: text("body_text").notNull().default(""),
    bodyHtml: text("body_html"),
    attachments: jsonb("attachments").$type<EmailAttachment[]>().notNull().default([]),
    // Agente (virtual o humano) que redactó o aprobó la respuesta.
    authorAgentId: integer("author_agent_id"),
    isDraft: boolean("is_draft").notNull().default(false),
    isAiSuggestion: boolean("is_ai_suggestion").notNull().default(false),
    // Nota del panel (vínculo de contacto, escalado) que nunca sale por correo.
    isInternal: boolean("is_internal").notNull().default(false),
    // Fecha del correo: la cabecera Date al recibir, el momento del envío al salir.
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    gmailMessageUnique: uniqueIndex("email_messages_gmail_message_unique").on(t.gmailMessageId),
    threadIdx: index("email_messages_thread_idx").on(t.threadId),
  }),
);

export const insertEmailMessageSchema = createInsertSchema(emailMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertEmailMessage = z.infer<typeof insertEmailMessageSchema>;
export type EmailMessage = typeof emailMessagesTable.$inferSelect;
