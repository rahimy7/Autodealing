import { INVENTORY, INVENTORY_ERROR, DEALER, SHOWCASE, SHOWROOM, CATEGORIES, SPOTLIGHT } from './data.js';
import { STRINGS } from './i18n.js';
import { createCurtain } from './curtain.js';

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

const byId = Object.fromEntries([...SHOWCASE, ...INVENTORY].map((v) => [v.id, v]));
const t = (key, vars) => {
  let s = STRINGS[state.lang][key] ?? STRINGS.en[key] ?? key;
  if(typeof s==='string') s=s.replace(/Premier Line Motors|Premier/g,match=>match==='Premier'?DEALER.name.split(' ')[0]:DEALER.name);
  if (vars && typeof s === 'string') for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
};
const L = (o) => (o && typeof o === 'object' ? o[state.lang] ?? o.en : o);
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const askingPrice = (v) => v.priceOnRequest ? (state.lang === 'es' ? 'Consultar precio' : 'Contact for price') : usd(v.price);
const num = (n) => Math.round(n).toLocaleString('en-US');
const payment = (principal, apr, months) => {
  if (principal <= 0) return 0;
  const r = apr / 100 / 12;
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
};
const estMonthly = (price) => payment(price * 0.9, 6.9, 72);
const title = (v) => `${v.year} ${v.make} ${v.model}`;
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const escaped = value => Array.isArray(value) ? value.map(escaped) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,escaped(v)])) : typeof value === 'string' ? escapeHTML(value) : value;
const img = (id, angle = 'front') => {
  const v = byId[id];
  if (v?.live) { const n = typeof angle === 'number' ? angle : ({front:0,side:1,rear:2}[angle] ?? 0); return v.photos[n] || v.photos[0] || '/img/vehicle-placeholder.svg'; }
  return `img/cars/${id}-${angle}.webp`;
};

// ============================================================ i18n
function applyI18n() {
  root.lang = state.lang;
  document.title = t('meta.title');
  $$('[data-i18n]').forEach((el) => { const v = t(el.dataset.i18n); if (typeof v === 'string') el.textContent = v; });
  $$('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $$('[data-i18n-label]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nLabel)));
  $('#langBtn').textContent = state.lang === 'en' ? 'ES' : 'EN';
  renderMarquee();
  renderTypes();
  renderChips();
  renderInventory();
  renderConfigurator(false);
  fillSelects();
  updateCount();
  if (currentVehicle) fillModal(currentVehicle, true);
  if (currentVehicle && pane === 'form') renderLeadForm(Object.fromEntries(new FormData($('#mForm'))));
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

// Only the body styles that have a vehicle for sale.
const activeCategories = () => CATEGORIES.filter((c) => catCount(c.id) > 0);

// Each tile shows a real unit of its body style: the featured one, else the newest.
function renderTypes() {
  $('#typeGrid').innerHTML = activeCategories().map((c, i) => {
    const n = catCount(c.id);
    const cover = INVENTORY.find((v) => v.cats.includes(c.id) && v.featured) || INVENTORY.find((v) => v.cats.includes(c.id));
    return `
    <button type="button" class="type-card photo reveal" style="--d:${i * 0.06}s" data-cat="${c.id}">
      <span class="arrow"><svg class="i"><use href="#i-arrow"/></svg></span>
      <span><h3>${t('cat.' + c.id)}</h3><small>${n === 1 ? t('types.count1') : t('types.count', { n })}</small></span>
      <img src="${img(cover.id)}" alt="" loading="lazy" width="1200" height="720">
    </button>`;
  }).join('');
  observeReveals($('#typeGrid'));
}

// The classic view's strip names the makes actually on the lot.
function renderBrands() {
  const inner = $('.brand-strip-inner');
  if (!inner) return;
  const makes = [...new Set(INVENTORY.map((v) => String(v.make).toUpperCase()))].sort();
  $$('.bs-make', inner).forEach((e) => e.remove());
  inner.append(...makes.map((m) => Object.assign(document.createElement('span'), { className: 'bs-make', textContent: m })));
  $('.brand-strip').style.visibility = makes.length ? '' : 'hidden';
}

function renderChips() {
  const cats = ['all', ...activeCategories().map((c) => c.id), ...(catCount('van') ? ['van'] : [])];
  $('#fType').innerHTML = cats.map((c) => `
    <button type="button" class="chip" data-chip="${c}" aria-pressed="${state.filters.cat === c}">${t('cat.' + c)} <small>${catCount(c)}</small></button>`).join('');
}

