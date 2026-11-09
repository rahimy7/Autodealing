import sharp from "sharp";
import { InputError } from "./domain.js";

const MIN_COVERAGE = 0.01;

// The mask only says which pixels stay. The colour always comes from the stored photo, so an
// upload can't replace what the catalogue shows and the cutout stays aligned with the original.
export async function composeCutout(photo, mask) {
  const { width, height } = await sharp(photo).metadata();
  let channel;
  try {
    const source = sharp(mask, {
      limitInputPixels: 40_000_000,
      animated: false,
    });
    const info = await source.metadata();
    if (info.width !== width || info.height !== height)
      throw new InputError("La máscara no coincide con la foto.");
    channel = await source.extractChannel(0).raw().toBuffer();
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("La máscara no se pudo procesar. Vuelve a quitar el fondo.");
  }
  const opaque = channel.reduce((count, value) => count + (value > 127), 0);
  if (opaque < width * height * MIN_COVERAGE)
    throw new InputError("No se detectó ningún vehículo en la foto.");
  // flatten, not removeAlpha: sharp runs removeAlpha after joinChannel, which would drop the mask.
  return sharp(photo)
    .flatten({ background: "#ffffff" })
    .joinChannel(channel, { raw: { width, height, channels: 1 } })
    .webp({ quality: 88, alphaQuality: 90 })
    .toBuffer();
}
