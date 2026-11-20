// Client for the dealership's Omnicanal instance (WhatsApp, Instagram, Facebook, AI agents, CRM).
// Nothing here touches this site's database, so it can be tested on its own.
import { createHmac } from "node:crypto";
import { InputError } from "./domain.js";

export class OmniError extends InputError {}

const b64u = (value) => Buffer.from(value).toString("base64url");

// Omnicanal sessions are stateless HMAC tokens signed with the instance's SESSION_SECRET
// (artifacts/api-server/src/lib/auth.ts in Omnicanal: signToken / verifyToken). Signing one
// here lets each salesperson act in Omnicanal as their own agent, so Omnicanal applies its own
// rules to them: who may answer a chat, who took it, presence and the agent reports.
// Tokens live five minutes and are minted per request; none is stored.
export function mintToken(secret, identity, ttlSeconds = 300, now = Date.now()) {
  const payload = {
    role: identity.role === "admin" ? "admin" : "agent",
    name: String(identity.name || ""),
    email: String(identity.email || ""),
    agentId: identity.agentId ?? null,
    exp: Math.floor(now / 1000) + ttlSeconds,
  };
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(createHmac("sha256", secret).update(body).digest())}`;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Where the Omnicanal panel lives on this site's domain when it runs inside this service.
export const EMBED_PREFIX = "/omnicanal";
const DEFAULT_EMBED_PORT = 8090;

// Omnicanal keeps its tables and types in this Postgres schema (omnicanal/lib/db/src/schema/
// pg-schema.ts), so it shares this site's database: the site's tables live in "public". The one
// table they do not each have is the agenda: `appointments` is the site's, in "public", and
// Omnicanal reads and writes it directly (omnicanal/lib/db/src/schema/appointments.ts).
export const OMNI_DB_SCHEMA = "omnicanal";

// Returns null when the integration is not configured; throws when it is configured wrong.
// - OMNICANAL_SESSION_SECRET alone: Omnicanal runs inside this service (server/omni-embed.js),
//   in this site's database, published under /omnicanal. It must be this database: the agenda is
//   one table that both read and write, so there is no other database to point it at.
// - OMNICANAL_URL + OMNICANAL_SESSION_SECRET: an Omnicanal instance that runs somewhere else. It
//   serves the chats, but it does not share the agenda.
export function omniConfig(env = process.env) {
  const raw = String(env.OMNICANAL_URL || "").trim();
  const secret = String(env.OMNICANAL_SESSION_SECRET || "");
  if (String(env.OMNICANAL_DATABASE_URL || "").trim())
    throw new Error(
      "OMNICANAL_DATABASE_URL ya no se usa: Omnicanal comparte la base del sitio, porque las citas son una sola tabla. Quítala del entorno.",
    );
  if (!raw && secret) {
    if (secret.length < 16) throw new Error("OMNICANAL_SESSION_SECRET es demasiado corta.");
    const databaseUrl = String(env.DATABASE_URL || "").trim();
    if (!databaseUrl) throw new Error("Falta DATABASE_URL para Omnicanal.");
    if (env.DATABASE_SCHEMA === OMNI_DB_SCHEMA)
      throw new Error(`DATABASE_SCHEMA no puede ser "${OMNI_DB_SCHEMA}": ese esquema es de Omnicanal.`);
    if (env.DATABASE_SCHEMA && env.DATABASE_SCHEMA !== "public")
      throw new Error('Omnicanal lee la agenda del sitio en el esquema "public": DATABASE_SCHEMA no puede ser otro.');
    const port = env.OMNICANAL_PORT ? Number(env.OMNICANAL_PORT) : DEFAULT_EMBED_PORT;
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error("OMNICANAL_PORT debe ser un puerto entre 1024 y 65535.");
    if (String(port) === String(env.PORT || 8080))
      throw new Error("OMNICANAL_PORT no puede ser el mismo puerto del sitio.");
    // Plain http is fine here: the request never leaves the container.
    return {
      url: `http://127.0.0.1:${port}`,
      secret,
      embedded: { port, databaseUrl, sharedDatabase: true },
    };
  }
  if (!raw && !secret) return null;
  if (!raw || !secret)
    throw new Error("Faltan OMNICANAL_URL u OMNICANAL_SESSION_SECRET.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("OMNICANAL_URL no es una dirección válida.");
  }
  const local = LOCAL_HOSTS.has(url.hostname) && env.NODE_ENV !== "production";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new Error("OMNICANAL_URL debe usar https://.");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("OMNICANAL_URL solo debe llevar el dominio de la instancia.");
  if (secret.length < 16)
    throw new Error("OMNICANAL_SESSION_SECRET es demasiado corta.");
  return { url: url.origin + url.pathname.replace(/\/+$/, ""), secret };
}

