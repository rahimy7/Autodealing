import crypto from "node:crypto";
import { promisify } from "node:util";
import { logger } from "./logger";

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const isProd = process.env.NODE_ENV === "production";

export type Role = "admin" | "agent";
export type AuthUser = {
  role: Role;
  name: string;
  email: string;
  agentId: number | null;
};

// ── Session secret ────────────────────────────────────────────────────────────
function resolveSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) return fromEnv;
  if (isProd) {
    throw new Error("SESSION_SECRET must be set in production.");
  }
  logger.warn("SESSION_SECRET not set — using an ephemeral dev secret (tokens reset on restart).");
  return crypto.randomBytes(32).toString("hex");
}
const SESSION_SECRET = resolveSessionSecret();
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

// ── Admin credentials ─────────────────────────────────────────────────────────
// Configured via env. In development we fall back to a documented demo account so
// the app stays usable out of the box; in production the env vars are required.
export function getAdminCredentials(): { email: string; password: string } | null {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) return { email, password };
  if (isProd) return null;
  return { email: "admin@decolor.com", password: "demo" };
}

// ── Password hashing (scrypt) ─────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Constant-time comparison for plain-text values (admin env password).
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ── Stateless HMAC-signed session token ───────────────────────────────────────
type TokenPayload = AuthUser & { exp: number };

const b64u = (buf: Buffer) => buf.toString("base64url");

function sign(body: string): string {
  return b64u(crypto.createHmac("sha256", SESSION_SECRET).update(body).digest());
}

export function signToken(user: AuthUser): string {
  const payload: TokenPayload = { ...user, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS };
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  return `${body}.${sign(body)}`;
}

// ── Signed one-off payloads (e.g. the OAuth `state` of an external login) ─────
// Same secret as the session, but the purpose is part of what gets signed, so a
// session token can never pass for a state value and vice versa.
export function signPayload(purpose: string, data: Record<string, unknown>, ttlSeconds: number): string {
  const body = b64u(Buffer.from(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  return `${body}.${sign(`${purpose}.${body}`)}`;
}

export function verifyPayload(purpose: string, token: string): Record<string, unknown> | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(`${purpose}.${body}`));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifyToken(token: string): AuthUser | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    return { role: payload.role, name: payload.name, email: payload.email, agentId: payload.agentId ?? null };
  } catch {
    return null;
  }
}
