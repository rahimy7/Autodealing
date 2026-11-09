import { serial, text, timestamp, jsonb, uniqueIndex, bigint, boolean } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Catalog imported from the public nicadom.com site (Joomla). `slug` comes from
// the source URL, so re-running the importer upserts instead of duplicating.
//
// Technical specs are label→value pairs read from each product's technical data
// sheet ("Rendimiento": "Hormigón: 15 - 20 m2/l", …). They are kept as JSON
// rather than columns because the label set varies per product family.
export type ProductSpecs = Record<string, string>;

export const productsTable = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // Bullet list of product properties, as published on the data sheet.
    properties: text("properties").array().notNull().default([]),
    // Recommended uses / application scope.
    uses: text("uses"),
    // Public product page — shared with customers in chat replies.
    url: text("url").notNull(),
    imageUrl: text("image_url"),
    categories: text("categories").array().notNull().default([]),
    // Human-readable "Parent > Child" paths for the same categories.
    categoryPaths: text("category_paths").array().notNull().default([]),
    specs: jsonb("specs").$type<ProductSpecs>().notNull().default({}),
    technicalSheetUrl: text("technical_sheet_url"),
    safetySheetUrl: text("safety_sheet_url"),
    // `modified` timestamp reported by the source site.
    sourceUpdatedAt: timestamp("source_updated_at"),
    // ── Venta e inventario (2026-10-04) ──────────────────────────────────────
    // Nada de esto lo escribe el importador: lo pone el equipo en el panel, así
    // que re-importar el catálogo no lo pisa.
    // El SKU es la llave con la que se vinculan las líneas de un pedido de
    // Shopify (y, si falta, el handle = `slug`).
    sku: text("sku"),
    // Precio de venta para los pedidos, descuentos, notas de crédito y márgenes.
    // NO es lo que cotiza el agente por chat: eso sigue en catalog-docs.ts
    // (decisión del 2026-10-04; unificarlo sería un paso aparte).
    priceCents: bigint("price_cents", { mode: "number" }),
    priceCurrency: text("price_currency"),
    // Solo los productos que controlan inventario comprometen, se despachan por
    // lote y alertan por punto de reorden. Un kit no: lo hacen sus componentes.
    trackInventory: boolean("track_inventory").notNull().default(false),
    // Un producto con historial (pedidos, lotes) que la web dejó de publicar no se
    // borra: se desactiva, y el agente deja de verlo igual que si se borrara.
    active: boolean("active").notNull().default(true),
    // "import" = viene del sitio del cliente; "manual" = creado en el panel (un
    // kit, algo que no se vende en la web). Los manuales nunca se purgan al
    // importar y no entran en la base de conocimiento del agente.
    source: text("source").notNull().default("import"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("products_slug_idx").on(t.slug), uniqueIndex("products_sku_idx").on(t.sku)],
);

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