function fillSelects() {
  const keepType = $('#hcType').value, keepMake = $('#hcMake').value, keepTd = $('#tdVehicle').value;
  $('#hcType').innerHTML = `<option value="all">${t('hc.any')}</option>` + activeCategories().map((c) => `<option value="${c.id}">${t('cat.' + c.id)}</option>`).join('');
  const makes = [...new Set(INVENTORY.map((v) => v.make))].sort();
  $('#hcMake').innerHTML = `<option value="">${t('hc.any')}</option>` + makes.map((m) => `<option>${escapeHTML(m)}</option>`).join('');
  $('#tdVehicle').innerHTML = `<option value="">${t('form.any')}</option>` + INVENTORY.map((v) => `<option value="${v.id}">${escapeHTML(title(v))}</option>`).join('');
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
    priceAsc: (a, b) => Number(a.priceOnRequest) - Number(b.priceOnRequest) || a.price - b.price,
    priceDesc: (a, b) => Number(a.priceOnRequest) - Number(b.priceOnRequest) || b.price - a.price,
    milesAsc: (a, b) => a.miles - b.miles,
    yearDesc: (a, b) => b.year - a.year,
  };
  return list.sort(sorters[f.sort] || sorters.featured);
}

function cardHTML(v, i) {
  v = escaped(v);
  const drop = v.priceOnRequest ? 0 : v.msrp - v.price;
  const fuelIcon = v.fuel === 'electric' ? 'i-bolt' : 'i-fuel';
  const badges = [`<span class="badge ${v.condition}">${t('cond.' + v.condition)}</span>`];
  if (v.demo) badges.push(`<span class="badge">${state.lang==='es'?'Demo':'Demo'}</span>`);
  if (v.status==='reserved') badges.push(`<span class="badge">${state.lang==='es'?'Reservado':'Reserved'}</span>`);
  if (drop > 0) badges.push(`<span class="badge drop">−${usd(drop)}</span>`);
  return `
  <article class="car-card entering" data-id="${v.id}" style="--i:${i}">
    <div class="cc-media" data-open="${v.id}" role="button" tabindex="0" aria-label="${t('card.view')}: ${title(v)}">
      <div class="cc-badges">${badges.join('')}</div>
      <img class="main" src="${img(v.id)}" alt="${title(v)} — ${L(v.ext)}" loading="lazy" width="1200" height="720">
    </div>
    <button type="button" class="cc-fav" data-fav="${v.id}" aria-pressed="${state.favs.has(v.id)}" aria-label="${t('card.save')}: ${title(v)}"><svg class="i"><use href="#i-heart"/></svg></button>
    <div class="cc-body">
      <div class="cc-top"><span>${v.year} · ${v.make}</span><span>#${v.stock}</span></div>
      <h3 class="cc-title">${v.model}<small>${v.trim} · ${L(v.ext)}</small></h3>
      <div class="cc-specs">
        <span><svg class="i"><use href="#i-road"/></svg>${num(v.miles)} ${t('card.miles')}</span>
        <span><svg class="i"><use href="#i-drive"/></svg>${v.drive}</span>
        <span><svg class="i"><use href="#i-gauge"/></svg>${v.hp ? `${v.hp} hp` : '—'}</span>
        <span><svg class="i"><use href="#${fuelIcon}"/></svg>${v.economy || '—'}</span>
      </div>
      <div class="cc-foot">
        <div class="cc-price">
          <small>${t('card.price')}</small>
          <strong>${askingPrice(v)}</strong>${drop > 0 ? `<s>${usd(v.msrp)}</s>` : ''}
          <em>${v.priceOnRequest ? '' : `${t('card.est')} ${usd(estMonthly(v.price))}${t('card.mo')}`}</em>
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
  if (INVENTORY_ERROR) $('#invEmpty').textContent = state.lang === 'es' ? 'No se pudo cargar el inventario. Recarga la página o contáctanos.' : 'Inventory is temporarily unavailable. Reload or contact us.';
  updateCount(list.length);
  requestAnimationFrame(() => {
    $$('.car-card', grid).forEach((c, i) => setTimeout(() => c.classList.remove('entering'), reducedMotion ? 0 : 60 * Math.min(i, 8)));
  });
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

// ============================================================ modal
let currentVehicle = null, lastFocus = null, viewer = null, viewerReady = null, modalTab = 'front', curtain = null;

function syncCurtain(url) {
  if (!url) return curtain?.hide();
  curtain ||= createCurtain($('#mStage'));
  curtain.show(url, {
    slider: t('curtain.slider'), group: t('curtain.group'), original: t('curtain.original'),
    backdrops: { studio: t('curtain.studio'), showroom: t('curtain.showroom'), night: t('curtain.night'), white: t('curtain.white') },
  });
}

function fillModal(v, keepTab = false) {
  $('#mKicker').textContent = `${v.year} · ${t('cond.' + v.condition)} · #${v.stock}`;
  $('#mTitle').textContent = `${v.make} ${v.model}`;
  $('#mTrim').textContent = [v.trim, L(v.ext)].filter(Boolean).join(' · ');
  $('#mPrice').textContent = askingPrice(v);
  $('#mPayment').hidden = v.priceOnRequest;
  $('#mMsrp').textContent = !v.priceOnRequest && v.msrp > v.price ? `${t('card.msrp')} ${usd(v.msrp)}` : '';
  $('#mMonthly').textContent = v.priceOnRequest ? '' : `${t('card.est')} ${usd(estMonthly(v.price))}${t('card.mo')}`;
  const specs = [
    ['modal.engine', v.engine], ['modal.power', v.hp && `${v.hp} hp`], ['modal.drive', v.drive], ['modal.trans', L(v.trans)],
    ['modal.economy', v.economy], ['modal.zero60', v.zero60 && `${v.zero60} s`], ['modal.miles', v.miles && `${num(v.miles)} mi`],
    ['modal.tow', v.towing], ['modal.seats', v.seats], ['modal.ext', L(v.ext)], ['modal.int', L(v.int)], ['modal.vin', v.vin],
  ].filter(([, val]) => val);
  $('#mSpecs').innerHTML = specs.map(([k, val]) => `<div><dt>${t(k)}</dt><dd>${escapeHTML(val)}</dd></div>`).join('');
  $('#mDesc').textContent = L(v.desc);
  $('#mFav').setAttribute('aria-pressed', state.favs.has(v.id));
  const tabs = v.live ? (v.photos.length ? v.photos.map((_, i) => 'photo-' + i) : ['photo-0']) : ['front', 'side', 'rear'];
  $('#mThumbs').classList.toggle('photo-gallery', v.live === true);
  $('#mThumbs').innerHTML = tabs.map((a) => `<button type="button" role="tab" data-tab="${a}" aria-selected="false" aria-label="${t('modal.gallery')} ${a.startsWith('photo-') ? Number(a.slice(6)) + 1 : a}"><img loading="lazy" src="${img(v.id, a.startsWith('photo-') ? Number(a.slice(6)) : a)}" alt=""></button>`).join('')
    + (v.live ? '' : `<button type="button" role="tab" class="t3d" data-tab="3d" aria-selected="false"><span>360°<small>${t('modal.3d')}</small></span></button>`);
  showTab(keepTab ? modalTab : (v.live ? 'photo-0' : 'front'));
  prepareShare(v);
}

