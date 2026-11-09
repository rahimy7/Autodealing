// Before/after curtain for a vehicle photo. The stage already shows the original photo; the curtain
// lays the cut-out vehicle over a new backdrop and reveals it up to wherever the bar is dragged.
const BACKDROPS = ['studio', 'showroom', 'night', 'white'];

const START = 50;
const SWEEP_MS = 900;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export function createCurtain(stage) {
  const root = document.createElement('div');
  root.className = 'curtain';
  root.hidden = true;
  root.innerHTML = `
    <div class="curtain-scene">
      <div class="curtain-backdrop"></div>
      <img class="curtain-cutout" alt="" draggable="false">
      <span class="curtain-tag curtain-tag-new"></span>
    </div>
    <div class="curtain-rest"><span class="curtain-tag curtain-tag-original"></span></div>
    <input class="curtain-range" type="range" min="0" max="100" value="${START}">
    <div class="curtain-bar" aria-hidden="true"><span class="curtain-grip"></span></div>
    <div class="curtain-backdrops" role="group">${BACKDROPS.map((id) => `<button type="button" data-backdrop="${id}"></button>`).join('')}</div>`;
  stage.append(root);

  const part = (selector) => root.querySelector(selector);
  const backdrop = part('.curtain-backdrop'), cutout = part('.curtain-cutout'), range = part('.curtain-range');
  const swatches = [...root.querySelectorAll('[data-backdrop]:not(.curtain-backdrop)')];
  let labels = null, shownUrl = null, requestId = 0, sweepFrame = 0, dragPointer = null, current = BACKDROPS[0];

  const place = (percent) => {
    const clamped = Math.min(100, Math.max(0, percent));
    root.style.setProperty('--pos', clamped + '%');
    range.value = Math.round(clamped);
  };
  const stopSweep = () => { cancelAnimationFrame(sweepFrame); sweepFrame = 0; };
  const sweepIn = () => {
    stopSweep();
    if (reducedMotion()) return place(START);
    const began = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - began) / SWEEP_MS);
      place(100 + (START - 100) * easeInOut(progress));
      sweepFrame = progress < 1 ? requestAnimationFrame(step) : 0;
    };
    place(100);
    sweepFrame = requestAnimationFrame(step);
  };
  const applyLabels = () => {
    if (!labels) return;
    range.setAttribute('aria-label', labels.slider);
    part('.curtain-backdrops').setAttribute('aria-label', labels.group);
    part('.curtain-tag-original').textContent = labels.original;
    part('.curtain-tag-new').textContent = labels.backdrops[current];
    swatches.forEach((button) => {
      const name = labels.backdrops[button.dataset.backdrop];
      button.setAttribute('aria-label', name);
      button.title = name;
    });
  };
  const choose = (id) => {
    current = id;
    backdrop.dataset.backdrop = id;
    swatches.forEach((button) => button.setAttribute('aria-pressed', button.dataset.backdrop === id));
    applyLabels();
  };
  const dragTo = (clientX) => {
    const box = root.getBoundingClientRect();
    place(((clientX - box.left) / box.width) * 100);
  };

  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.curtain-backdrops')) return;
    stopSweep();
    dragPointer = event.pointerId;
    root.setPointerCapture(event.pointerId);
    range.focus({ preventScroll: true });
    dragTo(event.clientX);
    event.preventDefault();
  });
  root.addEventListener('pointermove', (event) => { if (event.pointerId === dragPointer) dragTo(event.clientX); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    root.addEventListener(type, (event) => { if (event.pointerId === dragPointer) dragPointer = null; });
  range.addEventListener('input', () => { stopSweep(); place(Number(range.value)); });
  part('.curtain-backdrops').addEventListener('click', (event) => {
    const button = event.target.closest('[data-backdrop]');
    if (button) choose(button.dataset.backdrop);
  });
  choose(current);

  return {
    // Resolves to false if the cutout could not be shown, so the caller keeps the plain photo.
    async show(url, nextLabels) {
      labels = nextLabels;
      applyLabels();
      if (url === shownUrl) return true;
      const id = ++requestId;
      const wasHidden = shownUrl === null;
      shownUrl = null;
      root.hidden = true;
      stopSweep();
      cutout.src = url;
      try { await cutout.decode(); } catch { return false; }
      if (id !== requestId) return false;
      shownUrl = url;
      root.hidden = false;
      if (wasHidden) sweepIn();
      return true;
    },
    hide() {
      requestId++;
      shownUrl = null;
      root.hidden = true;
      stopSweep();
      cutout.removeAttribute('src');
    },
  };
}
