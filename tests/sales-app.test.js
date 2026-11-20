import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import express from "express";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
const databaseUrl = process.env.DATABASE_URL;
const SECRET = "omni-" + randomBytes(16).toString("hex");

// A stand-in Omnicanal instance: it checks every token the way Omnicanal does and applies the
// same rules to who may answer or take a chat, so the site is tested against that behaviour.
function fakeOmnicanal() {
  const state = {
    calls: [],
    agents: [
      { id: 7, name: "Ana Agente", email: "ana@premier.test", type: "human", role: "agent", isActive: true, status: "online", activeChats: 0, createdAt: new Date() },
      { id: 8, name: "Beto Agente", email: "beto@premier.test", type: "human", role: "agent", isActive: true, status: "online", activeChats: 0, createdAt: new Date() },
      { id: 9, name: "Asistente IA", type: "virtual", role: "agent", isActive: true, status: "online", activeChats: 0, createdAt: new Date() },
      { id: 10, name: "Ex agente", email: "ex@premier.test", type: "human", role: "agent", isActive: false, status: "offline", activeChats: 0, createdAt: new Date() },
    ],
    contacts: [{ id: 900, name: "Cliente WhatsApp", phone: "12015550100", email: null }],
    // When true the CRM refuses new contacts, as it does while it is down.
    contactsDown: false,
    kbs: new Map(),
    conversations: [
      { id: 31, channel: "whatsapp", status: "bot", contactId: 900, contactName: "Cliente WhatsApp", contactPhone: "12015550100", agentId: 9, agentName: "Asistente IA", lastMessage: "¿Tienen SUV?", unreadCount: 2, updatedAt: new Date(), messagingWindowExpiresAt: new Date(Date.now() + 86400000) },
      { id: 32, channel: "instagram", status: "open", contactId: 901, contactName: "Cliente IG", contactPhone: null, agentId: 8, agentName: "Beto Agente", lastMessage: "Hola", unreadCount: 0, updatedAt: new Date(Date.now() - 60000), messagingWindowExpiresAt: new Date(Date.now() + 86400000) },
      { id: 33, channel: "facebook", status: "resolved", contactId: 902, contactName: "Cliente FB", contactPhone: null, agentId: 7, agentName: "Ana Agente", lastMessage: "Gracias", unreadCount: 0, updatedAt: new Date(Date.now() - 120000), messagingWindowExpiresAt: null },
    ],
    messages: {
      31: [
        { id: 1, conversationId: 31, sender: "contact", content: "¿Tienen SUV?", type: "text", mediaUrl: null, isInternal: false, isDeleted: false, isEdited: false, onChannel: true, status: "sent", createdAt: new Date() },
        { id: 2, conversationId: 31, sender: "contact", content: "", type: "image", mediaUrl: "/api/media/photo1.jpg", isInternal: false, isDeleted: false, isEdited: false, onChannel: true, status: "sent", createdAt: new Date() },
      ],
      32: [],
    },
    sales: [],
  };
  let nextId = 1000;
  const verify = (token) => {
    const [body, signature] = String(token).split(".");
    if (!body || !signature) return null;
    const expected = crypto.createHmac("sha256", SECRET).update(body).digest().toString("base64url");
    const a = Buffer.from(signature),
      b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp * 1000 > Date.now() ? p : null;
  };
  const app = express();
  app.use(express.json());
  app.use("/api", (req, res, next) => {
    const user = verify((req.get("authorization") || "").replace(/^Bearer /, ""));
    if (!user) return res.status(401).json({ error: "No autenticado." });
    req.user = user;
    state.calls.push({ method: req.method, path: req.path, query: req.query, body: req.body, user });
    next();
  });
  const conv = (id) => state.conversations.find((c) => c.id === Number(id));
  const forbidden = (user, c) => {
    if (user.role === "admin" || c.agentId === null || c.agentId === user.agentId) return null;
    return state.agents.find((a) => a.id === c.agentId)?.type === "virtual" ? null : "Esta conversación está asignada a otro agente.";
  };
  app.get("/api/auth/me", (req, res) => res.json(req.user));
  app.get("/api/config", (_req, res) =>
    res.json({ client: { name: "premier", business: { displayName: "Premier Line Motors" }, branding: { productName: "Premier Chat" } }, channels: ["whatsapp", "instagram", "facebook"], modules: ["inbox", "crm", "appointments"], core: { version: "1.0.0" } }),
  );
  app.get("/api/agents", (_req, res) => res.json(state.agents));
  app.get("/api/contacts", (req, res) => {
    const s = String(req.query.search || "").toLowerCase();
    res.json(state.contacts.filter((c) => !s || (c.phone || "").includes(s) || (c.email || "").toLowerCase().includes(s)));
  });
  app.post("/api/contacts", (req, res) => {
    if (state.contactsDown) return res.status(503).send("<html>Service Unavailable</html>");
    const c = { id: nextId++, ...req.body };
    state.contacts.push(c);
    res.status(201).json(c);
  });
  app.post("/api/knowledge-bases", (req, res) => {
    const kb = { id: nextId++, ...req.body };
    state.kbs.set(kb.id, kb);
    res.status(201).json(kb);
  });
  app.patch("/api/knowledge-bases/:id", (req, res) => {
    const kb = state.kbs.get(Number(req.params.id));
    if (!kb) return res.status(404).json({ error: "Knowledge base not found" });
    Object.assign(kb, req.body);
    res.json(kb);
  });
  app.get("/api/conversations", (req, res) => {
    let list = state.conversations;
    if (req.query.agentId) list = list.filter((c) => c.agentId === Number(req.query.agentId));
    if (req.query.status && req.query.status !== "all") list = list.filter((c) => c.status === req.query.status);
    res.json(list);
  });
  app.get("/api/conversations/:id", (req, res) => (conv(req.params.id) ? res.json(conv(req.params.id)) : res.status(404).json({ error: "Conversation not found" })));
  app.get("/api/conversations/:id/messages", (req, res) => res.json(state.messages[req.params.id] || []));
  app.post("/api/conversations/:id/read", (req, res) => {
    conv(req.params.id).unreadCount = 0;
    res.json(conv(req.params.id));
  });
  app.post("/api/conversations/:id/messages", (req, res) => {
    const c = conv(req.params.id);
    const blocked = forbidden(req.user, c);
    if (blocked) return res.status(403).json({ error: blocked });
    if (req.user.agentId && c.agentId !== req.user.agentId) Object.assign(c, { agentId: req.user.agentId, agentName: req.user.name, status: "open" });
    const m = { id: nextId++, conversationId: c.id, sender: "agent", content: req.body.content, type: req.body.type, mediaUrl: null, isInternal: false, isDeleted: false, isEdited: false, onChannel: true, status: "sent", createdAt: new Date() };
    (state.messages[c.id] ||= []).push(m);
    res.status(201).json(m);
  });
  app.post("/api/conversations/:id/claim", (req, res) => {
    if (!req.user.agentId) return res.status(403).json({ error: "Solo un agente puede tomar una conversación." });
    const c = conv(req.params.id);
    Object.assign(c, { agentId: req.user.agentId, agentName: req.user.name, status: "open" });
    res.json(c);
  });
  app.post("/api/conversations/:id/resolve", (req, res) => {
    conv(req.params.id).status = "resolved";
    res.json(conv(req.params.id));
  });
  app.post("/api/conversations/:id/sale", (req, res) => {
    state.sales.push({ id: Number(req.params.id), body: req.body, user: req.user });
    res.json(conv(req.params.id));
  });
  app.get("/api/analytics/reports", (_req, res) =>
    res.json({ byAgent: [{ agentId: 7, agentName: "Ana Agente", type: "human", conversations: 5, resolved: 3, resolutionRate: 60, messages: 21, avgFirstResponseMinutes: 4.2 }] }),
  );
  app.get("/api/media/:file", (req, res) => {
    if (req.params.file === "photo1.jpg") return res.type("image/jpeg").send(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    if (req.params.file === "evil.html") return res.type("text/html").send("<script>alert(1)</script>");
    res.status(404).json({ error: "Archivo no encontrado." });
  });
  return { app, state };
}

test("sales app, reservations, agenda, reports and the Omnicanal integration", { skip: !databaseUrl, timeout: 180000 }, async (t) => {
  const schema = "premier_test_" + randomBytes(6).toString("hex");
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query(`CREATE SCHEMA ${schema}`);
  const omni = fakeOmnicanal();
  const omniServer = omni.app.listen(5185, "127.0.0.1");
  const password = "Test-" + randomBytes(18).toString("hex");
  const proc = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      PORT: "5184",
      DATABASE_SCHEMA: schema,
      ADMIN_BOOTSTRAP_PASSWORD: password,
      NODE_ENV: "test",
      OMNICANAL_URL: "http://127.0.0.1:5185",
      OMNICANAL_SESSION_SECRET: SECRET,
      // The fake instance above, never an Omnicanal inside this process.
      OMNICANAL_DATABASE_URL: "",
      // The owner's real credentials in .env must not leak into the test server.
      ADMIN_PASSWORD: "",
      ADMIN_EMAIL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  proc.stdout.on("data", (x) => (logs += x));
  proc.stderr.on("data", (x) => (logs += x));
  const base = "http://127.0.0.1:5184";
  const sessions = {};
  const send = async (who, url, { method = "GET", body } = {}) => {
    const headers = {};
    const s = sessions[who];
    if (s) Object.assign(headers, { Cookie: s.cookie, "X-CSRF-Token": s.csrf });
    if (body) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    const r = await fetch(base + url, { method, body, headers });
    const raw = await r.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    return { status: r.status, data, response: r };
  };
  const login = async (who, username) => {
    const r = await send(null, "/api/auth/login", { method: "POST", body: { username, password } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    sessions[who] = { cookie: r.response.headers.get("set-cookie").split(";")[0], csrf: r.data.user.csrf, id: r.data.user.id };
  };
  const vehicleBody = (stock, extra = {}) => ({ stock, make: "Honda", model: "Pilot " + stock, year: 2023, status: "available", cats: ["suv"], price: 31000, miles: 12000, purchaseCost: 25000, ...extra });
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86400000));
  const eventually = async (check, label) => {
    for (let i = 0; i < 60; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.fail("Timed out: " + label);
  };
  const ids = {};
  try {
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(base + "/health")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
      if (i === 79) throw new Error("Server failed to start: " + logs);
    }

    await t.test("team, vehicles and the Omnicanal connection are set up", async () => {
      await login("admin", "admin");
      for (const [who, name] of [["ana", "Ana Ventas"], ["beto", "Beto Ventas"], ["carla", "Carla Ventas"]]) {
        assert.equal((await send("admin", "/api/admin/users", { method: "POST", body: { username: who, name, role: "sales", password } })).status, 201);
        await login(who, who);
      }
      for (const [key, stock, extra] of [["v1", "SA-1"], ["v2", "SA-2"], ["demo", "SA-DEMO", { demo: true }], ["v4", "SA-4"]]) {
        const r = await send("admin", "/api/admin/vehicles", { method: "POST", body: vehicleBody(stock, extra) });
        assert.equal(r.status, 201);
        ids[key] = r.data.id;
      }
      const status = await send("ana", "/api/admin/crm/status");
      assert.equal(status.data.connected, true);
      assert.equal(status.data.instance.name, "Premier Line Motors");
      assert.equal(status.data.panelUrl, undefined, "only administration sees the panel address");
      const me = omni.state.calls.find((c) => c.path === "/auth/me");
      assert.equal(me.user.role, "admin");
      assert.equal(me.user.agentId, null);
    });

    await t.test("administration links salespeople to their Omnicanal agents", async () => {
      assert.equal((await send("ana", `/api/admin/crm/mapping/${sessions.ana.id}`, { method: "PUT", body: { agentId: 7 } })).status, 403);
      assert.equal((await send("admin", `/api/admin/crm/mapping/${sessions.ana.id}`, { method: "PUT", body: { agentId: 7 } })).status, 200);
      assert.equal((await send("admin", `/api/admin/crm/mapping/${sessions.beto.id}`, { method: "PUT", body: { agentId: 8 } })).status, 200);
      assert.equal((await send("admin", `/api/admin/crm/mapping/${sessions.carla.id}`, { method: "PUT", body: { agentId: 7 } })).status, 409);
      assert.equal((await send("admin", `/api/admin/crm/mapping/${sessions.carla.id}`, { method: "PUT", body: { agentId: 999 } })).status, 400);
      const agents = await send("admin", "/api/admin/crm/agents");
      assert.deepEqual(agents.data.agents.map((a) => a.id), [7, 8, 10], "virtual agents are not people to link");
      assert.equal((await send("ana", "/api/admin/crm/status")).data.me.agentId, 7);
    });

    await t.test("a reservation holds the vehicle for one salesperson", async () => {
      const hold = { vehicleId: ids.v1, customerName: "Cliente Uno", customerPhone: "(201) 555-0111", deposit: 500, days: 3 };
      const r = await send("ana", "/api/admin/reservations", { method: "POST", body: hold });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      ids.hold1 = r.data.id;
      const other = await send("beto", "/api/admin/reservations", { method: "POST", body: hold });
      assert.equal(other.status, 409);
      assert.match(other.data.error, /Ana Ventas/);
      assert.equal((await send(null, "/api/inventory")).data.find((v) => v.id === ids.v1).status, "reserved");
      assert.equal((await send("ana", "/api/admin/reservations", { method: "POST", body: { ...hold, vehicleId: ids.demo } })).status, 409);
      const seenByBeto = (await send("beto", "/api/admin/catalog")).data.find((v) => v.id === ids.v1);
      assert.equal(seenByBeto.reservation.sellerName, "Ana Ventas");
      assert.equal(seenByBeto.reservation.customerName, undefined, "another salesperson doesn't see the customer");
      assert.equal((await send("ana", "/api/admin/catalog")).data.find((v) => v.id === ids.v1).reservation.customerName, "Cliente Uno");
      assert.equal((await send("beto", "/api/admin/reservations")).data.length, 0);
      assert.equal((await send("admin", "/api/admin/reservations")).data.length, 1);
      const v = (await send("admin", "/api/admin/vehicles")).data.find((x) => x.id === ids.v1);
      const edit = await send("admin", `/api/admin/vehicles/${ids.v1}`, { method: "PUT", body: { ...v, status: "available" } });
      assert.equal(edit.status, 409, "the panel can't silently drop a live reservation");
      assert.equal((await send("beto", `/api/admin/reservations/${ids.hold1}/release`, { method: "POST", body: {} })).status, 403);
    });

    await t.test("two salespeople reserving at once produce exactly one hold", async () => {
      const body = { vehicleId: ids.v2, customerName: "Rápido", customerPhone: "2015550122" };
      const results = await Promise.all([
        send("ana", "/api/admin/reservations", { method: "POST", body }),
        send("beto", "/api/admin/reservations", { method: "POST", body }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      const winner = results[0].status === 201 ? "ana" : "beto";
      const id = results.find((r) => r.status === 201).data.id;
      assert.equal((await send(winner, `/api/admin/reservations/${id}/release`, { method: "POST", body: { reason: "Desistió" } })).status, 200);
      assert.equal((await send(null, "/api/inventory")).data.find((v) => v.id === ids.v2).status, "available");
      const released = (await send("admin", "/api/admin/reservations?status=released")).data[0];
      assert.match(released.notes, /Liberada: Desistió/);
    });

    await t.test("only the holder or administration sells a reserved unit, and the sale is credited", async () => {
      const sale = { vehicleId: ids.v1, price: 30500, buyerName: "Cliente Uno", soldAt: tomorrow.slice(0, 10) };
      const blocked = await send("beto", "/api/admin/sales", { method: "POST", body: sale });
      assert.equal(blocked.status, 409);
      assert.match(blocked.data.error, /Ana Ventas/);
      const r = await send("ana", "/api/admin/sales", { method: "POST", body: { ...sale, soldAt: new Date().toISOString().slice(0, 10) } });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      const row = (await send("admin", "/api/admin/sales")).data.find((s) => s.id === r.data.id);
      assert.equal(row.seller_id, sessions.ana.id);
      assert.equal(row.seller_name, "Ana Ventas");
      assert.equal((await send("admin", "/api/admin/reservations?status=converted")).data[0].sale_id, r.data.id);
    });

    await t.test("reservations past their date return the vehicle to the catalogue", async () => {
      const r = await send("ana", "/api/admin/reservations", { method: "POST", body: { vehicleId: ids.v2, customerName: "Tarde", customerEmail: "tarde@example.com" } });
      assert.equal(r.status, 201);
      assert.equal((await send("ana", `/api/admin/reservations/${r.data.id}/extend`, { method: "POST", body: { days: 2 } })).status, 200);
      assert.equal((await send("ana", `/api/admin/reservations/${r.data.id}/extend`, { method: "POST", body: { days: 30 } })).status, 400);
      await db.query(`UPDATE ${schema}.reservations SET expires_at=now()-interval '1 minute' WHERE id=$1`, [r.data.id]);
      assert.equal((await send("ana", "/api/admin/reservations")).data.length, 0);
      assert.equal((await send(null, "/api/inventory")).data.find((v) => v.id === ids.v2).status, "available");
      assert.equal((await send("admin", "/api/admin/reservations?status=expired")).data[0].id, r.data.id);
    });

    await t.test("appointments avoid double booking and are the same rows Omnicanal reads", async () => {
      const appt = { kind: "testdrive", date: tomorrow, time: "10:00", durationMinutes: 60, vehicleId: ids.v2, customerName: "Prueba Uno", customerPhone: "+1 201 555 0133" };
      const r = await send("ana", "/api/admin/appointments", { method: "POST", body: appt });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      ids.appt = r.data.id;
      assert.equal(r.data.local_time, "10:00");
      assert.equal(r.data.sync_error, null);
      // The row itself is what Omnicanal's agenda shows: nothing is sent to it.
      assert.equal(r.data.status, "confirmed");
      assert.equal(r.data.source, "agent");
      assert.equal(r.data.agent_id, 7, "the seller's agent follows from the seller");
      assert.match(r.data.service, /Prueba de manejo · 2023 Honda Pilot SA-2/);
      assert.match(r.data.location, /River Street/);
      assert.ok(Number.isInteger(r.data.omni_appointment_id), "every appointment has Omnicanal's number");
      assert.ok(omni.state.contacts.some((c) => c.id === r.data.omni_contact_id && c.name === "Prueba Uno"), "the customer is a contact in the CRM");
      assert.equal((await send("ana", "/api/admin/appointments", { method: "POST", body: { ...appt, time: "10:30", vehicleId: null } })).status, 409);
      const sameCar = await send("beto", "/api/admin/appointments", { method: "POST", body: { ...appt, time: "10:30" } });
      assert.equal(sameCar.status, 409);
      assert.match(sameCar.data.error, /vehículo/);
      assert.equal((await send("beto", "/api/admin/appointments", { method: "POST", body: { ...appt, time: "10:30", vehicleId: ids.v4 } })).status, 201);
      assert.ok(!(await send("beto", `/api/admin/appointments?from=${tomorrow}&to=${tomorrow}`)).data.some((a) => a.id === ids.appt));
      assert.equal((await send("beto", `/api/admin/appointments/${ids.appt}`, { method: "PUT", body: { status: "completed" } })).status, 403);
      const done = await send("ana", `/api/admin/appointments/${ids.appt}`, { method: "PUT", body: { status: "completed" } });
      assert.equal(done.status, 200);
      assert.equal(done.data.status, "completed");
      // While the CRM is down the appointment is still saved, and the next edit links the contact.
      omni.state.contactsDown = true;
      const outage = await send("ana", "/api/admin/appointments", { method: "POST", body: { ...appt, time: "17:00", vehicleId: null, customerName: "Sin CRM" } });
      assert.equal(outage.status, 201, "an Omnicanal outage never loses the appointment");
      assert.equal(outage.data.omni_contact_id, null);
      assert.match(outage.data.sync_error, /Omnicanal/);
      omni.state.contactsDown = false;
      const retried = await send("ana", `/api/admin/appointments/${outage.data.id}`, { method: "PUT", body: { notes: "Ya hay CRM" } });
      assert.equal(retried.status, 200);
      assert.equal(retried.data.sync_error, null);
      assert.ok(retried.data.omni_contact_id, "the contact is linked once Omnicanal answers");
    });

    await t.test("the seller and Omnicanal's agent stay in step, whichever side changes it", async () => {
      const appts = `${schema}.appointments`;
      const row = async (id) => (await db.query(`SELECT seller_id,agent_id FROM ${appts} WHERE id=$1`, [id])).rows[0];
      // Omnicanal assigns an agent: the site shows that person as the seller.
      await db.query(`UPDATE ${appts} SET agent_id=8 WHERE id=$1`, [ids.appt]);
      assert.deepEqual(await row(ids.appt), { seller_id: sessions.beto.id, agent_id: 8 });
      // The site hands it back to another seller: the agent follows.
      await db.query(`UPDATE ${appts} SET seller_id=$2 WHERE id=$1`, [ids.appt, sessions.ana.id]);
      assert.deepEqual(await row(ids.appt), { seller_id: sessions.ana.id, agent_id: 7 });
      // An agent nobody on the site is linked to leaves the seller empty and keeps the agent.
      await db.query(`UPDATE ${appts} SET agent_id=10 WHERE id=$1`, [ids.appt]);
      assert.deepEqual(await row(ids.appt), { seller_id: null, agent_id: 10 });
      await db.query(`UPDATE ${appts} SET seller_id=$2 WHERE id=$1`, [ids.appt, sessions.ana.id]);
    });

    await t.test("appointments the virtual agent booked can be confirmed into the agenda", async () => {
      // What Omnicanal inserts: a name-less row for a contact, nothing about sellers or vehicles.
      const booked = await db.query(
        `INSERT INTO ${schema}.appointments(starts_at,duration_minutes,notes,status,omni_contact_id,omni_conversation_id,service,location,source)
         VALUES(now()+interval '2 days',60,'Quiere ver una SUV','pending',2000000000,31,'Prueba de manejo','Paterson','ai') RETURNING id,kind,customer_name,created_by,omni_appointment_id`,
      );
      const bookedId = booked.rows[0].id;
      assert.equal(booked.rows[0].kind, "visit");
      assert.equal(booked.rows[0].created_by, null);
      assert.ok(booked.rows[0].omni_appointment_id > 0);
      assert.equal(booked.rows[0].customer_name, "Cliente de Omnicanal", "no name to show until the CRM contact is read");
      const pending = await send("ana", "/api/admin/crm/appointments");
      assert.deepEqual(pending.data.map((a) => a.id), [bookedId]);
      assert.equal(pending.data[0].status, "pending");
      assert.equal(pending.data[0].conversationId, 31);
      assert.equal((await send("ana", "/api/admin/crm/appointments/not-an-id/confirm", { method: "POST", body: {} })).status, 404);
      const r = await send("ana", `/api/admin/crm/appointments/${bookedId}/confirm`, { method: "POST", body: { kind: "testdrive" } });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal(r.data.id, bookedId, "it is the same row, not a copy");
      assert.equal(r.data.status, "confirmed");
      assert.equal(r.data.omni_conversation_id, 31);
      assert.equal(r.data.agent_id, 7, "Omnicanal sees it assigned to Ana's agent");
      assert.equal(r.data.seller_name, "Ana Ventas");
      assert.match(r.data.notes, /Prueba de manejo · Quiere ver una SUV/, "what the customer asked for is kept");
      assert.equal((await send("ana", "/api/admin/crm/appointments")).data.length, 0);
      assert.equal((await send("beto", `/api/admin/crm/appointments/${bookedId}/confirm`, { method: "POST", body: {} })).status, 409);
      // A booking another seller already holds is not for Ana to take.
      const held = await db.query(
        `INSERT INTO ${schema}.appointments(starts_at,duration_minutes,status,omni_contact_id,service,source,agent_id)
         VALUES(now()+interval '3 days',60,'pending',2000000001,'Visita','ai',8) RETURNING id`,
      );
      assert.equal((await send("ana", "/api/admin/crm/appointments")).data.length, 0, "another seller's pending bookings are not listed");
      assert.equal((await send("ana", `/api/admin/crm/appointments/${held.rows[0].id}/confirm`, { method: "POST", body: {} })).status, 403);
      assert.equal((await send("admin", "/api/admin/crm/appointments")).data.length, 1);
    });

    await t.test("salespeople answer chats as their own agent", async () => {
      omni.state.calls.length = 0;
      const mine = await send("ana", "/api/admin/crm/conversations?scope=mine");
      assert.equal(mine.status, 200);
      assert.deepEqual(mine.data.conversations.map((c) => c.id), [], "resolved chats stay out of Mis chats");
      const call = omni.state.calls.find((c) => c.path === "/conversations");
      assert.equal(call.user.agentId, 7);
      assert.equal(call.user.role, "agent");
      assert.equal(call.user.name, "Ana Agente");
      const general = await send("ana", "/api/admin/crm/conversations?scope=general");
      assert.deepEqual(general.data.conversations.map((c) => c.id), [31, 32]);
      const thread = await send("ana", "/api/admin/crm/conversations/31");
      assert.equal(thread.data.messages[1].media, "/api/admin/crm/media/photo1.jpg");
      assert.equal(omni.state.conversations[0].unreadCount, 2, "reading a chat the bot owns doesn't clear its unread mark");
      const theirs = await send("ana", "/api/admin/crm/conversations/32/messages", { method: "POST", body: { content: "Hola" } });
      assert.equal(theirs.status, 403);
      assert.match(theirs.data.error, /otro agente/);
      const reply = await send("ana", "/api/admin/crm/conversations/31/messages", { method: "POST", body: { content: "¡Sí! Tenemos varias." } });
      assert.equal(reply.status, 201);
      assert.equal(omni.state.conversations[0].agentId, 7, "answering takes the chat, as in Omnicanal");
      const shared = await send("ana", "/api/admin/crm/conversations/31/vehicle", { method: "POST", body: { vehicleId: ids.v2 } });
      assert.equal(shared.status, 201);
      assert.match(shared.data.content, /2023 Honda Pilot SA-2/);
      assert.match(shared.data.content, new RegExp(`/\\?v=${ids.v2}`));
      assert.equal((await send("ana", "/api/admin/crm/conversations/31/vehicle", { method: "POST", body: { vehicleId: ids.v1 } })).status, 404, "a sold unit can't be offered");
      assert.equal((await send("beto", "/api/admin/crm/conversations/31/claim", { method: "POST" })).status, 200);
      assert.equal(omni.state.conversations[0].agentId, 8);
      assert.equal((await send("ana", "/api/admin/crm/conversations/abc")).status, 404);
    });

    await t.test("chat attachments are proxied sandboxed and only safe types pass", async () => {
      const img = await send("ana", "/api/admin/crm/media/photo1.jpg");
      assert.equal(img.status, 200);
      assert.equal(img.response.headers.get("content-type"), "image/jpeg");
      assert.match(img.response.headers.get("content-security-policy"), /sandbox/);
      assert.equal((await send("ana", "/api/admin/crm/media/evil.html")).status, 415);
      assert.equal((await send("ana", "/api/admin/crm/media/missing.jpg")).status, 404);
      assert.equal((await send(null, "/api/admin/crm/media/photo1.jpg")).status, 401);
    });

    await t.test("unlinked salespeople can't use the inbox; administration reads as the instance", async () => {
      const carla = await send("carla", "/api/admin/crm/conversations?scope=general");
      assert.equal(carla.status, 403);
      assert.match(carla.data.error, /no está vinculado/);
      assert.equal((await send("admin", "/api/admin/crm/conversations?scope=mine")).status, 403);
      const general = await send("admin", "/api/admin/crm/conversations?scope=general");
      assert.equal(general.status, 200);
      assert.equal(general.data.agentId, null);
    });

    await t.test("a sale from a chat reservation closes the sale in that conversation", async () => {
      const hold = await send("beto", "/api/admin/reservations", { method: "POST", body: { vehicleId: ids.v2, customerName: "Cliente WhatsApp", customerPhone: "12015550100", omniConversationId: 31 } });
      assert.equal(hold.status, 201);
      assert.equal((await send("beto", "/api/admin/sales", { method: "POST", body: { vehicleId: ids.v2, price: 30000, buyerName: "Cliente WhatsApp", soldAt: new Date().toISOString().slice(0, 10) } })).status, 201);
      await eventually(() => omni.state.sales.length === 1, "sale marked in Omnicanal");
      assert.equal(omni.state.sales[0].id, 31);
      assert.equal(omni.state.sales[0].user.agentId, 8);
      assert.match(omni.state.sales[0].body.product, /Honda Pilot SA-2/);
    });

    await t.test("web inquiries reach the CRM and are taken by one salesperson", async () => {
      assert.equal((await send(null, "/api/leads", { method: "POST", body: { kind: "testdrive", name: "Lead Web", phone: "973-555-0144", vehicle: ids.v4, date: tomorrow, time: "15:00" } })).status, 201);
      await eventually(() => omni.state.contacts.some((c) => c.name === "Lead Web"), "lead pushed to Omnicanal");
      assert.match(omni.state.contacts.find((c) => c.name === "Lead Web").notes, /Prueba de manejo[\s\S]*SA-4/);
      const lead = (await send("beto", "/api/admin/leads")).data.find((l) => l.name === "Lead Web");
      await eventually(async () => (await db.query(`SELECT omni_contact_id FROM ${schema}.leads WHERE id=$1`, [lead.id])).rows[0].omni_contact_id, "lead linked");
      assert.equal((await send("beto", `/api/admin/leads/${lead.id}/take`, { method: "POST", body: {} })).status, 200);
      assert.equal((await send("ana", `/api/admin/leads/${lead.id}/take`, { method: "POST", body: {} })).status, 409);
      assert.equal((await send("admin", `/api/admin/leads/${lead.id}/take`, { method: "POST", body: { userId: sessions.ana.id } })).status, 200);
      assert.equal((await send("ana", "/api/admin/leads")).data.find((l) => l.id === lead.id).assigned_name, "Ana Ventas");
    });

    await t.test("the virtual agents' inventory excludes demo units and follows every change", async () => {
      assert.equal((await send("ana", "/api/admin/crm/sync", { method: "POST" })).status, 403);
      const r = await send("admin", "/api/admin/crm/sync", { method: "POST" });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const kb = omni.state.kbs.get(r.data.knowledgeBaseId);
      assert.match(kb.content, /SA-4/);
      assert.ok(!kb.content.includes("SA-DEMO"));
      assert.ok(!kb.content.includes("SA-1"), "sold units leave the agent's inventory");
      assert.equal((await send("admin", "/api/admin/vehicles", { method: "POST", body: vehicleBody("SA-AUTO") })).status, 201);
      await eventually(() => kb.content.includes("SA-AUTO"), "automatic inventory sync");
      assert.equal(omni.state.kbs.size, 1, "the same knowledge base is updated");
    });

    await t.test("finance and team performance are for administration only", async () => {
      for (const url of ["/api/admin/finance", "/api/admin/performance"]) assert.equal((await send("ana", url)).status, 403);
      const f = await send("admin", "/api/admin/finance?days=30");
      assert.equal(f.status, 200);
      assert.equal(f.data.period.count, 2);
      assert.equal(Number(f.data.period.revenue), 60500);
      assert.equal(Number(f.data.period.margin), 60500 - 50000);
      assert.equal(f.data.months.length, 12);
      assert.equal(f.data.demoUnits, 1);
      const p = await send("admin", "/api/admin/performance?days=30");
      const ana = p.data.team.find((u) => u.name === "Ana Ventas");
      const beto = p.data.team.find((u) => u.name === "Beto Ventas");
      assert.equal(ana.sales, 1);
      assert.equal(Number(ana.revenue), 30500);
      assert.equal(beto.sales, 1);
      assert.equal(ana.omni.conversations, 5);
      assert.equal(beto.omni, null);
      const summary = await send("ana", "/api/admin/me/summary");
      assert.equal(summary.data.sales.count, 1);
    });

    await t.test("the sales app is served with the panel's security policy", async () => {
      const page = await send(null, "/ventas/");
      assert.equal(page.status, 200);
      assert.match(page.data, /Premier App/);
      const csp = page.response.headers.get("content-security-policy");
      assert.match(csp, /script-src 'self'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /font-src https:\/\/fonts.gstatic.com/, "the site's fonts, like the public page");
      for (const file of ["ventas.js", "core.js", "units.js", "quotes.js", "manifest.webmanifest", "icon-512.png"])
        assert.equal((await send(null, "/ventas/" + file)).status, 200, file);
      assert.equal((await send(null, "/js/quote-math.js")).status, 200, "the quote math is shared with the app");
      assert.equal((await send(null, "/api/admin/catalog")).status, 401);
      const app = await fetch(base + "/app", { redirect: "manual" });
      assert.equal(app.headers.get("location"), "/ventas/");
    });

    const jpeg = await sharp({ create: { width: 64, height: 40, channels: 3, background: "#4a5568" } }).jpeg().toBuffer();
    const photo = async (who, vehicleId) => {
      const form = new FormData();
      form.append("photo", new Blob([jpeg], { type: "image/jpeg" }), "lote.jpg");
      const r = await fetch(`${base}/api/admin/vehicles/${vehicleId}/photos`, { method: "POST", body: form, headers: { Cookie: sessions[who].cookie, "X-CSRF-Token": sessions[who].csrf } });
      return { status: r.status, data: await r.json() };
    };

    await t.test("the service profile loads units and keeps an agenda, but does not sell", async () => {
      assert.equal((await send("admin", "/api/admin/users", { method: "POST", body: { username: "sofi", name: "Sofi Servicio", role: "service", password } })).status, 201);
      assert.equal((await send("admin", "/api/admin/users", { method: "POST", body: { username: "nadie", name: "Nadie", role: "boss", password } })).status, 400);
      await login("sofi", "sofi");
      const r = await send("admin", "/api/admin/vehicles", { method: "POST", body: vehicleBody("SA-Q1", { price: 25000 }) });
      ids.q1 = r.data.id;
      for (const [method, url, body] of [
        ["POST", "/api/admin/reservations", { vehicleId: ids.q1, customerName: "C", customerPhone: "2015550100" }],
        ["GET", "/api/admin/reservations"],
        ["POST", "/api/admin/sales", { vehicleId: ids.q1, price: 1, buyerName: "C", soldAt: "2026-01-01" }],
        ["GET", "/api/admin/sales"],
        ["GET", "/api/admin/leads"],
        ["POST", "/api/admin/quotes", { vehicleId: ids.q1, customerName: "C", customerPhone: "2015550100" }],
        ["GET", "/api/admin/quotes"],
        ["GET", "/api/admin/users"],
      ])
        assert.equal((await send("sofi", url, { method, body })).status, 403, `${method} ${url}`);
      assert.equal((await send("sofi", "/api/admin/catalog")).status, 200);
      const appt = await send("sofi", "/api/admin/appointments", { method: "POST", body: { kind: "service", date: tomorrow, time: "08:00", durationMinutes: 120, customerName: "Cliente Taller", customerPhone: "2015550188", notes: "Cambio de aceite" } });
      assert.equal(appt.status, 201, JSON.stringify(appt.data));
      assert.equal(appt.data.kind, "service");
      assert.equal(appt.data.service, "Servicio / taller");
      assert.equal(appt.data.seller_id, sessions.sofi.id);
      const toService = await send("admin", "/api/admin/reservations", { method: "POST", body: { vehicleId: ids.q1, customerName: "C", customerPhone: "2015550100", sellerId: sessions.sofi.id } });
      assert.equal(toService.status, 400, "a reservation is never a service person's");
      const sum = await send("sofi", "/api/admin/me/summary");
      assert.equal(sum.status, 200);
      assert.deepEqual(sum.data.units, { drafts: 0, loaded: 0, published: 0 });
    });

    await t.test("units loaded from the lot wait for administration's details and price", async () => {
      const unit = { body: "suv", year: 2021, make: "Toyota", model: "RAV4", miles: 41000, vin: "2T3W1RFV0MW123456", ext: "Blanco", notes: "Rayón en la puerta trasera", engine: "2.5L 4 cil.", drive: "AWD" };
      const intake = await send("sofi", "/api/admin/intake", { method: "POST", body: { ...unit, price: 999, status: "available", featured: true } });
      assert.equal(intake.status, 201, JSON.stringify(intake.data));
      ids.intake = intake.data.id;
      let v = (await send("admin", "/api/admin/vehicles")).data.find((x) => x.id === ids.intake);
      assert.equal(v.status, "draft", "whatever the app sends, it is a draft");
      assert.equal(v.priceOnRequest, true);
      assert.equal(v.price, 0);
      assert.equal(v.featured, false);
      assert.match(v.stock, /^IN-\d{6}-[2-9A-HJ-NP-Z]{3}$/);
      assert.equal(v.intakeName, "Sofi Servicio");
      assert.equal(v.intakeNotes, "Rayón en la puerta trasera");
      assert.equal(v.engine, "2.5L 4 cil.");
      assert.deepEqual(v.cats, ["suv"]);
      assert.ok(!(await send(null, "/api/inventory")).data.some((x) => x.id === ids.intake), "a draft is not published");
      assert.ok(!(await send("ana", "/api/admin/catalog")).data.some((x) => x.id === ids.intake));
      assert.equal((await send("ana", "/api/admin/vehicles", { method: "POST", body: vehicleBody("SA-NOPE") })).status, 403, "details and price are administration's");
      assert.equal((await send("sofi", `/api/admin/vehicles/${ids.intake}`, { method: "PUT", body: { ...v, price: 1 } })).status, 403);
      assert.equal((await send("ana", `/api/admin/intake/${ids.intake}`, { method: "PUT", body: unit })).status, 403, "only whoever loaded it");
      assert.equal((await send("sofi", `/api/admin/intake/${ids.intake}`, { method: "PUT", body: { ...unit, model: "RAV4 Hybrid", miles: 41050, fuel: "hybrid" } })).status, 200);
      assert.equal((await send("sofi", "/api/admin/intake")).data.length, 1);
      assert.equal((await send("ana", "/api/admin/intake")).data.length, 0);
      assert.ok((await send("admin", "/api/admin/intake")).data.some((x) => x.id === ids.intake), "administration sees every draft");
      assert.equal((await send("sofi", "/api/admin/me/summary")).data.units.drafts, 1);

      const p1 = await photo("sofi", ids.intake);
      const p2 = await photo("sofi", ids.intake);
      assert.equal(p1.status, 201);
      assert.equal((await send("sofi", `/api/admin/vehicles/${ids.intake}/photos/order`, { method: "PUT", body: { ids: [p2.data.id, p1.data.id] } })).status, 200);
      assert.equal((await send("ana", `/api/admin/vehicles/${ids.intake}/photos/${p1.data.id}`, { method: "DELETE" })).status, 403);

      v = (await send("admin", "/api/admin/vehicles")).data.find((x) => x.id === ids.intake);
      assert.equal(v.model, "RAV4 Hybrid");
      assert.equal(v.fuel, "hybrid");
      assert.deepEqual(v.photos.map((p) => p.id), [p2.data.id, p1.data.id]);
      const pub = await send("admin", `/api/admin/vehicles/${ids.intake}`, { method: "PUT", body: { ...v, status: "available", price: 27500, msrp: 27500, priceOnRequest: false, purchaseCost: 21000 } });
      assert.equal(pub.status, 200, JSON.stringify(pub.data));
      const live = (await send(null, "/api/inventory")).data.find((x) => x.id === ids.intake);
      assert.equal(live.price, 27500);
      assert.equal(live.photos.length, 2);
      assert.ok(!JSON.stringify(live).includes("Rayón"), "the loader's notes never reach the public catalogue");
      assert.equal(live.intakeName, undefined);
      assert.equal((await send("sofi", `/api/admin/intake/${ids.intake}`, { method: "PUT", body: unit })).status, 409, "published: administration's now");
      assert.equal((await send("sofi", `/api/admin/vehicles/${ids.intake}/photos/${p1.data.id}`, { method: "DELETE" })).status, 403);
      assert.equal((await photo("ana", ids.intake)).status, 201, "anyone may add photos");
      assert.equal((await send("sofi", "/api/admin/me/summary")).data.units.published, 1);

      const mistake = await send("ana", "/api/admin/intake", { method: "POST", body: { ...unit, vin: "" } });
      assert.equal(mistake.status, 201);
      assert.equal((await send("sofi", `/api/admin/intake/${mistake.data.id}/discard`, { method: "POST", body: {} })).status, 403);
      assert.equal((await send("ana", `/api/admin/intake/${mistake.data.id}/discard`, { method: "POST", body: {} })).status, 200);
      assert.equal((await send("admin", "/api/admin/vehicles")).data.find((x) => x.id === mistake.data.id).status, "archived");
      assert.equal((await send("ana", "/api/admin/intake/vin/ABC")).status, 400);
    });

    await t.test("quotes use administration's price and open for the customer", async () => {
      assert.equal((await send("ana", "/api/admin/quote-settings", { method: "PUT", body: { taxRate: 1, term: 72 } })).status, 403);
      const st = await send("admin", "/api/admin/quote-settings", { method: "PUT", body: { taxRate: 6.625, docFee: 499, apr: 6.9, term: 72, validDays: 3, note: "Placas no incluidas." } });
      assert.equal(st.status, 200, JSON.stringify(st.data));
      assert.equal((await send("ana", "/api/admin/quote-settings")).data.taxRate, 6.625);
      const customer = { customerName: "Laura Cliente", customerPhone: "(201) 555-0177" };
      const unpriced = await send("admin", "/api/admin/vehicles", { method: "POST", body: vehicleBody("SA-NP", { priceOnRequest: true, price: 0, msrp: 0 }) });
      assert.equal((await send("ana", "/api/admin/quotes", { method: "POST", body: { vehicleId: unpriced.data.id, ...customer } })).status, 409, "no price, no quote");
      assert.equal((await send("ana", "/api/admin/quotes", { method: "POST", body: { vehicleId: ids.demo, ...customer } })).status, 409);
      const q = await send("ana", "/api/admin/quotes", { method: "POST", body: { vehicleId: ids.intake, ...customer, price: 1000, taxRate: 0, fees: 0, down: 2500, tradeIn: 4000, termMonths: 60, apr: 7.9, notes: "Incluye alfombras" } });
      assert.equal(q.status, 201, JSON.stringify(q.data));
      const f = q.data.figures;
      assert.equal(f.price, 27500, "a salesperson quotes administration's price");
      assert.equal(f.fees, 499);
      assert.equal(f.taxRate, 6.625);
      assert.equal(f.tax, 1556.88);
      assert.equal(f.total, 29555.88);
      assert.equal(f.balance, Math.round((f.total - 6500) * 100) / 100);
      assert.equal(f.termMonths, 60);
      assert.ok(f.monthly > 400 && f.monthly < 500, String(f.monthly));
      assert.match(q.data.code, /^COT-\d{5}$/);
      assert.match(q.data.link, /\/cotizacion\/[A-Za-z0-9_-]{24}$/);
      assert.equal(q.data.sellerName, "Ana Ventas");
      const qa = await send("admin", "/api/admin/quotes", { method: "POST", body: { vehicleId: ids.intake, customerName: "VIP", customerEmail: "vip@premier.test", price: 26000, taxRate: 0, fees: 0, termMonths: 0 } });
      assert.equal(qa.status, 201, JSON.stringify(qa.data));
      assert.equal(qa.data.figures.balance, 26000, "administration may quote another price");
      assert.equal((await send("beto", "/api/admin/quotes")).data.length, 0);
      assert.equal((await send("beto", `/api/admin/quotes/${q.data.id}`)).status, 404);
      assert.equal((await send("ana", "/api/admin/quotes")).data.length, 1);
      assert.equal((await send("admin", "/api/admin/quotes")).data.length, 2);
      assert.equal((await send("ana", "/api/admin/me/summary")).data.quotes.count, 1);
      const page = await send(null, new URL(q.data.link).pathname);
      assert.equal(page.status, 200);
      assert.match(page.data, /Laura Cliente/);
      assert.match(page.data, /Incluye alfombras/);
      assert.match(page.data, /Placas no incluidas/);
      assert.match(page.data, new RegExp(`/media/vehicles/${ids.intake}/`));
      assert.match(page.response.headers.get("x-robots-tag"), /noindex/);
      assert.match(page.response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
      assert.match((await send(null, new URL(q.data.link).pathname + "?lang=en")).data, /Prepared for/);
      assert.equal((await send(null, "/cotizacion/" + "x".repeat(24))).status, 404);
      assert.equal((await send(null, "/cotizacion/short")).status, 404);
    });

    await t.test("administration manages profiles and passwords and always keeps an administrator", async () => {
      assert.equal((await send("ana", `/api/admin/users/${sessions.sofi.id}`, { method: "PUT", body: { name: "x", role: "admin" } })).status, 403);
      assert.equal((await send("admin", `/api/admin/users/${sessions.sofi.id}`, { method: "PUT", body: { name: "Sofía Ventas", role: "sales" } })).status, 200);
      assert.equal((await send("sofi", "/api/admin/quotes")).status, 200, "a new profile applies at once");
      assert.equal((await send("admin", `/api/admin/users/${sessions.admin.id}`, { method: "PUT", body: { name: "Admin", role: "sales" } })).status, 400, "not one's own profile");
      assert.equal((await send("admin", `/api/admin/users/${sessions.admin.id}/password`, { method: "POST", body: { password: "x".repeat(20) } })).status, 400, "one's own password is changed in Mi cuenta");
      const fresh = "Nueva-" + password;
      assert.equal((await send("admin", `/api/admin/users/${sessions.carla.id}/password`, { method: "POST", body: { password: "corta" } })).status, 400);
      assert.equal((await send("admin", `/api/admin/users/${sessions.carla.id}/password`, { method: "POST", body: { password: fresh } })).status, 200);
      assert.equal((await send("carla", "/api/admin/me/summary")).status, 401, "her open sessions end");
      const relog = await send(null, "/api/auth/login", { method: "POST", body: { username: "carla", password: fresh } });
      assert.equal(relog.status, 200);
      sessions.carla = { cookie: relog.response.headers.get("set-cookie").split(";")[0], csrf: relog.data.user.csrf, id: relog.data.user.id };
      // Two administrators demoting each other at once: one of them stays.
      assert.equal((await send("admin", `/api/admin/users/${sessions.carla.id}`, { method: "PUT", body: { name: "Carla Admin", role: "admin" } })).status, 200);
      const results = await Promise.all([
        send("admin", `/api/admin/users/${sessions.carla.id}`, { method: "PUT", body: { name: "Carla Ventas", role: "sales" } }),
        send("carla", `/api/admin/users/${sessions.admin.id}`, { method: "PUT", body: { name: "Administración Premier", role: "sales" } }),
      ]);
      assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => [r.status, r.data])));
      const left = await db.query(`SELECT count(*)::integer n FROM ${schema}.admin_users WHERE role='admin' AND active`);
      assert.equal(left.rows[0].n, 1);
    });
  } finally {
    proc.kill("SIGTERM");
    await new Promise((r) => {
      if (proc.exitCode !== null) return r();
      proc.once("exit", r);
      setTimeout(() => {
        proc.kill("SIGKILL");
        r();
      }, 4000).unref();
    });
    omniServer.close();
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  }
});
