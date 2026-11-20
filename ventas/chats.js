// Chats: the Omnicanal inbox (WhatsApp, Instagram, Facebook) as the person's own agent. "Mis
// chats" are the ones assigned to them; "Por atender" the open ones they can take.
import {
  S, $, api, esc, ago, initials, telLink, notify, sheet, closeSheet, busy, empty, isAdmin, canSell, on, go, stale,
  hooks, title, priceText, loadCatalog, TZ,
} from "./core.js";
import { reserveForm } from "./catalog.js";
import { appointmentForm } from "./agenda.js";
import { quoteForm } from "./quotes.js";

const CHANNEL = { whatsapp: ["WhatsApp", "wa"], instagram: ["Instagram", "ig"], facebook: ["Facebook", "fb"] };
const CONVO_STATUS = { open: "Abierta", pending: "En espera", bot: "IA atendiendo", resolved: "Resuelta" };
export const chat = { scope: "mine", search: "", open: null, list: [], thread: null, unread: 0, poll: null };

export async function refreshUnread() {
  if (!S.user || !S.crm?.connected || !S.crm.me?.agentId || document.visibilityState !== "visible") return;
  try {
    const { conversations } = await api("/api/admin/crm/conversations?scope=mine");
    setUnread(conversations.reduce((n, c) => n + c.unreadCount, 0));
  } catch {}
}
function setUnread(n) {
  if (n === chat.unread) return;
  chat.unread = n;
  hooks.drawNav?.();
}

function convoItem(c) {
  const [label, tone] = CHANNEL[c.channel] || [c.channel, ""];
  const owner = c.agentId && c.agentId === S.crm.me?.agentId ? "Tuyo" : c.agentName ? c.agentName : "Sin asignar";
  return `<button type="button" class="convo ${chat.open === c.id ? "active" : ""}" data-convo="${c.id}"><span class="avatar">${esc(initials(c.contactName || c.contactPhone))}</span>
    <span class="grow"><span class="top"><strong>${esc(c.contactName || c.contactPhone || "Cliente")}</strong><time>${ago(c.updatedAt)}</time></span>
    <span class="last blockline">${esc(c.lastMessage || "—")}</span>
    <span class="contact-links flat"><span class="pill ${tone}">${esc(label)}</span>${c.status === "bot" ? '<span class="pill violet">IA</span>' : ""}<span class="pill">${esc(owner)}</span>${c.unreadCount ? `<span class="unread">${c.unreadCount}</span>` : ""}</span></span></button>`;
}

export async function chatsPage(current, extra) {
  chat.open = /^\d+$/.test(extra || "") ? Number(extra) : null;
  if (chat.open === null) chat.thread = null;
  S.crm = await api(`/api/admin/crm/status${S.crm?.connected ? "" : "?refresh=1"}`).catch((e) => ({ configured: true, connected: false, error: e.message }));
  if (stale(current)) return;
  if (!S.crm.configured)
    return ($("content").innerHTML = empty("Omnicanal aún no está conectado.", "Cuando administración conecte Omnicanal, aquí atenderás WhatsApp, Instagram y Facebook como agente."));
  if (!S.crm.connected)
    return ($("content").innerHTML = empty("No se pudo conectar con Omnicanal.", esc(S.crm.error || "Inténtalo de nuevo en unos minutos."), '<button class="secondary" data-act="goto" data-page="chats" type="button">Reintentar</button>'));
  const linked = Boolean(S.crm.me?.agentId);
  if (!linked && !isAdmin())
    return ($("content").innerHTML = empty("Tu usuario no está vinculado a Omnicanal.", esc(S.crm.me?.error || "Pide a administración que te vincule a tu agente (Más → Equipo).")));
  if (!linked && chat.scope === "mine") chat.scope = "general";
  await loadChatList(current);
  if (stale(current)) return;
  if (chat.open) await loadThread(current);
  if (stale(current)) return;
  drawChats();
  clearInterval(chat.poll);
  chat.poll = setInterval(async () => {
    if (document.visibilityState !== "visible" || $("sheet").open || S.page !== "chats") return;
    const c = S.ticket;
    try {
      await loadChatList(c);
      if (chat.open) await loadThread(c);
      if (!stale(c)) drawChatList(), drawMessages();
    } catch {}
  }, 8000);
}
export const stopChatPolling = () => clearInterval(chat.poll);

