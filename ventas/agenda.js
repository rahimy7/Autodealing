// The agenda: test drives, visits, deliveries, calls, follow-ups and service appointments, in New
// York time. It is the same table Omnicanal uses (README: Agenda), so what the virtual agent books
// shows here as "Por confirmar".
import {
  S, $, api, esc, notify, sheet, closeSheet, busy, formData, field, select, options, peopleOptions, contactLinks,
  isAdmin, isService, todayISO, nowTime, addDays, dayLabel, on, render, stale, vehicleChoices,
  KIND, APPT_STATUS, APPT_TONE,
} from "./core.js";

const view = { start: todayISO(), seller: "" };
let apptCache = [],
  omniCache = [];

// Service books service work, deliveries and calls; sales the rest. Administration, everything.
const kindsFor = () => {
  const all = Object.entries(KIND);
  if (isAdmin()) return all;
  return isService() ? all.filter(([k]) => ["service", "delivery", "call", "followup", "visit"].includes(k)) : all.filter(([k]) => k !== "service");
};
const DURATIONS = [["30", "30 min"], ["45", "45 min"], ["60", "1 hora"], ["90", "1 h 30"], ["120", "2 horas"], ["180", "3 horas"], ["240", "4 horas"]];

export function apptRow(a, { manage = true } = {}) {
  const vehicle = a.make ? `${a.year} ${a.make} ${a.model}` : "";
  const sync = a.omni_contact_id
    ? '<span class="pill info" title="El cliente está en el CRM de Omnicanal, que le envía el recordatorio">Omnicanal</span>'
    : a.sync_error
      ? `<span class="pill bad" title="${esc(a.sync_error)}">Sin sincronizar</span>`
      : "";
  return `<div class="row-item"><div class="time">${esc(a.local_time)}<small>${a.duration_minutes} min</small></div>
    <div class="grow"><strong>${esc(a.customer_name)}</strong><div class="sub">${esc(KIND[a.kind] || a.kind)}${vehicle ? " · " + esc(vehicle) : ""}${isAdmin() && a.seller_name ? " · " + esc(a.seller_name) : ""}</div>
    <div class="contact-links"><span class="pill ${APPT_TONE[a.status]}">${APPT_STATUS[a.status]}</span>${sync}</div>${contactLinks(a.customer_phone, a.customer_email)}</div>
    ${manage ? `<button class="secondary sm" data-act="edit-appt" data-id="${esc(a.id)}" type="button">Abrir</button>` : ""}</div>`;
}

export async function appointmentForm(prefill = {}) {
  const vehicles = await vehicleChoices(() => true);
  const nextHour = String(Math.min(19, Number(nowTime().slice(0, 2)) + 1)).padStart(2, "0") + ":00";
  const kinds = kindsFor();
  const kind = kinds.some(([k]) => k === prefill.kind) ? prefill.kind : kinds[0][0];
  const form = sheet(
    prefill.omniConversationId ? "Agendar para este cliente" : "Nueva cita",
    `<form class="form">
      <div class="row">${select("Tipo", "kind", kinds, kind)}${select("Duración", "durationMinutes", DURATIONS, kind === "service" ? "120" : "60")}</div>
      <div class="row">${field("Fecha *", "date", prefill.date || todayISO(), "date", "required")}${field("Hora *", "time", prefill.time || nextHour, "time", 'required step="300"')}</div>
      ${select("Vehículo", "vehicleId", [["", "Sin vehículo del inventario"], ...vehicles], prefill.vehicleId || "")}
      ${field("Cliente *", "customerName", prefill.customerName, "text", 'required maxlength="160" autocomplete="off"')}
      <div class="row">${field("Teléfono", "customerPhone", prefill.customerPhone, "tel", 'maxlength="60" inputmode="tel"')}${field("Email", "customerEmail", prefill.customerEmail, "email", 'maxlength="200"')}</div>
      ${isAdmin() ? select("Asignada a", "sellerId", peopleOptions(), prefill.sellerId || S.user.id) : ""}
      <label>Notas${isService() ? " (trabajo a realizar, vehículo del cliente)" : ""}<textarea name="notes" rows="2" maxlength="2000">${esc(prefill.notes || "")}</textarea></label>
      ${prefill.leadId ? `<input type="hidden" name="leadId" value="${esc(prefill.leadId)}">` : ""}
      ${prefill.omniConversationId ? `<input type="hidden" name="omniConversationId" value="${esc(prefill.omniConversationId)}">` : ""}
      <p class="help">Hora del concesionario (Nueva York).${S.crm?.connected ? " También queda en Omnicanal: si el cliente ya escribió por WhatsApp, Instagram o Facebook, recibe allí el recordatorio." : ""}</p>
      <p class="error" role="alert"></p><div class="form-actions"><button class="primary block" type="submit">Agendar</button></div></form>`,
  ).querySelector("form");
  form.elements.kind.onchange = () => (form.elements.durationMinutes.value = form.elements.kind.value === "service" ? "120" : "60");
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
      if (a.local_date < view.start || a.local_date > addDays(view.start, 6)) view.start = a.local_date;
      render();
    });
  };
}

