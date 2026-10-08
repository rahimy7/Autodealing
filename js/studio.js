// Shared staging helpers: studio reflections, soft contact shadows and camera framing.
import * as THREE from 'three';

// Builds an HDR "photo studio" (softboxes + light strips) and bakes it into a PMREM env map.
export function makeStudioEnv(renderer, mode = 'studio') {
  const env = new THREE.Scene();
  const hero = mode === 'hero';
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(40, 16, 40),
    new THREE.MeshBasicMaterial({ color: hero ? 0x07080b : 0x6b7078, side: THREE.BackSide })
  );
  room.position.y = 7;
  env.add(room);
  const panel = (w, h, intensity, color, pos, target = [0, 1, 0]) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
    );
    m.position.set(...pos);
    m.lookAt(...target);
    env.add(m);
  };
  panel(14, 5, hero ? 3.4 : 3.2, 0xffffff, [0, 12, 0], [0, 0, 0]);
  panel(20, 0.8, hero ? 5.5 : 5, 0xffffff, [0, 3.6, 12]);
  panel(20, 0.8, hero ? 5.5 : 5, 0xffffff, [0, 3.6, -12]);
  panel(20, 0.4, 3.5, 0xffffff, [0, 7.5, 11]);
  panel(20, 0.4, 3.5, 0xffffff, [0, 7.5, -11]);
  panel(7, 6, hero ? 1.6 : 2.6, 0xffffff, [15, 5, 0]);
  panel(7, 6, hero ? 1.2 : 1.8, 0xffffff, [-15, 5, 0]);
  if (hero) {
    panel(20, 0.35, 7, 0x38e1ff, [0, 1.4, 12.5]);
    panel(20, 0.35, 7, 0x38e1ff, [0, 1.4, -12.5]);
    panel(0.5, 10, 5, 0x7c5cff, [12, 5, 10]);
    panel(0.5, 10, 5, 0x7c5cff, [-12, 5, -10]);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: hero ? 0x050608 : 0x3a3d42 }));
  floor.rotation.x = -Math.PI / 2;
  env.add(floor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  env.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return tex;
}

// Soft, baked ground shadow (cheap, looks like ambient occlusion under the car).
export function makeContactShadow(car, strength = 1) {
  const { L, W, fx, rx, zw } = car.userData.dims;
  const PW = L * 1.5, PH = W * 2.0;
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 512;
  const ctx = cv.getContext('2d');
  const sx = cv.width / PW, sy = cv.height / PH, cx = cv.width / 2, cy = cv.height / 2;
  ctx.filter = 'blur(28px)';
  ctx.fillStyle = `rgba(0,0,0,${0.5 * strength})`;
  ctx.beginPath();
  ctx.roundRect(cx - (L / 2) * sx * 0.98, cy - (W / 2) * sy * 0.92, L * sx * 0.98, W * sy * 0.92, 90);
  ctx.fill();
  ctx.filter = 'blur(10px)';
  ctx.fillStyle = `rgba(0,0,0,${0.55 * strength})`;
  ctx.beginPath();
  ctx.roundRect(cx - (L / 2) * sx * 0.86, cy - (W / 2) * sy * 0.78, L * sx * 0.86, W * sy * 0.78, 60);
  ctx.fill();
  ctx.filter = 'blur(6px)';
  ctx.fillStyle = `rgba(0,0,0,${0.85 * strength})`;
  for (const ax of [fx, rx]) for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.ellipse(cx + ax * sx, cy + s * zw * sy, 0.26 * sx, 0.13 * sy, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(PW, PH),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.003;
  mesh.renderOrder = 1;
  return mesh;
}

// Classic product-shot angles. Camera direction is from the car toward the camera.
export const ANGLES = {
  front: { az: 38, el: 11, fov: 28 },
  side: { az: 90, el: 4, fov: 24 },
  rear: { az: 145, el: 13, fov: 28 },
  hero: { az: 32, el: 9, fov: 26 },
};

export function frameCamera(camera, car, angle, aspect, pad = 1.08) {
  const a = typeof angle === 'string' ? ANGLES[angle] : angle;
  const box = new THREE.Box3().setFromObject(car);
  const center = box.getCenter(new THREE.Vector3());
  camera.fov = a.fov;
  camera.aspect = aspect;
  const az = THREE.MathUtils.degToRad(a.az), el = THREE.MathUtils.degToRad(a.el);
  // azimuth measured from +X (car front) toward +Z (right side)
  const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
  // fit the real silhouette (sampled vertices), not the bounding box corners
  const pts = [];
  const v = new THREE.Vector3();
  car.updateMatrixWorld(true);
  car.traverse((o) => {
    if (!o.isMesh) return;
    const pa = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pa.count / 1500));
    for (let i = 0; i < pa.count; i += step) pts.push(v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld).clone());
  });
  const target = center.clone();
  const vp = a.vpad || 1.2;
  const p = new THREE.Vector3();
  const place = (d) => {
    camera.position.copy(target).addScaledVector(dir, d);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };
  const bounds = () => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of pts) { p.copy(c).project(camera); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    return { x0, x1, y0, y1 };
  };
  const search = () => {
    let lo = 0.5, hi = 80;
    for (let it = 0; it < 28; it++) {
      const d = (lo + hi) / 2;
      place(d);
      const b = bounds();
      const fits = Math.max(Math.abs(b.x0), Math.abs(b.x1)) * pad <= 1 && Math.max(Math.abs(b.y0), Math.abs(b.y1)) * pad * vp <= 1;
      if (fits) hi = d; else lo = d;
    }
    place(hi);
    return hi;
  };
  let d = search();
  for (let k = 0; k < 2; k++) {
    // re-center the silhouette in frame
    const b = bounds();
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2 + (a.yOffset || 0);
    const h = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * d;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(right, cx * h * camera.aspect).addScaledVector(up, cy * h);
    d = search();
  }
  return d;
}
