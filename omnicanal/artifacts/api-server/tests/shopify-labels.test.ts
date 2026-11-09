// Etiquetas de los pedidos de Shopify (2026-10-20): leer las guías que Shopify ya
// tiene, usarlas al despachar y comprar la etiqueta con la API de Shopify Shipping.
// Lo puro corre siempre; el recorrido con la base necesita una base local
// DESECHABLE (DATABASE_URL) y, sin ella, se salta. Shopify se simula con fetch.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test";

import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  integrationSettingsTable,
  warehousesTable,
  contactsTable,
  ordersTable,
  orderEventsTable,
  orderItemsTable,
  shipmentsTable,
  shipmentOrdersTable,
  shipmentChargesTable,
  carriersTable,
  uspsLabelsTable,
  shopifyLabelsTable,
} from "@workspace/db";
import { createShipment, dispatchShipment, serializeShipment } from "../src/lib/fulfillment";
import { SYSTEM_ACTOR } from "../src/lib/inventory";
import { forgetShopifyToken } from "../src/lib/shopify";
import { applyShopifyOrder, shopifyExternalTracking, type ShopifyOrderNode, type ShopifySyncResult } from "../src/lib/shopify-sync";
import {
  buyShopifyLabel,
  discardShopifyLabel,
  eligibleFulfillmentOrders,
  labelDocument,
  refreshShopifyLabel,
  shopifyLabelDraft,
  shopifyLabelPdf,
  type ShopifyFulfillmentOrder,
} from "../src/lib/shopify-labels";
import { createUspsLabel } from "../src/lib/usps-labels";

const log = { info: () => {}, warn: () => {}, error: () => {} };

// ── Puras ─────────────────────────────────────────────────────────────────────

describe("shopifyExternalTracking", () => {
  const f = (status: string, numbers: Array<string | null>, extra: Partial<{ id: string; deliveredAt: string | null }> = {}) => ({
    id: extra.id ?? "gid://shopify/Fulfillment/1",
    status,
    deliveredAt: extra.deliveredAt ?? null,
    trackingInfo: numbers.map((number) => ({ company: "USPS", number, url: number ? `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}` : null })),
  });

  it("toma la guía de cada envío con su transportista y su enlace", () => {
    assert.deepEqual(shopifyExternalTracking({ fulfillments: [f("SUCCESS", ["9400111899223197428490"], { deliveredAt: "2026-10-22T10:00:00Z" })] }), [
      { fulfillmentId: "gid://shopify/Fulfillment/1", number: "9400111899223197428490", company: "USPS", url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490", deliveredAt: "2026-10-22T10:00:00Z" },
    ]);
  });

  it("ignora los envíos cancelados, las guías vacías y las repetidas", () => {
    const out = shopifyExternalTracking({
      fulfillments: [f("CANCELLED", ["111"]), f("SUCCESS", [null, " 222 ", "222"], { id: "gid://shopify/Fulfillment/2" }), f("ERROR", ["333"])],
    });
    assert.deepEqual(out?.map((t) => t.number), ["222"]);
  });

  it("sin guías es null (no una lista vacía)", () => {
    assert.equal(shopifyExternalTracking({ fulfillments: [] }), null);
    assert.equal(shopifyExternalTracking({}), null);
    assert.equal(shopifyExternalTracking({ fulfillments: [f("SUCCESS", [null])] }), null);
  });
});

describe("envíos y documentos de Shopify", () => {
  const fo = (id: string, status: string, location: string | null): ShopifyFulfillmentOrder => ({ id, status, assignedLocation: location ? { name: location } : null, destination: { city: "Miami", countryCode: "US" } });

  it("solo se etiqueta lo abierto o en curso y con ubicación asignada", () => {
    const eligible = eligibleFulfillmentOrders([fo("a", "OPEN", "Orlando"), fo("b", "CLOSED", "Orlando"), fo("c", "IN_PROGRESS", null), fo("d", "IN_PROGRESS", "Orlando"), fo("e", "CANCELLED", "Orlando")]);
    assert.deepEqual(eligible.map((n) => n.id), ["a", "d"]);
  });

  it("el documento es la etiqueta, no el formulario de aduanas", () => {
    const label = {
      id: "l",
      cancellable: true,
      printed: false,
      trackingInfo: null,
      shippingDocuments: [
        { documentType: "CUSTOMS_FORM", format: "PDF", url: "https://x/customs.pdf" },
        { documentType: "LABEL", format: "PDF", url: "https://x/label.pdf" },
      ],
    };
    assert.deepEqual(labelDocument(label), { url: "https://x/label.pdf", format: "PDF" });
    assert.equal(labelDocument({ ...label, shippingDocuments: [{ documentType: "LABEL", format: "PDF", url: null }] }), null);
  });
});

// ── Con la base ───────────────────────────────────────────────────────────────

const SHOP = "test-shop.myshopify.com";
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from([0xff, 0x00, 0x80]), Buffer.from("%%EOF")]);
let dbAvailable = false;
let seeded: { warehouseId: number; contactIds: number[]; orderIds: number[]; shipmentIds: number[] } | null = null;
let seq = 0;

