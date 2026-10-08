// Procedural 3D vehicles — every car on the site is generated from code (no external models).
// Bodies are lofted cross-sections (super-ellipses) driven by side/plan profiles, with wheel
// arches carved out, a glass greenhouse, lights, wheels and per-type extras.
import * as THREE from 'three';

const sgnpow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// y = f(x) from control points through a centripetal Catmull-Rom spline.
function profile(points) {
  const pts = points.map(([x, y]) => new THREE.Vector3(x, y, 0)).sort((a, b) => a.x - b.x);
  const s = new THREE.CatmullRomCurve3(pts, false, 'centripetal').getPoints(600).sort((a, b) => a.x - b.x);
  const last = s.length - 1;
  return (x) => {
    if (x <= s[0].x) return s[0].y;
    if (x >= s[last].x) return s[last].y;
    let lo = 0, hi = last;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m].x < x) lo = m; else hi = m; }
    const a = s[lo], b = s[hi];
    return a.y + (b.y - a.y) * ((x - a.x) / ((b.x - a.x) || 1));
  };
}

// Units: meters. Car faces +X, Y up, ground at y = 0, centered on the origin.
export const BODY_TYPES = {
  coupe: {
    doors: [0.42, -0.62], handles: [-0.48],
    L: 4.55, r: 0.34, tireW: 0.275, rimRatio: 0.74, fx: 1.38, rx: -1.32,
    top: [[2.275, 0.6], [2.1, 0.64], [1.7, 0.76], [1.38, 0.83], [0.95, 0.87], [0.6, 0.9], [0, 0.93], [-0.8, 0.95], [-1.32, 0.97], [-1.9, 0.96], [-2.275, 0.92]],
    bot: [[2.275, 0.2], [2.0, 0.16], [1.6, 0.13], [-1.8, 0.13], [-2.1, 0.22], [-2.275, 0.3]],
    hw: [[2.275, 0.86], [1.9, 0.93], [1.38, 0.965], [0.3, 0.93], [-1.32, 0.98], [-1.9, 0.96], [-2.275, 0.9]],
    n: 3.0, wRatio: 0.58, tb: 0.14, endF: 0.085, endR: 0.06, py: 2.2, pz: 2.6, flare: 0.025, rocker: -0.74,
    grilles: [{ y: [0.17, 0.3], w: 0.6 }],
    hl: { y: 0.42, len: 0.5, end: 0.45, band: 0.035 }, tl: { y: 0.42, len: 0.4, end: 0, band: 0.03 },
    cabin: { x0: 0.62, x1: -1.98, base: 0.86, top: 0.7, n: 3.4, roof: [[0.62, 0.9], [0.2, 1.15], [-0.25, 1.27], [-0.7, 1.29], [-1.1, 1.24], [-1.55, 1.08], [-1.98, 0.95]], roofBand: [0.12, -0.95], pillars: [] },
  },
  supercar: {
    doors: [0.66, -0.3],
    L: 4.6, r: 0.35, tireW: 0.3, rimRatio: 0.76, fx: 1.42, rx: -1.36,
    top: [[2.3, 0.5], [2.15, 0.55], [1.8, 0.69], [1.42, 0.8], [1.0, 0.81], [0.65, 0.85], [0, 0.9], [-0.8, 0.95], [-1.36, 0.98], [-1.95, 0.97], [-2.3, 0.93]],
    bot: [[2.3, 0.16], [2.0, 0.12], [-1.9, 0.12], [-2.3, 0.24]],
    hw: [[2.3, 0.86], [1.85, 0.97], [1.42, 1.0], [0.3, 0.94], [-1.36, 1.03], [-1.95, 1.0], [-2.3, 0.94]],
    n: 2.8, wRatio: 0.55, tb: 0.18, endF: 0.085, endR: 0.05, py: 2.0, pz: 2.4, flare: 0.04, rocker: -0.72,
    grilles: [{ y: [0.13, 0.27], w: 0.72 }],
    intakes: [{ x0: -0.95, x1: -0.42, y0: -0.18, y1: 0.36 }],
    hl: { y: 0.38, len: 0.55, end: 0.5, band: 0.03 }, tl: { y: 0.45, len: 0.35, end: 0, band: 0.028 },
    cabin: { x0: 0.9, x1: -1.55, base: 0.84, top: 0.66, n: 3.2, roof: [[0.9, 0.86], [0.45, 1.02], [0.05, 1.13], [-0.4, 1.15], [-0.85, 1.09], [-1.25, 0.99], [-1.55, 0.94]], roofBand: [0.1, -0.75], pillars: [] },
    wing: { x: -2.02, y: 1.13, w: 1.72, chord: 0.34 },
  },
  sedan: {
    doors: [0.6, -0.34, -0.98], handles: [-0.2, -0.84],
    L: 4.85, r: 0.34, tireW: 0.25, rimRatio: 0.72, fx: 1.48, rx: -1.42,
    top: [[2.425, 0.7], [2.2, 0.75], [1.8, 0.82], [1.48, 0.87], [0.8, 0.93], [0, 0.97], [-1.0, 0.99], [-1.5, 1.0], [-2.1, 1.0], [-2.425, 0.97]],
    bot: [[2.425, 0.24], [2.15, 0.2], [1.7, 0.15], [-1.8, 0.15], [-2.2, 0.22], [-2.425, 0.32]],
    hw: [[2.425, 0.85], [2.0, 0.9], [1.48, 0.925], [0, 0.93], [-1.42, 0.935], [-2.0, 0.92], [-2.425, 0.88]],
    n: 3.4, wRatio: 0.56, tb: 0.12, endF: 0.075, endR: 0.06, py: 2.4, pz: 3.0, flare: 0.015, rocker: -0.74,
    grilles: [{ y: [0.4, 0.58], w: 0.42 }, { y: [0.19, 0.3], w: 0.62 }],
    hl: { y: 0.46, len: 0.45, end: 0.48, band: 0.032 }, tl: { y: 0.5, len: 0.4, end: 0, band: 0.03 },
    cabin: { x0: 0.82, x1: -1.68, base: 0.88, top: 0.72, n: 3.6, roof: [[0.82, 0.95], [0.35, 1.24], [-0.05, 1.42], [-0.5, 1.45], [-0.95, 1.42], [-1.3, 1.26], [-1.68, 1.02]], roofBand: [0.02, -0.98], pillars: [{ x0: -0.38, x1: -0.3, mat: 'trim' }, { x0: -1.75, x1: -1.12, mat: 'paint' }] },
  },
  suv: {
    doors: [0.72, -0.29, -0.97], handles: [-0.15, -0.83],
    L: 4.75, r: 0.38, tireW: 0.27, rimRatio: 0.7, fx: 1.45, rx: -1.45,
    top: [[2.375, 0.95], [2.15, 0.99], [1.8, 1.03], [1.45, 1.05], [0.85, 1.08], [0, 1.1], [-1.5, 1.12], [-2.15, 1.12], [-2.375, 1.1]],
    bot: [[2.375, 0.36], [2.1, 0.3], [1.7, 0.23], [-1.8, 0.23], [-2.15, 0.3], [-2.375, 0.4]],
    hw: [[2.375, 0.9], [2.0, 0.94], [1.45, 0.96], [0, 0.95], [-1.45, 0.965], [-2.1, 0.95], [-2.375, 0.92]],
    n: 4, wRatio: 0.55, tb: 0.1, endF: 0.065, endR: 0.045, py: 3.0, pz: 3.6, flare: 0.03, rocker: -0.5,
    grilles: [{ y: [0.6, 0.86], w: 0.56 }, { y: [0.36, 0.5], w: 0.62 }],
    hl: { y: 0.6, len: 0.42, end: 0.55, band: 0.04 }, tl: { y: 0.62, len: 0.32, end: 0, band: 0.035 },
    cabin: { x0: 0.95, x1: -2.22, base: 0.9, top: 0.78, n: 4.5, rampR: 0.04, roof: [[0.95, 1.1], [0.45, 1.46], [0.05, 1.66], [-0.6, 1.72], [-1.6, 1.71], [-2.0, 1.66], [-2.15, 1.52], [-2.22, 1.13]], roofBand: [0.0, -2.02], pillars: [{ x0: -0.33, x1: -0.25, mat: 'trim' }, { x0: -2.3, x1: -1.85, mat: 'trim' }] },
    rails: true,
  },
  suv3: {
    doors: [0.84, -0.26, -1.05], handles: [-0.12, -0.91],
    L: 5.1, r: 0.39, tireW: 0.28, rimRatio: 0.72, fx: 1.62, rx: -1.55,
    top: [[2.55, 1.02], [2.35, 1.06], [2.0, 1.09], [1.62, 1.1], [0.9, 1.13], [0, 1.15], [-1.6, 1.17], [-2.3, 1.17], [-2.55, 1.15]],
    bot: [[2.55, 0.38], [2.3, 0.32], [1.9, 0.24], [-1.95, 0.24], [-2.3, 0.3], [-2.55, 0.42]],
    hw: [[2.55, 0.92], [2.15, 0.97], [1.62, 0.99], [0, 0.98], [-1.55, 0.99], [-2.25, 0.97], [-2.55, 0.94]],
    n: 4.6, wRatio: 0.55, tb: 0.08, endF: 0.055, endR: 0.04, py: 3.2, pz: 4.0, flare: 0.02, rocker: -0.62,
    grilles: [{ y: [0.58, 0.95], w: 0.6, mat: 'chromeGrille' }, { y: [0.36, 0.5], w: 0.66 }],
    hl: { y: 0.66, len: 0.45, end: 0.62, band: 0.04 }, tl: { y: 0.64, len: 0.34, end: 0, band: 0.035 },
    cabin: { x0: 1.05, x1: -2.42, base: 0.92, top: 0.82, n: 5, rampR: 0.04, roof: [[1.05, 1.15], [0.55, 1.5], [0.12, 1.75], [-0.6, 1.8], [-1.8, 1.8], [-2.25, 1.76], [-2.36, 1.6], [-2.42, 1.18]], roofBand: [0.06, -2.24], pillars: [{ x0: -0.3, x1: -0.22, mat: 'trim' }, { x0: -1.4, x1: -1.32, mat: 'trim' }, { x0: -2.5, x1: -2.1, mat: 'paint' }] },
    rails: true, chromeTrim: true,
  },
  truck: {
    doors: [0.86, -0.06, -0.62], handles: [0.08, -0.48], truckBars: [0.93, 0.76],
    L: 5.8, r: 0.4, tireW: 0.3, rimRatio: 0.66, fx: 1.95, rx: -1.75,
    top: [[2.9, 1.18], [2.7, 1.2], [2.3, 1.22], [1.6, 1.24], [1.0, 1.25], [0, 1.26], [-2.6, 1.26], [-2.9, 1.26]],
    bot: [[2.9, 0.42], [2.6, 0.36], [2.2, 0.32], [-2.4, 0.32], [-2.9, 0.42]],
    hw: [[2.9, 0.96], [2.5, 0.99], [1.95, 1.01], [0, 1.0], [-1.75, 1.01], [-2.9, 0.99]],
    n: 5, wRatio: 0.52, tb: 0.05, endF: 0.045, endR: 0.03, py: 3.6, pz: 5.0, flare: 0.04, rocker: -0.55,
    grilles: [{ y: [0.6, 1.03], w: 0.74, round: 6 }, { y: [0.4, 0.54], w: 0.82, round: 6 }],
    hl: { y: 0.68, len: 0.3, end: 0.76, band: 0.05 }, tl: { block: true },
    cabin: { x0: 1.05, x1: -0.66, base: 0.94, top: 0.84, n: 5, rampF: 0.1, rampR: 0.03, roof: [[1.05, 1.24], [0.55, 1.66], [0.2, 1.9], [-0.2, 1.94], [-0.66, 1.94]], roofBand: [0.12, -0.66], pillars: [{ x0: -0.1, x1: -0.02, mat: 'trim' }, { x0: -0.7, x1: -0.5, mat: 'paint' }] },
    bed: { x0: -0.72, x1: -2.82 },
  },
  crossover: {
    doors: [0.7, -0.31, -0.95],
    L: 4.7, r: 0.37, tireW: 0.26, rimRatio: 0.72, fx: 1.45, rx: -1.42,
    top: [[2.35, 0.8], [2.15, 0.85], [1.8, 0.92], [1.45, 0.97], [0.9, 1.0], [0, 1.03], [-1.5, 1.06], [-2.1, 1.05], [-2.35, 1.02]],
    bot: [[2.35, 0.28], [2.1, 0.24], [1.7, 0.2], [-1.8, 0.2], [-2.15, 0.27], [-2.35, 0.36]],
    hw: [[2.35, 0.88], [2.0, 0.94], [1.45, 0.965], [0, 0.95], [-1.42, 0.97], [-2.0, 0.95], [-2.35, 0.9]],
    n: 3.4, wRatio: 0.56, tb: 0.12, endF: 0.08, endR: 0.05, py: 2.4, pz: 3.0, flare: 0.03, rocker: -0.62,
    grilles: [{ y: [0.24, 0.34], w: 0.6 }],
    hl: { y: 0.42, len: 0.42, end: 0, band: 0.03 }, tl: { y: 0.5, len: 0.34, end: 0, band: 0.03 },
    cabin: { x0: 0.92, x1: -2.12, base: 0.88, top: 0.72, n: 3.8, roof: [[0.92, 1.02], [0.42, 1.36], [0.0, 1.53], [-0.6, 1.59], [-1.2, 1.56], [-1.7, 1.42], [-2.12, 1.07]], roofBand: [0.02, -1.6], pillars: [{ x0: -0.35, x1: -0.28, mat: 'trim' }] },
    ev: true,
  },
  hatch: {
    doors: [0.6, -0.33, -0.87], handles: [-0.19, -0.73],
    L: 4.25, r: 0.33, tireW: 0.24, rimRatio: 0.72, fx: 1.32, rx: -1.3,
    top: [[2.125, 0.7], [1.9, 0.76], [1.55, 0.83], [1.32, 0.87], [0.75, 0.93], [0, 0.96], [-1.5, 0.99], [-2.0, 0.98], [-2.125, 0.96]],
    bot: [[2.125, 0.24], [1.9, 0.19], [1.5, 0.15], [-1.6, 0.15], [-1.95, 0.22], [-2.125, 0.32]],
    hw: [[2.125, 0.84], [1.7, 0.885], [1.32, 0.9], [0, 0.89], [-1.3, 0.905], [-1.9, 0.88], [-2.125, 0.85]],
    n: 3.4, wRatio: 0.56, tb: 0.12, endF: 0.08, endR: 0.05, py: 2.4, pz: 3.0, flare: 0.025, rocker: -0.72,
    grilles: [{ y: [0.4, 0.55], w: 0.4 }, { y: [0.19, 0.31], w: 0.6 }],
    hl: { y: 0.46, len: 0.42, end: 0.5, band: 0.033 }, tl: { y: 0.6, len: 0.3, end: 0.45, band: 0.03 },
    cabin: { x0: 0.8, x1: -2.0, base: 0.88, top: 0.72, n: 3.8, rampR: 0.05, roof: [[0.8, 0.95], [0.35, 1.26], [0, 1.41], [-0.6, 1.46], [-1.4, 1.44], [-1.82, 1.34], [-2.0, 1.0]], roofBand: [0.0, -1.78], pillars: [{ x0: -0.37, x1: -0.3, mat: 'trim' }, { x0: -2.05, x1: -1.45, mat: 'paint' }] },
    spoiler: true,
  },
};

