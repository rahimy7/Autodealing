// La lista de suscriptores de Shopify (2026-10-06). Las funciones puras van sin
// base; el recorrido completo necesita una base local DESECHABLE (DATABASE_URL):
// simula a Shopify con un fetch falso —nunca sale a la red— y, como la lista se
// rehace entera, borra de shopify_subscribers a quien no esté en ese Shopify falso.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, like } from "drizzle-orm";
import { db, contactsTable, shopifySubscribersTable } from "@workspace/db";
import { lastSubscriptionOrder, subscriberFromShopify, syncSubscribersWith, type ShopifySubscriberNode } from "../src/lib/shopify-subscribers";
import { shopifyCustomerAdminUrl } from "../src/routes/subscriptions";

const plan = { name: "Entrega cada mes, 15 % de descuento" };

function customer(id: string, status: string, overrides: Partial<ShopifySubscriberNode> = {}): ShopifySubscriberNode {
  return {
    id,
    firstName: "Ana",
    lastName: "Gómez",
    defaultEmailAddress: { emailAddress: "Ana@Example.com" },
    defaultPhoneNumber: { phoneNumber: " +18095550001 " },
    numberOfOrders: "12",
    amountSpent: { amount: "1234.50", currencyCode: "USD" },
    createdAt: "2025-01-15T10:00:00Z",
    productSubscriberStatus: status,
    orders: {
      nodes: [
        // El más nuevo no es de suscripción: compra suelta.
        { name: "#4540", createdAt: "2026-10-05T12:00:00Z", sourceName: "web", lineItems: { nodes: [{ title: "Colágeno en polvo", quantity: 1, sellingPlan: null }] } },
        {
          name: "#4501",
          createdAt: "2026-09-20T12:00:00Z",
          sourceName: "subscription_contract",
          lineItems: {
            nodes: [
              { title: "Procollagen", quantity: 2, sellingPlan: plan },
              { title: "Muestra gratis", quantity: 1, sellingPlan: null },
            ],
          },
        },
      ],
    },
    ...overrides,
  };
}

describe("lastSubscriptionOrder", () => {
  it("toma el pedido de suscripción más nuevo y solo sus líneas con plan", () => {
    const order = lastSubscriptionOrder(customer("x", "ACTIVE").orders!.nodes);
    assert.deepEqual(order, { name: "#4501", at: new Date("2026-09-20T12:00:00Z"), products: "Procollagen x2", sellingPlan: plan.name });
  });

  it("si lo creó la app sin plan en las líneas, van todas", () => {
    const order = lastSubscriptionOrder([
      { name: "#10", createdAt: "2026-09-01T00:00:00Z", sourceName: "subscription_contract_checkout_one", lineItems: { nodes: [{ title: "NAD", quantity: 1, sellingPlan: null }] } },
    ]);
    assert.equal(order?.products, "NAD");
    assert.equal(order?.sellingPlan, null);
  });

  it("sin pedidos de suscripción no hay último pedido", () => {
    assert.equal(lastSubscriptionOrder([]), null);
    assert.equal(lastSubscriptionOrder([customer("x", "ACTIVE").orders!.nodes[0]]), null);
  });
});

describe("subscriberFromShopify", () => {
  it("lee el contador que llega como texto, el gasto en centavos y normaliza correo y teléfono", () => {
    const snap = subscriberFromShopify(customer("gid://shopify/Customer/1", "ACTIVE"));
    assert.equal(snap.name, "Ana Gómez");
    assert.equal(snap.email, "ana@example.com");
    assert.equal(snap.phone, "+18095550001");
    assert.equal(snap.ordersCount, 12);
    assert.equal(snap.amountSpentCents, 123450);
    assert.equal(snap.currency, "USD");
    assert.equal(snap.lastOrder?.name, "#4501");
  });

  it("sin nombre ni correo válido quedan en null", () => {
    const snap = subscriberFromShopify(customer("gid://shopify/Customer/2", "PAUSED", { firstName: null, lastName: " ", defaultEmailAddress: { emailAddress: "no-es-correo" }, numberOfOrders: null }));
    assert.equal(snap.name, null);
    assert.equal(snap.email, null);
    assert.equal(snap.ordersCount, 0);
  });
});