// Lo que Shopify "responde" en cada prueba.
type FakeShopify = {
  fulfillmentOrders: ShopifyFulfillmentOrder[];
  userErrors: Array<{ field: string[] | null; code: string | null; message: string }>;
  purchaseGraphqlError: string | null;
  polls: string[]; // estados de las consultas sucesivas; el último se repite
  pollErrors: Array<{ code: string | null; message: string | null }>;
  company: string;
  documentStatus: number[]; // respuestas sucesivas al bajar el PDF
  documentBody: Buffer;
  calls: { purchase: Array<Record<string, unknown>>; polls: number; downloads: Array<Record<string, string>> };
  labelLookup: "found" | "missing";
};
let shop: FakeShopify;
const freshShop = (): FakeShopify => ({
  fulfillmentOrders: [{ id: "gid://shopify/FulfillmentOrder/77", status: "OPEN", requestStatus: "UNSUBMITTED", assignedLocation: { name: "Orlando" }, destination: { city: "Miami", countryCode: "US" } }],
  userErrors: [],
  purchaseGraphqlError: null,
  polls: ["PENDING_PURCHASE", "PURCHASED"],
  pollErrors: [],
  company: "USPS",
  documentStatus: [200],
  documentBody: PDF,
  calls: { purchase: [], polls: 0, downloads: [] },
  labelLookup: "found",
});

const gqlJson = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });

function labelNode(tracking: string) {
  return {
    id: `gid://shopify/ShippingLabel/${tracking}`,
    cancellable: true,
    printed: false,
    trackingInfo: { number: tracking, company: shop.company, url: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}` },
    shippingDocuments: [{ documentType: "LABEL", format: "PDF", url: `https://${SHOP}/labels/${tracking}.pdf` }],
  };
}

let currentTracking = "";

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url.endsWith("/label.pdf") || url.includes("/labels/")) {
    shop.calls.downloads.push(Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)));
    const status = shop.documentStatus[Math.min(shop.calls.downloads.length - 1, shop.documentStatus.length - 1)];
    return status === 200 ? new Response(shop.documentBody, { status: 200 }) : new Response("no", { status });
  }
  if (!url.includes("/admin/api/") || !url.endsWith("/graphql.json")) throw new Error(`Shopify no simulado: ${url}`);
  const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
  const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1];
  if (op === "FulfillmentOrdersForLabel") return gqlJson({ order: { id: variables.id, name: "#1001", fulfillmentOrders: { nodes: shop.fulfillmentOrders } } });
  if (op === "PurchaseShippingLabel") {
    shop.calls.purchase.push(variables.input as Record<string, unknown>);
    // Cada compra trae su propia guía (la base no admite dos etiquetas iguales).
    currentTracking = `94001118992231974${String(++seq).padStart(5, "0")}`;
    if (shop.purchaseGraphqlError) return new Response(JSON.stringify({ errors: [{ message: shop.purchaseGraphqlError }] }), { status: 200, headers: { "content-type": "application/json" } });
    return gqlJson({
      shippingLabelPurchase: { shippingLabelPurchaseResult: shop.userErrors.length ? null : { id: "gid://shopify/ShippingLabelPurchaseResult/9", status: "PENDING_PURCHASE" }, userErrors: shop.userErrors },
    });
  }
  if (op === "ShippingLabelPurchaseResult") {
    const status = shop.polls[Math.min(shop.calls.polls, shop.polls.length - 1)];
    shop.calls.polls++;
    return gqlJson({
      node: { id: variables.id, status, done: status !== "PENDING_PURCHASE", errors: status === "PURCHASE_FAILED" ? shop.pollErrors : [], shippingLabels: status === "PURCHASED" ? [labelNode(currentTracking)] : [] },
    });
  }
  if (op === "ShippingLabelById") return gqlJson({ shippingLabel: shop.labelLookup === "found" ? labelNode(String(variables.id).split("/").pop()!) : null });
  throw new Error(`operación de Shopify no simulada: ${op}`);
}

