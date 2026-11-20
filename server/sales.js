// The sales team's API: catalogue, reservations, agenda, web inquiries and the reports that
// administration reads. Mounted under /api/admin, so every route already has a session.
import express from "express";
import { randomUUID } from "node:crypto";
import { query, transaction } from "./db.js";
import {
  InputError,
  text,
  isUuid,
  reservationInput,
  appointmentInput,
  appointmentUpdate,
  RESERVATION_MAX_DAYS,
} from "./domain.js";
import {
  APPOINTMENT_SELECT,
  appointmentView,
  createAppointment,
  updateAppointment,
  expireReservations,
} from "./agenda.js";
import { DEALER_TZ, omniConfigured, omniRequest, systemIdentity } from "./omni-service.js";

const TZ = DEALER_TZ;
const localToday = `(now() AT TIME ZONE '${TZ}')::date`;
const dayStart = (param) => `(${param}::date::timestamp AT TIME ZONE '${TZ}')`;
const ownOrAdmin = (user, ownerId) => user.role === "admin" || ownerId === user.id;
const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") && !Number.isNaN(Date.parse(v));
const periodDays = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 730 ? n : 30;
};

export function salesRouter({ admin, seller, audit, checkId }) {
  const r = express.Router();

  // Names of the team for pickers (agenda, reservations, sales). No roles or usernames needed.
  r.get("/team", async (_req, res) => {
    const { rows } = await query(
      "SELECT id,name,role FROM admin_users WHERE active ORDER BY name",
    );
    res.json(rows);
  });

  r.get("/me/summary", async (req, res) => {
    const me = req.user.id;
    const isAdmin = req.user.role === "admin";
    await expireReservations();
    const [sales, holds, today, leads, upcoming, units, quotes] = await Promise.all([
      query(
        `SELECT count(*)::integer count,coalesce(sum(price),0) revenue FROM sales WHERE cancelled_at IS NULL AND coalesce(seller_id,created_by)=$1 AND sold_at>=date_trunc('month',${localToday})::date`,
        [me],
      ),
      query(
        "SELECT count(*)::integer count,count(*) FILTER (WHERE expires_at<now()+interval '24 hours')::integer expiring FROM reservations WHERE status='active' AND seller_id=$1",
        [me],
      ),
      query(
        `${APPOINTMENT_SELECT} WHERE a.seller_id=$1 AND a.starts_at>=${dayStart(localToday)} AND a.starts_at<${dayStart(`(${localToday}+1)`)} ORDER BY a.starts_at`,
        [me],
      ),
      query(
        "SELECT count(*) FILTER (WHERE assigned_to IS NULL AND status='new')::integer unassigned,count(*) FILTER (WHERE assigned_to=$1 AND status<>'closed')::integer mine FROM leads",
        [me],
      ),
      query(
        "SELECT count(*)::integer count FROM appointments WHERE seller_id=$1 AND status IN ('pending','confirmed') AND starts_at>now() AND starts_at<now()+interval '7 days'",
        [me],
      ),
      // Units loaded from the lot: for administration, every draft waiting for its details;
      // for the rest, their own, waiting or already published.
      isAdmin
        ? query("SELECT count(*)::integer drafts,count(*) FILTER (WHERE intake_by IS NOT NULL)::integer loaded,0 published FROM vehicles WHERE status='draft'")
        : query(
            "SELECT count(*) FILTER (WHERE status='draft')::integer drafts,count(*)::integer loaded,count(*) FILTER (WHERE status IN ('available','reserved'))::integer published FROM vehicles WHERE intake_by=$1",
            [me],
          ),
      query(
        `SELECT count(*)::integer count FROM quotes WHERE ${isAdmin ? "true" : "seller_id=$1"} AND created_at>=date_trunc('month',${localToday})::timestamp AT TIME ZONE '${TZ}'`,
        isAdmin ? [] : [me],
      ),
    ]);
    res.json({
      sales: sales.rows[0],
      reservations: holds.rows[0],
      today: today.rows,
      leads: leads.rows[0],
      upcoming: upcoming.rows[0].count,
      units: units.rows[0],
      quotes: quotes.rows[0],
    });
  });

  // What can be sold, with who is holding it. Customer names on a hold are only shown to the
  // salesperson who made it and to administration.
  r.get("/catalog", async (req, res) => {
    await expireReservations();
    const { rows } = await query(
      "SELECT v.id,v.stock,v.vin,v.status,v.data,v.created_at,coalesce((SELECT json_agg('/api/photos/'||p.id ORDER BY p.position,p.created_at) FROM vehicle_photos p WHERE p.vehicle_id=v.id),'[]') photos,r.id reservation_id,r.seller_id,su.name seller_name,r.expires_at,r.customer_name FROM vehicles v LEFT JOIN reservations r ON r.vehicle_id=v.id AND r.status='active' LEFT JOIN admin_users su ON su.id=r.seller_id WHERE v.status IN ('available','reserved') ORDER BY v.created_at DESC",
    );
    res.json(
      rows.map((v) => ({
        ...v.data,
        id: v.id,
        stock: v.stock,
        vin: v.vin,
        status: v.status,
        createdAt: v.created_at,
        photos: v.photos,
        reservation: v.reservation_id
          ? {
              id: v.reservation_id,
              sellerId: v.seller_id,
              sellerName: v.seller_name,
              expiresAt: v.expires_at,
              mine: v.seller_id === req.user.id,
              customerName: ownOrAdmin(req.user, v.seller_id) ? v.customer_name : undefined,
            }
          : null,
      })),
    );
  });

  // ── Reservations ─────────────────────────────────────────────────────────────────────────
  r.get("/reservations", seller, async (req, res) => {
    await expireReservations();
    const status = ["active", "released", "expired", "converted", "all"].includes(req.query.status)
      ? req.query.status
      : "active";
    const params = [],
      where = [];
    if (status !== "all") where.push(`r.status=$${params.push(status)}`);
    if (req.user.role !== "admin") where.push(`r.seller_id=$${params.push(req.user.id)}`);
    else if (isUuid(req.query.seller)) where.push(`r.seller_id=$${params.push(req.query.seller)}`);
    const { rows } = await query(
      `SELECT r.*,su.name seller_name,v.stock,v.status vehicle_status,v.data->>'year' AS "year",v.data->>'make' make,v.data->>'model' model,v.data->>'trim' trim,(v.data->>'price')::numeric price,(v.data->>'priceOnRequest')::boolean price_on_request,(SELECT '/api/photos/'||p.id FROM vehicle_photos p WHERE p.vehicle_id=v.id ORDER BY p.position,p.created_at LIMIT 1) photo FROM reservations r JOIN vehicles v ON v.id=r.vehicle_id JOIN admin_users su ON su.id=r.seller_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY r.status='active' DESC,r.expires_at,r.created_at DESC LIMIT 300`,
      params,
    );
    res.json(rows);
  });

  r.post("/reservations", seller, async (req, res) => {
    if (!isUuid(req.body.vehicleId)) throw new InputError("Selecciona un vehículo.");
    const input = reservationInput(req.body);
    const sellerId = req.user.role === "admin" && input.sellerId ? input.sellerId : req.user.id;
    await expireReservations();
    const id = randomUUID();
    await transaction(async (c) => {
      const { rows } = await c.query("SELECT * FROM vehicles WHERE id=$1 FOR UPDATE", [req.body.vehicleId]);
      const v = rows[0];
      if (!v) throw new InputError("Vehículo no encontrado.", 404);
      if (v.data.demo)
        throw new InputError(
          "Esta unidad es de demostración. Completa sus datos reales y desmarca Demo antes de reservarla.",
          409,
        );
      if (v.status === "reserved") {
        const held = await c.query(
          "SELECT u.name FROM reservations r JOIN admin_users u ON u.id=r.seller_id WHERE r.vehicle_id=$1 AND r.status='active'",
          [v.id],
        );
        throw new InputError(
          held.rows[0]
            ? `Este vehículo ya está reservado por ${held.rows[0].name}.`
            : "Este vehículo ya figura como reservado en el inventario.",
          409,
        );
      }
      if (v.status !== "available")
        throw new InputError("Solo se pueden reservar vehículos disponibles.", 409);
      if (sellerId !== req.user.id) {
        const seller = await c.query("SELECT id FROM admin_users WHERE id=$1 AND active AND role IN ('admin','sales')", [sellerId]);
        if (!seller.rows.length) throw new InputError("Vendedor no encontrado o desactivado.");
      }
      await c.query(
        "INSERT INTO reservations(id,vehicle_id,seller_id,customer_name,customer_phone,customer_email,deposit,notes,expires_at,omni_conversation_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+make_interval(days=>$9::int),$10,$11)",
        [
          id,
          v.id,
          sellerId,
          input.customerName,
          input.customerPhone,
          input.customerEmail,
          input.deposit,
          input.notes,
          input.days,
          input.omniConversationId,
          req.user.id,
        ],
      );
      await c.query("UPDATE vehicles SET status='reserved',version=version+1,updated_at=now() WHERE id=$1", [v.id]);
      await audit(c, req.user, "reservation.created", id);
    });
    res.status(201).json({ id });
  });

  // Releases or extends a hold. Both lock the vehicle first, like a sale does.
  async function withReservation(req, fn) {
    return transaction(async (c) => {
      const look = await c.query("SELECT vehicle_id FROM reservations WHERE id=$1", [req.params.id]);
      if (!look.rows[0]) throw new InputError("Reserva no encontrada.", 404);
      await c.query("SELECT id FROM vehicles WHERE id=$1 FOR UPDATE", [look.rows[0].vehicle_id]);
      const { rows } = await c.query("SELECT * FROM reservations WHERE id=$1 FOR UPDATE", [req.params.id]);
      const reservation = rows[0];
      if (reservation.status !== "active") throw new InputError("La reserva ya no está activa.", 409);
      if (!ownOrAdmin(req.user, reservation.seller_id))
        throw new InputError("Solo quien hizo la reserva o administración puede cambiarla.", 403);
      return fn(c, reservation);
    });
  }

  r.post("/reservations/:id/release", checkId, seller, async (req, res) => {
    const reason = text(req.body.reason, 500);
    await withReservation(req, async (c, reservation) => {
      await c.query(
        "UPDATE reservations SET status='released',closed_at=now(),closed_by=$2,notes=CASE WHEN $3::text='' THEN notes ELSE trim(both E'\\n' from notes||E'\\n'||'Liberada: '||$3::text) END WHERE id=$1",
        [reservation.id, req.user.id, reason],
      );
      await c.query(
        "UPDATE vehicles SET status='available',version=version+1,updated_at=now() WHERE id=$1 AND status='reserved'",
        [reservation.vehicle_id],
      );
      await audit(c, req.user, "reservation.released", reservation.id);
    });
    res.json({ ok: true });
  });

  r.post("/reservations/:id/extend", checkId, seller, async (req, res) => {
    const days = Number(req.body.days);
    if (!Number.isInteger(days) || days < 1 || days > RESERVATION_MAX_DAYS)
      throw new InputError("Indica cuántos días extender (1 a 30).");
    await withReservation(req, async (c, reservation) => {
      const { rows } = await c.query(
        `UPDATE reservations SET expires_at=greatest(expires_at,now())+make_interval(days=>$2::int) WHERE id=$1 AND greatest(expires_at,now())+make_interval(days=>$2::int)<=now()+interval '${RESERVATION_MAX_DAYS} days 1 hour' RETURNING expires_at`,
        [reservation.id, days],
      );
      if (!rows.length)
        throw new InputError(`Una reserva puede durar como máximo ${RESERVATION_MAX_DAYS} días desde hoy.`);
      await audit(c, req.user, "reservation.extended", reservation.id);
    });
    res.json({ ok: true });
  });

  // ── Agenda ───────────────────────────────────────────────────────────────────────────────
  r.get("/appointments", async (req, res) => {
    const from = isoDate(req.query.from) ? req.query.from : null;
    const to = isoDate(req.query.to) ? req.query.to : null;
    const params = [];
    const fromSql = from ? `$${params.push(from)}` : localToday;
    const toSql = to ? `$${params.push(to)}` : `(${localToday}+14)`;
    const where = [`a.starts_at>=${dayStart(fromSql)}`, `a.starts_at<${dayStart(`(${toSql}::date+1)`)}`];
    if (req.user.role !== "admin") where.push(`(a.seller_id=$${params.push(req.user.id)} OR a.seller_id IS NULL)`);
    else if (isUuid(req.query.seller)) where.push(`a.seller_id=$${params.push(req.query.seller)}`);
    if (req.query.status === "open") where.push("a.status IN ('pending','confirmed')");
    const { rows } = await query(
      `${APPOINTMENT_SELECT} WHERE ${where.join(" AND ")} ORDER BY a.starts_at LIMIT 500`,
      params,
    );
    res.json(rows);
  });

  r.post("/appointments", async (req, res) => {
    const id = await createAppointment(req.user, appointmentInput(req.body));
    res.status(201).json(await appointmentView(id));
  });

  r.put("/appointments/:id", checkId, async (req, res) => {
    await updateAppointment(req.user, req.params.id, appointmentUpdate(req.body));
    res.json(await appointmentView(req.params.id));
  });

  // ── Web inquiries ────────────────────────────────────────────────────────────────────────
  // A salesperson takes an unassigned inquiry; administration can hand it to anyone.
  r.post("/leads/:id/take", checkId, seller, async (req, res) => {
    const target = req.user.role === "admin" && isUuid(req.body.userId) ? req.body.userId : req.user.id;
    if (target !== req.user.id) {
      const { rows } = await query("SELECT id FROM admin_users WHERE id=$1 AND active AND role IN ('admin','sales')", [target]);
      if (!rows.length) throw new InputError("Vendedor no encontrado o desactivado.");
    }
    await transaction(async (c) => {
      const { rows } = await c.query("SELECT assigned_to FROM leads WHERE id=$1 FOR UPDATE", [req.params.id]);
      if (!rows[0]) throw new InputError("Consulta no encontrada.", 404);
      if (rows[0].assigned_to && rows[0].assigned_to !== target && req.user.role !== "admin")
        throw new InputError("Otra persona del equipo ya atiende esta consulta.", 409);
      await c.query("UPDATE leads SET assigned_to=$1 WHERE id=$2", [target, req.params.id]);
      await audit(c, req.user, "lead.assigned", req.params.id);
    });
    res.json({ ok: true });
  });

  // ── Administration: money ────────────────────────────────────────────────────────────────
  r.get("/finance", admin, async (req, res) => {
    const days = periodDays(req.query.days);
    const from = `(${localToday}-${days - 1})`;
    const [period, months, expenses, stock, pipeline, recent] = await Promise.all([
      query(
        `SELECT count(*)::integer count,coalesce(sum(s.price),0) revenue,coalesce(sum(s.cost),0) cost,coalesce(sum(s.price-s.cost),0) margin,coalesce(round(avg(greatest(s.sold_at-(v.created_at AT TIME ZONE '${TZ}')::date,0))),0)::integer avg_days FROM sales s JOIN vehicles v ON v.id=s.vehicle_id WHERE s.cancelled_at IS NULL AND s.sold_at>=${from}`,
      ),
      query(
        `SELECT to_char(m,'YYYY-MM') AS month,coalesce(count(s.id),0)::integer count,coalesce(sum(s.price),0) revenue,coalesce(sum(s.cost),0) cost,coalesce(sum(s.price-s.cost),0) margin FROM generate_series(date_trunc('month',${localToday})-interval '11 months',date_trunc('month',${localToday}),interval '1 month') m LEFT JOIN sales s ON s.cancelled_at IS NULL AND date_trunc('month',s.sold_at)=m GROUP BY m ORDER BY m`,
      ),
      query(
        `SELECT to_char(m,'YYYY-MM') AS month,coalesce(sum(e.amount),0) amount FROM generate_series(date_trunc('month',${localToday})-interval '11 months',date_trunc('month',${localToday}),interval '1 month') m LEFT JOIN vehicle_expenses e ON date_trunc('month',e.expense_date)=m GROUP BY m ORDER BY m`,
      ),
      query(
        `SELECT v.status,count(*)::integer count,coalesce(sum((v.data->>'price')::numeric),0) list_value,coalesce(sum(v.purchase_cost+coalesce(e.total,0)),0) cost_value,count(*) FILTER (WHERE coalesce((v.data->>'priceOnRequest')::boolean,false) OR (v.data->>'price')::numeric=0)::integer unpriced,count(*) FILTER (WHERE v.created_at<now()-interval '60 days')::integer aged60,count(*) FILTER (WHERE v.created_at<now()-interval '90 days')::integer aged90 FROM vehicles v LEFT JOIN (SELECT vehicle_id,sum(amount) total FROM vehicle_expenses GROUP BY vehicle_id) e ON e.vehicle_id=v.id WHERE v.status IN ('draft','available','reserved') AND NOT coalesce((v.data->>'demo')::boolean,false) GROUP BY v.status`,
      ),
      query(
        "SELECT count(*)::integer count,coalesce(sum(r.deposit),0) deposits,coalesce(sum((v.data->>'price')::numeric),0) value FROM reservations r JOIN vehicles v ON v.id=r.vehicle_id WHERE r.status='active'",
      ),
      query(
        `SELECT s.id,s.price,s.cost,s.price-s.cost margin,s.sold_at,s.buyer_name,v.stock,v.data->>'year' AS "year",v.data->>'make' make,v.data->>'model' model,su.name seller_name FROM sales s JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN admin_users su ON su.id=coalesce(s.seller_id,s.created_by) WHERE s.cancelled_at IS NULL AND s.sold_at>=${from} ORDER BY s.sold_at DESC,s.created_at DESC LIMIT 25`,
      ),
    ]);
    const { rows: demo } = await query(
      "SELECT count(*)::integer count FROM vehicles WHERE status IN ('draft','available','reserved') AND coalesce((data->>'demo')::boolean,false)",
    );
    res.json({
      days,
      period: period.rows[0],
      months: months.rows.map((m, i) => ({ ...m, expenses: expenses.rows[i].amount })),
      stock: stock.rows,
      demoUnits: demo[0].count,
      pipeline: pipeline.rows[0],
      recent: recent.rows,
    });
  });

  // ── Administration: the team's results ─────────────────────────────────────────────────
  r.get("/performance", admin, async (req, res) => {
    const days = periodDays(req.query.days);
    const fromDate = `(${localToday}-${days - 1})`;
    const fromTs = dayStart(fromDate);
    const { rows } = await query(
      `WITH s AS (SELECT coalesce(seller_id,created_by) uid,count(*)::integer sales,sum(price) revenue,sum(price-cost) margin FROM sales WHERE cancelled_at IS NULL AND sold_at>=${fromDate} GROUP BY 1),
        r AS (SELECT seller_id uid,count(*)::integer created,count(*) FILTER (WHERE status='converted')::integer converted,count(*) FILTER (WHERE status IN ('expired','released'))::integer lost,count(*) FILTER (WHERE status='active')::integer active FROM reservations WHERE created_at>=${fromTs} GROUP BY 1),
        a AS (SELECT seller_id uid,count(*)::integer total,count(*) FILTER (WHERE status='completed')::integer completed,count(*) FILTER (WHERE status='no_show')::integer no_show,count(*) FILTER (WHERE kind='testdrive')::integer testdrives FROM appointments WHERE starts_at>=${fromTs} AND starts_at<now() AND status<>'cancelled' GROUP BY 1),
        l AS (SELECT assigned_to uid,count(*)::integer leads,count(*) FILTER (WHERE status='closed')::integer closed FROM leads WHERE created_at>=${fromTs} AND assigned_to IS NOT NULL GROUP BY 1)
       SELECT u.id,u.name,u.role,u.active,u.omni_agent_id,coalesce(s.sales,0) sales,coalesce(s.revenue,0) revenue,coalesce(s.margin,0) margin,coalesce(r.created,0) reservations,coalesce(r.converted,0) converted,coalesce(r.lost,0) lost,coalesce(r.active,0) active_reservations,coalesce(a.total,0) appointments,coalesce(a.completed,0) completed,coalesce(a.no_show,0) no_show,coalesce(a.testdrives,0) testdrives,coalesce(l.leads,0) leads,coalesce(l.closed,0) leads_closed
       FROM admin_users u LEFT JOIN s ON s.uid=u.id LEFT JOIN r ON r.uid=u.id LEFT JOIN a ON a.uid=u.id LEFT JOIN l ON l.uid=u.id
       WHERE u.role='sales' OR s.uid IS NOT NULL OR r.uid IS NOT NULL OR a.uid IS NOT NULL OR l.uid IS NOT NULL
       ORDER BY coalesce(s.revenue,0) DESC,coalesce(s.sales,0) DESC,u.name`,
    );
    // Conversations each agent handled come from Omnicanal's own reports, over the same window.
    let omni = null,
      omniError = null;
    if (omniConfigured() && rows.some((u) => u.omni_agent_id)) {
      try {
        const report = await omniRequest(await systemIdentity(), `/analytics/reports?days=${days}`);
        omni = Object.fromEntries(
          (report?.byAgent || []).map((a) => [
            a.agentId,
            {
              conversations: a.conversations,
              resolved: a.resolved,
              messages: a.messages,
              avgFirstResponseMinutes: a.avgFirstResponseMinutes,
            },
          ]),
        );
      } catch (error) {
        omniError = error.message;
      }
    }
    res.json({
      days,
      team: rows.map((u) => ({ ...u, omni: u.omni_agent_id && omni ? omni[u.omni_agent_id] || null : null })),
      omniError,
    });
  });

  return r;
}
