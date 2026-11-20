// Units on the lot. Anyone on the team loads a unit (VIN, year, make, model, miles, body, color)
// and takes its photos with the phone's camera; it is a draft without a price until
// administration completes its details and publishes it (server/intake.js). Administration sees
// the drafts waiting, the whole inventory, and edits any unit's details, price and photos here.
import {
  $, api, esc, num, title, priceText, hasPrice, localized, notify, sheet, closeSheet, busy, formData, empty, field,
  select, check, isAdmin, on, go, render, stale, forgetCatalog, shortDate, ago, BODIES, CONDITIONS, FUELS,
  VEHICLE_STATUS, VEHICLE_TONE, ICONS,
} from "./core.js";

// ── Photos ───────────────────────────────────────────────────────────────────────────────────
// The phone's photos are large (and HEIC on iPhones): each is redrawn as a JPEG of at most
// 2048 px before it is sent, which the server then optimises. Much faster on mobile data.
const MAX_SIDE = 2048;
async function prepareImage(file) {
  const supported = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  if (supported && file.size < 1_500_000) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bitmap.width * k), height: Math.round(bitmap.height * k) });
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) throw new Error("toBlob");
    return new File([blob], (file.name || "foto").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    if (supported && file.size <= 10 * 1024 * 1024) return file;
    throw new Error("Este formato de foto no se pudo leer. Usa JPG, PNG o WEBP.");
  }
}

// The camera and gallery buttons with the photos chosen so far, before they are uploaded.
function photoPicker(root) {
  const items = [];
  root.innerHTML = `<div class="shoot">
      <label class="cam">${ICONS.camera}Tomar foto<input type="file" accept="image/*" capture="environment"></label>
      <label>${ICONS.image}Galería<input type="file" accept="image/*" multiple></label></div>
    <div class="thumbs-grid mt12" data-thumbs></div>
    <p class="help mt6" data-count></p>`;
  const grid = root.querySelector("[data-thumbs]");
  const draw = () => {
    grid.innerHTML = items
      .map(
        (it, i) => `<div class="thumb ${it.state || ""}"><img src="${it.url}" alt="Foto ${i + 1}">${i === 0 ? '<span class="tag">PORTADA</span>' : ""}
        ${it.state === "uploading" ? '<span class="state">Subiendo…</span>' : it.state === "done" ? '<span class="state">✓ Subida</span>' : it.state === "failed" ? `<span class="state">No se subió</span>` : `<button type="button" class="x" data-remove="${i}" aria-label="Quitar foto ${i + 1}">×</button>`}</div>`,
      )
      .join("");
    root.querySelector("[data-count]").textContent = items.length
      ? `${items.length} ${items.length === 1 ? "foto" : "fotos"}. La primera es la portada. Toma de frente, ¾, lateral, trasera, interior, tablero y millaje.`
      : "Toma de frente, ¾, lateral, trasera, interior, tablero y millaje. Puedes agregar más después.";
  };
  root.addEventListener("change", (e) => {
    const input = e.target.closest('input[type="file"]');
    if (!input) return;
    for (const file of input.files) items.push({ file, url: URL.createObjectURL(file) });
    input.value = "";
    draw();
  });
  grid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]");
    if (!b) return;
    const [it] = items.splice(Number(b.dataset.remove), 1);
    URL.revokeObjectURL(it.url);
    draw();
  });
  draw();
  return {
    get count() {
      return items.filter((it) => it.state !== "done").length;
    },
    // Sends the photos one by one; a failure doesn't stop the rest.
    async upload(vehicleId, onStep = () => {}) {
      const pending = items.filter((it) => it.state !== "done");
      let failed = 0;
      for (let i = 0; i < pending.length; i++) {
        const it = pending[i];
        it.state = "uploading";
        draw();
        onStep(i, pending.length);
        try {
          const form = new FormData();
          form.append("photo", await prepareImage(it.file));
          await api(`/api/admin/vehicles/${vehicleId}/photos`, { method: "POST", body: form });
          it.state = "done";
        } catch (e) {
          it.state = "failed";
          it.error = e.message;
          failed++;
        }
        draw();
      }
      onStep(pending.length, pending.length);
      return { sent: pending.length - failed, failed, error: pending.find((it) => it.error)?.error };
    },
  };
}
const progressBar = () => `<div class="progress mt12" data-progress hidden><i></i></div>`;
function stepper(root) {
  const bar = root.querySelector("[data-progress]");
  return (i, n) => {
    bar.hidden = !n || i >= n;
    bar.querySelector("i").style.width = `${n ? Math.round((i / n) * 100) : 0}%`;
  };
}