describe("shopifyCustomerAdminUrl", () => {
  it("arma el enlace al cliente en el admin de Shopify", () => {
    assert.equal(shopifyCustomerAdminUrl("0mb3y5-cu.myshopify.com", "gid://shopify/Customer/8123"), "https://admin.shopify.com/store/0mb3y5-cu/customers/8123");
  });

  it("sin tienda o con un id raro no hay enlace", () => {
    assert.equal(shopifyCustomerAdminUrl(null, "gid://shopify/Customer/8123"), null);
    assert.equal(shopifyCustomerAdminUrl("tienda.myshopify.com", "gid://shopify/Customer/abc"), null);
  });
});

// ── El recorrido completo, con un Shopify falso ──────────────────────────────

const GID = (n: number) => `gid://shopify/Customer/90000${n}`;
const creds = { shopDomain: "tienda-prueba.myshopify.com", accessToken: "shpat_prueba" };

type FakeShop = { statuses: Array<Array<{ id: string; productSubscriberStatus: string }>>; details: Record<string, ShopifySubscriberNode> };
let shop: FakeShop;
let detailRequests: string[][] = [];
const realFetch = globalThis.fetch;
let contactId: number;

before(async () => {
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body) as { query: string; variables: { after?: string | null; ids?: string[] } };
    if (query.includes("CustomerSubscriberStatus")) {
      const page = variables.after ? Number(variables.after) : 0;
      const nodes = shop.statuses[page];
      const hasNextPage = page + 1 < shop.statuses.length;
      return new Response(JSON.stringify({ data: { customers: { pageInfo: { hasNextPage, endCursor: hasNextPage ? String(page + 1) : null }, nodes } } }), { status: 200 });
    }
    if (query.includes("SubscriberDetails")) {
      detailRequests.push(variables.ids ?? []);
      return new Response(JSON.stringify({ data: { nodes: (variables.ids ?? []).map((id) => shop.details[id] ?? null) } }), { status: 200 });
    }
    return new Response(JSON.stringify({ errors: [{ message: "consulta inesperada" }] }), { status: 200 });
  }) as typeof fetch;

  await db.delete(shopifySubscribersTable).where(like(shopifySubscribersTable.shopifyCustomerId, "gid://shopify/Customer/90000%"));
  // Un contacto que ya existe con el correo de un suscriptor: se vincula, no se crea otro.
  const [contact] = await db.insert(contactsTable).values({ name: "Ana (chat)", email: "ana.suscriptora@example.com" }).returning();
  contactId = contact.id;
});

after(async () => {
  globalThis.fetch = realFetch;
  await db.delete(shopifySubscribersTable).where(like(shopifySubscribersTable.shopifyCustomerId, "gid://shopify/Customer/90000%"));
  await db.delete(contactsTable).where(eq(contactsTable.id, contactId));
});

async function rows() {
  const all = await db
    .select()
    .from(shopifySubscribersTable)
    .where(inArray(shopifySubscribersTable.shopifyCustomerId, [1, 2, 3, 4, 5].map(GID)));
  return new Map(all.map((r) => [r.shopifyCustomerId, r] as const));
}

