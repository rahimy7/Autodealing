import { serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Citas del módulo `appointments`. Es el destino que le faltaba al agente de
// reservas: hasta ahora recogía nombre, día y hora en la conversación y después
// escalaba a un humano, que lo anotaba fuera del sistema. Aquí aterriza.
//
// `pending` es la cita que el agente virtual acordó con el cliente y todavía
// nadie del equipo revisó; `confirmed` es la que ya se validó contra la agenda
// real. Se separan a propósito: una cita que la IA dio por hecha sin que nadie
// la mire no es lo mismo que una cita confirmada.
export const appointmentStatusEnum = pgEnum("appointment_status", [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]);

// Quién la creó. Sirve para saber cuánto de la agenda está llenando el agente
// virtual por su cuenta, que es justo lo que el cliente compra.
export const appointmentSourceEnum = pgEnum("appointment_source", ["ai", "agent", "admin"]);

export const appointmentsTable = pgTable(
  "appointments",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id").notNull(),
    // Conversación de la que salió la cita, cuando salió de un chat. Permite
    // volver al hilo desde la agenda para ver qué se acordó exactamente.
    conversationId: integer("conversation_id"),
    // Persona o recurso que atiende. Null = sin asignar todavía.
    agentId: integer("agent_id"),
    // Qué se va a atender ("Corte de cabello", "Asesoría técnica", "Visita").
    service: text("service").notNull(),
    notes: text("notes"),
    // Sucursal o dirección. Texto libre: cada cliente organiza sus sedes distinto.
    location: text("location"),
    startsAt: timestamp("starts_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    status: appointmentStatusEnum("status").notNull().default("pending"),
    source: appointmentSourceEnum("source").notNull().default("admin"),
    // Marca del recordatorio ya enviado, para no mandarlo dos veces si el
    // programador corre más de una vez dentro de la misma ventana.
    reminderSentAt: timestamp("reminder_sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // La agenda siempre se lee por rango de fechas, y la disponibilidad se
    // consulta en cada cita que agenda la IA: sin este índice ese chequeo hace
    // un recorrido completo de la tabla en mitad de la conversación.
    index("appointments_starts_at_idx").on(t.startsAt),
    index("appointments_contact_idx").on(t.contactId),
  ],
);

export const insertAppointmentSchema = createInsertSchema(appointmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointmentsTable.$inferSelect;
export type AppointmentStatus = (typeof appointmentStatusEnum.enumValues)[number];
