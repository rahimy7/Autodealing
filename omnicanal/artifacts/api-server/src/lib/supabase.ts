import { logger } from "./logger";

// Supabase Storage via plain REST — stores voice notes and other message media.
// Configured with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (service role stays
// server-side only; the frontend gets media through the authenticated /api/media route).
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = "media";

export function isStorageConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY };
}

let bucketReady = false;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  // 400/409 = already exists; anything else we surface in the log and retry next time.
  if (resp.ok || resp.status === 400 || resp.status === 409) {
    bucketReady = true;
    return;
  }
  logger.error({ status: resp.status, body: await resp.text().catch(() => "") }, "supabase bucket creation failed");
}

export async function uploadMedia(path: string, data: Buffer, contentType: string): Promise<boolean> {
  if (!isStorageConfigured()) return false;
  await ensureBucket().catch(() => {});
  try {
    const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": contentType, "x-upsert": "true" },
      body: new Uint8Array(data),
    });
    if (!resp.ok) {
      logger.error({ path, status: resp.status, body: await resp.text().catch(() => "") }, "supabase upload failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, path }, "supabase upload failed");
    return false;
  }
}

// Creates a time-limited public URL for a stored object. The bucket is private,
// so Instagram/Facebook attachment sends (which need a publicly reachable url)
// use this instead of the auth-gated /api/media route.
export async function signMediaUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  if (!isStorageConfigured()) return null;
  try {
    const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (!resp.ok) {
      logger.error({ path, status: resp.status, body: await resp.text().catch(() => "") }, "supabase sign failed");
      return null;
    }
    const json = (await resp.json().catch(() => null)) as { signedURL?: string } | null;
    // signedURL is relative to /storage/v1, e.g. "/object/sign/media/<path>?token=…".
    return json?.signedURL ? `${SUPABASE_URL}/storage/v1${json.signedURL}` : null;
  } catch (err) {
    logger.error({ err, path }, "supabase sign failed");
    return null;
  }
}

export type StoredObject = { path: string; size: number | null; updatedAt: string | null };

// Lists objects whose file name starts with `namePrefix`. Used by the
// custom-message composer to offer images that were already uploaded, so the
// same artwork can be reused across messages without re-uploading it.
//
// Supabase treats the `prefix` parameter as a folder path, not a name prefix, so
// the bucket root is listed and the filtering happens here.
export async function listMedia(namePrefix: string, limit = 100): Promise<StoredObject[]> {
  if (!isStorageConfigured()) return [];
  try {
    const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        prefix: "",
        limit,
        sortBy: { column: "updated_at", order: "desc" },
      }),
    });
    if (!resp.ok) {
      logger.error({ namePrefix, status: resp.status, body: await resp.text().catch(() => "") }, "supabase list failed");
      return [];
    }
    const rows = (await resp.json().catch(() => [])) as Array<{
      name?: string;
      updated_at?: string;
      metadata?: { size?: number } | null;
    }>;
    return rows
      .filter((r) => typeof r.name === "string" && r.name.startsWith(namePrefix))
      .map((r) => ({
        path: r.name as string,
        size: r.metadata?.size ?? null,
        updatedAt: r.updated_at ?? null,
      }));
  } catch (err) {
    logger.error({ err, namePrefix }, "supabase list failed");
    return [];
  }
}

// Borra un objeto guardado. Usado para los adjuntos de correo puestos en espera:
// una vez enviados (o descartados) no hace falta conservar la copia.
export async function deleteMedia(path: string): Promise<boolean> {
  if (!isStorageConfigured()) return false;
  try {
    const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    // 404 = ya no está; no es un fallo desde el punto de vista de quien llama.
    if (!resp.ok && resp.status !== 404) {
      logger.error({ path, status: resp.status, body: await resp.text().catch(() => "") }, "supabase delete failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, path }, "supabase delete failed");
    return false;
  }
}

export async function downloadMedia(path: string): Promise<{ data: Buffer; contentType: string } | null> {
  if (!isStorageConfigured()) return null;
  try {
    const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { headers: authHeaders() });
    if (!resp.ok) return null;
    const data = Buffer.from(await resp.arrayBuffer());
    return { data, contentType: resp.headers.get("content-type") ?? "application/octet-stream" };
  } catch (err) {
    logger.error({ err, path }, "supabase download failed");
    return null;
  }
}
