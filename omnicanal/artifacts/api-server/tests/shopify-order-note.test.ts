// El comentario y el pago de Shopify en el pedido (2026-10-06): se importan con el
// pedido y se reflejan cuando cambian allá. Necesita base local (DATABASE_URL);
// no llama a Shopify: aplica el pedido tal como lo devuelve ORDERS_QUERY.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, ordersTable, orderEventsTable, orderItemsTable, contactsTable } from "@workspace/db";
import { applyShopifyOrder, type ShopifyOrderNode, type ShopifySyncResult } from "../src/lib/shopify-sync";

const log = { info: () => {}, warn: () => {}, error: () => {} };
const EXTERNAL_ID = `gid://shopify/Order/99${Date.now()}`;

const node: ShopifyOrderNode = {
  id: EXTERNAL_ID,
  name: "#9901",
  createdAt: "2026-10-05T15:00:00Z",
  updatedAt: "2026-10-05T15:05:00Z",
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  email: `nota-${Date.now()}@example.com`,
  phone: null,
  customerLocale: "es",
  note: "Dejar en recepción",
  customAttributes: [
    { key: "Mensaje de regalo", value: "Feliz cumpleaños" },
    { key: "_subscription_contract_id", value: "123" },
  ],
  sourceName: "web",
  currencyCode: "USD",
  totalShippingPriceSet: { shopMoney: { amount: "0.00" } },
  customer: { firstName: "Prueba", lastName: "Nota", email: null, phone: null },
  shippingAddress: null,
  lineItems: {
    nodes: [
      {
        id: `gid://shopify/LineItem/99${Date.now()}`,
        title: "Procollagen",
        quantity: 1,
        sku: null,
        variant: null,
        originalUnitPriceSet: { shopMoney: { amount: "110.00" } },
        totalDiscountSet: { shopMoney: { amount: "0.00" } },
        sellingPlan: null,
      },
    ],
  },
};

function ctx() {
  const result: ShopifySyncResult = { imported: 0, updated: 0, cancelled: 0, skipped: 0, error: null };
  return { syncFrom: new Date("2026-10-01T00:00:00Z"), catalog: { bySku: new Map<string, number>(), bySlug: new Map<string, number>() }, warehouseId: null, log, result };
}

async function load() {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.externalId, EXTERNAL_ID));
  const events = order ? await db.select().from(orderEventsTable).where(eq(orderEventsTable.orderId, order.id)) : [];
  return { order, events: events.map((e) => e.detail) };
}

after(async () => {
  const { order } = await load();
  if (!order) return;
  await db.delete(orderEventsTable).where(eq(orderEventsTable.orderId, order.id));
  await db.delete(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  await db.delete(ordersTable).where(eq(ordersTable.id, order.id));
  await db.delete(contactsTable).where(eq(contactsTable.id, order.contactId));
});

describe("el comentario y el pago de Shopify en el pedido", () => {
  it("se importan con el pedido", async () => {
    const c = ctx();
    await applyShopifyOrder(node, c);
    assert.equal(c.result.imported, 1);
    const { order } = await load();
    assert.equal(order?.externalNote, "Dejar en recepción\nMensaje de regalo: Feliz cumpleaños");
    assert.equal(order?.externalFinancialStatus, "PAID");
    assert.equal(order?.notes, null, "las notas del equipo no se tocan");
  });

  it("si cambian en Shopify se reflejan, con su evento cada uno", async () => {
    const c = ctx();
    await applyShopifyOrder({ ...node, note: "Llamar antes de entregar", customAttributes: [], displayFinancialStatus: "PARTIALLY_REFUNDED" }, c);
    assert.equal(c.result.updated, 1);
    const { order, events } = await load();
    assert.equal(order?.externalNote, "Llamar antes de entregar");
    assert.equal(order?.externalFinancialStatus, "PARTIALLY_REFUNDED");
    assert.ok(events.includes("Shopify: cambió el comentario del pedido."));
    assert.ok(events.includes('Shopify: el pago está "PARTIALLY_REFUNDED".'));
  });

  it("sin cambios no escribe nada, y si se borra la nota se borra aquí", async () => {
    const same = ctx();
    await applyShopifyOrder({ ...node, note: "Llamar antes de entregar", customAttributes: [], displayFinancialStatus: "PARTIALLY_REFUNDED" }, same);
    assert.equal(same.result.skipped, 1);

    const cleared = ctx();
    await applyShopifyOrder({ ...node, note: null, customAttributes: [], displayFinancialStatus: "PARTIALLY_REFUNDED" }, cleared);
    assert.equal(cleared.result.updated, 1);
    const { order, events } = await load();
    assert.equal(order?.externalNote, null);
    assert.ok(events.includes("Shopify: se borró el comentario del pedido."));
  });
});
