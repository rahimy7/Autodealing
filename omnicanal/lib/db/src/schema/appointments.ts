import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Citas del módulo `appointments`. Es el destino que le faltaba al agente de
// reservas: hasta ahora recogía nombre, día y hora en la conversación y después
// escalaba a un humano, que lo anotaba fuera del sistema. Aquí aterriza.
//
// UNA SOLA AGENDA. Esta no es una tabla de Omnicanal: es `appointments` del sitio
// de Premier (esquema "public" de la misma base), la que usan sus vendedores desde
// el panel y la app de ventas. Omnicanal la lee y la escribe tal cual, así que una
// cita que agenda la IA por WhatsApp y una que anota un vendedor son la misma fila,
// con los mismos choques de horario y el mismo recordatorio. Por eso no usa el
// `pgTable` de ./pg-schema (esquema "omnicanal"): el sitio es quien crea y migra
// esta tabla (server/schema.sql) y drizzle-kit solo mira el esquema de Omnicanal
// (schemaFilter), de modo que nunca la toca. Los nombres de columna son los del
// sitio; `id` es su `omni_appointment_id`, un número que cada fila recibe sola.
//
// `pending` es la cita que el agente virtual acordó con el cliente y todavía
// nadie del equipo revisó; `confirmed` es la que ya se validó contra la agenda
// real. Se separan a propósito: una cita que la IA dio por hecha sin que nadie
// la mire no es lo mismo que una cita confirmada.
export const appointmentStatusValues = ["pending", "confirmed", "cancelled", "completed", "no_show"] as const;
export type AppointmentStatus = (typeof appointmentStatusValues)[number];

// Quién la creó. Sirve para saber cuánto de la agenda está llenando el agente
// virtual por su cuenta, que es justo lo que el cliente compra.
export const appointmentSourceValues = ["ai", "agent", "admin"] as const;
export type AppointmentSource = (typeof appointmentSourceValues)[number];

export const appointmentsTable = pgTable("appointments", {
  id: serial("omni_appointment_id").notNull(),
  // Contacto del CRM. En la base puede faltar (una cita del sitio cuyo contacto
  // aún no se creó en Omnicanal); las consultas lo tratan como `number` y
  // `serialize` lo vuelve 0 cuando no existe. Ver lib/appointments.ts.
  contactId: integer("omni_contact_id").notNull(),
  // Conversación de la que salió la cita, cuando salió de un chat. Permite
  // volver al hilo desde la agenda para ver qué se acordó exactamente.
  conversationId: integer("omni_conversation_id"),
  // Persona o recurso que atiende. Null = sin asignar todavía. Un disparador de
  // la base lo mantiene alineado con el vendedor del sitio (`seller_id`).
  agentId: integer("agent_id"),
  // Qué se va a atender ("Corte de cabello", "Asesoría técnica", "Visita").
  service: text("service").notNull(),
  notes: text("notes"),
  // Sucursal o dirección. Texto libre: cada cliente organiza sus sedes distinto.
  location: text("location"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  status: text("status").$type<AppointmentStatus>().notNull().default("confirmed"),
  source: text("source").$type<AppointmentSource>().notNull().default("admin"),
  // Marca del recordatorio ya enviado, para no mandarlo dos veces si el
  // programador corre más de una vez dentro de la misma ventana.
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Datos del cliente tal como los anotó el sitio. Si la cita no tiene contacto
  // en el CRM, la agenda muestra estos. Un disparador los completa con los del
  // contacto cuando la cita nace aquí.
  customerName: text("customer_name").notNull().default(""),
  customerPhone: text("customer_phone").notNull().default(""),
});

export const insertAppointmentSchema = createInsertSchema(appointmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointmentsTable.$inferSelect;
