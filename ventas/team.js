// Administration: the team (accounts, profiles, passwords, their Omnicanal agent) and the
// business at a glance (sales, margin, stock, the team's results).
import {
  S, $, api, esc, usd, initials, notify, sheet, closeSheet, busy, formData, field, select, on, render, stale,
  ROLE_LABEL, ROLE_TONE, ICONS, shortDate,
} from "./core.js";

const ROLE_HELP = {
  sales: "Catálogo, cotizaciones, reservas, ventas, agenda, consultas web y sus chats. Carga unidades y fotos.",
  service: "Catálogo para consultar y compartir, agenda de servicio, sus chats y carga de unidades y fotos. No reserva, cotiza ni vende.",
  admin: "Todo: precios y publicación, equipo, finanzas, Omnicanal y la página.",
};
let users = [];

function strongPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("").replace(/(.{4})(?!$)/g, "$1-");
}

export async function teamPage(current) {
  users = await api("/api/admin/users");
  if (stale(current)) return;
  const groups = ["admin", "sales", "service"];
  $("content").innerHTML = `<div class="toolbar"><p class="help">${users.filter((u) => u.active).length} personas activas. Cada una entra con su usuario a esta app y al panel.</p><button class="primary sm push" type="button" data-act="new-user">${ICONS.plus}Nuevo usuario</button></div>
    ${groups
      .map((g) => {
        const list = users.filter((u) => u.role === g);
        return `<section class="section"><div class="section-head"><h2>${ROLE_LABEL[g]}</h2><span class="muted small">${list.length}</span></div>
        <div class="card stack">${list.length ? list.map(userRow).join("") : `<p class="pad muted small">${esc(ROLE_HELP[g])}</p>`}</div></section>`;
      })
      .join("")}`;
}
function userRow(u) {
  const me = u.id === S.user.id;
  return `<button type="button" class="row-item plain" data-act="user" data-id="${esc(u.id)}"><span class="avatar">${esc(initials(u.name))}</span>
    <span class="grow"><strong>${esc(u.name)}${me ? " (tú)" : ""}</strong><span class="sub blockline">${esc(u.username)}${u.omni_agent_id ? " · agente de Omnicanal" : ""}</span></span>
    ${u.active ? `<span class="pill ${ROLE_TONE[u.role]}">${ROLE_LABEL[u.role]}</span>` : '<span class="pill bad">Desactivado</span>'}</button>`;
}

function newUserForm() {
  const form = sheet(
    "Nuevo usuario",
    `<form class="form">
      ${field("Nombre *", "name", "", "text", 'required maxlength="100" autocomplete="off"')}
      ${field("Usuario *", "username", "", "text", 'required minlength="3" maxlength="80" pattern="[A-Za-z0-9_.@\\-]+" autocapitalize="none" autocomplete="off" placeholder="nombre o email"')}
      ${select("Perfil *", "role", [["sales", "Ventas"], ["service", "Servicio"], ["admin", "Administración"]], "sales")}
      <p class="help" data-role-help>${esc(ROLE_HELP.sales)}</p>
      <label>Contraseña inicial *<span class="input-action"><input name="password" type="text" required minlength="12" maxlength="128" autocomplete="off" spellcheck="false" value="${strongPassword()}"><button class="secondary" type="button" data-gen>Otra</button></span></label>
      <p class="help">Compártela en persona o por un canal privado. Podrá cambiarla en Mi cuenta.</p>
      <p class="error" role="alert"></p><div class="form-actions"><button class="primary block" type="submit">Crear usuario</button></div></form>`,
  ).querySelector("form");
  form.elements.role.onchange = () => (form.querySelector("[data-role-help]").textContent = ROLE_HELP[form.elements.role.value]);
  form.querySelector("[data-gen]").onclick = () => (form.elements.password.value = strongPassword());
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(form, async () => {
      const data = formData(form);
      await api("/api/admin/users", { method: "POST", body: data });
      S.team = await api("/api/admin/team").catch(() => S.team);
      closeSheet();
      notify(`Usuario «${data.username.toLowerCase()}» creado.`);
      render();
    });
  };
}
on("new-user", newUserForm);