async function setSettings(patch: Partial<typeof integrationSettingsTable.$inferInsert> = {}) {
  const [row] = await db.select().from(integrationSettingsTable).limit(1);
  const values = { shopifyEnabled: true, shopifyLabelsEnabled: true, shopifyShopDomain: SHOP, shopifyAccessToken: "shpat_test", ...patch };
  if (row) await db.update(integrationSettingsTable).set(values).where(eq(integrationSettingsTable.id, row.id));
  else await db.insert(integrationSettingsTable).values(values);
}

async function newOrder(opts: { source?: string; tracking?: boolean } = {}) {
  const n = ++seq;
  const [order] = await db
    .insert(ordersTable)
    .values({
      contactId: seeded!.contactIds[0],
      status: "processing",
      product: "Procollagen",
      quantity: 1,
      address: "Juan Pérez, 123 Main St Apt 4, Miami, FL 33101",
      warehouseId: seeded!.warehouseId,
      source: opts.source ?? "shopify",
      externalId: (opts.source ?? "shopify") === "shopify" ? `gid://shopify/Order/${Date.now()}${n}` : null,
      externalName: `#${1000 + n}`,
      externalTracking: opts.tracking ? [{ fulfillmentId: "gid://shopify/Fulfillment/5", number: "9400000000000000000001", company: "USPS", url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400000000000000000001", deliveredAt: null }] : null,
    })
    .returning();
  seeded!.orderIds.push(order.id);
  return order;
}

async function newStop(opts: { source?: string; tracking?: boolean } = {}) {
  const order = await newOrder(opts);
  const shipment = await createShipment({ kind: "courier", warehouseId: seeded!.warehouseId, orderIds: [order.id] }, SYSTEM_ACTOR, { quiet: true });
  seeded!.shipmentIds.push(shipment.id);
  return { order, shipment };
}

const buy = (stop: { order: { id: number }; shipment: { id: number } }, input: { weightOz?: number | null } = {}) =>
  buyShopifyLabel(stop.shipment.id, stop.order.id, { ...input, pollMs: 1, timeoutMs: 2000 }, SYSTEM_ACTOR, log);
const stopOf = async (shipmentId: number) => (await db.select().from(shipmentOrdersTable).where(eq(shipmentOrdersTable.shipmentId, shipmentId)))[0];
const orderOf = async (id: number) => (await db.select().from(ordersTable).where(eq(ordersTable.id, id)))[0];
const eventsOf = async (orderId: number) => (await db.select().from(orderEventsTable).where(eq(orderEventsTable.orderId, orderId))).map((e) => e.detail);
const labelsOf = (orderId: number) => db.select().from(shopifyLabelsTable).where(eq(shopifyLabelsTable.orderId, orderId));

before(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }
  const [warehouse] = await db.insert(warehousesTable).values({ code: `S${Date.now() % 100000}`, name: "Almacén de prueba Shopify" }).returning();
  const [contact] = await db.insert(contactsTable).values({ name: "Juan Pérez" }).returning();
  seeded = { warehouseId: warehouse.id, contactIds: [contact.id], orderIds: [], shipmentIds: [] };
});