// ---------------------------------------------------------------- materials
const RIM_FINISH = {
  silver: { color: 0xd4d8dd, metalness: 1, roughness: 0.22 },
  chrome: { color: 0xf2f4f6, metalness: 1, roughness: 0.06 },
  black: { color: 0x15171a, metalness: 0.7, roughness: 0.32 },
  gunmetal: { color: 0x4a4f56, metalness: 1, roughness: 0.3 },
  bronze: { color: 0x8c6a3c, metalness: 1, roughness: 0.3 },
  white: { color: 0xe8e8e8, metalness: 0.2, roughness: 0.35 },
};

export function makeMaterials(o = {}) {
  const finish = o.finish || 'gloss';
  const paint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(o.color || '#b3121f'),
    metalness: finish === 'matte' ? 0.3 : (o.metalness ?? 0.42),
    roughness: finish === 'matte' ? 0.55 : (o.roughness ?? 0.3),
    clearcoat: finish === 'matte' ? 0.05 : 1,
    clearcoatRoughness: 0.04,
  });
  const rim = RIM_FINISH[o.rimFinish || 'silver'];
  return {
    paint,
    roof: o.roofColor ? new THREE.MeshPhysicalMaterial({ color: o.roofColor, metalness: 0.4, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }) : paint,
    trim: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, metalness: 0.2, roughness: 0.6 }),
    gloss: new THREE.MeshPhysicalMaterial({ color: 0x050506, metalness: 0.4, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03 }),
    grille: new THREE.MeshStandardMaterial({ color: 0x0a0b0d, metalness: 0.5, roughness: 0.45 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1016, metalness: 0.9, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xeef1f4, metalness: 1, roughness: 0.07 }),
    chromeGrille: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 1, roughness: 0.18 }),
    tunnel: new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0, roughness: 1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0, roughness: 0.88 }),
    rim: new THREE.MeshStandardMaterial(rim),
    rimInner: new THREE.MeshStandardMaterial({ color: 0x1a1c1f, metalness: 0.8, roughness: 0.5 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x8b8e92, metalness: 1, roughness: 0.38 }),
    caliper: new THREE.MeshPhysicalMaterial({ color: o.caliper || 0x1b1d20, metalness: 0.2, roughness: 0.35, clearcoat: 0.6 }),
    lamp: new THREE.MeshPhysicalMaterial({ color: 0x0a0b0d, metalness: 0.6, roughness: 0.08, clearcoat: 1 }),
    tailHousing: new THREE.MeshPhysicalMaterial({ color: 0x2a0306, metalness: 0.3, roughness: 0.1, clearcoat: 1, emissive: 0x3a0008, emissiveIntensity: 0.6 }),
    head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe9f6ff, emissiveIntensity: o.lightIntensity ?? 2.2, toneMapped: false }),
    tail: new THREE.MeshStandardMaterial({ color: 0xff2030, emissive: 0xff1428, emissiveIntensity: o.lightIntensity ?? 2.2, toneMapped: false }),
  };
}

