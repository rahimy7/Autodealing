import { randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

/** Public, synthetic sandbox. These credentials never authenticate a real user. */
export const REVIEW_EMAIL = "review@omniai.example";
export const REVIEW_PASSWORD = "OmniAI-Demo-2026!";
const PREFIX = "omniai-demo.";
const TTL = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 64;
const now = () => new Date().toISOString();
const user = { role: "admin", name: "Demo · datos ficticios", email: REVIEW_EMAIL, agentId: 1,
  views: ["dashboard", "inbox", "contacts", "products", "agents", "monitor"] };

function seed() {
  const createdAt = now();
  const contacts = ["Ana Ejemplo", "Carlos Demo", "Lucía Muestra", "Pedro Ejemplo"].map((name, i) => ({
    id: i + 1, name, email: `cliente${i + 1}@example.com`, phone: `+1202555010${i}`,
    company: "Empresa de demostración", address: "Dirección ficticia", city: "Ciudad Demo",
    avatar: null, birthday: null, tag: i === 0 ? "vip" : "lead", channels: ["whatsapp", "instagram", "facebook"],
    notes: "Datos ficticios. No corresponde a una persona real.", facts: [], interests: [], totalConversations: 1, createdAt,
  }));
  const previews = ["¿Pueden ayudarme a elegir un producto?", "Gracias, recibí la información.", "Quisiera consultar la disponibilidad.", "¿Cuál es el horario de atención?"];
  const conversations = contacts.map((c, i) => ({
    id: i + 1, channel: ["whatsapp", "instagram", "facebook", "whatsapp"][i],
    status: ["open", "resolved", "pending", "bot"][i], contactId: c.id, contactName: c.name,
    contactPhone: c.phone, contactAvatar: null, agentId: i === 2 ? null : 1,
    agentName: i === 2 ? null : "Equipo Demo", labelId: null, labelName: null, labelColor: null,
    activeOrder: null, sessionStartedAt: createdAt, lastCustomerMessageAt: createdAt,
    messagingWindowOpen: true, messagingWindowExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    lastMessage: previews[i], unreadCount: i === 0 ? 2 : 0, createdAt, updatedAt: createdAt,
  }));
  const messages = conversations.flatMap((c) => [
    { id: c.id * 10, conversationId: c.id, sender: "bot", content: "Bienvenido a la demostración de OmniAI. Todos los contactos y mensajes son ficticios. Los envíos se simulan y no salen a ningún canal.", type: "text", isInternal: true, isEdited: false, isDeleted: false, onChannel: false, status: "sent", createdAt },
    { id: c.id * 10 + 1, conversationId: c.id, sender: "contact", content: c.lastMessage, type: "text", isInternal: false, isEdited: false, isDeleted: false, onChannel: false, status: "sent", createdAt },
  ]);
  return { contacts, conversations, messages };
}
type Sandbox = ReturnType<typeof seed> & { expires: number };

/** No database, provider, filesystem or production auth imports are allowed here.
 * Every demo bearer request terminates here, including unsupported/expired ones.
 * Each login owns its own bounded, expiring in-memory copy of synthetic records.
 */
export function createReviewDemo(): RequestHandler {
  const sessions = new Map<string, Sandbox>();
  const equals = (a: string, b: string) => {
    const aa = Buffer.from(a), bb = Buffer.from(b);
    return aa.length === bb.length && timingSafeEqual(aa, bb);
  };
  return (req, res, next) => {
    const token = req.header("authorization")?.replace(/^Bearer /, "") ?? "";
    const login = req.method === "POST" && req.path === "/auth/login" &&
      String(req.body?.email ?? "").trim().toLowerCase() === REVIEW_EMAIL;
    if (!login && !token.startsWith(PREFIX)) { next(); return; }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-OmniAI-Demo", "synthetic-only");
    if (login) {
      if (!equals(String(req.body?.password ?? ""), REVIEW_PASSWORD)) {
        res.status(401).json({ error: "Credenciales de demostración inválidas." }); return;
      }
      for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
      if (sessions.size >= MAX_SESSIONS) {
        res.status(429).json({ error: "Demostración ocupada. Inténtalo más tarde." }); return;
      }
      const demoToken = PREFIX + randomBytes(32).toString("base64url");
      sessions.set(demoToken, { ...seed(), expires: Date.now() + TTL });
      res.json({ token: demoToken, user }); return;
    }
    const data = sessions.get(token);
    if (!data || data.expires <= Date.now()) {
      sessions.delete(token); res.status(401).json({ error: "Sesión de demostración vencida. Vuelve a iniciar sesión." }); return;
    }
    const path = req.path;
    const get = req.method === "GET";
    const match = path.match(/^\/(conversations|contacts)\/(\d+)(?:\/(.*))?$/);
    const id = match ? Number(match[2]) : 0;
    const search = String(req.query.search ?? "").toLowerCase();
    const ok = () => res.json({ ok: true });
    if (get && path === "/auth/me") { res.json(user); return; }
    if (path === "/auth/logout" && req.method === "POST") { sessions.delete(token); ok(); return; }
    if (get && path === "/conversations") {
      res.json(data.conversations.filter(c => (!search || `${c.contactName} ${c.lastMessage}`.toLowerCase().includes(search)) &&
        (!req.query.channel || req.query.channel === "all" || c.channel === req.query.channel) &&
        (!req.query.status || req.query.status === "all" || c.status === req.query.status) &&
        (!req.query.contactId || c.contactId === Number(req.query.contactId)) &&
        (!req.query.agentId || c.agentId === Number(req.query.agentId)) &&
        (req.query.read !== "unread" || c.unreadCount > 0) && (req.query.read !== "read" || c.unreadCount === 0)));
      return;
    }
    if (match?.[1] === "conversations") {
      const c = data.conversations.find(c => c.id === id);
      if (!c) { res.status(404).json({ error: "Conversación ficticia no encontrada." }); return; }
      const action = match[3];
      if (get && !action) { res.json(c); return; }
      if (get && ["followups", "templates"].includes(action ?? "")) { res.json([]); return; }
      if (action === "messages" && get) { res.json(data.messages.filter(m => m.conversationId === id)); return; }
      if (action === "messages" && req.method === "POST") {
        const content = String(req.body?.content ?? "").trim();
        if (!content || content.length > 10000 || (req.body?.type && req.body.type !== "text")) {
          res.status(400).json({ error: "En la demostración puedes enviar texto de hasta 10,000 caracteres. No se envía a clientes reales." }); return;
        }
        if (data.messages.length >= 500) { res.status(429).json({ error: "Límite de la demostración. Reinicia sesión para restablecerla." }); return; }
        const message = { id: 1000 + data.messages.length, conversationId: id, sender: "agent", content,
          type: "text", isInternal: false, isEdited: false, isDeleted: false, onChannel: false, status: "sent", createdAt: now() };
        data.messages.push(message); c.lastMessage = content; c.updatedAt = message.createdAt;
        res.status(201).json(message); return;
      }
      if (!get && ["read", "claim", "assign", "resolve", "escalate"].includes(action ?? "")) {
        if (action === "read") { c.unreadCount = 0; ok(); return; }
        c.status = action === "resolve" ? "resolved" : action === "escalate" ? "pending" : "open";
        c.agentId = action === "escalate" ? null : 1; c.agentName = c.agentId ? "Equipo Demo" : null;
        res.json(c); return;
      }
    }
    if (get && path === "/contacts") { res.json(data.contacts.filter(c => !search || `${c.name} ${c.email}`.toLowerCase().includes(search))); return; }
    if (match?.[1] === "contacts" && get && !match[3]) {
      const contact = data.contacts.find(c => c.id === id);
      if (contact) res.json(contact); else res.status(404).json({ error: "Contacto ficticio no encontrado." }); return;
    }
    if (path === "/contacts" && req.method === "POST") {
      if (data.contacts.length >= 100) { res.status(429).json({ error: "Límite de contactos de demostración." }); return; }
      const name = String(req.body?.name ?? "").trim().slice(0, 100);
      if (!name) { res.status(400).json({ error: "Escribe un nombre ficticio." }); return; }
      const contact = { ...data.contacts[0]!, id: 100 + data.contacts.length, name, email: "demo@example.com", phone: "+12025550199", tag: "lead", totalConversations: 0, createdAt: now() };
      data.contacts.push(contact); res.status(201).json(contact); return;
    }
    if (get && path === "/agents") {
      res.json([{ id: 1, name: "Equipo Demo", email: REVIEW_EMAIL, avatar: null, status: "online", activeChats: 2,
        channels: ["whatsapp", "instagram", "facebook"], type: "human", role: "admin", isActive: true, createdAt: now(), capabilities: [] }]); return;
    }
    if (get && path === "/plan") { res.json({ planName: "Demostración · datos ficticios", monthlyPrice: 0, messagesUsed: data.messages.length, messagesLimit: 500, agentsUsed: 1, agentsLimit: 1 }); return; }
    if (get && path === "/products/categories") { res.json([{ name: "Ejemplos", count: 2 }]); return; }
    if (get && path === "/products") {
      res.json(["Kit de oficina Demo", "Agenda de ejemplo"].map((name, i) => ({ id: i + 1, name, slug: `producto-demo-${i + 1}`,
        description: "Producto ficticio para explorar el catálogo. No está a la venta.", properties: ["Demostración"], uses: "Ejemplo",
        url: "https://www.rvrservice.com", imageUrl: null, categories: ["Ejemplos"], categoryPaths: ["Ejemplos"], specs: {}, priceCents: 0, priceCurrency: "USD", active: true, trackInventory: false, source: "manual" }))
        .filter(p => !search || p.name.toLowerCase().includes(search))); return;
    }
    if (get && path === "/analytics/summary") {
      res.json({ day: now().slice(0, 10), timeZone: "America/Santo_Domingo", salesClosedToday: 1,
        conversationsToday: 4, newConversationsToday: 2, openConversations: data.conversations.filter(c => c.status !== "resolved").length,
        botHandledToday: 1, avgResponseMinutes: 1.5, respondedToday: 3, messagesSentToday: 8, messagesReceivedToday: 12,
        newContactsToday: 2, totalContacts: data.contacts.length, campaignsSentToday: 0,
        totalConversations: 4, resolvedToday: 1, botHandled: 1, campaignsSent: 0,
        totalMessages: data.messages.length, totalContactsNew: 2, avgResponseTime: 1.5, resolutionRate: 25, activeAgents: 1 }); return;
    }
    if (get && path === "/analytics/channel-breakdown") { res.json(["whatsapp", "instagram", "facebook"].map((channel, i) => ({ channel, conversations: i === 0 ? 2 : 1, messages: i === 0 ? 8 : 4, sales: i === 0 ? 1 : 0 }))); return; }
    if (get && path === "/analytics/agent-performance") { res.json([{ agentId: 1, agentName: "Equipo Demo", agentType: "human", conversations: 4, salesClosed: 1, avgResponseMinutes: 1.5, respondedCount: 3, resolved: 1, resolutionRate: 25 }]); return; }
    if (get && path === "/analytics/daily-volume") { res.json(Array.from({ length: 7 }, (_, i) => ({ date: new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10), conversations: [2, 4, 3, 5, 3, 2, 4][i], messages: [8, 12, 9, 18, 10, 8, 16][i], sales: i % 2 }))); return; }
    if (get && ["/labels", "/groups", "/workflows", "/campaigns", "/custom-messages", "/knowledge-bases", "/logs", "/whatsapp/numbers", "/settings/whatsapp/numbers"].includes(path)) { res.json([]); return; }
    if (path === "/push/devices" || path === "/push/devices/unregister" || path === "/agents/me/presence") { ok(); return; }
    if (path === "/push/test") { res.json({ ok: false, devices: 0, detail: "La demostración aislada no registra dispositivos ni envía notificaciones reales." }); return; }
    // Fail closed: never pass a sandbox token into production routers, even for
    // media, webhooks, settings, a guessed real ID, or future API endpoints.
    res.status(403).json({ error: "Función no disponible en la demostración aislada. No se accede a datos ni canales reales." });
  };
}
