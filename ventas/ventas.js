// App de ventas: catalogue, agenda, reservations, web inquiries and the Omnicanal inbox.
// Same session, CSRF token and API as the administration panel.
const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd = (n) => money.format(Number(n) || 0);
const num = (n) => new Intl.NumberFormat("en-US").format(Number(n) || 0);
const TZ = "America/New_York";
const todayISO = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const nowTime = () =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dayLabel = (iso, opts = { weekday: "long", day: "numeric", month: "long" }) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("es-US", { ...opts, timeZone: "UTC" });
const shortDate = (instant) =>
  new Date(instant).toLocaleString("es-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
function ago(instant) {
  const s = Math.max(0, (Date.now() - new Date(instant)) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d`;
  return new Date(instant).toLocaleDateString("es-US", { timeZone: TZ, day: "numeric", month: "short" });
}
function until(instant) {
  const s = (new Date(instant) - Date.now()) / 1000;
  if (s <= 0) return "vencida";
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600);
  if (d) return `vence en ${d} d ${h} h`;
  if (h) return `vence en ${h} h`;
  return `vence en ${Math.max(1, Math.floor(s / 60))} min`;
}
const digits = (p) => String(p || "").replace(/\D/g, "");
const intl = (p) => {
  const d = digits(p);
  return d.length === 10 ? "1" + d : d;
};
const telLink = (p) => (digits(p).length >= 7 ? `tel:+${intl(p)}` : "");
const waLink = (p) => (digits(p).length >= 8 ? `https://wa.me/${intl(p)}` : "");
const initials = (name) =>
  String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const title = (v) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
const priceText = (v) => (v.priceOnRequest || !Number(v.price) ? "Consultar precio" : usd(v.price));
const publicLink = (id) => `${location.origin}/?v=${id}`;

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  today: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  catalog: svg('<path d="M5 16l1.5-5h11L19 16"/><rect x="3" y="16" width="18" height="4" rx="1.5"/><circle cx="7" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/><path d="M8 11l1-3h6l1 3"/>'),
  agenda: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  holds: svg('<path d="M7 3h10v18l-5-4-5 4z"/>'),
  chats: svg('<path d="M4 5h16v11H8l-4 4z"/><path d="M8 10h8M8 13h5"/>'),
  leads: svg('<path d="M4 4h16v16H4z"/><path d="M4 9h16M9 4v16"/>'),
  account: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
};
const PAGES = [
  { key: "today", label: "Hoy", tab: true },
  { key: "catalog", label: "Catálogo", tab: true },
  { key: "agenda", label: "Agenda", tab: true },
  { key: "holds", label: "Reservas", tab: true },
  { key: "chats", label: "Chats", tab: true },
  { key: "leads", label: "Consultas web" },
  { key: "account", label: "Mi cuenta" },
];
const KIND = { testdrive: "Prueba de manejo", visit: "Visita", delivery: "Entrega", call: "Llamada", followup: "Seguimiento" };
const APPT_STATUS = { scheduled: "Programada", confirmed: "Confirmada", completed: "Completada", no_show: "No asistió", cancelled: "Cancelada" };
const APPT_TONE = { scheduled: "", confirmed: "info", completed: "ok", no_show: "bad", cancelled: "" };
const HOLD_STATUS = { active: "Activa", released: "Liberada", expired: "Vencida", converted: "Vendida" };
const HOLD_TONE = { active: "warn", released: "", expired: "bad", converted: "ok" };
const LEAD_KIND = { testdrive: "Prueba de manejo", trade: "Intercambio", contact: "Contacto" };
const LEAD_STATUS = { new: "Nueva", contacted: "Contactada", closed: "Cerrada" };
const CHANNEL = { whatsapp: ["WhatsApp", "wa"], instagram: ["Instagram", "ig"], facebook: ["Facebook", "fb"] };
const CONVO_STATUS = { open: "Abierta", pending: "En espera", bot: "IA atendiendo", resolved: "Resuelta" };
const BODIES = [["", "Todos"], ["suv", "SUV"], ["sedan", "Sedán"], ["truck", "Pickup"], ["coupe", "Coupé"], ["hatch", "Hatchback"], ["van", "Minivan"], ["electric", "Eléctrico"]];

let user = null,
  page = "today",
  team = [],
  catalog = [],
  crm = null,
  ticket = 0,
  toastTimer,
  pollTimer,
  unreadTimer;
const view = {
  catalogQuery: "",
  catalogBody: "",
  onlyAvailable: false,
  agendaStart: todayISO(),
  seller: "",
  holdsTab: "active",
  leadsFilter: "open",
  chatScope: "mine",
  chatSearch: "",
  chatOpen: null,
  chatList: [],
  thread: null,
};

// ── Plumbing ──────────────────────────────────────────────────────────────────────────────
async function api(url, options = {}) {
  const headers = { ...options.headers };
  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  if (user?.csrf) headers["X-CSRF-Token"] = user.csrf;
  const res = await fetch(url, { ...options, body, headers, credentials: "same-origin" });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("No se pudo conectar. Comprueba tu conexión.");
  }
  if (!res.ok) {
    if (res.status === 401 && url !== "/api/auth/login") {
      user = null;
      showLogin();
    }
    throw new Error(data.error || "No se pudo completar la operación.");
  }
  return data;
}
function notify(message, bad = false) {
  const t = $("toast");
  t.textContent = message;
  t.classList.toggle("bad", bad);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 5000);
}
function sheet(heading, html) {
  $("sheetTitle").textContent = heading;
  $("sheetBody").innerHTML = html;
  if (!$("sheet").open) $("sheet").showModal();
  return $("sheetBody");
}
const closeSheet = () => $("sheet").open && $("sheet").close();
$("sheetClose").onclick = closeSheet;
$("sheet").addEventListener("click", (e) => e.target === $("sheet") && closeSheet());
async function busy(form, fn) {
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
const formData = (form) => Object.fromEntries(new FormData(form));
const empty = (heading, body, extra = "") => `<div class="empty"><h3>${heading}</h3><p>${body}</p>${extra}</div>`;
const field = (label, name, value = "", type = "text", extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const options = (list, value) =>
  list.map(([k, v]) => `<option value="${esc(k)}" ${String(value ?? "") === String(k) ? "selected" : ""}>${esc(v)}</option>`).join("");
const select = (label, name, list, value, extra = "") => `<label>${label}<select name="${name}" ${extra}>${options(list, value)}</select></label>`;
const isAdmin = () => user?.role === "admin";
const sellerOptions = (blank) => [...(blank ? [["", blank]] : []), ...team.map((u) => [u.id, u.name])];
function contactLinks(name, phone, email, extra = "") {
  const links = extra ? [extra] : [];
  if (telLink(phone)) links.push(`<a class="secondary sm" href="${telLink(phone)}">Llamar</a>`);
  if (waLink(phone)) links.push(`<a class="secondary sm" href="${waLink(phone)}" target="_blank" rel="noopener">WhatsApp</a>`);
  if (email) links.push(`<a class="secondary sm" href="mailto:${esc(email)}">Email</a>`);
  return links.length ? `<div class="contact-links">${links.join("")}</div>` : "";
}

// ── Session ───────────────────────────────────────────────────────────────────────────────
function showLogin() {
  $("loginView").hidden = false;
  $("appView").hidden = true;
  closeSheet();
  clearInterval(pollTimer);
  clearInterval(unreadTimer);
}
async function showApp() {
  $("loginView").hidden = true;
  $("appView").hidden = false;
  $("meButton").textContent = initials(user.name);
  $("adminLink").textContent = isAdmin() ? "Panel de administración ↗" : "Panel del equipo ↗";
  team = await api("/api/admin/team").catch(() => []);
  crm = await api("/api/admin/crm/status").catch(() => null);
  drawNav();
  route();
  clearInterval(unreadTimer);
  unreadTimer = setInterval(refreshUnread, 45_000);
  refreshUnread();
}
$("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  busy(form, async () => {
    ({ user } = await api("/api/auth/login", { method: "POST", body: formData(form) }));
    form.reset();
    await showApp();
  }).catch(() => {});
});
async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {}
  // Also the Omnicanal panel's session in this browser, opened with this account
  // (/omnicanal/entrar; key in server/omni-embed.js).
  try {
    localStorage.removeItem("omniai_session");
  } catch {}
  user = null;
  location.hash = "";
  showLogin();
}

