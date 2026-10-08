import { INVENTORY, SHOWROOM, CATEGORIES, SPOTLIGHT } from './data.js';
import { STRINGS } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const finePointer = matchMedia('(pointer: fine)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = {
  get(k, d) { try { const v = localStorage.getItem('novara:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('novara:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = {
  view: root.dataset.view === 'classic' ? 'classic' : 'immersive',
  lang: store.get('lang', (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en'),
  favs: new Set(store.get('favs', [])),
  filters: { q: '', cat: 'all', cond: '', max: 200000, sort: 'featured', saved: false },
  layout: store.get('layout', 'grid'),
  hero: 0,
  paint: 0,
};

const byId = Object.fromEntries(INVENTORY.map((v) => [v.id, v]));
const t = (key, vars) => {
  let s = STRINGS[state.lang][key] ?? STRINGS.en[key] ?? key;
  if (vars && typeof s === 'string') for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
};
const L = (o) => (o && typeof o === 'object' ? o[state.lang] ?? o.en : o);
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const num = (n) => Math.round(n).toLocaleString('en-US');
const payment = (principal, apr, months) => {
  if (principal <= 0) return 0;
  const r = apr / 100 / 12;
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
};
const estMonthly = (price) => payment(price * 0.9, 6.9, 72);
const title = (v) => `${v.year} ${v.make} ${v.model}`;
const img = (id, angle = 'front') => `img/cars/${id}-${angle}.webp`;

// ============================================================ i18n
function applyI18n() {
  root.lang = state.lang;
  document.title = t('meta.title');
  $$('[data-i18n]').forEach((el) => { const v = t(el.dataset.i18n); if (typeof v === 'string') el.textContent = v; });
  $$('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $('#langBtn').textContent = state.lang === 'en' ? 'ES' : 'EN';
  renderMarquee();
  renderTypes();
  renderChips();
  renderInventory();
  renderConfigurator(false);
  fillSelects();
  updateCount();
  if (currentVehicle) fillModal(currentVehicle, true);
}

// ============================================================ toast
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}

// ============================================================ favorites
function toggleFav(id) {
  if (state.favs.has(id)) { state.favs.delete(id); toast(t('toast.removed')); } else { state.favs.add(id); toast(t('toast.saved')); }
  store.set('favs', [...state.favs]);
  updateFavUI(id);
  const fb = $('#favNav');
  fb.classList.remove('bump'); void fb.offsetWidth; fb.classList.add('bump');
}
function updateFavUI(id) {
  const n = state.favs.size;
  const c = $('#favCount');
  c.textContent = n; c.hidden = n === 0;
  $$(`[data-fav="${id}"]`).forEach((b) => b.setAttribute('aria-pressed', state.favs.has(id)));
  if (currentVehicle && currentVehicle.id === id) $('#mFav').setAttribute('aria-pressed', state.favs.has(id));
  if (state.filters.saved) renderInventory();
}

// ============================================================ marquee / types / chips
function renderMarquee() {
  const items = t('marquee');
  const html = [...items, ...items, ...items, ...items].map((w) => `<span>${w}</span>`).join('');
  $('#marquee').innerHTML = html;
}

const catCount = (id) => (id === 'all' ? INVENTORY.length : INVENTORY.filter((v) => v.cats.includes(id)).length);

function renderTypes() {
  $('#typeGrid').innerHTML = CATEGORIES.map((c, i) => `
    <button type="button" class="type-card reveal" style="--d:${i * 0.06}s" data-cat="${c.id}">
      <span class="arrow"><svg class="i"><use href="#i-arrow"/></svg></span>
      <span><h3>${t('cat.' + c.id)}</h3><small>${t('types.count', { n: catCount(c.id) })}</small></span>
      <img src="${img(c.img, 'side')}" alt="" loading="lazy" width="1200" height="720">
    </button>`).join('');
  observeReveals($('#typeGrid'));
}

function renderChips() {
  const cats = ['all', ...CATEGORIES.map((c) => c.id)];
  $('#fType').innerHTML = cats.map((c) => `
    <button type="button" class="chip" data-chip="${c}" aria-pressed="${state.filters.cat === c}">${t('cat.' + c)} <small>${catCount(c)}</small></button>`).join('');
}

function fillSelects() {
  const keepType = $('#hcType').value, keepMake = $('#hcMake').value, keepTd = $('#tdVehicle').value;
  $('#hcType').innerHTML = `<option value="all">${t('hc.any')}</option>` + CATEGORIES.map((c) => `<option value="${c.id}">${t('cat.' + c.id)}</option>`).join('');
  const makes = [...new Set(INVENTORY.map((v) => v.make))].sort();
  $('#hcMake').innerHTML = `<option value="">${t('hc.any')}</option>` + makes.map((m) => `<option>${m}</option>`).join('');
  $('#tdVehicle').innerHTML = `<option value="">${t('form.any')}</option>` + INVENTORY.map((v) => `<option value="${v.id}">${title(v)}</option>`).join('');
  if (keepType) $('#hcType').value = keepType;
  if (keepMake) $('#hcMake').value = keepMake;
  if (keepTd) $('#tdVehicle').value = keepTd;
}

// ============================================================ inventory
function filtered() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  let list = INVENTORY.filter((v) => {
    if (f.cat !== 'all' && !v.cats.includes(f.cat)) return false;
    if (f.cond && v.condition !== f.cond) return false;
    if (v.price > f.max) return false;
    if (f.saved && !state.favs.has(v.id)) return false;
    if (q) {
      const hay = [v.year, v.make, v.model, v.trim, v.ext.en, v.ext.es, v.engine, v.drive, v.fuel, ...v.cats.flatMap((c) => [c, STRINGS.en['cat.' + c], STRINGS.es['cat.' + c]])].join(' ').toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const sorters = {
    featured: (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0),
    priceAsc: (a, b) => a.price - b.price,
    priceDesc: (a, b) => b.price - a.price,
    milesAsc: (a, b) => a.miles - b.miles,
    yearDesc: (a, b) => b.year - a.year,
  };
  return list.sort(sorters[f.sort] || sorters.featured);
}

function cardHTML(v, i) {
  const drop = v.msrp - v.price;
  const fuelIcon = v.fuel === 'electric' ? 'i-bolt' : 'i-fuel';
  const badges = [`<span class="badge ${v.condition}">${t('cond.' + v.condition)}</span>`];
  if (drop > 0) badges.push(`<span class="badge drop">−${usd(drop)}</span>`);
  return `
  <article class="car-card entering" data-id="${v.id}" style="--i:${i}">
    <div class="cc-media" data-open="${v.id}" role="button" tabindex="0" aria-label="${t('card.view')}: ${title(v)}">
      <div class="cc-badges">${badges.join('')}</div>
      <img class="main" src="${img(v.id)}" alt="${title(v)} — ${L(v.ext)}" loading="lazy" width="1200" height="720">
      <img class="alt" src="${img(v.id, 'rear')}" alt="" loading="lazy" width="1200" height="720" aria-hidden="true">
    </div>
    <button type="button" class="cc-fav" data-fav="${v.id}" aria-pressed="${state.favs.has(v.id)}" aria-label="${t('card.save')}: ${title(v)}"><svg class="i"><use href="#i-heart"/></svg></button>
    <div class="cc-body">
      <div class="cc-top"><span>${v.year} · ${v.make}</span><span>#${v.stock}</span></div>
      <h3 class="cc-title">${v.model}<small>${v.trim} · ${L(v.ext)}</small></h3>
      <div class="cc-specs">
        <span><svg class="i"><use href="#i-road"/></svg>${num(v.miles)} ${t('card.miles')}</span>
        <span><svg class="i"><use href="#i-drive"/></svg>${v.drive}</span>
        <span><svg class="i"><use href="#i-gauge"/></svg>${v.hp} hp</span>
        <span><svg class="i"><use href="#${fuelIcon}"/></svg>${v.economy}</span>
      </div>
      <div class="cc-foot">
        <div class="cc-price">
          <small>${t('card.price')}</small>
          <strong>${usd(v.price)}</strong>${drop > 0 ? `<s>${usd(v.msrp)}</s>` : ''}
          <em>${t('card.est')} ${usd(estMonthly(v.price))}${t('card.mo')}</em>
        </div>
        <button type="button" class="cc-cta" data-open="${v.id}" aria-label="${t('card.details')}"><svg class="i"><use href="#i-arrow"/></svg></button>
        <button type="button" class="btn btn-primary btn-sm cc-cta-text" data-open="${v.id}">${t('card.view')}</button>
      </div>
    </div>
  </article>`;
}

function renderInventory() {
  const list = filtered();
  const grid = $('#carGrid');
  grid.classList.toggle('list', state.layout === 'list');
  grid.innerHTML = list.map(cardHTML).join('');
  $('#invEmpty').hidden = list.length > 0;
  updateCount(list.length);
  requestAnimationFrame(() => {
    $$('.car-card', grid).forEach((c, i) => setTimeout(() => c.classList.remove('entering'), reducedMotion ? 0 : 60 * Math.min(i, 8)));
  });
  bindTilt();
}

function updateCount(n = filtered().length) {
  $('#invCount').innerHTML = n === 1 ? t('inv.count1').replace('1', '<b>1</b>') : t('inv.count', { n: `<b>${n}</b>` });
}

function setFilter(patch, scroll = false) {
  Object.assign(state.filters, patch);
  if ('cat' in patch) $$('#fType .chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.chip === state.filters.cat));
  renderInventory();
  if (scroll) $('#inventory').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
}

function syncFilterInputs() {
  const f = state.filters;
  $('#fSearch').value = f.q;
  $('#fCond').value = f.cond;
  $('#fPrice').value = f.max;
  $('#fSort').value = f.sort;
  $('#fSaved').checked = f.saved;
  updateRange($('#fPrice'));
  $('#fPriceOut').textContent = usd(f.max);
}

function bindInventory() {
  $('#fType').addEventListener('click', (e) => { const c = e.target.closest('[data-chip]'); if (c) setFilter({ cat: c.dataset.chip }); });
  let st;
  $('#fSearch').addEventListener('input', (e) => { clearTimeout(st); st = setTimeout(() => setFilter({ q: e.target.value }), 140); });
  $('#fCond').addEventListener('change', (e) => setFilter({ cond: e.target.value }));
  $('#fSort').addEventListener('change', (e) => setFilter({ sort: e.target.value }));
  $('#fSaved').addEventListener('change', (e) => setFilter({ saved: e.target.checked }));
  $('#fPrice').addEventListener('input', (e) => { $('#fPriceOut').textContent = usd(+e.target.value); updateRange(e.target); clearTimeout(st); st = setTimeout(() => setFilter({ max: +e.target.value }), 80); });
  $('#fReset').addEventListener('click', () => { state.filters = { q: '', cat: 'all', cond: '', max: 200000, sort: 'featured', saved: false }; syncFilterInputs(); setFilter({ cat: 'all' }); });
  $('#typeGrid').addEventListener('click', (e) => { const c = e.target.closest('[data-cat]'); if (c) setFilter({ cat: c.dataset.cat }, true); });
  $$('[data-cat-link]').forEach((a) => a.addEventListener('click', () => setFilter({ cat: a.dataset.catLink })));
  $('#favNav').addEventListener('click', () => {
    state.filters.saved = state.favs.size > 0 && !state.filters.saved;
    syncFilterInputs();
    setFilter({}, true);
  });

  document.addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { e.preventDefault(); toggleFav(fav.dataset.fav); return; }
    const open = e.target.closest('[data-open]');
    if (open) { e.preventDefault(); openVehicle(open.dataset.open, open); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.cc-media[data-open]')) { e.preventDefault(); openVehicle(e.target.dataset.open, e.target); }
  });

  $$('.layout-toggle [data-layout]').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.layout === state.layout);
    b.addEventListener('click', () => {
      state.layout = b.dataset.layout; store.set('layout', state.layout);
      $$('.layout-toggle [data-layout]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      $('#carGrid').classList.toggle('list', state.layout === 'list');
    });
  });

  $('#classicSearch').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.filters = { ...state.filters, cat: fd.get('type') || 'all', q: fd.get('make') || '', max: +fd.get('max') || 200000 };
    syncFilterInputs();
    setFilter({ cat: state.filters.cat }, true);
  });
}

// 3D tilt + glare on cards (immersive, fine pointer)
function bindTilt() {
  if (!finePointer || reducedMotion) return;
  $$('.car-card').forEach((card) => {
    if (card._tilt) return;
    card._tilt = true;
    card.addEventListener('pointermove', (e) => {
      if (state.view !== 'immersive') return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.setProperty('--ry', `${(x - 0.5) * 10}deg`);
      card.style.setProperty('--rx', `${(0.5 - y) * 8}deg`);
      card.style.setProperty('--mx', `${x * 100}%`);
      card.style.setProperty('--my', `${y * 100}%`);
    });
    card.addEventListener('pointerleave', () => { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
  });
}

// ============================================================ modal
let currentVehicle = null, lastFocus = null, viewer = null, viewerReady = null, modalTab = 'front';

function fillModal(v, keepTab = false) {
  $('#mKicker').textContent = `${v.year} · ${t('cond.' + v.condition)} · #${v.stock}`;
  $('#mTitle').textContent = `${v.make} ${v.model}`;
  $('#mTrim').textContent = `${v.trim} · ${L(v.ext)}`;
  $('#mPrice').textContent = usd(v.price);
  $('#mMsrp').textContent = v.msrp > v.price ? `${t('card.msrp')} ${usd(v.msrp)}` : '';
  $('#mMonthly').textContent = `${t('card.est')} ${usd(estMonthly(v.price))}${t('card.mo')}`;
  const specs = [
    ['modal.engine', v.engine], ['modal.power', `${v.hp} hp`], ['modal.drive', v.drive], ['modal.trans', L(v.trans)],
    ['modal.economy', v.economy], ['modal.zero60', `${v.zero60} s`], ['modal.miles', `${num(v.miles)} mi`], ['modal.seats', v.seats],
    ['modal.ext', L(v.ext)], ['modal.int', L(v.int)],
  ];
  if (v.towing) specs.splice(6, 0, ['modal.tow', v.towing]);
  specs.push(['modal.vin', v.vin]);
  $('#mSpecs').innerHTML = specs.map(([k, val]) => `<div><dt>${t(k)}</dt><dd>${val}</dd></div>`).join('');
  $('#mDesc').textContent = L(v.desc);
  $('#mFav').setAttribute('aria-pressed', state.favs.has(v.id));
  const tabs = ['front', 'side', 'rear'];
  $('#mThumbs').innerHTML = tabs.map((a) => `<button type="button" role="tab" data-tab="${a}" aria-selected="false" aria-label="${t('modal.gallery')} ${a}"><img src="${img(v.id, a)}" alt=""></button>`).join('')
    + `<button type="button" role="tab" class="t3d" data-tab="3d" aria-selected="false"><span>360°<small>${t('modal.3d')}</small></span></button>`;
  showTab(keepTab ? modalTab : 'front');
}

function showTab(tab) {
  const v = currentVehicle;
  modalTab = tab;
  $$('#mThumbs [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
  const imgEl = $('#mImg'), cv = $('#mCanvas');
  if (tab === '3d') {
    imgEl.hidden = true; cv.hidden = false; $('#mHint').hidden = false;
    $('#mLoading').hidden = false;
    viewerReady = viewerReady || import('./viewer3d.js').then((m) => (viewer = m.createViewer(cv)));
    viewerReady.then(() => { viewer.show(v.config); $('#mLoading').hidden = true; }).catch(() => { $('#mLoading').hidden = true; showTab('front'); });
  } else {
    if (viewer) viewer.hide();
    cv.hidden = true; $('#mHint').hidden = true; $('#mLoading').hidden = true; imgEl.hidden = false;
    imgEl.src = img(v.id, tab);
    imgEl.alt = `${title(v)} — ${tab}`;
    imgEl.style.animation = 'none'; void imgEl.offsetWidth; imgEl.style.animation = '';
  }
}

function openVehicle(id, trigger) {
  const v = byId[id];
  if (!v) return;
  currentVehicle = v;
  lastFocus = trigger || document.activeElement;
  fillModal(v);
  const m = $('#vehicleModal');
  m.hidden = false;
  document.body.style.overflow = 'hidden';
  hero?.pause();
  setTimeout(() => $('.modal-close', m).focus(), 50);
}

function closeModal() {
  const m = $('#vehicleModal');
  if (m.hidden) return;
  m.hidden = true;
  document.body.style.overflow = '';
  if (viewer) viewer.hide();
  currentVehicle = null;
  heroVisibility();
  lastFocus?.focus?.({ preventScroll: true });
}

function bindModal() {
  const m = $('#vehicleModal');
  m.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); const tb = e.target.closest('[data-tab]'); if (tb) showTab(tb.dataset.tab); });
  document.addEventListener('keydown', (e) => {
    if (m.hidden) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Tab') {
      const f = $$('button:not([hidden]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', m).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  $('#mFav').addEventListener('click', () => currentVehicle && toggleFav(currentVehicle.id));
  $('#mTestDrive').addEventListener('click', () => {
    const id = currentVehicle.id;
    closeModal();
    $('#tdVehicle').value = id;
    $('#visit').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    setTimeout(() => $('#testDriveForm [name=name]').focus({ preventScroll: true }), 700);
  });
  $('#mPayment').addEventListener('click', () => {
    const price = currentVehicle.price;
    closeModal();
    $('#cPrice').value = price;
    calc();
    $('#finance').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  });
}

// ============================================================ calculator
function updateRange(el) {
  const p = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--p', p + '%');
}
let term = 72;
function calc() {
  const price = +$('#cPrice').value, down = +$('#cDown').value, trade = +$('#cTrade').value;
  const apr = Math.max(0, parseFloat($('#cApr').value) || 0);
  ['cPrice', 'cDown', 'cTrade'].forEach((id) => { updateRange($('#' + id)); $(`#${id}Out`).textContent = usd(+$('#' + id).value); });
  const principal = Math.max(0, price - down - trade);
  const mo = payment(principal, apr, term);
  const interest = Math.max(0, mo * term - principal);
  animateNumber($('#cMonthly'), mo);
  $('#cFinanced').textContent = usd(principal);
  $('#cInterest').textContent = usd(interest);
  const tot = principal + interest || 1;
  $('#cBarP').style.width = (principal / tot) * 100 + '%';
  $('#cBarI').style.width = (interest / tot) * 100 + '%';
}
function animateNumber(el, to) {
  const from = el._v || 0;
  el._v = to;
  if (reducedMotion) { el.textContent = usd(to); return; }
  const t0 = performance.now();
  cancelAnimationFrame(el._raf);
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 450), e = 1 - Math.pow(1 - k, 3);
    el.textContent = usd(from + (to - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
function bindCalc() {
  ['cPrice', 'cDown', 'cTrade', 'cApr'].forEach((id) => $('#' + id).addEventListener('input', calc));
  $('#cTerm').addEventListener('click', (e) => {
    const b = e.target.closest('[data-term]');
    if (!b) return;
    term = +b.dataset.term;
    $$('#cTerm [data-term]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    calc();
  });
  $('#preapproveBtn').addEventListener('click', () => toast(t('toast.preapproved')));
  calc();
}

// ============================================================ forms (front-end only — wire to your CRM/endpoint)
function bindForms() {
  $$('form[data-form]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let ok = true;
      $$('[required]', form).forEach((inp) => {
        const bad = !inp.value.trim() || (inp.pattern && !new RegExp(`^${inp.pattern}$`).test(inp.value.trim())) || (inp.type === 'email' && !/^\S+@\S+\.\S+$/.test(inp.value));
        inp.setAttribute('aria-invalid', bad);
        if (bad && ok) { inp.focus(); ok = false; }
      });
      if (!ok) return;
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      // Replace with fetch('/api/leads', { method: 'POST', body: new FormData(form) })
      setTimeout(() => {
        btn.disabled = false;
        form.reset();
        $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
        toast(t(form.dataset.form === 'trade' ? 'toast.trade' : 'toast.testdrive'));
      }, 650);
    });
    form.addEventListener('input', (e) => { if (e.target.getAttribute('aria-invalid') === 'true' && e.target.value.trim()) e.target.removeAttribute('aria-invalid'); });
  });
  const d = new Date();
  $('#tdDate').min = d.toISOString().slice(0, 10);
  // highlight today's hours
  const day = d.getDay();
  const row = day === 0 ? 2 : day === 6 ? 1 : 0;
  $$('.hours div')[row]?.classList.add('today');
}

// ============================================================ hero configurator + 3D
let hero = null, heroLoading = null, heroVisible = true;

function renderConfigurator(rebuildPaint = true) {
  const m = SHOWROOM[state.hero];
  const v = byId[m.id];
  $('#modelTabs').innerHTML = SHOWROOM.map((s, i) => `<button type="button" role="tab" aria-selected="${i === state.hero}" data-model="${i}">${s.label}</button>`).join('');
  $('#cfgMake').textContent = `${v.year} ${v.make}`;
  $('#cfgName').textContent = v.model;
  $('#cfgPrice').textContent = usd(v.price);
  $('#cfgStats').innerHTML = m.stats.map((s) => {
    const label = t('stat.' + s.k);
    const val = s.k === 'hp' ? `${s.v} hp` : s.k === 'zero60' ? `${s.v} s` : s.k === 'top' ? `${s.v} mph` : s.k === 'range' ? `${s.v} mi` : `${num(s.v)} lb`;
    const w = s.inverse ? (1 - s.v / s.max) * 100 + 18 : (s.v / s.max) * 100;
    return `<div class="cfg-stat"><span>${label}</span><b>${val}</b><span class="bar"><i style="--w:${Math.min(100, w)}%"></i></span></div>`;
  }).join('');
  $('#swatches').innerHTML = m.paints.map((p, i) => `<button type="button" role="radio" class="swatch${p.finish === 'matte' ? ' matte' : ''}" style="--c:${p.color}" aria-checked="${i === state.paint}" aria-label="${L(p)}" data-paint="${i}" title="${L(p)}"></button>`).join('');
  $('#paintName').textContent = L(m.paints[state.paint]);
  if (rebuildPaint) {
    // animate the stat bars from zero
    $$('#cfgStats .bar i').forEach((b) => { const w = b.style.getPropertyValue('--w'); b.style.setProperty('--w', '0%'); requestAnimationFrame(() => requestAnimationFrame(() => b.style.setProperty('--w', w))); });
  }
}

function heroConfig() {
  const m = SHOWROOM[state.hero];
  const p = m.paints[state.paint];
  return { ...byId[m.id].config, color: p.color, finish: p.finish || 'gloss', metalness: p.metalness };
}

function bindConfigurator() {
  $('#modelTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-model]');
    if (!b || +b.dataset.model === state.hero) return;
    state.hero = +b.dataset.model; state.paint = 0;
    renderConfigurator();
    hero?.setModel(heroConfig());
  });
  $('#swatches').addEventListener('click', (e) => {
    const b = e.target.closest('[data-paint]');
    if (!b) return;
    state.paint = +b.dataset.paint;
    $$('#swatches .swatch').forEach((s) => s.setAttribute('aria-checked', s === b));
    $('#paintName').textContent = L(SHOWROOM[state.hero].paints[state.paint]);
    const p = SHOWROOM[state.hero].paints[state.paint];
    hero?.setPaint(p.color, p.finish || 'gloss', p.metalness);
  });
  $('#cfgDetails').addEventListener('click', (e) => openVehicle(SHOWROOM[state.hero].id, e.currentTarget));
}

function startHero() {
  if (hero || heroLoading) { heroVisibility(); return heroLoading; }
  const canvas = $('#heroCanvas');
  heroLoading = import('./hero3d.js')
    .then((m) => {
      hero = m.createHero(canvas, {
        config: heroConfig(),
        onProgress: (p) => setLoader(p),
        layoutHints: () => {
          const c = canvas.getBoundingClientRect();
          const copy = $('.hero-copy').getBoundingClientRect();
          const lead = $('.hero-lead').getBoundingClientRect();
          const cfg = $('.configurator').getBoundingClientRect();
          return { top: copy.bottom - c.top, bottom: cfg.top - c.top, copyRight: lead.right - c.left, navBottom: $('#nav').offsetHeight + 10, dockTop: cfg.top - c.top };
        },
      });
      heroVisibility();
      document.fonts?.ready.then(() => hero.layout());
      addEventListener('resize', () => hero.layout());
      canvas.addEventListener('pointerdown', () => $('.hero-hint')?.classList.add('gone'), { once: true });
      return hero;
    })
    .catch((err) => {
      console.warn('3D hero unavailable, using still image.', err);
      canvas.replaceWith(Object.assign(document.createElement('img'), { src: 'img/hero-classic.webp', alt: '', className: 'hero-fallback', style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:60% 70%;padding:12vh 4vw 0 30vw' }));
      setLoader(1);
    });
  return heroLoading;
}

function heroVisibility() {
  if (!hero) return;
  const run = state.view === 'immersive' && heroVisible && !document.hidden && $('#vehicleModal').hidden;
  run ? hero.resume() : hero.pause();
}

// ============================================================ loader
let loaderDone = false, loaderShown = 0;
function setLoader(p) {
  const target = Math.max(loaderShown, Math.min(1, p));
  loaderShown = target;
  $('#loaderBar').style.strokeDasharray = `${target * 75} 100`;
  $('#loaderNum').textContent = Math.round(target * 200);
  if (target >= 1) finishLoader();
}
function finishLoader() {
  if (loaderDone) return;
  loaderDone = true;
  setTimeout(() => {
    $('#loader')?.classList.add('done');
    document.body.classList.add('is-ready');
  }, 350);
}
function initLoader() {
  const g = $('.lg-ticks');
  let lines = '';
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI * 1.5;
    const r0 = i % 5 === 0 ? 64 : 70, r1 = 76;
    lines += `<line x1="${100 + Math.cos(a) * r0}" y1="${100 + Math.sin(a) * r0}" x2="${100 + Math.cos(a) * r1}" y2="${100 + Math.sin(a) * r1}"/>`;
  }
  g.innerHTML = lines;
  if (state.view !== 'immersive') { $('#loader').classList.add('done'); document.body.classList.add('is-ready'); loaderDone = true; return; }
  // fake progress while assets stream in; real progress comes from the 3D scene
  const t0 = performance.now();
  const tick = () => {
    if (loaderDone) return;
    const k = Math.min(0.85, (performance.now() - t0) / 2200);
    setLoader(k * 0.9);
    requestAnimationFrame(tick);
  };
  tick();
  setTimeout(finishLoader, 6000); // never block the page
}

// ============================================================ view toggle
function setView(v, user = false) {
  state.view = v;
  root.dataset.view = v;
  try { localStorage.setItem('novara:view', v); } catch { /* ignore */ }
  $$('[data-view-btn]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.viewBtn === v));
  $('meta[name=theme-color]').content = v === 'classic' ? '#ffffff' : '#05060a';
  if (v === 'immersive') {
    startHero();
    if (!loaderDone) finishLoader();
    document.body.classList.add('is-ready');
  }
  heroVisibility();
  observeReveals(document);
  drawSpin(true);
  if (user) window.scrollTo({ top: 0, behavior: 'auto' });
  window.dispatchEvent(new Event('resize'));
}

// ============================================================ spotlight 360° (scroll-scrubbed image sequence)
const spin = { frames: [], loaded: 0, current: -1, drag: 0 };
function preloadSpin() {
  if (spin.frames.length) return;
  for (let i = 0; i < SPOTLIGHT.frames; i++) {
    const im = new Image();
    im.decoding = 'async';
    im.src = `img/spin/${SPOTLIGHT.id}/${String(i).padStart(2, '0')}.webp`;
    im.onload = () => { spin.loaded++; if (spin.current < 0 || !spin.frames[spin.current]?.complete || spin.loaded === SPOTLIGHT.frames) drawSpin(true); };
    spin.frames.push(im);
  }
}
function spinProgress() {
  const sec = $('#spotlight');
  const r = sec.getBoundingClientRect();
  const total = sec.offsetHeight - innerHeight;
  return total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
}
function drawSpin(force = false) {
  if (!spin.frames.length) return;
  const n = SPOTLIGHT.frames;
  const p = state.view === 'immersive' ? spinProgress() : 0;
  let idx = Math.round(p * n * 1.0 + spin.drag) % n;
  if (idx < 0) idx += n;
  if (!force && idx === spin.current) return;
  const im = spin.frames[idx];
  if (!im.complete || !im.naturalWidth) return;
  spin.current = idx;
  const cv = $('#spinCanvas');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(im, 0, 0, cv.width, cv.height);
  $('#spinDeg').textContent = Math.round((idx / n) * 360) + '°';
  $('#spinBar').style.setProperty('--p', (p * 100).toFixed(1) + '%');
  $('.spot-bg span').style.setProperty('--bgx', `${(0.5 - p) * 30}%`);
}
function bindSpin() {
  const cv = $('#spinCanvas');
  let startX = null, startDrag = 0;
  cv.addEventListener('pointerdown', (e) => { startX = e.clientX; startDrag = spin.drag; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (startX == null) return; spin.drag = startDrag + (e.clientX - startX) / 18; drawSpin(); });
  cv.addEventListener('pointerup', () => { startX = null; });
  cv.style.cursor = 'grab';
  cv.style.touchAction = 'pan-y';
}

// ============================================================ counters
function countUp(el) {
  if (el._counted) return;
  el._counted = true;
  const to = parseFloat(el.dataset.count), dec = +(el.dataset.decimals || 0);
  if (reducedMotion) return;
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 1600), e = 1 - Math.pow(1 - k, 4);
    el.textContent = (to * e).toFixed(dec);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ============================================================ reveals, nav, cursor, magnetic
let revealIO;
function observeReveals(scope) {
  revealIO = revealIO || new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      $$('[data-count]', en.target).forEach(countUp);
      revealIO.unobserve(en.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  $$('.reveal:not(.in)', scope).forEach((el) => revealIO.observe(el));
}

function bindNav() {
  const nav = $('#nav');
  let lastY = scrollY;
  const onScroll = () => {
    const y = scrollY;
    nav.classList.toggle('scrolled', y > 24);
    nav.classList.toggle('hide', state.view === 'immersive' && y > lastY && y > innerHeight * 0.9 && !document.body.classList.contains('menu-open'));
    lastY = y;
    // hero parallax / fade
    if (state.view === 'immersive') {
      const k = Math.min(1, y / innerHeight);
      const c = $('#heroCanvas');
      if (c) { c.style.transform = `translateY(${k * 18}%)`; c.style.opacity = String(1 - k * 0.85); }
      drawSpin();
    }
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  $('#menuBtn').addEventListener('click', () => {
    const open = document.body.classList.toggle('menu-open');
    $('#menuBtn').setAttribute('aria-expanded', open);
  });
  $$('#navLinks a').forEach((a) => a.addEventListener('click', () => { document.body.classList.remove('menu-open'); $('#menuBtn').setAttribute('aria-expanded', false); }));

  const links = $$('#navLinks a');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['inventory', 'finance', 'trade', 'why', 'visit'].forEach((id) => io.observe($('#' + id)));

  // hero visibility → pause 3D when off-screen
  new IntersectionObserver(([en]) => { heroVisible = en.isIntersecting; heroVisibility(); }).observe($('.hero'));
  document.addEventListener('visibilitychange', heroVisibility);
  // spotlight preload when near
  new IntersectionObserver(([en]) => { if (en.isIntersecting) preloadSpin(); }, { rootMargin: '900px 0px' }).observe($('#spotlight'));
}

function bindCursor() {
  if (!finePointer || reducedMotion) return;
  const cur = $('.cursor');
  const dot = $('.cursor-dot'), ring = $('.cursor-ring');
  let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
  addEventListener('pointermove', (e) => {
    x = e.clientX; y = e.clientY;
    cur.classList.add('on');
    const tgt = e.target;
    cur.classList.toggle('is-hover', !!tgt.closest('a, button, [data-open], select, label'));
    cur.classList.toggle('is-drag', !!tgt.closest('#heroCanvas, #spinCanvas, #mCanvas'));
  }, { passive: true });
  document.addEventListener('pointerleave', () => cur.classList.remove('on'));
  const loop = () => {
    rx += (x - rx) * 0.18; ry += (y - ry) * 0.18;
    dot.style.transform = `translate(${x}px, ${y}px)`;
    ring.style.transform = `translate(${rx}px, ${ry}px)`;
    requestAnimationFrame(loop);
  };
  loop();
}

function bindMagnetic() {
  if (!finePointer || reducedMotion) return;
  $$('.magnetic').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      if (state.view !== 'immersive') return;
      const r = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.22}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

// ============================================================ boot
function boot() {
  $('#year').textContent = new Date().getFullYear();
  $$('[data-view-btn]').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.viewBtn === state.view);
    b.addEventListener('click', () => { if (state.view !== b.dataset.viewBtn) setView(b.dataset.viewBtn, true); });
  });
  $('#langBtn').addEventListener('click', () => { state.lang = state.lang === 'en' ? 'es' : 'en'; store.set('lang', state.lang); applyI18n(); });

  bindInventory();
  bindModal();
  bindCalc();
  bindForms();
  bindConfigurator();
  bindNav();
  bindSpin();
  bindCursor();
  bindMagnetic();
  initLoader();
  applyI18n();
  syncFilterInputs();
  updateFavUI();
  observeReveals(document);
  if (state.view === 'immersive') startHero();
  addEventListener('resize', () => drawSpin(true));
}

boot();
if (location.hostname === 'localhost') window.__novara = { get hero() { return hero; }, state };