function showTab(tab) {
  const v = currentVehicle;
  modalTab = tab;
  $$('#mThumbs [data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
  const imgEl = $('#mImg'), cv = $('#mCanvas');
  $('#mExpand').hidden = tab === '3d';
  if (tab === '3d') {
    syncCurtain(null);
    imgEl.hidden = true; cv.hidden = false; $('#mHint').hidden = false;
    $('#mLoading').hidden = false;
    viewerReady = viewerReady || import('./viewer3d.js').then((m) => (viewer = m.createViewer(cv)));
    viewerReady.then(() => { viewer.show(v.config); $('#mLoading').hidden = true; }).catch(() => { $('#mLoading').hidden = true; showTab('front'); });
  } else {
    if (viewer) viewer.hide();
    cv.hidden = true; $('#mHint').hidden = true; $('#mLoading').hidden = true; imgEl.hidden = false;
    imgEl.src = img(v.id, tab.startsWith('photo-') ? Number(tab.slice(6)) : tab);
    imgEl.alt = `${title(v)} — ${tab}`;
    imgEl.style.animation = 'none'; void imgEl.offsetWidth; imgEl.style.animation = '';
    syncCurtain(tab.startsWith('photo-') ? v.cutouts?.[Number(tab.slice(6))] : null);
  }
}

// The address bar carries the open vehicle (/?v=<id>), the same link the share buttons send.
function syncUrl(v) {
  const u = new URL(location.href);
  if (v) u.searchParams.set('v', v.id);
  else { u.searchParams.delete('v'); u.searchParams.delete('lang'); }
  history.replaceState(history.state, '', u.pathname + u.search + u.hash);
}

function openVehicle(id, trigger) {
  const v = byId[id];
  if (!v) return;
  currentVehicle = v;
  lastFocus = trigger || document.activeElement;
  pane = 'detail';
  closeLightbox({ sync: false });
  showPane('detail');
  fillModal(v);
  const m = $('#vehicleModal');
  m.hidden = false;
  document.body.style.overflow = 'hidden';
  hero?.pause();
  syncUrl(v);
  setTimeout(() => $('.modal-close', m).focus(), 50);
}

function closeModal() {
  const m = $('#vehicleModal');
  if (m.hidden) return;
  closeLightbox({ sync: false });
  m.hidden = true;
  document.body.style.overflow = '';
  if (viewer) viewer.hide();
  curtain?.hide();
  currentVehicle = null;
  syncUrl(null);
  heroVisibility();
  lastFocus?.focus?.({ preventScroll: true });
}

// ============================================================ full-screen photos
// Tapping the vehicle's photo (or its expand button) opens every photo of the unit over the whole
// screen: arrows, swipe, the keyboard and a strip of thumbnails move between them.
const lb = { list: [], i: 0, from: null };
const ANGLES = ['front', 'side', 'rear'];
const galleryOf = (v) => (v.live ? (v.photos.length ? v.photos : [img(v.id, 0)]) : ANGLES.map((a) => img(v.id, a)));
const tabAt = (v, i) => (v.live ? 'photo-' + i : ANGLES[i]);

function openLightbox(trigger) {
  const v = currentVehicle;
  if (!v || modalTab === '3d') return;
  lb.list = galleryOf(v);
  const at = modalTab.startsWith('photo-') ? Number(modalTab.slice(6)) : ANGLES.indexOf(modalTab);
  lb.i = Math.min(Math.max(at, 0), lb.list.length - 1);
  lb.from = trigger || document.activeElement;
  $('#lbThumbs').innerHTML = lb.list.map((src, i) => `<button type="button" tabindex="-1" data-lb="${i}" aria-label="${t('modal.gallery')} ${i + 1}"><img loading="lazy" src="${src}" alt=""></button>`).join('');
  $('#lightbox').hidden = false;
  paintLightbox(0);
  $('#lbClose').focus({ preventScroll: true });
}

function paintLightbox(dir) {
  const v = currentVehicle, n = lb.list.length, el = $('#lbImg'), src = lb.list[lb.i];
  $('#lightbox').classList.toggle('single', n < 2);
  $('#lbCount').textContent = `${lb.i + 1} / ${n}`;
  $('#lbTitle').textContent = title(v);
  $$('#lbThumbs [data-lb]').forEach((b) => b.setAttribute('aria-selected', Number(b.dataset.lb) === lb.i));
  $('#lbThumbs [aria-selected=true]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  el.alt = `${title(v)} — ${lb.i + 1}/${n}`;
  if (el.getAttribute('src') !== src) {
    $('#lbSpin').hidden = false;
    el.style.opacity = '0';
    el.src = src;
  }
  el.style.setProperty('--from', dir ? dir * 48 + 'px' : '0px');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  if (el.complete && el.naturalWidth) lightboxLoaded();
  // The neighbours load while this one is looked at.
  if (n > 1) for (const j of [lb.i + 1, lb.i - 1]) new Image().src = lb.list[(j + n) % n];
}

function lightboxLoaded() {
  $('#lbSpin').hidden = true;
  $('#lbImg').style.opacity = '';
}

function lightboxGo(delta) {
  const n = lb.list.length;
  if (n < 2 || !delta) return;
  lb.i = (lb.i + delta + n) % n;
  paintLightbox(Math.sign(delta));
}

function closeLightbox({ sync = true } = {}) {
  const box = $('#lightbox');
  if (box.hidden) return;
  box.hidden = true;
  const v = currentVehicle;
  // The detail view comes back on the photo that was last seen.
  if (sync && v) {
    const tab = tabAt(v, lb.i);
    if (tab !== modalTab) { showTab(tab); $('#mThumbs [aria-selected=true]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }
  }
  lb.from?.focus?.({ preventScroll: true });
}

function bindLightbox() {
  const box = $('#lightbox'), stage = $('#lbStage'), pic = $('#lbImg');
  $('#mStage').addEventListener('click', (e) => { if (e.target === $('#mImg')) openLightbox(e.target); });
  $('#mExpand').addEventListener('click', (e) => openLightbox(e.currentTarget));
  $('#lbClose').addEventListener('click', () => closeLightbox());
  $('#lbPrev').addEventListener('click', () => lightboxGo(-1));
  $('#lbNext').addEventListener('click', () => lightboxGo(1));
  $('#lbThumbs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lb]');
    if (b) lightboxGo(Number(b.dataset.lb) - lb.i);
  });
  pic.addEventListener('load', lightboxLoaded);
  pic.addEventListener('error', lightboxLoaded);

  // Swipe: the photo follows the finger and a long enough drag turns to the next one.
  let x0 = null, y0 = 0, dx = 0, dragged = false;
  const release = () => { x0 = null; pic.style.transition = ''; pic.style.transform = ''; };
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; dragged = false;
  });
  stage.addEventListener('pointermove', (e) => {
    if (x0 == null) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) > 8) dragged = true;
    if (dragged && lb.list.length > 1) { pic.style.transition = 'none'; pic.style.transform = `translateX(${dx}px)`; }
  });
  stage.addEventListener('pointerup', (e) => {
    if (x0 == null) return;
    const far = Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - y0) * 1.5;
    const moved = dx;
    release();
    if (far) lightboxGo(moved < 0 ? 1 : -1);
  });
  stage.addEventListener('pointercancel', release);
  // A tap on the dark area around the photo closes it; the end of a drag does not.
  // The element fills the stage, so "on the photo" is worked out from the picture's own shape.
  const onPhoto = (e) => {
    const r = pic.getBoundingClientRect(), pad = parseFloat(getComputedStyle(pic).paddingLeft) || 0;
    if (!pic.naturalWidth) return false;
    const k = Math.min((r.width - 2 * pad) / pic.naturalWidth, r.height / pic.naturalHeight);
    return Math.abs(e.clientX - (r.left + r.width / 2)) <= (pic.naturalWidth * k) / 2 && Math.abs(e.clientY - (r.top + r.height / 2)) <= (pic.naturalHeight * k) / 2;
  };
  stage.addEventListener('click', (e) => {
    if (dragged) { dragged = false; return; }
    if (!e.target.closest('button') && !onPhoto(e)) closeLightbox();
  });

  // Captured, so Escape closes only the photos and not the vehicle behind them.
  document.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    const keys = {
      ArrowRight: () => lightboxGo(1), ArrowLeft: () => lightboxGo(-1),
      Home: () => lightboxGo(-lb.i), End: () => lightboxGo(lb.list.length - 1 - lb.i),
      Escape: () => closeLightbox(),
    };
    if (keys[e.key]) { e.preventDefault(); e.stopPropagation(); keys[e.key](); return; }
    if (e.key === 'Tab') {
      e.stopPropagation();
      e.preventDefault();
      const f = $$('#lbClose, #lbPrev, #lbNext', box).filter((x) => x.offsetParent !== null);
      const at = f.indexOf(document.activeElement);
      f[(at + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
    }
  }, true);
}

