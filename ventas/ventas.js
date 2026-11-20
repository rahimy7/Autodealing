// Premier App: the team's mobile app, one app for three profiles (README: App del equipo).
//  · Ventas: catálogo con filtros, cotizaciones, reservas, ventas, agenda, consultas web, sus chats
//    de WhatsApp y redes, y carga de unidades con fotos.
//  · Servicio: catálogo para consultar y compartir, agenda de servicio, sus chats y carga de
//    unidades con fotos. No reserva, cotiza ni vende.
//  · Administración: todo lo anterior, más precios y publicación, equipo y el negocio.
// Same session, CSRF token and API as the panel (/admin/). This module is the shell: session,
// navigation, the + button and the screens that are only lists (Hoy, Más, Reservas, Consultas).
import {
  S, $, api, esc, usd, initials, notify, sheet, closeSheet, busy, formData, empty, options, peopleOptions,
  contactLinks, isAdmin, isService, canSell, until, shortDate, ago, dayLabel, todayISO, hooks, actions, on, stale,
  forgetCatalog, ROLE_LABEL, HOLD_STATUS, HOLD_TONE, ICONS,
} from "./core.js";
import { catalogPage, reserveForm, saleForm } from "./catalog.js";
import { agendaPage, appointmentForm, apptRow, leadAppointment } from "./agenda.js";
import { chatsPage, refreshUnread, stopChatPolling, chat } from "./chats.js";
import { quotesPage, quoteForm, quoteRow, quoteSettingsForm, rememberQuotes } from "./quotes.js";
import { unitsPage, intakeForm } from "./units.js";
import { teamPage, businessPage } from "./team.js";

const LEAD_KIND = { testdrive: "Prueba de manejo", trade: "Intercambio", contact: "Contacto", finance: "Financiamiento", visit: "Cita" };
const LEAD_DETAILS = [["topic", "Motivo"], ["down", "Inicial"], ["employment", "Empleo"], ["income", "Ingreso"], ["credit", "Crédito"]];
const LEAD_STATUS = { new: "Nueva", contacted: "Contactada", closed: "Cerrada" };

// Every screen, who sees it, and whether it is one of the five tabs. On a computer the side rail
// lists them all; on a phone the rest are under «Más».
const PAGES = [
  { key: "today", label: "Hoy", tab: true, render: today },
  { key: "catalog", label: "Catálogo", tab: true, render: catalogPage },
  { key: "agenda", label: "Agenda", tab: true, render: agendaPage },
  { key: "chats", label: "Chats", tab: true, render: chatsPage },
  { key: "more", label: "Más", tab: true, mobileOnly: true, render: more },
  { key: "quotes", label: "Cotizaciones", sells: true, render: quotesPage },
  { key: "holds", label: "Reservas", sells: true, render: holds },
  { key: "units", label: () => (isAdmin() ? "Inventario" : "Mis unidades"), render: unitsPage },
  { key: "leads", label: "Consultas web", sells: true, render: leads },
  { key: "team", label: "Equipo", admin: true, group: "Administración", render: teamPage },
  { key: "business", label: "Negocio", admin: true, render: businessPage },
  { key: "account", label: "Mi cuenta", render: account },
];
const labelOf = (p) => (typeof p.label === "function" ? p.label() : p.label);
const allowed = (p) => (!p.sells || canSell()) && (!p.admin || isAdmin());
const pages = () => PAGES.filter(allowed);

// ── Session ───────────────────────────────────────────────────────────────────────────────
function showLogin() {
  $("loginView").hidden = false;
  $("appView").hidden = true;
  closeSheet();
  stopChatPolling();
  clearInterval(unreadTimer);
}
hooks.onSignedOut = showLogin;
let unreadTimer;
async function showApp() {
  $("loginView").hidden = true;
  $("appView").hidden = false;
  $("meButton").textContent = initials(S.user.name);
  $("railRole").textContent = `${S.user.name} · ${ROLE_LABEL[S.user.role] || S.user.role}`;
  $("adminLink").textContent = isAdmin() ? "Panel de administración ↗" : "Panel del equipo ↗";
  $("fab").innerHTML = ICONS.plus;
  [S.team, S.crm, S.dealer] = await Promise.all([
    api("/api/admin/team").catch(() => []),
    api("/api/admin/crm/status").catch(() => null),
    api("/api/site").catch(() => ({})),
  ]);
  route();
  clearInterval(unreadTimer);
  unreadTimer = setInterval(refreshUnread, 45_000);
  refreshUnread();
}
$("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  busy(form, async () => {
    ({ user: S.user } = await api("/api/auth/login", { method: "POST", body: formData(form) }));
    form.reset();
    await showApp();
  });
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
  S.user = null;
  history.replaceState(null, "", location.pathname);
  showLogin();
}

