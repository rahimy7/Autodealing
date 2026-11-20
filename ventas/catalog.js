// The catalogue: what is for sale, with filters, and a unit's sheet with what each profile can do
// from it (quote, reserve, sell, schedule, share, add photos, complete its details).
import {
  S, $, api, esc, num, usd, title, priceText, hasPrice, localized, notify, sheet, closeSheet, busy, formData,
  empty, field, select, options, peopleOptions, isAdmin, canSell, isService, until, todayISO, on, render, stale,
  loadCatalog, forgetCatalog, vehicleChoices, BODIES, CONDITIONS, FUELS, ICONS,
} from "./core.js";
import { shareSheet } from "./share.js";
import { appointmentForm } from "./agenda.js";
import { quoteForm } from "./quotes.js";
import { addPhotos, adminVehicleSheet } from "./units.js";
import { pickConversation } from "./chats.js";

const SORTS = [
  ["recent", "Más recientes"],
  ["price-asc", "Precio: menor a mayor"],
  ["price-desc", "Precio: mayor a menor"],
  ["miles", "Menos millas"],
  ["year", "Año más nuevo"],
];
const blankFilters = () => ({ status: "", make: "", yearMin: "", yearMax: "", priceMin: "", priceMax: "", milesMax: "", condition: "", fuel: "" });
const view = { query: "", body: "", sort: "recent", f: blankFilters() };

function activeFilters() {
  const f = view.f, out = [];
  const st = { available: "Disponibles", reserved: "Reservados", mine: "Mis reservas" };
  if (f.status) out.push(["status", st[f.status]]);
  if (f.make) out.push(["make", f.make]);
  if (f.yearMin || f.yearMax) out.push(["year", `Año ${f.yearMin || "…"}–${f.yearMax || "…"}`]);
  if (f.priceMin || f.priceMax) out.push(["price", `${f.priceMin ? usd(f.priceMin) : "$0"} – ${f.priceMax ? usd(f.priceMax) : "∞"}`]);
  if (f.milesMax) out.push(["miles", `Hasta ${num(f.milesMax)} mi`]);
  if (f.condition) out.push(["condition", CONDITIONS.find(([k]) => k === f.condition)[1]]);
  if (f.fuel) out.push(["fuel", FUELS.find(([k]) => k === f.fuel)[1]]);
  return out;
}
function clearFilter(key) {
  if (key === "year") view.f.yearMin = view.f.yearMax = "";
  else if (key === "price") view.f.priceMin = view.f.priceMax = "";
  else if (key === "miles") view.f.milesMax = "";
  else view.f[key] = "";
}

function matches(v) {
  const f = view.f, q = view.query.trim().toLowerCase();
  const price = hasPrice(v) ? Number(v.price) : null;
  if (view.body && !(v.cats || []).includes(view.body)) return false;
  if (f.status === "available" && v.status !== "available") return false;
  if (f.status === "reserved" && v.status !== "reserved") return false;
  if (f.status === "mine" && !v.reservation?.mine) return false;
  if (f.make && v.make !== f.make) return false;
  if (f.yearMin && Number(v.year) < Number(f.yearMin)) return false;
  if (f.yearMax && Number(v.year) > Number(f.yearMax)) return false;
  if (f.priceMin && (price === null || price < Number(f.priceMin))) return false;
  if (f.priceMax && (price === null || price > Number(f.priceMax))) return false;
  if (f.milesMax && Number(v.miles) > Number(f.milesMax)) return false;
  if (f.condition && v.condition !== f.condition) return false;
  if (f.fuel && v.fuel !== f.fuel) return false;
  return !q || `${v.stock} ${v.vin} ${v.year} ${v.make} ${v.model} ${v.trim || ""} ${localized(v.ext)}`.toLowerCase().includes(q);
}
const sorters = {
  recent: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  "price-asc": (a, b) => (hasPrice(a) ? a.price : Infinity) - (hasPrice(b) ? b.price : Infinity),
  "price-desc": (a, b) => (hasPrice(b) ? b.price : -1) - (hasPrice(a) ? a.price : -1),
  miles: (a, b) => a.miles - b.miles,
  year: (a, b) => b.year - a.year,
};

