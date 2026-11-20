import { Router, type IRouter } from "express";
import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import { z } from "zod/v4";
import { db, productsTable } from "@workspace/db";

const router: IRouter = Router();

// What the client's own site publishes, kept as products so the virtual agent can send each one's
// photo with [[FOTO:slug]] (lib/messaging.ts). Premier's site writes its vehicles here on every
// inventory change (server/omni-service.js in the site). It works with the catalog module off: the
// agent reads the items from the site's knowledge base, and this only gives their photos a home.

// The characters the agent's marker accepts (PHOTO_DIRECTIVE in lib/openai-client.ts).
const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/, "slug: minúsculas, números y guiones");
// Meta downloads the photo by itself, so the links have to be public.
const PublicUrl = z.string().max(1000).regex(/^https:\/\/\S+$/, "un enlace https");

export const SiteCatalogBody = z.object({
  // Whose items these are. Each sync replaces only that source's items, never products imported
  // or created by hand.
  source: z.string().regex(/^site-[a-z0-9-]{1,40}$/, "source: 'site-…'"),
  items: z
    .array(
      z.object({
        slug: Slug,
        // Goes as the caption of the photo, above the link: what the customer reads.
        name: z.string().trim().min(1).max(300),
        url: PublicUrl,
        imageUrl: PublicUrl.nullable(),
        description: z.string().max(4000).nullable().default(null),
      }),
    )
    .max(2000)
    .refine((items) => new Set(items.map((i) => i.slug)).size === items.length, "slugs repetidos"),
});

router.put("/site-catalog", async (req, res): Promise<void> => {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Solo la administración sincroniza el catálogo del sitio." });
    return;
  }
  const parsed = SiteCatalogBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { source, items } = parsed.data;

  const result = await db.transaction(async (tx) => {
    const slugs = items.map((i) => i.slug);
    // A slug that already belongs to another source (an imported or hand-made product) stays theirs.
    const taken = slugs.length
      ? await tx
          .select({ slug: productsTable.slug })
          .from(productsTable)
          .where(and(inArray(productsTable.slug, slugs), ne(productsTable.source, source)))
      : [];
    const takenSet = new Set(taken.map((t) => t.slug));
    const now = new Date();
    let saved = 0;
    for (const item of items) {
      if (takenSet.has(item.slug)) continue;
      const values = {
        name: item.name,
        url: item.url,
        imageUrl: item.imageUrl,
        description: item.description,
        active: true,
        updatedAt: now,
      };
      await tx
        .insert(productsTable)
        .values({ slug: item.slug, source, ...values })
        .onConflictDoUpdate({ target: productsTable.slug, set: values });
      saved++;
    }
    // What the site stopped publishing (a vehicle that sold) is withdrawn, not deleted.
    const withdrawn = await tx
      .update(productsTable)
      .set({ active: false, updatedAt: now })
      .where(
        and(
          eq(productsTable.source, source),
          eq(productsTable.active, true),
          ...(slugs.length ? [notInArray(productsTable.slug, slugs)] : []),
        ),
      )
      .returning({ slug: productsTable.slug });
    return { saved, withdrawn: withdrawn.length, skipped: [...takenSet] };
  });

  res.json(result);
});

export default router;