// ── Navigation ────────────────────────────────────────────────────────────────────────────
let unread = 0;
function navButton(p, compact) {
  const badge = p.key === "chats" && unread ? `<span class="dot">${unread > 99 ? "99+" : unread}</span>` : "";
  return `<button type="button" data-page="${p.key}" class="${page === p.key ? "active" : ""}" aria-current="${page === p.key ? "page" : "false"}">${ICONS[p.key]}<span>${compact && p.key === "today" ? "Hoy" : p.label}</span>${badge}</button>`;
}
function drawNav() {
  $("tabs").innerHTML = PAGES.filter((p) => p.tab).map((p) => navButton(p, true)).join("");
  $("nav").innerHTML = PAGES.map((p) => navButton(p)).join("");
}
for (const id of ["tabs", "nav"])
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (b) go(b.dataset.page);
  });
function go(key, extra = "") {
  const hash = `#${key}${extra ? "/" + extra : ""}`;
  if (location.hash === hash) route();
  else location.hash = hash;
}
addEventListener("hashchange", () => user && route());
function route() {
  const [key, extra] = location.hash.slice(1).split("/");
  page = PAGES.some((p) => p.key === key) ? key : "today";
  view.chatOpen = page === "chats" && /^\d+$/.test(extra || "") ? Number(extra) : null;
  if (view.chatOpen === null) view.thread = null;
  drawNav();
  render();
}
$("meButton").onclick = () => {
  sheet(
    user.name,
    `<p class="muted small">${isAdmin() ? "Administración" : "Ventas"} · ${esc(user.username)}</p>
    <div class="pick section">
      <button class="secondary block" data-go="leads" type="button">Consultas web</button>
      <button class="secondary block" data-go="account" type="button">Mi cuenta y contraseña</button>
      <a class="secondary block" href="/admin/">${isAdmin() ? "Panel de administración" : "Panel del equipo"} ↗</a>
      <a class="secondary block" href="/" target="_blank" rel="noopener">Página pública ↗</a>
      <button class="danger block" id="logoutButton" type="button">Cerrar sesión</button>
    </div>`,
  );
  $("sheetBody").querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => (closeSheet(), go(b.dataset.go))));
  $("logoutButton").onclick = () => (closeSheet(), logout());
};

async function render() {
  const current = ++ticket;
  clearInterval(pollTimer);
  $("pageTitle").textContent = PAGES.find((p) => p.key === page).label;
  if (page !== "chats" || !view.thread) $("content").innerHTML = '<p class="muted">Cargando…</p>';
  try {
    await { today, catalog: catalogPage, agenda, holds, chats, leads, account }[page](current);
  } catch (e) {
    if (current === ticket) $("content").innerHTML = empty("No se pudo cargar", esc(e.message));
  }
}
const stale = (current) => current !== ticket || !user;

// ── Hoy ───────────────────────────────────────────────────────────────────────────────────
function apptRow(a, { manage = true } = {}) {
  const vehicle = a.make ? `${a.year} ${a.make} ${a.model}` : "";
  const sync = a.omni_appointment_id ? '<span class="pill info" title="Sincronizada con Omnicanal">Omnicanal</span>' : a.sync_error ? `<span class="pill bad" title="${esc(a.sync_error)}">Sin sincronizar</span>` : "";
  return `<div class="row-item"><div class="time">${esc(a.local_time)}<small>${a.duration_minutes} min</small></div>
    <div class="grow"><strong>${esc(a.customer_name)}</strong><div class="sub">${esc(KIND[a.kind])}${vehicle ? " · " + esc(vehicle) : ""}${isAdmin() && a.seller_name ? " · " + esc(a.seller_name) : ""}</div>
    <div class="contact-links"><span class="pill ${APPT_TONE[a.status]}">${APPT_STATUS[a.status]}</span>${sync}</div>${contactLinks(a.customer_name, a.customer_phone, a.customer_email)}</div>
    ${manage ? `<button class="secondary sm" data-act="edit-appt" data-id="${esc(a.id)}" type="button">Abrir</button>` : ""}</div>`;
}
function leadRow(l, { take = true } = {}) {
  const vehicle = l.make ? `${l.year || ""} ${l.make} ${l.model}`.trim() : "";
  const when = l.data?.date ? ` · pide ${esc(l.data.date)} ${esc(l.data.time || "")}` : "";
  return `<div class="row-item"><div class="avatar">${esc(initials(l.name))}</div><div class="grow"><strong>${esc(l.name)}</strong>
    <div class="sub">${esc(LEAD_KIND[l.kind])}${vehicle ? " · " + esc(vehicle) : ""}${when} · ${ago(l.created_at)}</div>
    ${l.data?.msg ? `<div class="sub">${esc(l.data.msg)}</div>` : ""}${contactLinks(l.name, l.phone, l.email, `${take && !l.assigned_to ? `<button class="primary sm" data-act="take-lead" data-id="${esc(l.id)}" type="button">Tomar</button>` : ""}<button class="secondary sm" data-act="lead-appt" data-id="${esc(l.id)}" type="button">Agendar</button>`)}</div></div>`;
}
let leadCache = [];
async function today(current) {
  const [sum, leadsList] = await Promise.all([api("/api/admin/me/summary"), api("/api/admin/leads")]);
  if (stale(current)) return;
  leadCache = leadsList;
  const open = leadsList.filter((l) => !l.assigned_to && l.status === "new").slice(0, 5);
  const mine = leadsList.filter((l) => l.assigned_to === user.id && l.status !== "closed").slice(0, 5);
  const first = user.name.split(" ")[0];
  $("content").innerHTML = `
    <p class="muted">${esc(dayLabel(todayISO()))}</p>
    <h2 class="hello">Hola, ${esc(first)}.</h2>
    <div class="stats">
      <article class="stat"><p>Mis ventas del mes</p><strong>${sum.sales.count}</strong><small>${usd(sum.sales.revenue)}</small></article>
      <article class="stat"><p>Reservas activas</p><strong>${sum.reservations.count}</strong><small>${sum.reservations.expiring ? `${sum.reservations.expiring} vencen en 24 h` : "Ninguna por vencer"}</small></article>
      <article class="stat"><p>Citas hoy</p><strong>${sum.today.length}</strong><small>${sum.upcoming} en los próximos 7 días</small></article>
      <article class="stat"><p>Consultas web</p><strong>${sum.leads.unassigned}</strong><small>sin asignar · ${sum.leads.mine} mías</small></article>
    </div>
    <div class="actions stretch section"><button class="primary" data-act="new-appt" type="button">+ Nueva cita</button><button class="secondary" data-act="goto" data-page="catalog" type="button">Reservar un vehículo</button></div>
    <section class="section"><div class="section-head"><h2>Tu agenda de hoy</h2><button class="link" data-act="goto" data-page="agenda" type="button">Ver agenda</button></div>
      <div class="card stack">${sum.today.length ? sum.today.map((a) => apptRow(a)).join("") : '<p class="pad muted small">No tienes citas hoy.</p>'}</div></section>
    <section class="section"><div class="section-head"><h2>Consultas web por atender</h2><button class="link" data-act="goto" data-page="leads" type="button">Ver todas</button></div>
      <div class="card stack">${open.length ? open.map((l) => leadRow(l)).join("") : '<p class="pad muted small">No hay consultas nuevas sin asignar.</p>'}</div></section>
    ${mine.length ? `<section class="section"><div class="section-head"><h2>Mis consultas en curso</h2></div><div class="card stack">${mine.map((l) => leadRow(l, { take: false })).join("")}</div></section>` : ""}`;
}