async function loadChatList(current) {
  const q = chat.search ? `&search=${encodeURIComponent(chat.search)}` : "";
  const { conversations } = await api(`/api/admin/crm/conversations?scope=${chat.scope}${q}`);
  if (stale(current)) return;
  chat.list = conversations;
  if (chat.scope === "mine") setUnread(conversations.reduce((n, c) => n + c.unreadCount, 0));
}
async function loadThread(current) {
  const data = await api(`/api/admin/crm/conversations/${chat.open}`);
  if (stale(current)) return;
  chat.thread = data;
}
function drawChats() {
  const linked = Boolean(S.crm.me?.agentId);
  const scopes = [["mine", "Mis chats"], ["general", "Por atender"], ["resolved", "Resueltos"]].filter(([k]) => k !== "mine" || linked);
  $("content").innerHTML = `<div class="inbox ${chat.open ? "open" : ""}">
    <div class="list-pane"><div class="toolbar"><div class="segmented" id="chatScopes">${scopes.map(([k, l]) => `<button type="button" data-scope="${k}" class="${chat.scope === k ? "active" : ""}">${l}</button>`).join("")}</div>
      <input id="chatSearch" type="search" placeholder="Buscar cliente o mensaje" value="${esc(chat.search)}" aria-label="Buscar chats"></div>
      ${!linked ? '<p class="notice mb10">Atiendes como administración. Vincula tu usuario a un agente (Más → Equipo) para tener chats propios y tomar conversaciones.</p>' : ""}
      <div class="card stack" id="chatList"></div></div>
    ${chat.open ? `<div class="thread-pane" id="threadPane"></div>` : ""}</div>`;
  drawChatList();
  if (chat.open) drawThread();
  $("chatScopes").onclick = (e) => {
    const b = e.target.closest("[data-scope]");
    if (b) (chat.scope = b.dataset.scope), go("chats");
  };
  let searchTimer;
  $("chatSearch").oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      chat.search = e.target.value.trim();
      await loadChatList(S.ticket);
      drawChatList();
    }, 350);
  };
}
function drawChatList() {
  const list = $("chatList");
  if (!list) return;
  list.innerHTML = chat.list.length
    ? chat.list.map(convoItem).join("")
    : `<p class="pad muted small">${chat.scope === "mine" ? "No tienes chats abiertos. Toma uno en «Por atender»." : "No hay conversaciones aquí."}</p>`;
  list.onclick = (e) => {
    const b = e.target.closest("[data-convo]");
    if (b) go("chats", b.dataset.convo);
  };
}
function drawThread() {
  const t = chat.thread;
  const pane = $("threadPane");
  if (!pane || !t) return;
  const c = t.conversation;
  const [label, tone] = CHANNEL[c.channel] || [c.channel, ""];
  const mine = c.agentId && c.agentId === S.crm.me?.agentId;
  const closed = c.windowExpiresAt && new Date(c.windowExpiresAt) < new Date();
  pane.innerHTML = `<div class="card thread"><div class="thread-head"><button class="icon back" type="button" data-act="close-thread" aria-label="Volver a la lista">‹</button><span class="avatar">${esc(initials(c.contactName || c.contactPhone))}</span>
      <div class="grow"><strong>${esc(c.contactName || c.contactPhone || "Cliente")}</strong><div class="sub"><span class="pill ${tone}">${esc(label)}</span> ${esc(CONVO_STATUS[c.status] || c.status)} · ${mine ? "tuyo" : c.agentName ? esc(c.agentName) : "sin asignar"}</div></div>
      ${telLink(c.contactPhone) ? `<a class="secondary sm" href="${telLink(c.contactPhone)}">Llamar</a>` : ""}</div>
    <div class="thread-tools">${S.crm.me?.agentId && !mine ? '<button class="primary sm" data-act="claim" type="button">Tomar</button>' : ""}
      <button class="secondary sm" data-act="chat-vehicle" type="button">Enviar vehículo</button>
      ${canSell() ? '<button class="secondary sm" data-act="chat-quote" type="button">Cotizar</button><button class="secondary sm" data-act="chat-reserve" type="button">Reservar</button>' : ""}
      <button class="secondary sm" data-act="chat-appt" type="button">Agendar</button>
      ${c.status !== "resolved" ? '<button class="ghost sm" data-act="resolve" type="button">Resolver</button>' : ""}</div>
    <div class="messages" id="messages"></div>
    ${closed ? `<div class="window-closed">Pasaron más de 24 h desde el último mensaje del cliente: Meta solo permite plantillas aprobadas. Envíala desde Omnicanal o espera a que el cliente escriba.</div>` : ""}
    <form class="composer" id="composer"><textarea name="content" rows="1" maxlength="4000" placeholder="Escribe un mensaje…" aria-label="Mensaje"></textarea><button class="primary" type="submit" aria-label="Enviar">➤</button></form></div>`;
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
  if (!box || !chat.thread) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = chat.thread.messages.map(messageHtml).join("") || '<p class="note">Sin mensajes todavía.</p>';
  if (scroll || atBottom) box.scrollTop = box.scrollHeight;
}
async function refreshThread() {
  await loadThread(S.ticket);
  await loadChatList(S.ticket);
  drawChatList();
  drawThread();
}
export function chatCustomer() {
  const c = chat.thread.conversation;
  return { customerName: c.contactName || "", customerPhone: c.contactPhone || "", omniConversationId: c.id };
}