// ---------------------------------------------------------------- body
const endShape = (t, p) => Math.pow(Math.max(0, 1 - Math.pow(t, p)), 1 / p);

function makeBody(spec) {
  const L = spec.L, hL = L / 2;
  const topF = profile(spec.top), botF = profile(spec.bot), hwF = profile(spec.hw);
  const R = spec.r + (spec.archGap ?? 0.045);
  const axles = [spec.fx, spec.rx];
  const n = spec.n ?? 3.2, tb = spec.tb ?? 0.14, wRatio = spec.wRatio ?? 0.56;
  const ef = spec.endF ?? 0.07, er = spec.endR ?? 0.06;
  const py = spec.py ?? 2.4, pz = spec.pz ?? 3;

  const archY = (x) => {
    let y = -Infinity;
    for (const ax of axles) { const d = x - ax; if (Math.abs(d) < R) y = Math.max(y, spec.r + Math.sqrt(R * R - d * d)); }
    return y;
  };
  const endT = (x) => {
    const xn = x / hL;
    if (xn > 1 - ef) return Math.min(1, (xn - (1 - ef)) / ef);
    if (xn < -(1 - er)) return Math.min(1, (-xn - (1 - er)) / er);
    return 0;
  };
  // surface point before arch carving
  const rawPoint = (sec, th, out) => {
    const c = Math.cos(th), s = Math.sin(th);
    const yn = sgnpow(s, 2 / n);
    let z = sec.hw * sgnpow(c, 2 / n);
    z *= 1 - tb * Math.max(0, yn) ** 2;
    z *= 1 - 0.07 * Math.max(0, -yn) ** 4;
    out.set(sec.x, sec.yw + (yn >= 0 ? sec.hu : sec.hd) * yn * sec.sy, z * sec.sz);
    return yn;
  };
  const thetaForY = (yn) => (yn >= 0 ? 1 : -1) * Math.asin(Math.min(1, Math.abs(yn) ** (n / 2)));
  const tmp = new THREE.Vector3();
  const section = (x) => {
    const top = topF(x), bot = botF(x);
    let hw = hwF(x);
    for (const ax of axles) hw += (spec.flare ?? 0.02) * Math.exp(-(((x - ax) / 0.5) ** 2));
    const yw = bot + (top - bot) * wRatio;
    const t = endT(x);
    const sec = { x, yw, hu: top - yw, hd: yw - bot, hw, sy: endShape(t, py), sz: endShape(t, pz), arch: archY(x), zEdge: 0 };
    if (sec.arch > -Infinity) {
      const yn = clamp((sec.arch - yw) / (sec.arch >= yw ? sec.hu : sec.hd), -1, 1);
      rawPoint(sec, thetaForY(yn), tmp);
      sec.zEdge = Math.abs(tmp.z);
    }
    return sec;
  };
  // carved point: below the arch line, vertices are pulled onto the arch edge / tunnel ceiling
  const point = (sec, th, out) => {
    const yn = rawPoint(sec, th, out);
    out.clamped = false;
    if (out.y < sec.arch) {
      out.clamped = true;
      out.y = sec.arch;
      if (Math.abs(out.z) > sec.zEdge) out.z = Math.sign(out.z) * sec.zEdge;
    }
    return yn;
  };
  const at = (x, th) => { const p = new THREE.Vector3(); point(section(x), th, p); return p; };
  const normalAt = (x, th) => {
    const p0 = at(x, th), px = at(x - 0.002, th), pt = at(x, th + 0.002);
    return pt.sub(p0).cross(px.sub(p0)).normalize();
  };
  // ring stations: superellipse-distributed in the rounded ends, uniform in between
  const stations = () => {
    const xs = [];
    const NE = 46;
    for (let k = 0; k <= NE; k++) {
      const phi = ((NE - k) / NE) * Math.PI / 2;
      xs.push(hL * (1 - ef + ef * Math.pow(Math.sin(phi), 2 / py)));
    }
    const xa = hL * (1 - ef), xb = -hL * (1 - er);
    const NM = Math.round((xa - xb) / 0.017);
    for (let k = 1; k < NM; k++) xs.push(xa - (xa - xb) * (k / NM));
    for (let k = 0; k <= NE; k++) {
      const phi = (k / NE) * Math.PI / 2;
      xs.push(-hL * (1 - er + er * Math.pow(Math.sin(phi), 2 / py)));
    }
    return xs;
  };
  return { spec, L, hL, ef, er, n, section, point, rawPoint, thetaForY, at, normalAt, archY, topF, stations };
}