export function vehicleCard(v) {
  const r = v.reservation;
  const badge = r
    ? `<span class="pill warn">${r.mine ? "Tu reserva" : "Reservado · " + esc(r.sellerName)}</span>`
    : v.status === "reserved"
      ? '<span class="pill warn">Reservado</span>'
      : '<span class="pill ok">Disponible</span>';
  return `<button class="vehicle" data-act="vehicle" data-id="${esc(v.id)}" type="button">
    <span class="photo-wrap">${v.photos[0] ? `<img class="photo" src="${esc(v.photos[0])}" alt="" loading="lazy">` : '<span class="photo none">Sin foto</span>'}${badge}${v.photos.length > 1 ? `<span class="pill count">${v.photos.length} fotos</span>` : ""}</span>
    <span class="body"><h3>${esc(title(v))}</h3><span class="meta">${num(v.miles)} mi · Stock ${esc(v.stock)}${v.demo ? " · Demo" : ""}</span>
    <span class="foot"><span class="price ${hasPrice(v) ? "" : "na"}">${priceText(v)}</span>${v.featured ? '<span class="pill violet">Destacado</span>' : ""}</span></span></button>`;
}

export async function catalogPage(current) {
  await loadCatalog(true);
  if (stale(current)) return;
  const bodies = BODIES.filter(([k]) => S.catalog.some((v) => (v.cats || []).includes(k)));
  $("content").innerHTML = `<div class="toolbar"><div class="search">${ICONS.search}<input id="catalogSearch" type="search" placeholder="Buscar marca, modelo o VIN" aria-label="Buscar en el catálogo" value="${esc(view.query)}"></div>
      <button class="icon filter-btn" id="filterOpen" type="button" aria-label="Filtros">${ICONS.filter}<span class="badge" id="filterCount" hidden></span></button></div>
    <div class="chips" id="bodyChips"><button type="button" class="chip ${view.body ? "" : "active"}" data-body="">Todos</button>${bodies.map(([k, l]) => `<button type="button" class="chip ${view.body === k ? "active" : ""}" data-body="${k}">${l}</button>`).join("")}</div>
    <div class="chips wrap" id="activeFilters"></div>
    <div class="result-line"><span class="muted small" id="catalogCount"></span><select id="catalogSort" aria-label="Ordenar">${options(SORTS, view.sort)}</select></div>
    <div class="grid" id="catalogGrid"></div>`;
  const draw = () => {
    const list = S.catalog.filter(matches).sort(sorters[view.sort]);
    $("catalogCount").textContent = `${list.length} ${list.length === 1 ? "vehículo" : "vehículos"}`;
    $("catalogGrid").innerHTML = list.length
      ? list.map(vehicleCard).join("")
      : empty("Sin resultados", "Prueba con otra búsqueda o quita algún filtro.", activeFilters().length ? '<button class="secondary" type="button" data-act="clear-filters">Quitar filtros</button>' : "");
    const active = activeFilters();
    $("filterCount").hidden = !active.length;
    $("filterCount").textContent = active.length;
    $("activeFilters").innerHTML = active.map(([k, l]) => `<button type="button" class="chip" data-clear="${k}">${esc(l)} <span class="x" aria-hidden="true">×</span><span class="sr">Quitar</span></button>`).join("");
  };
  draw();
  $("catalogSearch").oninput = (e) => ((view.query = e.target.value), draw());
  $("catalogSort").onchange = (e) => ((view.sort = e.target.value), draw());
  $("bodyChips").onclick = (e) => {
    const b = e.target.closest("[data-body]");
    if (!b) return;
    view.body = b.dataset.body;
    $("bodyChips").querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === b));
    draw();
  };
  $("activeFilters").onclick = (e) => {
    const b = e.target.closest("[data-clear]");
    if (b) clearFilter(b.dataset.clear), draw();
  };
  $("filterOpen").onclick = () => filterSheet(draw);
  on("clear-filters", () => ((view.f = blankFilters()), draw()));
}

function filterSheet(draw) {
  const f = view.f;
  const makes = [...new Set(S.catalog.map((v) => v.make).filter(Boolean))].sort();
  const form = sheet(
    "Filtros",
    `<form class="form">
      ${select("Estado", "status", [["", "Todos"], ["available", "Disponibles"], ["reserved", "Reservados"], ...(canSell() ? [["mine", "Mis reservas"]] : [])], f.status)}
      ${select("Marca", "make", [["", "Todas"], ...makes.map((m) => [m, m])], f.make)}
      <div class="row">${field("Año desde", "yearMin", f.yearMin, "number", 'inputmode="numeric" min="1900" max="2100"')}${field("Año hasta", "yearMax", f.yearMax, "number", 'inputmode="numeric" min="1900" max="2100"')}</div>
      <div class="row">${field("Precio mínimo", "priceMin", f.priceMin, "number", 'inputmode="numeric" min="0" step="500"')}${field("Precio máximo", "priceMax", f.priceMax, "number", 'inputmode="numeric" min="0" step="500"')}</div>
      ${field("Millaje máximo", "milesMax", f.milesMax, "number", 'inputmode="numeric" min="0" step="1000"')}
      <div class="row">${select("Condición", "condition", [["", "Todas"], ...CONDITIONS], f.condition)}${select("Combustible", "fuel", [["", "Todos"], ...FUELS], f.fuel)}</div>
      <div class="action-grid"><button class="secondary" type="button" id="filterReset">Limpiar</button><button class="primary" type="submit">Ver resultados</button></div>
    </form>`,
  ).querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    view.f = { ...blankFilters(), ...formData(form) };
    closeSheet();
    draw();
  };
  form.querySelector("#filterReset").onclick = () => {
    view.f = blankFilters();
    closeSheet();
    draw();
  };
}

