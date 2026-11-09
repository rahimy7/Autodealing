import crypto from "node:crypto";
import fs from "node:fs";

/**
 * Firebase Cloud Messaging, HTTP v1, spoken directly — no relay in between.
 *
 * Auth is a service-account JWT exchanged for a short-lived OAuth token, which is
 * cached until just before it expires so a burst of notifications costs one
 * token request, not one per message.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export type FcmResult =
  | { status: "ok" }
  | { status: "unregistered" } // the app was uninstalled: drop the token
  | { status: "error"; message: string };

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

// ── Credentials ───────────────────────────────────────────────────────────────

function readServiceAccount(): ServiceAccount | null {
  const inline = process.env.FCM_SERVICE_ACCOUNT_JSON;
  const file = process.env.FCM_SERVICE_ACCOUNT_FILE;

  let raw: string | null = null;
  if (inline && inline.trim()) {
    raw = inline.trim();
  } else if (file && file.trim()) {
    try {
      raw = fs.readFileSync(file.trim(), "utf8");
    } catch {
      return null;
    }
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    // Env vars cannot hold real newlines, so the PEM usually arrives escaped.
    return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

let cachedAccount: ServiceAccount | null | undefined;
function serviceAccount(): ServiceAccount | null {
  if (cachedAccount === undefined) cachedAccount = readServiceAccount();
  return cachedAccount;
}

export function isFcmConfigured(): boolean {
  return serviceAccount() !== null;
}

/** Test seam: forces the credentials to be re-read. */
export function resetFcmCredentials(): void {
  cachedAccount = undefined;
  accessToken = null;
}

// ── OAuth access token ────────────────────────────────────────────────────────

const b64u = (value: Buffer | string) =>
  (Buffer.isBuffer(value) ? value : Buffer.from(value)).toString("base64url");

function signRs256(data: string, privateKey: string): string {
  return b64u(crypto.createSign("RSA-SHA256").update(data).sign(privateKey));
}

export function buildAssertion(account: ServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64u(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const body = `${header}.${claims}`;
  return `${body}.${signRs256(body, account.private_key)}`;
}

let accessToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  const account = serviceAccount();
  if (!account) return null;

  // 60 s of slack so a token never expires mid-flight.
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildAssertion(account),
    }),
  });

  if (!response.ok) {
    throw new Error(`FCM auth failed: HTTP ${response.status} ${await response.text().catch(() => "")}`);
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("FCM auth returned no access_token");

  accessToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return accessToken.value;
}

// ── Message ───────────────────────────────────────────────────────────────────

export type FcmNotification = {
  token: string;
  title: string;
  body: string;
  /** FCM only carries strings, so every value is stringified. */
  data: Record<string, string | number | undefined>;
  channelId: string;
  /** Groups repeated notifications about the same chat into one entry. */
  tag?: string;
};

export function buildFcmMessage(notification: FcmNotification): Record<string, unknown> {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(notification.data)) {
    if (value !== undefined) data[key] = String(value);
  }

  return {
    message: {
      token: notification.token,
      notification: { title: notification.title, body: notification.body },
      data,
      android: {
        priority: "HIGH",
        notification: {
          channel_id: notification.channelId,
          sound: "default",
          ...(notification.tag ? { tag: notification.tag } : {}),
        },
      },
    },
  };
}

// A token Firebase no longer recognises: the app was uninstalled or the token
// was rotated. Anything else is a transient failure worth logging, not pruning.
const DEAD_TOKEN_CODES = new Set(["UNREGISTERED", "INVALID_ARGUMENT", "NOT_FOUND", "SENDER_ID_MISMATCH"]);

export function classifyFcmError(status: number, body: string): FcmResult {
  let code = "";
  try {
    const parsed = JSON.parse(body) as {
      error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> };
    };
    code = parsed.error?.details?.find((d) => d.errorCode)?.errorCode ?? parsed.error?.status ?? "";
    if ((status === 404 || status === 400) && DEAD_TOKEN_CODES.has(code)) {
      return { status: "unregistered" };
    }
    return { status: "error", message: `HTTP ${status} ${code || parsed.error?.message || body.slice(0, 200)}` };
  } catch {
    if (status === 404) return { status: "unregistered" };
    return { status: "error", message: `HTTP ${status} ${body.slice(0, 200)}` };
  }
}

export async function sendFcm(notification: FcmNotification): Promise<FcmResult> {
  const account = serviceAccount();
  if (!account) return { status: "error", message: "FCM no está configurado (falta FCM_SERVICE_ACCOUNT_JSON)." };

  const token = await getAccessToken();
  if (!token) return { status: "error", message: "No se pudo obtener el token de acceso de FCM." };

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(buildFcmMessage(notification)),
    },
  );

  if (response.ok) return { status: "ok" };
  return classifyFcmError(response.status, await response.text().catch(() => ""));
}
