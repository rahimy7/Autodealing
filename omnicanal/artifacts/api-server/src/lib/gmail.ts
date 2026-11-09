import { buildMimeMessage, type GmailApiMessage, type OutgoingEmail } from "./email-format";

// Cliente de la API de Gmail. Habla REST directo con fetch, igual que meta.ts con
// la Graph API: la librería oficial de Google pesa decenas de megas para las
// siete llamadas que hacen falta aquí.

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

// Leer, enviar y marcar como leído. Es un único permiso y cubre las tres cosas.
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

const TIMEOUT_MS = 20_000;

export type GmailCredentials = { clientId: string; clientSecret: string; refreshToken: string };

export type GmailResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; authRevoked?: boolean };

async function timedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(resp: Response): Promise<Record<string, unknown>> {
  try {
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function networkError<T>(err: unknown): GmailResult<T> {
  const aborted = err instanceof Error && err.name === "AbortError";
  return {
    ok: false,
    status: 0,
    error: aborted ? "Google no respondió a tiempo." : "No se pudo contactar a Google.",
  };
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

export function buildGoogleAuthUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    // offline + consent: sin los dos, Google no entrega refresh token cuando la
    // cuenta ya había autorizado la app antes, y sin refresh token el acceso
    // muere en una hora.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: opts.state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

function describeTokenError(body: Record<string, unknown>, status: number): { error: string; authRevoked: boolean } {
  const code = typeof body.error === "string" ? body.error : null;
  const description = typeof body.error_description === "string" ? body.error_description : null;
  if (code === "invalid_grant") {
    return {
      error:
        "Google revocó o dejó expirar el acceso a Gmail. Vuelve a conectar la cuenta desde Configuración → Correo. " +
        "Si la app de Google Cloud sigue en modo \"Prueba\", el acceso caduca a los 7 días: publícala.",
      authRevoked: true,
    };
  }
  if (code === "invalid_client" || code === "unauthorized_client") {
    return { error: "Google rechazó el Client ID o el Client Secret guardados.", authRevoked: false };
  }
  if (code === "redirect_uri_mismatch") {
    return {
      error: "La URL de retorno no está registrada en el cliente OAuth de Google Cloud.",
      authRevoked: false,
    };
  }
  return { error: `Google rechazó la autorización: ${description ?? code ?? `HTTP ${status}`}`, authRevoked: false };
}

async function postTokenForm(params: Record<string, string>): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const resp = await timedFetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return { ok: resp.ok, status: resp.status, body: await readJson(resp) };
}

export async function exchangeAuthCode(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<GmailResult<{ refreshToken: string | null; accessToken: string; expiresIn: number }>> {
  try {
    const res = await postTokenForm({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      code: opts.code,
      grant_type: "authorization_code",
    });
    if (!res.ok || typeof res.body.access_token !== "string") {
      const { error, authRevoked } = describeTokenError(res.body, res.status);
      return { ok: false, status: res.status, error, authRevoked };
    }
    const refreshToken = typeof res.body.refresh_token === "string" ? res.body.refresh_token : null;
    const expiresIn = typeof res.body.expires_in === "number" ? res.body.expires_in : 3600;
    if (refreshToken) {
      tokenCache.set(refreshToken, { token: res.body.access_token, expiresAt: Date.now() + expiresIn * 1000 });
    }
    return { ok: true, data: { refreshToken, accessToken: res.body.access_token, expiresIn } };
  } catch (err) {
    return networkError(err);
  }
}

// El token de acceso dura una hora. Pedir uno nuevo en cada llamada cuesta una
// ida y vuelta extra y Google limita la frecuencia, así que se guarda en memoria
// hasta poco antes de que caduque.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function forgetAccessToken(refreshToken: string): void {
  tokenCache.delete(refreshToken);
}

async function getAccessToken(creds: GmailCredentials): Promise<GmailResult<string>> {
  const cached = tokenCache.get(creds.refreshToken);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return { ok: true, data: cached.token };
  try {
    const res = await postTokenForm({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    });
    if (!res.ok || typeof res.body.access_token !== "string") {
      const { error, authRevoked } = describeTokenError(res.body, res.status);
      return { ok: false, status: res.status, error, authRevoked };
    }
    const expiresIn = typeof res.body.expires_in === "number" ? res.body.expires_in : 3600;
    tokenCache.set(creds.refreshToken, { token: res.body.access_token, expiresAt: Date.now() + expiresIn * 1000 });
    return { ok: true, data: res.body.access_token };
  } catch (err) {
    return networkError(err);
  }
}

/** Revoca el acceso en Google. Si falla no pasa nada: el token se olvida igual. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await timedFetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch {
    // best-effort
  }
}

// ── API de Gmail ──────────────────────────────────────────────────────────────

async function gmailRequest<T>(
  creds: GmailCredentials,
  path: string,
  init: { method?: string; body?: unknown } = {},
  retried = false,
): Promise<GmailResult<T>> {
  const token = await getAccessToken(creds);
  if (!token.ok) return token;
  try {
    const resp = await timedFetch(`${GMAIL_API}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token.data}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    // Un token revocado por fuera antes de caducar: se descarta y se reintenta
    // una sola vez con uno nuevo.
    if (resp.status === 401 && !retried) {
      forgetAccessToken(creds.refreshToken);
      return gmailRequest<T>(creds, path, init, true);
    }
    const body = await readJson(resp);
    if (!resp.ok) {
      const apiError = body.error as { message?: string } | undefined;
      const message =
        resp.status === 403 && /insufficient|scope|permission/i.test(apiError?.message ?? "")
          ? "La cuenta no concedió el permiso para leer y enviar correo. Vuelve a conectarla y acepta todos los permisos."
          : (apiError?.message ?? `Gmail respondió HTTP ${resp.status}.`);
      return { ok: false, status: resp.status, error: message };
    }
    return { ok: true, data: body as T };
  } catch (err) {
    return networkError(err);
  }
}

export function getProfile(creds: GmailCredentials) {
  return gmailRequest<{ emailAddress: string; historyId: string }>(creds, "/profile");
}

type HistoryPage = {
  history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>;
  historyId?: string;
  nextPageToken?: string;
};

/**
 * Los mensajes que entraron al buzón desde `startHistoryId`, del más viejo al más
 * nuevo. Un 404 significa que ese punto ya caducó (Gmail guarda alrededor de una
 * semana) y hay que recuperarse con una búsqueda.
 */
export async function listHistory(
  creds: GmailCredentials,
  startHistoryId: string,
): Promise<GmailResult<{ messageIds: string[]; historyId: string }>> {
  const ids: string[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  let historyId = startHistoryId;
  do {
    const params = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "500" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await gmailRequest<HistoryPage>(creds, `/history?${params.toString()}`);
    if (!page.ok) return page;
    for (const entry of page.data.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const id = added.message?.id;
        if (id && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    if (page.data.historyId) historyId = page.data.historyId;
    pageToken = page.data.nextPageToken;
  } while (pageToken);
  return { ok: true, data: { messageIds: ids, historyId } };
}

/** Ids de los mensajes que cumplen una búsqueda de Gmail, del más nuevo al más viejo. */
export async function searchMessageIds(creds: GmailCredentials, query: string, max: number): Promise<GmailResult<string[]>> {
  const params = new URLSearchParams({ q: query, maxResults: String(max) });
  const res = await gmailRequest<{ messages?: Array<{ id: string }> }>(creds, `/messages?${params.toString()}`);
  if (!res.ok) return res;
  return { ok: true, data: (res.data.messages ?? []).map((m) => m.id) };
}

// Igual que searchMessageIds, pero recorre todas las páginas hasta `cap` — para
// la importación completa del buzón, donde una sola página de 500 no alcanza.
// Newest-first, como Gmail las entrega.
export async function searchAllMessageIds(creds: GmailCredentials, query: string, cap: number): Promise<GmailResult<string[]>> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q: query, maxResults: String(Math.min(500, cap - ids.length)) });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gmailRequest<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      creds,
      `/messages?${params.toString()}`,
    );
    if (!res.ok) return res;
    ids.push(...(res.data.messages ?? []).map((m) => m.id));
    pageToken = res.data.nextPageToken;
  } while (pageToken && ids.length < cap);
  return { ok: true, data: ids.slice(0, cap) };
}