// ── A unit's sheet ───────────────────────────────────────────────────────────────────────────
export function vehicleSheet(v) {
  if (!v) return;
  const r = v.reservation;
  const spec = (label, value) => (value ? `<div><span>${label}</span>${esc(value)}</div>` : "");
  const sellable = !v.demo;
  const canReserve = canSell() && v.status === "available" && sellable;
  const canSellNow = canSell() && r && (r.mine || isAdmin());
  const canQuote = canSell() && sellable && hasPrice(v);
  const body = sheet(
    title(v),
    `<div class="gallery">${v.photos.length ? `<div class="gallery-track" id="galleryTrack">${v.photos.map((p, i) => `<img src="${esc(p)}" alt="${esc(title(v))} · foto ${i + 1}" ${i > 1 ? 'loading="lazy"' : ""}>`).join("")}</div>${v.photos.length > 1 ? `<div class="gallery-dots" id="galleryDots">${v.photos.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>` : ""}` : '<p class="notice">Esta unidad aún no tiene fotos.</p>'}</div>
    <div class="price-row"><span class="price lg ${hasPrice(v) ? "" : "na"}">${priceText(v)}</span><span class="muted small">Stock ${esc(v.stock)}</span></div>
    ${r ? `<div class="notice mt12">${r.mine ? "Reservado por ti" : "Reservado por " + esc(r.sellerName)}${r.customerName ? " para " + esc(r.customerName) : ""} · ${until(r.expiresAt)}.</div>` : ""}
    ${v.demo ? '<div class="notice mt12">Unidad de demostración: no se reserva, cotiza ni vende.</div>' : ""}
    ${canSell() && !hasPrice(v) && sellable ? '<div class="notice info mt12">Administración aún no cargó el precio: no se puede cotizar.</div>' : ""}
    <div class="specs">${spec("Millaje", num(v.miles) + " mi")}${spec("Condición", { used: "Usado", new: "Nuevo", certified: "Certificado" }[v.condition])}${spec("Motor", v.engine)}${spec("Transmisión", localized(v.trans))}${spec("Tracción", v.drive)}${spec("Combustible", { gas: "Gasolina", diesel: "Diésel", hybrid: "Híbrido", electric: "Eléctrico" }[v.fuel])}${spec("Exterior", localized(v.ext))}${spec("Interior", localized(v.int))}${spec("VIN", v.vin)}</div>
    ${localized(v.desc) ? `<p class="help">${esc(localized(v.desc))}</p>` : ""}
    <div class="action-grid section">
      ${canQuote ? `<button class="primary wide" data-sheet="quote" type="button">${ICONS.quotes}Generar cotización</button>` : ""}
      ${canReserve ? `<button class="${canQuote ? "secondary" : "primary"}" data-sheet="reserve" type="button">${ICONS.holds}Reservar</button>` : ""}
      ${canSellNow ? `<button class="primary" data-sheet="sell" type="button">Registrar venta</button>` : ""}
      <button class="secondary" data-sheet="appt" type="button">${ICONS.agenda}${isService() ? "Agendar servicio" : "Prueba de manejo"}</button>
      <button class="wa-btn wide" data-sheet="share" type="button">${ICONS.whatsapp}Compartir por WhatsApp</button>
      ${S.crm?.connected && S.crm.me?.agentId ? `<button class="secondary" data-sheet="chat" type="button">${ICONS.chats}Enviar a un chat</button>` : ""}
      <button class="secondary" data-sheet="photos" type="button">${ICONS.camera}Agregar fotos</button>
      ${isAdmin() ? `<button class="secondary wide" data-sheet="edit" type="button">${ICONS.edit}Editar ficha y precio</button>` : ""}
    </div>`,
  );
  const track = body.querySelector("#galleryTrack");
  if (track && body.querySelector("#galleryDots"))
    track.addEventListener("scroll", () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      body.querySelectorAll("#galleryDots i").forEach((d, n) => d.classList.toggle("on", n === i));
    }, { passive: true });
  body.querySelector(".action-grid").onclick = (e) => {
    const b = e.target.closest("[data-sheet]");
    if (!b) return;
    const act = b.dataset.sheet;
    if (act === "quote") quoteForm({ vehicle: v });
    if (act === "reserve") reserveForm(v);
    if (act === "sell") saleForm({ vehicle: v });
    if (act === "appt") appointmentForm({ kind: isService() ? "service" : "testdrive", vehicleId: v.id });
    if (act === "share") shareSheet(v);
    if (act === "chat") pickConversation(v);
    if (act === "photos") addPhotos({ id: v.id, label: title(v), onDone: () => (forgetCatalog(), render()) });
    if (act === "edit") adminVehicleSheet(v.id);
  };
}
on("vehicle", (b) => vehicleSheet(S.catalog.find((v) => v.id === b.dataset.id)));

