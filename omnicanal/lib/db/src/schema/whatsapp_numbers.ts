import { serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Los números de WhatsApp por los que atiende esta instancia. Antes había uno
// solo, guardado en la fila única de integration_settings; esta tabla lo
// convierte en una lista para que un mismo negocio pueda tener Ventas, Soporte y
// Mayoreo sobre la misma bandeja.
//
// integration_settings sigue siendo el dueño de lo compartido —el App Secret, el
// token, el WABA— y aquí solo vive lo que distingue a un número de otro.
export const whatsappNumbersTable = pgTable("whatsapp_numbers", {
  id: serial("id").primaryKey(),

  // El Phone Number ID de Meta. Es la clave de todo el mecanismo: el webhook lo
  // trae en `value.metadata.phone_number_id` y es lo que permite saber a qué
  // número escribió el cliente. Único porque un mismo número no puede estar dado
  // de alta dos veces: el upsert de la pantalla de configuración se apoya en eso.
  phoneNumberId: text("phone_number_id").notNull().unique(),

  // El número tal como lo ve el cliente (+1 809 555 0100) y el nombre verificado
  // que Meta tiene aprobado. Los dos llegan del descubrimiento contra la WABA.
  displayNumber: text("display_number"),
  verifiedName: text("verified_name"),

  // El nombre interno que le pone el negocio ("Ventas", "Soporte"). Es lo que se
  // muestra en la bandeja, porque a un agente le dice mucho más que el número.
  label: text("label"),

  // Token propio de este número. Casi siempre `null`: los números de una misma
  // WABA comparten el token de integration_settings. Existe para el caso de
  // números que cuelgan de otra WABA o de otra app de Meta, que necesitan el
  // suyo. `null` significa "usa el compartido", no "no tiene".
  accessToken: text("access_token"),

  // El número por el que sale lo que no tiene conversación de la cual deducirlo:
  // una campaña sin número elegido, o un mensaje que abre el negocio. Solo uno
  // debería tenerlo en true; la ruta que guarda la lista se encarga de eso.
  isPrimary: boolean("is_primary").notNull().default(false),

  // Apagar un número sin borrarlo: sus conversaciones y su historial se quedan,
  // pero deja de usarse para enviar y desaparece de los selectores.
  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWhatsappNumberSchema = createInsertSchema(whatsappNumbersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWhatsappNumber = z.infer<typeof insertWhatsappNumberSchema>;
export type WhatsappNumber = typeof whatsappNumbersTable.$inferSelect;
