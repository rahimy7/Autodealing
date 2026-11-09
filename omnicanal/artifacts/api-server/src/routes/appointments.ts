import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, appointmentsTable } from "@workspace/db";
import type { AppointmentStatus } from "@workspace/db";
import {
  CreateAppointmentBody,
  UpdateAppointmentBody,
  UpdateAppointmentParams,
  DeleteAppointmentParams,
  ListAppointmentsResponse,
  UpdateAppointmentResponse,
  CheckAppointmentAvailabilityResponse,
} from "@workspace/api-zod";
import {
  findConflicts,
  getAppointment,
  listAppointments,
  listSameDay,
  type AppointmentView,
} from "../lib/appointments";

const router: IRouter = Router();

const DEFAULT_RANGE_DAYS = 30;
const STATUSES: AppointmentStatus[] = ["pending", "confirmed", "cancelled", "completed", "no_show"];

// Las fechas en query string llegan como texto y el validador generado espera un
// Date (orval solo aplica coerción a booleanos, números y cadenas), así que se
// parsean a mano — igual que en los reportes.
function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseStatus(value: unknown): AppointmentStatus | undefined {
  return typeof value === "string" && (STATUSES as string[]).includes(value)
    ? (value as AppointmentStatus)
    : undefined;
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function serialize(row: AppointmentView) {
  return {
    id: row.id,
    contactId: row.contactId,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    conversationId: row.conversationId,
    agentId: row.agentId,
    agentName: row.agentName,
    service: row.service,
    notes: row.notes,
    location: row.location,
    startsAt: row.startsAt,
    durationMinutes: row.durationMinutes,
    status: row.status,
    source: row.source,
    createdAt: row.createdAt,
  };
}

router.get("/appointments", async (req, res): Promise<void> => {
  const from = parseDate(req.query["from"]) ?? startOfToday();
  const to =
    parseDate(req.query["to"]) ?? new Date(from.getTime() + DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);

  if (to <= from) {
    res.status(400).json({ error: "El final del rango debe ser posterior al inicio." });
    return;
  }

  const rows = await listAppointments({ from, to, status: parseStatus(req.query["status"]) });
  res.json(ListAppointmentsResponse.parse(rows.map(serialize)));
});

// Lo que el agente virtual consulta antes de proponer una hora, y lo que la
// agenda usa para avisar de un choque mientras se escribe la cita.
router.get("/appointments/availability", async (req, res): Promise<void> => {
  const startsAt = parseDate(req.query["startsAt"]);
  if (!startsAt) {
    res.status(400).json({ error: "startsAt es obligatorio y debe ser una fecha válida." });
    return;
  }

  const durationRaw = Number(req.query["durationMinutes"]);
  const durationMinutes = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.trunc(durationRaw) : 60;
  const agentRaw = Number(req.query["agentId"]);
  const agentId = Number.isFinite(agentRaw) && agentRaw > 0 ? Math.trunc(agentRaw) : null;

  const conflicts = await findConflicts({ startsAt, durationMinutes, agentId });
  const sameDay = await listSameDay(startsAt);

  res.json(
    CheckAppointmentAvailabilityResponse.parse({
      available: conflicts.length === 0,
      conflicts: conflicts.map(serialize),
      sameDay: sameDay.map(serialize),
    }),
  );
});

router.post("/appointments", async (req, res): Promise<void> => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { startsAt, durationMinutes, agentId } = parsed.data;
  const conflicts = await findConflicts({ startsAt, durationMinutes, agentId });
  if (conflicts.length > 0) {
    res.status(409).json({
      error: "Ese horario ya está ocupado.",
      conflicts: conflicts.map(serialize),
    });
    return;
  }

  const [created] = await db
    .insert(appointmentsTable)
    .values({
      contactId: parsed.data.contactId,
      conversationId: parsed.data.conversationId ?? null,
      agentId: agentId ?? null,
      service: parsed.data.service,
      notes: parsed.data.notes ?? null,
      location: parsed.data.location ?? null,
      startsAt,
      durationMinutes,
      status: parsed.data.status ?? "confirmed",
      // Esta ruta la usa el panel; lo que agenda la IA entra por messaging.ts y
      // se marca como "ai" allí.
      source: "admin",
    })
    .returning({ id: appointmentsTable.id });

  // Orval no emite validador para las respuestas 201, así que aquí se responde
  // el objeto serializado tal cual — la misma forma que valida el GET.
  const view = await getAppointment(created.id);
  res.status(201).json(serialize(view!));
});

router.patch("/appointments/:id", async (req, res): Promise<void> => {
  const params = UpdateAppointmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const current = await getAppointment(params.data.id);
  if (!current) {
    res.status(404).json({ error: "Cita no encontrada." });
    return;
  }

  const startsAt = parsed.data.startsAt ?? current.startsAt;
  const durationMinutes = parsed.data.durationMinutes ?? current.durationMinutes;
  const agentId = parsed.data.agentId !== undefined ? parsed.data.agentId : current.agentId;
  const status = parsed.data.status ?? current.status;

  // Una cita que se cancela no compite por su hueco, así que no tiene sentido
  // comprobarle solapamientos: al contrario, lo libera.
  if (status !== "cancelled") {
    const conflicts = await findConflicts({
      startsAt,
      durationMinutes,
      agentId,
      exceptId: current.id,
    });
    if (conflicts.length > 0) {
      res.status(409).json({
        error: "Ese horario ya está ocupado.",
        conflicts: conflicts.map(serialize),
      });
      return;
    }
  }

  await db
    .update(appointmentsTable)
    .set({
      agentId: agentId ?? null,
      service: parsed.data.service ?? current.service,
      notes: parsed.data.notes !== undefined ? parsed.data.notes : current.notes,
      location: parsed.data.location !== undefined ? parsed.data.location : current.location,
      startsAt,
      durationMinutes,
      status,
      updatedAt: new Date(),
    })
    .where(eq(appointmentsTable.id, current.id));

  const view = await getAppointment(current.id);
  res.json(UpdateAppointmentResponse.parse(serialize(view!)));
});

router.delete("/appointments/:id", async (req, res): Promise<void> => {
  const params = DeleteAppointmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const deleted = await db
    .delete(appointmentsTable)
    .where(eq(appointmentsTable.id, params.data.id))
    .returning({ id: appointmentsTable.id });

  if (deleted.length === 0) {
    res.status(404).json({ error: "Cita no encontrada." });
    return;
  }

  res.status(204).end();
});

export default router;
