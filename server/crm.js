// Omnicanal inside the sales app: salespeople answer WhatsApp, Instagram and Facebook as their
// own agent; administration links people to agents and keeps the virtual agent's inventory
// current. Mounted under /api/admin/crm, so every route already has a session and CSRF check.
// Only the routes below reach Omnicanal; nothing is passed through by path.
import express from "express";
import { query, transaction } from "./db.js";
import { InputError, text, isUuid, APPOINTMENT_KINDS } from "./domain.js";
import { conversationView, messageView, vehicleMessage, isMediaFile, SAFE_MEDIA } from "./omnicanal.js";
import {
  DEALER_TZ,
  omniConfigured,
  omniPanelUrl,
  omniSettings,
  saveOmniSettings,
  connectionStatus,
  identityFor,
  systemIdentity,
  omniAgents,
  clearAgentCache,
  omniRequest,
  syncInventory,
} from "./omni-service.js";
import { appointmentView, confirmAppointment } from "./agenda.js";

const OPEN_STATUSES = ["open", "pending", "bot"];
const intParam = (v) => /^\d{1,9}$/.test(String(v)) && Number(v) > 0;
const origin = (req) => `${req.protocol}://${req.get("host")}`;
const localFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEALER_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
function local(instant) {
  const parts = Object.fromEntries(localFormat.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
async function publicUrl(req) {
  return (await omniSettings()).publicUrl || origin(req);
}

export function crmRouter({ admin, audit }) {
  const r = express.Router();
  for (const name of ["cid", "oid"])
    r.param(name, (req, res, next, value) =>
      intParam(value) ? next() : res.status(404).json({ error: "No encontrado." }),
    );

  // Whether the inbox can be used, and as whom. Never fails: the app adapts to what it says.
  r.get("/status", async (req, res) => {
    const status = await connectionStatus(req.query.refresh === "1");
    let me = null;
    if (status.connected) {
      try {
        const identity = await identityFor(req.user);
        me = { agentId: identity.agentId, name: identity.name };
      } catch (error) {
        me = { agentId: null, error: error.message };
      }
    }
    res.json({
      ...status,
      me,
      panelUrl: req.user.role === "admin" ? omniPanelUrl() : undefined,
    });
  });

  // Omnicanal's screens as entries of the administration's own menu, which opens them inside its
  // page (one administration). Omnicanal decides which ones: the screens this administrator has and
  // the instance has on. Its user administration and the operator portal are not listed: the team
  // is managed in this site (Equipo).
  const NOT_LISTED = new Set(["admin", "platform"]);
  r.get("/menu", admin, async (req, res) => {
    try {
      const status = await connectionStatus();
      if (!status.connected) return res.json({ connected: false, entries: [] });
      const { entries = [] } = (await omniRequest(await identityFor(req.user), "/nav")) || {};
      res.json({
        connected: true,
        entries: entries
          .filter((e) => !NOT_LISTED.has(e.key) && typeof e.path === "string" && e.path.startsWith("/"))
          .map((e) => ({ key: e.key, label: String(e.label), group: e.group, path: e.path })),
      });
    } catch (error) {
      res.json({ connected: false, entries: [], error: error.message });
    }
  });

  // ── Administration ──────────────────────────────────────────────────────────────────────
  r.get("/settings", admin, async (req, res) => {
    const settings = await omniSettings();
    res.json({ ...settings, defaultPublicUrl: origin(req), panelUrl: omniPanelUrl(), configured: omniConfigured() });
  });

  r.put("/settings", admin, async (req, res) => {
    const url = text(req.body.publicUrl, 300).replace(/\/+$/, "");
    if (url && !/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(url))
      throw new InputError("La dirección pública debe empezar por https:// y no llevar parámetros.");
    if (typeof req.body.autoSync !== "boolean" || typeof req.body.pushLeads !== "boolean")
      throw new InputError("Opciones inválidas.");
    await transaction(async (c) => {
      await c.query(
        "INSERT INTO settings(id,value) VALUES('omnicanal',$1) ON CONFLICT(id) DO UPDATE SET value=settings.value || $1",
        [JSON.stringify({ publicUrl: url, autoSync: req.body.autoSync, pushLeads: req.body.pushLeads })],
      );
      await audit(c, req.user, "omnicanal.settings.updated");
    });
    res.json({ ok: true });
  });

  // Omnicanal's human agents next to this site's team, to link them.
  r.get("/agents", admin, async (_req, res) => {
    clearAgentCache();
    const [agents, team] = await Promise.all([
      omniAgents(true),
      query("SELECT id,name,username,role,active,omni_agent_id FROM admin_users ORDER BY active DESC,name"),
    ]);
    res.json({
      agents: agents.map((a) => ({ id: a.id, name: a.name, email: a.email || "", role: a.role, isActive: a.isActive, status: a.status })),
      team: team.rows,
    });
  });

  r.put("/mapping/:userId", admin, async (req, res) => {
    if (!isUuid(req.params.userId)) throw new InputError("Usuario no encontrado.", 404);
    const agentId = req.body.agentId === null ? null : Number(req.body.agentId);
    if (agentId !== null && !intParam(agentId)) throw new InputError("Agente inválido.");
    if (agentId !== null && !(await omniAgents(true)).some((a) => a.id === agentId))
      throw new InputError("Ese agente no existe en Omnicanal.");
    await transaction(async (c) => {
      if (agentId !== null) {
        const taken = await c.query("SELECT name FROM admin_users WHERE omni_agent_id=$1 AND id<>$2", [agentId, req.params.userId]);
        if (taken.rows[0]) throw new InputError(`Ese agente ya está vinculado a ${taken.rows[0].name}.`, 409);
      }
      const updated = await c.query("UPDATE admin_users SET omni_agent_id=$1 WHERE id=$2", [agentId, req.params.userId]);
      if (!updated.rowCount) throw new InputError("Usuario no encontrado.", 404);
      await audit(c, req.user, "omnicanal.agent.linked", req.params.userId);
    });
    res.json({ ok: true });
  });

  r.post("/sync", admin, async (req, res) => {
    res.json(await syncInventory(origin(req)));
  });

  // ── Inbox ─────────────────────────────────────────────────────────────────────────────────
  // mine: assigned to the salesperson's agent. general: every chat still open, to take one.
  r.get("/conversations", async (req, res) => {
    const scope = ["mine", "general", "resolved"].includes(req.query.scope) ? req.query.scope : "mine";
    const identity = await identityFor(req.user, { requireAgent: scope === "mine" && req.user.role !== "admin" });
    const search = text(req.query.search, 80);
    const extra = search ? `&search=${encodeURIComponent(search)}` : "";
    let list;
    if (scope === "mine") {
      if (!identity.agentId) throw new InputError("Vincula tu usuario a un agente de Omnicanal para tener chats propios.", 403);
      list = (await omniRequest(identity, `/conversations?agentId=${identity.agentId}&status=all${extra}`)).filter((c) =>
        OPEN_STATUSES.includes(c.status),
      );
    } else if (scope === "resolved") {
      const mine = identity.agentId ? `&agentId=${identity.agentId}` : "";
      list = await omniRequest(identity, `/conversations?status=resolved${mine}${extra}`);
    } else {
      const parts = await Promise.all(
        OPEN_STATUSES.map((s) => omniRequest(identity, `/conversations?status=${s}${extra}`)),
      );
      list = parts.flat();
    }
    list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json({ agentId: identity.agentId, conversations: list.slice(0, 150).map(conversationView) });
  });

  r.get("/conversations/:cid", async (req, res) => {
    const identity = await identityFor(req.user);
    const id = req.params.cid;
    const [conversation, messages] = await Promise.all([
      omniRequest(identity, `/conversations/${id}`),
      omniRequest(identity, `/conversations/${id}/messages`),
    ]);
    // Opening someone else's chat to read it must not clear their unread mark.
    if (conversation.unreadCount && (conversation.agentId === identity.agentId || conversation.agentId == null))
      await omniRequest(identity, `/conversations/${id}/read`, { method: "POST" }).catch(() => {});
    res.json({
      agentId: identity.agentId,
      conversation: conversationView(conversation),
      messages: (messages || []).slice(-300).map(messageView),
    });
  });

  r.post("/conversations/:cid/messages", async (req, res) => {
    const content = text(req.body.content, 4000);
    if (!content) throw new InputError("Escribe un mensaje.");
    const identity = await identityFor(req.user);
    const sent = await omniRequest(identity, `/conversations/${req.params.cid}/messages`, {
      method: "POST",
      body: { content, type: "text" },
    });
    res.status(201).json(messageView(sent));
  });

  r.post("/conversations/:cid/claim", async (req, res) => {
    const identity = await identityFor(req.user, { requireAgent: true });
    const conversation = await omniRequest(identity, `/conversations/${req.params.cid}/claim`, { method: "POST" });
    res.json(conversationView(conversation));
  });

  r.post("/conversations/:cid/resolve", async (req, res) => {
    const identity = await identityFor(req.user);
    const conversation = await omniRequest(identity, `/conversations/${req.params.cid}/resolve`, { method: "POST" });
    res.json(conversationView(conversation));
  });

  // Shares a vehicle of the catalogue in the chat: title, price, mileage and its public page.
  r.post("/conversations/:cid/vehicle", async (req, res) => {
    if (!isUuid(req.body.vehicleId)) throw new InputError("Selecciona un vehículo.");
    const { rows } = await query("SELECT id,data FROM vehicles WHERE id=$1 AND status IN ('available','reserved')", [
      req.body.vehicleId,
    ]);
    if (!rows[0]) throw new InputError("Ese vehículo ya no está publicado.", 404);
    const identity = await identityFor(req.user);
    const sent = await omniRequest(identity, `/conversations/${req.params.cid}/messages`, {
      method: "POST",
      body: { content: vehicleMessage(rows[0], await publicUrl(req)), type: "text" },
    });
    res.status(201).json(messageView(sent));
  });

  // Attachments (photos, voice notes, documents) are fetched as the salesperson and served
  // sandboxed, so a file a customer sent can never run in this site's origin.
  r.get("/media/:file", async (req, res) => {
    if (!isMediaFile(req.params.file)) return res.status(404).json({ error: "No encontrado." });
    const identity = await identityFor(req.user);
    const upstream = await omniRequest(identity, `/media/${req.params.file}`, { raw: true });
    const type = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!SAFE_MEDIA.test(type)) return res.status(415).json({ error: "Tipo de archivo no admitido." });
    res.set({
      "Content-Type": type,
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    });
    res.send(Buffer.from(await upstream.arrayBuffer()));
  });

  // ── Appointments the virtual agent booked on WhatsApp/Instagram/Facebook ────────────────
  // The agenda is one table the site and Omnicanal share, so these are its "pending" rows: what
  // the virtual agent booked and nobody on the team has taken yet.
  r.get("/appointments", async (req, res) => {
    const params = [];
    let where = "a.status='pending' AND a.starts_at>now()-interval '1 day'";
    if (req.user.role !== "admin") where += ` AND (a.seller_id=$${params.push(req.user.id)} OR a.seller_id IS NULL)`;
    const { rows } = await query(
      `SELECT a.id,a.customer_name,a.customer_phone,a.omni_conversation_id,a.service,a.notes,a.starts_at,a.duration_minutes,a.status,a.source,su.name seller_name
       FROM appointments a LEFT JOIN admin_users su ON su.id=a.seller_id WHERE ${where} ORDER BY a.starts_at LIMIT 200`,
      params,
    );
    res.json(
      rows.map((a) => ({
        id: a.id,
        contactName: a.customer_name,
        contactPhone: a.customer_phone,
        conversationId: a.omni_conversation_id ?? null,
        agentName: a.seller_name || "",
        service: a.service,
        notes: a.notes || "",
        startsAt: a.starts_at,
        local: local(a.starts_at),
        durationMinutes: a.duration_minutes,
        status: a.status,
        source: a.source,
      })),
    );
  });

  // Takes a pending booking into the agenda: it counts for the salesperson, and Omnicanal sees the
  // same row as confirmed and assigned to their agent.
  r.post("/appointments/:id/confirm", async (req, res) => {
    if (!isUuid(req.params.id)) throw new InputError("Esa cita no existe.", 404);
    const kind = APPOINTMENT_KINDS.includes(req.body.kind) ? req.body.kind : "visit";
    if (req.body.vehicleId != null && req.body.vehicleId !== "" && !isUuid(req.body.vehicleId)) throw new InputError("Vehículo inválido.");
    await confirmAppointment(req.user, req.params.id, {
      kind,
      vehicleId: req.body.vehicleId || null,
      sellerId: req.user.role === "admin" && isUuid(req.body.sellerId) ? req.body.sellerId : null,
    });
    res.status(201).json(await appointmentView(req.params.id));
  });

  return r;
}

