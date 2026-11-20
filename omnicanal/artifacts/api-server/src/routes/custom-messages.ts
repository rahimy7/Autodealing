import { Router, type IRouter } from "express";
import express from "express";
import crypto from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod/v4";
import { db, customMessagesTable } from "@workspace/db";
import { uploadMedia, listMedia, signMediaUrl, isStorageConfigured } from "../lib/supabase";
import { MAX_INTERACTIVE_BUTTONS, MAX_BUTTON_LABEL } from "../lib/meta";
import { isHostedImage, toPublicUrl } from "../lib/public-url";

const router: IRouter = Router();

// Images live in the shared media bucket under this prefix so the composer can
// list them apart from voice notes and product shots.
const IMAGE_PREFIX = "custom-";

const ButtonSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/i, "El id del botón solo admite letras, números, guion y guion bajo"),
  label: z.string().trim().min(1).max(MAX_BUTTON_LABEL),
});

const ButtonsSchema = z
  .array(ButtonSchema)
  .max(MAX_INTERACTIVE_BUTTONS, `WhatsApp admite como máximo ${MAX_INTERACTIVE_BUTTONS} botones`)
  .refine((bs) => new Set(bs.map((b) => b.id)).size === bs.length, "Los ids de los botones deben ser únicos");

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.literal("welcome").default("welcome"),
  // WhatsApp rejects interactive bodies over 1024 characters.
  body: z.string().trim().min(1).max(1024),
  // An uploaded object, or a picture the panel serves itself (/clients/… or an https:// link).
  imagePath: z
    .string()
    .trim()
    .max(200)
    .refine((p) => !isHostedImage(p) || /^\/clients\/[A-Za-z0-9._\/-]+$/.test(p) || /^https:\/\/\S+$/.test(p), "La imagen debe estar en /clients/ o ser un enlace https")
    .nullable()
    .optional(),
  buttons: ButtonsSchema.default([]),
  channels: z.array(z.enum(["whatsapp", "instagram", "facebook"])).default([]),
});

// An update changes only what it names. `.partial()` alone kept the `default([])` of buttons and
// channels, so a PATCH that sent just the image silently emptied both.
export const UpdateBody = CreateBody.omit({ kind: true })
  .extend({ buttons: ButtonsSchema.optional(), channels: CreateBody.shape.channels.unwrap().optional() })
  .partial();
const IdParams = z.object({ id: z.coerce.number().int().positive() });
const ActivateBody = z.object({ isActive: z.boolean().default(true) });

// The panel renders previews with plain <img> tags, which carry no Authorization
// header, so /api/media would 401. Signed Supabase URLs are handed out instead —
// time-limited, and the bucket stays private.
const PREVIEW_URL_TTL_SECONDS = 3600;

// Pictures the panel itself serves from its public folder. Offered in the composer next to the
// uploaded ones.
const HOSTED_IMAGES = [{ path: "/clients/premier/welcome.jpg", label: "Bienvenida de Premier Line Motors" }];

async function previewUrl(path: string): Promise<string | null> {
  return isHostedImage(path) ? (toPublicUrl(path) ?? path) : signMediaUrl(path, PREVIEW_URL_TTL_SECONDS);
}

async function withImageUrl<T extends { imagePath: string | null }>(row: T) {
  return { ...row, imageUrl: row.imagePath ? await previewUrl(row.imagePath) : null };
}

router.get("/custom-messages", async (_req, res): Promise<void> => {
  const rows = await db.select().from(customMessagesTable).orderBy(desc(customMessagesTable.updatedAt));
  res.json(await Promise.all(rows.map(withImageUrl)));
});

router.get("/custom-messages/images", async (_req, res): Promise<void> => {
  const objects = await listMedia(IMAGE_PREFIX);
  const site = await Promise.all(
    HOSTED_IMAGES.map(async (i) => ({ path: i.path, url: (await previewUrl(i.path)) ?? i.path, size: null, updatedAt: null })),
  );
  res.json([
    ...site,
    ...(await Promise.all(
      objects.map(async (o) => ({
        path: o.path,
        url: (await signMediaUrl(o.path, PREVIEW_URL_TTL_SECONDS)) ?? `/api/media/${o.path}`,
        size: o.size,
        updatedAt: o.updatedAt,
      })),
    )),
  ]);
});

// Raw binary upload: the panel POSTs the File straight through, so no multipart
// parser is needed. Kept off the generated client (see the composer, which calls
// customFetch directly) because orval has no good shape for binary bodies.
router.post(
  "/custom-messages/images",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "8mb" }),
  async (req, res): Promise<void> => {
    if (!isStorageConfigured()) {
      res.status(503).json({ error: "El almacenamiento de imágenes no está configurado." });
      return;
    }
    const contentType = req.header("content-type")?.split(";")[0].trim() ?? "";
    const ext = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[contentType];
    if (!ext) {
      res.status(415).json({ error: "Formato no admitido. Usa JPEG, PNG o WebP." });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "El cuerpo de la petición está vacío." });
      return;
    }

    // Name from the client is untrusted: keep only a slug of it and add entropy
    // so two uploads never collide (and never overwrite an existing image).
    const raw = (req.query.filename as string | undefined) ?? "imagen";
    const slug =
      raw
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/, "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "imagen";
    const path = `${IMAGE_PREFIX}${slug}-${crypto.randomBytes(4).toString("hex")}.${ext}`;

    const ok = await uploadMedia(path, req.body, contentType);
    if (!ok) {
      res.status(502).json({ error: "No se pudo guardar la imagen." });
      return;
    }
    res.status(201).json({ path, url: (await signMediaUrl(path, PREVIEW_URL_TTL_SECONDS)) ?? `/api/media/${path}` });
  },
);

router.post("/custom-messages", async (req, res): Promise<void> => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(customMessagesTable)
    .values({ ...parsed.data, imagePath: parsed.data.imagePath ?? null })
    .returning();
  res.status(201).json(await withImageUrl(row));
});

router.patch("/custom-messages/:id", async (req, res): Promise<void> => {
  const params = IdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(customMessagesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(customMessagesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Mensaje no encontrado." });
    return;
  }
  res.json(await withImageUrl(row));
});

router.post("/custom-messages/:id/activate", async (req, res): Promise<void> => {
  const params = IdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ActivateBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [target] = await db
    .select()
    .from(customMessagesTable)
    .where(eq(customMessagesTable.id, params.data.id))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Mensaje no encontrado." });
    return;
  }

  // Only one active message per kind (a partial unique index enforces it), so the
  // previous one is stood down first, in the same transaction.
  const row = await db.transaction(async (tx) => {
    if (parsed.data.isActive) {
      await tx
        .update(customMessagesTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(customMessagesTable.kind, target.kind), ne(customMessagesTable.id, target.id)));
    }
    const [updated] = await tx
      .update(customMessagesTable)
      .set({ isActive: parsed.data.isActive, updatedAt: new Date() })
      .where(eq(customMessagesTable.id, target.id))
      .returning();
    return updated;
  });

  res.json(await withImageUrl(row));
});

router.delete("/custom-messages/:id", async (req, res): Promise<void> => {
  const params = IdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(customMessagesTable).where(eq(customMessagesTable.id, params.data.id));
  res.status(204).end();
});

export default router;