// ============================================================ vehicle requests (financing, test drive, visit)
// Each one becomes an inquiry in the panel, the sales app and Omnicanal's CRM (/api/leads).
// Choices are sent in Spanish, the team's language, whatever language the visitor reads.
const choice = (value, en = value, es = value) => ({ value, en, es });
const LEAD_CHOICES = {
  time: [['10:00', '10:00 AM'], ['11:30', '11:30 AM'], ['13:00', '1:00 PM'], ['14:30', '2:30 PM'], ['16:00', '4:00 PM'], ['17:30', '5:30 PM']].map(([v, label]) => choice(v, label, label)),
  topic: [choice('Ver el vehículo', 'See the vehicle'), choice('Hablar de financiamiento', 'Talk about financing'), choice('Tasar mi vehículo (trade-in)', 'Appraise my trade-in'), choice('Otro', 'Something else')],
  down: [choice('Sin pago inicial', 'No down payment'), choice('Menos de $1,000', 'Under $1,000'), choice('$1,000 – $3,000'), choice('$3,000 – $5,000'), choice('Más de $5,000', 'Over $5,000')],
  employment: [choice('Empleado a tiempo completo', 'Full-time employee'), choice('Empleado a tiempo parcial', 'Part-time employee'), choice('Trabajo por cuenta propia', 'Self-employed'), choice('Jubilado', 'Retired'), choice('Otro', 'Other')],
  income: [choice('Menos de $2,000', 'Under $2,000'), choice('$2,000 – $3,500'), choice('$3,500 – $5,000'), choice('Más de $5,000', 'Over $5,000')],
  credit: [choice('Excelente (720+)', 'Excellent (720+)'), choice('Bueno (660–719)', 'Good (660–719)'), choice('Regular (600–659)', 'Fair (600–659)'), choice('Bajo (menos de 600)', 'Poor (under 600)'), choice('Sin historial de crédito', 'No credit history'), choice('No sé', 'Not sure')],
};
const LEAD_FORMS = {
  finance: ['name', 'phone', 'email', 'down', 'employment', 'income', 'credit', 'msg'],
  testdrive: ['name', 'phone', 'email', 'date', 'time', 'msg'],
  visit: ['name', 'phone', 'email', 'date', 'time', 'topic', 'msg'],
};
let pane = 'detail', leadKind = 'finance', leadContact = {};
const localDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function leadField(name) {
  const caption = (key, optional) => `<span>${t(key)}${optional ? ` <small>${t('lead.optional')}</small>` : ''}</span>`;
  if (name === 'name') return `<label>${caption('form.name')}<input name="name" autocomplete="name" maxlength="160" required></label>`;
  if (name === 'phone') return `<label>${caption('form.phone')}<input name="phone" type="tel" autocomplete="tel" maxlength="40" required></label>`;
  if (name === 'email') return `<label class="span-2">${caption('form.email', true)}<input name="email" type="email" autocomplete="email" maxlength="200"></label>`;
  if (name === 'date') return `<label>${caption('form.date')}<input name="date" type="date" min="${localDate()}" required></label>`;
  if (name === 'msg') return `<label class="span-2">${caption('form.msg', true)}<textarea name="msg" rows="3" maxlength="3000"></textarea></label>`;
  const required = name === 'time';
  const options = LEAD_CHOICES[name].map((c) => `<option value="${escapeHTML(c.value)}">${escapeHTML(c[state.lang] ?? c.en)}</option>`).join('');
  return `<label${name === 'topic' ? ' class="span-2"' : ''}>${caption(name === 'time' ? 'form.time' : 'lead.' + name, !required)}<select name="${name}"${required ? ' required' : ''}>${required ? '' : `<option value="">${t('lead.choose')}</option>`}${options}</select></label>`;
}