// Points along the body at a constant height, wrapping around the nose/tail (for LED strips).
function lampPath(B, front, len, ynStart, zStop, offset) {
  const s0 = B.section(front ? B.hL - len : -B.hL + len);
  const yAbs = s0.yw + s0.hu * ynStart;
  const pts = [], nrms = [];
  const p = new THREE.Vector3();
  const N = 140;
  for (let k = 0; k <= N; k++) {
    const u = 1 - Math.pow(1 - k / N, 3);
    const x = front ? B.hL - len + len * u : -B.hL + len - len * u;
    const sec = B.section(x);
    const need = (yAbs - sec.yw) / ((yAbs >= sec.yw ? sec.hu : sec.hd) * Math.max(sec.sy, 1e-4));
    if (!(Math.abs(need) <= 0.985)) break;
    const th = B.thetaForY(need);
    B.rawPoint(sec, th, p);
    if (p.z < zStop) break;
    const nrm = B.normalAt(x, th);
    pts.push(p.clone().addScaledVector(nrm, offset));
    nrms.push(nrm);
  }
  return { pts, nrms, yAbs };
}

function buildBodyMesh(B, M, spec) {
  const xs = B.stations(), NX = xs.length - 1, NT = 168, hL = B.hL;
  const pos = new Float32Array((NX + 1) * NT * 3);
  const yns = new Float32Array((NX + 1) * NT);
  const clampedA = new Uint8Array((NX + 1) * NT);
  const p = new THREE.Vector3();
  for (let i = 0; i <= NX; i++) {
    const sec = B.section(xs[i]);
    for (let j = 0; j < NT; j++) {
      const k = i * NT + j;
      yns[k] = B.point(sec, (j / NT) * Math.PI * 2, p);
      clampedA[k] = p.clamped ? 1 : 0;
      pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
    }
  }
  const quad = (i, j) => [i * NT + j, i * NT + (j + 1) % NT, (i + 1) * NT + j, (i + 1) * NT + (j + 1) % NT];
  const full = [];
  for (let i = 0; i < NX; i++) for (let j = 0; j < NT; j++) { const [a, b, c, d] = quad(i, j); full.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(full);
  g.computeVertexNormals();
  const nor = g.attributes.normal.array;

  const tl = spec.tl;
  const s0 = B.section(-hL + 0.2);
  const classify = (i, j) => {
    const q = quad(i, j);
    if (q.every((v) => clampedA[v])) return 'tunnel';
    let x = 0, y = 0, z = 0, nx = 0, yn = 0;
    for (const v of q) { x += pos[v * 3]; y += pos[v * 3 + 1]; z += Math.abs(pos[v * 3 + 2]); nx += nor[v * 3]; yn += yns[v]; }
    x /= 4; y /= 4; z /= 4; nx /= 4; yn /= 4;
    // vertical walls of the wheel wells are liner, not paint
    if (q.filter((v) => clampedA[v]).length >= 2 && Math.abs(nx) > 0.45) return 'tunnel';
    if (tl && tl.block && nx < -0.45 && y > s0.yw - s0.hd * 0.1 && y < s0.yw + s0.hu * 0.75 && z > s0.hw * 0.66) return 'tailHousing';
    if (yn < spec.rocker) return 'trim';
    return 'paint';
  };
  const buckets = {};
  for (let i = 0; i < NX; i++) for (let j = 0; j < NT; j++) {
    const [a, b, c, d] = quad(i, j);
    (buckets[classify(i, j)] ||= []).push(a, b, c, b, d, c);
  }
  const names = Object.keys(buckets), index = [], mats = [];
  g.clearGroups();
  names.forEach((name, mi) => { g.addGroup(index.length, buckets[name].length, mi); for (const v of buckets[name]) index.push(v); mats.push(M[name]); });
  g.setIndex(index);
  return new THREE.Mesh(g, mats);
}

function groupedMesh(pos, buckets, M) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const names = Object.keys(buckets);
  const index = [];
  const mats = [];
  names.forEach((name, mi) => {
    g.addGroup(index.length, buckets[name].length, mi);
    for (const v of buckets[name]) index.push(v);
    mats.push(M[name]);
  });
  g.setIndex(index);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mats);
  mesh.castShadow = true;
  return mesh;
}