// ── Catálogo ──────────────────────────────────────────────────────────────────────────────
async function loadCatalog() {
  catalog = await api("/api/admin/catalog");
  return catalog;
}
function vehicleCard(v) {
  const r = v.reservation;
  const badge = r ? `<span class="pill warn">${r.mine ? "Tu reserva" : "Reservado · " + esc(r.sellerName)}</span>` : v.status === "reserved" ? '<span class="pill warn">Reservado</span>' : '<span class="pill ok">Disponible</span>';
  return `<button class="vehicle" data-act="vehicle" data-id="${esc(v.id)}" type="button">
    ${v.photos[0] ? `<img class="photo" src="${esc(v.photos[0])}" alt="" loading="lazy">` : '<span class="photo none">Sin foto</span>'}
    <span class="body"><h3>${esc(title(v))}</h3><span class="meta">Stock ${esc(v.stock)} · ${num(v.miles)} mi${v.demo ? " · Demo" : ""}</span>
    <span class="foot"><span class="price">${priceText(v)}</span>${badge}</span></span></button>`;
}
async function catalogPage(current) {
  await loadCatalog();
  if (stale(current)) return;
  $("content").innerHTML = `<div class="toolbar"><input id="catalogSearch" type="search" placeholder="Buscar marca, modelo, stock o VIN" aria-label="Buscar en el catálogo" value="${esc(view.catalogQuery)}">
    <label class="small inline-check"><input id="onlyAvailable" type="checkbox" ${view.onlyAvailable ? "checked" : ""}>Solo disponibles</label></div>
    <div class="chips" id="bodyChips">${BODIES.map(([k, l]) => `<button type="button" class="chip ${view.catalogBody === k ? "active" : ""}" data-body="${k}">${l}</button>`).join("")}</div>
    <p class="muted small" id="catalogCount"></p><div class="grid section" id="catalogGrid"></div>`;
  const draw = () => {
    const q = view.catalogQuery.toLowerCase();
    const list = catalog.filter(
      (v) =>
        (!view.catalogBody || (v.cats || []).includes(view.catalogBody)) &&
        (!view.onlyAvailable || v.status === "available") &&
        `${v.stock} ${v.vin} ${v.year} ${v.make} ${v.model} ${v.trim || ""}`.toLowerCase().includes(q),
    );
    $("catalogCount").textContent = `${list.length} ${list.length === 1 ? "vehículo" : "vehículos"}`;
    $("catalogGrid").innerHTML = list.length ? list.map(vehicleCard).join("") : empty("Sin resultados", "Prueba con otra búsqueda o carrocería.");
  };
  draw();
  $("catalogSearch").oninput = (e) => ((view.catalogQuery = e.target.value), draw());
  $("onlyAvailable").onchange = (e) => ((view.onlyAvailable = e.target.checked), draw());
  $("bodyChips").onclick = (e) => {
    const b = e.target.closest("[data-body]");
    if (!b) return;
    view.catalogBody = b.dataset.body;
    $("bodyChips").querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === b));
    draw();
  };
}
function vehicleSheet(v) {
  const r = v.reservation;
  const localized = (x) => (typeof x === "string" ? x : x?.es || x?.en || "");
  const spec = (label, value) => (value ? `<div><span>${label}</span>${esc(value)}</div>` : "");
  const canReserve = v.status === "available" && !v.demo;
  const canSell = r && (r.mine || isAdmin());
  const body = sheet(
    title(v),
    `<div class="gallery">${v.photos[0] ? `<img id="galleryMain" src="${esc(v.photos[0])}" alt="${esc(title(v))}">` : '<p class="notice">Esta unidad aún no tiene fotos.</p>'}
      ${v.photos.length > 1 ? `<div class="thumbs" id="galleryThumbs">${v.photos.map((p, i) => `<button type="button" class="${i ? "" : "active"}" data-photo="${esc(p)}"><img src="${esc(p)}" alt="Foto ${i + 1}" loading="lazy"></button>`).join("")}</div>` : ""}</div>
    <div class="price-row"><span class="price lg">${priceText(v)}</span><span class="muted small">Stock ${esc(v.stock)}</span></div>
    ${r ? `<div class="notice section">${r.mine ? "Reservado por ti" : "Reservado por " + esc(r.sellerName)}${r.customerName ? " para " + esc(r.customerName) : ""} · ${until(r.expiresAt)}.</div>` : ""}
    ${v.demo ? '<div class="notice section">Unidad de demostración: no se puede reservar ni vender hasta que administración cargue sus datos reales.</div>' : ""}
    <div class="specs">${spec("Millaje", num(v.miles) + " mi")}${spec("Condición", { used: "Usado", new: "Nuevo", certified: "Certificado" }[v.condition])}${spec("Motor", v.engine)}${spec("Transmisión", localized(v.trans))}${spec("Tracción", v.drive)}${spec("Combustible", { gas: "Gasolina", diesel: "Diésel", hybrid: "Híbrido", electric: "Eléctrico" }[v.fuel])}${spec("Exterior", localized(v.ext))}${spec("Interior", localized(v.int))}${spec("VIN", v.vin)}</div>
    ${localized(v.desc) ? `<p class="help">${esc(localized(v.desc))}</p>` : ""}
    <div class="actions stretch section">
      ${canReserve ? `<button class="primary" id="vReserve" type="button">Reservar para un cliente</button>` : ""}
      ${canSell ? `<button class="primary" id="vSell" type="button">Registrar venta</button>` : ""}
      <button class="secondary" id="vAppt" type="button">Agendar prueba de manejo</button>
      <button class="secondary" id="vShare" type="button">Compartir enlace</button>
      <a class="secondary" href="https://wa.me/?text=${encodeURIComponent(`${title(v)} · ${priceText(v)}\n${publicLink(v.id)}`)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
      ${crm?.connected ? `<button class="secondary" id="vToChat" type="button">Enviar a un chat</button>` : ""}
    </div>`,
  );
  body.querySelector("#galleryThumbs")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-photo]");
    if (!b) return;
    $("galleryMain").src = b.dataset.photo;
    body.querySelectorAll("#galleryThumbs button").forEach((x) => x.classList.toggle("active", x === b));
  });
  body.querySelector("#vReserve")?.addEventListener("click", () => reserveForm(v));
  body.querySelector("#vSell")?.addEventListener("click", () => saleForm({ vehicle: v }));
  body.querySelector("#vAppt").onclick = () =>
    appointmentForm({ kind: "testdrive", vehicleId: v.id });
  body.querySelector("#vShare").onclick = () => share(v);
  body.querySelector("#vToChat")?.addEventListener("click", () => pickConversation(v));
}
async function share(v) {
  const url = publicLink(v.id);
  try {
    if (navigator.share) await navigator.share({ title: title(v), text: `${title(v)} · ${priceText(v)}`, url });
    else {
      await navigator.clipboard.writeText(url);
      notify("Enlace copiado.");
    }
  } catch (e) {
    if (e.name !== "AbortError") notify("No se pudo compartir. Copia el enlace: " + url, true);
  }
}