function renderLeadForm(values = {}) {
  const v = currentVehicle, form = $('#mForm');
  $('#mFormTitle').textContent = t(`lead.${leadKind}.title`);
  $('#mFormLead').textContent = t(`lead.${leadKind}.lead`);
  $('#mFormSubmit').textContent = t(`lead.${leadKind}.submit`);
  $('#mFormFine').textContent = leadKind === 'finance' ? `${t('lead.finance.fine')} ${t('form.consent')}` : t('form.consent');
  $('#mMiniImg').src = img(v.id, v.live ? 0 : 'front');
  $('#mMiniTitle').textContent = title(v);
  $('#mMiniPrice').textContent = askingPrice(v);
  $('#mFormFields').innerHTML = LEAD_FORMS[leadKind].map(leadField).join('');
  for (const [k, val] of Object.entries(values)) if (val && form.elements[k]) form.elements[k].value = val;
}

function showPane(next) {
  // The panel keeps the tallest height it has had for this vehicle, so it never jumps when shorter.
  const panel = $('#vehicleModal .modal-panel');
  if (next === 'detail' && pane === 'detail') panel.style.minHeight = '';
  else if (!$('#vehicleModal').hidden) panel.style.minHeight = Math.max(parseFloat(panel.style.minHeight) || 0, panel.offsetHeight) + 'px';
  pane = next;
  $('#mDetail').hidden = next !== 'detail';
  $('#mForm').hidden = next !== 'form';
  $('#mDone').hidden = next !== 'done';
  $('#vehicleModal .m-grid').classList.toggle('is-request', next !== 'detail');
  panel.scrollTop = 0;
}