// From a vehicle's sheet: one of the person's open chats to send it to.
export async function pickConversation(v) {
  const { conversations } = await api(`/api/admin/crm/conversations?scope=${S.crm.me?.agentId ? "mine" : "general"}`);
  sheet(
    "Enviar a un chat",
    conversations.length
      ? `<p class="help">Se envía ${esc(title(v))} con su precio y el enlace a sus fotos.</p><div class="pick card stack mt12">${conversations.slice(0, 40).map((c) => `<button type="button" class="convo" data-pick="${c.id}"><span class="avatar">${esc(initials(c.contactName))}</span><span class="grow"><strong>${esc(c.contactName || c.contactPhone)}</strong><span class="last blockline">${esc(c.lastMessage)}</span></span></button>`).join("")}</div>`
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
    if (S.page === "chats" && chat.open === conversationId) await refreshThread();
  } catch (e) {
    notify(e.message, true);
  }
}
async function chatVehiclePicker(mode) {
  await loadCatalog();
  const list = S.catalog.filter((v) => mode === "send" || (!v.demo && (mode === "quote" ? !v.priceOnRequest && Number(v.price) > 0 : v.status === "available")));
  sheet(
    { reserve: "¿Qué vehículo reserva?", quote: "¿Qué vehículo cotizas?", send: "¿Qué vehículo envías?" }[mode],
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
    const v = S.catalog.find((x) => x.id === b.dataset.pick);
    if (mode === "reserve") reserveForm(v, chatCustomer());
    else if (mode === "quote") quoteForm({ vehicle: v, prefill: chatCustomer() });
    else sendVehicle(chat.thread.conversation.id, v);
  };
}

on("close-thread", () => go("chats"));
on("claim", async (b) => {
  b.disabled = true;
  await api(`/api/admin/crm/conversations/${chat.thread.conversation.id}/claim`, { method: "POST" });
  notify("Conversación tomada: ahora está en Mis chats.");
  return refreshThread();
});
on("resolve", async () => {
  if (!confirm("¿Marcar la conversación como resuelta?")) return;
  await api(`/api/admin/crm/conversations/${chat.thread.conversation.id}/resolve`, { method: "POST" });
  notify("Conversación resuelta.");
  go("chats");
});
on("chat-vehicle", () => chatVehiclePicker("send"));
on("chat-reserve", () => chatVehiclePicker("reserve"));
on("chat-quote", () => chatVehiclePicker("quote"));
on("chat-appt", () => appointmentForm({ ...chatCustomer() }));
