// Leo, the dealership's lion, floats in the corner of the public site. A tap opens a chat:
// typed questions go to the AI (server/assistant.js) when it is on; the quick replies, and every
// question when it is off, are answered here (js/mascot-brain.js). The page itself acts on his
// buttons (js/app.js, "premier:action"): show a vehicle, filter the inventory, open a form.
import { INVENTORY, DEALER } from './data.js';
import { STRINGS } from './i18n.js';
import { localAnswer, transcript, pageFilters, vehicleTitle } from './mascot-brain.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
const lang = () => (document.documentElement.lang === 'es' ? 'es' : 'en');
const byId = Object.fromEntries(INVENTORY.map((v) => [v.id, v]));
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');

const UI = {
  es: {
    fab: 'Pregúntale a Leo, el asistente del concesionario',
    teaser: '¿Buscas tu próximo auto? ¡Pregúntame!',
    role: 'Asistente de {name}',
    status: 'En línea',
    placeholder: 'Escribe tu pregunta…',
    send: 'Enviar',
    close: 'Cerrar el chat',
    reset: 'Empezar de nuevo',
    dismiss: 'Ocultar',
    typing: 'Leo está escribiendo',
    legal: 'Leo es un asistente automático. Un asesor confirma precios y disponibilidad.',
    chips: ['Ver SUVs', 'Lo más económico', '¿Tienen financiamiento?', 'Horario y dirección', 'Valorar mi auto', 'Hablar con un asesor'],
    actions: { inventory: 'Ver en el inventario', testdrive: 'Agendar prueba de manejo', finance: 'Calcular mi pago', trade: 'Valorar mi auto', contact: 'Hablar con un asesor', call: 'Llamar', directions: 'Cómo llegar' },
    reserved: 'Reservado',
    priceOnRequest: 'Consultar precio',
    miles: 'mi',
    name: 'Tu nombre',
    reach: 'Teléfono o email',
    submit: 'Enviar a un asesor',
    invalid: 'Escribe tu nombre y un teléfono o email válido.',
    sent: '¡Listo, {name}! Un asesor te contactará pronto. Si es urgente, llámanos al {phone}.',
    failed: 'No se pudo enviar. Inténtalo de nuevo o llámanos al {phone}.',
  },
  en: {
    fab: 'Ask Leo, the dealership assistant',
    teaser: 'Looking for your next car? Ask me!',
    role: '{name} assistant',
    status: 'Online',
    placeholder: 'Type your question…',
    send: 'Send',
    close: 'Close chat',
    reset: 'Start over',
    dismiss: 'Hide',
    typing: 'Leo is typing',
    legal: 'Leo is an automated assistant. A salesperson confirms prices and availability.',
    chips: ['Show me SUVs', 'Most affordable', 'Do you offer financing?', 'Hours and address', 'Value my trade-in', 'Talk to a person'],
    actions: { inventory: 'See in inventory', testdrive: 'Book a test drive', finance: 'Estimate my payment', trade: 'Value my trade-in', contact: 'Talk to a person', call: 'Call', directions: 'Directions' },
    reserved: 'Reserved',
    priceOnRequest: 'Contact for price',
    miles: 'mi',
    name: 'Your name',
    reach: 'Phone or email',
    submit: 'Send to a salesperson',
    invalid: 'Enter your name and a valid phone or email.',
    sent: "Done, {name}! A salesperson will contact you soon. If it's urgent, call us at {phone}.",
    failed: 'Could not send. Try again or call us at {phone}.',
  },
};
const u = (key) => UI[lang()][key];
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// ------------------------------------------------------------------ tiny DOM helper
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}
const icon = (id) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
};

// ------------------------------------------------------------------ conversation state
const KEY = 'premier:leo:v1';
const saved = (() => { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch { return {}; } })();
let messages = Array.isArray(saved.messages) ? saved.messages.filter((m) => m && typeof m.content === 'string') : [];
let ai = saved.ai !== false; // false once the server says the AI is off: the rest of the visit is local
let focusId = saved.focusId && byId[saved.focusId] ? saved.focusId : null; // the vehicle the chat is about
let busy = false;
const persist = () => {
  try { sessionStorage.setItem(KEY, JSON.stringify({ messages: messages.slice(-40), ai, focusId })); } catch { /* private mode */ }
};

