import { and, asc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db, appointmentsTable, contactsTable, agentsTable } from "@workspace/db";
import type { Appointment, AppointmentStatus } from "@workspace/db";

// Lógica de agenda compartida por las rutas y por el agente virtual. Vive aquí
// y no en el router porque la IA agenda desde messaging.ts: si la comprobación
// de solapamiento estuviera dentro del handler HTTP, el agente podría reservar
// encima de una cita existente por el simple hecho de no pasar por la ruta.

/** Una cita con el nombre del contacto y del agente ya resueltos. */
// Los datos del cliente anotados por el sitio no salen aparte: se resumen en `contactName` y
// `contactPhone` (ver `selection`).
export interface AppointmentView extends Omit<Appointment, "customerName" | "customerPhone"> {
  contactName: string | null;
  contactPhone: string | null;
  agentName: string | null;
}

// Una cita cancelada libera su hueco; el resto de estados lo ocupan.
const BLOCKING_STATUSES = ["pending", "confirmed", "completed", "no_show"] as const;

const selection = {
  id: appointmentsTable.id,
  contactId: appointmentsTable.contactId,
  conversationId: appointmentsTable.conversationId,
  agentId: appointmentsTable.agentId,
  service: appointmentsTable.service,
  notes: appointmentsTable.notes,
  location: appointmentsTable.location,
  startsAt: appointmentsTable.startsAt,
  durationMinutes: appointmentsTable.durationMinutes,
  status: appointmentsTable.status,
  source: appointmentsTable.source,
  reminderSentAt: appointmentsTable.reminderSentAt,
  createdAt: appointmentsTable.createdAt,
  updatedAt: appointmentsTable.updatedAt,
  // Una cita del sitio cuyo contacto aún no está en el CRM muestra el nombre y el
  // teléfono con que la anotó el vendedor.
  contactName: sql<string | null>`coalesce(${contactsTable.name}, nullif(${appointmentsTable.customerName}, ''))`,
  contactPhone: sql<string | null>`coalesce(${contactsTable.phone}, nullif(${appointmentsTable.customerPhone}, ''))`,
  agentName: agentsTable.name,
};

function baseQuery() {
  // leftJoin y no innerJoin: una cita cuyo contacto se borró debe seguir
  // apareciendo en la agenda, no desaparecer del día del equipo.
  return db
    .select(selection)
    .from(appointmentsTable)
    .leftJoin(contactsTable, eq(appointmentsTable.contactId, contactsTable.id))
    .leftJoin(agentsTable, eq(appointmentsTable.agentId, agentsTable.id));
}

export function endOf(appointment: { startsAt: Date; durationMinutes: number }): Date {
  return new Date(appointment.startsAt.getTime() + appointment.durationMinutes * 60_000);
}

/**
 * Una fecha para una plantilla `sql` cruda, como instante UTC.
 *
 * Hace falta porque un `Date` metido en una plantilla `sql` cruda NO pasa por el
 * conversor de la columna: lo serializa el driver con el desfase local
 * ("…T16:00:00-04:00"). La agenda es la del sitio y su `starts_at` es
 * `timestamptz`, así que se compara contra un `timestamptz` explícito en UTC y
 * el resultado no depende de la zona horaria de la conexión.
 */
function toPgInstant(date: Date): string {
  return date.toISOString();
}

export async function listAppointments(opts: {
  from: Date;
  to: Date;
  status?: AppointmentStatus | undefined;
}): Promise<AppointmentView[]> {
  const filters = [gte(appointmentsTable.startsAt, opts.from), lt(appointmentsTable.startsAt, opts.to)];
  if (opts.status) filters.push(eq(appointmentsTable.status, opts.status));

  return baseQuery()
    .where(and(...filters))
    .orderBy(asc(appointmentsTable.startsAt));
}

export async function getAppointment(id: number): Promise<AppointmentView | null> {
  const [row] = await baseQuery().where(eq(appointmentsTable.id, id)).limit(1);
  return row ?? null;
}

/**
 * Citas que chocan con el hueco pedido.
 *
 * Dos citas se solapan cuando cada una empieza antes de que termine la otra. Se
 * comparan contra la agenda completa, salvo que se indique `agentId`: entonces
 * solo cuenta lo que esa persona ya tiene encima. `exceptId` deja fuera la cita
 * que se está reprogramando, que si no chocaría consigo misma.
 */
export async function findConflicts(opts: {
  startsAt: Date;
  durationMinutes: number;
  agentId?: number | null;
  exceptId?: number | null;
}): Promise<AppointmentView[]> {
  const endsAt = endOf(opts);

  const filters = [
    inArray(appointmentsTable.status, [...BLOCKING_STATUSES]),
    // inicio < fin del hueco pedido
    lt(appointmentsTable.startsAt, endsAt),
    // fin > inicio del hueco pedido. El fin no está almacenado, se calcula en
    // SQL desde la duración para que el solapamiento lo resuelva la base y no
    // haya que traerse la agenda entera a memoria. Estricto (>) a propósito: una
    // cita que empieza justo cuando termina la anterior no se solapa.
    sql`${appointmentsTable.startsAt} + (${appointmentsTable.durationMinutes} * interval '1 minute') > ${toPgInstant(opts.startsAt)}::timestamptz`,
  ];

  if (opts.agentId != null) filters.push(eq(appointmentsTable.agentId, opts.agentId));
  if (opts.exceptId != null) filters.push(ne(appointmentsTable.id, opts.exceptId));

  return baseQuery()
    .where(and(...filters))
    .orderBy(asc(appointmentsTable.startsAt));
}

/** Todo lo que ya hay ese día, para poder ofrecer una alternativa cercana. */
export async function listSameDay(reference: Date): Promise<AppointmentView[]> {
  const dayStart = new Date(reference);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  return listAppointments({ from: dayStart, to: dayEnd });
}