export function getMessage(creds: GmailCredentials, id: string) {
  return gmailRequest<GmailApiMessage>(creds, `/messages/${encodeURIComponent(id)}?format=full`);
}

/** El hilo entero en una sola llamada: todos sus mensajes, recibidos y enviados, del más viejo al más nuevo. */
export function getThread(creds: GmailCredentials, id: string) {
  return gmailRequest<{ id: string; messages?: GmailApiMessage[] }>(creds, `/threads/${encodeURIComponent(id)}?format=full`);
}

export async function sendMessage(
  creds: GmailCredentials,
  email: OutgoingEmail,
  threadId: string | null,
): Promise<GmailResult<{ id: string; threadId: string }>> {
  const raw = Buffer.from(buildMimeMessage(email), "utf8").toString("base64url");
  return gmailRequest<{ id: string; threadId: string }>(creds, "/messages/send", {
    method: "POST",
    body: threadId ? { raw, threadId } : { raw },
  });
}

export async function getAttachment(
  creds: GmailCredentials,
  messageId: string,
  attachmentId: string,
): Promise<GmailResult<Buffer>> {
  const res = await gmailRequest<{ data?: string }>(
    creds,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  if (!res.ok) return res;
  return { ok: true, data: Buffer.from(res.data.data ?? "", "base64url") };
}

export async function markThreadRead(creds: GmailCredentials, threadId: string): Promise<void> {
  await gmailRequest(creds, `/threads/${encodeURIComponent(threadId)}/modify`, {
    method: "POST",
    body: { removeLabelIds: ["UNREAD"] },
  });
}