async function userSheet(u) {
  const me = u.id === S.user.id;
  const omni = S.crm?.connected ? await api("/api/admin/crm/agents").catch(() => null) : null;
  const agents = omni?.agents || [];
  const takenBy = new Map((omni?.team || []).filter((t) => t.omni_agent_id && t.id !== u.id).map((t) => [t.omni_agent_id, t.name]));
  const body = sheet(
    u.name,
    `<p class="muted small">${esc(u.username)} · desde ${esc(shortDate(u.created_at))}</p>
    <form class="form mt12" data-profile>
      ${field("Nombre", "name", u.name, "text", 'required maxlength="100"')}
      ${select("Perfil", "role", [["sales", "Ventas"], ["service", "Servicio"], ["admin", "Administración"]], u.role, me ? "disabled" : "")}
      <p class="help" data-role-help>${esc(ROLE_HELP[u.role])}</p>
      ${me ? `<input type="hidden" name="role" value="${esc(u.role)}"><p class="help">No puedes cambiar tu propio perfil.</p>` : ""}
      <p class="error" role="alert"></p><div class="form-actions"><button class="primary block" type="submit">Guardar</button></div>
    </form>
    ${
      agents.length
        ? `<form class="form section" data-agent><div class="form-section">Chats de Omnicanal</div>
      ${select("Agente vinculado", "agentId", [["", "Sin vincular (no ve chats)"], ...agents.map((a) => [String(a.id), `${a.name}${takenBy.has(a.id) ? " · de " + takenBy.get(a.id) : ""}${a.isActive ? "" : " (inactivo)"}`])], u.omni_agent_id ? String(u.omni_agent_id) : "")}
      <p class="help">Con un agente vinculado ve y responde sus chats de WhatsApp, Instagram y Facebook.</p>
      <p class="error" role="alert"></p><div class="form-actions"><button class="secondary block" type="submit">Guardar vínculo</button></div></form>`
        : ""
    }
    ${
      me
        ? ""
        : `<form class="form section" data-password><div class="form-section">Contraseña</div>
      <label>Nueva contraseña<span class="input-action"><input name="password" type="text" required minlength="12" maxlength="128" autocomplete="off" spellcheck="false" value="${strongPassword()}"><button class="secondary" type="button" data-gen>Otra</button></span></label>
      <p class="help">Cierra sus sesiones abiertas. Compártela por un canal privado.</p>
      <p class="error" role="alert"></p><div class="form-actions"><button class="secondary block" type="submit">Restablecer contraseña</button></div></form>
      <div class="section"><button class="${u.active ? "danger" : "primary"} block" type="button" data-toggle>${u.active ? "Desactivar acceso" : "Reactivar acceso"}</button></div>`
    }`,
  );
  const profile = body.querySelector("[data-profile]");
  profile.elements.role.onchange = () => (body.querySelector("[data-role-help]").textContent = ROLE_HELP[profile.elements.role.value]);
  profile.onsubmit = (e) => {
    e.preventDefault();
    busy(profile, async () => {
      await api(`/api/admin/users/${u.id}`, { method: "PUT", body: formData(profile) });
      S.team = await api("/api/admin/team").catch(() => S.team);
      closeSheet();
      notify("Usuario actualizado.");
      render();
    });
  };
  const agent = body.querySelector("[data-agent]");
  if (agent)
    agent.onsubmit = (e) => {
      e.preventDefault();
      busy(agent, async () => {
        const value = agent.elements.agentId.value;
        await api(`/api/admin/crm/mapping/${u.id}`, { method: "PUT", body: { agentId: value ? Number(value) : null } });
        closeSheet();
        notify(value ? "Agente vinculado." : "Vínculo quitado.");
        render();
      });
    };
  const pass = body.querySelector("[data-password]");
  if (pass) {
    pass.querySelector("[data-gen]").onclick = () => (pass.elements.password.value = strongPassword());
    pass.onsubmit = (e) => {
      e.preventDefault();
      busy(pass, async () => {
        await api(`/api/admin/users/${u.id}/password`, { method: "POST", body: formData(pass) });
        notify("Contraseña restablecida. Sus sesiones se cerraron.");
      });
    };
  }
  body.querySelector("[data-toggle]")?.addEventListener("click", async (e) => {
    if (u.active && !confirm(`¿Desactivar a ${u.name}? Se cierran sus sesiones.`)) return;
    e.currentTarget.disabled = true;
    try {
      await api(`/api/admin/users/${u.id}/active`, { method: "PUT", body: { active: !u.active } });
      S.team = await api("/api/admin/team").catch(() => S.team);
      closeSheet();
      notify(u.active ? "Acceso desactivado." : "Acceso reactivado.");
      render();
    } catch (err) {
      e.currentTarget.disabled = false;
      notify(err.message, true);
    }
  });
}
on("user", (b) => userSheet(users.find((u) => u.id === b.dataset.id)));

