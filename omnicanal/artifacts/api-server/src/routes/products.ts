import { Router, type IRouter } from "express";
import { and, asc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { db, productsTable, productComponentsTable, type Product } from "@workspace/db";
import { CreateProductBody, UpdateProductParams, UpdateProductBody, UpdateProductResponse, GetProductResponse } from "@workspace/api-zod";
import { requireView } from "../middlewares/auth";
import { withDomainErrors, badRequest } from "../lib/route-errors";
import { BASE_CURRENCY } from "../lib/money";

const router: IRouter = Router();

// El catálogo lo escribe scripts/import-catalog.ts desde la web del cliente: el
// nombre, la descripción y la ficha se cambian en la web y se re-importa. Lo que
// el sitio no tiene —precio de venta, SKU, control de inventario, componentes de
// un kit— se pone aquí (2026-10-04), y el importador no lo pisa. Los productos
// creados a mano (`source = manual`: un kit, algo que no se vende en la web) se
// editan enteros aquí.

/** Los componentes de cada kit de la lista, con su nombre, en una consulta. */
async function withComponents<T extends Product>(products: T[]) {
  const ids = products.map((p) => p.id);
  const rows = ids.length
    ? await db
        .select({ kitProductId: productComponentsTable.kitProductId, productId: productComponentsTable.componentProductId, quantity: productComponentsTable.quantity, name: productsTable.name })
        .from(productComponentsTable)
        .innerJoin(productsTable, eq(productsTable.id, productComponentsTable.componentProductId))
        .where(inArray(productComponentsTable.kitProductId, ids))
    : [];
  return products.map((p) => ({
    ...p,
    components: rows.filter((r) => r.kitProductId === p.id).map((r) => ({ productId: r.productId, name: r.name, quantity: r.quantity })),
  }));
}

const ListQuery = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(120).optional(),
});

const SlugParams = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9-]+$/i, "slug inválido"),
});

router.get("/products/categories", async (_req, res): Promise<void> => {
  // One row per category name; a product can belong to several, so unnest.
  const rows = await db.execute<{ name: string; count: number }>(sql`
    SELECT category AS name, COUNT(*)::int AS count
    FROM ${productsTable}, unnest(${productsTable.categories}) AS category
    GROUP BY category
    ORDER BY count DESC, category ASC
  `);
  res.json(rows.rows);
});

router.get("/products", async (req, res): Promise<void> => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { search, category } = parsed.data;

  const filters: SQL[] = [];
  if (search) {
    const term = `%${search}%`;
    const match = or(ilike(productsTable.name, term), ilike(productsTable.description, term));
    if (match) filters.push(match);
  }
  if (category) {
    // `categories` is a text[]; ARRAY['x'] <@ categories tests membership.
    filters.push(sql`${productsTable.categories} @> ARRAY[${category}]::text[]`);
  }

  const rows = await db
    .select()
    .from(productsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(productsTable.name));

  res.json(await withComponents(rows));
});

router.get("/products/:slug", async (req, res): Promise<void> => {
  const params = SlugParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.slug, params.data.slug))
    .limit(1);

  if (!product) {
    res.status(404).json({ error: "Producto no encontrado" });
    return;
  }
  const [out] = await withComponents([product]);
  res.json(out);
});

// ── Administración ────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "producto"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let n = 2; ; n++) {
    const [taken] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, slug));
    if (!taken) return slug;
    slug = `${base}-${n}`;
  }
}

async function skuTaken(sku: string, exceptId?: number): Promise<boolean> {
  const [row] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.sku, sku), ...(exceptId != null ? [ne(productsTable.id, exceptId)] : [])));
  return Boolean(row);
}

/**
 * Valida y guarda los componentes de un kit. Un kit no se compone de otro kit
 * (el desglose es de un solo nivel) ni de sí mismo, y no controla existencias
 * propias: lo hacen sus componentes.
 */
