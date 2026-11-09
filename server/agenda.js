// Appointments and reservations: the rules shared by the sales app and the Omnicanal inbox.
// Locks always go vehicle first, then reservation or seller, the same order the sale uses.
import { randomUUID } from "node:crypto";
import { query, transaction } from "./db.js";
import { InputError } from "./domain.js";
import { DEALER_TZ, scheduleInventorySync, syncAppointment } from "./omni-service.js";

const OPEN = "('scheduled','confirmed')";
const SLOT = "tstzrange(starts_at, starts_at + make_interval(mins => duration_minutes))";

export const APPOINTMENT_SELECT = `SELECT a.*,to_char(a.starts_at AT TIME ZONE '${DEALER_TZ}','YYYY-MM-DD') local_date,to_char(a.starts_at AT TIME ZONE '${DEALER_TZ}','HH24:MI') local_time,su.name seller_name,v.stock,v.data->>'year' AS "year",v.data->>'make' make,v.data->>'model' model FROM appointments a LEFT JOIN admin_users su ON su.id=a.seller_id LEFT JOIN vehicles v ON v.id=a.vehicle_id`;

export async function appointmentView(id) {
  const { rows } = await query(`${APPOINTMENT_SELECT} WHERE a.id=$1`, [id]);
  return rows[0] || null;
}

async function lockSeller(c, sellerId) {
  const { rows } = await c.query("SELECT id,name,active FROM admin_users WHERE id=$1 FOR UPDATE", [sellerId]);
  if (!rows[0]?.active) throw new InputError("Vendedor no encontrado o desactivado.");
  return rows[0];
}

async function checkConflicts(c, { id, sellerId, vehicleId, kind, startsAt, minutes, self }) {
  const range = `tstzrange($1::timestamptz, $1::timestamptz + make_interval(mins => $2::int))`;
  if (sellerId) {
    const { rows } = await c.query(
      `SELECT customer_name,to_char(starts_at AT TIME ZONE '${DEALER_TZ}','HH24:MI') t FROM appointments WHERE seller_id=$3 AND status IN ${OPEN} AND id<>$4 AND ${SLOT} && ${range} LIMIT 1`,
      [startsAt, minutes, sellerId, id],
    );
    if (rows[0])
      throw new InputError(
        `${self ? "Ya tienes" : "Ese vendedor ya tiene"} una cita a esa hora (${rows[0].customer_name}, ${rows[0].t}).`,
        409,
      );
  }
  if (vehicleId && kind === "testdrive") {
    const { rows } = await c.query(
      `SELECT to_char(starts_at AT TIME ZONE '${DEALER_TZ}','HH24:MI') t FROM appointments WHERE vehicle_id=$3 AND kind='testdrive' AND status IN ${OPEN} AND id<>$4 AND ${SLOT} && ${range} LIMIT 1`,
      [startsAt, minutes, vehicleId, id],
    );
    if (rows[0])
      throw new InputError(`Ese vehículo ya tiene una prueba de manejo a esa hora (${rows[0].t}).`, 409);
  }
}

async function resolveSlot(c, { date, time, startsAt }) {
  const { rows } = await c.query(
    startsAt
      ? "SELECT $1::timestamptz s, $1::timestamptz < now() - interval '30 days' OR $1::timestamptz > now() + interval '400 days' out_of_range"
      : "SELECT x.s, x.s < now() - interval '30 days' OR x.s > now() + interval '400 days' out_of_range FROM (SELECT ($1::text||' '||$2::text)::timestamp AT TIME ZONE $3::text s) x",
    startsAt ? [startsAt] : [date, time, DEALER_TZ],
  );
  if (rows[0].out_of_range)
    throw new InputError("La fecha de la cita está fuera del rango permitido.");
  return rows[0].s;
}

