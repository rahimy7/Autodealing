import { text, integer, timestamp, customType } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// Archivos de los mensajes (fotos y notas de voz de los clientes, imágenes de las bienvenidas y
// de las campañas, documentos) cuando la instancia no tiene una cuenta de Supabase Storage:
// api-server/src/lib/supabase.ts los guarda aquí con la misma interfaz que el bucket. Con
// Supabase configurado esta tabla no se usa.
export const mediaObjectsTable = pgTable("media_objects", {
  // El mismo nombre que tendría en el bucket ("custom-oferta-1a2b.jpeg", "chat-12-9f3c.pdf").
  path: text("path").primaryKey(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type MediaObject = typeof mediaObjectsTable.$inferSelect;