beforeEach(async () => {
  if (!dbAvailable) return;
  forgetShopifyToken();
  shop = freshShop();
  currentTracking = `94001118992231974${String(++seq).padStart(5, "0")}`;
  await setSettings();
  mock.method(globalThis, "fetch", fakeFetch);
});

afterEach(() => mock.restoreAll());

after(async () => {
  if (!dbAvailable || !seeded) return;
  if (seeded.orderIds.length) {
    await db.delete(shopifyLabelsTable).where(inArray(shopifyLabelsTable.orderId, seeded.orderIds));
    await db.delete(uspsLabelsTable).where(inArray(uspsLabelsTable.orderId, seeded.orderIds));
  }
  if (seeded.shipmentIds.length) {
    await db.delete(shipmentChargesTable).where(inArray(shipmentChargesTable.shipmentId, seeded.shipmentIds));
    await db.delete(shipmentOrdersTable).where(inArray(shipmentOrdersTable.shipmentId, seeded.shipmentIds));
    await db.delete(shipmentsTable).where(inArray(shipmentsTable.id, seeded.shipmentIds));
  }
  if (seeded.orderIds.length) {
    await db.delete(orderEventsTable).where(inArray(orderEventsTable.orderId, seeded.orderIds));
    await db.delete(orderItemsTable).where(inArray(orderItemsTable.orderId, seeded.orderIds));
    await db.delete(ordersTable).where(inArray(ordersTable.id, seeded.orderIds));
  }
  await db.delete(contactsTable).where(inArray(contactsTable.id, seeded.contactIds));
  await db.delete(warehousesTable).where(eq(warehousesTable.id, seeded.warehouseId));
  await db.delete(carriersTable).where(eq(carriersTable.name, "USPS"));
  await db.delete(integrationSettingsTable);
});

describe("las guías de Shopify en el pedido", () => {
  const node = (id: string, fulfillments: ShopifyOrderNode["fulfillments"]): ShopifyOrderNode => ({
    id,
    name: "#9950",
    createdAt: "2026-10-05T15:00:00Z",
    updatedAt: "2026-10-05T15:05:00Z",
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    email: `guia-${Date.now()}@example.com`,
    phone: null,
    customerLocale: "es",
    note: null,
    customAttributes: [],
    sourceName: "web",
    currencyCode: "USD",
    totalShippingPriceSet: { shopMoney: { amount: "0.00" } },
    customer: { firstName: "Prueba", lastName: "Guía", email: null, phone: null },
    shippingAddress: null,
    fulfillments,
    lineItems: { nodes: [{ id: `gid://shopify/LineItem/${Date.now()}`, title: "Procollagen", quantity: 1, sku: null, variant: null, originalUnitPriceSet: { shopMoney: { amount: "110.00" } }, totalDiscountSet: { shopMoney: { amount: "0.00" } }, sellingPlan: null }] },
  });
  const ctx = () => ({
    syncFrom: new Date("2026-10-01T00:00:00Z"),
    catalog: { bySku: new Map<string, number>(), bySlug: new Map<string, number>() },
    warehouseId: null,
    log,
    result: { imported: 0, updated: 0, cancelled: 0, skipped: 0, error: null } as ShopifySyncResult,
  });
  const ful = (status: string, number: string) => [{ id: "gid://shopify/Fulfillment/1", status, deliveredAt: null, trackingInfo: [{ company: "USPS", number, url: null }] }];

  it("se guardan al importar el pedido y se actualizan cuando Shopify cambia el envío", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const id = `gid://shopify/Order/88${Date.now()}`;
    await applyShopifyOrder(node(id, ful("SUCCESS", "9400111111111111111111")), ctx());
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.externalId, id));
    seeded!.orderIds.push(order.id);
    seeded!.contactIds.push(order.contactId);
    assert.deepEqual(order.externalTracking?.map((x) => [x.number, x.company]), [["9400111111111111111111", "USPS"]]);

    // Misma guía: nada que reflejar.
    const same = ctx();
    await applyShopifyOrder(node(id, ful("SUCCESS", "9400111111111111111111")), same);
    assert.equal(same.result.updated, 0);

    // Shopify cambia de guía: se refleja y queda en el expediente.
    const changed = ctx();
    await applyShopifyOrder(node(id, ful("SUCCESS", "9400222222222222222222")), changed);
    assert.equal(changed.result.updated, 1);
    assert.deepEqual((await orderOf(order.id)).externalTracking?.map((x) => x.number), ["9400222222222222222222"]);
    assert.ok((await eventsOf(order.id)).some((d) => d.includes("guía 9400222222222222222222 (USPS)")));

    // Se cancela el envío: ya no hay guía.
    await applyShopifyOrder(node(id, ful("CANCELLED", "9400222222222222222222")), ctx());
    assert.equal((await orderOf(order.id)).externalTracking, null);
    assert.ok((await eventsOf(order.id)).some((d) => d.includes("ya no tiene guía")));
  });
});

