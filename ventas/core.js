// What every screen of the team's app shares: session state, the API, formatting, the bottom
// sheet, the toast and the form builders. Same session, CSRF token and API as the panel.
export const $ = (id) => document.getElementById(id);
export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd = (n) => money0.format(Number(n) || 0);
export const usd2 = (n) => money2.format(Number(n) || 0);
export const num = (n) => new Intl.NumberFormat("en-US").format(Number(n) || 0);
export const TZ = "America/New_York";
export const todayISO = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const nowTime = () =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
export const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
export const dayLabel = (iso, opts = { weekday: "long", day: "numeric", month: "long" }) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("es-US", { ...opts, timeZone: "UTC" });
export const shortDate = (instant) =>
  new Date(instant).toLocaleString("es-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
export function ago(instant) {
  const s = Math.max(0, (Date.now() - new Date(instant)) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d`;
  return new Date(instant).toLocaleDateString("es-US", { timeZone: TZ, day: "numeric", month: "short" });
}
export function until(instant) {
  const s = (new Date(instant) - Date.now()) / 1000;
  if (s <= 0) return "vencida";
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600);
  if (d) return `vence en ${d} d ${h} h`;
  if (h) return `vence en ${h} h`;
  return `vence en ${Math.max(1, Math.floor(s / 60))} min`;
}
export const digits = (p) => String(p || "").replace(/\D/g, "");
export const intl = (p) => {
  const d = digits(p);
  return d.length === 10 ? "1" + d : d;
};
export const telLink = (p) => (digits(p).length >= 7 ? `tel:+${intl(p)}` : "");
export const waLink = (p, text = "") =>
  digits(p).length >= 8 ? `https://wa.me/${intl(p)}${text ? "?text=" + encodeURIComponent(text) : ""}` : "";
export const initials = (name) =>
  String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
export const title = (v) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
export const hasPrice = (v) => !v.priceOnRequest && Number(v.price) > 0;
export const priceText = (v) => (hasPrice(v) ? usd(v.price) : "Consultar precio");
export const publicLink = (id) => `${location.origin}/?v=${id}`;
export const localized = (x) => (typeof x === "string" ? x : x?.es || x?.en || "");

// ── Session state and roles ─────────────────────────────────────────────────────────────────
export const S = {
  user: null,
  team: [],
  catalog: [],
  crm: null,
  dealer: null,
  page: "today",
  ticket: 0,
};
export const ROLE_LABEL = { admin: "Administración", sales: "Ventas", service: "Servicio" };
export const ROLE_TONE = { admin: "", sales: "info", service: "violet" };
export const isAdmin = () => S.user?.role === "admin";
export const isService = () => S.user?.role === "service";
// Reservations, sales, quotes and web inquiries (the server checks the same: server/domain.js).
export const canSell = () => ["admin", "sales"].includes(S.user?.role);
export const stale = (current) => current !== S.ticket || !S.user;

// The main module fills these in; the screens call them.
export const hooks = { render: () => {}, go: () => {}, onSignedOut: () => {} };
export const render = () => hooks.render();
export const go = (key, extra) => hooks.go(key, extra);

export async function api(url, options = {}) {
  const headers = { ...options.headers };
  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  if (S.user?.csrf) headers["X-CSRF-Token"] = S.user.csrf;
  const res = await fetch(url, { ...options, body, headers, credentials: "same-origin" });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("No se pudo conectar. Comprueba tu conexión.");
  }
  if (!res.ok) {
    if (res.status === 401 && url !== "/api/auth/login") {
      S.user = null;
      hooks.onSignedOut();
    }
    throw new Error(data.error || "No se pudo completar la operación.");
  }
  return data;
}

let toastTimer;
export function notify(message, bad = false) {
  const t = $("toast");
  t.textContent = message;
  t.classList.toggle("bad", bad);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 5000);
}
export function sheet(heading, html) {
  // Each sheet sets its own handlers; one left by the previous sheet must not fire in this one.
  $("sheetBody").onclick = null;
  $("sheetTitle").textContent = heading;
  $("sheetBody").innerHTML = html;
  $("sheetBody").scrollTop = 0;
  if (!$("sheet").open) $("sheet").showModal();
  $("sheet").scrollTop = 0;
  return $("sheetBody");
}
export const closeSheet = () => $("sheet").open && $("sheet").close();
export async function busy(form, fn) {
  const button = form.querySelector('button[type="submit"]');
  const error = form.querySelector(".error");
  if (button) button.disabled = true;
  if (error) error.textContent = "";
  try {
    await fn();
  } catch (e) {
    if (error) error.textContent = e.message;
    else notify(e.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}
export const formData = (form) => Object.fromEntries(new FormData(form));
export const empty = (heading, body, extra = "") => `<div class="empty"><h3>${heading}</h3><p>${body}</p>${extra}</div>`;
export const field = (label, name, value = "", type = "text", extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export const options = (list, value) =>
  list.map(([k, v]) => `<option value="${esc(k)}" ${String(value ?? "") === String(k) ? "selected" : ""}>${esc(v)}</option>`).join("");
export const select = (label, name, list, value, extra = "") =>
  `<label>${label}<select name="${name}" ${extra}>${options(list, value)}</select></label>`;
export const check = (label, name, checked) =>
  `<label class="check"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}>${label}</label>`;
// People to pick for a reservation or a sale (sellers) or for an appointment (anyone).
export const peopleOptions = (blank, { sellers = false } = {}) => [
  ...(blank ? [["", blank]] : []),
  ...S.team.filter((u) => !sellers || u.role !== "service").map((u) => [u.id, u.name]),
];
export function contactLinks(phone, email, extra = "") {
  const links = extra ? [extra] : [];
  if (telLink(phone)) links.push(`<a class="secondary sm" href="${telLink(phone)}">Llamar</a>`);
  if (waLink(phone)) links.push(`<a class="secondary sm" href="${waLink(phone)}" target="_blank" rel="noopener">WhatsApp</a>`);
  if (email) links.push(`<a class="secondary sm" href="mailto:${esc(email)}">Email</a>`);
  return links.length ? `<div class="contact-links">${links.join("")}</div>` : "";
}

// Buttons anywhere in the page or the sheet carry data-act; each screen registers what it does.
export const actions = {};
export const on = (name, fn) => (actions[name] = fn);

// ── The catalogue, shared by every screen that picks a vehicle ───────────────────────────────
export async function loadCatalog(force = false) {
  if (force || !S.catalog.length) S.catalog = await api("/api/admin/catalog");
  return S.catalog;
}
export const forgetCatalog = () => (S.catalog = []);
export async function vehicleChoices(filter = (v) => v.status === "available" && !v.demo) {
  await loadCatalog();
  return S.catalog.filter(filter).map((v) => [v.id, `${v.stock} · ${title(v)} · ${priceText(v)}`]);
}

// ── Labels ───────────────────────────────────────────────────────────────────────────────────
export const KIND = { testdrive: "Prueba de manejo", visit: "Visita", delivery: "Entrega", call: "Llamada", followup: "Seguimiento", service: "Servicio / taller" };
export const APPT_STATUS = { pending: "Por confirmar", confirmed: "Confirmada", completed: "Completada", no_show: "No asistió", cancelled: "Cancelada" };
export const APPT_TONE = { pending: "warn", confirmed: "info", completed: "ok", no_show: "bad", cancelled: "" };
export const HOLD_STATUS = { active: "Activa", released: "Liberada", expired: "Vencida", converted: "Vendida" };
export const HOLD_TONE = { active: "warn", released: "", expired: "bad", converted: "ok" };
export const VEHICLE_STATUS = { draft: "En revisión", available: "Disponible", reserved: "Reservado", sold: "Vendido", archived: "Archivado" };
export const VEHICLE_TONE = { draft: "violet", available: "ok", reserved: "warn", sold: "info", archived: "" };
export const BODIES = [["suv", "SUV"], ["sedan", "Sedán"], ["truck", "Pickup"], ["coupe", "Coupé"], ["hatch", "Hatchback"], ["van", "Minivan"], ["electric", "Eléctrico"]];
export const CONDITIONS = [["used", "Usado"], ["new", "Nuevo"], ["certified", "Certificado"]];
export const FUELS = [["gas", "Gasolina"], ["diesel", "Diésel"], ["hybrid", "Híbrido"], ["electric", "Eléctrico"]];

// ── Icons (stroke, 24 × 24) ──────────────────────────────────────────────────────────────────
export const svg = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONS = {
  today: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  catalog: svg('<path d="M5 16l1.5-5h11L19 16"/><rect x="3" y="16" width="18" height="4" rx="1.5"/><circle cx="7" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/><path d="M8 11l1-3h6l1 3"/>'),
  agenda: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  holds: svg('<path d="M7 3h10v18l-5-4-5 4z"/>'),
  chats: svg('<path d="M4 5h16v11H8l-4 4z"/><path d="M8 10h8M8 13h5"/>'),
  leads: svg('<path d="M4 4h16v16H4z"/><path d="M4 9h16M9 4v16"/>'),
  account: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  more: svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'),
  quotes: svg('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h4"/>'),
  units: svg('<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/>'),
  team: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.6-5.5 6.5-5.5s5.5 2 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.3.2 4 1.8 4.6 4.5"/>'),
  business: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13.5" r="3.8"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  share: svg('<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>'),
  whatsapp: svg('<path d="M20 11.6a8.3 8.3 0 0 1-12.3 7.3L3.5 20l1.2-4A8.3 8.3 0 1 1 20 11.6z"/><path d="M9 8.6c.2 2.9 3.2 6 6.2 6.3l.8-1.6-1.8-.9-.9.8c-1-.4-2.2-1.6-2.6-2.6l.8-.9-.9-1.8z"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  filter: svg('<path d="M3 5h18l-7 8v6l-4 2v-8z"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  wrench: svg('<path d="M14.7 6.3a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3z"/><path d="M14.7 6.3L17 4l3 3-2.3 2.3"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>'),
  logout: svg('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>'),
};