// ── Navigation ────────────────────────────────────────────────────────────────────────────
function navButton(p) {
  const badge = p.key === "chats" && chat.unread ? `<span class="dot">${chat.unread > 99 ? "99+" : chat.unread}</span>` : "";
  const icon = ICONS[p.key] || ICONS.more;
  return `<button type="button" data-page="${p.key}" class="${S.page === p.key ? "active" : ""}" aria-current="${S.page === p.key ? "page" : "false"}">${icon}<span>${esc(labelOf(p))}</span>${badge}</button>`;
}
function drawNav() {
  const list = pages();
  const tabActive = list.some((p) => p.tab && p.key === S.page);
  $("tabs").innerHTML = list
    .filter((p) => p.tab)
    .map((p) => (p.key === "more" && !tabActive ? navButton({ ...p, key: "more" }).replace('class=""', 'class="active"') : navButton(p)))
    .join("");
  $("nav").innerHTML = list
    .filter((p) => !p.mobileOnly)
    .map((p) => (p.group ? `<p class="rail-group">${p.group}</p>` : "") + navButton(p))
    .join("");
}
hooks.drawNav = drawNav;
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
hooks.go = go;
addEventListener("hashchange", () => S.user && route());
let extra = "";
function route() {
  const [key, rest] = location.hash.slice(1).split("/");
  const page = pages().find((p) => p.key === key);
  S.page = page ? key : "today";
  extra = page ? rest || "" : "";
  // «Más» is the phone's menu; on a computer the rail already lists everything.
  if (S.page === "more" && matchMedia("(min-width: 960px)").matches) S.page = "today";
  drawNav();
  render();
}
async function render() {
  const current = ++S.ticket;
  const page = PAGES.find((p) => p.key === S.page);
  if (S.page !== "chats") stopChatPolling();
  $("pageTitle").textContent = labelOf(page);
  $("barEyebrow").textContent = `Premier · ${ROLE_LABEL[S.user.role] || ""}`;
  $("fab").hidden = S.page === "chats" || S.page === "account";
  if (S.page !== "chats" || !chat.thread) $("content").innerHTML = '<p class="muted">Cargando…</p>';
  try {
    await page.render(current, extra);
  } catch (e) {
    if (current === S.ticket) $("content").innerHTML = empty("No se pudo cargar", esc(e.message), '<button class="secondary" type="button" data-act="retry">Reintentar</button>');
  }
}
hooks.render = render;
on("retry", () => render());
on("goto", (b) => go(b.dataset.page));
on("logout", logout);

$("meButton").onclick = () => {
  sheet(
    S.user.name,
    `<p class="muted small">${ROLE_LABEL[S.user.role] || S.user.role} · ${esc(S.user.username)}</p>
    <div class="card menu-list stack section">
      <button type="button" data-go="account"><span class="mi">${ICONS.account}</span><span class="grow">Mi cuenta y contraseña</span></button>
      <a href="/admin/"><span class="mi">${ICONS.external}</span><span class="grow">${isAdmin() ? "Panel de administración" : "Panel del equipo"}<small>Para la computadora</small></span></a>
      <a href="/" target="_blank" rel="noopener"><span class="mi">${ICONS.catalog}</span><span class="grow">Página pública</span></a>
    </div>
    <button class="danger block section" id="logoutButton" type="button">Cerrar sesión</button>`,
  );
  $("sheetBody").querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => (closeSheet(), go(b.dataset.go))));
  $("logoutButton").onclick = () => (closeSheet(), logout());
};