// ---------------------------------------------------------------- cabin / greenhouse
function makeCabin(B, spec) {
  const cab = spec.cabin;
  const roofF = profile(cab.roof);
  const NX = 170;
  const rings = [];
  const p = new THREE.Vector3();
  const rampF = cab.rampF ?? 0.08, rampR = cab.rampR ?? 0.08;
  for (let i = 0; i <= NX; i++) {
    const u = i / NX;
    const x = cab.x0 - (cab.x0 - cab.x1) * (0.5 * (0.5 - 0.5 * Math.cos(Math.PI * u)) + 0.5 * u);
    const sec = B.section(x);
    B.point(sec, 0, p);
    const zmax = p.z, target = zmax * cab.base;
    let yb = p.y, zb = zmax;
    for (let k = 0; k <= 240; k++) {
      B.point(sec, (k / 240) * Math.PI / 2, p);
      if (p.z <= target) { yb = p.y; zb = p.z; break; }
    }
    const rr = Math.min(smoothstep(0, rampF, cab.x0 - x), smoothstep(0, rampR, x - cab.x1));
    const top = Math.max(yb + 0.0005, yb + (roofF(x) - yb) * rr);
    rings.push({ x, yb, zb, hh: top - yb });
  }
  const nC = cab.n ?? 3.6, ctop = cab.top / cab.base;
  const point = (ring, th, out) => {
    const c = Math.cos(th), s = Math.sin(th);
    if (s >= 0) {
      const yn = sgnpow(s, 2 / nC);
      out.set(ring.x, ring.yb + ring.hh * yn, ring.zb * sgnpow(c, 2 / nC) * (1 - (1 - ctop) * Math.pow(yn, 1.6)));
      return yn;
    }
    out.set(ring.x, ring.yb + 0.04 * s, ring.zb * 0.96 * sgnpow(c, 2 / nC));
    return -Math.abs(s);
  };
  return { rings, point, nC };
}

function buildCabinMesh(C, M, spec) {
  const cab = spec.cabin;
  const NT = 140, rings = C.rings, NX = rings.length - 1;
  const pos = new Float32Array(rings.length * NT * 3);
  const yns = new Float32Array(rings.length * NT);
  const p = new THREE.Vector3();
  rings.forEach((ring, i) => {
    for (let j = 0; j < NT; j++) {
      const k = i * NT + j;
      yns[k] = C.point(ring, (j / NT) * Math.PI * 2, p);
      pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
    }
  });
  const roofY = cab.roofY ?? 0.8;
  const buckets = {};
  for (let i = 0; i < NX; i++) {
    const x = (rings[i].x + rings[i + 1].x) / 2;
    for (let j = 0; j < NT; j++) {
      const a = i * NT + j, b = i * NT + (j + 1) % NT, c = (i + 1) * NT + j, d = (i + 1) * NT + (j + 1) % NT;
      const yn = Math.min(yns[a], yns[b], yns[c], yns[d]);
      let m = 'glass';
      if (yn < 0) m = 'trim';
      else if (yn >= roofY && x < cab.roofBand[0] && x > cab.roofBand[1]) m = 'roof';
      else if (yn < roofY) for (const pl of cab.pillars) if (x > pl.x0 && x < pl.x1) m = pl.mat;
      (buckets[m] ||= []).push(a, b, c, b, d, c);
    }
  }
  return groupedMesh(pos, buckets, M);
}

// ---------------------------------------------------------------- wheels
const RIM_STYLES = {
  sport: { pairs: 5, rin: 0.4, rout: 0.86, spoke: 0.028 },
  aero: { count: 16, rin: 0.6, rout: 0.86, spoke: 0.022 },
  multi: { count: 14, rin: 0.42, rout: 0.88, spoke: 0.02 },
  offroad: { count: 6, rin: 0.44, rout: 0.8, spoke: 0.075 },
  classic: { count: 5, rin: 0.34, rout: 0.86, spoke: 0.05 },
};

function rimGeometry(Ri, styleName) {
  const st = RIM_STYLES[styleName] || RIM_STYLES.sport;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, Ri, 0, Math.PI * 2, false);
  const win = [];
  if (st.pairs) {
    const step = (Math.PI * 2) / st.pairs;
    for (let k = 0; k < st.pairs; k++) {
      const a = k * step;
      win.push([a, a + step * 0.17, 0.66], [a + step * 0.17, a + step, st.rin]);
    }
  } else {
    const step = (Math.PI * 2) / st.count;
    for (let k = 0; k < st.count; k++) win.push([k * step, (k + 1) * step, st.rin]);
  }
  const hw = st.spoke * Ri * 2.6;
  for (const [a0, a1, rinR] of win) {
    const ro = st.rout * Ri, ri = rinR * Ri;
    const oa0 = a0 + hw / ro, oa1 = a1 - hw / ro, ia0 = a0 + hw / ri, ia1 = a1 - hw / ri;
    if (oa1 <= oa0) continue;
    const path = new THREE.Path();
    path.absarc(0, 0, ro, oa0, oa1, false);
    if (ia1 > ia0) path.absarc(0, 0, ri, ia1, ia0, true);
    else { const m = (a0 + a1) / 2; path.lineTo(Math.cos(m) * ri * 1.15, Math.sin(m) * ri * 1.15); }
    path.closePath();
    shape.holes.push(path);
  }
  return new THREE.ExtrudeGeometry(shape, { depth: 0.028, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.006, bevelSegments: 2, curveSegments: 36 });
}