describe("syncSubscribersWith", () => {
  it("recorre todas las páginas y guarda solo a quien es o fue suscriptor", async () => {
    shop = {
      statuses: [
        [
          { id: GID(1), productSubscriberStatus: "ACTIVE" },
          { id: GID(2), productSubscriberStatus: "NEVER_SUBSCRIBED" },
          { id: GID(3), productSubscriberStatus: "CANCELLED" },
        ],
        [
          { id: GID(4), productSubscriberStatus: "PAUSED" },
          { id: GID(5), productSubscriberStatus: "EXPIRED" },
        ],
      ],
      details: {
        [GID(1)]: customer(GID(1), "ACTIVE", { defaultEmailAddress: { emailAddress: "ana.suscriptora@example.com" } }),
        [GID(3)]: customer(GID(3), "CANCELLED", { firstName: "Luis", defaultEmailAddress: null, defaultPhoneNumber: null }),
        [GID(4)]: customer(GID(4), "PAUSED", { firstName: "Rosa", defaultEmailAddress: null, defaultPhoneNumber: null }),
        [GID(5)]: customer(GID(5), "EXPIRED", { firstName: "Pedro", defaultEmailAddress: null, defaultPhoneNumber: null }),
      },
    };
    detailRequests = [];
    const result = await syncSubscribersWith(creds, new Date("2026-10-06T12:00:00Z"));
    assert.equal(result.scanned, 5);
    assert.equal(result.subscribers, 4);
    assert.equal(result.changed, 0);

    const saved = await rows();
    assert.equal(saved.has(GID(2)), false, "quien nunca se suscribió no entra");
    assert.equal(saved.get(GID(1))?.status, "ACTIVE");
    assert.equal(saved.get(GID(1))?.contactId, contactId, "se vincula al contacto con el mismo correo");
    assert.equal(saved.get(GID(1))?.lastOrderName, "#4501");
    assert.equal(saved.get(GID(1))?.sellingPlan, plan.name);
    assert.equal(saved.get(GID(1))?.statusChangedAt, null, "recién conocido, no ha cambiado");
    assert.equal(saved.get(GID(3))?.contactId, null, "sin correo ni teléfono no se vincula ni se crea contacto");
    assert.equal(saved.get(GID(4))?.status, "PAUSED");
  });

  it("al releer: marca el cambio de estado, no repide a los cancelados quietos y saca a los borrados", async () => {
    shop.statuses = [
      [
        { id: GID(1), productSubscriberStatus: "CANCELLED" },
        { id: GID(2), productSubscriberStatus: "NEVER_SUBSCRIBED" },
      ],
      [
        { id: GID(4), productSubscriberStatus: "PAUSED" },
        { id: GID(5), productSubscriberStatus: "EXPIRED" },
      ],
    ];
    // Pasaron más de 60 días: Shopify ya no devuelve el pedido de Rosa.
    shop.details[GID(1)] = customer(GID(1), "CANCELLED", { defaultEmailAddress: { emailAddress: "ana.suscriptora@example.com" } });
    shop.details[GID(4)] = customer(GID(4), "PAUSED", { firstName: "Rosa", defaultEmailAddress: null, defaultPhoneNumber: null, orders: { nodes: [] } });
    detailRequests = [];
    const second = new Date("2026-10-06T18:00:00Z");
    const result = await syncSubscribersWith(creds, second);
    assert.equal(result.changed, 1);

    const saved = await rows();
    const ana = saved.get(GID(1));
    assert.equal(ana?.status, "CANCELLED");
    assert.equal(ana?.previousStatus, "ACTIVE");
    assert.equal(ana?.statusChangedAt?.toISOString(), second.toISOString());
    assert.equal(saved.has(GID(3)), false, "el cliente que ya no está en la tienda sale de la lista");
    assert.equal(saved.get(GID(4))?.lastOrderName, "#4501", "el último pedido conocido se queda aunque salga de la ventana de 60 días");

    const asked = detailRequests.flat();
    assert.equal(asked.includes(GID(5)), false, "un vencido que no cambió no se vuelve a pedir");
    assert.equal(asked.includes(GID(4)), true, "un pausado sigue vivo: se relee");
    assert.equal(saved.get(GID(5))?.checkedAt.toISOString(), second.toISOString(), "pero queda revisado");
  });
});