// ── The + button: what each profile creates most ──────────────────────────────────────────
$("fab").onclick = () => {
  const items = [
    ["unit", ICONS.camera, "Cargar vehículo", "Fotos y datos desde el lote"],
    ...(canSell() ? [["quote", ICONS.quotes, "Nueva cotización", "Contado o pago mensual, por WhatsApp"]] : []),
    ["appt", ICONS.agenda, isService() ? "Nueva cita de servicio" : "Nueva cita", isService() ? "Taller, entrega o llamada" : "Prueba de manejo, visita o entrega"],
    ...(canSell() ? [["hold", ICONS.holds, "Nueva reserva", "Aparta una unidad para un cliente"]] : []),
    ...(isAdmin() ? [["user", ICONS.team, "Nuevo usuario", "Ventas, servicio o administración"]] : []),
  ];
  const body = sheet(
    "Crear",
    `<div class="card menu-list stack">${items.map(([k, icon, label, sub]) => `<button type="button" data-new="${k}"><span class="mi">${icon}</span><span class="grow">${label}<small>${sub}</small></span><span class="chev">${ICONS.chevron}</span></button>`).join("")}</div>`,
  );
  body.onclick = (e) => {
    const b = e.target.closest("[data-new]");
    if (!b) return;
    const k = b.dataset.new;
    if (k === "unit") intakeForm();
    if (k === "quote") quoteForm();
    if (k === "appt") appointmentForm({ kind: isService() ? "service" : "testdrive" });
    if (k === "hold") reserveForm(null);
    if (k === "user") actions["new-user"]?.();
  };
};

// ── Hoy ───────────────────────────────────────────────────────────────────────────────────
function leadRow(l, { take = true } = {}) {
  const vehicle = l.make ? `${l.year || ""} ${l.make} ${l.model}`.trim() : "";
  const when = l.data?.date ? ` · pide ${esc(l.data.date)} ${esc(l.data.time || "")}` : "";
  const details = LEAD_DETAILS.filter(([k]) => l.data?.[k]).map(([k, label]) => `${label}: ${l.data[k]}`).join(" · ");
  return `<div class="row-item"><div class="avatar">${esc(initials(l.name))}</div><div class="grow"><strong>${esc(l.name)}</strong>
    <div class="sub">${esc(LEAD_KIND[l.kind] || l.kind)}${vehicle ? " · " + esc(vehicle) : ""}${when} · ${ago(l.created_at)}</div>
    ${details ? `<div class="sub">${esc(details)}</div>` : ""}${l.data?.msg ? `<div class="sub">${esc(l.data.msg)}</div>` : ""}${contactLinks(l.phone, l.email, `${take && !l.assigned_to ? `<button class="primary sm" data-act="take-lead" data-id="${esc(l.id)}" type="button">Tomar</button>` : ""}<button class="secondary sm" data-act="lead-appt" data-id="${esc(l.id)}" type="button">Agendar</button>`)}</div></div>`;
}
let leadCache = [];
const quick = (items) =>
  `<div class="quick section">${items.map(([act, icon, label, page]) => `<button type="button" data-act="${act}" ${page ? `data-page="${page}"` : ""}><span class="qi">${icon}</span>${label}</button>`).join("")}</div>`;