// ── Negocio ──────────────────────────────────────────────────────────────────────────────────
const biz = { days: "30" };
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export async function businessPage(current) {
  const [fin, perf] = await Promise.all([api(`/api/admin/finance?days=${biz.days}`), api(`/api/admin/performance?days=${biz.days}`)]);
  if (stale(current)) return;
  const p = fin.period;
  const stock = Object.fromEntries(fin.stock.map((s) => [s.status, s]));
  const forSale = ["available", "reserved"].reduce((n, k) => n + (stock[k]?.count || 0), 0);
  const listValue = ["available", "reserved"].reduce((n, k) => n + Number(stock[k]?.list_value || 0), 0);
  const top = Math.max(1, ...fin.months.map((m) => Number(m.revenue)));
  const ranked = perf.team.filter((u) => Number(u.sales) || Number(u.reservations) || Number(u.appointments));
  $("content").innerHTML = `<div class="toolbar"><div class="segmented" id="bizDays">${[["7", "7 días"], ["30", "30 días"], ["90", "90 días"], ["365", "1 año"]].map(([k, l]) => `<button type="button" data-days="${k}" class="${biz.days === k ? "active" : ""}">${l}</button>`).join("")}</div></div>
    <div class="stats">
      <article class="stat hot"><p>Ventas</p><strong>${p.count}</strong><small>en ${fin.days} días</small></article>
      <article class="stat"><p>Ingresos</p><strong>${usd(p.revenue)}</strong><small>precio de venta</small></article>
      <article class="stat"><p>Margen bruto</p><strong>${usd(p.margin)}</strong><small>venta − costo y gastos</small></article>
      <article class="stat"><p>Días en inventario</p><strong>${p.avg_days || "—"}</strong><small>promedio al vender</small></article>
    </div>
    <section class="section"><div class="section-head"><h2>Ingresos de los últimos 12 meses</h2></div>
      <div class="card"><div class="bars" id="bars">${fin.months.map((m) => `<div class="b ${Number(m.revenue) ? "" : "zero"}" title="${esc(usd(m.revenue))} · ${m.count} ventas"><i data-h="${Math.round((Number(m.revenue) / top) * 100)}"></i><span>${MONTHS[Number(m.month.slice(5)) - 1]}</span></div>`).join("")}</div><p class="pad muted small">La tabla por mes y la exportación están en el panel de administración.</p></div></section>
    <div class="stats section">
      <button class="stat" type="button" data-act="goto" data-page="catalog"><p>A la venta</p><strong>${forSale}</strong><small>${usd(listValue)} a precio de lista</small></button>
      <button class="stat" type="button" data-act="goto" data-page="units"><p>Por completar</p><strong>${stock.draft?.count || 0}</strong><small>borradores sin publicar</small></button>
      <article class="stat"><p>Reservas activas</p><strong>${fin.pipeline.count}</strong><small>${usd(fin.pipeline.deposits)} en depósitos anotados</small></article>
      <article class="stat"><p>Más de 60 días</p><strong>${["available", "reserved"].reduce((n, k) => n + (stock[k]?.aged60 || 0), 0)}</strong><small>unidades sin vender</small></article>
    </div>
    <section class="section"><div class="section-head"><h2>Equipo</h2><span class="muted small">${fin.days} días</span></div>
      <div class="card stack">${ranked.length ? ranked.map((u, i) => `<div class="rank"><span class="n">${i + 1}</span><div class="grow"><strong>${esc(u.name)}</strong><div class="sub">${u.sales} ventas · ${u.reservations} reservas · ${u.appointments} citas${u.omni?.conversations ? ` · ${u.omni.conversations} chats` : ""}</div></div><strong>${usd(u.revenue)}</strong></div>`).join("") : '<p class="pad muted small">Sin actividad en este periodo.</p>'}</div></section>
    ${fin.recent.length ? `<section class="section"><div class="section-head"><h2>Ventas recientes</h2></div><div class="card stack">${fin.recent.slice(0, 8).map((s) => `<div class="row-item"><div class="grow"><strong>${esc(`${s.year} ${s.make} ${s.model}`)}</strong><div class="sub">${esc(s.buyer_name)} · ${esc(s.seller_name || "—")} · ${esc(String(s.sold_at).slice(0, 10))}</div></div><div class="center"><strong>${usd(s.price)}</strong><div class="sub">margen ${usd(s.margin)}</div></div></div>`).join("")}</div></section>` : ""}
    <div class="actions stretch section"><button class="secondary" type="button" data-act="quote-settings">${ICONS.settings}Ajustes de cotización</button><a class="secondary" href="/admin/">${ICONS.external}Finanzas en el panel</a></div>`;
  $("bars").querySelectorAll("i[data-h]").forEach((i) => (i.style.height = `${Math.max(2, Number(i.dataset.h))}%`));
  $("bizDays").onclick = (e) => {
    const b = e.target.closest("[data-days]");
    if (b) (biz.days = b.dataset.days), render();
  };
}