// ── Reservations and sales ───────────────────────────────────────────────────────────────────
export async function reserveForm(vehicle, prefill = {}) {
  const choices = vehicle ? [[vehicle.id, `${vehicle.stock} · ${title(vehicle)}`]] : await vehicleChoices();
  if (!choices.length) return notify("No hay vehículos disponibles para reservar.", true);
  const form = sheet(
    "Reservar para un cliente",
    `<form class="form">
      ${select("Vehículo", "vehicleId", choices, vehicle?.id, vehicle ? "disabled" : "")}
      ${vehicle ? `<input type="hidden" name="vehicleId" value="${esc(vehicle.id)}">` : ""}
      ${field("Nombre del cliente *", "customerName", prefill.customerName, "text", 'required maxlength="160" autocomplete="off"')}
      <div class="row">${field("Teléfono", "customerPhone", prefill.customerPhone, "tel", 'maxlength="60" inputmode="tel"')}${field("Email", "customerEmail", prefill.customerEmail, "email", 'maxlength="200"')}</div>
      <div class="row">${field("Depósito recibido (USD)", "deposit", 0, "number", 'min="0" step="0.01" inputmode="decimal"')}${select("Plazo", "days", [["1", "1 día"], ["2", "2 días"], ["3", "3 días"], ["5", "5 días"], ["7", "7 días"], ["14", "14 días"], ["30", "30 días"]], "3")}</div>
      ${isAdmin() ? select("Vendedor", "sellerId", peopleOptions("", { sellers: true }), S.user.id) : ""}
      <label>Notas<textarea name="notes" rows="2" maxlength="2000">${esc(prefill.notes || "")}</textarea></label>
      ${prefill.omniConversationId ? `<input type="hidden" name="omniConversationId" value="${esc(prefill.omniConversationId)}">` : ""}
      <p class="help">La unidad queda como «Reservado» en la página hasta que la vendas, la liberes o venza el plazo. El depósito es solo un registro: la app no cobra.</p>
      <p class="error" role="alert"></p>
      <div class="form-actions"><button class="primary block" type="submit">Confirmar reserva</button></div></form>`,
  ).querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form, async () => {
      await api("/api/admin/reservations", { method: "POST", body: formData(form) });
      closeSheet();
      notify("Reserva creada. El vehículo figura como reservado.");
      forgetCatalog();
      render();
    });
  };
}

export function saleForm({ vehicle, reservation }) {
  const v = vehicle || { id: reservation.vehicle_id, price: reservation.price, year: reservation.year, make: reservation.make, model: reservation.model, stock: reservation.stock };
  const r = reservation || {};
  const form = sheet(
    "Registrar venta",
    `<form class="form"><div class="notice">${esc(`${v.stock} · ${v.year} ${v.make} ${v.model}`)}. Al guardar, la unidad se marca como vendida y sale de la página.</div>
      <div class="row">${field("Precio final (USD) *", "price", Number(v.price) || "", "number", 'required min="0.01" step="0.01" inputmode="decimal"')}${field("Fecha de venta *", "soldAt", todayISO(), "date", "required")}</div>
      ${field("Nombre del comprador *", "buyerName", r.customer_name, "text", 'required maxlength="160"')}
      <div class="row">${field("Teléfono", "buyerPhone", r.customer_phone, "tel", 'maxlength="60" inputmode="tel"')}${field("Email", "buyerEmail", r.customer_email, "email", 'maxlength="200"')}</div>
      ${isAdmin() ? select("Vendedor que cierra", "sellerId", peopleOptions("", { sellers: true }), r.seller_id || vehicle?.reservation?.sellerId || S.user.id) : ""}
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
      forgetCatalog();
      render();
    });
  };
}