export function createClient({ url, secret, fetchImpl = fetch, timeoutMs = 10_000 }) {
  async function request(identity, path, { method = "GET", body, raw = false } = {}) {
    const headers = {
      Authorization: `Bearer ${mintToken(secret, identity)}`,
      Accept: raw ? "*/*" : "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetchImpl(`${url}/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch {
      throw new OmniError("No se pudo conectar con Omnicanal. Inténtalo de nuevo.", 502);
    }
    // 401 from Omnicanal means our signature was refused. It must never reach the browser as a
    // 401, which this site reads as "your own session ended".
    if (res.status === 401)
      throw new OmniError(
        "Omnicanal rechazó la clave de integración. OMNICANAL_SESSION_SECRET debe ser igual al SESSION_SECRET de la instancia.",
        502,
      );
    if (raw) {
      if (!res.ok) throw new OmniError("Archivo no disponible.", res.status === 404 ? 404 : 502);
      return res;
    }
    const payload = await res.text();
    let data = null;
    try {
      data = payload ? JSON.parse(payload) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const message =
        typeof data?.error === "string" && data.error
          ? data.error.slice(0, 300)
          : `Omnicanal respondió con un error (${res.status}).`;
      const status = [400, 403, 404, 409].includes(res.status) ? res.status : 502;
      throw new OmniError(message, status);
    }
    return data;
  }
  return { request, url };
}

// ── What the virtual agent knows about the inventory ────────────────────────────────────────
const CONDITION = { used: "usado", new: "nuevo", certified: "certificado" };
const BODY = {
  sedan: "sedán",
  suv: "SUV",
  truck: "pickup",
  coupe: "coupé / deportivo",
  hatch: "hatchback",
  van: "minivan / van",
  electric: "eléctrico",
};
const FUEL = { gas: "gasolina", diesel: "diésel", hybrid: "híbrido", electric: "eléctrico" };
const localized = (v) => (typeof v === "string" ? v : v?.es || v?.en || "");
const number = (n) => new Intl.NumberFormat("en-US").format(Number(n) || 0);
export const vehicleTitle = (d) =>
  [d.year, d.make, d.model, d.trim].filter(Boolean).join(" ");
export const vehicleLink = (publicUrl, id) =>
  publicUrl ? `${publicUrl.replace(/\/+$/, "")}/?v=${id}` : "";
const priceLine = (d) =>
  d.priceOnRequest || !Number(d.price)
    ? "Precio: a consultar con un vendedor"
    : `Precio: USD ${number(d.price)}`;

