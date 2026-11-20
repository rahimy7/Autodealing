import { createHmac, timingSafeEqual } from "node:crypto";

// Enlaces firmados a los archivos guardados en la base (api-server/src/lib/supabase.ts, cuando no
// hay Supabase Storage). Meta e Instagram descargan la imagen de una bienvenida o de una campaña
// por su cuenta, sin sesión, así que el enlace lleva su propia firma y caduca: la manda a quien
// lo recibe el servidor y solo sirve para ese archivo hasta esa hora.

const sign = (secret: string, path: string, exp: number) =>
  createHmac("sha256", secret).update(`media:${path}:${exp}`).digest("hex");

/** La firma de `path` hasta `exp` (segundos Unix). */
export function signMediaPath(secret: string, path: string, exp: number): string {
  return sign(secret, path, exp);
}

/** ¿La firma es de este archivo, con este secreto, y no ha caducado? */
export function verifyMediaSignature(
  secret: string,
  path: string,
  exp: number,
  signature: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !Number.isFinite(exp) || exp < nowSeconds) return false;
  const expected = Buffer.from(sign(secret, path, exp), "hex");
  const given = Buffer.from(/^[0-9a-f]{64}$/i.test(signature) ? signature : "", "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
