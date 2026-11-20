import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, appointmentsTable, conversationsTable, contactsTable, messagesTable } from "@workspace/db";
import type { Conversation } from "@workspace/db";
import { deliverConversationMessage, type Log } from "./messaging";
import { isModuleEnabled } from "./client-config";
import { APP_TIMEZONE } from "./time";

// Recordatorio de cita. La mitad del valor de una agenda es que la gente no
// falte, y el aviso solo sirve si sale sin que nadie se acuerde de mandarlo: lo
// dispara el scheduler que ya corre cada minuto.

/**
 * Con cuánta antelación se avisa. `0` apaga los recordatorios de la instancia.
 * Se lee del entorno para poder ajustarlo por cliente sin publicar una versión
 * del core.
 */
function leadHours(): number {
  const raw = Number(process.env["APPOINTMENT_REMINDER_HOURS"]);
  return Number.isFinite(raw) && raw >= 0 ? raw : 24;
}

/**
 * Antigüedad mínima de la reserva para que se le mande recordatorio. Sin esto,
 * una cita agendada para dentro de unas horas recibiría el recordatorio pegado
 * al mensaje de confirmación que el cliente acaba de leer.
 */
const MIN_BOOKING_AGE_MINUTES = 60;

// El recordatorio se cuenta como enviado aunque falle la entrega. Es deliberado:
// un recordatorio que se reintenta hasta que salga puede llegar cuando la cita
// ya pasó, y eso es peor que no llegar. El fallo queda en el log.
const REMINDABLE_STATUSES = ["pending", "confirmed"] as const;

/** Lo mínimo que hace falta para entregar por el canal del cliente. */
// Incluye el número por el que va la conversación: un recordatorio tiene que
// salir por el mismo número donde el cliente habló, igual que una respuesta.
type ReminderTarget = Pick<Conversation, "id" | "channel" | "externalId" | "whatsappNumberId">;

/** "el sábado 15 de agosto a las 3:00 p. m." */
export function formatReminderWhen(date: Date, timeZone: string = APP_TIMEZONE): string {
  const day = new Intl.DateTimeFormat("es-DO", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
  const time = new Intl.DateTimeFormat("es-DO", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `el ${day} a las ${time}`;
}

/** El texto que recibe el cliente. Separado para poder probarlo sin base de datos. */
export function buildReminderText(appointment: {
  contactName: string | null;
  service: string;
  startsAt: Date;
  location: string | null;
}): string {
  const firstName = appointment.contactName?.trim().split(/\s+/)[0];
  const where = appointment.location ? ` en ${appointment.location}` : "";
  // Sin nombre el saludo desaparece, y entonces la frase tiene que empezar en
  // mayúscula: "te recordamos…" en minúscula abriría el mensaje.
  const opening = firstName ? `Hola ${firstName}, te` : "Te";

  return (
    `${opening} recordamos tu cita de ${appointment.service} ` +
    `${formatReminderWhen(appointment.startsAt)}${where}. ` +
    "Si no puedes asistir, avísanos por aquí."
  );
}

/**
 * Manda los recordatorios que tocan y los marca. Idempotente: una cita ya
 * recordada tiene `reminderSentAt` y no vuelve a entrar en la selección, así que
 * el tick del scheduler puede repetirse sin duplicar avisos.
 */
export async function sweepAppointmentReminders(log: Log): Promise<void> {
  if (!isModuleEnabled("appointments")) return;

  const hours = leadHours();
  if (hours === 0) return;

  const now = new Date();
  const windowEnd = new Date(now.getTime() + hours * 3_600_000);

  const due = await db
    .select({
      id: appointmentsTable.id,
      contactId: appointmentsTable.contactId,
      conversationId: appointmentsTable.conversationId,
      service: appointmentsTable.service,
      location: appointmentsTable.location,
      startsAt: appointmentsTable.startsAt,
      contactName: contactsTable.name,
    })
    .from(appointmentsTable)
    .leftJoin(contactsTable, eq(appointmentsTable.contactId, contactsTable.id))
    .where(
      and(
        inArray(appointmentsTable.status, [...REMINDABLE_STATUSES]),
        isNull(appointmentsTable.reminderSentAt),
        // Una cita del sitio sin contacto en el CRM todavía no tiene a quién avisar:
        // se deja sin marcar, para que reciba su recordatorio cuando el sitio la
        // enlace con el contacto.
        isNotNull(appointmentsTable.contactId),
        // `startsAt` lo escribe la aplicación, así que se compara con fechas de
        // la aplicación.
        gt(appointmentsTable.startsAt, now),
        lte(appointmentsTable.startsAt, windowEnd),
        // `createdAt` NO: lo pone Postgres con su propio reloj. La resta se hace en
        // SQL para que los dos lados sean del mismo reloj y una cita recién
        // reservada no reciba el recordatorio pegado a su confirmación.
        sql`${appointmentsTable.createdAt} <= now() - ${sql.raw(`interval '${MIN_BOOKING_AGE_MINUTES} minutes'`)}`,
      ),
    );

  for (const appointment of due) {
    const text = buildReminderText(appointment);
    const conversation = await resolveConversation(appointment.conversationId, appointment.contactId);

    if (!conversation) {
      // Cita creada desde el panel para alguien que nunca escribió: no hay canal
      // por donde avisarle. Se marca igual para no volver a intentarlo cada minuto.
      log.info(
        { appointmentId: appointment.id, contactId: appointment.contactId },
        "recordatorio omitido: el contacto no tiene conversación por donde avisarle",
      );
      await markReminded(appointment.id);
      continue;
    }

    await deliverConversationMessage(conversation, text, log);

    // Queda en el hilo para que el equipo vea qué se le dijo al cliente, igual
    // que cualquier mensaje del agente virtual.
    await db.insert(messagesTable).values({
      conversationId: conversation.id,
      sender: "bot",
      content: text,
      type: "text",
      isAiSuggestion: false,
    });
    await db
      .update(conversationsTable)
      .set({ lastMessage: text, updatedAt: new Date() })
      .where(eq(conversationsTable.id, conversation.id));

    await markReminded(appointment.id);

    log.info(
      { appointmentId: appointment.id, conversationId: conversation.id, startsAt: appointment.startsAt },
      "recordatorio de cita enviado",
    );
  }
}

async function markReminded(appointmentId: number): Promise<void> {
  await db
    .update(appointmentsTable)
    .set({ reminderSentAt: new Date(), updatedAt: new Date() })
    .where(eq(appointmentsTable.id, appointmentId));
}

/**
 * Por dónde avisarle. Si la cita salió de un chat se responde en ese mismo hilo;
 * si la creó el equipo desde el panel se usa la conversación más reciente del
 * contacto, que es donde el cliente va a leer.
 */
async function resolveConversation(
  conversationId: number | null,
  contactId: number,
): Promise<ReminderTarget | null> {
  if (conversationId != null) {
    const [row] = await db
      .select({
        id: conversationsTable.id,
        channel: conversationsTable.channel,
        externalId: conversationsTable.externalId,
        whatsappNumberId: conversationsTable.whatsappNumberId,
      })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId))
      .limit(1);
    if (row) return row;
  }

  const [latest] = await db
    .select({
      id: conversationsTable.id,
      channel: conversationsTable.channel,
      externalId: conversationsTable.externalId,
      whatsappNumberId: conversationsTable.whatsappNumberId,
    })
    .from(conversationsTable)
    .where(eq(conversationsTable.contactId, contactId))
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(1);

  return latest ?? null;
}
