// Quotes: cash or an estimated monthly payment for a published unit, at the price administration
// set. The preview uses the same function the server stores the figures with (js/quote-math.js).
// The customer gets a link (/cotizacion/<token>) by WhatsApp; the page prints as a PDF.
import {
  S, $, api, esc, usd, usd2, title, hasPrice, priceText, notify, sheet, closeSheet, busy, formData, empty, field,
  select, options, peopleOptions, isAdmin, waLink, on, render, stale, loadCatalog, ICONS, shortDate, dayLabel,
} from "./core.js";
import { quoteFigures, QUOTE_TERMS } from "/js/quote-math.js";
import { copy } from "./share.js";
import { reserveForm } from "./catalog.js";
import { appointmentForm } from "./agenda.js";

let settings = null;
export async function quoteSettings(force = false) {
  if (force || !settings) settings = await api("/api/admin/quote-settings");
  return settings;
}
const view = { seller: "", query: "" };
let quoteCache = [];

function linesHtml(f) {
  const row = (label, value, cls = "") => `<tr class="${cls}"><th scope="row">${esc(label)}</th><td>${esc(value)}</td></tr>`;
  const financed = f.termMonths > 0;
  return `<table class="lines"><tbody>
    ${row("Precio del vehículo", usd2(f.price))}
    ${f.fees > 0 ? row("Cargos de documentación", usd2(f.fees)) : ""}
    ${f.taxRate > 0 ? row(`Impuesto (${f.taxRate}%)`, usd2(f.tax)) : ""}
    ${row("Total", usd2(f.total), "sum")}
    ${f.tradeIn > 0 ? row("Intercambio", "− " + usd2(f.tradeIn)) : ""}
    ${f.down > 0 ? row("Pago inicial", "− " + usd2(f.down)) : ""}
    ${row(financed ? "Monto a financiar" : "Saldo a pagar", usd2(f.balance), "sum")}
    ${financed ? row("Total de pagos", usd2(f.totalOfPayments)) + row("Intereses estimados", usd2(f.interest)) : ""}
  </tbody></table>`;
}
function headline(f) {
  return f.termMonths > 0
    ? `<p class="eyebrow">Pago mensual estimado</p><p class="big">${usd(f.monthly)}<small>/mes</small></p><p class="muted small">${f.termMonths} meses · ${f.apr}% APR</p>`
    : `<p class="eyebrow">Pago de contado</p><p class="big">${usd(f.balance)}</p>`;
}

