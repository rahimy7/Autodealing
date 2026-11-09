// Prueba la lista de suscriptores contra la tienda real SIN ESCRIBIR NADA: recorre
// los clientes con las mismas consultas que la vista de Suscripciones
// (lib/shopify-subscribers.ts) y muestra cuántos hay en cada estado y qué se
// leería de los primeros 20, sin nombres, correos ni teléfonos.
//
// Credenciales: las de la instancia (Configuración → Shopify). Si hay un token
// guardado y también Client ID/Secret, prueba con el Client ID/Secret: un token
// viejo que gana sobre ellos es la causa típica del 401. DATABASE_URL y CLIENT_ID
// salen del .env del repo cuando no vienen en el entorno.
//
//   pnpm --filter @workspace/api-server exec tsx scripts/shopify-subscribers-dry-run.ts

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Solo lo que hace falta para leer la configuración; el resto del .env no se carga.
function loadRepoEnv(): void {
  let text = "";
  try {
    text = readFileSync(fileURLToPath(new URL("../../../.env", import.meta.url)), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const match = line.match(/^(DATABASE_URL|CLIENT_ID)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

type StatusPage = { customers: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ id: string; productSubscriberStatus: string }> } };

async function main() {
  loadRepoEnv();
  // Después de cargar el entorno: @workspace/db exige DATABASE_URL al importarse.
  const { pool } = await import("@workspace/db");
  const { loadShopifySettings, credentialsFrom } = await import("../src/lib/shopify-sync");
  const { shopifyGraphql } = await import("../src/lib/shopify");
  const { CUSTOMER_STATUS_QUERY, SUBSCRIBER_DETAILS_QUERY, subscriberFromShopify, isSubscriberStatus } = await import("../src/lib/shopify-subscribers");
  type DetailsNode = import("../src/lib/shopify-subscribers").ShopifySubscriberNode;

  try {
    const settings = await loadShopifySettings();
    const stored = settings ? credentialsFrom(settings) : null;
    if (!stored) throw new Error("Falta la tienda o sus credenciales (Configuración → Shopify).");
    const useClient = Boolean(stored.clientId && stored.clientSecret);
    const creds = useClient ? { ...stored, accessToken: null } : stored;
    console.log(`Tienda ${creds.shopDomain} — con ${useClient ? "el Client ID/Secret" : "el token guardado"} (solo lectura)\n`);

    const started = Date.now();
    const counts = new Map<string, number>();
    const subscribers: string[] = [];
    let scanned = 0;
    let pages = 0;
    let after: string | null = null;
    do {
      const data: StatusPage = await shopifyGraphql(creds, CUSTOMER_STATUS_QUERY, { after });
      pages += 1;
      for (const c of data.customers.nodes) {
        scanned += 1;
        counts.set(c.productSubscriberStatus, (counts.get(c.productSubscriberStatus) ?? 0) + 1);
        if (isSubscriberStatus(c.productSubscriberStatus)) subscribers.push(c.id);
      }
      after = data.customers.pageInfo.hasNextPage ? data.customers.pageInfo.endCursor : null;
    } while (after);

    console.log(`Clientes recorridos: ${scanned} en ${pages} página(s), ${((Date.now() - started) / 1000).toFixed(1)} s`);
    for (const [status, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${status.padEnd(17)} ${n}`);
    console.log(`Suscriptores (todo menos NEVER_SUBSCRIBED): ${subscribers.length}`);

    const sample = subscribers.slice(0, 20);
    if (sample.length) {
      const data = await shopifyGraphql<{ nodes: Array<DetailsNode | null> }>(creds, SUBSCRIBER_DETAILS_QUERY, { ids: sample });
      const snaps = data.nodes.filter((n): n is DetailsNode => n != null).map(subscriberFromShopify);
      const plans = new Map<string, number>();
      const products = new Map<string, number>();
      for (const s of snaps) {
        if (s.lastOrder?.sellingPlan) plans.set(s.lastOrder.sellingPlan, (plans.get(s.lastOrder.sellingPlan) ?? 0) + 1);
        if (s.lastOrder?.products) products.set(s.lastOrder.products, (products.get(s.lastOrder.products) ?? 0) + 1);
      }
      console.log(`\nDetalle de los primeros ${snaps.length} (sin datos personales):`);
      console.log(`  con nombre ${snaps.filter((s) => s.name).length} · con correo ${snaps.filter((s) => s.email).length} · con teléfono ${snaps.filter((s) => s.phone).length}`);
      console.log(`  con pedido de suscripción en los últimos 60 días: ${snaps.filter((s) => s.lastOrder).length}`);
      console.log(`  planes de venta: ${[...plans].map(([p, n]) => `"${p}" (${n})`).join(", ") || "—"}`);
      console.log(`  productos: ${[...products].map(([p, n]) => `${p} (${n})`).join(", ") || "—"}`);
    }
    console.log("\nNo se escribió nada.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