async function today(current) {
  const [sum, leadsList, quotes, review] = await Promise.all([
    api("/api/admin/me/summary"),
    canSell() ? api("/api/admin/leads") : [],
    canSell() ? api("/api/admin/quotes").catch(() => []) : [],
    isAdmin() ? api("/api/admin/intake").catch(() => []) : [],
  ]);
  if (stale(current)) return;
  leadCache = leadsList;
  rememberQuotes(quotes);
  const first = S.user.name.split(" ")[0];
  const open = leadsList.filter((l) => !l.assigned_to && l.status === "new").slice(0, 5);
  const mine = leadsList.filter((l) => l.assigned_to === S.user.id && l.status !== "closed").slice(0, 5);
  const stat = (label, value, sub, page, hot) =>
    `<button class="stat ${hot ? "hot" : ""}" type="button" data-act="goto" data-page="${page}"><p>${label}</p><strong>${value}</strong><small>${sub}</small></button>`;
  const stats = isService()
    ? [
        stat("Citas hoy", sum.today.length, `${sum.upcoming} en los próximos 7 días`, "agenda", true),
        stat("Mis unidades", sum.units.loaded, `${sum.units.drafts} en revisión`, "units"),
        stat("Publicadas", sum.units.published, "de las que cargaste", "units"),
        stat("Chats", chat.unread || 0, "mensajes sin leer", "chats"),
      ]
    : [
        stat(isAdmin() ? "Mis ventas del mes" : "Ventas del mes", sum.sales.count, usd(sum.sales.revenue), isAdmin() ? "business" : "holds", true),
        stat("Reservas activas", sum.reservations.count, sum.reservations.expiring ? `${sum.reservations.expiring} vencen en 24 h` : "Ninguna por vencer", "holds"),
        stat("Citas hoy", sum.today.length, `${sum.upcoming} en los próximos 7 días`, "agenda"),
        isAdmin()
          ? stat("Por completar", sum.units.drafts, "unidades sin precio ni publicar", "units", sum.units.drafts > 0)
          : stat("Cotizaciones", sum.quotes.count, "este mes", "quotes"),
      ];
  const quickItems = isService()
    ? [["new-unit", ICONS.camera, "Cargar vehículo"], ["new-appt", ICONS.wrench, "Cita de servicio"], ["goto", ICONS.catalog, "Catálogo", "catalog"], ["goto", ICONS.chats, "Chats", "chats"]]
    : [["new-quote", ICONS.quotes, "Cotizar"], ["goto", ICONS.catalog, "Reservar", "catalog"], ["new-appt", ICONS.agenda, "Nueva cita"], ["new-unit", ICONS.camera, "Cargar vehículo"]];
  $("content").innerHTML = `
    <p class="muted cap">${esc(dayLabel(todayISO()))}</p>
    <h2 class="hello">Hola, <span class="grad">${esc(first)}</span>.</h2>
    <div class="stats">${stats.join("")}</div>
    ${quick(quickItems)}
    ${isAdmin() && review.length ? `<section class="section"><div class="section-head"><h2>Unidades por completar</h2><button class="link" data-act="goto" data-page="units" type="button">Ver todas</button></div>
      <div class="card stack">${review.slice(0, 4).map((v) => `<button type="button" class="row-item plain" data-act="unit" data-id="${esc(v.id)}">${v.photos[0] ? `<img class="avatar" src="${esc(v.photos[0].url)}" alt="">` : `<span class="avatar">${ICONS.units}</span>`}<span class="grow"><strong>${esc([v.year, v.make, v.model].join(" "))}</strong><span class="sub blockline">${esc(v.intakeName || "Panel")} · ${v.photos.length} fotos · ${ago(v.createdAt)}</span></span><span class="pill violet">Completar</span></button>`).join("")}</div></section>` : ""}
    <section class="section"><div class="section-head"><h2>Tu agenda de hoy</h2><button class="link" data-act="goto" data-page="agenda" type="button">Ver agenda</button></div>
      <div class="card stack">${sum.today.length ? sum.today.map((a) => apptRow(a)).join("") : '<p class="pad muted small">No tienes citas hoy.</p>'}</div></section>
    ${canSell() ? `<section class="section"><div class="section-head"><h2>Consultas web por atender</h2><button class="link" data-act="goto" data-page="leads" type="button">Ver todas</button></div>
      <div class="card stack">${open.length ? open.map((l) => leadRow(l)).join("") : '<p class="pad muted small">No hay consultas nuevas sin asignar.</p>'}</div></section>` : ""}
    ${mine.length ? `<section class="section"><div class="section-head"><h2>Mis consultas en curso</h2></div><div class="card stack">${mine.map((l) => leadRow(l, { take: false })).join("")}</div></section>` : ""}
    ${quotes.length ? `<section class="section"><div class="section-head"><h2>Cotizaciones recientes</h2><button class="link" data-act="goto" data-page="quotes" type="button">Ver todas</button></div><div class="card stack">${quotes.slice(0, 3).map(quoteRow).join("")}</div></section>` : ""}`;
}
on("take-lead", async (b) => {
  b.disabled = true;
  await api(`/api/admin/leads/${b.dataset.id}/take`, { method: "POST", body: {} });
  notify("Consulta asignada a ti.");
  render();
});
on("lead-appt", (b) => leadAppointment(leadCache.find((l) => l.id === b.dataset.id)));
on("quote-settings", () => quoteSettingsForm());