// Adds photos to any unit (the team may add; arranging them is administration's or the loader's).
export function addPhotos({ id, label, onDone = () => {} }) {
  const body = sheet(
    "Agregar fotos",
    `<p class="help mb10">${esc(label)}</p><div data-picker></div>${progressBar()}<p class="error" role="alert"></p>
    <div class="form-actions mt12"><button class="primary block" type="button" data-send>Subir fotos</button></div>`,
  );
  const picker = photoPicker(body.querySelector("[data-picker]"));
  const send = body.querySelector("[data-send]");
  send.onclick = async () => {
    if (!picker.count) return notify("Toma o elige al menos una foto.", true);
    send.disabled = true;
    const { sent, failed, error } = await picker.upload(id, stepper(body));
    send.disabled = false;
    if (failed) body.querySelector(".error").textContent = `${failed} no se subieron: ${error}. Toca «Subir fotos» para reintentar.`;
    else {
      closeSheet();
      notify(`${sent} ${sent === 1 ? "foto subida" : "fotos subidas"}.`);
      onDone();
    }
  };
}

// The photos a unit already has: cover first; move, make cover or remove.
function photoManager(root, v, { onChange }) {
  const draw = () => {
    root.innerHTML = v.photos.length
      ? `<div class="thumbs-grid">${v.photos
          .map(
            (p, i) => `<div class="thumb"><img src="${esc(p.url)}" alt="Foto ${i + 1}" loading="lazy">${i === 0 ? '<span class="tag">PORTADA</span>' : ""}
          <button type="button" class="x" data-del="${esc(p.id)}" aria-label="Quitar foto ${i + 1}">×</button>
          <div class="tools"><button type="button" data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Antes">‹</button>${i ? `<button type="button" data-cover="${i}">Portada</button>` : ""}<button type="button" data-move="${i}" data-dir="1" ${i === v.photos.length - 1 ? "disabled" : ""} aria-label="Después">›</button></div></div>`,
          )
          .join("")}</div>`
      : '<p class="notice">Sin fotos todavía.</p>';
  };
  draw();
  root.onclick = async (e) => {
    const del = e.target.closest("[data-del]"),
      move = e.target.closest("[data-move]"),
      cover = e.target.closest("[data-cover]");
    if (!del && !move && !cover) return;
    try {
      if (del) {
        if (!confirm("¿Quitar esta foto?")) return;
        await api(`/api/admin/vehicles/${v.id}/photos/${del.dataset.del}`, { method: "DELETE" });
        v.photos = v.photos.filter((p) => p.id !== del.dataset.del);
      } else {
        const ids = v.photos.map((p) => p.id);
        const i = Number((move || cover).dataset.move ?? cover.dataset.cover);
        if (cover) ids.unshift(...ids.splice(i, 1));
        else {
          const j = i + Number(move.dataset.dir);
          [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        await api(`/api/admin/vehicles/${v.id}/photos/order`, { method: "PUT", body: { ids } });
        v.photos = ids.map((id) => v.photos.find((p) => p.id === id));
      }
      draw();
      onChange?.();
    } catch (err) {
      notify(err.message, true);
    }
  };
}

// ── Loading a unit ──────────────────────────────────────────────────────────────────────────
export function intakeForm(existing = null) {
  const v = existing || {};
  const body0 = (v.cats || []).find((c) => c !== "electric") || (v.cats || [])[0] || "";
  const body = sheet(
    existing ? "Corregir datos de la unidad" : "Cargar vehículo",
    `<form class="form" id="intakeForm">
      ${existing ? "" : '<p class="help">Toma las fotos y anota lo que ves. Administración completa la ficha y el precio antes de publicarla.</p>'}
      <label>VIN<span class="input-action"><input name="vin" maxlength="17" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(v.vin)}" placeholder="17 caracteres (puerta o parabrisas)"><button class="secondary" type="button" data-decode>Buscar</button></span></label>
      <p class="help" data-vin-help>Con el VIN se llenan solos año, marca, modelo, versión y carrocería.</p>
      <div class="row3">${field("Año *", "year", v.year || "", "number", `required inputmode="numeric" min="1900" max="${new Date().getFullYear() + 2}"`)}${field("Marca *", "make", v.make, "text", 'required maxlength="80"')}${field("Modelo *", "model", v.model, "text", 'required maxlength="100"')}</div>
      <div class="row">${field("Versión / trim", "trim", v.trim, "text", 'maxlength="100"')}${field("Millaje *", "miles", v.miles ?? "", "number", 'required inputmode="numeric" min="0" step="1"')}</div>
      <label>Carrocería *</label>
      <div class="chips wrap" data-bodies>${BODIES.map(([k, l]) => `<button type="button" class="chip ${body0 === k ? "active" : ""}" data-body="${k}">${l}</button>`).join("")}</div>
      <input type="hidden" name="body" value="${esc(body0)}">
      <div class="row">${field("Color exterior", "ext", localized(v.ext), "text", 'maxlength="100"')}${select("Condición", "condition", CONDITIONS, v.condition || "used")}</div>
      <details class="more" ${v.engine || v.drive ? "open" : ""}><summary>Datos técnicos (opcional)</summary><div class="form">
        <div class="row">${field("Motor", "engine", v.engine, "text", 'maxlength="150"')}${field("Tracción", "drive", v.drive, "text", 'maxlength="30" placeholder="AWD, FWD…"')}</div>
        <div class="row">${field("Transmisión", "trans", localized(v.trans), "text", 'maxlength="100"')}${select("Combustible", "fuel", [["", "—"], ...FUELS], v.fuel || "")}</div>
      </div></details>
      ${existing ? "" : `<div class="form-section">Fotos</div><div data-picker></div>`}
      <label>Notas para administración<textarea name="notes" rows="3" maxlength="2000" placeholder="Detalles, golpes, llantas, llaves, documentos…">${esc(v.intakeNotes || "")}</textarea></label>
      ${progressBar()}
      <p class="error" role="alert"></p>
      <div class="form-actions"><button class="primary block" type="submit">${existing ? "Guardar cambios" : `${ICONS.units}Cargar unidad`}</button></div>
    </form>`,
  );
  const form = body.querySelector("#intakeForm");
  const picker = existing ? null : photoPicker(body.querySelector("[data-picker]"));
  body.querySelector("[data-bodies]").onclick = (e) => {
    const b = e.target.closest("[data-body]");
    if (!b) return;
    form.elements.body.value = b.dataset.body;
    body.querySelectorAll("[data-bodies] .chip").forEach((c) => c.classList.toggle("active", c === b));
  };
  const setBody = (k) => {
    if (!k) return;
    form.elements.body.value = k;
    body.querySelectorAll("[data-bodies] .chip").forEach((c) => c.classList.toggle("active", c.dataset.body === k));
  };
  body.querySelector("[data-decode]").onclick = async (e) => {
    const vin = form.elements.vin.value.trim().toUpperCase();
    form.elements.vin.value = vin;
    const help = body.querySelector("[data-vin-help]");
    if (vin.length !== 17) return (help.textContent = "El VIN tiene 17 caracteres. Revisa que no falte ninguno.");
    e.currentTarget.disabled = true;
    help.textContent = "Buscando el VIN…";
    try {
      const d = await api(`/api/admin/intake/vin/${encodeURIComponent(vin)}`);
      const put = (name, value) => value && (form.elements[name].value = value);
      put("year", d.year);
      put("make", d.make);
      put("model", d.model);
      put("trim", d.trim);
      put("engine", d.engine);
      put("drive", d.drive);
      put("trans", d.trans);
      put("fuel", d.fuel);
      setBody(d.body);
      if (d.engine || d.drive || d.trans) form.querySelector("details.more").open = true;
      help.textContent = `Encontrado: ${[d.year, d.make, d.model, d.trim].filter(Boolean).join(" ")}. Revisa los datos.`;
    } catch (err) {
      help.textContent = err.message;
    } finally {
      e.currentTarget.disabled = false;
    }
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form, async () => {
      const data = formData(form);
      if (!data.body) throw new Error("Elige la carrocería.");
      if (existing) {
        await api(`/api/admin/intake/${existing.id}`, { method: "PUT", body: data });
        closeSheet();
        notify("Datos actualizados.");
        return render();
      }
      const { id } = await api("/api/admin/intake", { method: "POST", body: data });
      let message = "Unidad cargada. Administración completará la ficha y el precio.";
      if (picker.count) {
        const { failed, error } = await picker.upload(id, stepper(body));
        if (failed) message = `Unidad cargada, pero ${failed} ${failed === 1 ? "foto no se subió" : "fotos no se subieron"} (${error}). Agrégalas desde Mis unidades.`;
      }
      closeSheet();
      notify(message, message.includes("no se"));
      go("units");
    });
  };
}
on("new-unit", () => intakeForm());

// ── Mis unidades / Inventario ───────────────────────────────────────────────────────────────
const view = { tab: "review", status: "", query: "" };
let unitCache = [];

function unitCard(v) {
  const cover = v.photos[0]?.url;
  return `<button class="vehicle" type="button" data-act="unit" data-id="${esc(v.id)}">
    <span class="photo-wrap">${cover ? `<img class="photo" src="${esc(cover)}" alt="" loading="lazy">` : '<span class="photo none">Sin foto</span>'}<span class="pill ${VEHICLE_TONE[v.status]}">${VEHICLE_STATUS[v.status]}</span>${v.photos.length ? `<span class="pill count">${v.photos.length} fotos</span>` : ""}</span>
    <span class="body"><h3>${esc(title(v))}</h3><span class="meta">${num(v.miles)} mi · Stock ${esc(v.stock)}${v.vin ? " · VIN …" + esc(v.vin.slice(-6)) : ""}</span>
    <span class="foot"><span class="price ${hasPrice(v) ? "" : "na"}">${hasPrice(v) ? priceText(v) : "Sin precio"}</span><span class="muted small">${v.intakeName && isAdmin() ? esc(v.intakeName) + " · " : ""}${ago(v.createdAt)}</span></span></span></button>`;
}

export async function unitsPage(current, extra) {
  const admin = isAdmin();
  const tab = admin ? view.tab : "mine";
  const list = await api(tab === "all" ? "/api/admin/vehicles" : "/api/admin/intake");
  if (stale(current)) return;
  unitCache = list;
  const statuses = ["", "draft", "available", "reserved", "sold", "archived"];
  $("content").innerHTML = `${admin ? `<div class="toolbar"><div class="segmented" id="unitTabs"><button type="button" data-tab="review" class="${tab === "review" ? "active" : ""}">Por completar</button><button type="button" data-tab="all" class="${tab === "all" ? "active" : ""}">Inventario</button></div><button class="secondary sm push" type="button" data-act="new-unit">${ICONS.camera}Cargar</button></div>` : `<div class="toolbar"><p class="help">Las unidades que cargaste. «En revisión» espera a que administración complete la ficha y el precio.</p></div>`}
    ${tab === "all" ? `<div class="toolbar"><input id="unitSearch" type="search" placeholder="Stock, VIN, marca o modelo" value="${esc(view.query)}" aria-label="Buscar unidades"></div><div class="chips" id="unitStatus">${statuses.map((s) => `<button type="button" class="chip ${view.status === s ? "active" : ""}" data-status="${s}">${s ? VEHICLE_STATUS[s] : "Todas"} <small>${s ? list.filter((v) => v.status === s).length : list.length}</small></button>`).join("")}</div>` : ""}
    <div class="grid" id="unitGrid"></div>`;
  const draw = () => {
    const q = view.query.toLowerCase();
    const shown = tab === "all" ? list.filter((v) => (!view.status || v.status === view.status) && `${v.stock} ${v.vin} ${v.year} ${v.make} ${v.model}`.toLowerCase().includes(q)) : list;
    $("unitGrid").innerHTML = shown.length
      ? shown.map(unitCard).join("")
      : tab === "review"
        ? empty("Nada por completar.", "Las unidades que el equipo cargue desde el lote aparecerán aquí para que completes la ficha y el precio.")
        : empty(tab === "mine" ? "Aún no has cargado unidades." : "Sin unidades.", "Toca + para cargar un vehículo con fotos desde el lote.", '<button class="primary" type="button" data-act="new-unit">Cargar vehículo</button>');
  };
  draw();
  $("unitTabs")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) (view.tab = b.dataset.tab), render();
  });
  $("unitSearch")?.addEventListener("input", (e) => ((view.query = e.target.value), draw()));
  $("unitStatus")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-status]");
    if (!b) return;
    view.status = b.dataset.status;
    $("unitStatus").querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === b));
    draw();
  });
  if (extra === "new") intakeForm();
}
on("unit", (b) => (isAdmin() ? adminVehicleSheet(b.dataset.id) : unitSheet(unitCache.find((v) => v.id === b.dataset.id))));

// A unit someone loaded, as they see it.
function unitSheet(v) {
  if (!v) return;
  const draft = v.status === "draft";
  const body = sheet(
    title(v),
    `<div class="between"><span class="pill ${VEHICLE_TONE[v.status]}">${VEHICLE_STATUS[v.status]}</span><span class="muted small">Stock ${esc(v.stock)} · cargada ${esc(shortDate(v.createdAt))}</span></div>
    <p class="help mt12">${draft ? "Administración aún no la publica: completa la ficha y el precio. Mientras tanto puedes corregir los datos y ordenar las fotos." : v.status === "archived" ? "Archivada: no se publica." : "Publicada en la página" + (hasPrice(v) ? ` a ${priceText(v)}.` : ".")}</p>
    <div class="specs">${[["VIN", v.vin], ["Millaje", num(v.miles) + " mi"], ["Color", localized(v.ext)], ["Motor", v.engine], ["Tracción", v.drive]].filter(([, x]) => x).map(([k, x]) => `<div><span>${k}</span>${esc(x)}</div>`).join("")}</div>
    ${v.intakeNotes ? `<p class="help pre">Notas: ${esc(v.intakeNotes)}</p>` : ""}
    <div class="section-head mt12"><h2>Fotos (${v.photos.length})</h2></div>
    <div data-photos></div>
    <div class="action-grid section">
      <button class="primary wide" type="button" data-u="photos">${ICONS.camera}Agregar fotos</button>
      ${draft ? `<button class="secondary" type="button" data-u="edit">${ICONS.edit}Corregir datos</button><button class="danger" type="button" data-u="discard">Descartar</button>` : ""}
    </div>`,
  );
  const photos = body.querySelector("[data-photos]");
  if (draft) photoManager(photos, v, { onChange: () => {} });
  else photos.innerHTML = v.photos.length ? `<div class="thumbs-grid">${v.photos.map((p, i) => `<div class="thumb"><img src="${esc(p.url)}" alt="Foto ${i + 1}" loading="lazy">${i ? "" : '<span class="tag">PORTADA</span>'}</div>`).join("")}</div>` : '<p class="notice">Sin fotos todavía.</p>';
  body.querySelector(".action-grid").onclick = async (e) => {
    const b = e.target.closest("[data-u]");
    if (!b) return;
    if (b.dataset.u === "photos") addPhotos({ id: v.id, label: title(v), onDone: render });
    if (b.dataset.u === "edit") intakeForm(v);
    if (b.dataset.u === "discard") {
      if (!confirm("¿Descartar esta unidad? Queda archivada con sus fotos; administración puede recuperarla.")) return;
      try {
        await api(`/api/admin/intake/${v.id}/discard`, { method: "POST", body: {} });
        closeSheet();
        notify("Unidad descartada.");
        render();
      } catch (err) {
        notify(err.message, true);
      }
    }
  };
}

// ── Administration: a unit's details, price, publication and photos ──────────────────────────
export async function adminVehicleSheet(id, tab = "details") {
  const all = await api("/api/admin/vehicles");
  const v = all.find((x) => x.id === id);
  if (!v) return notify("Vehículo no encontrado.", true);
  const loaded = v.intakeName
    ? `<div class="notice info mb10">Cargada por <strong>${esc(v.intakeName)}</strong> · ${esc(shortDate(v.createdAt))}${v.intakeNotes ? `<br><span class="pre">${esc(v.intakeNotes)}</span>` : ""}</div>`
    : "";
  const body = sheet(
    `${v.stock} · ${[v.year, v.make, v.model].join(" ")}`,
    `${loaded}<div class="segmented full mb10" data-tabs><button type="button" data-tab="details" class="${tab === "details" ? "active" : ""}">Ficha y precio</button><button type="button" data-tab="photos" class="${tab === "photos" ? "active" : ""}">Fotos (${v.photos.length})</button></div><div data-pane></div>`,
  );
  body.querySelector("[data-tabs]").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) adminVehicleSheet(id, b.dataset.tab);
  };
  const pane = body.querySelector("[data-pane]");
  if (tab === "photos") {
    pane.innerHTML = `<div data-photos></div><div class="form-actions mt12"><button class="primary block" type="button" data-add>${ICONS.camera}Agregar fotos</button></div><p class="help mt6">La primera es la portada. «Quitar fondo» está en el panel de administración.</p>`;
    photoManager(pane.querySelector("[data-photos]"), v, { onChange: forgetCatalog });
    pane.querySelector("[data-add]").onclick = () => addPhotos({ id: v.id, label: title(v), onDone: () => (forgetCatalog(), adminVehicleSheet(id, "photos")) });
    return;
  }
  if (v.status === "sold") {
    pane.innerHTML = `<div class="notice">Esta unidad tiene una venta registrada; su ficha queda bloqueada. Anula la venta desde el panel para editarla.</div>`;
    return;
  }
  const year = new Date().getFullYear() + 2;
  pane.innerHTML = `<form class="form" id="vehicleForm">
    ${v.status === "draft" ? '<p class="help">Completa el precio y los detalles y toca «Publicar» para que aparezca en la página y en el catálogo del equipo.</p>' : ""}
    <div class="row">${field("Stock *", "stock", v.stock, "text", 'required maxlength="40"')}${select("Estado", "status", [["draft", "Borrador"], ["available", "Disponible"], ["reserved", "Reservado"], ["archived", "Archivado"]], v.status)}</div>
    ${field("VIN", "vin", v.vin, "text", 'maxlength="17" autocapitalize="characters"')}
    <div class="row3">${field("Año *", "year", v.year, "number", `required min="1900" max="${year}" inputmode="numeric"`)}${field("Marca *", "make", v.make, "text", 'required maxlength="80"')}${field("Modelo *", "model", v.model, "text", 'required maxlength="100"')}</div>
    <div class="row">${field("Versión", "trim", v.trim)}${select("Carrocería", "body", BODIES, (v.cats || []).find((c) => c !== "electric") || v.cats?.[0] || "sedan")}</div>
    <div class="form-section">Precio</div>
    ${check("Mostrar «Consultar precio»", "priceOnRequest", v.priceOnRequest && !(v.status === "draft" && !(Number(v.price) > 0)))}
    <div class="row">${field("Precio de venta (USD) *", "price", v.price ?? 0, "number", 'required min="0" step="0.01" inputmode="decimal"')}${field("Precio de referencia", "msrp", v.msrp ?? v.price ?? 0, "number", 'required min="0" step="0.01" inputmode="decimal"')}</div>
    ${field("Costo de compra (privado)", "purchaseCost", v.purchaseCost ?? 0, "number", 'min="0" step="0.01" inputmode="decimal"')}
    <div class="form-section">Detalles</div>
    <div class="row">${field("Millaje", "miles", v.miles, "number", 'min="0" step="1" inputmode="numeric"')}${select("Condición", "condition", CONDITIONS, v.condition)}</div>
    <div class="row">${field("Motor", "engine", v.engine)}${field("Potencia (hp)", "hp", v.hp ?? 0, "number", 'min="0" max="3000" inputmode="numeric"')}</div>
    <div class="row">${field("Tracción", "drive", v.drive)}${field("Transmisión", "trans", localized(v.trans))}</div>
    <div class="row">${select("Combustible", "fuel", FUELS, v.fuel)}${field("Asientos", "seats", v.seats ?? "", "number", 'min="1" max="50" inputmode="numeric"')}</div>
    <div class="row">${field("Exterior", "ext", localized(v.ext))}${field("Interior", "int", localized(v.int))}</div>
    ${field("Consumo / autonomía", "economy", v.economy)}
    ${check("Destacar en el catálogo", "featured", v.featured)}
    ${check("Unidad de demostración (no vendible)", "demo", v.demo)}
    <div class="form-section">Descripción pública</div>
    <label>Español<textarea name="descEs" rows="3" maxlength="8000">${esc(v.desc?.es)}</textarea></label>
    <label>Inglés<textarea name="descEn" rows="3" maxlength="8000">${esc(v.desc?.en)}</textarea></label>
    <p class="error" role="alert"></p>
    <div class="action-grid">${v.status === "draft" ? '<button class="secondary" type="submit">Guardar borrador</button><button class="primary" type="submit" data-publish>Publicar</button>' : '<button class="primary wide" type="submit">Guardar cambios</button>'}</div>
  </form>`;
  const form = pane.querySelector("form");
  // A price typed in is the price shown: «Consultar precio» comes off by itself.
  form.elements.price.addEventListener("input", () => {
    if (Number(form.elements.price.value) > 0) form.elements.priceOnRequest.checked = false;
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    const publish = Boolean(e.submitter?.hasAttribute("data-publish"));
    busy(form, async () => {
      const data = formData(form);
      data.cats = [data.body];
      if (data.fuel === "electric" && data.body !== "electric") data.cats.push("electric");
      data.priceOnRequest = form.elements.priceOnRequest.checked;
      data.featured = form.elements.featured.checked;
      data.demo = form.elements.demo.checked;
      data.desc = { es: data.descEs, en: data.descEn };
      data.version = v.version;
      if (publish) data.status = "available";
      if (data.status !== "draft" && !data.priceOnRequest && !(Number(data.price) > 0))
        throw new Error("Pon el precio de venta o marca «Consultar precio» antes de publicar.");
      await api(`/api/admin/vehicles/${v.id}`, { method: "PUT", body: data });
      closeSheet();
      notify(data.status === "available" && v.status === "draft" ? "Unidad publicada en la página." : "Vehículo guardado.");
      forgetCatalog();
      render();
    });
  };
}