// ------------------------------------------------------------------ the floating lion
const root = h('div', { class: 'mascot', id: 'mascot' });
const teaser = h('div', { class: 'mascot-teaser', hidden: true },
  h('p', {}),
  h('button', { type: 'button', class: 'mascot-teaser-x', onclick: (e) => { e.stopPropagation(); hideTeaser(true); } }, icon('i-x')),
);
teaser.addEventListener('click', () => open());
const rig = h('span', { class: 'mascot-rig' },
  h('span', { class: 'mascot-halo' }),
  h('span', { class: 'mascot-disc' }, h('span', { class: 'mascot-gloss' })),
  h('span', { class: 'mascot-ring' }),
  h('span', { class: 'mascot-lion' }, h('img', { src: '/img/mascot/leo.webp', alt: '', width: 420, height: 493, draggable: 'false', decoding: 'async' })),
  h('span', { class: 'mascot-ring is-front' }),
  h('span', { class: 'mascot-badge' }, icon('i-chat'), icon('i-x')),
);
const fab = h('button', { type: 'button', class: 'mascot-fab', 'aria-expanded': 'false', 'aria-controls': 'mascotPanel', onclick: () => (root.classList.contains('is-open') ? close() : open()) },
  h('span', { class: 'mascot-float' }, h('span', { class: 'mascot-stage' }, h('span', { class: 'mascot-sway' }, rig))),
  h('span', { class: 'mascot-shadow' }),
);

// Load WebGL independently so the photo and chat still work without it.
let leo3D;
let leoHovered = false;
fab.addEventListener('pointerenter', () => { leoHovered = true; leo3D?.hover(true); });
fab.addEventListener('pointerleave', () => { leoHovered = false; leo3D?.hover(false); });
import('./leo-3d.js').then(async ({ mountLeo }) => {
  leo3D = await mountLeo(rig.querySelector('.mascot-lion'));
  leo3D.hover(leoHovered);
}).catch(() => { /* The original portrait stays visible when WebGL is unavailable. */ });