function openLeadForm(kind) {
  leadKind = LEAD_FORMS[kind] ? kind : 'finance';
  renderLeadForm(leadContact);
  showPane('form');
  const first = $$('#mForm input, #mForm select').find((el) => !el.value) || $('#mForm [name=name]');
  setTimeout(() => first.focus({ preventScroll: true }), 60);
}

function validLead(form) {
  const f = form.elements;
  let first = null, why = '';
  const bad = (el, reason = '') => { el.setAttribute('aria-invalid', 'true'); if (!first) { first = el; why = reason; } };
  $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
  if (!f.name.value.trim()) bad(f.name);
  if (f.phone.value.replace(/\D/g, '').length < 7) bad(f.phone);
  if (f.email.value.trim() && !/^\S+@\S+\.\S+$/.test(f.email.value.trim())) bad(f.email);
  if (f.date) {
    const d = f.date.value;
    if (!d || d < localDate()) bad(f.date);
    else if (new Date(d + 'T12:00').getDay() === 0) bad(f.date, t('lead.sunday'));
  }
  if (first) { first.focus(); toast(why || t('lead.check')); }
  return !first;
}

function leadWhen({ date, time }) {
  if (!date) return '';
  const day = new Date(date + 'T12:00').toLocaleDateString(state.lang === 'es' ? 'es-US' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const hour = LEAD_CHOICES.time.find((c) => c.value === time)?.en || time;
  if (!hour) return day;
  return `${day} ${state.lang === 'es' && hour.startsWith('1:') ? 'a la' : t('lead.at')} ${hour}`;
}

async function submitLead(e) {
  e.preventDefault();
  const form = e.currentTarget, v = currentVehicle;
  if (!v || !validLead(form)) return;
  const body = Object.fromEntries(new FormData(form));
  body.kind = leadKind;
  // Concept cars in the 3D showroom are not in the managed inventory: name them in the message.
  if (v.live) body.vehicle = v.id;
  else body.msg = [`${title(v)} (#${v.stock})`, body.msg].filter(Boolean).join('\n');
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  try {
    const r = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || ''), { shown: r.status < 500 && !!data.error });
    leadContact = { name: body.name, phone: body.phone, email: body.email };
    $('#toast').classList.remove('show');
    $('#mDoneTitle').textContent = t('lead.done');
    $('#mDoneText').textContent = t(`lead.${leadKind}.done`, { when: leadWhen(body) });
    showPane('done');
    $('#mDone').focus({ preventScroll: true });
  } catch (err) {
    toast(err.shown ? err.message : t('lead.error'));
  } finally {
    btn.disabled = false;
  }
}

// ============================================================ sharing
// On a phone the visitor's share sheet sends a picture of the vehicle with its title and price
// printed on it, and the message carries them too. Elsewhere WhatsApp opens with the message and
// the link, whose preview shows the photo and price (server/share.js).
const coarsePointer = matchMedia('(pointer: coarse)').matches;
const vehicleLink = (v) => `${location.origin}/?v=${encodeURIComponent(v.id)}${state.lang === 'en' ? '&lang=en' : ''}`;

function shareText(v) {
  const es = state.lang === 'es';
  const facts = [v.miles ? `${num(v.miles)} ${es ? 'millas' : 'miles'}` : '', v.drive, L(v.ext)].filter(Boolean);
  return [
    `*${[title(v), v.trim].filter(Boolean).join(' ')}*`,
    `${es ? 'Precio' : 'Price'}: ${askingPrice(v)}`,
    facts.join(' · '),
    `${DEALER.name} · ${DEALER.phone}`,
    vehicleLink(v),
  ].filter(Boolean).join('\n');
}

