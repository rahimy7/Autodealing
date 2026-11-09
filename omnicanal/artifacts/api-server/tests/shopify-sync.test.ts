import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { customerName, formatShopifyAddress, isSubscriptionOrder, mapShopifyLines, moneyToCents, shopifyOrderNote, type ShopifyOrderNode } from "../src/lib/shopify-sync";
import { normalizeShopDomain, throttleDelayMs } from "../src/lib/shopify";

// Un pedido como lo devuelve ORDERS_QUERY (Admin API GraphQL), recortado.
const order: ShopifyOrderNode = {
  id: "gid://shopify/Order/5550001",
  name: "#1045",
  createdAt: "2026-10-04T15:00:00Z",
  updatedAt: "2026-10-04T15:05:00Z",
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  email: "Maria@Example.com",
  phone: null,
  customerLocale: "es",
  sourceName: "web",
  currencyCode: "USD",
  totalShippingPriceSet: { shopMoney: { amount: "0.00" } },
  customer: { firstName: "María", lastName: "Pérez", email: "maria@example.com", phone: "+18095551234" },
  shippingAddress: { name: "María Pérez", address1: "Calle 5 #12", address2: null, city: "Santo Domingo", province: "Distrito Nacional", zip: "10101", country: "Dominican Republic", phone: "+18095551234" },
  lineItems: {
    nodes: [
      {
        id: "gid://shopify/LineItem/1",
        title: "Procollagen",
        quantity: 2,
        sku: "PROC-01",
        variant: { sku: "PROC-01", product: { handle: "procollagen" } },
        originalUnitPriceSet: { shopMoney: { amount: "110.00" } },
        totalDiscountSet: { shopMoney: { amount: "10.50" } },
        sellingPlan: null,
      },
      {
        id: "gid://shopify/LineItem/2",
        title: "NAD Advanced",
        quantity: 1,
        sku: null,
        variant: { sku: null, product: { handle: "nad-advanced" } },
        originalUnitPriceSet: { shopMoney: { amount: "85.00" } },
        totalDiscountSet: { shopMoney: { amount: "0.00" } },
        sellingPlan: { name: "Cada 30 días" },
      },
      {
        id: "gid://shopify/LineItem/3",
        title: "Tarjeta de regalo",
        quantity: 1,
        sku: "GIFT",
        variant: { sku: "GIFT", product: { handle: "tarjeta-regalo" } },
        originalUnitPriceSet: { shopMoney: { amount: "20.00" } },
        totalDiscountSet: null,
        sellingPlan: null,
      },
    ],
  },
};

const catalog = {
  bySku: new Map([["proc-01", 3]]),
  bySlug: new Map([
    ["procollagen", 3],
    ["nad-advanced", 4],
  ]),
};

describe("mapShopifyLines", () => {
  it("vincula por SKU, luego por handle, y deja sin vincular lo que no está en el catálogo", () => {
    const lines = mapShopifyLines(order, catalog);
    assert.deepEqual(
      lines.map((l) => [l.productId, l.description, l.quantity, l.unitPriceCents, l.discountCents, l.externalLineId]),
      [
        [3, "Procollagen", 2, 11000, 1050, "gid://shopify/LineItem/1"],
        [4, "NAD Advanced", 1, 8500, 0, "gid://shopify/LineItem/2"],
        [null, "Tarjeta de regalo", 1, 2000, 0, "gid://shopify/LineItem/3"],
      ],
    );
  });
});

describe("isSubscriptionOrder", () => {
  it("es suscripción si alguna línea trae plan de venta", () => {
    assert.equal(isSubscriptionOrder(order), true);
  });

  it("o si lo creó la app de suscripciones", () => {
    const plain = { ...order, lineItems: { nodes: order.lineItems.nodes.map((l) => ({ ...l, sellingPlan: null })) } };
    assert.equal(isSubscriptionOrder(plain), false);
    assert.equal(isSubscriptionOrder({ ...plain, sourceName: "subscription_contract" }), true);
  });
});

describe("datos del cliente", () => {
  it("arma el nombre y la dirección de envío", () => {
    assert.equal(customerName(order), "María Pérez");
    assert.equal(formatShopifyAddress(order.shippingAddress), "Calle 5 #12, Santo Domingo, Distrito Nacional, 10101, Dominican Republic · Tel. +18095551234");
    assert.equal(formatShopifyAddress(null), null);
  });

  it("lee los montos de Shopify en centavos", () => {
    assert.equal(moneyToCents({ shopMoney: { amount: "198.99" } }), 19899);
    assert.equal(moneyToCents(null), 0);
  });
});

describe("shopifyOrderNote", () => {
  it("junta la nota y los datos del carrito, sin los internos de las apps", () => {
    assert.equal(
      shopifyOrderNote({
        note: "  Dejar en recepción  ",
        customAttributes: [
          { key: "Mensaje de regalo", value: "Feliz cumpleaños" },
          { key: "_subscription_contract_id", value: "123" },
          { key: "Vacío", value: "  " },
        ],
      }),
      "Dejar en recepción\nMensaje de regalo: Feliz cumpleaños",
    );
  });

  it("sin nota ni datos del carrito no hay comentario", () => {
    assert.equal(shopifyOrderNote({ note: null, customAttributes: [] }), null);
    assert.equal(shopifyOrderNote({ note: "   " }), null);
    assert.equal(shopifyOrderNote({ customAttributes: [{ key: "_internal", value: "x" }] }), null);
  });
});

describe("throttleDelayMs", () => {
  it("con cupo de sobra no espera", () => {
    assert.equal(throttleDelayMs({ maximumAvailable: 2000, currentlyAvailable: 1500, restoreRate: 100 }), 0);
    assert.equal(throttleDelayMs(undefined), 0);
  });

  it("con menos de un cuarto, espera a recuperar la mitad", () => {
    // Faltan 1000 − 200 = 800 puntos a 100 por segundo: 8 s.
    assert.equal(throttleDelayMs({ maximumAvailable: 2000, currentlyAvailable: 200, restoreRate: 100 }), 8000);
  });
});

describe("normalizeShopDomain", () => {
  it("acepta el subdominio, el dominio o la URL del admin", () => {
    assert.equal(normalizeShopDomain("procollagen"), "procollagen.myshopify.com");
    assert.equal(normalizeShopDomain("https://Procollagen.myshopify.com/admin/orders"), "procollagen.myshopify.com");
    assert.equal(normalizeShopDomain("procollagenvitalessence.com"), null);
    assert.equal(normalizeShopDomain(""), null);
  });
});