// ------------------------------------------------------------------ the chat panel
const log = h('div', { class: 'mascot-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
const chips = h('div', { class: 'mascot-chips' });
const input = h('input', { type: 'text', class: 'mascot-text', maxlength: 600, autocomplete: 'off', enterkeyhint: 'send' });
const sendBtn = h('button', { type: 'submit', class: 'mascot-send' }, icon('i-arrow'));
const form = h('form', { class: 'mascot-input', onsubmit: (e) => { e.preventDefault(); ask(input.value); } }, input, sendBtn);
const title = h('h2', { id: 'mascotTitle', class: 'mascot-name', text: 'Leo' });
const role = h('p', { class: 'mascot-role' });
const status = h('span', { class: 'mascot-status' });
const resetBtn = h('button', { type: 'button', class: 'mascot-icon-btn', onclick: reset }, icon('i-rotate'));
const closeBtn = h('button', { type: 'button', class: 'mascot-icon-btn', onclick: () => close() }, icon('i-x'));
const legal = h('p', { class: 'mascot-legal' });
const panel = h('section', { class: 'mascot-panel', id: 'mascotPanel', role: 'dialog', 'aria-labelledby': 'mascotTitle', hidden: true },
  h('header', { class: 'mascot-head' },
    h('img', { class: 'mascot-face', src: '/img/mascot/leo-face.webp', alt: '', width: 160, height: 160 }),
    h('div', { class: 'mascot-who' }, title, h('p', { class: 'mascot-sub' }, status, role)),
    resetBtn, closeBtn,
  ),
  log, chips, form, legal,
);
root.append(panel, teaser, fab);
document.body.append(root);

function applyLang() {
  const L = UI[lang()];
  fab.setAttribute('aria-label', L.fab);
  teaser.querySelector('p').textContent = L.teaser;
  teaser.querySelector('button').setAttribute('aria-label', L.dismiss);
  role.textContent = fill(L.role, { name: DEALER.name });
  status.textContent = L.status;
  input.placeholder = L.placeholder;
  input.setAttribute('aria-label', L.placeholder);
  sendBtn.setAttribute('aria-label', L.send);
  resetBtn.setAttribute('aria-label', L.reset);
  resetBtn.title = L.reset;
  closeBtn.setAttribute('aria-label', L.close);
  legal.textContent = L.legal;
  chips.replaceChildren(...L.chips.map((c) => h('button', { type: 'button', class: 'mascot-chip', text: c, onclick: () => ask(c, { local: true }) })));
}
applyLang();
new MutationObserver(applyLang).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

// ------------------------------------------------------------------ rendering
function vehicleCard(id) {
  const v = byId[id];
  if (!v) return null;
  const L = UI[lang()];
  return h('button', { type: 'button', class: 'mascot-car', onclick: () => { focusId = id; persist(); act('vehicle', { id }); } },
    h('span', { class: 'mascot-car-img' },
      h('img', { src: v.photos?.[0] || '/img/vehicle-placeholder.svg', alt: '', loading: 'lazy' }),
      v.status === 'reserved' ? h('em', { text: L.reserved }) : null,
    ),
    h('strong', { text: vehicleTitle(v) }),
    h('span', { class: 'mascot-car-meta' },
      h('b', { text: v.priceOnRequest ? L.priceOnRequest : usd(v.price) }),
      ` · ${Math.round(v.miles || 0).toLocaleString('en-US')} ${L.miles}`,
    ),
  );
}

function actionButton(kind, msg) {
  const L = UI[lang()];
  const label = [icon({ call: 'i-phone', directions: 'i-pin', testdrive: 'i-clock', finance: 'i-gauge', trade: 'i-tag', contact: 'i-chat', inventory: 'i-grid' }[kind] || 'i-arrow'), L.actions[kind]];
  if (kind === 'call') return h('a', { class: 'mascot-action', href: DEALER.phoneHref }, label);
  if (kind === 'directions')
    return h('a', { class: 'mascot-action', href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(DEALER.address), target: '_blank', rel: 'noopener' }, label);
  if (kind === 'contact') return h('button', { type: 'button', class: 'mascot-action', onclick: () => handoff() }, label);
  return h('button', { type: 'button', class: 'mascot-action', onclick: () => act(kind, { id: msg.vehicles?.length === 1 ? msg.vehicles[0] : focusId, filters: msg.filters }) }, label);
}

function bubble(msg) {
  if (msg.role === 'user') return h('div', { class: 'mascot-msg is-user' }, h('p', { class: 'mascot-bubble', text: msg.content }));
  const cars = (msg.vehicles || []).map(vehicleCard).filter(Boolean);
  const actions = (msg.actions || []).filter((k) => UI.es.actions[k]).map((k) => actionButton(k, msg));
  return h('div', { class: 'mascot-msg is-leo' },
    h('img', { class: 'mascot-avatar', src: '/img/mascot/leo-face.webp', alt: '' }),
    h('div', { class: 'mascot-body' },
      h('p', { class: 'mascot-bubble', text: msg.content }),
      cars.length ? h('div', { class: 'mascot-cars' }, cars) : null,
      actions.length ? h('div', { class: 'mascot-actions' }, actions) : null,
      msg.form ? leadForm(msg) : null,
    ),
  );
}

function render() {
  log.replaceChildren(...messages.map(bubble));
  scrollDown();
}
const scrollDown = () => requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });

function add(msg) {
  messages.push(msg);
  if (messages.length > 40) messages = messages.slice(-40);
  persist();
  log.append(bubble(msg));
  scrollDown();
}

let typingEl = null;
function typing(on) {
  busy = on;
  sendBtn.disabled = on;
  log.setAttribute('aria-busy', String(on));
  typingEl?.remove();
  typingEl = null;
  if (on) {
    typingEl = h('div', { class: 'mascot-msg is-leo is-typing' },
      h('img', { class: 'mascot-avatar', src: '/img/mascot/leo-face.webp', alt: '' }),
      h('p', { class: 'mascot-bubble', 'aria-label': u('typing') }, h('i'), h('i'), h('i')),
    );
    log.append(typingEl);
    scrollDown();
  }
}

