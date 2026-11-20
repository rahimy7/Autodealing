// A random password for a new account or a reset, from the phone's secure random source.
import * as Crypto from "expo-crypto";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export function strongPassword() {
  const bytes = Crypto.getRandomBytes(16);
  return Array.from(bytes, (b) => CHARS[b % CHARS.length]).join("").replace(/(.{4})(?!$)/g, "$1-");
}