const loadImage = (src) => new Promise((resolve, reject) => {
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = reject;
  im.src = src;
});

function fitText(g, text, x, y, maxWidth, size, weight, minSize = Math.round(size * 0.7)) {
  let s = size;
  g.font = `${weight} ${s}px Manrope, system-ui, sans-serif`;
  while (s > minSize && g.measureText(text).width > maxWidth) { s -= 2; g.font = `${weight} ${s}px Manrope, system-ui, sans-serif`; }
  let out = text;
  while (out.length > 1 && g.measureText(out).width > maxWidth) out = out.slice(0, -2) + '…';
  g.fillText(out, x, y);
}

// A square picture: the vehicle's first photo above a band with its title, price and the dealer.
async function shareImage(v) {
  const W = 1080, PH = 780, H = 1080, pad = 56;
  const [photo, logo] = await Promise.all([
    loadImage(img(v.id, v.live ? 0 : 'front')),
    loadImage('/api/site/logo').catch(() => null),
    document.fonts?.load('800 60px Manrope').catch(() => {}),
  ]);
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d');
  g.fillStyle = '#0b0d12';
  g.fillRect(0, 0, W, H);
  // Fills the frame when the photo's shape is close to it (a lot photo); otherwise shows it whole.
  const shape = (photo.naturalWidth / photo.naturalHeight) / (W / PH);
  const k = (shape > 0.85 && shape < 1.18 ? Math.max : Math.min)(W / photo.naturalWidth, PH / photo.naturalHeight);
  const pw = photo.naturalWidth * k, ph = photo.naturalHeight * k;
  g.drawImage(photo, (W - pw) / 2, (PH - ph) / 2, pw, ph);
  g.fillStyle = '#38e1ff';
  g.fillRect(0, PH, W, 6);
  const logoW = logo ? Math.min(230, (logo.naturalWidth / logo.naturalHeight) * 86) : 0;
  const textW = W - pad * 2 - (logoW ? logoW + 30 : 0);
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffffff';
  fitText(g, title(v), pad, PH + 86, textW, 52, 800);
  g.fillStyle = '#9aa3b5';
  fitText(g, [v.trim, v.miles ? `${num(v.miles)} ${state.lang === 'es' ? 'millas' : 'miles'}` : ''].filter(Boolean).join(' · '), pad, PH + 134, textW, 30, 600);
  g.fillStyle = '#38e1ff';
  fitText(g, askingPrice(v), pad, PH + 236, textW, 76, 800);
  g.textAlign = 'right';
  if (logo) g.drawImage(logo, W - pad - logoW, PH + 40, logoW, logoW * (logo.naturalHeight / logo.naturalWidth));
  else { g.fillStyle = '#ffffff'; fitText(g, DEALER.name, W - pad, PH + 90, 300, 30, 800); }
  g.fillStyle = '#ffffff';
  fitText(g, DEALER.phone, W - pad, PH + 232, 300, 30, 700);
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.88));
  if (!blob) throw new Error('No image');
  const name = `${title(v)}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vehicle';
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
}

// Made as soon as the vehicle opens, so the share sheet opens right on the tap.
let shareCache = { key: '', file: null };
function prepareShare(v) {
  if (!coarsePointer || !navigator.canShare) return null;
  const key = `${v.id}:${state.lang}`;
  if (shareCache.key !== key) shareCache = { key, file: shareImage(v).catch(() => null) };
  return shareCache.file;
}

function shareWhatsApp() {
  const v = currentVehicle;
  if (!v) return;
  const text = shareText(v);
  const wa = 'https://wa.me/?text=' + encodeURIComponent(text);
  const pending = prepareShare(v);
  // Opened within the tap itself: browsers block a window opened after waiting on something.
  if (!pending) return void window.open(wa, '_blank', 'noopener');
  pending.then(async (file) => {
    if (file && navigator.canShare({ files: [file], text })) {
      try { await navigator.share({ files: [file], text }); return; }
      catch (err) { if (err.name === 'AbortError') return; }
    }
    location.href = wa;
  });
}

async function copyLink() {
  const link = vehicleLink(currentVehicle);
  try { await navigator.clipboard.writeText(link); toast(t('toast.copied')); }
  catch { window.prompt(t('modal.copy'), link); }
}

function bindModal() {
  const m = $('#vehicleModal');
  m.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    const tb = e.target.closest('[data-tab]');
    if (tb) return showTab(tb.dataset.tab);
    const lead = e.target.closest('[data-lead-form]');
    if (lead) return openLeadForm(lead.dataset.leadForm);
    if (e.target.closest('[data-pane="detail"]')) { showPane('detail'); $('#mDetail .m-act-main').focus({ preventScroll: true }); }
  });
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
  $('#mForm').addEventListener('submit', submitLead);
  $('#mForm').addEventListener('input', (e) => { if (e.target.getAttribute('aria-invalid') === 'true') e.target.removeAttribute('aria-invalid'); });
  $('#mFav').addEventListener('click', () => currentVehicle && toggleFav(currentVehicle.id));
  $('#mWhatsApp').addEventListener('click', shareWhatsApp);
  $('#mCopy').addEventListener('click', copyLink);
  $('#mPayment').addEventListener('click', () => {
    if (currentVehicle.priceOnRequest) return;
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
  $('#preapproveBtn').addEventListener('click', () => { document.getElementById('visit').scrollIntoView({behavior:reducedMotion?'auto':'smooth'}); document.querySelector('#testDriveForm textarea').value = state.lang==='es'?'Me gustaría recibir información sobre financiamiento.':'I would like information about financing.'; });
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
      const body = Object.fromEntries(new FormData(form));
      body.kind = form.dataset.form;
      fetch('/api/leads', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
        .then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||'No se pudo enviar.');return data;})
        .then(()=>{form.reset();$$('[aria-invalid]',form).forEach(x=>x.removeAttribute('aria-invalid'));toast(state.lang==='es'?'Solicitud recibida. Nuestro equipo te contactará para confirmar.':'Request received. Our team will contact you to confirm.');})
        .catch(()=>toast(state.lang==='es'?'No se pudo enviar. Inténtalo de nuevo o llámanos.':'Could not send your request. Try again or call us.'))
        .finally(()=>{btn.disabled=false;});
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
    const flying = flyLogoToHero();
    document.body.classList.add('is-ready');
    if (!flying) { $('#loader')?.classList.add('done'); return; }
    setTimeout(() => {
      $('#loader').classList.add('done');
      document.body.classList.remove('logo-handoff');
    }, 950);
  }, 350);
}
// The loader's logo travels to the hero's while the loader clears, so the page opens on the brand
// and the car appears behind it. Returns false when there is nowhere to land.
function flyLogoToHero() {
  const loader = $('#loader'), from = $('.loader-logo', loader), to = $('.hero-brand .premier-brand-logo');
  if (reducedMotion || !loader || !from || !to || loader.classList.contains('done') || !to.getBoundingClientRect().width) return false;
  // Stop its entrance first, so it is measured at its real size.
  loader.classList.add('handoff');
  document.body.classList.add('logo-handoff');
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  // The hero copy still sits lower before its reveal; land where it ends up.
  const lift = new DOMMatrix(getComputedStyle(to.parentElement).transform).m42 || 0;
  requestAnimationFrame(() => {
    from.style.transform = `translate(${b.left - a.left}px, ${b.top - lift - a.top}px) scale(${b.width / a.width})`;
  });
  return true;
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
  // The light sweep follows the logo actually shown (an uploaded one replaces the original).
  const logo = $('.loader-logo img');
  const sweep = () => logo.currentSrc && $('.loader-logo').style.setProperty('--logo', `url("${logo.currentSrc}")`);
  logo?.addEventListener('load', sweep);
  if (logo?.complete) sweep();
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

  // The hero's big logo is the brand while most of it shows below the nav; then the nav's logo returns.
  const heroBrand = $('.hero-brand');
  if (heroBrand) {
    new IntersectionObserver(([en]) => nav.classList.toggle('brand-in-hero', en.isIntersecting && en.intersectionRatio > 0.35), {
      rootMargin: `-${nav.offsetHeight}px 0px 0px 0px`,
      threshold: [0, 0.35, 0.7, 1],
    }).observe(heroBrand);
  }

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
    cur.classList.toggle('is-hover', !!tgt.closest('a, button, [data-open], select, label, #mImg:not([hidden])'));
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

  renderBrands();
  bindInventory();
  bindModal();
  bindLightbox();
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
  // Links shared by the sales team and the virtual agents open that vehicle: /?v=<id>
  const linked = new URLSearchParams(location.search).get('v');
  if (linked && byId[linked]) openVehicle(linked);
  bindMascot();
}

// Leo, the mascot's chat (js/mascot.js), asks the page to show a vehicle or take the visitor somewhere.
function bindMascot() {
  const go = (id) => $('#' + id).scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  addEventListener('premier:action', (e) => {
    const { kind, id, filters } = e.detail || {};
    const v = byId[id];
    if (kind === 'vehicle' && v) openVehicle(id);
    else if (kind === 'testdrive') {
      if (v && [...$('#tdVehicle').options].some((o) => o.value === id)) $('#tdVehicle').value = id;
      go('visit');
      setTimeout(() => $('#testDriveForm [name=name]').focus({ preventScroll: true }), 700);
    } else if (kind === 'finance') {
      if (v && !v.priceOnRequest) { $('#cPrice').value = v.price; calc(); }
      go('finance');
    } else if (kind === 'trade') go('trade');
    else if (kind === 'inventory') {
      if (filters) { setFilter(filters); syncFilterInputs(); }
      go('inventory');
    }
  });
}

boot();
if (location.hostname === 'localhost') window.__novara = { get hero() { return hero; }, state };