// ── Reservas ──────────────────────────────────────────────────────────────────────────────
async function vehicleChoices(filter = (v) => v.status === "available" && !v.demo) {
  if (!catalog.length) await loadCatalog();
  return catalog.filter(filter).map((v) => [v.id, `${v.stock} · ${title(v)} · ${priceText(v)}`]);
}
async function reserveForm(vehicle, prefill = {}) {
  const choices = vehicle ? [[vehicle.id, `${vehicle.stock} · ${title(vehicle)}`]] : await vehicleChoices();
  if (!choices.length) return notify("No hay vehículos disponibles para reservar.", true);
  const form = sheet(
    "Reservar para un cliente",
    `<form class="form" id="reserveForm">
      ${select("Vehículo", "vehicleId", choices, vehicle?.id, vehicle ? "disabled" : "")}
      ${vehicle ? `<input type="hidden" name="vehicleId" value="${esc(vehicle.id)}">` : ""}
      ${field("Nombre del cliente *", "customerName", prefill.customerName, "text", 'required maxlength="160" autocomplete="off"')}
      <div class="row">${field("Teléfono", "customerPhone", prefill.customerPhone, "tel", 'maxlength="60"')}${field("Email", "customerEmail", prefill.customerEmail, "email", 'maxlength="200"')}</div>
      <div class="row">${field("Depósito recibido (USD)", "deposit", 0, "number", 'min="0" step="0.01"')}${select("Plazo", "days", [["1", "1 día"], ["2", "2 días"], ["3", "3 días"], ["5", "5 días"], ["7", "7 días"], ["14", "14 días"], ["30", "30 días"]], "3")}</div>
      ${isAdmin() ? select("Vendedor", "sellerId", sellerOptions(), user.id) : ""}
      <label>Notas<textarea name="notes" rows="2" maxlength="2000"></textarea></label>
      ${prefill.omniConversationId ? `<input type="hidden" name="omniConversationId" value="${esc(prefill.omniConversationId)}">` : ""}
      <p class="help">La unidad queda como «Reservado» en el catálogo público hasta que la vendas, la liberes o venza el plazo. El depósito es solo un registro: la app no cobra.</p>
      <p class="error" role="alert"></p>
      <div class="form-actions"><button class="primary block" type="submit">Confirmar reserva</button></div></form>`,
  ).querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form, async () => {
      await api("/api/admin/reservations", { method: "POST", body: formData(form) });
      closeSheet();
      notify("Reserva creada. El vehículo figura como reservado.");
      catalog = [];
      render();
    });
  };
}
async function holds(current) {
  const seller = isAdmin() && view.seller ? `&seller=${view.seller}` : "";
  const list = await api(`/api/admin/reservations?status=${view.holdsTab === "active" ? "active" : "all"}${seller}`);
  if (stale(current)) return;
  const shown = view.holdsTab === "active" ? list : list.filter((r) => r.status !== "active");
  $("content").innerHTML = `<div class="toolbar"><div class="segmented" id="holdTabs"><button type="button" data-tab="active" class="${view.holdsTab === "active" ? "active" : ""}">Activas</button><button type="button" data-tab="history" class="${view.holdsTab === "history" ? "active" : ""}">Historial</button></div>
    ${isAdmin() ? `<select id="holdSeller" aria-label="Vendedor">${options(sellerOptions("Todo el equipo"), view.seller)}</select>` : ""}
    <button class="primary sm push" data-act="new-hold" type="button">+ Nueva reserva</button></div>
    <div class="grid">${shown.map(holdCard).join("") || empty(view.holdsTab === "active" ? "No tienes reservas activas." : "Sin historial todavía.", "Reserva un vehículo desde el catálogo o desde un chat.")}</div>`;
  $("holdTabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) (view.holdsTab = b.dataset.tab), render();
  };
  $("holdSeller")?.addEventListener("change", (e) => ((view.seller = e.target.value), render()));
  holdCache = list;
}
let holdCache = [];
function holdCard(r) {
  const active = r.status === "active";
  return `<article class="card vehicle static">${r.photo ? `<img class="photo" src="${esc(r.photo)}" alt="" loading="lazy">` : '<span class="photo none">Sin foto</span>'}
    <div class="body"><div class="foot"><h3>${esc(`${r.year} ${r.make} ${r.model}`)}</h3><span class="pill ${HOLD_TONE[r.status]}">${HOLD_STATUS[r.status]}</span></div>
    <span class="meta">Stock ${esc(r.stock)} · ${r.price_on_request || !Number(r.price) ? "Consultar precio" : usd(r.price)}${isAdmin() ? " · " + esc(r.seller_name) : ""}</span>
    <strong>${esc(r.customer_name)}</strong><span class="meta">${active ? until(r.expires_at) : "Cerrada " + (r.closed_at ? shortDate(r.closed_at) : "")}${Number(r.deposit) ? " · depósito " + usd(r.deposit) : ""}</span>
    ${r.notes ? `<span class="meta pre">${esc(r.notes)}</span>` : ""}
    ${contactLinks(r.customer_name, r.customer_phone, r.customer_email)}
    ${active ? `<div class="actions mt6"><button class="primary sm" data-act="sell-hold" data-id="${esc(r.id)}" type="button">Registrar venta</button><button class="secondary sm" data-act="extend-hold" data-id="${esc(r.id)}" type="button">Extender</button><button class="danger sm" data-act="release-hold" data-id="${esc(r.id)}" type="button">Liberar</button></div>` : ""}</div></article>`;
}
function extendForm(r) {
  const form = sheet(
    "Extender reserva",
    `<form class="form"><p class="help">${esc(r.customer_name)} · ${esc(`${r.year} ${r.make} ${r.model}`)} · ${until(r.expires_at)}.</p>
    ${select("Agregar", "days", [["1", "1 día"], ["2", "2 días"], ["3", "3 días"], ["7", "7 días"], ["14", "14 días"]], "2")}
    <p class="error" role="alert"></p><div class="form-actions"><button class="primary block" type="submit">Extender</button></div></form>`,
  ).querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form, async () => {
      await api(`/api/admin/reservations/${r.id}/extend`, { method: "POST", body: { days: Number(form.elements.days.value) } });
      closeSheet();
      notify("Reserva extendida.");
      render();
    });
  };
}
function releaseForm(r) {
  const form = sheet(
    "Liberar reserva",
    `<form class="form"><p class="help">El vehículo volverá a estar disponible en el catálogo público.</p>
    <label>Motivo (opcional)<input name="reason" maxlength="500" placeholder="El cliente desistió, no consiguió financiamiento…"></label>
    <p class="error" role="alert"></p><div class="form-actions"><button class="danger block" type="submit">Liberar vehículo</button></div></form>`,
  ).querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form, async () => {
      await api(`/api/admin/reservations/${r.id}/release`, { method: "POST", body: formData(form) });
      closeSheet();
      notify("Reserva liberada; el vehículo vuelve a estar disponible.");
      catalog = [];
      render();
    });
  };
}
function saleForm({ vehicle, reservation }) {
  const v = vehicle || { id: reservation.vehicle_id, price: reservation.price, year: reservation.year, make: reservation.make, model: reservation.model, stock: reservation.stock };
  const r = reservation || {};
  const form = sheet(
    "Registrar venta",
    `<form class="form"><div class="notice">${esc(`${v.stock} · ${v.year} ${v.make} ${v.model}`)}. Al guardar, la unidad se marca como vendida y sale del catálogo público.</div>
      <div class="row">${field("Precio final (USD) *", "price", Number(v.price) || "", "number", 'required min="0.01" step="0.01"')}${field("Fecha de venta *", "soldAt", todayISO(), "date", "required")}</div>
      ${field("Nombre del comprador *", "buyerName", r.customer_name, "text", 'required maxlength="160"')}
      <div class="row">${field("Teléfono", "buyerPhone", r.customer_phone, "tel", 'maxlength="60"')}${field("Email", "buyerEmail", r.customer_email, "email", 'maxlength="200"')}</div>
      ${isAdmin() ? select("Vendedor que cierra", "sellerId", sellerOptions(), r.seller_id || vehicle?.reservation?.sellerId || user.id) : ""}
      <label>Notas internas<textarea name="notes" rows="2" maxlength="4000"></textarea></label>
      <p class="help">Registro comercial interno: no genera contratos ni ejecuta cobros.</p>
      <p class="error" role="alert"></p><div class="form-actions"><button class="primary block" type="submit">Confirmar venta</button></div></form>`,
  ).querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form, async () => {
      await api("/api/admin/sales", { method: "POST", body: { ...formData(form), vehicleId: v.id } });
      closeSheet();
      notify("Venta registrada. ¡Felicidades!");
      catalog = [];
      render();
    });
  };
}

