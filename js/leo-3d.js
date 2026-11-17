import * as THREE from 'three';

// Project the original portrait onto a shallow relief. UVs retain the
// original artwork, including the key, logo, glasses and suit.
export async function mountLeo(container) {
  const portrait = container.querySelector('img');
  await portrait.decode();

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const aspect = portrait.naturalWidth / portrait.naturalHeight;
  const texture = new THREE.Texture(portrait);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const geometry = new THREE.PlaneGeometry(aspect * 2, 2, 40, 48);
  const points = geometry.attributes.position;
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i) / aspect;
    const y = points.getY(i);
    const face = Math.exp(-((x - 0.24) ** 2 * 7 + (y - 0.53) ** 2 * 8));
    const key = Math.exp(-((x + 0.57) ** 2 * 15 + (y - 0.28) ** 2 * 4));
    const chest = Math.exp(-((x - 0.2) ** 2 * 3 + (y + 0.5) ** 2 * 3));
    points.setZ(i, face * 0.23 + key * 0.18 + chest * 0.10);
  }
  const rest = points.array.slice();
  const headWeights = new Float32Array(points.count);
  const handWeights = new Float32Array(points.count);
  const smooth = THREE.MathUtils.smoothstep;
  for (let i = 0; i < points.count; i++) {
    const u = (points.getX(i) / aspect + 1) / 2;
    const v = (1 - points.getY(i)) / 2;
    // Keep each visible part together and blend at the neck and sleeve.
    headWeights[i] = smooth(u, 0.26, 0.33) * (1 - smooth(v, 0.34, 0.48));
    handWeights[i] = (1 - smooth(u, 0.23, 0.38)) *
      smooth(v, 0.015, 0.09) * (1 - smooth(v, 0.37, 0.62));
  }
  points.setUsage(THREE.DynamicDrawUsage);

  const scene = new THREE.Scene();
  const model = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    map: texture, transparent: true, alphaTest: 0.01, toneMapped: false,
  }));
  scene.add(model);
  const camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 10);
  camera.position.z = 4;

  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  container.append(canvas);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let width = 0;
  let height = 0;
  let greeting = -Infinity;
  let hovered = false;

  function render(now) {
    frame = 0;
    if (!container.clientWidth || document.hidden || canvas.hidden || !container.isConnected) return;
    if (width !== container.clientWidth || height !== container.clientHeight) {
      width = container.clientWidth;
      height = container.clientHeight;
      renderer.setSize(width, height, false);
    }
    const progress = THREE.MathUtils.clamp((now - greeting) / 1650, 0, 1);
    const active = !reduced.matches && progress < 1;
    const lift = active ? Math.sin(Math.PI * progress) ** 2 : 0;
    const nod = active ? Math.sin(Math.PI * smooth(progress, 0.19, 0.73)) ** 2 : 0;
    for (let i = 0; i < points.count; i++) {
      const j = i * 3;
      const hand = lift * handWeights[i];
      const head = nod * headWeights[i];
      points.setXYZ(i,
        rest[j] + hand * 0.045,
        rest[j + 1] + hand * 0.16 - head * 0.07,
        rest[j + 2] + hand * 0.12 + head * 0.17);
    }
    points.needsUpdate = true;
    model.rotation.y = reduced.matches ? 0 : lift * 0.14 + (hovered ? 0.08 : 0);
    renderer.render(scene, camera);
    container.classList.add('has-portrait-3d');
    if (active) wake();
  }
  function wake() {
    if (!frame) frame = requestAnimationFrame(render);
  }
  new ResizeObserver(wake).observe(container);
  document.addEventListener('visibilitychange', wake);
  reduced.addEventListener('change', wake);
  canvas.addEventListener('webglcontextlost', () => {
    canvas.hidden = true;
    container.classList.remove('has-portrait-3d');
  });
  wake();
  return {
    greet() { greeting = performance.now(); wake(); },
    hover(value) { hovered = value; if (value) greeting = performance.now(); wake(); },
  };
}