function editAppointment(a) {
  const form = sheet(
    `${KIND[a.kind] || a.kind} · ${a.customer_name}`,
    `<form class="form">
      ${a.make ? `<p class="help">${esc(`${a.year} ${a.make} ${a.model} · stock ${a.stock}`)}</p>` : ""}
      ${contactLinks(a.customer_phone, a.customer_email)}
      ${select("Estado", "status", Object.entries(APPT_STATUS), a.status)}
      <div class="row3">${field("Fecha", "date", a.local_date, "date", "required")}${field("Hora", "time", a.local_time, "time", 'required step="300"')}${select("Duración", "durationMinutes", DURATIONS, String(a.duration_minutes))}</div>
      ${isAdmin() ? select("Asignada a", "sellerId", peopleOptions("Sin asignar"), a.seller_id || "") : !a.seller_id ? '<p class="notice">Cita sin asignar: al guardar queda a tu nombre.</p>' : ""}
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
on("edit-appt", async (b) => {
  const id = b.dataset.id;
  const a =
    apptCache.find((x) => x.id === id) ||
    (await api(`/api/admin/appointments?from=${addDays(todayISO(), -30)}&to=${addDays(todayISO(), 365)}`)).find((x) => x.id === id);
  if (a) editAppointment(a);
});
on("new-appt", () => appointmentForm());
on("week", (b) => {
  view.start = Number(b.dataset.step) ? addDays(view.start, Number(b.dataset.step)) : todayISO();
  render();
});
export const rememberAppointments = (list) => (apptCache = list);

export async function agendaPage(current) {
  const from = view.start,
    to = addDays(from, 6);
  const seller = isAdmin() && view.seller ? `&seller=${view.seller}` : "";
  const [list, omni] = await Promise.all([
    api(`/api/admin/appointments?from=${from}&to=${to}${seller}`),
    S.crm?.connected ? api("/api/admin/crm/appointments").catch((e) => ({ error: e.message })) : null,
  ]);
  if (stale(current)) return;
  apptCache = list;
  omniCache = Array.isArray(omni) ? omni : [];
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const pending = omniCache.length
    ? `<section class="section"><div class="section-head"><h2>Por confirmar desde WhatsApp e IA</h2><span class="pill warn">${omniCache.length}</span></div><div class="card stack">${omniCache
        .map(
          (o) => `<div class="row-item"><div class="time">${esc(o.local.time)}<small>${esc(dayLabel(o.local.date, { day: "numeric", month: "short" }))}</small></div><div class="grow"><strong>${esc(o.contactName || "Cliente")}</strong><div class="sub">${esc(o.service)}${o.agentName ? " · " + esc(o.agentName) : ""} · ${o.source === "ai" ? "agendada por la IA" : "Omnicanal"}</div>${contactLinks(o.contactPhone)}</div><button class="primary sm" data-act="confirm-omni" data-id="${o.id}" type="button">Confirmar</button></div>`,
        )
        .join("")}</div></section>`
    : omni?.error
      ? `<p class="notice bad section">Omnicanal: ${esc(omni.error)}</p>`
      : "";
  $("content").innerHTML = `<div class="toolbar"><div class="segmented"><button type="button" data-act="week" data-step="-7" aria-label="Semana anterior">←</button><button type="button" data-act="week" data-step="0">Hoy</button><button type="button" data-act="week" data-step="7" aria-label="Semana siguiente">→</button></div>
    <strong class="small">${esc(dayLabel(from, { day: "numeric", month: "short" }))} – ${esc(dayLabel(to, { day: "numeric", month: "short" }))}</strong>
    ${isAdmin() ? `<select id="agendaSeller" aria-label="Persona">${options(peopleOptions("Todo el equipo"), view.seller)}</select>` : ""}</div>
    ${pending}
    ${days
      .map((d) => {
        const items = list.filter((a) => a.local_date === d);
        return `<section class="section"><div class="section-head"><h2 class="cap">${esc(dayLabel(d))}${d === todayISO() ? ' <span class="pill info">Hoy</span>' : ""}</h2><span class="muted small">${items.length || ""}</span></div>
          <div class="card stack">${items.length ? items.map((a) => apptRow(a)).join("") : '<p class="pad muted small">Sin citas.</p>'}</div></section>`;
      })
      .join("")}`;
  $("agendaSeller")?.addEventListener("change", (e) => ((view.seller = e.target.value), render()));
}

async function confirmOmni(o) {
  const vehicles = await vehicleChoices(() => true);
  const kinds = Object.entries(KIND).filter(([k]) => isAdmin() || (isService() ? k === "service" || k === "visit" : k !== "service"));
  const guess = /servicio|taller|mantenimiento|aceite|reparaci/i.test(o.service) ? "service" : /prueba|manejo|test/i.test(o.service) ? "testdrive" : "visit";
  const form = sheet(
    "Confirmar cita de Omnicanal",
    `<form class="form"><p class="help">${esc(o.contactName || "Cliente")} · ${esc(dayLabel(o.local.date))} ${esc(o.local.time)}<br>${esc(o.service)}${o.notes ? " · " + esc(o.notes) : ""}</p>
      ${select("Tipo", "kind", kinds, kinds.some(([k]) => k === guess) ? guess : kinds[0][0])}
      ${select("Vehículo", "vehicleId", [["", "Sin vehículo"], ...vehicles], "")}
      ${isAdmin() ? select("Asignada a", "sellerId", peopleOptions(), S.user.id) : ""}
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
on("confirm-omni", (b) => confirmOmni(omniCache.find((o) => String(o.id) === b.dataset.id)));

// From a web inquiry: its kind, the day and time the visitor asked for, and their details.
export function leadAppointment(l) {
  appointmentForm({
    kind: l.kind === "testdrive" ? "testdrive" : l.kind === "trade" || l.kind === "visit" ? "visit" : "call",
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