describe("la guía de Shopify al despachar", () => {
  it("la parada sin guía toma la de Shopify y el despacho la lleva", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const { order, shipment } = await newStop({ tracking: true });
    await dispatchShipment(shipment.id, {}, SYSTEM_ACTOR, log);
    assert.equal((await stopOf(shipment.id)).trackingNumber, "9400000000000000000001");
    assert.equal((await orderOf(order.id)).status, "shipped");
    assert.ok((await eventsOf(order.id)).some((d) => d.includes("guía 9400000000000000000001")));
    const [row] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, shipment.id));
    const view = await serializeShipment(row);
    assert.equal(view.stops[0].orderSource, "shopify");
    assert.equal(view.stops[0].externalTracking[0].number, "9400000000000000000001");
  });

  it("una guía que ya trae la parada no se pisa", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const { shipment } = await newStop({ tracking: true });
    await db.update(shipmentOrdersTable).set({ trackingNumber: "MANUAL-1" }).where(eq(shipmentOrdersTable.shipmentId, shipment.id));
    await dispatchShipment(shipment.id, {}, SYSTEM_ACTOR, log);
    assert.equal((await stopOf(shipment.id)).trackingNumber, "MANUAL-1");
  });
});

describe("comprar la etiqueta con Shopify", () => {
  it("pide la compra sin avisar al cliente, espera el resultado y deja la guía, el courier y el PDF", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    const { label, warnings } = await buy(stop, { weightOz: 12 });

    assert.equal(label.status, "active");
    assert.equal(label.trackingNumber, currentTracking);
    assert.equal(label.trackingCompany, "USPS");
    assert.equal(label.hasPdf, true);
    assert.equal(label.cancellable, true);
    assert.ok(warnings.some((w) => w.includes("no informa el costo")));
    assert.equal(shop.calls.polls, 2, "esperó a que pasara de PENDING_PURCHASE a PURCHASED");

    const input = shop.calls.purchase[0] as { fulfillmentOrderId: string; shippingDatetime: string; notifyCustomer: boolean; totalWeight?: { value: number; unit: string }; preferredRateSelection?: unknown };
    assert.equal(input.fulfillmentOrderId, "gid://shopify/FulfillmentOrder/77");
    assert.equal(input.notifyCustomer, false, "el aviso al cliente es nuestro correo, no el de Shopify");
    assert.deepEqual(input.totalWeight, { value: 12, unit: "OUNCES" });
    assert.ok(new Date(input.shippingDatetime).getTime() > Date.now(), "la fecha de envío tiene que ser a futuro");
    assert.equal(input.preferredRateSelection, undefined, "la tarifa la elige Shopify");

    assert.equal((await stopOf(stop.shipment.id)).trackingNumber, currentTracking);
    const [shipment] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, stop.shipment.id));
    const [carrier] = await db.select().from(carriersTable).where(eq(carriersTable.name, "USPS"));
    assert.equal(shipment.carrierId, carrier.id);
    assert.deepEqual((await orderOf(stop.order.id)).externalTracking?.map((x) => x.number), [currentTracking]);
    assert.ok((await eventsOf(stop.order.id)).some((d) => d.includes("Etiqueta comprada con Shopify") && d.includes(currentTracking)));
    assert.equal((await db.select().from(shipmentChargesTable).where(eq(shipmentChargesTable.shipmentId, stop.shipment.id))).length, 0, "sin costo informado no se inventa un cargo");

    const { pdf, filename } = await shopifyLabelPdf(label.id);
    assert.ok(pdf.equals(PDF));
    assert.ok(filename.includes(currentTracking));
    const view = await serializeShipment(shipment);
    assert.equal(view.stops[0].shopifyLabel?.trackingNumber, currentTracking);
  });

  it("sin peso no manda totalWeight (Shopify lo calcula)", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    await buy(await newStop());
    assert.equal((shop.calls.purchase[0] as { totalWeight?: unknown }).totalWeight, undefined);
  });

  it("no se paga dos veces: la segunda se rechaza y dos clics a la vez compran una sola", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    await buy(stop);
    await assert.rejects(buy(stop), /ya tiene una etiqueta/);
    assert.equal(shop.calls.purchase.length, 1);

    const other = await newStop();
    const results = await Promise.allSettled([buy(other), buy(other)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(shop.calls.purchase.length, 2);
  });

  it("si Shopify rechaza la compra (userErrors), la parada queda libre", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    shop.userErrors = [{ field: ["fulfillmentOrderId"], code: "RATES_NOT_FOUND", message: "No rates are available" }];
    await assert.rejects(buy(stop), /No rates are available/);
    assert.equal((await labelsOf(stop.order.id)).length, 0);
    shop.userErrors = [];
    assert.equal((await buy(stop)).label.status, "active");
  });

  it("si la compra falla después (PURCHASE_FAILED), no se compró nada y se puede reintentar", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    shop.polls = ["PENDING_PURCHASE", "PURCHASE_FAILED"];
    shop.pollErrors = [{ code: "BILLING_FAILURE", message: "Payment method declined" }];
    await assert.rejects(buy(stop), /Payment method declined/);
    assert.equal((await labelsOf(stop.order.id)).length, 0);
    assert.equal((await stopOf(stop.shipment.id)).trackingNumber, null);
  });

  it("si Shopify tarda, la parada queda reservada con el id de la compra y «Consultar» la retoma", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    shop.polls = ["PENDING_PURCHASE"];
    await assert.rejects(
      buyShopifyLabel(stop.shipment.id, stop.order.id, { pollMs: 1, timeoutMs: 30 }, SYSTEM_ACTOR, log),
      /aún no confirma/,
    );
    const [pending] = await labelsOf(stop.order.id);
    assert.equal(pending.status, "creating");
    assert.equal(pending.purchaseResultId, "gid://shopify/ShippingLabelPurchaseResult/9");
    await assert.rejects(buy(stop), /ya tiene una etiqueta/, "mientras tanto no se compra otra");

    shop.polls = ["PURCHASED"];
    const resumed = await refreshShopifyLabel(pending.id, SYSTEM_ACTOR, log);
    assert.equal(resumed.label.status, "active");
    assert.equal(resumed.label.trackingNumber, currentTracking);
    assert.equal((await stopOf(stop.shipment.id)).trackingNumber, currentTracking);
    assert.equal(shop.calls.purchase.length, 1, "retomar no compra otra vez");
  });

  it("sin respuesta de Shopify al pedir la compra, avisa que revise el admin antes de reintentar", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    mock.restoreAll();
    mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      if (String(init?.body).includes("PurchaseShippingLabel")) throw new TypeError("fetch failed");
      return fakeFetch(input, init);
    });
    await assert.rejects(buy(stop), /revisa en el admin de Shopify/);
    assert.equal((await labelsOf(stop.order.id)).length, 0);
  });

  it("explica los permisos que faltan cuando Shopify niega el acceso", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    shop.purchaseGraphqlError = "Access denied for shippingLabelPurchase field. Required access: `write_orders` access scope.";
    await assert.rejects(buy(stop), /write_merchant_managed_fulfillment_orders/);
    assert.equal((await labelsOf(stop.order.id)).length, 0);
  });

  it("no hay envío pendiente o hay varios: no se compra nada", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    const open = shop.fulfillmentOrders[0];
    shop.fulfillmentOrders = [{ ...open, status: "CLOSED" }];
    await assert.rejects(buy(stop), /ya esté cumplido/);
    shop.fulfillmentOrders = [open, { ...open, id: "gid://shopify/FulfillmentOrder/78" }];
    await assert.rejects(buy(stop), /varios envíos pendientes/);
    assert.equal(shop.calls.purchase.length, 0);
    assert.equal((await labelsOf(stop.order.id)).length, 0);
  });

  it("se salta lo que no se puede bajar: avisa y deja la guía igual", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    shop.documentBody = Buffer.from("<html>login</html>");
    const { label, warnings } = await buy(stop);
    assert.equal(label.status, "active");
    assert.equal(label.hasPdf, false);
    assert.ok(warnings.some((w) => w.includes("No se pudo bajar el PDF")));
    assert.equal((await stopOf(stop.shipment.id)).trackingNumber, currentTracking);
  });

  it("si el PDF pide el token, lo reintenta con él (solo en un dominio de Shopify)", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    shop.documentStatus = [403, 200];
    const { label } = await buy(stop);
    assert.equal(label.hasPdf, true);
    assert.deepEqual(shop.calls.downloads[0], {});
    assert.equal(shop.calls.downloads[1]["x-shopify-access-token"], "shpat_test");
  });

  it("otro transportista no cambia el courier del despacho a USPS", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    shop.company = "UPS";
    await buy(stop);
    const [shipment] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, stop.shipment.id));
    assert.equal(shipment.carrierId, null);
  });
});