// ── Más (the phone's menu) ────────────────────────────────────────────────────────────────
function more() {
  const item = (key, sub) => {
    const p = PAGES.find((x) => x.key === key);
    return allowed(p) ? `<button type="button" data-act="goto" data-page="${key}"><span class="mi">${ICONS[key]}</span><span class="grow">${esc(labelOf(p))}<small>${sub}</small></span><span class="chev">${ICONS.chevron}</span></button>` : "";
  };
  $("content").innerHTML = `<div class="card menu-list stack">
      ${item("quotes", "Las que generaste y su enlace para el cliente")}
      ${item("holds", "Unidades apartadas para tus clientes")}
      ${item("units", isAdmin() ? "Por completar e inventario completo" : "Las que cargaste y su estado")}
      ${item("leads", "Solicitudes de la página web")}
    </div>
    ${isAdmin() ? `<p class="eyebrow section">Administración</p><div class="card menu-list stack mt12">
      ${item("team", "Usuarios, perfiles, contraseñas y chats")}
      ${item("business", "Ventas, margen, inventario y el equipo")}
      <button type="button" data-act="quote-settings"><span class="mi">${ICONS.settings}</span><span class="grow">Ajustes de cotización<small>Impuesto, cargos, tasa y vigencia</small></span><span class="chev">${ICONS.chevron}</span></button>
      <a href="/admin/"><span class="mi">${ICONS.external}</span><span class="grow">Panel de administración<small>Página web, Omnicanal, costos y reportes</small></span></a>
    </div>` : ""}
    <div class="card menu-list stack section">
      ${item("account", `${ROLE_LABEL[S.user.role]} · ${esc(S.user.username)}`)}
      <button type="button" data-act="logout"><span class="mi">${ICONS.logout}</span><span class="grow">Cerrar sesión</span></button>
    </div>`;
}

