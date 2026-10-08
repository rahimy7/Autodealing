// Interactive 360° viewer used inside the vehicle modal.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildCar, disposeCar } from './car-factory.js';
import { makeStudioEnv, makeContactShadow } from './studio.js';

export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  scene.environment = makeStudioEnv(renderer);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, {
    enableDamping: true, dampingFactor: 0.07, enablePan: false, autoRotate: true, autoRotateSpeed: 1.4,
    minPolarAngle: 0.35, maxPolarAngle: 1.52, zoomSpeed: 0.6,
  });
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  let car = null, shadow = null;
  const clock = new THREE.Clock();

  function size() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(size);
  ro.observe(canvas);

  function clear() {
    if (!car) return;
    scene.remove(car, shadow);
    disposeCar(car);
    shadow.geometry.dispose(); shadow.material.map.dispose(); shadow.material.dispose();
    car = shadow = null;
  }

  function loop() {
    controls.update(Math.min(clock.getDelta(), 0.05));
    renderer.render(scene, camera);
  }

  return {
    show(cfg) {
      clear();
      car = buildCar(cfg);
      shadow = makeContactShadow(car);
      scene.add(car, shadow);
      size();
      const L = car.userData.dims.L;
      const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
      const d = (0.5 * L) / Math.tan(hfov / 2) / 0.78;
      controls.target.set(0, 0.62, 0);
      camera.position.set(Math.cos(0.7) * d, 0.22 * d, Math.sin(0.7) * d);
      controls.minDistance = d * 0.5;
      controls.maxDistance = d * 1.5;
      controls.autoRotate = true;
      controls.update();
      clock.getDelta();
      renderer.setAnimationLoop(loop);
    },
    hide() {
      renderer.setAnimationLoop(null);
      clear();
    },
  };
}