// ── Agenda ────────────────────────────────────────────────────────────────────────────────
let apptCache = [];
async function appointmentForm(prefill = {}) {
  const vehicles = await vehicleChoices(() => true);
  const nextHour = String(Math.min(19, Number(nowTime().slice(0, 2)) + 1)).padStart(2, "0") + ":00";
  const form = sheet(
    prefill.omniConversationId ? "Agendar para este cliente" : "Nueva cita",
    `<form class="form">
      <div class="row">${select("Tipo", "kind", Object.entries(KIND), prefill.kind || "testdrive")}${select("Duración", "durationMinutes", [["30", "30 min"], ["45", "45 min"], ["60", "1 hora"], ["90", "1 h 30"], ["120", "2 horas"]], "60")}</div>
      <div class="row">${field("Fecha *", "date", prefill.date || todayISO(), "date", "required")}${field("Hora *", "time", prefill.time || nextHour, "time", 'required step="300"')}</div>
      ${select("Vehículo", "vehicleId", [["", "Sin vehículo"], ...vehicles], prefill.vehicleId || "")}
      ${field("Cliente *", "customerName", prefill.customerName, "text", 'required maxlength="160" autocomplete="off"')}
      <div class="row">${field("Teléfono", "customerPhone", prefill.customerPhone, "tel", 'maxlength="60"')}${field("Email", "customerEmail", prefill.customerEmail, "email", 'maxlength="200"')}</div>
      ${isAdmin() ? select("Vendedor", "sellerId", sellerOptions(), prefill.sellerId || user.id) : ""}
      <label>Notas<textarea name="notes" rows="2" maxlength="2000">${esc(prefill.notes || "")}</textarea></label>
      ${prefill.leadId ? `<input type="hidden" name="leadId" value="${esc(prefill.leadId)}">` : ""}
      ${prefill.omniConversationId ? `<input type="hidden" name="omniConversationId" value="${esc(prefill.omniConversationId)}">` : ""}
      <p class="help">Hora del concesionario (Nueva York).${crm?.connected ? " También queda en Omnicanal: si el cliente ya escribió por WhatsApp, Instagram o Facebook, recibe allí el recordatorio." : ""}</p>
      <p class="error" role="alert"></p><div class="form-actions"><button class="primary block" type="submit">Agendar</button></div></form>`,
  ).querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form, async () => {
      const data = formData(form);
      if (!data.vehicleId) delete data.vehicleId;
      if (!data.sellerId) delete data.sellerId;
      data.durationMinutes = Number(data.durationMinutes);
      const a = await api("/api/admin/appointments", { method: "POST", body: data });
      closeSheet();
      notify(a.sync_error ? `Cita agendada. Omnicanal: ${a.sync_error}` : "Cita agendada.", Boolean(a.sync_error));
      view.agendaStart = a.local_date < view.agendaStart || a.local_date > addDays(view.agendaStart, 6) ? a.local_date : view.agendaStart;
      render();
    });
  };
}
function editAppointment(a) {
  const form = sheet(
    `${KIND[a.kind]} · ${a.customer_name}`,
    `<form class="form">
      ${a.make ? `<p class="help">${esc(`${a.year} ${a.make} ${a.model} · stock ${a.stock}`)}</p>` : ""}
      ${contactLinks(a.customer_name, a.customer_phone, a.customer_email)}
      ${select("Estado", "status", Object.entries(APPT_STATUS), a.status)}
      <div class="row3">${field("Fecha", "date", a.local_date, "date", "required")}${field("Hora", "time", a.local_time, "time", 'required step="300"')}${select("Duración", "durationMinutes", [["30", "30 min"], ["45", "45 min"], ["60", "1 h"], ["90", "1 h 30"], ["120", "2 h"]], String(a.duration_minutes))}</div>
      ${isAdmin() ? select("Vendedor", "sellerId", sellerOptions(), a.seller_id || "") : !a.seller_id ? '<p class="notice">Cita sin vendedor: al guardar queda a tu nombre.</p>' : ""}
      <label>Notas<textarea name="notes" rows="3" maxlength="2000">${esc(a.notes)}</textarea></label>
      ${a.sync_error ? `<p class="notice bad">Omnicanal: ${esc(a.sync_error)}. Se reintenta al guardar.</p>` : ""}
      <p class="error" role="alert"></p><div class="form-actions"><button class="primary block" type="submit">Guardar</button></div></form>`,
  ).querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form, async () => {
      const data = formData(form);
      data.durationMinutes = Number(data.durationMinutes);
      if (!isAdmin()) delete data.sellerId;
      else if (!data.sellerId) data.sellerId = null;
      const updated = await api(`/api/admin/appointments/${a.id}`, { method: "PUT", body: data });
      closeSheet();
      notify(updated.sync_error ? `Guardada. Omnicanal: ${updated.sync_error}` : "Cita actualizada.", Boolean(updated.sync_error));
      render();
    });
  };
}
let omniApptCache = [];
async function agenda(current) {
  const from = view.agendaStart,
    to = addDays(from, 6);
  const seller = isAdmin() && view.seller ? `&seller=${view.seller}` : "";
  const [list, omni] = await Promise.all([
    api(`/api/admin/appointments?from=${from}&to=${to}${seller}`),
    crm?.connected ? api("/api/admin/crm/appointments").catch((e) => ({ error: e.message })) : null,
  ]);
  if (stale(current)) return;
  apptCache = list;
  omniApptCache = Array.isArray(omni) ? omni : [];
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const pending = omniApptCache.length
    ? `<section class="section"><div class="section-head"><h2>Por confirmar desde WhatsApp e IA</h2><span class="pill info">${omniApptCache.length}</span></div><div class="card stack">${omniApptCache
        .map(
          (o) => `<div class="row-item"><div class="time">${esc(o.local.time)}<small>${esc(dayLabel(o.local.date, { day: "numeric", month: "short" }))}</small></div><div class="grow"><strong>${esc(o.contactName || "Cliente")}</strong><div class="sub">${esc(o.service)}${o.agentName ? " · " + esc(o.agentName) : ""} · ${o.source === "ai" ? "agendada por la IA" : "Omnicanal"}</div>${contactLinks(o.contactName, o.contactPhone)}</div><button class="primary sm" data-act="confirm-omni" data-id="${o.id}" type="button">Confirmar</button></div>`,
        )
        .join("")}</div></section>`
    : omni?.error
      ? `<p class="notice bad section">Omnicanal: ${esc(omni.error)}</p>`
      : "";
  $("content").innerHTML = `<div class="toolbar"><div class="segmented"><button type="button" data-act="week" data-step="-7" aria-label="Semana anterior">←</button><button type="button" data-act="week" data-step="0">Hoy</button><button type="button" data-act="week" data-step="7" aria-label="Semana siguiente">→</button></div>
    <strong class="small">${esc(dayLabel(from, { day: "numeric", month: "short" }))} – ${esc(dayLabel(to, { day: "numeric", month: "short" }))}</strong>
    ${isAdmin() ? `<select id="agendaSeller" aria-label="Vendedor">${options(sellerOptions("Todo el equipo"), view.seller)}</select>` : ""}
    <button class="primary sm push" data-act="new-appt" type="button">+ Nueva cita</button></div>
    ${pending}
    ${days
      .map((d) => {
        const items = list.filter((a) => a.local_date === d);
        return `<section class="section"><div class="section-head"><h2 class="cap">${esc(dayLabel(d))}${d === todayISO() ? ' <span class="pill warn">Hoy</span>' : ""}</h2><span class="muted small">${items.length || ""}</span></div>
          <div class="card stack">${items.length ? items.map((a) => apptRow(a)).join("") : '<p class="pad muted small">Sin citas.</p>'}</div></section>`;
      })
      .join("")}`;
  $("agendaSeller")?.addEventListener("change", (e) => ((view.seller = e.target.value), render()));
}
async function confirmOmni(o) {
  const vehicles = await vehicleChoices(() => true);
  const form = sheet(
    "Confirmar cita de Omnicanal",
    `<form class="form"><p class="help">${esc(o.contactName || "Cliente")} · ${esc(dayLabel(o.local.date))} ${esc(o.local.time)}<br>${esc(o.service)}${o.notes ? " · " + esc(o.notes) : ""}</p>
      ${select("Tipo", "kind", Object.entries(KIND), /prueba|manejo|test/i.test(o.service) ? "testdrive" : "visit")}
      ${select("Vehículo", "vehicleId", [["", "Sin vehículo"], ...vehicles], "")}
      ${isAdmin() ? select("Vendedor", "sellerId", sellerOptions(), user.id) : ""}
      <p class="help">Queda en tu agenda y Omnicanal la marca como confirmada y asignada a ti.</p>
      <p class="error" role="alert"></p><div class="form-actions"><button class="primary block" type="submit">Confirmar y agendar</button></div></form>`,
  ).querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form, async () => {
      const data = formData(form);
      if (!data.vehicleId) data.vehicleId = null;
      await api(`/api/admin/crm/appointments/${o.id}/confirm`, { method: "POST", body: data });
      closeSheet();
      notify("Cita confirmada en tu agenda.");
      render();
    });
  };
}