// ── Reservas ──────────────────────────────────────────────────────────────────────────────
const holdView = { tab: "active", seller: "" };
let holdCache = [];
async function holds(current) {
  const seller = isAdmin() && holdView.seller ? `&seller=${holdView.seller}` : "";
  const list = await api(`/api/admin/reservations?status=${holdView.tab === "active" ? "active" : "all"}${seller}`);
  if (stale(current)) return;
  holdCache = list;
  const shown = holdView.tab === "active" ? list : list.filter((r) => r.status !== "active");
  $("content").innerHTML = `<div class="toolbar"><div class="segmented" id="holdTabs"><button type="button" data-tab="active" class="${holdView.tab === "active" ? "active" : ""}">Activas</button><button type="button" data-tab="history" class="${holdView.tab === "history" ? "active" : ""}">Historial</button></div>
    ${isAdmin() ? `<select id="holdSeller" aria-label="Vendedor">${options(peopleOptions("Todo el equipo", { sellers: true }), holdView.seller)}</select>` : ""}</div>
    <div class="grid">${shown.map(holdCard).join("") || empty(holdView.tab === "active" ? "No tienes reservas activas." : "Sin historial todavía.", "Reserva un vehículo desde el catálogo, una cotización o un chat.")}</div>`;
  $("holdTabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) (holdView.tab = b.dataset.tab), render();
  };
  $("holdSeller")?.addEventListener("change", (e) => ((holdView.seller = e.target.value), render()));
}
function holdCard(r) {
  const active = r.status === "active";
  return `<article class="vehicle static"><span class="photo-wrap">${r.photo ? `<img class="photo" src="${esc(r.photo)}" alt="" loading="lazy">` : '<span class="photo none">Sin foto</span>'}<span class="pill ${HOLD_TONE[r.status]}">${HOLD_STATUS[r.status]}</span></span>
    <div class="body"><h3>${esc(`${r.year} ${r.make} ${r.model}`)}</h3>
    <span class="meta">Stock ${esc(r.stock)} · ${r.price_on_request || !Number(r.price) ? "Consultar precio" : usd(r.price)}${isAdmin() ? " · " + esc(r.seller_name) : ""}</span>
    <strong>${esc(r.customer_name)}</strong><span class="meta">${active ? until(r.expires_at) : "Cerrada " + (r.closed_at ? shortDate(r.closed_at) : "")}${Number(r.deposit) ? " · depósito " + usd(r.deposit) : ""}</span>
    ${r.notes ? `<span class="meta pre">${esc(r.notes)}</span>` : ""}
    ${contactLinks(r.customer_phone, r.customer_email)}
    ${active ? `<div class="actions mt6"><button class="primary sm" data-act="sell-hold" data-id="${esc(r.id)}" type="button">Registrar venta</button><button class="secondary sm" data-act="extend-hold" data-id="${esc(r.id)}" type="button">Extender</button><button class="danger sm" data-act="release-hold" data-id="${esc(r.id)}" type="button">Liberar</button></div>` : ""}</div></article>`;
}
function extendForm(r) {
  const form = sheet(
    "Extender reserva",
    `<form class="form"><p class="help">${esc(r.customer_name)} · ${esc(`${r.year} ${r.make} ${r.model}`)} · ${until(r.expires_at)}.</p>
    <label>Agregar<select name="days">${options([["1", "1 día"], ["2", "2 días"], ["3", "3 días"], ["7", "7 días"], ["14", "14 días"]], "2")}</select></label>
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
    `<form class="form"><p class="help">El vehículo vuelve a estar disponible en la página.</p>
    <label>Motivo (opcional)<input name="reason" maxlength="500" placeholder="El cliente desistió, no consiguió financiamiento…"></label>
    <p class="error" role="alert"></p><div class="form-actions"><button class="danger block" type="submit">Liberar vehículo</button></div></form>`,
  ).querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form, async () => {
      await api(`/api/admin/reservations/${r.id}/release`, { method: "POST", body: formData(form) });
      closeSheet();
      notify("Reserva liberada; el vehículo vuelve a estar disponible.");
      forgetCatalog();
      render();
    });
  };
}
on("new-hold", () => reserveForm(null));
on("extend-hold", (b) => extendForm(holdCache.find((r) => r.id === b.dataset.id)));
on("release-hold", (b) => releaseForm(holdCache.find((r) => r.id === b.dataset.id)));
on("sell-hold", (b) => saleForm({ reservation: holdCache.find((r) => r.id === b.dataset.id) }));

// ── Consultas web ─────────────────────────────────────────────────────────────────────────
const leadView = { filter: "open" };
async function leads(current) {
  const list = await api("/api/admin/leads");
  if (stale(current)) return;
  leadCache = list;
  const filters = { open: "Sin asignar", mine: "Mías", all: "Todas" };
  const shown = list.filter((l) => (leadView.filter === "open" ? !l.assigned_to && l.status !== "closed" : leadView.filter === "mine" ? l.assigned_to === S.user.id : true));
  $("content").innerHTML = `<div class="toolbar"><div class="segmented" id="leadTabs">${Object.entries(filters).map(([k, l]) => `<button type="button" data-tab="${k}" class="${leadView.filter === k ? "active" : ""}">${l}</button>`).join("")}</div></div>
    <div class="card stack">${shown
      .map(
        (l) => `${leadRow(l)}<div class="lead-foot"><span class="muted small">${l.assigned_name ? "Atiende " + esc(l.assigned_name) : "Sin asignar"}</span>
          <select data-lead-status="${esc(l.id)}" aria-label="Estado de la consulta de ${esc(l.name)}" class="auto push">${options(Object.entries(LEAD_STATUS), l.status)}</select></div>`,
      )
      .join("") || empty("Nada por aquí.", "Las solicitudes de la página web aparecen en esta lista.")}</div>`;
  $("leadTabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) (leadView.filter = b.dataset.tab), render();
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

// ── Cuenta ────────────────────────────────────────────────────────────────────────────────
function account() {
  $("content").innerHTML = `<section class="card pad"><h2 class="h-card">${esc(S.user.name)}</h2><p class="muted small">${ROLE_LABEL[S.user.role]} · ${esc(S.user.username)}${S.crm?.me?.agentId ? " · agente de Omnicanal: " + esc(S.crm.me.name) : ""}</p></section>
    <section class="card pad section"><h2 class="h-sub">Cambiar contraseña</h2><form class="form" id="passwordForm">
      <label>Contraseña actual<input name="currentPassword" type="password" autocomplete="current-password" required></label>
      <label>Nueva contraseña<input name="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label>
      <label>Repetir nueva contraseña<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label>
      <p class="help">Al menos 12 caracteres. Al cambiarla se cierran tus otras sesiones.</p><p class="error" role="alert"></p>
      <div class="form-actions"><button class="primary" type="submit">Actualizar contraseña</button></div></form></section>
    <section class="card pad section"><h2 class="h-sub">Instalar la app</h2><p class="help">En iPhone: Safari → Compartir → «Agregar a inicio». En Android: Chrome → ⋮ → «Instalar app». Se abre a pantalla completa, como una app.</p></section>
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

// ── One delegated handler for every data-act button, in the page and in the sheet ─────────
async function dispatch(e) {
  const b = e.target.closest("[data-act]");
  if (!b || !actions[b.dataset.act]) return;
  try {
    if (b.closest("#sheet") && b.dataset.act === "goto") closeSheet();
    await actions[b.dataset.act](b);
  } catch (err) {
    b.disabled = false;
    notify(err.message, true);
  }
}
$("content").addEventListener("click", dispatch);
$("sheetBody").addEventListener("click", dispatch);
$("sheetClose").onclick = closeSheet;
$("sheet").addEventListener("click", (e) => e.target === $("sheet") && closeSheet());
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshUnread());

try {
  ({ user: S.user } = await api("/api/auth/me"));
  await showApp();
} catch {
  showLogin();
}