describe("cuándo no se puede comprar con Shopify", () => {
  it("lo dice con la razón y no llama a Shopify", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const cases: Array<[string, () => Promise<{ order: { id: number }; shipment: { id: number } }>, RegExp]> = [
      ["no es de Shopify", () => newStop({ source: "chat" }), /no es de Shopify/],
      ["ya tiene guía en Shopify", () => newStop({ tracking: true }), /ya tiene guía en Shopify \(9400000000000000000001\)/],
      [
        "el despacho ya salió",
        async () => {
          const s = await newStop();
          await db.update(shipmentsTable).set({ status: "dispatched" }).where(eq(shipmentsTable.id, s.shipment.id));
          return s;
        },
        /antes de registrar el despacho/,
      ],
    ];
    for (const [name, make, expected] of cases) {
      const stop = await make();
      await assert.rejects(buy(stop), expected, name);
    }
    const stop = await newStop();
    await setSettings({ shopifyLabelsEnabled: false });
    await assert.rejects(buy(stop), /apagada/);
    await setSettings({ shopifyLabelsEnabled: true, shopifyShopDomain: null });
    await assert.rejects(buy(stop), /no está conectado/);
    assert.equal(shop.calls.purchase.length, 0);
  });

  it("el borrador explica el motivo y si queda el USPS directo", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const free = await newStop();
    assert.deepEqual(await shopifyLabelDraft(free.shipment.id, free.order.id), { orderName: free.order.externalName, blocker: null, uspsFallback: true, externalTracking: [], label: null });

    await setSettings({ shopifyLabelsEnabled: false });
    const off = await shopifyLabelDraft(free.shipment.id, free.order.id);
    assert.match(off.blocker ?? "", /apagada/);
    assert.equal(off.uspsFallback, true, "apagada la compra con Shopify, el USPS directo sigue siendo una opción");

    await setSettings({ shopifyLabelsEnabled: true });
    const tracked = await newStop({ tracking: true });
    const draft = await shopifyLabelDraft(tracked.shipment.id, tracked.order.id);
    assert.match(draft.blocker ?? "", /ya tiene guía/);
    assert.equal(draft.uspsFallback, false, "con guía de Shopify no se compra otra");
    assert.equal(draft.externalTracking[0].number, "9400000000000000000001");
  });

  it("el USPS directo tampoco compra si el pedido ya tiene guía de Shopify o una etiqueta de Shopify", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    await setSettings({ uspsEnabled: true, uspsEnvironment: "test", uspsClientId: "k", uspsClientSecret: "s", uspsCrid: "1", uspsMid: "2", uspsAccountNumber: "3", uspsFromName: "A", uspsFromStreet: "1 St", uspsFromCity: "Orlando", uspsFromState: "FL", uspsFromZip: "32801" });
    const input = { to: { firstName: "Juan", lastName: "Pérez", streetAddress: "123 Main St", city: "Miami", state: "FL", ZIPCode: "33101" }, package: { mailClass: "USPS_GROUND_ADVANTAGE", weightOz: 12, lengthIn: 9, widthIn: 6, heightIn: 3 } };

    const tracked = await newStop({ tracking: true });
    await assert.rejects(createUspsLabel(tracked.shipment.id, tracked.order.id, input, SYSTEM_ACTOR, log), /ya tiene guía en Shopify/);

    const labeled = await newStop();
    await buy(labeled);
    await db.update(ordersTable).set({ externalTracking: null }).where(eq(ordersTable.id, labeled.order.id)); // aísla la guarda de la etiqueta viva
    await assert.rejects(createUspsLabel(labeled.shipment.id, labeled.order.id, input, SYSTEM_ACTOR, log), /comprada con Shopify/);
  });

  it("al revés: con una etiqueta de USPS directo vigente no se compra con Shopify", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    await db.insert(uspsLabelsTable).values({
      orderId: stop.order.id,
      shipmentId: stop.shipment.id,
      status: "active",
      environment: "test",
      trackingNumber: `T-${Date.now()}`,
      mailClass: "USPS_GROUND_ADVANTAGE",
      weightLb: 1,
      lengthIn: 1,
      widthIn: 1,
      heightIn: 1,
      toAddress: { firstName: "A", lastName: "B", streetAddress: "1 St", secondaryAddress: null, city: "X", state: "FL", ZIPCode: "33101", ZIPPlus4: null },
    });
    await assert.rejects(buy(stop), /ya tiene una etiqueta de USPS directo/);
    assert.equal((await shopifyLabelDraft(stop.shipment.id, stop.order.id)).uspsFallback, false);
  });
});

