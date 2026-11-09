import { serial, text, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";

// Los errores del servidor, guardados para que el administrador los vea desde el
// panel. Antes vivían solo en la salida del proceso: averiguar por qué un mensaje
// no entró obligaba a entrar al hosting y rebuscar entre miles de líneas, y quien
// no tiene acceso ahí no podía ni mirar. Un barrido los borra a los 14 días para
// que la tabla no crezca sin freno.
export const errorLogsTable = pgTable("error_logs", {
  id: serial("id").primaryKey(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  // El contexto que acompañaba al error (el fallo, sus identificadores, el cuerpo
  // que no se pudo procesar) en JSON y recortado. Las claves y tokens no se
  // guardan: un registro de errores no es sitio para secretos.
  detail: text("detail"),
  requestId: text("request_id"),
  method: text("method"),
  url: text("url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ErrorLog = typeof errorLogsTable.$inferSelect;