async function saveComponents(kitId: number, components: Array<{ productId: number; quantity: number }>): Promise<string | null> {
  const clean = components.filter((c) => c.quantity > 0);
  if (clean.some((c) => c.productId === kitId)) return "Un kit no puede ser componente de sí mismo.";
  const ids = [...new Set(clean.map((c) => c.productId))];
  if (ids.length !== clean.length) return "Un componente aparece dos veces.";
  if (ids.length) {
    const found = await db.select({ id: productsTable.id }).from(productsTable).where(inArray(productsTable.id, ids));
    if (found.length !== ids.length) return "Uno de los componentes no existe.";
    const nested = await db.select({ id: productComponentsTable.kitProductId }).from(productComponentsTable).where(inArray(productComponentsTable.kitProductId, ids)).limit(1);
    if (nested.length) return "Un componente no puede ser a su vez un kit.";
  }
  await db.transaction(async (tx) => {
    await tx.delete(productComponentsTable).where(eq(productComponentsTable.kitProductId, kitId));
    if (clean.length) {
      await tx.insert(productComponentsTable).values(clean.map((c) => ({ kitProductId: kitId, componentProductId: c.productId, quantity: Math.round(c.quantity) })));
      await tx.update(productsTable).set({ trackInventory: false, updatedAt: new Date() }).where(eq(productsTable.id, kitId));
    }
  });
  return null;
}

router.post(
  "/products/manage",
  requireView("products", "inventory"),
  withDomainErrors(async (req, res) => {
    const parsed = CreateProductBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const name = parsed.data.name.trim();
    if (!name) return badRequest(res, "El producto necesita nombre.");
    const sku = parsed.data.sku?.trim() || null;
    if (sku && (await skuTaken(sku))) {
      res.status(409).json({ error: `El SKU ${sku} ya lo tiene otro producto.` });
      return;
    }
    const [product] = await db
      .insert(productsTable)
      .values({
        slug: await uniqueSlug(slugify(name)),
        name,
        description: parsed.data.description?.trim() || null,
        // Sin página pública: es un producto que no está en la web.
        url: "",
        sku,
        priceCents: parsed.data.priceCents ?? null,
        priceCurrency: (parsed.data.priceCurrency ?? BASE_CURRENCY).toUpperCase(),
        trackInventory: parsed.data.trackInventory ?? !parsed.data.components?.length,
        source: "manual",
      })
      .returning();
    if (parsed.data.components?.length) {
      const problem = await saveComponents(product.id, parsed.data.components);
      if (problem) {
        await db.delete(productsTable).where(eq(productsTable.id, product.id));
        return badRequest(res, problem);
      }
    }
    const [fresh] = await db.select().from(productsTable).where(eq(productsTable.id, product.id));
    const [out] = await withComponents([fresh]);
    res.status(201).json(GetProductResponse.parse(out));
  }),
);

router.patch(
  "/products/manage/:id",
  requireView("products", "inventory"),
  withDomainErrors(async (req, res) => {
    const params = UpdateProductParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = UpdateProductBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    const [existing] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Producto no encontrado." });
      return;
    }
    const update: Partial<typeof productsTable.$inferInsert> = { updatedAt: new Date() };
    if (body.data.name !== undefined) {
      if (existing.source !== "manual") return badRequest(res, "El nombre de un producto importado se cambia en la web y se re-importa.");
      if (!body.data.name.trim()) return badRequest(res, "El producto necesita nombre.");
      update.name = body.data.name.trim();
    }
    if (body.data.sku !== undefined) {
      const sku = body.data.sku?.trim() || null;
      if (sku && (await skuTaken(sku, existing.id))) {
        res.status(409).json({ error: `El SKU ${sku} ya lo tiene otro producto.` });
        return;
      }
      update.sku = sku;
    }
    if (body.data.priceCents !== undefined) update.priceCents = body.data.priceCents == null ? null : Math.max(0, Math.round(body.data.priceCents));
    if (body.data.priceCurrency !== undefined) update.priceCurrency = body.data.priceCurrency?.toUpperCase() || null;
    if (body.data.trackInventory !== undefined) update.trackInventory = body.data.trackInventory;
    if (body.data.active !== undefined) update.active = body.data.active;
    await db.update(productsTable).set(update).where(eq(productsTable.id, existing.id));
    if (body.data.components !== undefined) {
      const problem = await saveComponents(existing.id, body.data.components);
      if (problem) return badRequest(res, problem);
    }
    const [fresh] = await db.select().from(productsTable).where(eq(productsTable.id, existing.id));
    const [out] = await withComponents([fresh]);
    res.json(UpdateProductResponse.parse(out));
  }),
);

export default router;
