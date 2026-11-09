// Pasa a líneas del catálogo los pedidos ABIERTOS (Pendiente / En proceso) que se
// crearon antes del inventario (2026-10-04), cuando el pedido era solo texto
// ("Procollagen x2"). Sin líneas un pedido no compromete existencias: al encender
// el inventario, estos pedidos venderían de un stock que nadie apartó.
//
// Por defecto SOLO MUESTRA lo que haría. Con --aplicar, escribe. Lo que no se
// pueda leer con seguridad (ningún producto, o varios) se lista para hacerlo a
// mano desde la vista de Pedidos.
//
//   CLIENT_ID=premier DATABASE_URL=… \
//     pnpm --filter @workspace/api-server exec tsx scripts/backfill-order-items.ts [--aplicar]

import { and, eq, inArray, notExists } from "drizzle-orm";
import { db, pool, ordersTable, orderItemsTable, productsTable } from "@workspace/db";
import { clientConfig } from "../src/lib/client-config";
import { replaceOrderItems, orderCode } from "../src/lib/orders";

const apply = process.argv.includes("--aplicar");

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function main() {
  console.log(`Cliente: ${clientConfig.id} — ${apply ? "APLICANDO" : "simulación (usa --aplicar para escribir)"}`);
  const products = await db.select({ id: productsTable.id, name: productsTable.name }).from(productsTable).where(eq(productsTable.active, true));
  const open = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        inArray(ordersTable.status, ["pending", "processing"]),
        notExists(db.select({ id: orderItemsTable.id }).from(orderItemsTable).where(eq(orderItemsTable.orderId, ordersTable.id))),
      ),
    );
  console.log(`${open.length} pedidos abiertos sin líneas.`);

  let done = 0;
  const manual: string[] = [];
  for (const order of open) {
    const text = normalize(order.product ?? "");
    // El nombre más largo primero: "Kit Duo Procollagen…" contiene "Procollagen",
    // y si todos los que casan están dentro del más largo, es ese.
    const matches = products
      .filter((p) => text && text.includes(normalize(p.name)))
      .sort((a, b) => b.name.length - a.name.length);
    const longest = matches[0];
    const unambiguous = longest && matches.every((m) => normalize(longest.name).includes(normalize(m.name)));
    if (!unambiguous) {
      manual.push(`${orderCode(order.id)} "${order.product ?? "sin producto"}" → ${matches.length ? `varios: ${matches.map((m) => m.name).join(", ")}` : "ningún producto del catálogo"}`);
      continue;
    }
    const product = longest;
    console.log(`  ${orderCode(order.id)} "${order.product}" → ${product.name} x${order.quantity}`);
    if (apply) await replaceOrderItems(order.id, [{ productId: product.id, quantity: order.quantity }], { agentId: null, label: "Sistema" });
    done += 1;
  }
  console.log(`\n${apply ? "Pasados" : "Se pasarían"} a líneas: ${done}.`);
  if (manual.length) {
    console.log(`Para revisar a mano en Pedidos (${manual.length}):`);
    for (const m of manual) console.log(`  ${m}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