// Only units a customer can actually buy. Demo units are excluded on purpose: they are not real
// stock, and the agent would quote them to real customers.
export function inventoryKnowledge(vehicles, { dealer = {}, publicUrl = "", now = new Date(), timeZone = "America/New_York" } = {}) {
  const listed = vehicles
    .filter((v) => ["available", "reserved"].includes(v.status) && !v.data?.demo)
    .sort(
      (a, b) =>
        (a.status === "available" ? 0 : 1) - (b.status === "available" ? 0 : 1) ||
        (Number(b.data.year) || 0) - (Number(a.data.year) || 0),
    );
  const stamp = new Intl.DateTimeFormat("es-US", {
    timeZone,
    dateStyle: "long",
    timeStyle: "short",
  }).format(now);
  const lines = [
    `Inventario de vehículos de ${dealer.name || "el concesionario"}. Actualizado el ${stamp} (${timeZone}).`,
    "El sistema del concesionario genera esta lista cada vez que cambia el inventario y reemplaza cualquier versión anterior.",
    "- Ofrece solo los vehículos de esta lista. Si preguntan por uno que no aparece, di que no está disponible ahora y ofrece opciones parecidas o que un vendedor le avise.",
    "- Un vehículo «reservado» lo apartó otro cliente: no lo ofrezcas como disponible; ofrece avisar si se libera.",
    "- Los precios están en dólares (USD). Para financiamiento, intercambio, impuestos o condiciones, ofrece que un vendedor le contacte.",
    "- Para ver un vehículo en persona, ofrece agendar una prueba de manejo o una visita.",
  ];
  if (dealer.address || dealer.city)
    lines.push(`Dirección: ${[dealer.address, dealer.city].filter(Boolean).join(", ")}.`);
  if (dealer.phone) lines.push(`Teléfono: ${dealer.phone}.`);
  lines.push("");
  if (!listed.length) {
    lines.push("En este momento no hay vehículos confirmados a la venta. Ofrece que un vendedor le contacte.");
    return lines.join("\n");
  }
  lines.push(`Vehículos (${listed.length}):`);
  for (const v of listed) {
    const d = v.data;
    const specs = [
      `${number(d.miles)} millas`,
      CONDITION[d.condition] || d.condition,
      ...(d.cats || []).map((c) => BODY[c] || c),
      FUEL[d.fuel] || d.fuel,
      localized(d.trans) && `transmisión ${localized(d.trans)}`,
      d.drive && `tracción ${d.drive}`,
      d.engine,
      d.seats && `${d.seats} asientos`,
    ].filter(Boolean);
    lines.push("", `• ${vehicleTitle(d)} — stock ${v.stock}`, `  ${priceLine(d)}`, `  ${specs.join(" · ")}`);
    const colors = [
      localized(d.ext) && `exterior ${localized(d.ext)}`,
      localized(d.int) && `interior ${localized(d.int)}`,
    ].filter(Boolean);
    if (colors.length) lines.push(`  Colores: ${colors.join(" · ")}`);
    const desc = localized(d.desc).replace(/\s+/g, " ").trim();
    if (desc) lines.push(`  Descripción: ${desc.length > 240 ? desc.slice(0, 237) + "…" : desc}`);
    lines.push(`  Estado: ${v.status === "reserved" ? "reservado" : "disponible"}`);
    const link = vehicleLink(publicUrl, v.id);
    if (link) lines.push(`  Fotos y ficha: ${link}`);
  }
  return lines.join("\n");
}

// The message a salesperson sends to share a vehicle in a chat.
export function vehicleMessage(v, publicUrl) {
  const d = v.data;
  const lines = [vehicleTitle(d)];
  lines.push(
    [
      d.priceOnRequest || !Number(d.price) ? "Precio a consultar" : `Precio: $${number(d.price)}`,
      `${number(d.miles)} millas`,
    ].join(" · "),
  );
  const link = vehicleLink(publicUrl, v.id);
  if (link) lines.push(`Fotos y detalles: ${link}`);
  return lines.join("\n");
}

// ── Shapes this site sends to the browser ───────────────────────────────────────────────────
const MEDIA_FILE = /^[\w.-]{1,200}$/;
export function mediaFile(mediaUrl) {
  if (typeof mediaUrl !== "string") return null;
  const file = mediaUrl.split("?")[0].split("/").pop();
  return MEDIA_FILE.test(file || "") ? file : null;
}
export const isMediaFile = (file) => MEDIA_FILE.test(file || "");
export function conversationView(c) {
  return {
    id: c.id,
    channel: c.channel,
    status: c.status,
    contactId: c.contactId,
    contactName: c.contactName || "",
    contactPhone: c.contactPhone || "",
    agentId: c.agentId ?? null,
    agentName: c.agentName || "",
    lastMessage: c.lastMessage || "",
    unreadCount: Number(c.unreadCount) || 0,
    updatedAt: c.updatedAt,
    windowExpiresAt: c.messagingWindowExpiresAt ?? null,
    labelName: c.labelName || "",
    saleClosedAt: c.saleClosedAt ?? null,
  };
}
export function messageView(m) {
  const file = mediaFile(m.mediaUrl);
  return {
    id: m.id,
    sender: m.sender,
    content: m.content || "",
    type: m.type,
    media: file ? `/api/admin/crm/media/${file}` : null,
    mediaName: m.mediaName || "",
    internal: Boolean(m.isInternal),
    deleted: Boolean(m.isDeleted),
    failed: m.status === "failed",
    failedReason: m.failedReason || "",
    createdAt: m.createdAt,
  };
}
// Attachments are only passed through when the browser can show them safely.
export const SAFE_MEDIA = /^(image\/(jpeg|png|webp|gif)|audio\/[\w.+-]+|video\/(mp4|webm|quicktime)|application\/pdf)$/;