// ------------------------------------------------------------------ answering
const hours = () => STRINGS[lang()]?.['top.hours'] || '';
const wait = (ms) => new Promise((r) => setTimeout(r, reducedMotion ? 0 : ms));

function local(text) {
  const a = localAnswer(text, { inventory: INVENTORY, dealer: DEALER, lang: lang(), hours: hours(), context: { vehicle: byId[focusId] } });
  return { role: 'assistant', content: a.text, vehicles: a.vehicles, actions: a.actions, filters: a.filters, form: a.handoff || undefined };
}

async function remote() {
  const history = messages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-12).map((m) => ({ role: m.role, content: m.content }));
  try {
    const r = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: lang(), messages: history }) });
    if (r.status === 503) { ai = false; return null; }
    if (!r.ok) return null;
    const d = await r.json();
    if (typeof d.reply !== 'string' || !d.reply) return null;
    return { role: 'assistant', content: d.reply, vehicles: (d.vehicles || []).filter((id) => byId[id]), actions: d.actions || [] };
  } catch {
    return null;
  }
}

async function ask(raw, { local: chip = false } = {}) {
  const text = String(raw || '').trim().slice(0, 600);
  if (!text || busy) return;
  input.value = '';
  add({ role: 'user', content: text });
  typing(true);
  const started = performance.now();
  let reply = !chip && ai ? await remote() : null;
  reply ||= local(text);
  if (reply.vehicles?.length === 1) focusId = reply.vehicles[0];
  await wait(Math.max(0, 650 - (performance.now() - started)));
  typing(false);
  add(reply);
  if (finePointer) input.focus({ preventScroll: true });
}

// The visitor leaves name and phone or email; it reaches the panel's Consultas and Omnicanal's CRM
// like any other inquiry from the site, with their questions to Leo as the note.
function handoff() {
  const last = messages.at(-1);
  if (!(last?.form && !last.sent)) add(local(lang() === 'es' ? 'hablar con un asesor' : 'talk to a person'));
  setTimeout(() => [...log.querySelectorAll('.mascot-lead')].at(-1)?.querySelector('input')?.focus({ preventScroll: true }), 50);
}

function leadForm(msg) {
  const L = UI[lang()];
  if (msg.sent) return null;
  const err = h('p', { class: 'mascot-lead-error', role: 'alert' });
  const name = h('input', { name: 'name', autocomplete: 'name', maxlength: 160, required: true, placeholder: L.name, 'aria-label': L.name });
  const reach = h('input', { name: 'reach', autocomplete: 'tel', maxlength: 200, required: true, placeholder: L.reach, 'aria-label': L.reach });
  const trap = h('input', { name: 'website', tabindex: '-1', autocomplete: 'off', class: 'mascot-trap', 'aria-hidden': 'true' });
  const submit = h('button', { type: 'submit', class: 'mascot-lead-btn', text: L.submit });
  const f = h('form', { class: 'mascot-lead', novalidate: true }, name, reach, trap, submit, err);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const who = name.value.trim(), contact = reach.value.trim();
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    if (!who || !(email || contact.replace(/\D/g, '').length >= 7)) { err.textContent = L.invalid; return; }
    submit.disabled = true;
    err.textContent = '';
    const body = { kind: 'contact', name: who, msg: transcript(messages, lang()), website: trap.value };
    if (email) body.email = contact; else body.phone = contact;
    if (focusId && byId[focusId]?.live) body.vehicle = focusId;
    try {
      const r = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error || ''), { server: Boolean(d.error) });
      msg.sent = true;
      f.remove();
      add({ role: 'assistant', content: fill(L.sent, { name: who.split(' ')[0], phone: DEALER.phone }) });
    } catch (error) {
      // The server's own messages ("Ese vehículo ya no está disponible.") are in Spanish.
      err.textContent = error.server && lang() === 'es' ? error.message : fill(L.failed, { phone: DEALER.phone });
      submit.disabled = false;
    }
  });
  return f;
}