// ── Consultas web ─────────────────────────────────────────────────────────────────────────
async function leads(current) {
  const list = await api("/api/admin/leads");
  if (stale(current)) return;
  leadCache = list;
  const filters = { open: "Sin asignar", mine: "Mías", all: "Todas" };
  const shown = list.filter((l) =>
    view.leadsFilter === "open" ? !l.assigned_to && l.status !== "closed" : view.leadsFilter === "mine" ? l.assigned_to === user.id : true,
  );
  $("content").innerHTML = `<div class="toolbar"><div class="segmented" id="leadTabs">${Object.entries(filters).map(([k, l]) => `<button type="button" data-tab="${k}" class="${view.leadsFilter === k ? "active" : ""}">${l}</button>`).join("")}</div></div>
    <div class="card stack">${shown
      .map(
        (l) => `${leadRow(l)}<div class="lead-foot"><span class="muted small">${l.assigned_name ? "Atiende " + esc(l.assigned_name) : "Sin asignar"}</span>
          <select data-lead-status="${esc(l.id)}" aria-label="Estado de la consulta de ${esc(l.name)}" class="auto push">${options(Object.entries(LEAD_STATUS), l.status)}</select></div>`,
      )
      .join("") || empty("Nada por aquí.", "Las solicitudes de la página web aparecen en esta lista.")}</div>`;
  $("leadTabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) (view.leadsFilter = b.dataset.tab), render();
  };
  $("content").querySelectorAll("[data-lead-status]").forEach(
    (s) =>
      (s.onchange = async () => {
        try {
          await api(`/api/admin/leads/${s.dataset.leadStatus}`, { method: "PUT", body: { status: s.value } });
          notify("Seguimiento actualizado.");
        } catch (e) {
          notify(e.message, true);
        }
      }),
  );
}
function leadAppointment(l) {
  appointmentForm({
    kind: l.kind === "testdrive" ? "testdrive" : l.kind === "trade" ? "visit" : "call",
    date: /^\d{4}-\d{2}-\d{2}$/.test(l.data?.date || "") ? l.data.date : undefined,
    time: /^\d{2}:\d{2}$/.test(l.data?.time || "") ? l.data.time : undefined,
    vehicleId: l.vehicle_id || "",
    customerName: l.name,
    customerPhone: l.phone,
    customerEmail: l.email,
    notes: l.data?.msg || "",
    leadId: l.id,
  });
}

