const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const usd = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
const date = (v) =>
  v
    ? new Date(v).toLocaleString("es-DO", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const statusLabels = {
  draft: "Borrador",
  available: "Disponible",
  reserved: "Reservado",
  sold: "Vendido",
  archived: "Archivado",
  new: "Nueva",
  contacted: "Contactada",
  closed: "Cerrada",
};
const badge = (s) =>
  `<span class="status ${esc(s)}">${esc(statusLabels[s] || s)}</span>`;
const actions = {
  "vehicle.created": "Vehículo creado",
  "vehicle.updated": "Vehículo actualizado",
  "sale.created": "Venta registrada",
  "sale.cancelled": "Venta anulada",
  "photo.added": "Foto agregada",
  "photo.deleted": "Foto eliminada",
  "photo.cutout_saved": "Fondo de foto quitado",
  "photo.cutout_deleted": "Recorte de foto eliminado",
  "photos.reordered": "Fotos reordenadas",
  "expense.created": "Costo registrado",
  "content.updated": "Textos de la página actualizados",
  "settings.updated": "Datos de la página actualizados",
  "user.created": "Usuario creado",
  "user.active.changed": "Acceso de usuario actualizado",
  "password.changed": "Contraseña actualizada",
  "reservation.created": "Vehículo reservado",
  "reservation.released": "Reserva liberada",
  "reservation.extended": "Reserva extendida",
  "reservation.expired": "Reserva vencida",
  "appointment.created": "Cita agendada",
  "appointment.updated": "Cita actualizada",
  "lead.assigned": "Consulta asignada",
  "omnicanal.settings.updated": "Automatización de Omnicanal actualizada",
  "omnicanal.agent.linked": "Agente de Omnicanal vinculado",
  "password.changed.env": "Contraseña de administración tomada del entorno",
};
let user = null,
  page = "dashboard",
  vehicles = [],
  sales = [],
  leads = [],
  users = [],
  editorVehicle = null,
  toastTimer,
  renderTicket = 0;
async function api(url, options = {}) {
  const headers = { ...options.headers };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  if (user?.csrf) headers["X-CSRF-Token"] = user.csrf;
  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin",
  });
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
function notify(message, error = false) {
  $("toast").textContent = message;
  $("toast").classList.toggle("error-toast", error);
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6000);
}
function showLogin() {
  $("loginView").hidden = false;
  $("appView").hidden = true;
  $("editor").close();
  $("content").replaceChildren();
  document.querySelectorAll("#nav [data-omni]").forEach((n) => n.remove());
}
// One administration: Omnicanal's screens are entries of this menu, under "Omnicanal", and open
// inside this page. Which ones comes from Omnicanal (what this person has and the instance has on).
async function loadOmniMenu() {
  document.querySelectorAll("#nav [data-omni]").forEach((n) => n.remove());
  if (user?.role !== "admin") return;
  let menu;
  try {
    menu = await api("/api/admin/crm/menu");
  } catch {
    return;
  }
  const anchor = document.querySelector('#nav [data-page="omnicanal"]');
  if (!user || !anchor || !menu.entries?.length) return;
  let after = anchor;
  for (const entry of menu.entries) {
    const b = document.createElement("button");
    b.className = "sub";
    b.dataset.page = "omni:" + entry.path;
    b.dataset.omni = "";
    b.innerHTML = `<span>${esc(entry.label)}</span>`;
    after.after(b);
    after = b;
  }
  document.querySelectorAll("#nav button").forEach((n) => n.classList.toggle("active", n.dataset.page === page));
}
// The page lives in the address (#omnicanal/inbox), so a reload, a saved link or an address of
// /omnicanal that the server sends here opens the same screen.
function syncHash() {
  if (page.startsWith("omni:")) history.replaceState(null, "", "#omnicanal" + page.slice(5));
  else if (location.hash.startsWith("#omnicanal")) history.replaceState(null, "", location.pathname + location.search);
}
function showOmnicanal(path) {
  const frame = document.createElement("iframe");
  frame.className = "omni-frame";
  frame.title = "Omnicanal";
  frame.src = "/omnicanal/entrar?next=" + encodeURIComponent(path);
  $("content").replaceChildren(frame);
}
// The team's profiles (server/domain.js). Service doesn't reserve, sell or follow web inquiries.
const ROLE_LABELS = { admin: "Administración", sales: "Ventas", service: "Servicio" };
function showApp() {
  $("loginView").hidden = true;
  $("appView").hidden = false;
  $("userLabel").textContent = `${user.name} · ${ROLE_LABELS[user.role] || user.role}`;
  document
    .querySelectorAll("[data-admin]")
    .forEach((n) => (n.hidden = user.role !== "admin"));
  document
    .querySelectorAll("[data-seller]")
    .forEach((n) => (n.hidden = user.role === "service"));
  if (user.role === "service" && ["sales", "leads"].includes(page)) page = "dashboard";
  const target = user.role === "admin" ? location.hash.match(/^#omnicanal(\/[^#]*)$/) : null;
  if (target) page = "omni:" + target[1];
  else if (page.startsWith("omni:")) page = "dashboard";
  document.querySelectorAll("#nav button").forEach((n) => n.classList.toggle("active", n.dataset.page === page));
  loadOmniMenu();
  renderPage();
}
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  $("loginError").textContent = "";
  const b = form.querySelector("button");
  b.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    ({ user } = await api("/api/auth/login", { method: "POST", body: data }));
    form.reset();
    showApp();
  } catch (err) {
    $("loginError").textContent = err.message;
  } finally {
    b.disabled = false;
  }
});
// Omnicanal's panel opens with this account (/omnicanal/entrar) and keeps its session in this
// browser; closing the site's session closes that one too. Key: server/omni-embed.js.
function forgetOmnicanal() {
  try {
    localStorage.removeItem("omniai_session");
  } catch {}
}
$("logout").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    user = null;
    forgetOmnicanal();
    showLogin();
  } catch (e) {
    notify(e.message, true);
  }
});
$("nav").addEventListener("click", (e) => {
  const b = e.target.closest("[data-page]");
  if (!b) return;
  page = b.dataset.page;
  $("nav")
    .querySelectorAll("button")
    .forEach((n) => n.classList.toggle("active", n === b));
  document.querySelector(".sidebar").classList.remove("open");
  renderPage();
});
$("toggleNav").addEventListener("click", () =>
  document.querySelector(".sidebar").classList.toggle("open"),
);
$("closeEditor").addEventListener("click", () => $("editor").close());
function heading(title, subtitle, button = "") {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${button}</div>`;
}
function empty(title, body) {
  return `<div class="empty"><h3>${title}</h3><p>${body}</p></div>`;
}
function dialog(title, body) {
  $("editorTitle").textContent = title;
  $("editorBody").innerHTML = body;
  if (!$("editor").open) $("editor").showModal();
}
async function busy(form, fn) {
  const b = form.querySelector('button[type="submit"]');
  if (b) b.disabled = true;
  const err = form.querySelector(".error");
  if (err) err.textContent = "";
  try {
    await fn();
  } catch (e) {
    if (err) err.textContent = e.message;
    else notify(e.message, true);
  } finally {
    if (b) b.disabled = false;
  }
}
async function renderPage() {
  const ticket = ++renderTicket;
  syncHash();
  const inPanel = page.startsWith("omni:");
  $("content").classList.toggle("full", inPanel);
  if (inPanel) return showOmnicanal(page.slice(5));
  $("content").innerHTML = '<p class="muted">Cargando…</p>';
  try {
    if (["finance", "performance", "omnicanal"].includes(page)) {
      const insights = await import("/admin/insights.js");
      return await insights[page]({
        api,
        esc,
        usd,
        date,
        heading,
        empty,
        notify,
        busy,
        csv,
        $,
        current: () => ticket === renderTicket && Boolean(user),
        rerender: renderPage,
      });
    }
    let data;
    if (page === "dashboard") data = await api("/api/admin/dashboard");
    else if (page === "vehicles") vehicles = await api("/api/admin/vehicles");
    else if (page === "sales") {
      [sales, vehicles] = await Promise.all([
        api("/api/admin/sales"),
        api("/api/admin/vehicles"),
      ]);
    } else if (page === "leads") leads = await api("/api/admin/leads");
    else if (page === "settings") data = await api("/api/admin/settings");
    else if (page === "users") users = await api("/api/admin/users");
    if (ticket !== renderTicket || !user) return;
    ({
      dashboard: () => dashboard(data),
      vehicles: inventoryPage,
      sales: salesPage,
      leads: leadsPage,
      settings: () => settingsPage(data),
      users: usersPage,
      account: accountPage,
    })[page]();
  } catch (e) {
    if (ticket === renderTicket)
      $("content").innerHTML = empty("No se pudo cargar", esc(e.message));
  }
}
function dashboard(d) {
  const count = (s) => d.counts.find((c) => c.status === s)?.count || 0;
  const total = d.counts.reduce((n, c) => n + c.count, 0);
  $("content").innerHTML =
    heading(
      "Una vista de tu negocio.",
      "Inventario, consultas y ventas de Premier Line Motors.",
      `<button class="primary" id="dashNew">+ Agregar vehículo</button>`,
    ) +
    `<div class="stats"><article class="stat"><p>Vehículos disponibles</p><strong>${count("available")}</strong><small>${count("reserved")} reservados · ${count("draft")} borradores</small></article><article class="stat"><p>Ventas registradas</p><strong>${d.sales.count}</strong><small>Excluye ventas anuladas</small></article><article class="stat"><p>${user.role === "admin" ? "Ingresos por ventas" : "Vehículos en inventario"}</p><strong>${user.role === "admin" ? usd(d.sales.revenue) : total}</strong><small>${user.role === "admin" ? "Total histórico · USD" : "Incluye todos los estados"}</small></article><article class="stat"><p>Consultas pendientes</p><strong>${d.leads}</strong><small>Solicitudes por atender</small></article></div><div class="two-columns"><section class="panel"><div class="panel-title"><h2>Estado del inventario</h2></div><div class="panel-body">${["available", "reserved", "draft", "sold", "archived"].map((s) => `<div class="bar-row"><span>${statusLabels[s]}</span><progress max="${Math.max(total, 1)}" value="${count(s)}" aria-label="${statusLabels[s]}"></progress><b>${count(s)}</b></div>`).join("")}${user.role === "admin" ? `<p class="help">Margen bruto registrado: <strong>${usd(d.sales.margin)}</strong><br>Venta menos costo de compra y gastos registrados al cierre. No representa beneficio neto ni cobros recibidos.</p>` : ""}</div></section><section class="panel"><div class="panel-title"><h2>Actividad reciente</h2></div><div class="panel-body">${d.recent.length ? `<ul class="activity">${d.recent.map((a) => `<li><span>${esc(actions[a.action] || a.action)}</span><time>${date(a.created_at)}</time></li>`).join("")}</ul>` : '<p class="muted">La actividad aparecerá al comenzar a administrar el sitio.</p>'}</div></section></div><div class="notice">La página conserva su diseño original. Los vehículos disponibles y reservados de este panel se muestran en el catálogo público; los borradores, archivados y vendidos no se publican.</div>`;
  $("dashNew").onclick = () => newVehicle();
}
function vehicleRow(v) {
  return `<tr><td><div class="vehicle-cell">${v.photos[0] ? `<img class="thumb" src="${esc(v.photos[0].url)}" alt="">` : '<span class="thumb placeholder">Sin foto</span>'}<div><strong>${esc(v.year + " " + v.make + " " + v.model)}</strong><small>${esc(v.stock)} · ${Number(v.miles).toLocaleString()} mi</small></div></div></td><td>${badge(v.status)}${v.demo ? ' <span class="status">Demo</span>' : ""}</td><td>${v.priceOnRequest ? "Consultar precio" : usd(v.price)}</td><td>${v.photos.length} fotos</td><td><div class="actions"><button class="tiny" data-edit="${v.id}">Abrir ficha</button>${!v.demo && user.role !== "service" && ["available", "reserved"].includes(v.status) ? `<button class="tiny" data-sell="${v.id}">Registrar venta</button>` : ""}</div></td></tr>`;
}
function inventoryPage() {
  $("content").innerHTML =
    heading(
      "Inventario de vehículos.",
      "Gestiona las unidades, su publicación, fotografías y detalles.",
      `<div class="actions"><button class="secondary" id="exportVehicles">Exportar CSV</button>${user.role === "admin" ? '<button class="primary" id="newVehicle">+ Agregar vehículo</button>' : '<a class="primary" href="/ventas/#units/new">Cargar desde la app ↗</a>'}</div>`,
    ) +
    `<div class="toolbar"><input id="inventorySearch" type="search" placeholder="Buscar stock, VIN, marca o modelo" aria-label="Buscar vehículos"><select id="inventoryStatus" aria-label="Filtrar estado"><option value="">Todos los estados</option>${Object.entries(
      statusLabels,
    )
      .filter(([s]) =>
        ["draft", "available", "reserved", "sold", "archived"].includes(s),
      )
      .map(([s, l]) => `<option value="${s}">${l}</option>`)
      .join(
        "",
      )}</select></div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Vehículo</th><th>Estado</th><th>Precio</th><th>Fotografías</th><th>Acciones</th></tr></thead><tbody id="vehicleRows"></tbody></table></div><div id="vehicleEmpty"></div></div>`;
  const draw = () => {
    const q = $("inventorySearch").value.toLowerCase(),
      status = $("inventoryStatus").value;
    const list = vehicles.filter(
      (v) =>
        (!status || v.status === status) &&
        `${v.stock} ${v.vin} ${v.year} ${v.make} ${v.model}`
          .toLowerCase()
          .includes(q),
    );
    $("vehicleRows").innerHTML = list.map(vehicleRow).join("");
    $("vehicleEmpty").innerHTML = list.length
      ? ""
      : empty(
          "Tu inventario empieza aquí.",
          "Agrega un vehículo, completa su ficha y carga las fotos para publicarlo.",
        );
  };
  draw();
  $("inventorySearch").oninput = draw;
  $("inventoryStatus").onchange = draw;
  if ($("newVehicle")) $("newVehicle").onclick = newVehicle;
  $("exportVehicles").onclick = () =>
    csv(
      "inventario",
      vehicles.map((v) => ({
        stock: v.stock,
        vin: v.vin,
        year: v.year,
        make: v.make,
        model: v.model,
        status: statusLabels[v.status],
        price: v.price,
        miles: v.miles,
        ...(user.role === "admin" ? { purchaseCost: v.purchaseCost } : {}),
      })),
    );
  $("vehicleRows").onclick = (e) => {
    const edit = e.target.closest("[data-edit]"),
      sell = e.target.closest("[data-sell]");
    if (edit) openVehicle(edit.dataset.edit);
    if (sell) saleForm(sell.dataset.sell);
  };
}
function field(label, name, value = "", type = "text", extra = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function select(label, name, options, value, extra = "") {
  return `<label>${label}<select name="${name}" ${extra}>${options.map(([k, v]) => `<option value="${esc(k)}" ${String(value) === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
}
function newVehicle() {
  editorVehicle = {
    year: new Date().getFullYear(),
    make: "",
    model: "",
    stock: "",
    vin: "",
    status: "draft",
    price: 0,
    purchaseCost: 0,
    miles: 0,
    seats: 5,
    condition: "used",
    cats: ["sedan"],
    fuel: "gas",
    photos: [],
    desc: {},
    ext: {},
    int: {},
    trans: {},
  };
  vehicleEditor("details");
}
function openVehicle(id, tab = "details") {
  editorVehicle = vehicles.find((v) => v.id === id);
  if (editorVehicle) vehicleEditor(tab);
}
function vehicleEditor(tab) {
  const v = editorVehicle;
  dialog(
    v.id ? `${v.stock} · ${v.year} ${v.make} ${v.model}` : "Agregar vehículo",
    `<div class="subnav"><button data-tab="details" class="${tab === "details" ? "active" : ""}">Ficha</button>${v.id ? `<button data-tab="photos" class="${tab === "photos" ? "active" : ""}">Fotos (${v.photos.length})</button>${user.role === "admin" ? `<button data-tab="expenses" class="${tab === "expenses" ? "active" : ""}">Costos y gastos</button>` : ""}` : ""}</div><div id="vehicleTab"></div>`,
  );
  $("editorBody")
    .querySelectorAll("[data-tab]")
    .forEach((b) => (b.onclick = () => vehicleEditor(b.dataset.tab)));
  if (tab === "photos") return photosTab();
  if (tab === "expenses") return expensesTab();
  const target = $("vehicleTab");
  if (v.status === "sold") {
    target.innerHTML = `<div class="notice">Esta unidad tiene una venta registrada. Su ficha está bloqueada para preservar el historial. Administración puede anular la venta desde Ventas.</div><p><strong>${esc(v.year + " " + v.make + " " + v.model)}</strong><br>${esc(v.vin)}<br>${usd(v.price)}</p>`;
    return;
  }
  // Details, price and publication are administration's (server/index.js); the rest of the team
  // loads units and photos from the mobile app.
  if (user.role !== "admin") {
    target.innerHTML = `<div class="notice">La ficha, el precio y la publicación los completa administración. Puedes agregar fotos en la pestaña Fotos, o cargar unidades nuevas desde la <a href="/ventas/#units/new">app móvil</a>.</div><p><strong>${esc(v.year + " " + v.make + " " + v.model + (v.trim ? " " + v.trim : ""))}</strong><br>Stock ${esc(v.stock)}${v.vin ? " · VIN " + esc(v.vin) : ""}<br>${v.priceOnRequest ? "Consultar precio" : usd(v.price)} · ${Number(v.miles).toLocaleString()} mi</p>${v.intakeName ? `<p class="help">Cargada por ${esc(v.intakeName)}.</p>` : ""}`;
    return;
  }
  target.innerHTML = `<form id="vehicleForm">${v.intakeName ? `<div class="notice">Cargada desde la app por <strong>${esc(v.intakeName)}</strong>.${v.intakeNotes ? " Notas: " + esc(v.intakeNotes) : ""}</div>` : ""}<p class="help">Guarda la ficha antes de cambiar de pestaña. Disponible y reservado se publican; borrador y archivado permanecen internos.</p><div class="form-grid"><div class="form-section">Identificación</div>${field("Stock *", "stock", v.stock, "text", 'required maxlength="40"')}${field("VIN (17 caracteres)", "vin", v.vin, "text", 'maxlength="17" minlength="17"')}${select(
    "Estado",
    "status",
    [
      ["draft", "Borrador"],
      ["available", "Disponible"],
      ["reserved", "Reservado"],
      ["archived", "Archivado"],
    ],
    v.status,
  )}${field("Año *", "year", v.year, "number", 'required min="1900" max="' + (new Date().getFullYear() + 2) + '"')}${field("Marca *", "make", v.make, "text", 'required maxlength="80"')}${field("Modelo *", "model", v.model, "text", 'required maxlength="100"')}${field("Versión / trim", "trim", v.trim)}${select(
    "Carrocería",
    "body",
    [
      ["sedan", "Sedán"],
      ["suv", "SUV"],
      ["truck", "Pickup"],
      ["coupe", "Coupé / deportivo"],
      ["hatch", "Hatchback"],
      ["van", "Minivan / Van"],
      ["electric", "Eléctrico"],
    ],
    v.cats?.[0],
  )}${select(
    "Condición",
    "condition",
    [
      ["used", "Usado"],
      ["new", "Nuevo"],
      ["certified", "Certificado"],
    ],
    v.condition,
  )}<div class="form-section">Precio y características</div><label class="check"><input type="checkbox" name="priceOnRequest" ${v.priceOnRequest ? "checked" : ""}>Mostrar «Consultar precio»</label>${field("Precio de venta (USD) *", "price", v.price, "number", 'required min="0" step="0.01"')}${field("Precio de referencia (opcional)", "msrp", v.msrp ?? v.price, "number", 'min="0" step="0.01"')}${user.role === "admin" ? field("Costo de compra (privado, USD)", "purchaseCost", v.purchaseCost ?? 0, "number", 'min="0" step="0.01"') : ""}${field("Millaje", "miles", v.miles, "number", 'min="0" max="9999999" step="1"')}${field("Motor", "engine", v.engine)}${field("Potencia (hp)", "hp", v.hp ?? 0, "number", 'min="0" max="3000"')}${field("Tracción (AWD, FWD…)", "drive", v.drive)}${field("Transmisión", "trans", v.trans?.es || v.trans?.en)}${select(
    "Combustible",
    "fuel",
    [
      ["gas", "Gasolina"],
      ["diesel", "Diésel"],
      ["hybrid", "Híbrido"],
      ["electric", "Eléctrico"],
    ],
    v.fuel,
  )}${field("Asientos", "seats", v.seats ?? "", "number", 'min="1" max="50"')}${field("Exterior", "ext", v.ext?.es || v.ext?.en)}${field("Interior", "int", v.int?.es || v.int?.en)}${field("Consumo / autonomía", "economy", v.economy)}<label class="check"><input type="checkbox" name="featured" ${v.featured ? "checked" : ""}>Destacar en el catálogo</label><label class="check"><input type="checkbox" name="demo" ${v.demo ? "checked" : ""}>Unidad de demostración (no vendible)</label><div class="form-section">Descripción pública</div><label class="wide">Descripción en español<textarea name="descEs" rows="4" maxlength="8000">${esc(v.desc?.es)}</textarea></label><label class="wide">Descripción en inglés<textarea name="descEn" rows="4" maxlength="8000">${esc(v.desc?.en)}</textarea></label></div><p class="error" role="alert"></p><div class="form-footer"><button type="submit" class="primary">${v.id ? "Guardar cambios" : "Guardar y agregar fotos"} →</button></div></form>`;
  $("vehicleForm").onsubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, async () => {
      const data = Object.fromEntries(new FormData(form));
      data.cats = [data.body];
      if (data.fuel === "electric" && !data.cats.includes("electric"))
        data.cats.push("electric");
      data.featured = form.elements.featured.checked;
      data.demo = form.elements.demo.checked;
      data.priceOnRequest = form.elements.priceOnRequest.checked;
      data.desc = { es: data.descEs, en: data.descEn };
      data.version = v.version;
      const result = await api(
        "/api/admin/vehicles" + (v.id ? "/" + v.id : ""),
        { method: v.id ? "PUT" : "POST", body: data },
      );
      vehicles = await api("/api/admin/vehicles");
      notify("Vehículo guardado.");
      if (!v.id) {
        openVehicle(result.id, "photos");
      } else {
        $("editor").close();
        renderPage();
      }
    });
  };
}
function photosTab() {
  const v = editorVehicle;
  // Anyone adds photos; ordering, removing and cutouts are administration's, or the loader's while
  // the unit is their draft (server/intake.js, canArrangePhotos).
  const arrange = user.role === "admin" || (v.status === "draft" && v.intakeBy === user.id);
  $("vehicleTab").innerHTML =
    `<p class="help">La primera imagen es la portada. Puedes cambiar el orden con las flechas. JPG, PNG o WEBP; hasta 10 MB por archivo y 60 fotos por unidad. Las fotos se guardan en Neon y se optimizan automáticamente. Con «Quitar fondo», los clientes pueden deslizar una cortina que cambia el fondo de esa foto.</p><div class="file-upload"><label>Agregar fotografías<input id="photoFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple></label></div><p id="photoStatus" role="status"></p><div class="photo-grid">${v.photos.map((p, i) => `<article class="photo"><img src="${esc(p.url)}" alt="Foto ${i + 1}"><span>${i === 0 ? "PORTADA" : "Foto " + (i + 1)}</span>${arrange ? `<div class="actions"><button type="button" class="tiny" data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Mover foto ${i + 1} antes">←</button><button type="button" class="tiny" data-move="${i}" data-dir="1" ${i === v.photos.length - 1 ? "disabled" : ""} aria-label="Mover foto ${i + 1} después">→</button><button type="button" class="tiny" data-delete-photo="${p.id}">Quitar</button></div><button type="button" class="tiny photo-cutout${p.cutoutUrl ? " has-cutout" : ""}" data-cutout="${p.id}">${p.cutoutUrl ? "✓ Ver cortina" : "Quitar fondo"}</button>` : ""}</article>`).join("")}</div>`;
  $("photoFiles").onchange = async (e) => {
    const files = [...e.target.files];
    e.target.disabled = true;
    try {
      for (let i = 0; i < files.length; i++) {
        $("photoStatus").textContent = `Subiendo ${i + 1} de ${files.length}…`;
        const form = new FormData();
        form.append("photo", files[i]);
        await api(`/api/admin/vehicles/${v.id}/photos`, {
          method: "POST",
          body: form,
        });
      }
      notify("Fotos guardadas.");
    } catch (err) {
      notify(err.message, true);
    } finally {
      vehicles = await api("/api/admin/vehicles");
      openVehicle(v.id, "photos");
    }
  };
  $("vehicleTab").querySelector(".photo-grid").onclick = async (e) => {
    const move = e.target.closest("[data-move]"),
      del = e.target.closest("[data-delete-photo]"),
      cutout = e.target.closest("[data-cutout]");
    if (!move && !del && !cutout) return;
    try {
      if (cutout) {
        const { openCutoutDialog } = await import("/admin/cutout.js");
        openCutoutDialog({
          vehicleId: v.id,
          photo: v.photos.find((p) => p.id === cutout.dataset.cutout),
          api,
          notify,
          onChanged: async () => {
            vehicles = await api("/api/admin/vehicles");
            openVehicle(v.id, "photos");
          },
        });
        return;
      }
      if (del) {
        if (!confirm("¿Quitar esta foto del vehículo?")) return;
        await api(
          `/api/admin/vehicles/${v.id}/photos/${del.dataset.deletePhoto}`,
          { method: "DELETE" },
        );
      } else {
        const index = Number(move.dataset.move),
          other = index + Number(move.dataset.dir);
        const ids = v.photos.map((p) => p.id);
        [ids[index], ids[other]] = [ids[other], ids[index]];
        await api(`/api/admin/vehicles/${v.id}/photos/order`, {
          method: "PUT",
          body: { ids },
        });
      }
      vehicles = await api("/api/admin/vehicles");
      openVehicle(v.id, "photos");
    } catch (err) {
      notify(err.message, true);
    }
  };
}
async function expensesTab() {
  const v = editorVehicle;
  $("vehicleTab").innerHTML = '<p class="muted">Cargando costos…</p>';
  try {
    const costs = await api(`/api/admin/vehicles/${v.id}/expenses`);
    if (!$("editor").open || editorVehicle.id !== v.id) return;
    const total =
      Number(v.purchaseCost) + costs.reduce((n, c) => n + Number(c.amount), 0);
    $("vehicleTab").innerHTML =
      `<div class="stats"><div class="stat"><p>Compra</p><strong>${usd(v.purchaseCost)}</strong></div><div class="stat"><p>Costo acumulado</p><strong>${usd(total)}</strong></div></div><p class="help">Estos importes son privados. Transporte, reparaciones y acondicionamiento se suman al costo de compra para calcular el margen bruto al vender.</p><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Importe</th></tr></thead><tbody>${costs.map((c) => `<tr><td>${esc(String(c.expense_date).slice(0, 10))}</td><td>${esc(c.description)}</td><td>${usd(c.amount)}</td></tr>`).join("")}</tbody></table></div>${v.status !== "sold" ? `<h3>Agregar gasto</h3><form id="expenseForm"><div class="form-grid">${field("Concepto *", "description", "", "text", 'required maxlength="300"')}${field("Importe (USD) *", "amount", "", "number", 'required min="0.01" step="0.01"')}${field("Fecha *", "date", today(), "date", "required")}</div><p class="error" role="alert"></p><button type="submit" class="primary">Registrar gasto</button></form>` : ""}`;
    if ($("expenseForm"))
      $("expenseForm").onsubmit = (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        busy(form, async () => {
          await api(`/api/admin/vehicles/${v.id}/expenses`, {
            method: "POST",
            body: Object.fromEntries(new FormData(form)),
          });
          notify("Gasto registrado.");
          expensesTab();
        });
      };
  } catch (e) {
    notify(e.message, true);
  }
}
function salesPage() {
  $("content").innerHTML =
    heading(
      "Ventas.",
      "Registra operaciones y conserva su historial. Registrar una venta retira el vehículo del catálogo.",
      `<div class="actions"><button class="secondary" id="exportSales">Exportar CSV</button><button class="primary" id="newSale">+ Registrar venta</button></div>`,
    ) +
    `<div class="panel"><div class="table-wrap"><table><thead><tr><th>Vehículo</th><th>Comprador</th><th>Vendedor</th><th>Fecha</th><th>Venta</th>${user.role === "admin" ? "<th>Margen bruto</th>" : ""}<th>Estado</th><th>Acciones</th></tr></thead><tbody>${sales.map((s) => `<tr><td><strong>${esc(s.year + " " + s.make + " " + s.model)}</strong><small>${esc(s.stock)}</small></td><td><strong>${esc(s.buyer_name)}</strong><small>${esc(s.buyer_phone)} ${esc(s.buyer_email)}</small></td><td>${esc(s.seller_name || "—")}</td><td>${esc(String(s.sold_at).slice(0, 10))}</td><td>${usd(s.price)}</td>${user.role === "admin" ? `<td>${usd(Number(s.price) - Number(s.cost))}</td>` : ""}<td>${s.cancelled_at ? "Anulada" : "Registrada"}</td><td><div class="actions"><button class="tiny" data-sale-detail="${s.id}">Ver detalle</button>${user.role === "admin" && !s.cancelled_at ? `<button class="tiny" data-cancel-sale="${s.id}">Anular</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>${sales.length ? "" : empty("Aún no hay ventas.", "Selecciona una unidad disponible o reservada para registrar la operación.")}</div><p class="help">Registro comercial interno. No genera contratos ni ejecuta cobros. Los costos quedan fijados al registrar la venta; una anulación conserva el historial y devuelve el vehículo a disponible.</p>`;
  $("newSale").onclick = () => saleForm();
  $("exportSales").onclick = () =>
    csv(
      "ventas",
      sales.map((s) => ({
        stock: s.stock,
        vehicle: `${s.year} ${s.make} ${s.model}`,
        buyer: s.buyer_name,
        seller: s.seller_name,
        phone: s.buyer_phone,
        email: s.buyer_email,
        price: s.price,
        ...(user.role === "admin"
          ? { cost: s.cost, margin: Number(s.price) - Number(s.cost) }
          : {}),
        date: s.sold_at,
        status: s.cancelled_at ? "Anulada" : "Registrada",
      })),
    );
  $("content").querySelector("tbody").onclick = async (e) => {
    const cancel = e.target.closest("[data-cancel-sale]"),
      detail = e.target.closest("[data-sale-detail]");
    if (detail) {
      const s = sales.find((s) => s.id === detail.dataset.saleDetail);
      dialog(
        "Detalle de venta",
        `<h3>${esc(s.year + " " + s.make + " " + s.model)} · ${esc(s.stock)}</h3><p>${esc(s.buyer_name)}<br>${esc(s.buyer_phone)}<br>${esc(s.buyer_email)}</p><p class="help">Vendedor: ${esc(s.seller_name || "—")}</p><p>Venta: <strong>${usd(s.price)}</strong>${user.role === "admin" ? `<br>Costo al cierre: ${usd(s.cost)}<br>Margen bruto: ${usd(Number(s.price) - Number(s.cost))}` : ""}</p><p class="lead-detail">${esc(s.notes || "Sin notas adicionales.")}</p><p class="help">${s.cancelled_at ? "Anulada el " + date(s.cancelled_at) : "Registrada el " + date(s.created_at)}</p>`,
      );
    }
    if (
      cancel &&
      confirm(
        "¿Anular esta venta? El vehículo volverá a estar disponible en la página.",
      )
    ) {
      try {
        await api(`/api/admin/sales/${cancel.dataset.cancelSale}/cancel`, {
          method: "POST",
        });
        notify("Venta anulada; historial conservado.");
        renderPage();
      } catch (err) {
        notify(err.message, true);
      }
    }
  };
}
async function saleForm(vehicleId = "") {
  const team =
    user.role === "admin" ? await api("/api/admin/team").catch(() => []) : [];
  const list = vehicles.filter(
    (v) => !v.demo && ["available", "reserved"].includes(v.status),
  );
  if (!list.length)
    return notify(
      "Primero guarda un vehículo real como disponible o reservado. Las unidades Demo no registran ventas.",
      true,
    );
  const v = list.find((v) => v.id === vehicleId) || list[0];
  dialog(
    "Registrar venta",
    `<form id="saleForm"><div class="notice">Al guardar, la unidad se marcará como vendida y dejará de aparecer en el catálogo público.</div><div class="form-grid"><label class="wide">Vehículo *<select name="vehicleId" id="saleVehicle">${list.map((x) => `<option value="${x.id}" ${x.id === v.id ? "selected" : ""}>${esc(x.stock + " · " + x.year + " " + x.make + " " + x.model)}</option>`).join("")}</select></label>${field("Precio final (USD) *", "price", v.price, "number", 'required min="0.01" step="0.01"')}${field("Fecha de venta *", "soldAt", today(), "date", "required")}${field("Nombre del comprador *", "buyerName", "", "text", 'required maxlength="160"')}${field("Teléfono", "buyerPhone", "", "tel", 'maxlength="60"')}${field("Email", "buyerEmail", "", "email", 'maxlength="200"')}${user.role === "admin" ? select("Vendedor que cierra", "sellerId", [["", "Automático: dueño de la reserva o quien registra"], ...team.map((u) => [u.id, u.name])], "") : ""}<label class="wide">Notas internas<textarea name="notes" rows="3" maxlength="4000"></textarea></label></div><p class="error" role="alert"></p><div class="form-footer"><button type="submit" class="primary">Confirmar registro de venta</button></div></form>`,
  );
  $("saleVehicle").onchange = (e) => {
    $("saleForm").elements.price.value = list.find(
      (v) => v.id === e.target.value,
    ).price;
  };
  $("saleForm").onsubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, async () => {
      await api("/api/admin/sales", {
        method: "POST",
        body: Object.fromEntries(new FormData(form)),
      });
      $("editor").close();
      notify("Venta registrada. El vehículo ya no se publica.");
      renderPage();
    });
  };
}
function leadsPage() {
  $("content").innerHTML =
    heading(
      "Consultas y oportunidades.",
      "Solicitudes de financiamiento, citas, prueba de manejo, intercambio y contacto recibidas en la página.",
      `<button class="secondary" id="exportLeads">Exportar CSV</button>`,
    ) +
    `<div class="panel"><div class="table-wrap"><table><thead><tr><th>Contacto</th><th>Solicitud</th><th>Detalles</th><th>Fecha</th><th>Seguimiento</th></tr></thead><tbody>${leads
      .map(
        (l) =>
          `<tr><td><strong>${esc(l.name)}</strong><small>${esc(l.phone)}<br>${esc(l.email)}</small></td><td>${{ testdrive: "Prueba de manejo", trade: "Intercambio", contact: "Contacto", finance: "Financiamiento", visit: "Cita" }[l.kind] || esc(l.kind)}<br><small>${esc(l.stock || "")}${l.make ? " · " + esc(l.make + " " + l.model) : ""}</small></td><td><div class="lead-detail">${esc(
            Object.entries(l.data)
              .filter(([, v]) => v)
              .map(
                ([k, v]) =>
                  `${{ date: "Fecha", time: "Hora", msg: "Mensaje", year: "Año", make: "Marca", model: "Modelo", miles: "Millaje", condition: "Condición", topic: "Motivo", down: "Inicial", employment: "Empleo", income: "Ingreso mensual", credit: "Crédito" }[k] || k}: ${v}`,
              )
              .join("\n"),
          )}</div></td><td>${date(l.created_at)}<br><small>${l.assigned_name ? "Atiende " + esc(l.assigned_name) : "Sin asignar"}</small></td><td><select data-lead="${l.id}" aria-label="Estado de consulta de ${esc(l.name)}">${["new", "contacted", "closed"].map((s) => `<option value="${s}" ${l.status === s ? "selected" : ""}>${statusLabels[s]}</option>`).join("")}</select></td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div>${leads.length ? "" : empty("No hay consultas todavía.", "Los formularios del sitio guardarán aquí las solicitudes de tus visitantes.")}</div><p class="help">Se muestran las 500 consultas más recientes.</p>`;
  $("content").querySelector("tbody").onchange = async (e) => {
    const s = e.target.closest("[data-lead]");
    if (s) {
      try {
        await api("/api/admin/leads/" + s.dataset.lead, {
          method: "PUT",
          body: { status: s.value },
        });
        notify("Seguimiento actualizado.");
      } catch (err) {
        notify(err.message, true);
      }
    }
  };
  $("exportLeads").onclick = () =>
    csv(
      "consultas",
      leads.map((l) => ({
        name: l.name,
        phone: l.phone,
        email: l.email,
        type: l.kind,
        status: l.status,
        created: l.created_at,
      })),
    );
}
function settingsPage(s) {
  $("content").innerHTML =
    heading(
      "Tu página web.",
      "Actualiza los datos del concesionario sin cambiar el diseño original.",
    ) +
    `<div class="settings-grid"><section class="panel"><div class="panel-title"><h2>Datos de contacto</h2></div><form id="settingsForm" class="panel-body"><div class="form-grid">${field("Nombre comercial *", "name", s.name, "text", 'required maxlength="200"')}${field("Teléfono visible", "phone", s.phone)}${field("Teléfono internacional *", "phoneNumber", s.phoneNumber, "text", 'required placeholder="+12016250077"')}${field("Email *", "email", s.email, "email", "required")}${field("Dirección", "address", s.address)}${field("Ciudad / estado / ZIP", "city", s.city)}${field("Instagram (URL completa)", "instagram", s.instagram, "url")}${field("Facebook (URL completa)", "facebook", s.facebook, "url")}${field("TikTok (URL completa)", "tiktok", s.tiktok, "url")}</div><p class="error" role="alert"></p><button type="submit" class="primary">Guardar datos del sitio</button></form></section><section class="panel"><div class="panel-title"><h2>Logo</h2></div><div class="panel-body"><img class="setting-logo" src="/api/site/logo" alt="Logo actual"><form id="logoForm"><label>Cargar logo<input name="photo" type="file" accept="image/png,image/webp,image/jpeg" required></label><p class="help">PNG, WEBP o JPG. Máximo 10 MB. Se conserva la transparencia y se actualizan la página y el panel.</p><p class="error" role="alert"></p><button type="submit" class="secondary">Actualizar logo</button></form></div></section></div><section class="panel"><div class="panel-title"><h2>Textos y contenido de la página</h2></div><div class="panel-body"><p class="help">Edita los textos en inglés y español. Los campos vacíos conservan el texto original; el diseño no cambia.</p><button class="secondary" id="editContent">Editar contenido</button></div></section><div class="notice">El sitio conserva sus vistas inmersiva y clásica, el showroom y sus estilos. La configuración cambia los datos comerciales y la identidad; no reemplaza la estructura.</div>`;
  $("editContent").onclick = contentEditor;
  $("settingsForm").onsubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, async () => {
      await api("/api/admin/settings", {
        method: "PUT",
        body: Object.fromEntries(new FormData(form)),
      });
      notify("Datos actualizados en la página pública.");
    });
  };
  $("logoForm").onsubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, async () => {
      await api("/api/admin/settings/logo", {
        method: "POST",
        body: new FormData(form),
      });
      notify("Logo actualizado.");
      document
        .querySelectorAll('img[src^="/api/site/logo"]')
        .forEach((i) => (i.src = "/api/site/logo?t=" + Date.now()));
    });
  };
}
function usersPage() {
  $("content").innerHTML =
    heading(
      "Equipo y accesos.",
      "Administración controla precios, publicación, costos y usuarios. Ventas cotiza, reserva y vende; Servicio carga unidades y lleva su agenda. Desde la app móvil también puedes cambiar perfiles y restablecer contraseñas.",
      `<button class="primary" id="newUser">+ Agregar usuario</button>`,
    ) +
    `<div class="panel"><div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Acceso</th><th>Acciones</th></tr></thead><tbody>${users.map((u) => `<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.username)}</td><td>${ROLE_LABELS[u.role] || u.role}</td><td>${u.active ? "Activo" : "Desactivado"}</td><td>${u.id !== user.id ? `<button class="tiny" data-toggle-user="${u.id}">${u.active ? "Desactivar" : "Reactivar"}</button>` : "Tu cuenta"}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("newUser").onclick = () => {
    dialog(
      "Agregar usuario",
      `<form id="userForm"><div class="form-grid">${field("Nombre *", "name", "", "text", 'required maxlength="100"')}${field("Usuario *", "username", "", "text", 'required minlength="3" maxlength="80" pattern="[a-z0-9_.@\\-]+"')}${select(
        "Rol",
        "role",
        [
          ["sales", "Ventas"],
          ["service", "Servicio"],
          ["admin", "Administración"],
        ],
        "sales",
      )}<label class="wide">Contraseña inicial *<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label></div><p class="help">Usa una contraseña única de al menos 12 caracteres. Compártela directamente con el usuario. Puede cambiarla desde Mi cuenta.</p><p class="error" role="alert"></p><button type="submit" class="primary">Crear usuario</button></form>`,
    );
    $("userForm").onsubmit = (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      busy(form, async () => {
        await api("/api/admin/users", {
          method: "POST",
          body: Object.fromEntries(new FormData(form)),
        });
        $("editor").close();
        notify("Usuario creado.");
        renderPage();
      });
    };
  };
  $("content").querySelector("tbody").onclick = async (e) => {
    const b = e.target.closest("[data-toggle-user]");
    if (!b) return;
    const u = users.find((u) => u.id === b.dataset.toggleUser);
    try {
      await api(`/api/admin/users/${u.id}/active`, {
        method: "PUT",
        body: { active: !u.active },
      });
      notify("Acceso actualizado.");
      renderPage();
    } catch (err) {
      notify(err.message, true);
    }
  };
}
function accountPage() {
  $("content").innerHTML =
    heading("Mi cuenta.", "Tu acceso personal a Premier Management Suite.") +
    `<section class="panel"><div class="panel-title"><h2>${esc(user.name)} · ${esc(user.username)}</h2></div><form id="passwordForm" class="panel-body account-form"><label>Contraseña actual<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>Nueva contraseña<input name="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label><label>Repetir nueva contraseña<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label><p class="help">Al actualizarla se cierran las demás sesiones de esta cuenta.</p><p class="error" role="alert"></p><button class="primary" type="submit">Actualizar contraseña</button></form></section>`;
  $("passwordForm").onsubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, async () => {
      const data = Object.fromEntries(new FormData(form));
      if (data.newPassword !== data.confirmPassword)
        throw new Error("Las contraseñas no coinciden.");
      await api("/api/auth/password", { method: "POST", body: data });
      form.reset();
      notify("Contraseña actualizada.");
    });
  };
}
function csv(name, rows) {
  if (!rows.length) return notify("No hay datos para exportar.");
  const keys = Object.keys(rows[0]);
  const value = (v) => {
    let s = String(v ?? "");
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const content =
    "\uFEFF" +
    [
      keys.map(value).join(","),
      ...rows.map((r) => keys.map((k) => value(r[k])).join(",")),
    ].join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `premier-${name}-${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
try {
  ({ user } = await api("/api/auth/me"));
  showApp();
} catch {
  showLogin();
}

async function contentEditor() {
  try {
    const content = await api("/api/content");
    const { STRINGS } = await import("/js/i18n.js");
    const labels = {
      "hero.eyebrow": "Portada · etiqueta",
      "hero.t1": "Portada · título, línea 1",
      "hero.t2": "Portada · título, línea 2",
      "hero.lead": "Portada · descripción",
      "hero.b1": "Portada · beneficio 1",
      "hero.b2": "Portada · beneficio 2",
      "hero.b3": "Portada · beneficio 3",
      "hc.kicker": "Vista clásica · etiqueta",
      "hc.title": "Vista clásica · título",
      "hc.lead": "Vista clásica · descripción",
      "hc.t1": "Vista clásica · beneficio 1",
      "hc.t2": "Vista clásica · beneficio 2",
      "hc.t3": "Vista clásica · beneficio 3",
      "fin.title": "Financiamiento · título",
      "fin.lead": "Financiamiento · descripción",
      "fin.p1": "Financiamiento · punto 1",
      "fin.p2": "Financiamiento · punto 2",
      "fin.p3": "Financiamiento · punto 3",
      "fin.cta": "Financiamiento · botón",
      "fin.disclaimer": "Financiamiento · condiciones",
      "trade.title": "Intercambio · título",
      "trade.lead": "Intercambio · descripción",
      "trade.s1": "Intercambio · paso 1",
      "trade.s2": "Intercambio · paso 2",
      "trade.s3": "Intercambio · paso 3",
      "why.title": "Nosotros · título",
      "why.f1t": "Nosotros · ventaja 1 título",
      "why.f1": "Nosotros · ventaja 1 texto",
      "why.f2t": "Nosotros · ventaja 2 título",
      "why.f2": "Nosotros · ventaja 2 texto",
      "why.f3t": "Nosotros · ventaja 3 título",
      "why.f3": "Nosotros · ventaja 3 texto",
      "why.f4t": "Nosotros · ventaja 4 título",
      "why.f4": "Nosotros · ventaja 4 texto",
      "rev.eyebrow": "Reseñas · etiqueta",
      "rev.title": "Reseñas · título",
      "rev.r1": "Reseña 1",
      "rev.r2": "Reseña 2",
      "rev.r3": "Reseña 3",
      "visit.title": "Visita · título",
      "top.hours": "Horario · indicación",
      "visit.closed": "Horario · domingo",
      "form.lead": "Formulario · descripción",
      "form.consent": "Formulario · consentimiento",
      "footer.tag": "Pie de página · descripción",
      "footer.legal": "Pie de página · condiciones",
    };
    let language = "es";
    dialog(
      "Editar contenido",
      `<form id="contentForm"><label>Idioma<select id="contentLanguage"><option value="es">Español</option><option value="en">English</option></select></label><div id="contentFields"></div><p class="error" role="alert"></p><button type="submit" class="primary">Guardar textos en ambos idiomas</button></form>`,
    );
    const store = () => {
      for (const node of $("contentFields").querySelectorAll("textarea"))
        content[language][node.name] = node.value;
    };
    const draw = () => {
      $("contentFields").innerHTML = Object.entries(labels)
        .map(
          ([key, label]) =>
            `<label>${esc(label)}<textarea name="${key}" rows="2" maxlength="8000" placeholder="${esc(STRINGS[language][key])}">${esc(content[language]?.[key] || "")}</textarea></label>`,
        )
        .join("");
    };
    content.en ??= {};
    content.es ??= {};
    draw();
    $("contentLanguage").onchange = (e) => {
      store();
      language = e.target.value;
      draw();
    };
    $("contentForm").onsubmit = (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      busy(form, async () => {
        store();
        await api("/api/admin/content", { method: "PUT", body: content });
        $("editor").close();
        notify("Textos guardados. Se reflejan al recargar la página pública.");
      });
    };
  } catch (err) {
    notify(err.message, true);
  }
}
