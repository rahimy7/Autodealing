// Turns the model's soft alpha mask into a usable vehicle mask. The model treats glass and grilles
// as background and sometimes keeps scraps of the scene, so this keeps the largest subject and fills
// everything enclosed by it, while leaving the soft outer edge untouched.
const MIN_COVERAGE = 0.015; // Below this share of the frame there is no real subject.

function dilate(source, width, height, radius) {
  const across = new Uint8Array(source.length);
  const result = new Uint8Array(source.length);
  const sweep = (input, output, lines, length, lineStep, pixelStep) => {
    for (let line = 0; line < lines; line++) {
      const start = line * lineStep;
      for (const [from, to, step] of [[0, length, 1], [length - 1, -1, -1]]) {
        let distance = radius + 1;
        for (let i = from; i !== to; i += step) {
          const at = start + i * pixelStep;
          distance = input[at] ? 0 : distance + 1;
          if (distance <= radius) output[at] = 1;
        }
      }
    }
  };
  sweep(source, across, height, width, width, 1);
  sweep(across, result, width, height, 1, width);
  return result;
}

function largestComponent(solid, width) {
  const labels = new Int32Array(solid.length);
  const stack = new Int32Array(solid.length);
  let best = 0, bestArea = 0, next = 0;
  for (let seed = 0; seed < solid.length; seed++) {
    if (!solid[seed] || labels[seed]) continue;
    next++;
    let top = 0, area = 0;
    stack[top++] = seed;
    labels[seed] = next;
    while (top) {
      const at = stack[--top];
      area++;
      const x = at % width;
      for (const near of [x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1, at - width, at + width]) {
        if (near < 0 || near >= solid.length || !solid[near] || labels[near]) continue;
        labels[near] = next;
        stack[top++] = near;
      }
    }
    if (area > bestArea) { best = next; bestArea = area; }
  }
  const kept = new Uint8Array(solid.length);
  if (best) for (let i = 0; i < solid.length; i++) if (labels[i] === best) kept[i] = 1;
  return { kept, area: bestArea };
}

// Marks what can be reached from the frame border without crossing a wall.
function outsideOf(walls, width, height) {
  const outside = new Uint8Array(walls.length);
  const stack = new Int32Array(walls.length);
  let top = 0;
  const visit = (at) => { if (!walls[at] && !outside[at]) { outside[at] = 1; stack[top++] = at; } };
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
  while (top) {
    const at = stack[--top];
    const x = at % width;
    if (x > 0) visit(at - 1);
    if (x < width - 1) visit(at + 1);
    if (at >= width) visit(at - width);
    if (at < walls.length - width) visit(at + width);
  }
  return outside;
}

// `alpha` holds one byte per pixel. Returns a new mask, or null when no subject was found.
export function cleanMask(alpha, width, height, { threshold = 128, sealRatio = 0.006 } = {}) {
  if (alpha.length !== width * height) throw new RangeError('Mask size does not match its dimensions.');
  const solid = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) if (alpha[i] >= threshold) solid[i] = 1;
  const { kept, area } = largestComponent(solid, width);
  if (area < alpha.length * MIN_COVERAGE) return null;
  // Close small gaps first so a window with a thin frame still counts as enclosed.
  const radius = Math.max(1, Math.round(Math.min(width, height) * sealRatio));
  const outside = dilate(outsideOf(dilate(kept, width, height, radius), width, height), width, height, radius);
  const edge = dilate(kept, width, height, radius * 2);
  const result = new Uint8ClampedArray(alpha.length);
  for (let i = 0; i < alpha.length; i++) {
    if (!outside[i]) result[i] = 255;
    else if (edge[i]) result[i] = alpha[i];
  }
  return result;
}