export async function quoteForm({ vehicle = null, prefill = {} } = {}) {
  const st = await quoteSettings();
  await loadCatalog();
  const quotable = S.catalog.filter((v) => !v.demo && hasPrice(v));
  if (vehicle && !hasPrice(vehicle)) return notify("Administración aún no cargó el precio de esta unidad.", true);
  if (!vehicle && !quotable.length) return notify("No hay unidades con precio para cotizar.", true);
  let v = vehicle || quotable[0];
  let term = st.term;
  const body = sheet(
    "Nueva cotización",
    `<form class="form" id="quoteForm">
      ${vehicle ? `<p class="help"><strong>${esc(title(v))}</strong> · Stock ${esc(v.stock)} · ${priceText(v)}</p><input type="hidden" name="vehicleId" value="${esc(v.id)}">` : select("Vehículo", "vehicleId", quotable.map((x) => [x.id, `${x.stock} · ${title(x)} · ${priceText(x)}`]), v.id)}
      ${field("Cliente *", "customerName", prefill.customerName, "text", 'required maxlength="160" autocomplete="off"')}
      <div class="row">${field("Teléfono (WhatsApp)", "customerPhone", prefill.customerPhone, "tel", 'maxlength="60" inputmode="tel"')}${field("Email", "customerEmail", prefill.customerEmail, "email", 'maxlength="200"')}</div>
      <div class="form-section">Pago</div>
      <div class="terms" id="qTerms">${QUOTE_TERMS.map((t) => `<button type="button" data-term="${t}" class="${t === term ? "active" : ""}">${t ? t + " m" : "Contado"}</button>`).join("")}</div>
      <div class="row">${field("Pago inicial", "down", "", "number", 'min="0" step="100" inputmode="decimal" placeholder="0"')}${field("Valor de intercambio", "tradeIn", "", "number", 'min="0" step="100" inputmode="decimal" placeholder="0"')}</div>
      <label id="aprField">Tasa anual estimada (APR %)<input name="apr" type="number" min="0" max="40" step="0.01" inputmode="decimal" value="${esc(st.apr)}"></label>
      ${isAdmin() ? `<details class="more"><summary>Precio, cargos e impuesto (administración)</summary><div class="form"><div class="row3">${field("Precio", "price", v.price, "number", 'min="0" step="0.01" inputmode="decimal"')}${field("Cargos", "fees", st.docFee, "number", 'min="0" step="0.01" inputmode="decimal"')}${field("Impuesto %", "taxRate", st.taxRate, "number", 'min="0" max="20" step="0.001" inputmode="decimal"')}</div></div></details>` : ""}
      <div class="quote-preview" id="qPreview"></div>
      <label>Notas para el cliente<textarea name="notes" rows="2" maxlength="2000" placeholder="Incluye garantía, mantenimiento, accesorios…">${esc(prefill.notes || "")}</textarea></label>
      ${prefill.omniConversationId ? `<input type="hidden" name="omniConversationId" value="${esc(prefill.omniConversationId)}">` : ""}
      <p class="help">Estimación sin valor contractual; la tasa depende del crédito del cliente. Vigencia: ${st.validDays} ${st.validDays === 1 ? "día" : "días"}.${st.taxRate > 0 ? "" : " Sin impuesto configurado: la cotización indica que no lo incluye."}</p>
      <p class="error" role="alert"></p>
      <div class="form-actions"><button class="primary block" type="submit">${ICONS.quotes}Generar cotización</button></div>
    </form>`,
  );
  const form = body.querySelector("#quoteForm");
  const figures = () => {
    const d = formData(form);
    const price = isAdmin() && Number(d.price) > 0 ? Number(d.price) : Number(v.price);
    return quoteFigures({
      price,
      fees: isAdmin() && d.fees !== "" ? Number(d.fees) : st.docFee,
      taxRate: isAdmin() && d.taxRate !== "" ? Number(d.taxRate) : st.taxRate,
      down: Number(d.down) || 0,
      tradeIn: Number(d.tradeIn) || 0,
      apr: Number(d.apr) || 0,
      termMonths: term,
    });
  };
  const draw = () => {
    $("aprField").hidden = !term;
    const f = figures();
    $("qPreview").innerHTML = headline(f) + linesHtml(f);
  };
  draw();
  form.addEventListener("input", draw);
  form.elements.vehicleId.onchange = () => {
    v = S.catalog.find((x) => x.id === form.elements.vehicleId.value) || v;
    if (form.elements.price) form.elements.price.value = v.price;
    draw();
  };
  $("qTerms").onclick = (e) => {
    const b = e.target.closest("[data-term]");
    if (!b) return;
    term = Number(b.dataset.term);
    $("qTerms").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    draw();
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form, async () => {
      const data = { ...formData(form), termMonths: term };
      const q = await api("/api/admin/quotes", { method: "POST", body: data });
      notify(`Cotización ${q.code} lista.`);
      quoteSheet(q);
      if (S.page === "quotes" || S.page === "today") render();
    });
  };
}

const validDate = (q) => dayLabel(q.validUntil, { day: "numeric", month: "long" });
function quoteMessage(q) {
  const f = q.figures;
  const pay = f.termMonths > 0 ? `Pago estimado: ${usd(f.monthly)}/mes · ${f.termMonths} meses` : `Total de contado: ${usd(f.balance)}`;
  return [`Hola ${q.customerName.split(" ")[0]}, aquí está tu cotización ${q.code}:`, `*${q.vehicle.title}${q.vehicle.trim ? " " + q.vehicle.trim : ""}*`, `Precio: ${usd(f.price)}`, pay, `Válida hasta el ${validDate(q)}.`, q.link].join("\n");
}

