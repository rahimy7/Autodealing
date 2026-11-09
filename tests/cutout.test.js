import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { cleanMask } from "../admin/mask-cleanup.js";
import { composeCutout } from "../server/cutout.js";
import { publicVehicle } from "../server/domain.js";

const WIDTH = 100;
const HEIGHT = 100;
// Builds a mask from rectangles of [left, top, right, bottom, value], in that painting order.
function mask(...rects) {
  const alpha = new Uint8ClampedArray(WIDTH * HEIGHT);
  for (const [left, top, right, bottom, value = 255] of rects)
    for (let y = top; y < bottom; y++)
      for (let x = left; x < right; x++) alpha[y * WIDTH + x] = value;
  return alpha;
}
const at = (alpha, x, y) => alpha[y * WIDTH + x];
const clean = (alpha) => cleanMask(alpha, WIDTH, HEIGHT);

test("cleanMask fills windows and other holes enclosed by the vehicle", () => {
  const result = clean(mask([20, 20, 80, 80], [40, 40, 60, 60, 0]));
  assert.equal(at(result, 50, 50), 255);
});
test("cleanMask seals a window whose frame has a thin gap", () => {
  const result = clean(
    mask([20, 20, 80, 80], [40, 40, 60, 60, 0], [50, 20, 51, 40, 0]),
  );
  assert.equal(at(result, 50, 50), 255);
});
test("cleanMask leaves an open gap under the vehicle transparent", () => {
  const result = clean(mask([20, 20, 80, 60], [20, 60, 30, 80], [70, 60, 80, 80]));
  assert.equal(at(result, 50, 75), 0);
  assert.equal(at(result, 50, 99), 0);
});
test("cleanMask drops scraps of the scene away from the vehicle", () => {
  const result = clean(mask([30, 30, 80, 80], [2, 2, 12, 12]));
  assert.equal(at(result, 6, 6), 0);
  assert.equal(at(result, 50, 50), 255);
});
test("cleanMask keeps the soft outer edge of the vehicle", () => {
  const result = clean(mask([30, 30, 70, 70], [28, 30, 30, 70, 90]));
  assert.equal(at(result, 29, 50), 90);
});
test("cleanMask drops faint haze far from the vehicle", () => {
  const result = clean(mask([0, 0, 100, 100, 60], [40, 40, 60, 60]));
  assert.equal(at(result, 5, 5), 0);
});
test("cleanMask handles a vehicle cropped by the frame", () => {
  const result = clean(mask([0, 40, 100, 100], [40, 60, 60, 80, 0]));
  assert.equal(at(result, 50, 70), 255);
  assert.equal(at(result, 50, 10), 0);
});
test("cleanMask reports photos with no real subject", () => {
  assert.equal(clean(mask()), null);
  assert.equal(clean(mask([50, 50, 52, 52])), null);
});
test("cleanMask rejects a mask of the wrong size", () => {
  assert.throws(() => cleanMask(new Uint8Array(10), WIDTH, HEIGHT), RangeError);
});

const image = (width, height, background) =>
  sharp({ create: { width, height, channels: 3, background } });
const pixelAt = async (buffer, x, y) => {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
};

const leftHalfMask = async () =>
  image(60, 40, "#000000")
    .composite([{ input: await image(30, 40, "#ffffff").png().toBuffer(), left: 0, top: 0 }])
    .png()
    .toBuffer();

test("composeCutout takes colour from the stored photo and alpha from the mask", async () => {
  const photo = await image(60, 40, "#c02020").webp({ lossless: true }).toBuffer();
  const result = await composeCutout(photo, await leftHalfMask());
  const info = await sharp(result).metadata();
  assert.equal(info.format, "webp");
  assert.equal(info.hasAlpha, true);
  assert.deepEqual([info.width, info.height], [60, 40]);
  const [red, green, , alpha] = await pixelAt(result, 10, 20);
  assert.ok(red > 170 && green < 60, `expected the photo's red, got ${red},${green}`);
  assert.ok(alpha > 245);
  assert.ok((await pixelAt(result, 50, 20))[3] < 10);
});
test("composeCutout replaces any transparency the photo already had", async () => {
  const photo = await sharp({
    create: { width: 60, height: 40, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0.5 } },
  })
    .webp({ lossless: true })
    .toBuffer();
  const result = await composeCutout(photo, await leftHalfMask());
  assert.ok((await pixelAt(result, 10, 20))[3] > 245);
  assert.ok((await pixelAt(result, 50, 20))[3] < 10);
});
test("composeCutout rejects masks that can't belong to the photo", async () => {
  const photo = await image(60, 40, "#c02020").webp().toBuffer();
  const white = (width, height) => image(width, height, "#ffffff").png().toBuffer();
  await assert.rejects(composeCutout(photo, await white(40, 60)), /no coincide/);
  await assert.rejects(
    composeCutout(photo, await image(60, 40, "#000000").png().toBuffer()),
    /ningún vehículo/,
  );
  await assert.rejects(
    composeCutout(photo, Buffer.from("not an image")),
    /no se pudo procesar/,
  );
});
test("public vehicles list a cutout only for photos that have one", () => {
  const vehicle = publicVehicle({ id: "v", data: {} }, [
    { id: "a", cutout: true },
    { id: "b", cutout: false },
  ]);
  assert.deepEqual(vehicle.cutouts, ["/media/vehicles/v/a/cutout.webp", null]);
  assert.equal(vehicle.photos.length, vehicle.cutouts.length);
});