function act(kind, detail = {}) {
  const payload = { kind, id: detail.id };
  if (kind === 'inventory') payload.filters = pageFilters(detail.filters);
  if (kind !== 'vehicle') close({ quiet: true });
  window.dispatchEvent(new CustomEvent('premier:action', { detail: payload }));
}

function reset() {
  messages = [];
  focusId = null;
  persist();
  greet();
  input.focus({ preventScroll: true });
}
function greet() {
  render();
  add({ role: 'assistant', content: localAnswer('hola', { dealer: DEALER, lang: lang() }).text });
}

// ------------------------------------------------------------------ open / close
let closing;
function open() {
  leo3D?.greet();
  clearTimeout(closing);
  hideTeaser(true);
  panel.hidden = false;
  root.classList.add('is-open');
  document.documentElement.classList.add('mascot-open');
  fab.setAttribute('aria-expanded', 'true');
  if (!messages.length) greet(); else render();
  fab.classList.add('is-pop');
  setTimeout(() => fab.classList.remove('is-pop'), 500);
  setTimeout(() => input.focus({ preventScroll: true }), finePointer ? 60 : 320);
}
function close({ quiet = false } = {}) {
  if (!root.classList.contains('is-open')) return;
  root.classList.remove('is-open');
  document.documentElement.classList.remove('mascot-open');
  fab.setAttribute('aria-expanded', 'false');
  closing = setTimeout(() => { panel.hidden = true; }, reducedMotion ? 0 : 280);
  if (!quiet) fab.focus({ preventScroll: true });
}
// Capture phase: this runs before the page closes the vehicle sheet on the same Escape, so it
// can tell that the sheet goes first and the chat stays.
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !root.classList.contains('is-open')) return;
  if (document.getElementById('vehicleModal')?.hidden === false) return;
  close();
}, true);

// A first-time visitor gets a hint after a few seconds; once per visit.
const TEASED = 'premier:leo:teased';
let teaserTimer;
function hideTeaser(forever) {
  clearTimeout(teaserTimer);
  teaser.classList.remove('is-on');
  setTimeout(() => { teaser.hidden = true; }, 250);
  if (forever) try { sessionStorage.setItem(TEASED, '1'); } catch { /* private mode */ }
}
try {
  if (!sessionStorage.getItem(TEASED) && !messages.length)
    setTimeout(() => {
      if (root.classList.contains('is-open')) return;
      teaser.hidden = false;
      requestAnimationFrame(() => teaser.classList.add('is-on'));
      teaserTimer = setTimeout(() => hideTeaser(false), 14000);
    }, 6000);
} catch { /* storage blocked: no hint */ }

// ------------------------------------------------------------------ 3D: he turns to follow the pointer
if (!reducedMotion) {
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, idle;
  const clamp = (v, m) => Math.max(-m, Math.min(m, v));
  const step = () => {
    cx += (tx - cx) * 0.1;
    cy += (ty - cy) * 0.1;
    rig.style.setProperty('--rx', cx.toFixed(2) + 'deg');
    rig.style.setProperty('--ry', cy.toFixed(2) + 'deg');
    rig.style.setProperty('--gx', (cx / 16).toFixed(3));
    rig.style.setProperty('--gy', (cy / 22).toFixed(3));
    raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.05 ? requestAnimationFrame(step) : 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(step); };
  root.classList.add('is-idle');
  if (finePointer)
    addEventListener('pointermove', (e) => {
      if (document.hidden) return;
      const r = fab.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / Math.max(260, innerWidth * 0.32);
      const dy = (e.clientY - (r.top + r.height * 0.35)) / Math.max(260, innerHeight * 0.4);
      ty = clamp(dx * 26, 24);
      tx = clamp(-dy * 18, 16);
      root.classList.remove('is-idle');
      clearTimeout(idle);
      idle = setTimeout(() => { tx = ty = 0; kick(); root.classList.add('is-idle'); }, 2600);
      kick();
    }, { passive: true });
}
