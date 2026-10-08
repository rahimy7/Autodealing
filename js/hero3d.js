// Immersive hero: a live 3D showroom with a mirror floor, neon turntable, bloom and particles.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { buildCar, disposeCar } from './car-factory.js';
import { makeStudioEnv, makeContactShadow } from './studio.js';

const BG = 0x05060a;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const easeOutBack = (t) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

function canvasTexture(draw, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const neon = (hex, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false });

export function createHero(canvas, { config, onProgress = () => {}, layoutHints } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const small = Math.min(innerWidth, innerHeight) < 700;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  onProgress(0.3);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 13, 34);
  scene.environment = makeStudioEnv(renderer, 'hero');
  onProgress(0.45);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 140);
  camera.position.set(7.0, 2.9, 5.8);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, {
    enableDamping: true, dampingFactor: 0.06, enablePan: false, enableZoom: false,
    autoRotate: true, autoRotateSpeed: 0.7, minPolarAngle: 1.0, maxPolarAngle: 1.42, rotateSpeed: 0.55,
  });
  controls.target.set(0, 0.62, 0);
  canvas.style.touchAction = 'pan-y'; // let phones scroll past the hero
  let idleTimer;
  controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(idleTimer); });
  controls.addEventListener('end', () => { idleTimer = setTimeout(() => { controls.autoRotate = true; }, 3500); });

  // ---- mirror floor that fades into darkness
  const mirror = new Reflector(new THREE.CircleGeometry(30, 96), {
    textureWidth: small ? 512 : 1024, textureHeight: small ? 512 : 1024, color: 0x80848c, clipBias: 0.003,
  });
  mirror.rotation.x = -Math.PI / 2;
  const veil = new THREE.Mesh(
    new THREE.CircleGeometry(30, 96),
    new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false,
      map: canvasTexture((g, s) => {
        const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grd.addColorStop(0, 'rgba(5,6,10,0.42)');
        grd.addColorStop(0.12, 'rgba(5,6,10,0.55)');
        grd.addColorStop(0.32, 'rgba(5,6,10,0.92)');
        grd.addColorStop(1, 'rgba(5,6,10,1)');
        g.fillStyle = grd;
        g.fillRect(0, 0, s, s);
      }),
    })
  );
  veil.rotation.x = -Math.PI / 2;
  veil.position.y = 0.004;
  scene.add(mirror, veil);

  // ---- neon turntable
  const ringMat = neon(0x38e1ff, 1.7);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.95, 0.011, 8, 256), ringMat);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.25, 0.005, 6, 256), neon(0x7c5cff, 1.4));
  const arcMat = neon(0xaaf6ff, 3);
  const arc = new THREE.Mesh(new THREE.TorusGeometry(2.95, 0.024, 8, 120, Math.PI * 0.42), arcMat);
  const arc2 = new THREE.Mesh(new THREE.TorusGeometry(3.25, 0.014, 8, 80, Math.PI * 0.22), neon(0xc9b8ff, 2.2));
  for (const m of [ring, ring2, arc, arc2]) { m.rotation.x = -Math.PI / 2; m.position.y = 0.012; }
  const tickGeo = new THREE.BoxGeometry(0.12, 0.004, 0.01);
  const ticks = new THREE.InstancedMesh(tickGeo, neon(0x38e1ff, 0.6), 90);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    dummy.position.set(Math.cos(a) * 3.55, 0.01, Math.sin(a) * 3.55);
    dummy.rotation.set(0, -a, 0);
    dummy.scale.set(i % 5 === 0 ? 1.8 : 1, 1, 1);
    dummy.updateMatrix();
    ticks.setMatrixAt(i, dummy.matrix);
  }
  scene.add(ring, ring2, arc, arc2, ticks);

  // ---- soft aurora glow that always sits behind the car
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: canvasTexture((g, sz) => {
      const grd = g.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
      grd.addColorStop(0, 'rgba(124,92,255,0.32)');
      grd.addColorStop(0.4, 'rgba(56,225,255,0.08)');
      grd.addColorStop(1, 'rgba(5,6,10,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, sz, sz);
    }, 256),
    transparent: true, depthWrite: false, fog: false, opacity: 0.6,
  }));
  glow.scale.set(28, 8.2, 1);
  scene.add(glow);
  const _dir = new THREE.Vector3();
  // keep the glow out of the floor reflection
  const mirrorRender = mirror.onBeforeRender;
  mirror.onBeforeRender = function (...args) { glow.visible = false; mirrorRender.apply(this, args); glow.visible = true; };

  // ---- floating particles
  const N = small ? 220 : 480;
  const pPos = new Float32Array(N * 3), pSpeed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = 1.5 + Math.random() * 12, a = Math.random() * Math.PI * 2;
    pPos.set([Math.cos(a) * r, Math.random() * 6, Math.sin(a) * r], i * 3);
    pSpeed[i] = 0.04 + Math.random() * 0.16;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const dot = canvasTexture((g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(160,240,255,0.6)');
    grd.addColorStop(1, 'rgba(160,240,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  }, 64);
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.06, map: dot, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xbff6ff }));
  scene.add(particles);

  // ---- the car
  const carGroup = new THREE.Group();
  scene.add(carGroup);
  let car = null, shadow = null, carL = 4.6;
  function mount(cfg) {
    car = buildCar({ ...cfg, lightIntensity: 3.4 });
    shadow = makeContactShadow(car, 1.15);
    carGroup.add(car, shadow);
    carL = car.userData.dims.L;
  }
  function unmount() {
    if (!car) return;
    carGroup.remove(car, shadow);
    disposeCar(car);
    shadow.geometry.dispose(); shadow.material.map.dispose(); shadow.material.dispose();
    car = shadow = null;
  }
  mount(config);

  // ---- post-processing
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: small ? 2 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- layout: keep the car framed between the copy and the configurator
  function layout() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    const aspect = w / h;
    camera.aspect = aspect;
    const narrow = w < 860;
    camera.fov = narrow ? 36 : 27;
    const hints = layoutHints ? layoutHints() : {};
    let px, py, frac;
    if (narrow) {
      px = w * 0.5;
      py = hints.top != null && hints.bottom > hints.top ? (hints.top + hints.bottom) / 2 + 6 : h * 0.5;
      frac = 0.88;
    } else {
      const left = Math.max(0, (hints.copyRight ?? w * 0.45) * 0.72);
      const top = hints.navBottom ?? 80, bottom = hints.dockTop ?? h * 0.82;
      px = (left + w) / 2 + w * 0.03;
      py = (top + bottom) / 2 + h * 0.1;
      frac = Math.min(0.4, ((w - left) / w) * 0.66);
    }
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect);
    const d = (0.47 * carL) / (Math.tan(hfov / 2) * frac);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, d);
    controls.minDistance = controls.maxDistance = d;
    camera.setViewOffset(w, h, w / 2 - px, h / 2 - py, w, h);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(layout);
  ro.observe(canvas);
  layout();

  // ---- animation state
  const clock = new THREE.Clock();
  let swap = null; // { phase, t0, next }
  let paintTween = null;
  let flash = 0;
  let running = false;

  function setModel(cfg) {
    if (swap && swap.phase === 'out') { swap.next = cfg; return; }
    swap = { phase: 'out', t0: performance.now(), next: cfg };
  }
  function setPaint(color, finish = 'gloss', metalness) {
    if (!car) return;
    const m = car.userData.paint;
    const matte = finish === 'matte';
    paintTween = {
      t0: performance.now(), m,
      from: { c: m.color.clone(), r: m.roughness, mt: m.metalness, cc: m.clearcoat },
      to: { c: new THREE.Color(color), r: matte ? 0.55 : 0.3, mt: matte ? 0.3 : (metalness ?? 0.42), cc: matte ? 0.05 : 1 },
    };
    flash = 1;
  }

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = performance.now();
    controls.update(dt);
    arc.rotation.z -= dt * 0.9;
    arc2.rotation.z += dt * 0.5;
    _dir.copy(camera.position).sub(controls.target).setY(0).normalize();
    glow.position.copy(controls.target).addScaledVector(_dir, -16).setY(4.1);

    const p = pGeo.attributes.position.array;
    for (let i = 0; i < N; i++) {
      p[i * 3 + 1] += pSpeed[i] * dt;
      if (p[i * 3 + 1] > 6) p[i * 3 + 1] = 0;
    }
    pGeo.attributes.position.needsUpdate = true;

    // model swap: shrink + spin out, rebuild, grow back in with a headlight flash
    if (swap) {
      const k = (now - swap.t0) / (swap.phase === 'out' ? 360 : 950);
      if (swap.phase === 'out') {
        const e = easeInCubic(Math.min(1, k));
        carGroup.scale.setScalar(Math.max(0.001, 1 - e));
        carGroup.rotation.y = e * 1.4;
        ringMat.color.setRGB(0.22 * (1.7 + e * 6), 0.88 * (1.7 + e * 6), 1.7 + e * 6);
        if (k >= 1) {
          unmount();
          mount(swap.next);
          layout();
          swap = { phase: 'in', t0: performance.now() };
          car.userData.materials.head.emissiveIntensity = 0;
        }
      } else {
        const kk = Math.min(1, k);
        carGroup.scale.setScalar(Math.max(0.001, easeOutBack(kk)));
        carGroup.rotation.y = -1.2 * (1 - easeOutCubic(kk));
        const gl = 1.7 + 6 * (1 - kk);
        ringMat.color.setRGB(0.22 * gl, 0.88 * gl, gl);
        const hk = Math.min(1, Math.max(0, (k - 0.35) / 0.4));
        car.userData.materials.head.emissiveIntensity = hk < 1 ? 3.4 + Math.sin(hk * Math.PI) * 6 : 3.4;
        if (k >= 1.2) { swap = null; carGroup.rotation.y = 0; }
      }
    }
    if (paintTween) {
      const k = Math.min(1, (now - paintTween.t0) / 700), e = easeOutCubic(k);
      const { m, from, to } = paintTween;
      m.color.copy(from.c).lerp(to.c, e);
      m.roughness = from.r + (to.r - from.r) * e;
      m.metalness = from.mt + (to.mt - from.mt) * e;
      m.clearcoat = from.cc + (to.cc - from.cc) * e;
      if (k >= 1) paintTween = null;
    }
    if (flash > 0) {
      flash = Math.max(0, flash - dt * 1.6);
      arcMat.color.setRGB(0.67 * (3 + flash * 8), 0.96 * (3 + flash * 8), 3 + flash * 8);
    }
    composer.render(dt);
  }

  // compile shaders up-front so the first frame doesn't hitch, then report ready
  const ready = (renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve())
    .catch(() => {})
    .then(() => {
      onProgress(0.9);
      composer.render(0);
      onProgress(1);
    });

  return {
    ready,
    layout,
    renderOnce: frame,
    setModel,
    setPaint,
    resume() {
      if (running) return;
      running = true;
      clock.getDelta();
      renderer.setAnimationLoop(frame);
    },
    pause() {
      if (!running) return;
      running = false;
      renderer.setAnimationLoop(null);
    },
    dispose() {
      this.pause();
      ro.disconnect();
      unmount();
      controls.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