// ── Chats (Omnicanal) ────────────────────────────────────────────────────────────────────
async function refreshUnread() {
  if (!user || !crm?.connected || !crm.me?.agentId || document.visibilityState !== "visible") return;
  try {
    const { conversations } = await api("/api/admin/crm/conversations?scope=mine");
    setUnread(conversations.reduce((n, c) => n + c.unreadCount, 0));
  } catch {}
}
function setUnread(n) {
  if (n === unread) return;
  unread = n;
  drawNav();
}
function convoItem(c) {
  const [label, tone] = CHANNEL[c.channel] || [c.channel, ""];
  const owner = c.agentId && c.agentId === crm.me?.agentId ? "Tuyo" : c.agentName ? c.agentName : "Sin asignar";
  return `<button type="button" class="convo ${view.chatOpen === c.id ? "active" : ""}" data-convo="${c.id}"><span class="avatar">${esc(initials(c.contactName || c.contactPhone))}</span>
    <span class="grow"><span class="top"><strong>${esc(c.contactName || c.contactPhone || "Cliente")}</strong><time>${ago(c.updatedAt)}</time></span>
    <span class="last blockline">${esc(c.lastMessage || "—")}</span>
    <span class="contact-links flat"><span class="pill ${tone}">${esc(label)}</span>${c.status === "bot" ? '<span class="pill info">IA</span>' : ""}<span class="pill">${esc(owner)}</span>${c.unreadCount ? `<span class="unread">${c.unreadCount}</span>` : ""}</span></span></button>`;
}
async function chats(current) {
  crm = await api(`/api/admin/crm/status${crm?.connected ? "" : "?refresh=1"}`).catch((e) => ({ configured: true, connected: false, error: e.message }));
  if (stale(current)) return;
  if (!crm.configured)
    return ($("content").innerHTML = empty(
      "Omnicanal aún no está conectado.",
      "Cuando administración conecte la instancia de Omnicanal, aquí atenderás WhatsApp, Instagram y Facebook como agente.",
    ));
  if (!crm.connected) return ($("content").innerHTML = empty("No se pudo conectar con Omnicanal.", esc(crm.error || "Inténtalo de nuevo en unos minutos."), '<button class="secondary" data-act="goto" data-page="chats" type="button">Reintentar</button>'));
  const linked = Boolean(crm.me?.agentId);
  if (!linked && !isAdmin())
    return ($("content").innerHTML = empty("Tu usuario no está vinculado a Omnicanal.", esc(crm.me?.error || "Pide a administración que te vincule a tu agente en Omnicanal → Equipo.")));
  if (!linked && view.chatScope === "mine") view.chatScope = "general";
  await loadChatList(current);
  if (stale(current)) return;
  if (view.chatOpen) await loadThread(current);
  if (stale(current)) return;
  drawChats();
  pollTimer = setInterval(async () => {
    if (document.visibilityState !== "visible" || $("sheet").open) return;
    const c = ticket;
    try {
      await loadChatList(c);
      if (view.chatOpen) await loadThread(c);
      if (!stale(c)) drawChatList(), drawMessages();
    } catch {}
  }, 8000);
}
async function loadChatList(current) {
  const q = view.chatSearch ? `&search=${encodeURIComponent(view.chatSearch)}` : "";
  const { conversations } = await api(`/api/admin/crm/conversations?scope=${view.chatScope}${q}`);
  if (stale(current)) return;
  view.chatList = conversations;
  if (view.chatScope === "mine") setUnread(conversations.reduce((n, c) => n + c.unreadCount, 0));
}
async function loadThread(current) {
  const data = await api(`/api/admin/crm/conversations/${view.chatOpen}`);
  if (stale(current)) return;
  view.thread = data;
}
function drawChats() {
  const linked = Boolean(crm.me?.agentId);
  const scopes = [["mine", "Mis chats"], ["general", "Por atender"], ["resolved", "Resueltos"]].filter(([k]) => k !== "mine" || linked);
  $("content").innerHTML = `<div class="inbox ${view.chatOpen ? "open" : ""}">
    <div class="list-pane"><div class="toolbar"><div class="segmented" id="chatScopes">${scopes.map(([k, l]) => `<button type="button" data-scope="${k}" class="${view.chatScope === k ? "active" : ""}">${l}</button>`).join("")}</div>
      <input id="chatSearch" type="search" placeholder="Buscar cliente o mensaje" value="${esc(view.chatSearch)}" aria-label="Buscar chats"></div>
      ${!linked ? '<p class="notice">Atiendes como administración. Vincula tu usuario a un agente en Omnicanal → Equipo para tener chats propios y tomar conversaciones.</p>' : ""}
      <div class="card stack" id="chatList"></div></div>
    ${view.chatOpen ? `<div class="thread-pane" id="threadPane"></div>` : ""}</div>`;
  drawChatList();
  if (view.chatOpen) drawThread();
  $("chatScopes").onclick = (e) => {
    const b = e.target.closest("[data-scope]");
    if (b) (view.chatScope = b.dataset.scope), go("chats");
  };
  let searchTimer;
  $("chatSearch").oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      view.chatSearch = e.target.value.trim();
      await loadChatList(ticket);
      drawChatList();
    }, 350);
  };
}
function drawChatList() {
  const list = $("chatList");
  if (!list) return;
  list.innerHTML = view.chatList.length
    ? view.chatList.map(convoItem).join("")
    : `<p class="pad muted small">${view.chatScope === "mine" ? "No tienes chats abiertos. Toma uno en «Por atender»." : "No hay conversaciones aquí."}</p>`;
  list.onclick = (e) => {
    const b = e.target.closest("[data-convo]");
    if (b) go("chats", b.dataset.convo);
  };
}
function drawThread() {
  const t = view.thread;
  const pane = $("threadPane");
  if (!pane || !t) return;
  const c = t.conversation;
  const [label, tone] = CHANNEL[c.channel] || [c.channel, ""];
  const mine = c.agentId && c.agentId === crm.me?.agentId;
  const closed = c.windowExpiresAt && new Date(c.windowExpiresAt) < new Date();
  pane.innerHTML = `<div class="card thread"><div class="thread-head"><button class="icon back" type="button" data-act="close-thread" aria-label="Volver a la lista">‹</button><span class="avatar">${esc(initials(c.contactName || c.contactPhone))}</span>
      <div class="grow"><strong>${esc(c.contactName || c.contactPhone || "Cliente")}</strong><div class="sub"><span class="pill ${tone}">${esc(label)}</span> ${esc(CONVO_STATUS[c.status] || c.status)} · ${mine ? "tuyo" : c.agentName ? esc(c.agentName) : "sin asignar"}</div></div>
      ${telLink(c.contactPhone) ? `<a class="secondary sm" href="${telLink(c.contactPhone)}">Llamar</a>` : ""}</div>
    <div class="thread-tools">${crm.me?.agentId && !mine ? '<button class="primary sm" data-act="claim" type="button">Tomar</button>' : ""}
      <button class="secondary sm" data-act="chat-vehicle" type="button">Enviar vehículo</button>
      <button class="secondary sm" data-act="chat-reserve" type="button">Reservar</button>
      <button class="secondary sm" data-act="chat-appt" type="button">Agendar</button>
      ${c.status !== "resolved" ? '<button class="ghost sm" data-act="resolve" type="button">Resolver</button>' : ""}</div>
    <div class="messages" id="messages"></div>
    ${closed ? `<div class="window-closed">Pasaron más de 24 h desde el último mensaje del cliente: Meta solo permite plantillas aprobadas. Envíala desde Omnicanal o espera a que el cliente escriba.</div>` : ""}
    <form class="composer" id="composer"><textarea name="content" rows="1" maxlength="4000" placeholder="Escribe un mensaje…" aria-label="Mensaje"></textarea><button class="primary" type="submit">Enviar</button></form></div>`;
  drawMessages(true);
  const form = $("composer");
  const box = form.elements.content;
  const coarse = matchMedia("(pointer: coarse)").matches;
  box.addEventListener("input", () => {
    box.style.height = "auto";
    box.style.height = Math.min(160, box.scrollHeight) + "px";
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !coarse) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    const content = box.value.trim();
    if (!content) return;
    busy(form, async () => {
      await api(`/api/admin/crm/conversations/${c.id}/messages`, { method: "POST", body: { content } });
      box.value = "";
      box.style.height = "auto";
      await refreshThread();
    });
  };
}
function messageHtml(m) {
  const time = new Date(m.createdAt).toLocaleTimeString("es-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  if (m.internal) return `<div class="note">${esc(m.content)}</div>`;
  let media = "";
  if (m.media && !m.deleted) {
    if (m.type === "image") media = `<img src="${esc(m.media)}" alt="${esc(m.mediaName || "Imagen")}" loading="lazy">`;
    else if (m.type === "audio") media = `<audio controls preload="none" src="${esc(m.media)}"></audio>`;
    else if (m.type === "video") media = `<video controls preload="none" src="${esc(m.media)}"></video>`;
    else media = `<a href="${esc(m.media)}" target="_blank" rel="noopener">📎 ${esc(m.mediaName || "Archivo")}</a>`;
  }
  const who = m.sender === "bot" ? "IA" : m.sender === "agent" ? "Equipo" : "";
  const content = m.deleted ? "<em>Mensaje eliminado</em>" : esc(m.content);
  return `<div class="msg ${m.sender} ${m.failed ? "failed" : ""}">${who ? `<span class="who">${who}</span>` : ""}${media}${content}${m.failed ? `<span class="error blockline">No le llegó al cliente${m.failedReason ? ": " + esc(m.failedReason) : ""}</span>` : ""}<time>${esc(time)}</time></div>`;
}
function drawMessages(scroll = false) {
  const box = $("messages");
  if (!box || !view.thread) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = view.thread.messages.map(messageHtml).join("") || '<p class="note">Sin mensajes todavía.</p>';
  if (scroll || atBottom) box.scrollTop = box.scrollHeight;
}
async function refreshThread() {
  await loadThread(ticket);
  await loadChatList(ticket);
  drawChatList();
  drawThread();
}
function chatCustomer() {
  const c = view.thread.conversation;
  return { customerName: c.contactName || "", customerPhone: c.contactPhone || "", omniConversationId: c.id };
}
async function pickConversation(v) {
  const { conversations } = await api(`/api/admin/crm/conversations?scope=${crm.me?.agentId ? "mine" : "general"}`);
  sheet(
    "Enviar a un chat",
    conversations.length
      ? `<p class="help">Se envía ${esc(title(v))} con su precio y el enlace a sus fotos.</p><div class="pick card stack">${conversations.slice(0, 40).map((c) => `<button type="button" class="convo" data-pick="${c.id}"><span class="avatar">${esc(initials(c.contactName))}</span><span class="grow"><strong>${esc(c.contactName || c.contactPhone)}</strong><span class="last blockline">${esc(c.lastMessage)}</span></span></button>`).join("")}</div>`
      : empty("No tienes chats abiertos.", "Toma una conversación en Chats → Por atender."),
  ).onclick = (e) => {
    const b = e.target.closest("[data-pick]");
    if (b) sendVehicle(Number(b.dataset.pick), v);
  };
}
async function sendVehicle(conversationId, v) {
  try {
    await api(`/api/admin/crm/conversations/${conversationId}/vehicle`, { method: "POST", body: { vehicleId: v.id } });
    closeSheet();
    notify("Vehículo enviado al chat.");
    if (page === "chats" && view.chatOpen === conversationId) await refreshThread();
  } catch (e) {
    notify(e.message, true);
  }
}
async function chatVehiclePicker(mode) {
  if (!catalog.length) await loadCatalog();
  const list = catalog.filter((v) => mode !== "reserve" || (v.status === "available" && !v.demo));
  sheet(
    mode === "reserve" ? "¿Qué vehículo reserva?" : "¿Qué vehículo envías?",
    `<input type="search" id="pickSearch" placeholder="Buscar" aria-label="Buscar vehículo" class="mb10"><div class="pick card stack" id="pickList"></div>`,
  );
  const draw = (q = "") => {
    $("pickList").innerHTML =
      list
        .filter((v) => `${v.stock} ${title(v)}`.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 60)
        .map((v) => `<button type="button" class="row-item plain" data-pick="${esc(v.id)}"><span class="grow"><strong>${esc(title(v))}</strong><span class="sub blockline">Stock ${esc(v.stock)} · ${priceText(v)}${v.reservation ? " · reservado" : ""}</span></span></button>`)
        .join("") || '<p class="pad muted small">Sin vehículos.</p>';
  };
  draw();
  $("pickSearch").oninput = (e) => draw(e.target.value);
  $("pickList").onclick = (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    const v = catalog.find((x) => x.id === b.dataset.pick);
    if (mode === "reserve") reserveForm(v, chatCustomer());
    else sendVehicle(view.thread.conversation.id, v);
  };
}

// ── Cuenta ────────────────────────────────────────────────────────────────────────────────
async function account() {
  $("content").innerHTML = `<section class="card pad"><h2 class="h-card">${esc(user.name)}</h2><p class="muted small">${isAdmin() ? "Administración" : "Ventas"} · ${esc(user.username)}${crm?.me?.agentId ? " · agente de Omnicanal: " + esc(crm.me.name) : ""}</p></section>
    <section class="card pad section"><h2 class="h-sub">Cambiar contraseña</h2><form class="form" id="passwordForm">
      ${field("Contraseña actual", "currentPassword", "", "password", 'autocomplete="current-password" required')}
      ${field("Nueva contraseña", "newPassword", "", "password", 'autocomplete="new-password" required minlength="12" maxlength="128"')}
      ${field("Repetir nueva contraseña", "confirmPassword", "", "password", 'autocomplete="new-password" required minlength="12" maxlength="128"')}
      <p class="help">Al cambiarla se cierran tus otras sesiones.</p><p class="error" role="alert"></p>
      <div class="form-actions"><button class="primary" type="submit">Actualizar contraseña</button></div></form></section>
    <div class="actions stretch section"><a class="secondary" href="/admin/">${isAdmin() ? "Panel de administración" : "Panel del equipo"} ↗</a><button class="danger" data-act="logout" type="button">Cerrar sesión</button></div>`;
  $("passwordForm").onsubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, async () => {
      const data = formData(form);
      if (data.newPassword !== data.confirmPassword) throw new Error("Las contraseñas no coinciden.");
      await api("/api/auth/password", { method: "POST", body: data });
      form.reset();
      notify("Contraseña actualizada.");
    });
  };
}

