import { desc, eq, like } from "drizzle-orm";
import { db, mediaObjectsTable } from "@workspace/db";
import { logger } from "./logger";
import { signMediaPath } from "./media-signature";
import { publicBaseUrl } from "./public-url";

// Storage for message media: voice notes, customers' photos, documents and the images of welcome
// messages and campaigns. Two backends behind the same functions:
//  - Supabase Storage via plain REST, when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
//    (the service role stays server-side only; the frontend gets media through the
//    authenticated /api/media route).
//  - The database itself (table media_objects) when they are not, so an instance works without
//    an outside account. Links that Meta downloads from are signed (lib/media-signature.ts) and
//    served by routes/public-media.ts.
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = "media";

const usesSupabase = (): boolean => Boolean(SUPABASE_URL && SERVICE_KEY);

// There is always somewhere to store: the bucket, or else the database.
export function isStorageConfigured(): boolean {
  return true;
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
  if (!usesSupabase()) return dbUpload(path, data, contentType);
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
  if (!usesSupabase()) return dbSignedUrl(path, expiresInSeconds);
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
  if (!usesSupabase()) return dbList(namePrefix, limit);
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
  if (!usesSupabase()) return dbDelete(path);
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
  if (!usesSupabase()) return dbDownload(path);
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

// ── The database as storage ──────────────────────────────────────────────────

async function dbUpload(path: string, data: Buffer, contentType: string): Promise<boolean> {
  try {
    await db
      .insert(mediaObjectsTable)
      .values({ path, contentType, size: data.length, data })
      .onConflictDoUpdate({
        target: mediaObjectsTable.path,
        set: { contentType, size: data.length, data, updatedAt: new Date() },
      });
    return true;
  } catch (err) {
    logger.error({ err, path }, "media upload to the database failed");
    return false;
  }
}

async function dbDownload(path: string): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const [row] = await db
      .select({ data: mediaObjectsTable.data, contentType: mediaObjectsTable.contentType })
      .from(mediaObjectsTable)
      .where(eq(mediaObjectsTable.path, path))
      .limit(1);
    return row ? { data: Buffer.from(row.data), contentType: row.contentType } : null;
  } catch (err) {
    logger.error({ err, path }, "media download from the database failed");
    return null;
  }
}

async function dbList(namePrefix: string, limit: number): Promise<StoredObject[]> {
  try {
    const rows = await db
      .select({ path: mediaObjectsTable.path, size: mediaObjectsTable.size, updatedAt: mediaObjectsTable.updatedAt })
      .from(mediaObjectsTable)
      .where(like(mediaObjectsTable.path, `${namePrefix.replace(/[\\%_]/g, "\\$&")}%`))
      .orderBy(desc(mediaObjectsTable.updatedAt))
      .limit(limit);
    return rows.map((r) => ({ path: r.path, size: r.size, updatedAt: r.updatedAt.toISOString() }));
  } catch (err) {
    logger.error({ err, namePrefix }, "media list from the database failed");
    return [];
  }
}

async function dbDelete(path: string): Promise<boolean> {
  try {
    await db.delete(mediaObjectsTable).where(eq(mediaObjectsTable.path, path));
    return true;
  } catch (err) {
    logger.error({ err, path }, "media delete from the database failed");
    return false;
  }
}

// A link Meta can download from: the instance's public address plus a signed, expiring path to
// routes/public-media.ts. Null when the instance has no public address or no session secret.
function dbSignedUrl(path: string, expiresInSeconds: number): string | null {
  const secret = process.env.SESSION_SECRET ?? "";
  const base = publicBaseUrl();
  if (!secret || !base) return null;
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${base}/api/public-media/${encodeURIComponent(path)}?exp=${exp}&sig=${signMediaPath(secret, path, exp)}`;
}
