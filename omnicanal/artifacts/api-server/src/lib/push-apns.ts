import crypto from "node:crypto";
import fs from "node:fs";
import http2 from "node:http2";

/**
 * Apple Push Notification service over HTTP/2, spoken directly.
 *
 * Two things Apple is strict about and this module handles:
 *  - the provider JWT may be reused for up to an hour but must NOT be minted more
 *    often than every 20 minutes, so it is cached;
 *  - the HTTP/2 session is expensive to establish, so it is kept open and reused
 *    across notifications.
 */

const PRODUCTION_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";

export type ApnsResult =
  | { status: "ok" }
  | { status: "unregistered" } // the app is gone from this device: drop the token
  | { status: "error"; message: string };

type ApnsConfig = {
  key: string; // .p8 contents (EC private key, PEM)
  keyId: string;
  teamId: string;
  bundleId: string;
  host: string;
};

// ── Credentials ───────────────────────────────────────────────────────────────

function readConfig(): ApnsConfig | null {
  const inline = process.env.APNS_KEY_P8;
  const file = process.env.APNS_KEY_FILE;
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const bundleId = process.env.APNS_BUNDLE_ID?.trim();

  let key: string | null = null;
  if (inline && inline.trim()) {
    key = inline.replace(/\\n/g, "\n").trim();
  } else if (file && file.trim()) {
    try {
      key = fs.readFileSync(file.trim(), "utf8");
    } catch {
      return null;
    }
  }

  if (!key || !keyId || !teamId || !bundleId) return null;

  // Development builds get their tokens from Apple's sandbox gateway; a token
  // minted there is rejected by production and vice versa.
  const host = process.env.APNS_PRODUCTION === "false" ? SANDBOX_HOST : PRODUCTION_HOST;
  return { key, keyId, teamId, bundleId, host };
}

let cachedConfig: ApnsConfig | null | undefined;
function config(): ApnsConfig | null {
  if (cachedConfig === undefined) cachedConfig = readConfig();
  return cachedConfig;
}

export function isApnsConfigured(): boolean {
  return config() !== null;
}

/** Test seam: forces credentials, JWT and session to be rebuilt. */
export function resetApnsCredentials(): void {
  cachedConfig = undefined;
  providerToken = null;
  closeApnsSession();
}

// ── Provider JWT ──────────────────────────────────────────────────────────────

const b64u = (value: Buffer | string) =>
  (Buffer.isBuffer(value) ? value : Buffer.from(value)).toString("base64url");

export function buildProviderToken(
  cfg: Pick<ApnsConfig, "key" | "keyId" | "teamId">,
  now = Math.floor(Date.now() / 1000),
): string {
  const header = b64u(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const claims = b64u(JSON.stringify({ iss: cfg.teamId, iat: now }));
  const body = `${header}.${claims}`;
  // JWS wants the raw r||s pair, not the DER envelope Node emits by default.
  const signature = crypto
    .createSign("SHA256")
    .update(body)
    .sign({ key: cfg.key, dsaEncoding: "ieee-p1363" });
  return `${body}.${b64u(signature)}`;
}

let providerToken: { value: string; mintedAt: number } | null = null;

function getProviderToken(cfg: ApnsConfig): string {
  // Refresh every 50 minutes: inside Apple's 1 h validity, outside its 20 min
  // minimum between mints.
  if (providerToken && Date.now() - providerToken.mintedAt < 50 * 60_000) return providerToken.value;
  providerToken = { value: buildProviderToken(cfg), mintedAt: Date.now() };
  return providerToken.value;
}

// ── Payload ───────────────────────────────────────────────────────────────────

export type ApnsNotification = {
  token: string;
  title: string;
  body: string;
  data: Record<string, string | number | undefined>;
  /** Collapses and groups notifications about the same chat. */
  threadId?: string;
};

export function buildApnsPayload(notification: ApnsNotification): Record<string, unknown> {
  const extra: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(notification.data)) {
    if (value !== undefined) extra[key] = value;
  }

  return {
    aps: {
      alert: { title: notification.title, body: notification.body },
      sound: "default",
      ...(notification.threadId ? { "thread-id": notification.threadId } : {}),
    },
    ...extra,
  };
}

// ── HTTP/2 session ────────────────────────────────────────────────────────────

let session: http2.ClientHttp2Session | null = null;

function getSession(host: string): http2.ClientHttp2Session {
  if (session && !session.closed && !session.destroyed) return session;
  session = http2.connect(host);
  // Without a handler an idle-socket error would take the process down.
  session.on("error", () => {
    session = null;
  });
  session.on("close", () => {
    session = null;
  });
  return session;
}

export function closeApnsSession(): void {
  session?.close();
  session = null;
}

// Apple's way of saying the app is no longer installed on that device.
const DEAD_TOKEN_REASONS = new Set(["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic", "ExpiredToken"]);

export function classifyApnsError(status: number, body: string): ApnsResult {
  let reason = "";
  try {
    reason = (JSON.parse(body) as { reason?: string }).reason ?? "";
  } catch {
    reason = body.slice(0, 120);
  }
  if (status === 410 || DEAD_TOKEN_REASONS.has(reason)) return { status: "unregistered" };
  return { status: "error", message: `HTTP ${status} ${reason}` };
}

export async function sendApns(notification: ApnsNotification): Promise<ApnsResult> {
  const cfg = config();
  if (!cfg) return { status: "error", message: "APNs no está configurado (faltan APNS_KEY_P8/KEY_ID/TEAM_ID/BUNDLE_ID)." };

  const payload = JSON.stringify(buildApnsPayload(notification));

  return new Promise<ApnsResult>((resolve) => {
    let settled = false;
    const finish = (result: ApnsResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    let request: http2.ClientHttp2Stream;
    try {
      request = getSession(cfg.host).request({
        ":method": "POST",
        ":path": `/3/device/${notification.token}`,
        authorization: `bearer ${getProviderToken(cfg)}`,
        "apns-topic": cfg.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        ...(notification.threadId ? { "apns-collapse-id": notification.threadId.slice(0, 64) } : {}),
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      });
    } catch (err) {
      finish({ status: "error", message: err instanceof Error ? err.message : "APNs request failed" });
      return;
    }

    let status = 0;
    let body = "";

    request.setTimeout(10_000, () => {
      request.close();
      finish({ status: "error", message: "APNs timeout" });
    });
    request.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("error", (err) => finish({ status: "error", message: err.message }));
    request.on("end", () => {
      finish(status === 200 ? { status: "ok" } : classifyApnsError(status, body));
    });

    request.end(payload);
  });
}
