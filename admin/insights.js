// Administración: finanzas, desempeño del equipo y la conexión con Omnicanal.
// Loaded on demand by admin.js, which hands over its helpers in `ctx`.
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const pct = (part, whole) => (Number(whole) ? `${Math.round((Number(part) / Number(whole)) * 100)}%` : "—");
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const monthName = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
};
const periodSelect = (id, days, choices) =>
  `<select id="${id}" aria-label="Periodo">${choices.map(([d, l]) => `<option value="${d}" ${Number(days) === d ? "selected" : ""}>${l}</option>`).join("")}</select>`;
const remember = (key, fallback) => {
  try {
    return Number(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
};
const store = (key, value) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
};

// Clean axis ticks for a [min, max] range: 1/2/5 × 10^n steps.
function ticks(min, max, count = 4) {
  const span = Math.max(1, max - min);
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}
const axisMoney = (v) => (Math.abs(v) >= 10000 ? "$" + compact.format(v) : "$" + v.toLocaleString("en-US"));

// Revenue and gross margin per month: one axis (both USD), grouped columns, 2px gap between
// the pair, 4px rounded data-end and square at the zero baseline. Margin can be negative.
function monthlyChart(months, { esc, usd }) {
  const W = 720,
    H = 260,
    left = 54,
    right = 10,
    top = 12,
    bottom = 28;
  const values = months.flatMap((m) => [Number(m.revenue), Number(m.margin)]);
  const t = ticks(Math.min(0, ...values), Math.max(1000, ...values));
  const lo = t[0],
    hi = t[t.length - 1];
  const y = (v) => top + ((hi - v) / (hi - lo)) * (H - top - bottom);
  const band = (W - left - right) / months.length;
  const bar = Math.min(24, (band - 14) / 2);
  const zero = y(0);
  const column = (x, v, cls) => {
    const end = y(v),
      h = Math.abs(zero - end);
    if (h < 0.5) return "";
    const r = Math.min(4, h, bar / 2);
    const up = v >= 0;
    const y0 = up ? end : zero,
      y1 = up ? zero : end;
    // Rounded only at the data end.
    const d = up
      ? `M${x},${y1}V${y0 + r}Q${x},${y0} ${x + r},${y0}H${x + bar - r}Q${x + bar},${y0} ${x + bar},${y0 + r}V${y1}Z`
      : `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + bar - r}Q${x + bar},${y1} ${x + bar},${y1 - r}V${y0}Z`;
    return `<path class="${cls}" d="${d}"/>`;
  };
  const grid = t
    .map((v) => `<line class="viz-grid" x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}"/><text class="viz-tick" x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${axisMoney(v)}</text>`)
    .join("");
  const groups = months
    .map((m, i) => {
      const x = left + i * band + (band - (bar * 2 + 2)) / 2;
      return `<g class="viz-group" data-i="${i}">${column(x, Number(m.revenue), "viz-s1")}${column(x + bar + 2, Number(m.margin), "viz-s2")}
        <text class="viz-tick" x="${left + i * band + band / 2}" y="${H - 8}" text-anchor="middle">${monthName(m.month)}</text>
        <rect class="viz-hit" x="${left + i * band}" y="${top}" width="${band}" height="${H - top - bottom}" tabindex="0" aria-label="${esc(`${monthName(m.month)}: ingresos ${usd(m.revenue)}, margen bruto ${usd(m.margin)}, ${m.count} ventas`)}"/></g>`;
    })
    .join("");
  return `<div class="viz" id="monthlyViz">
    <div class="viz-legend"><span><i class="swatch s1"></i>Ingresos</span><span><i class="swatch s2"></i>Margen bruto</span></div>
    <div class="viz-frame"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos y margen bruto de los últimos 12 meses. Los valores están en la tabla de abajo.">${grid}<line class="viz-axis" x1="${left}" x2="${W - right}" y1="${zero}" y2="${zero}"/>${groups}</svg>
    <div class="viz-tip" id="monthlyTip" role="status" hidden></div></div></div>`;
}
function bindMonthlyTip(months, { usd }) {
  const root = document.getElementById("monthlyViz");
  if (!root) return;
  const tip = document.getElementById("monthlyTip");
  const show = (g) => {
    const m = months[Number(g.dataset.i)];
    tip.innerHTML = `<strong>${monthName(m.month)}</strong><span><i class="swatch s1"></i>Ingresos <b>${usd(m.revenue)}</b></span><span><i class="swatch s2"></i>Margen bruto <b>${usd(m.margin)}</b></span><span class="muted">${m.count} ${m.count === 1 ? "venta" : "ventas"} · gastos ${usd(m.expenses)}</span>`;
    tip.hidden = false;
    const frame = root.querySelector(".viz-frame").getBoundingClientRect();
    const box = g.querySelector(".viz-hit").getBoundingClientRect();
    const x = box.left - frame.left + box.width / 2;
    tip.style.left = Math.max(8, Math.min(frame.width - tip.offsetWidth - 8, x - tip.offsetWidth / 2)) + "px";
    root.querySelectorAll(".viz-group").forEach((n) => n.classList.toggle("dim", n !== g));
  };
  const hide = () => {
    tip.hidden = true;
    root.querySelectorAll(".viz-group").forEach((n) => n.classList.remove("dim"));
  };
  root.querySelectorAll(".viz-group").forEach((g) => {
    g.addEventListener("pointerenter", () => show(g));
    g.addEventListener("focusin", () => show(g));
  });
  root.querySelector("svg").addEventListener("pointerleave", hide);
  root.addEventListener("focusout", (e) => !root.contains(e.relatedTarget) && hide());
}

export async function finance(ctx) {
  const { api, esc, usd, heading, $ } = ctx;
  const days = remember("finance.days", 30);
  const d = await api(`/api/admin/finance?days=${days}`);
  if (!ctx.current()) return;
  const p = d.period;
  const margin = Number(p.margin),
    revenue = Number(p.revenue);
  const stockRows = ["available", "reserved", "draft"].map((s) => d.stock.find((x) => x.status === s) || { status: s, count: 0, list_value: 0, cost_value: 0, unpriced: 0, aged60: 0, aged90: 0 });
  const total = (k) => stockRows.reduce((n, r) => n + Number(r[k]), 0);
  const labels = { available: "Disponible", reserved: "Reservado", draft: "Borrador" };
  $("content").innerHTML =
    heading(
      "Finanzas.",
      "Ingresos, margen bruto, inventario invertido y reservas. Solo administración ve esta página.",
      `<div class="actions">${periodSelect("financeDays", days, [[30, "Últimos 30 días"], [90, "Últimos 90 días"], [365, "Últimos 12 meses"]])}</div>`,
    ) +
    `<div class="stats">
      <article class="stat"><p>Ingresos por ventas</p><strong>${usd(revenue)}</strong><small>${p.count} ${p.count === 1 ? "unidad vendida" : "unidades vendidas"}</small></article>
      <article class="stat"><p>Margen bruto</p><strong>${usd(margin)}</strong><small>${pct(margin, revenue)} de los ingresos</small></article>
      <article class="stat"><p>Ticket promedio</p><strong>${p.count ? usd(revenue / p.count) : "—"}</strong><small>Margen promedio ${p.count ? usd(margin / p.count) : "—"}</small></article>
      <article class="stat"><p>Días en inventario</p><strong>${p.count ? p.avg_days : "—"}</strong><small>Promedio de alta a venta</small></article>
    </div>
    <section class="panel"><div class="panel-title"><h2>Últimos 12 meses</h2><small class="muted">USD · ventas registradas, sin anuladas</small></div><div class="panel-body">${monthlyChart(d.months, ctx)}</div>
      <div class="table-wrap"><table><thead><tr><th>Mes</th><th>Ventas</th><th>Ingresos</th><th>Costo al cierre</th><th>Margen bruto</th><th>Margen %</th><th>Gastos registrados</th></tr></thead><tbody>${[...d.months]
        .reverse()
        .map((m) => `<tr><td>${monthName(m.month)}</td><td class="num">${m.count}</td><td class="num">${usd(m.revenue)}</td><td class="num">${usd(m.cost)}</td><td class="num">${usd(m.margin)}</td><td class="num">${pct(m.margin, m.revenue)}</td><td class="num">${usd(m.expenses)}</td></tr>`)
        .join("")}</tbody></table></div></section>
    <section class="panel"><div class="panel-title"><h2>Inventario sin vender</h2></div><div class="table-wrap"><table><thead><tr><th>Estado</th><th>Unidades</th><th>Valor de lista</th><th>Costo invertido</th><th>Más de 60 días</th></tr></thead><tbody>${stockRows
        .map((r) => `<tr><td>${labels[r.status]}</td><td class="num">${r.count}</td><td class="num">${usd(r.list_value)}</td><td class="num">${usd(r.cost_value)}</td><td class="num">${r.aged60}${r.aged90 ? ` <small>(${r.aged90} +90)</small>` : ""}</td></tr>`)
        .join("")}<tr><td><strong>Total</strong></td><td class="num"><strong>${total("count")}</strong></td><td class="num"><strong>${usd(total("list_value"))}</strong></td><td class="num"><strong>${usd(total("cost_value"))}</strong></td><td class="num">${total("aged60")}</td></tr></tbody></table></div>
        <div class="panel-body"><p class="help">Costo invertido = compra + gastos registrados. ${total("unpriced") ? `${total("unpriced")} ${total("unpriced") === 1 ? "unidad sin precio confirmado no suma" : "unidades sin precio confirmado no suman"} al valor de lista. ` : ""}${d.demoUnits ? (d.demoUnits === 1 ? "Se excluye 1 unidad Demo." : `Se excluyen ${d.demoUnits} unidades Demo.`) : ""}</p></div></section>
      <section class="panel"><div class="panel-title"><h2>Reservas activas</h2></div><div class="panel-body"><div class="stats compact"><div class="stat"><p>Reservas</p><strong>${d.pipeline.count}</strong></div><div class="stat"><p>Valor de lista</p><strong>${usd(d.pipeline.value)}</strong></div><div class="stat"><p>Depósitos registrados</p><strong>${usd(d.pipeline.deposits)}</strong></div></div>
        <p class="help">Los depósitos son lo que el equipo anotó al reservar; la app no ejecuta cobros.</p></div></section>
    <section class="panel"><div class="panel-title"><h2>Ventas del periodo</h2></div><div class="table-wrap"><table><thead><tr><th>Vehículo</th><th>Comprador</th><th>Vendedor</th><th>Fecha</th><th>Venta</th><th>Margen bruto</th></tr></thead><tbody>${d.recent
      .map((s) => `<tr><td><strong>${esc(`${s.year} ${s.make} ${s.model}`)}</strong><small>${esc(s.stock)}</small></td><td>${esc(s.buyer_name)}</td><td>${esc(s.seller_name || "—")}</td><td>${esc(String(s.sold_at).slice(0, 10))}</td><td class="num">${usd(s.price)}</td><td class="num">${usd(s.margin)}</td></tr>`)
      .join("")}</tbody></table></div>${d.recent.length ? "" : ctx.empty("Sin ventas en este periodo.", "Las ventas registradas aparecen aquí con su margen.")}</section>
    <div class="notice">Margen bruto = precio de venta − (compra + gastos registrados al cierre). No incluye comisiones, impuestos, financiamiento ni gastos generales: no es beneficio neto ni dinero cobrado.</div>`;
  $("financeDays").onchange = (e) => (store("finance.days", e.target.value), ctx.rerender());
  bindMonthlyTip(d.months, ctx);
}

export async function performance(ctx) {
  const { api, esc, usd, heading, $ } = ctx;
  const days = remember("performance.days", 30);
  const d = await api(`/api/admin/performance?days=${days}`);
  if (!ctx.current()) return;
  const team = d.team;
  const sum = (k) => team.reduce((n, u) => n + Number(u[k]), 0);
  const closed = sum("converted") + sum("lost");
  const top = Math.max(1, ...team.map((u) => Number(u.revenue)));
  const omniOn = team.some((u) => u.omni);
  $("content").innerHTML =
    heading(
      "Desempeño del equipo.",
      "Ventas, reservas, citas y consultas atendidas por cada vendedor en el periodo.",
      `<div class="actions">${periodSelect("perfDays", days, [[7, "Últimos 7 días"], [30, "Últimos 30 días"], [90, "Últimos 90 días"], [365, "Últimos 12 meses"]])}<button class="secondary" id="exportPerf">Exportar CSV</button></div>`,
    ) +
    `<div class="stats">
      <article class="stat"><p>Ventas del equipo</p><strong>${sum("sales")}</strong><small>${usd(sum("revenue"))} en ingresos</small></article>
      <article class="stat"><p>Reservas convertidas</p><strong>${pct(sum("converted"), closed)}</strong><small>${sum("converted")} vendidas de ${closed} cerradas · ${sum("active_reservations")} activas</small></article>
      <article class="stat"><p>Citas realizadas</p><strong>${sum("completed")}</strong><small>${sum("appointments")} pasadas · ${sum("no_show")} no asistieron</small></article>
      <article class="stat"><p>Consultas web atendidas</p><strong>${sum("leads")}</strong><small>${sum("leads_closed")} cerradas</small></article>
    </div>
    ${d.omniError ? `<div class="notice">No se pudieron leer los reportes de Omnicanal: ${esc(d.omniError)}</div>` : ""}
    <section class="panel"><div class="panel-title"><h2>Ingresos por vendedor</h2><small class="muted">USD</small></div><div class="panel-body">
      ${team.length ? `<div class="rank">${team
        .map((u) => `<div class="rank-row" title="${esc(`${u.name}: ${usd(u.revenue)} · ${u.sales} ventas`)}"><span class="rank-name">${esc(u.name)}${u.active ? "" : " <small>(inactivo)</small>"}</span><span class="rank-track"><span class="rank-bar" data-w="${(Number(u.revenue) / top) * 100}"></span><span class="rank-value">${usd(u.revenue)}</span></span></div>`)
        .join("")}</div>` : ctx.empty("Aún no hay vendedores.", "Crea usuarios con rol Ventas en Equipo.")}</div></section>
    <section class="panel"><div class="panel-title"><h2>Detalle</h2></div><div class="table-wrap"><table><thead><tr><th>Vendedor</th><th>Ventas</th><th>Ingresos</th><th>Margen bruto</th><th>Ticket prom.</th><th>Reservas</th><th>Conversión</th><th>Citas</th><th>Pruebas de manejo</th><th>Consultas</th>${omniOn ? "<th>Chats</th><th>1ª respuesta</th>" : ""}</tr></thead><tbody>${team
      .map(
        (u) => `<tr><td><strong>${esc(u.name)}</strong><small>${u.role === "admin" ? "Administración" : "Ventas"}${u.omni_agent_id ? " · Omnicanal" : ""}</small></td><td class="num">${u.sales}</td><td class="num">${usd(u.revenue)}</td><td class="num">${usd(u.margin)}</td><td class="num">${u.sales ? usd(Number(u.revenue) / u.sales) : "—"}</td>
        <td class="num">${u.reservations}<small>${u.converted} vendidas · ${u.lost} perdidas · ${u.active_reservations} activas</small></td><td class="num">${pct(u.converted, u.converted + u.lost)}</td>
        <td class="num">${u.completed}/${u.appointments}<small>${u.no_show} no asistieron</small></td><td class="num">${u.testdrives}</td><td class="num">${u.leads}<small>${u.leads_closed} cerradas</small></td>
        ${omniOn ? `<td class="num">${u.omni ? `${u.omni.conversations}<small>${u.omni.resolved} resueltas</small>` : "—"}</td><td class="num">${u.omni?.avgFirstResponseMinutes ? `${Math.round(u.omni.avgFirstResponseMinutes)} min` : "—"}</td>` : ""}</tr>`,
      )
      .join("")}</tbody></table></div></section>
    <p class="help">Una venta cuenta para el vendedor que la cierra (o el dueño de la reserva). Conversión = reservas vendidas ÷ reservas cerradas (vendidas, liberadas o vencidas). Citas: las ya pasadas del periodo, sin canceladas. ${omniOn ? "Chats y tiempo de primera respuesta vienen de los reportes de Omnicanal." : "Vincula a cada vendedor con su agente en Omnicanal para ver sus chats atendidos."}</p>`;
  $("content").querySelectorAll(".rank-bar").forEach((b) => (b.style.width = Math.max(0.5, Number(b.dataset.w)) + "%"));
  $("perfDays").onchange = (e) => (store("performance.days", e.target.value), ctx.rerender());
  $("exportPerf").onclick = () =>
    ctx.csv(
      "desempeno",
      team.map((u) => ({
        vendedor: u.name,
        ventas: u.sales,
        ingresos: u.revenue,
        margen: u.margin,
        reservas: u.reservations,
        vendidas: u.converted,
        perdidas: u.lost,
        citas: u.appointments,
        completadas: u.completed,
        no_asistieron: u.no_show,
        consultas: u.leads,
        chats: u.omni?.conversations ?? "",
      })),
    );
}

export async function omnicanal(ctx) {
  const { api, esc, heading, $, notify, busy } = ctx;
  const status = await api("/api/admin/crm/status?refresh=1");
  if (!ctx.current()) return;
  if (!status.configured) {
    $("content").innerHTML =
      heading("Omnicanal.", "WhatsApp, Instagram, Facebook y agentes de IA conectados al inventario y al equipo de ventas.") +
      `${status.error ? `<div class="notice">Configuración inválida: ${esc(status.error)}</div>` : ""}
      <section class="panel"><div class="panel-title"><h2>Conectar la instancia</h2></div><div class="panel-body"><ol class="steps">
        <li>Crea la instancia del concesionario en la plataforma Omnicanal (<code>pnpm clients:new premier "Premier Line Motors"</code>), con su servicio, base de datos, dominio y <code>SESSION_SECRET</code> propios.</li>
        <li>Conecta WhatsApp, Instagram y Facebook desde <strong>Configuración</strong> en el panel de Omnicanal y crea a cada vendedor como agente humano.</li>
        <li>En el servicio de este sitio, agrega como variables privadas <code>OMNICANAL_URL</code> (la dirección https de la instancia) y <code>OMNICANAL_SESSION_SECRET</code> (el mismo valor que su <code>SESSION_SECRET</code>) y vuelve a desplegar.</li>
        <li>Regresa aquí para vincular a cada vendedor con su agente y sincronizar el inventario con la IA.</li></ol>
        <p class="help">La clave permite a este sitio actuar en Omnicanal en nombre de cada vendedor vinculado. Trátala como la contraseña de administración: nunca en Git ni en el navegador.</p></div></section>`;
    return;
  }
  const [settings, people] = await Promise.all([
    api("/api/admin/crm/settings"),
    status.connected ? api("/api/admin/crm/agents").catch((e) => ({ error: e.message })) : null,
  ]);
  if (!ctx.current()) return;
  const inst = status.instance || {};
  const agents = people?.agents || [];
  $("content").innerHTML =
    heading(
      "Omnicanal.",
      "Los vendedores atienden WhatsApp, Instagram y Facebook como agentes desde la app de ventas. Los canales, bots y automatizaciones se administran en el panel de Omnicanal.",
      settings.panelUrl ? `<a class="primary" href="${esc(settings.panelUrl)}" target="_blank" rel="noopener">Abrir panel de Omnicanal ↗</a>` : "",
    ) +
    `<div class="stats">
      <article class="stat"><p>Conexión</p><strong class="${status.connected ? "ok-text" : "bad-text"}">${status.connected ? "Conectado" : "Sin conexión"}</strong><small>${esc(status.connected ? inst.product || inst.name || settings.panelUrl : status.error)}</small></article>
      <article class="stat"><p>Canales activos</p><strong>${(inst.channels || []).length || "—"}</strong><small>${esc((inst.channels || []).join(" · ") || "Se activan en Omnicanal")}</small></article>
      <article class="stat"><p>Vendedores vinculados</p><strong>${(people?.team || []).filter((u) => u.omni_agent_id).length}</strong><small>de ${(people?.team || []).filter((u) => u.active).length} usuarios activos</small></article>
      <article class="stat"><p>Inventario para la IA</p><strong>${settings.lastSyncError ? "Error" : settings.lastSyncAt ? settings.lastSyncCount : "—"}</strong><small>${settings.lastSyncAt ? "Sincronizado " + ctx.date(settings.lastSyncAt) : "Sin sincronizar"}</small></article>
    </div>
    <section class="panel"><div class="panel-title"><h2>Equipo como agentes</h2><button class="secondary" id="omniRefresh">Probar conexión</button></div>
      ${people?.error ? `<div class="panel-body"><div class="notice">${esc(people.error)}</div></div>` : ""}
      ${status.connected && !people?.error ? `<div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Agente de Omnicanal</th></tr></thead><tbody>${people.team
        .map(
          (u) => `<tr><td><strong>${esc(u.name)}</strong><small>${esc(u.username)}${u.active ? "" : " · desactivado"}</small></td><td>${u.role === "admin" ? "Administración" : "Ventas"}</td>
          <td><select data-map="${esc(u.id)}" aria-label="Agente de ${esc(u.name)}"><option value="">Sin vincular</option>${agents
            .map((a) => `<option value="${esc(a.id)}" ${u.omni_agent_id === a.id ? "selected" : ""} ${a.isActive ? "" : "disabled"}>${esc(a.name)}${a.email ? " · " + esc(a.email) : ""}${a.role === "admin" ? " (admin)" : ""}${a.isActive ? "" : " (inactivo)"}</option>`)
            .join("")}</select></td></tr>`,
        )
        .join("")}</tbody></table></div>` : ""}
      <div class="panel-body"><p class="help">Un vendedor vinculado ve sus chats en la app de ventas, puede tomar los que nadie atiende, responder, compartir vehículos, reservar y agendar. Omnicanal registra cada respuesta a su nombre, igual que si usara su panel o su app móvil. Los agentes se crean en Omnicanal → Agentes.</p></div></section>
    <div class="two-columns">
      <section class="panel"><div class="panel-title"><h2>Inventario para los agentes de IA</h2></div><div class="panel-body">
        <p class="help">El sitio mantiene en Omnicanal una base de conocimiento con los vehículos disponibles y reservados (sin unidades Demo), su precio y el enlace a sus fotos. Se actualiza sola cada vez que cambia el inventario.</p>
        ${settings.knowledgeBaseId ? `<p class="help">Base de conocimiento nº <strong>${settings.knowledgeBaseId}</strong>. Para que la IA la use, asígnala a la capacidad de ventas del agente virtual en Omnicanal → Agentes.</p>` : ""}
        ${settings.lastSyncError ? `<div class="notice">Último intento: ${esc(settings.lastSyncError)}</div>` : ""}
        <button class="primary" id="omniSync" ${status.connected ? "" : "disabled"}>Sincronizar ahora</button></div></section>
      <section class="panel"><div class="panel-title"><h2>Automatización</h2></div><form class="panel-body" id="omniSettings">
        <label>Dirección pública del sitio<input name="publicUrl" type="url" placeholder="${esc(settings.defaultPublicUrl)}" value="${esc(settings.publicUrl)}" maxlength="300"></label>
        <p class="help">Para los enlaces que reciben los clientes. Vacía usa ${esc(settings.defaultPublicUrl)}.</p>
        <label class="check"><input type="checkbox" name="autoSync" ${settings.autoSync ? "checked" : ""}>Actualizar el inventario de la IA en cada cambio</label>
        <label class="check"><input type="checkbox" name="pushLeads" ${settings.pushLeads ? "checked" : ""}>Crear un contacto en Omnicanal por cada consulta de la página</label>
        <p class="error" role="alert"></p><button class="secondary" type="submit">Guardar</button></form></section>
    </div>
    <div class="notice">Las citas que agenda el equipo se registran también en Omnicanal (con su agente). Las que agenda la IA por WhatsApp aparecen en la agenda de la app de ventas para confirmarlas. Una venta que viene de una reserva hecha desde un chat se marca como venta cerrada en esa conversación.</div>`;
  $("omniRefresh").onclick = () => ctx.rerender();
  $("omniSync")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const r = await api("/api/admin/crm/sync", { method: "POST" });
      notify(`Inventario sincronizado: ${r.lastSyncCount} vehículos en la base nº ${r.knowledgeBaseId}.`);
      ctx.rerender();
    } catch (err) {
      notify(err.message, true);
      e.target.disabled = false;
    }
  });
  $("content").querySelectorAll("[data-map]").forEach(
    (s) =>
      (s.onchange = async () => {
        try {
          await api(`/api/admin/crm/mapping/${s.dataset.map}`, { method: "PUT", body: { agentId: s.value ? Number(s.value) : null } });
          notify("Vínculo guardado.");
        } catch (err) {
          notify(err.message, true);
          ctx.rerender();
        }
      }),
  );
  $("omniSettings").onsubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    busy(form, async () => {
      await api("/api/admin/crm/settings", {
        method: "PUT",
        body: { publicUrl: form.elements.publicUrl.value.trim(), autoSync: form.elements.autoSync.checked, pushLeads: form.elements.pushLeads.checked },
      });
      notify("Automatización guardada.");
    });
  };
}