describe("descartar y volver a leer", () => {
  it("descartar quita la guía de la parada y del pedido y libera la parada para otra etiqueta", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    const { label } = await buy(stop);
    const discarded = await discardShopifyLabel(label.id, SYSTEM_ACTOR, log);
    assert.equal(discarded.status, "discarded");
    assert.equal((await stopOf(stop.shipment.id)).trackingNumber, null);
    assert.equal((await orderOf(stop.order.id)).externalTracking, null);
    assert.ok((await eventsOf(stop.order.id)).some((d) => d.includes("descartada")));
    await assert.rejects(discardShopifyLabel(label.id, SYSTEM_ACTOR, log), /ya se descartó/);

    currentTracking = `94001118992231974${String(++seq).padStart(5, "0")}`;
    const again = await buy(stop);
    assert.equal(again.label.trackingNumber, currentTracking);
    assert.equal((await labelsOf(stop.order.id)).length, 2, "la descartada queda de historial");
  });

  it("volver a leer una vigente actualiza si todavía se puede anular y avisa si Shopify ya no la devuelve", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const stop = await newStop();
    const { label } = await buy(stop);
    const again = await refreshShopifyLabel(label.id, SYSTEM_ACTOR, log);
    assert.equal(again.label.status, "active");
    assert.equal(again.label.note, null);

    shop.labelLookup = "missing";
    const gone = await refreshShopifyLabel(label.id, SYSTEM_ACTOR, log);
    assert.match(gone.label.note ?? "", /ya no devuelve esta etiqueta/);
    assert.equal(gone.label.status, "active", "no se descarta sola: lo decide una persona");
  });
});