function buildWheel(spec, M, style) {
  const r = spec.r, w = spec.tireW, Ri = r * spec.rimRatio;
  const root = new THREE.Group();
  const spin = new THREE.Group();
  root.add(spin);
  const hw = w / 2;
  const prof = [
    [Ri * 0.98, -hw * 0.86], [r - 0.045, -hw], [r - 0.012, -hw * 0.92], [r, -hw * 0.62],
    [r, hw * 0.62], [r - 0.012, hw * 0.92], [r - 0.045, hw], [Ri * 0.98, hw * 0.86],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const tire = new THREE.Mesh(new THREE.LatheGeometry(prof, 72).rotateX(Math.PI / 2), M.rubber);
  spin.add(tire);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(Ri * 0.97, Ri * 0.97, w * 0.8, 48, 1, true).rotateX(Math.PI / 2), M.rimInner);
  spin.add(barrel);
  const back = new THREE.Mesh(new THREE.CircleGeometry(Ri * 0.97, 40), M.tunnel);
  back.position.z = -w * 0.3;
  back.rotation.y = 0;
  spin.add(back);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(Ri * 0.74, Ri * 0.74, 0.026, 48).rotateX(Math.PI / 2), M.disc);
  disc.position.z = w * 0.02;
  spin.add(disc);
  const faceZ = hw - 0.055;
  const rim = new THREE.Mesh(rimGeometry(Ri, style), M.rim);
  rim.position.z = faceZ - 0.04;
  spin.add(rim);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(Ri * 0.985, 0.011, 8, 72), M.rim);
  lip.position.z = faceZ - 0.012;
  spin.add(lip);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(Ri * 0.15, Ri * 0.17, 0.03, 32).rotateX(Math.PI / 2), M.gloss);
  cap.position.z = faceZ + 0.0;
  spin.add(cap);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.02, 10).rotateX(Math.PI / 2), M.chrome);
    nut.position.set(Math.cos(a) * Ri * 0.26, Math.sin(a) * Ri * 0.26, faceZ - 0.005);
    spin.add(nut);
  }
  // caliper (does not spin)
  const cs = new THREE.Shape();
  const a0 = Math.PI * 0.58, a1 = Math.PI * 0.92;
  cs.absarc(0, 0, Ri * 0.8, a0, a1, false);
  cs.absarc(0, 0, Ri * 0.52, a1, a0, true);
  cs.closePath();
  const cal = new THREE.Mesh(new THREE.ExtrudeGeometry(cs, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 12 }), M.caliper);
  cal.position.z = -0.005;
  root.add(cal);
  root.userData.spin = spin;
  return root;
}

// ---------------------------------------------------------------- details
function flipWinding(g) {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.index.needsUpdate = true;
  g.computeVertexNormals();
}

function mirrored(mesh) {
  const g = mesh.geometry.clone().scale(1, 1, -1);
  flipWinding(g);
  return new THREE.Mesh(g, mesh.material);
}

function tube(pts, radius, mat, segs = 160) {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, radius, 8, false), mat);
}

// Smooth band hugging the body along a path (lamp housings)
function ribbon(pts, nrms, half, lift, mat) {
  const pos = [], idx = [];
  const tan = new THREE.Vector3(), up = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    tan.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
    up.crossVectors(nrms[i], tan).normalize();
    const taper = Math.min(1, i / 4, (pts.length - 1 - i) / 4) * 0.5 + 0.5;
    for (const s of [1, -1]) {
      const v = pts[i].clone().addScaledVector(nrms[i], lift).addScaledVector(up, s * half * taper);
      pos.push(v.x, v.y, v.z);
    }
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  // make sure the band faces outward
  const n0 = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, 0);
  if (n0.dot(nrms[0]) < 0) flipWinding(g);
  return m;
}

// LED strips: one per side, or a single connected bar when `end === 0`
function addLamp(car, B, front, cfg, mat, housingMat, radius) {
  const zStop = cfg.end === 0 ? 0 : B.section(front ? B.hL - cfg.len : -B.hL + cfg.len).hw * cfg.end;
  const { pts, nrms, yAbs } = lampPath(B, front, cfg.len, cfg.y, zStop, radius * 0.4);
  if (pts.length < 3) return { yAbs, zStop };
  const base = pts.map((p, i) => p.clone().addScaledVector(nrms[i], -radius * 0.4));
  const house = ribbon(base, nrms, cfg.band || 0.03, 0.002, housingMat);
  if (cfg.end === 0) {
    car.add(house, mirrored(house));
  } else {
    car.add(house, mirrored(house));
  }
  if (cfg.end === 0) {
    const last = pts[pts.length - 1];
    const bridge = [];
    for (let k = 1; k <= 6; k++) bridge.push(new THREE.Vector3(last.x + (front ? 0.004 : -0.004), last.y, last.z * (1 - k / 6)));
    const right = pts.concat(bridge);
    const all = right.concat(right.slice(0, -1).reverse().map((v) => new THREE.Vector3(v.x, v.y, -v.z)));
    car.add(tube(all, radius, mat, 320));
  } else {
    const m = tube(pts, radius, mat);
    car.add(m, mirrored(m));
  }
  return { yAbs, zStop };
}