export function quoteSheet(q) {
  const f = q.figures;
  const text = quoteMessage(q);
  const wa = waLink(q.customerPhone, text);
  const body = sheet(
    `Cotización ${q.code}`,
    `${q.photo ? `<div class="gallery"><div class="gallery-track"><img src="${esc(q.photo)}" alt=""></div></div>` : ""}
    <div class="between mt12"><div><strong>${esc(q.vehicle.title)} ${esc(q.vehicle.trim || "")}</strong><p class="muted small">Para ${esc(q.customerName)} · ${q.expired ? '<span class="pill bad">Vencida</span>' : "válida hasta el " + esc(validDate(q))}</p></div></div>
    <div class="quote-preview mt12">${headline(f)}${linesHtml(f)}</div>
    ${q.notes ? `<p class="help mt12 pre">${esc(q.notes)}</p>` : ""}
    <div class="action-grid section">
      ${wa ? `<a class="wa-btn wide" href="${esc(wa)}" target="_blank" rel="noopener">${ICONS.whatsapp}Enviar a ${esc(q.customerName.split(" ")[0])} por WhatsApp</a>` : `<a class="wa-btn wide" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${ICONS.whatsapp}Enviar por WhatsApp</a>`}
      <button class="secondary" type="button" data-q="share">${ICONS.share}Compartir</button>
      <button class="secondary" type="button" data-q="copy">${ICONS.link}Copiar enlace</button>
      <a class="secondary" href="${esc(q.link)}" target="_blank" rel="noopener">${ICONS.external}Ver / PDF</a>
      <button class="secondary" type="button" data-q="appt">${ICONS.agenda}Agendar</button>
      ${q.vehicleStatus === "available" ? `<button class="secondary wide" type="button" data-q="reserve">${ICONS.holds}Reservar para ${esc(q.customerName.split(" ")[0])}</button>` : ""}
    </div>
    <p class="help mt12">${isAdmin() ? `Hecha por ${esc(q.sellerName)} · ` : ""}${esc(shortDate(q.createdAt))}</p>`,
  );
  body.querySelector(".action-grid").onclick = async (e) => {
    const b = e.target.closest("[data-q]");
    if (!b) return;
    const customer = { customerName: q.customerName, customerPhone: q.customerPhone, customerEmail: q.customerEmail, omniConversationId: q.omniConversationId || undefined };
    if (b.dataset.q === "copy") copy(q.link);
    if (b.dataset.q === "share") {
      try {
        if (navigator.share) await navigator.share({ title: `Cotización ${q.code}`, text, url: q.link });
        else copy(q.link);
      } catch (err) {
        if (err.name !== "AbortError") copy(q.link);
      }
    }
    if (b.dataset.q === "appt") appointmentForm({ kind: "testdrive", vehicleId: q.vehicleId, ...customer });
    if (b.dataset.q === "reserve") {
      await loadCatalog(true);
      const v = S.catalog.find((x) => x.id === q.vehicleId);
      if (v) reserveForm(v, { ...customer, notes: `Cotización ${q.code}` });
      else notify("La unidad ya no está disponible.", true);
    }
  };
}

