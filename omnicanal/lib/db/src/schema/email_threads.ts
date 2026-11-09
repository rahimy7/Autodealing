import { serial, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailThreadStatusEnum = pgEnum("email_thread_status", ["open", "resolved"]);

// Un hilo de Gmail con un cliente: el primer correo que nos escribe y todo lo que
// se responde debajo. Se identifica por el threadId de Gmail, que es lo que
// mantiene juntas las respuestas también en el buzón del cliente.
//
// El contacto es el mismo registro que usan WhatsApp, Instagram y Facebook: el
// correo es solo otra vía para llegar a la misma persona.
export const emailThreadsTable = pgTable(
  "email_threads",
  {
    id: serial("id").primaryKey(),
    gmailThreadId: text("gmail_thread_id").notNull(),
    contactId: integer("contact_id"),
    // Agente virtual que redacta los borradores. Se asigna al abrir el hilo.
    agentId: integer("agent_id"),
    status: emailThreadStatusEnum("status").notNull().default("open"),
    subject: text("subject"),
    // La dirección del cliente con quien es el hilo, la que abrió la conversación.
    customerEmail: text("customer_email").notNull(),
    // Etiqueta de intención del último correo del cliente (FK a labels.id).
    labelId: integer("label_id"),
    lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
    lastMessagePreview: text("last_message_preview"),
    unreadCount: integer("unread_count").notNull().default(0),
    // Cuándo se trajo el hilo completo de Gmail. La sincronización lee mensajes
    // sueltos de la bandeja; lo anterior del hilo (lo que contestamos desde
    // Gmail, lo archivado, lo más viejo) llega con esa lectura. Null: pendiente.
    historySyncedAt: timestamp("history_synced_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    gmailThreadUnique: uniqueIndex("email_threads_gmail_thread_unique").on(t.gmailThreadId),
    contactIdx: index("email_threads_contact_idx").on(t.contactId),
  }),
);

export const insertEmailThreadSchema = createInsertSchema(emailThreadsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEmailThread = z.infer<typeof insertEmailThreadSchema>;
export type EmailThread = typeof emailThreadsTable.$inferSelect;