// Honeycomb grille texture (generated once)
const _gridTex = {};
function grilleTexture(light = false) {
  if (_gridTex[light]) return _gridTex[light];
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = light ? '#15171a' : '#050506';
  ctx.fillRect(0, 0, 256, 128);
  const r = 9, h = Math.sqrt(3) * r;
  ctx.lineWidth = 2.6;
  for (let row = -1; row < 128 / h + 1; row++) {
    for (let col = -1; col < 256 / (r * 3) + 1; col++) {
      const cx = col * r * 3 + (row % 2 ? r * 1.5 : 0), cy = row * h * 0.5 * 1.0;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = (Math.PI / 3) * k; ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
      ctx.closePath();
      ctx.strokeStyle = light ? '#e8ebee' : '#3a3d42';
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return (_gridTex[light] = tex);
}

// Find the point on the nose/tail surface at height y and lateral offset z.
function facePoint(B, front, y, z) {
  const ezone = front ? B.ef : B.er;
  const p = new THREE.Vector3();
  const zAt = (t) => {
    const x = front ? B.hL * (1 - ezone + ezone * t) : -B.hL * (1 - ezone + ezone * t);
    const sec = B.section(x);
    const yn = (y - sec.yw) / ((y >= sec.yw ? sec.hu : sec.hd) * Math.max(sec.sy, 1e-5));
    if (Math.abs(yn) > 1) return { z: -1, x };
    B.rawPoint(sec, B.thetaForY(yn), p);
    return { z: Math.abs(p.z), x, th: B.thetaForY(yn) };
  };
  let lo = 0, hi = 1;
  if (zAt(0).z < z) return null;
  for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (zAt(m).z >= z) lo = m; else hi = m; }
  const r = zAt(lo);
  return { p: new THREE.Vector3(r.x, y, z), x: r.x, th: r.th };
}

function facePatch(B, front, y0, y1, w, mat, round = 3.2, lift = 0.005) {
  const NY = 14, NZ = 28;
  const pos = [], uv = [], idx = [];
  for (let iy = 0; iy <= NY; iy++) {
    const v = iy / NY, vn = v * 2 - 1;
    const y = y0 + (y1 - y0) * v;
    const zr = w * Math.pow(1 - Math.pow(Math.abs(vn), round), 1 / round);
    for (let iz = 0; iz <= NZ; iz++) {
      const u = iz / NZ, z = (u * 2 - 1) * zr;
      const fp = facePoint(B, front, y, Math.abs(z)) || facePoint(B, front, y, 0);
      const pt = fp ? fp.p : new THREE.Vector3(front ? B.hL : -B.hL, y, 0);
      pt.z = z;
      pos.push(pt.x + (front ? lift : -lift), pt.y, pt.z);
      uv.push((z + w) / (2 * w) * (w * 2 / 0.3), (y - y0) / 0.15);
    }
  }
  for (let iy = 0; iy < NY; iy++) for (let iz = 0; iz < NZ; iz++) {
    const a = iy * (NZ + 1) + iz, b = a + 1, c = a + NZ + 1, d = c + 1;
    if (front) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// Thin dark line running down the body side at a given x (door shut lines)
function seamLine(B, x, yTop, mat) {
  const sec = B.section(x);
  const pts = [];
  const ynTop = Math.min(0.98, (yTop - sec.yw) / sec.hu);
  for (let k = 0; k <= 24; k++) {
    const yn = (B.spec.rocker + 0.06) + (ynTop - (B.spec.rocker + 0.06)) * (k / 24);
    const th = B.thetaForY(yn);
    const p = new THREE.Vector3();
    B.point(sec, th, p);
    if (p.clamped) continue;
    pts.push(p.addScaledVector(B.normalAt(x, th), 0.0015));
  }
  if (pts.length < 3) return null;
  return tube(pts, 0.0035, mat, 40);
}

// ---------------------------------------------------------------- public API
export function buildCar(opts = {}) {
  const spec = BODY_TYPES[opts.type] || BODY_TYPES.coupe;
  const M = makeMaterials(opts);
  const car = new THREE.Group();
  car.name = 'car';
  const B = makeBody(spec);
  B.grilleMat = opts.grille;

  // lights first: the body uses their placement for the lamp housings
  if (spec.hl) addLamp(car, B, true, spec.hl, M.head, M.lamp, 0.014);
  if (spec.tl && !spec.tl.block) addLamp(car, B, false, spec.tl, M.tail, M.tailHousing, 0.013);
  if (spec.tl && spec.tl.block) {
    const x = -B.hL + B.er * B.hL * 0.25;
    const sec = B.section(x);
    const pts = [];
    for (let k = 0; k <= 20; k++) {
      const yn = -0.05 + (k / 20) * 0.72;
      const th = B.thetaForY(yn);
      const p = new THREE.Vector3();
      B.rawPoint(sec, th, p);
      pts.push(p.addScaledVector(B.normalAt(x, th), 0.012));
    }
    const m = tube(pts, 0.03, M.tail, 40);
    car.add(m, mirrored(m));
  }

  car.add(buildBodyMesh(B, M, spec));

  const C = makeCabin(B, spec);
  car.add(buildCabinMesh(C, M, spec));

  // grilles, emblem, door lines and handles
  M.grilleMesh = new THREE.MeshStandardMaterial({ map: grilleTexture(), metalness: 0.6, roughness: 0.45 });
  M.grilleChrome = new THREE.MeshStandardMaterial({ map: grilleTexture(true), metalness: 1, roughness: 0.18 });
  (spec.grilles || []).forEach((gr, gi) => {
    if (gi === 0 && opts.noGrille) return;
    const mat = (gi === 0 && opts.grille === 'chrome') || gr.mat === 'chromeGrille' ? M.grilleChrome : M.grilleMesh;
    car.add(facePatch(B, true, gr.y[0], gr.y[1], gr.w, mat, gr.round || 3.4));
  });
  {
    // rear diffuser panel
    const sr = B.section(-B.hL + 0.25);
    const yb = sr.yw - sr.hd;
    car.add(facePatch(B, false, yb + 0.07, yb + 0.07 + Math.min(0.16, sr.hd * 0.55), sr.hw * 0.72, M.trim, 4));
  }
  if (spec.grilles && !spec.ev && !opts.noGrille) {
    const g0 = spec.grilles[0];
    const fp = facePoint(B, true, (g0.y[0] + g0.y[1]) / 2, 0);
    if (fp) {
      const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 32).rotateZ(Math.PI / 2), M.chrome);
      badge.position.copy(fp.p).add(new THREE.Vector3(0.012, 0, 0));
      car.add(badge);
    }
  }
  if (spec.truckBars) for (const yb of spec.truckBars) {
    const pts = [];
    for (let k = 0; k <= 20; k++) {
      const z = -spec.grilles[0].w * 1.02 + (k / 20) * spec.grilles[0].w * 2.04;
      const fp = facePoint(B, true, yb, Math.abs(z));
      if (fp) pts.push(new THREE.Vector3(fp.x + 0.018, yb, z));
    }
    if (pts.length > 4) car.add(tube(pts, 0.022, opts.grille === 'chrome' ? M.chrome : M.paint, 40));
  }
  const seamMat = M.tunnel;
  const doorX = spec.doors || [];
  for (const dx of doorX) {
    const ring = C.rings.reduce((a, r) => (Math.abs(r.x - dx) < Math.abs(a.x - dx) ? r : a), C.rings[0]);
    const s = seamLine(B, dx, ring.yb - 0.01, seamMat);
    if (s) car.add(s, mirrored(s));
  }
  for (const hx of spec.handles || []) {
    const ring = C.rings.reduce((a, r) => (Math.abs(r.x - hx) < Math.abs(a.x - hx) ? r : a), C.rings[0]);
    const sec = B.section(hx);
    const yH = ring.yb - 0.085;
    const yn = (yH - sec.yw) / sec.hu;
    const th = B.thetaForY(yn);
    const p = new THREE.Vector3();
    B.point(sec, th, p);
    const nrm = B.normalAt(hx, th);
    const h = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.11, 4, 10).rotateZ(Math.PI / 2), spec.chromeTrim ? M.chrome : M.paint);
    h.position.copy(p).addScaledVector(nrm, 0.009);
    h.lookAt(h.position.clone().add(nrm));
    h.rotateZ(0);
    car.add(h, (() => { const m2 = h.clone(); m2.position.z *= -1; m2.rotation.y = Math.PI - h.rotation.y; return m2; })());
  }

  // window trim line
  const trimMat = spec.chromeTrim || opts.chromeTrim ? M.chrome : M.gloss;
  const belt = C.rings.filter((_, i) => i % 3 === 0).map((r) => new THREE.Vector3(r.x, r.yb + 0.004, r.zb + 0.004));
  if (belt.length > 3) {
    const m = tube(belt, 0.009, trimMat, 120);
    car.add(m, mirrored(m));
  }

  // mirrors
  const mr = C.rings.find((r) => r.x < spec.cabin.x0 - 0.22) || C.rings[5];
  for (const sgn of [1, -1]) {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), M.paint);
    shell.scale.set(0.075, 0.048, 0.105);
    shell.position.set(mr.x - 0.03, mr.yb + 0.075, sgn * (mr.zb + 0.12));
    const face = new THREE.Mesh(new THREE.CircleGeometry(1, 24), M.gloss);
    face.scale.set(0.044, 0.1, 1);
    face.rotation.y = -Math.PI / 2;
    face.position.set(mr.x - 0.104, mr.yb + 0.075, sgn * (mr.zb + 0.12));
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.022, 0.12), M.trim);
    stem.position.set(mr.x - 0.01, mr.yb + 0.05, sgn * (mr.zb + 0.05));
    car.add(shell, face, stem);
  }

  // wheels
  const wheels = [];
  for (const ax of [spec.fx, spec.rx]) {
    const sec = B.section(ax);
    const p = new THREE.Vector3();
    B.point(sec, 0, p);
    const zw = p.z - spec.tireW / 2 - 0.02;
    for (const sgn of [1, -1]) {
      const w = buildWheel(spec, M, opts.rim || 'sport');
      w.position.set(ax, spec.r, sgn * zw);
      if (sgn < 0) w.rotation.y = Math.PI;
      w.userData.side = sgn;
      car.add(w);
      wheels.push(w);
    }
  }

  // type extras
  if (spec.wing) {
    const wg = spec.wing;
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.quadraticCurveTo(wg.chord * 0.4, 0.05, wg.chord, 0.015); s.lineTo(wg.chord, -0.005); s.quadraticCurveTo(wg.chord * 0.4, 0.0, 0, -0.012); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: wg.w, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2 });
    geo.translate(-wg.chord / 2, 0, -wg.w / 2);
    const wing = new THREE.Mesh(geo, M.gloss);
    wing.rotation.z = Math.PI; wing.position.set(wg.x, wg.y, 0);
    car.add(wing);
    for (const sgn of [1, -1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.02), M.gloss);
      post.position.set(wg.x + 0.03, wg.y - 0.1, sgn * wg.w * 0.3);
      car.add(post);
    }
  }
  if (spec.spoiler) {
    const last = C.rings[C.rings.length - 6];
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, last.zb * 1.7), M.gloss);
    sp.position.set(last.x - 0.08, last.yb + last.hh + 0.0, 0);
    sp.rotation.z = 0.12;
    car.add(sp);
  }
  if (spec.rails) {
    const cab = spec.cabin;
    for (const sgn of [1, -1]) {
      const pts = [];
      const p = new THREE.Vector3();
      for (const ring of C.rings) {
        if (ring.x > cab.roofBand[0] - 0.05 || ring.x < cab.roofBand[1] + 0.05) continue;
        // find roof-edge point at ~62% of half width
        let best = null;
        for (let k = 0; k <= 60; k++) {
          const th = Math.PI / 2 - (k / 60) * Math.PI / 2;
          C.point(ring, th, p);
          if (p.z >= ring.zb * 0.48) { best = p.clone(); break; }
        }
        if (best) pts.push(new THREE.Vector3(best.x, best.y + 0.05, sgn * best.z));
      }
      if (pts.length > 4) {
        const sampled = pts.filter((_, i) => i % 4 === 0);
        car.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sampled), 80, 0.018, 8, false), M.gloss));
      }
    }
  }
  if (spec.bed) {
    const bd = spec.bed;
    const len = bd.x0 - bd.x1;
    const sec = B.section((bd.x0 + bd.x1) / 2);
    const top = B.topF((bd.x0 + bd.x1) / 2);
    const cover = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, sec.hw * 1.72), M.trim);
    cover.position.set((bd.x0 + bd.x1) / 2, top + 0.006, 0);
    car.add(cover);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.012, top - 0.4, sec.hw * 2.06), M.tunnel);
    seam.position.set(bd.x0 + 0.02, (top + 0.4) / 2 + 0.01, 0);
    car.add(seam);
    // tailgate seam
    const seam2 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, sec.hw * 1.9), M.tunnel);
    seam2.position.set(-B.hL + 0.02, top - 0.03, 0);
    car.add(seam2);
  }

  car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  car.userData = {
    spec, wheels, paint: M.paint, materials: M,
    dims: { L: spec.L, W: (Math.max(...spec.hw.map((h) => h[1])) + 0.03) * 2, fx: spec.fx, rx: spec.rx, zw: wheels[0].position.z, H: Math.max(...spec.cabin.roof.map((r) => r[1])) },
  };
  return car;
}

export function disposeCar(car) {
  const mats = new Set();
  car.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
    }
  });
  mats.forEach((m) => m.dispose());
}