export async function quotesPage(current) {
  const seller = isAdmin() && view.seller ? `?seller=${view.seller}` : "";
  const list = await api(`/api/admin/quotes${seller}`);
  if (stale(current)) return;
  quoteCache = list;
  $("content").innerHTML = `<div class="toolbar"><input id="quoteSearch" type="search" placeholder="Buscar cliente, unidad o número" value="${esc(view.query)}" aria-label="Buscar cotizaciones">
      ${isAdmin() ? `<select id="quoteSeller" aria-label="Vendedor">${options(peopleOptions("Todo el equipo", { sellers: true }), view.seller)}</select>` : ""}</div>
    <div class="card stack" id="quoteList"></div>`;
  const draw = () => {
    const q = view.query.toLowerCase();
    const shown = list.filter((x) => `${x.code} ${x.customerName} ${x.customerPhone} ${x.vehicle.title} ${x.vehicle.stock}`.toLowerCase().includes(q));
    $("quoteList").innerHTML = shown.length
      ? shown.map(quoteRow).join("")
      : empty("Sin cotizaciones.", "Genera una desde la ficha de un vehículo, un chat o el botón +.", '<button class="primary" type="button" data-act="new-quote">Nueva cotización</button>');
  };
  draw();
  $("quoteSearch").oninput = (e) => ((view.query = e.target.value), draw());
  $("quoteSeller")?.addEventListener("change", (e) => ((view.seller = e.target.value), render()));
}
export function quoteRow(q) {
  const f = q.figures;
  return `<button type="button" class="row-item plain" data-act="open-quote" data-id="${esc(q.id)}">
    ${q.photo ? `<img class="avatar" src="${esc(q.photo)}" alt="">` : `<span class="avatar">${ICONS.quotes}</span>`}
    <span class="grow"><strong>${esc(q.customerName)} · ${esc(q.vehicle.title)}</strong>
    <span class="sub blockline">${esc(q.code)} · ${f.termMonths ? `${usd(f.monthly)}/mes · ${f.termMonths} m` : `contado ${usd(f.balance)}`}${isAdmin() ? " · " + esc(q.sellerName) : ""}</span></span>
    ${q.expired ? '<span class="pill bad">Vencida</span>' : q.vehicleStatus === "sold" ? '<span class="pill info">Vendida</span>' : '<span class="pill ok">Vigente</span>'}</button>`;
}
export const rememberQuotes = (list) => (quoteCache = list);
on("open-quote", async (b) => quoteSheet(quoteCache.find((q) => q.id === b.dataset.id) || (await api(`/api/admin/quotes/${b.dataset.id}`))));
on("new-quote", () => quoteForm());

// Administration: what every quote starts from.
export async function quoteSettingsForm() {
  const st = await quoteSettings(true);
  const form = sheet(
    "Ajustes de cotización",
    `<form class="form">
      <p class="help">Se aplican a todas las cotizaciones nuevas. Los vendedores no los cambian; tú sí, en cada cotización.</p>
      <div class="row">${field("Impuesto sobre la venta (%)", "taxRate", st.taxRate, "number", 'min="0" max="20" step="0.001" inputmode="decimal"')}${field("Cargos de documentación (USD)", "docFee", st.docFee, "number", 'min="0" step="0.01" inputmode="decimal"')}</div>
      <div class="row">${field("Tasa por defecto (APR %)", "apr", st.apr, "number", 'min="0" max="40" step="0.01" inputmode="decimal"')}${select("Plazo por defecto", "term", QUOTE_TERMS.filter(Boolean).map((t) => [String(t), `${t} meses`]), String(st.term))}</div>
      ${field("Vigencia (días)", "validDays", st.validDays, "number", 'min="1" max="30" step="1" inputmode="numeric"')}
      <label>Nota al pie de cada cotización<textarea name="note" rows="2" maxlength="1000" placeholder="Ej.: Precio no incluye placas.">${esc(st.note)}</textarea></label>
      <p class="help">El impuesto se calcula sobre el precio menos el intercambio; los cargos se suman sin impuesto. Con impuesto en 0 la cotización dice que no lo incluye.</p>
      <p class="error" role="alert"></p><div class="form-actions"><button class="primary block" type="submit">Guardar ajustes</button></div></form>`,
  ).querySelector("form");
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form, async () => {
      settings = await api("/api/admin/quote-settings", { method: "PUT", body: formData(form) });
      closeSheet();
      notify("Ajustes de cotización guardados.");
    });
  };
}
