import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// `push.ts` pulls in the db package, which refuses to load without a connection
// string. Nothing here issues a query, so a placeholder is enough — the pool is
// lazy and never dials.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";

const { buildFcmMessage, classifyFcmError, buildAssertion } = await import("../src/lib/push-fcm.js");
const { buildApnsPayload, classifyApnsError, buildProviderToken } = await import("../src/lib/push-apns.js");
const { isValidDeviceToken } = await import("../src/lib/push.js");

function decodeSegment(jwt: string, index: number): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split(".")[index], "base64url").toString());
}

describe("push-fcm — buildFcmMessage", () => {
  it("stringifies every data value, because FCM only carries strings", () => {
    const message = buildFcmMessage({
      token: "tok",
      title: "Ana · WhatsApp",
      body: "Hola",
      data: { type: "message", conversationId: 42, channel: undefined },
      channelId: "messages",
      tag: "conversation-42",
    }) as { message: { data: Record<string, string>; android: { notification: Record<string, string> } } };

    assert.deepEqual(message.message.data, { type: "message", conversationId: "42" });
    assert.equal(message.message.android.notification.tag, "conversation-42");
    assert.equal(message.message.android.notification.channel_id, "messages");
  });

  it("omits the tag when there is no thread to group by", () => {
    const message = buildFcmMessage({
      token: "tok",
      title: "t",
      body: "b",
      data: {},
      channelId: "messages",
    }) as { message: { android: { notification: Record<string, string> } } };

    assert.equal("tag" in message.message.android.notification, false);
  });
});

describe("push-fcm — classifyFcmError", () => {
  it("treats an unregistered token as prunable", () => {
    const result = classifyFcmError(
      404,
      JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }),
    );
    assert.equal(result.status, "unregistered");
  });

  it("keeps a token when the failure is transient", () => {
    const result = classifyFcmError(503, JSON.stringify({ error: { status: "UNAVAILABLE" } }));
    assert.equal(result.status, "error");
  });

  it("survives a non-JSON body", () => {
    assert.equal(classifyFcmError(500, "<html>oops</html>").status, "error");
    assert.equal(classifyFcmError(404, "not found").status, "unregistered");
  });
});

describe("push-fcm — buildAssertion", () => {
  it("signs an RS256 JWT the token endpoint will accept", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    const jwt = buildAssertion(
      { project_id: "demo", client_email: "svc@demo.iam.gserviceaccount.com", private_key: pem },
      1_700_000_000,
    );

    const [header, claims, signature] = jwt.split(".");
    assert.deepEqual(decodeSegment(jwt, 0), { alg: "RS256", typ: "JWT" });
    assert.deepEqual(decodeSegment(jwt, 1), {
      iss: "svc@demo.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });

    const verified = crypto
      .createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature, "base64url"));
    assert.equal(verified, true);
  });
});

describe("push-apns — buildApnsPayload", () => {
  it("puts the alert under aps and the routing data alongside it", () => {
    const payload = buildApnsPayload({
      token: "abc",
      title: "Chat asignado",
      body: "Ana · WhatsApp",
      data: { type: "assignment", conversationId: 7, channel: undefined },
      threadId: "conversation-7",
    }) as { aps: Record<string, unknown>; type: string; conversationId: number };

    assert.deepEqual(payload.aps.alert, { title: "Chat asignado", body: "Ana · WhatsApp" });
    assert.equal(payload.aps["thread-id"], "conversation-7");
    assert.equal(payload.aps.sound, "default");
    assert.equal(payload.type, "assignment");
    assert.equal(payload.conversationId, 7);
    assert.equal("channel" in payload, false);
  });
});

describe("push-apns — classifyApnsError", () => {
  it("prunes on 410 and on the token-specific reasons", () => {
    assert.equal(classifyApnsError(410, JSON.stringify({ reason: "Unregistered" })).status, "unregistered");
    assert.equal(classifyApnsError(400, JSON.stringify({ reason: "BadDeviceToken" })).status, "unregistered");
  });

  it("keeps the token on a server-side failure", () => {
    assert.equal(classifyApnsError(503, JSON.stringify({ reason: "ServiceUnavailable" })).status, "error");
  });
});

describe("push-apns — buildProviderToken", () => {
  it("signs an ES256 JWT with the raw r||s signature JWS requires", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    const jwt = buildProviderToken({ key: pem, keyId: "ABC123DEFG", teamId: "TEAM123456" }, 1_700_000_000);
    const [header, claims, signature] = jwt.split(".");

    assert.deepEqual(decodeSegment(jwt, 0), { alg: "ES256", kid: "ABC123DEFG" });
    assert.deepEqual(decodeSegment(jwt, 1), { iss: "TEAM123456", iat: 1_700_000_000 });

    const raw = Buffer.from(signature, "base64url");
    assert.equal(raw.length, 64, "ES256 signatures are 64 bytes, not DER-wrapped");

    const verified = crypto
      .createVerify("SHA256")
      .update(`${header}.${claims}`)
      .verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, raw);
    assert.equal(verified, true);
  });
});

describe("push — isValidDeviceToken", () => {
  it("accepts a hex APNs token on iOS and rejects anything else", () => {
    const apns = "a".repeat(64);
    assert.equal(isValidDeviceToken(apns, "ios"), true);
    assert.equal(isValidDeviceToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", "ios"), false);
    assert.equal(isValidDeviceToken("zz" + "a".repeat(62), "ios"), false);
  });

  it("accepts an FCM registration token on Android", () => {
    const fcm = `${"c".repeat(22)}:APA91b${"D".repeat(120)}`;
    assert.equal(isValidDeviceToken(fcm, "android"), true);
  });

  it("rejects tokens that are obviously too short", () => {
    assert.equal(isValidDeviceToken("abc", "android"), false);
    assert.equal(isValidDeviceToken("", "ios"), false);
  });
});
