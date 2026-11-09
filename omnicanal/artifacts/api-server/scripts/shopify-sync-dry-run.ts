// Prueba la sincronización con Shopify SIN ESCRIBIR NADA: lee los pedidos de la
// tienda desde una fecha y muestra cómo entrarían (vinculados o no al catálogo,
// suscripción o no, estado de pago, cliente). Sirve para revisar el SKU/handle de
// cada producto antes de encender la sincronización en la instancia.
//
// Credenciales: las de la instancia (Configuración → Shopify) o, si se pasan,
// las de estas variables: SHOPIFY_DOMAIN + SHOPIFY_TOKEN, o SHOPIFY_DOMAIN +
// SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET.
//
//   CLIENT_ID=premier DATABASE_URL=… \
//     pnpm --filter @workspace/api-server exec tsx scripts/shopify-sync-dry-run.ts --desde 2026-10-01

import { db, pool, productsTable, integrationSettingsTable } from "@workspace/db";
import { ORDERS_QUERY, normalizeShopDomain, shopifyGraphql, type ShopifyCredentials } from "../src/lib/shopify";
import { customerName, formatShopifyAddress, isSubscriptionOrder, mapShopifyLines, type ShopifyOrderNode } from "../src/lib/shopify-sync";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const [settings] = await db.select().from(integrationSettingsTable).limit(1);
  const shopDomain = normalizeShopDomain(process.env.SHOPIFY_DOMAIN ?? settings?.shopifyShopDomain);
  if (!shopDomain) throw new Error("Falta la tienda (SHOPIFY_DOMAIN o Configuración → Shopify).");
  const creds: ShopifyCredentials = {
    shopDomain,
    accessToken: process.env.SHOPIFY_TOKEN ?? settings?.shopifyAccessToken ?? null,
    clientId: process.env.SHOPIFY_CLIENT_ID ?? settings?.shopifyClientId ?? null,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET ?? settings?.shopifyClientSecret ?? null,
  };
  const since = arg("--desde") ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  console.log(`Tienda ${shopDomain} — pedidos creados desde ${since} (solo lectura)\n`);

  const products = await db.select({ id: productsTable.id, name: productsTable.name, sku: productsTable.sku, slug: productsTable.slug }).from(productsTable);
  const catalog = {
    bySku: new Map(products.filter((p) => p.sku).map((p) => [p.sku!.trim().toLowerCase(), p.id] as const)),
    bySlug: new Map(products.map((p) => [p.slug.toLowerCase(), p.id] as const)),
  };
  const nameById = new Map(products.map((p) => [p.id, p.name] as const));

  let after: string | null = null;
  let count = 0;
  let unlinked = 0;
  for (let page = 0; page < 10; page++) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyOrderNode[] } } = await shopifyGraphql(creds, ORDERS_QUERY, {
      first: 50,
      after,
      query: `created_at:>='${since}'`,
    });
    for (const node of data.orders.nodes) {
      count += 1;
      const lines = mapShopifyLines(node, catalog);
      unlinked += lines.filter((l) => l.productId == null).length;
      console.log(
        `${node.name}  ${node.createdAt.slice(0, 16)}  pago ${node.displayFinancialStatus ?? "—"}${node.cancelledAt ? "  CANCELADO (no se importa)" : ""}${isSubscriptionOrder(node) ? "  [suscripción]" : ""}`,
      );
      console.log(`   cliente: ${customerName(node) ?? "—"} · ${node.email ?? node.customer?.email ?? "sin correo"} · ${formatShopifyAddress(node.shippingAddress) ?? "sin dirección"}`);
      for (const l of lines) {
        console.log(`   - ${l.description} x${l.quantity} → ${l.productId != null ? `vinculado a "${nameById.get(l.productId)}"` : "SIN VINCULAR (pon el SKU en el producto o revisa el handle)"}`);
      }
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  console.log(`\n${count} pedidos leídos; ${unlinked} líneas quedarían sin vincular. No se escribió nada.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
