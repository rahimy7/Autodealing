import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";

// Un adjunto que alguien seleccionó para un correo saliente, antes de que ese
// correo exista: se sube en cuanto se elige el archivo (para que la barra de
// progreso sea inmediata) y se referencia por id al responder, redactar o
// aprobar un borrador. Al enviar, el archivo se descarga de aquí, se adjunta al
// MIME y esta fila se borra junto con su blob; si el envío nunca ocurre (el
// usuario cierra sin mandar), el scheduler la purga a las 24 horas.
export const emailStagedAttachmentsTable = pgTable("email_staged_attachments", {
  id: serial("id").primaryKey(),
  storagePath: text("storage_path").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type EmailStagedAttachment = typeof emailStagedAttachmentsTable.$inferSelect;