// `input` comes from appointmentInput (dealer's wall clock) or, for an appointment the virtual
// agent booked, carries `startsAt` as an instant plus its Omnicanal references.
export async function createAppointment(user, input) {
  const id = randomUUID();
  const sellerId = user.role === "admin" ? input.sellerId || user.id : user.id;
  const inserted = await transaction(async (c) => {
    if (input.vehicleId) {
      const { rows } = await c.query("SELECT status FROM vehicles WHERE id=$1 FOR UPDATE", [input.vehicleId]);
      if (!rows[0]) throw new InputError("Vehículo no encontrado.", 404);
      if (["sold", "archived"].includes(rows[0].status))
        throw new InputError("Ese vehículo ya no está a la venta.", 409);
    }
    await lockSeller(c, sellerId);
    const startsAt = await resolveSlot(c, input);
    await checkConflicts(c, {
      id,
      sellerId,
      vehicleId: input.vehicleId,
      kind: input.kind,
      startsAt,
      minutes: input.durationMinutes,
      self: sellerId === user.id,
    });
    if (input.leadId) {
      const lead = await c.query(
        "UPDATE leads SET assigned_to=coalesce(assigned_to,$2) WHERE id=$1 RETURNING id",
        [input.leadId, sellerId],
      );
      if (!lead.rowCount) throw new InputError("Consulta no encontrada.", 404);
    }
    const { rowCount } = await c.query(
      `INSERT INTO appointments(id,kind,starts_at,duration_minutes,seller_id,vehicle_id,lead_id,customer_name,customer_phone,customer_email,notes,status,omni_appointment_id,omni_contact_id,omni_conversation_id,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (omni_appointment_id) WHERE omni_appointment_id IS NOT NULL DO NOTHING`,
      [
        id,
        input.kind,
        startsAt,
        input.durationMinutes,
        sellerId,
        input.vehicleId,
        input.leadId,
        input.customerName,
        input.customerPhone,
        input.customerEmail,
        input.notes,
        input.status || "scheduled",
        input.omniAppointmentId ?? null,
        input.omniContactId ?? null,
        input.omniConversationId ?? null,
        user.id,
      ],
    );
    if (!rowCount) throw new InputError("Esa cita ya está en la agenda.", 409);
    await c.query("INSERT INTO audit_log(user_id,action,entity_id) VALUES($1,'appointment.created',$2)", [user.id, id]);
    return true;
  });
  if (inserted) await syncAppointment(id);
  return id;
}

export async function updateAppointment(user, id, patch) {
  await transaction(async (c) => {
    const look = await c.query("SELECT vehicle_id FROM appointments WHERE id=$1", [id]);
    if (!look.rows[0]) throw new InputError("Cita no encontrada.", 404);
    if (look.rows[0].vehicle_id)
      await c.query("SELECT id FROM vehicles WHERE id=$1 FOR UPDATE", [look.rows[0].vehicle_id]);
    const { rows } = await c.query("SELECT * FROM appointments WHERE id=$1 FOR UPDATE", [id]);
    const a = rows[0];
    const admin = user.role === "admin";
    if (!admin && a.seller_id && a.seller_id !== user.id)
      throw new InputError("Esta cita es de otro vendedor.", 403);
    let sellerId = a.seller_id;
    if (patch.sellerId !== undefined) {
      if (!admin && patch.sellerId !== user.id)
        throw new InputError("Solo administración puede asignar citas a otra persona.", 403);
      sellerId = patch.sellerId;
    } else if (!admin && !a.seller_id) sellerId = user.id;
    if (sellerId) await lockSeller(c, sellerId);
    const startsAt = patch.date ? await resolveSlot(c, patch) : a.starts_at;
    const minutes = patch.durationMinutes ?? a.duration_minutes;
    const status = patch.status ?? a.status;
    if (["scheduled", "confirmed"].includes(status))
      await checkConflicts(c, {
        id,
        sellerId,
        vehicleId: a.vehicle_id,
        kind: a.kind,
        startsAt,
        minutes,
        self: sellerId === user.id,
      });
    await c.query(
      "UPDATE appointments SET status=$2,starts_at=$3,duration_minutes=$4,notes=$5,seller_id=$6,updated_at=now() WHERE id=$1",
      [id, status, startsAt, minutes, patch.notes ?? a.notes, sellerId],
    );
    await c.query("INSERT INTO audit_log(user_id,action,entity_id) VALUES($1,'appointment.updated',$2)", [user.id, id]);
  });
  await syncAppointment(id);
}

// Reservations past their date go back to the catalogue. Runs on a timer and before any read
// that shows reservations, so nobody sees a hold that already ended.
export async function expireReservations() {
  const count = await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(487251894)");
    const { rows: due } = await c.query(
      "SELECT id,vehicle_id FROM reservations WHERE status='active' AND expires_at<=now()",
    );
    if (!due.length) return 0;
    await c.query("SELECT id FROM vehicles WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [
      due.map((r) => r.vehicle_id),
    ]);
    const { rows } = await c.query(
      "UPDATE reservations SET status='expired',closed_at=now() WHERE id=ANY($1::uuid[]) AND status='active' AND expires_at<=now() RETURNING id,vehicle_id",
      [due.map((r) => r.id)],
    );
    if (!rows.length) return 0;
    await c.query(
      "UPDATE vehicles SET status='available',version=version+1,updated_at=now() WHERE id=ANY($1::uuid[]) AND status='reserved'",
      [rows.map((r) => r.vehicle_id)],
    );
    for (const r of rows)
      await c.query("INSERT INTO audit_log(user_id,action,entity_id) VALUES(NULL,'reservation.expired',$1)", [r.id]);
    return rows.length;
  });
  if (count) scheduleInventorySync();
  return count;
}
