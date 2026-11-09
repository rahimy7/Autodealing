import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Set env before importing the module so SESSION_SECRET is deterministic.
process.env.SESSION_SECRET = "test-session-secret-do-not-use-in-prod";
process.env.NODE_ENV = "test";

const {
  hashPassword,
  verifyPassword,
  safeEqual,
  signToken,
  verifyToken,
  getAdminCredentials,
} = await import("../src/lib/auth.js");

describe("lib/auth — password hashing (scrypt)", () => {
  it("hashPassword produces a scrypt$<salt>$<key> string", async () => {
    const hash = await hashPassword("s3cret!");
    const [scheme, salt, key] = hash.split("$");
    assert.equal(scheme, "scrypt");
    assert.ok(salt && /^[0-9a-f]+$/i.test(salt), "salt is hex");
    assert.ok(key && /^[0-9a-f]+$/i.test(key), "key is hex");
    assert.equal(Buffer.from(salt, "hex").length, 16);
    assert.equal(Buffer.from(key, "hex").length, 64);
  });

  it("verifyPassword accepts the original password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  });

  it("verifyPassword rejects the wrong password", async () => {
    const hash = await hashPassword("hunter2");
    assert.equal(await verifyPassword("hunter3", hash), false);
  });

  it("verifyPassword rejects a null / malformed stored value", async () => {
    assert.equal(await verifyPassword("whatever", null), false);
    assert.equal(await verifyPassword("whatever", ""), false);
    assert.equal(await verifyPassword("whatever", "not-a-hash"), false);
    assert.equal(await verifyPassword("whatever", "bcrypt$abc$def"), false);
  });

  it("two hashes for the same password differ (unique salts)", async () => {
    const a = await hashPassword("same-input");
    const b = await hashPassword("same-input");
    assert.notEqual(a, b);
  });
});

describe("lib/auth — safeEqual", () => {
  it("returns true for identical strings", () => {
    assert.equal(safeEqual("token-abc", "token-abc"), true);
  });
  it("returns false for different strings of the same length", () => {
    assert.equal(safeEqual("token-abc", "token-abd"), false);
  });
  it("returns false for strings of different length (no throw)", () => {
    assert.equal(safeEqual("short", "longer-string"), false);
  });
});

describe("lib/auth — signToken / verifyToken", () => {
  const user = { role: "admin" as const, name: "Ada", email: "ada@example.com", agentId: null };

  it("roundtrips a valid user", () => {
    const token = signToken(user);
    const decoded = verifyToken(token);
    assert.ok(decoded, "decoded is not null");
    assert.equal(decoded!.email, user.email);
    assert.equal(decoded!.role, "admin");
    assert.equal(decoded!.agentId, null);
  });

  it("token is <body>.<signature>", () => {
    const token = signToken(user);
    const parts = token.split(".");
    assert.equal(parts.length, 2);
    assert.ok(parts[0].length > 0);
    assert.ok(parts[1].length > 0);
  });

  it("rejects a tampered body", () => {
    const token = signToken(user);
    const [, sig] = token.split(".");
    const tamperedBody = Buffer.from(
      JSON.stringify({ ...user, exp: 9_999_999_999 }),
    ).toString("base64url");
    assert.equal(verifyToken(`${tamperedBody}.${sig}`), null);
  });

  it("rejects a tampered signature", () => {
    const token = signToken(user);
    const [body] = token.split(".");
    assert.equal(verifyToken(`${body}.aaaaaaaa`), null);
  });

  it("rejects a malformed token", () => {
    assert.equal(verifyToken(""), null);
    assert.equal(verifyToken("no-dot"), null);
    assert.equal(verifyToken("foo.bar.baz"), null);
  });

  it("rejects an expired token", () => {
    // Build an already-expired payload but sign it with the real secret by
    // reusing the module's signing path: we sign a fresh token, then swap the
    // body for one with exp in the past and re-sign it via HMAC ourselves.
    const body = Buffer.from(
      JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) - 60 }),
    ).toString("base64url");
    const sig = crypto
      .createHmac("sha256", process.env.SESSION_SECRET!)
      .update(body)
      .digest()
      .toString("base64url");
    assert.equal(verifyToken(`${body}.${sig}`), null);
  });
});

describe("lib/auth — getAdminCredentials", () => {
  before(() => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
  });

  it("falls back to demo creds when env vars are absent (dev)", () => {
    const creds = getAdminCredentials();
    assert.ok(creds, "creds present in dev");
    assert.equal(creds!.email, "admin@decolor.com");
  });

  it("uses env-configured admin when provided", () => {
    process.env.ADMIN_EMAIL = "owner@example.com";
    process.env.ADMIN_PASSWORD = "very-strong";
    const creds = getAdminCredentials();
    assert.deepEqual(creds, { email: "owner@example.com", password: "very-strong" });
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
  });
});