// ── Actions (one delegated handler for every page) ──────────────────────────────────────
$("content").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const id = b.dataset.id;
  try {
    switch (b.dataset.act) {
      case "goto":
        return go(b.dataset.page);
      case "vehicle":
        return vehicleSheet(catalog.find((v) => v.id === id));
      case "new-appt":
        return appointmentForm();
      case "edit-appt": {
        const a = apptCache.find((x) => x.id === id) || (await api(`/api/admin/appointments?from=${addDays(todayISO(), -30)}&to=${addDays(todayISO(), 365)}`)).find((x) => x.id === id);
        return a && editAppointment(a);
      }
      case "week":
        view.agendaStart = Number(b.dataset.step) ? addDays(view.agendaStart, Number(b.dataset.step)) : todayISO();
        return render();
      case "confirm-omni":
        return confirmOmni(omniApptCache.find((o) => o.id === Number(id)));
      case "take-lead":
        b.disabled = true;
        await api(`/api/admin/leads/${id}/take`, { method: "POST", body: {} });
        notify("Consulta asignada a ti.");
        return render();
      case "lead-appt":
        return leadAppointment(leadCache.find((l) => l.id === id));
      case "new-hold":
        return reserveForm(null);
      case "extend-hold":
        return extendForm(holdCache.find((r) => r.id === id));
      case "release-hold":
        return releaseForm(holdCache.find((r) => r.id === id));
      case "sell-hold":
        return saleForm({ reservation: holdCache.find((r) => r.id === id) });
      case "close-thread":
        return go("chats");
      case "claim":
        b.disabled = true;
        await api(`/api/admin/crm/conversations/${view.thread.conversation.id}/claim`, { method: "POST" });
        notify("Conversación tomada: ahora está en Mis chats.");
        return refreshThread();
      case "resolve":
        if (!confirm("¿Marcar la conversación como resuelta?")) return;
        await api(`/api/admin/crm/conversations/${view.thread.conversation.id}/resolve`, { method: "POST" });
        notify("Conversación resuelta.");
        return go("chats");
      case "chat-vehicle":
        return chatVehiclePicker("send");
      case "chat-reserve":
        return chatVehiclePicker("reserve");
      case "chat-appt":
        return appointmentForm({ kind: "testdrive", ...chatCustomer() });
      case "logout":
        return logout();
    }
  } catch (err) {
    b.disabled = false;
    notify(err.message, true);
  }
});
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshUnread());

try {
  ({ user } = await api("/api/auth/me"));
  await showApp();
} catch {
  showLogin();
}
