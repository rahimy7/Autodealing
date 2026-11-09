// Etiquetas de USPS (2026-10-20): comprar, no pagar dos veces, anular, y que el
// ambiente de pruebas no toque la parada. Lo puro corre siempre; el recorrido con
// la base necesita una base local DESECHABLE (DATABASE_URL) y, sin ella, se salta.
// USPS se simula con fetch: aquí no sale nada a la red.
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
  shipmentsTable,
  shipmentOrdersTable,
  shipmentChargesTable,
  carriersTable,
  uspsLabelsTable,
  exchangeRatesTable,
} from "@workspace/db";
import { createShipment, serializeShipment } from "../src/lib/fulfillment";
import { SYSTEM_ACTOR } from "../src/lib/inventory";
import { defaultRateToBase } from "../src/lib/orders";
import {
  createUspsLabel,
  missingForLabels,
  normalizeLabelInput,
  refreshUspsTracking,
  uspsLabelDraft,
  uspsLabelPdf,
  uspsMailingDate,
  voidUspsLabel,
  type UspsLabelInput,
} from "../src/lib/usps-labels";
import { forgetUspsTokens } from "../src/lib/usps";

const log = { info: () => {}, warn: () => {}, error: () => {} };

const goodInput: UspsLabelInput = {
  to: { firstName: "Juan", lastName: "Pérez", streetAddress: "123 Main St", secondaryAddress: "Apt 4", city: "Miami", state: "fl", ZIPCode: "33101" },
  package: { mailClass: "USPS_GROUND_ADVANTAGE", weightOz: 12, lengthIn: 9, widthIn: 6, heightIn: 3 },
};

describe("normalizeLabelInput", () => {
  it("deja la dirección en el formato de USPS y pasa onzas a libras", () => {
    const n = normalizeLabelInput(goodInput);
    assert.equal(n.to.state, "FL");
    assert.equal(n.to.secondaryAddress, "Apt 4");
    assert.equal(n.weightLb, 0.75);
    assert.equal(n.mailClass, "USPS_GROUND_ADVANTAGE");
  });

  it("dice qué campo falla", () => {
    const bad = (patch: Partial<UspsLabelInput["to"]> | null, pkg: Partial<UspsLabelInput["package"]> = {}) =>
      () => normalizeLabelInput({ to: { ...goodInput.to, ...(patch ?? {}) }, package: { ...goodInput.package, ...pkg } });
    assert.throws(bad({ firstName: "", lastName: "" }), /nombre/);
    assert.throws(bad({ streetAddress: " " }), /calle/);
    assert.throws(bad({ city: "" }), /ciudad/);
    assert.throws(bad({ state: "Santiago" }), /sigla/);
    assert.throws(bad({ ZIPCode: "3310" }), /5 dígitos/);
    assert.throws(bad({ ZIPPlus4: "12" }), /4 dígitos/);
    assert.throws(bad(null, { weightOz: 0 }), /peso/);
    assert.throws(bad(null, { weightOz: 2000 }), /peso/);
    assert.throws(bad(null, { heightIn: -1 }), /alto/);
    assert.throws(bad(null, { mailClass: "FEDEX" }), /servicio/);
  });
});

describe("uspsMailingDate", () => {
  it("es la fecha de Nueva York, no la de UTC", () => {
    // 01:30 UTC del 21 todavía es 21:30 del 20 en Nueva York (EDT).
    assert.equal(uspsMailingDate(new Date("2026-10-21T01:30:00Z")), "2026-10-20");
    assert.equal(uspsMailingDate(new Date("2026-10-21T15:00:00Z")), "2026-10-21");
  });
});

describe("missingForLabels", () => {
  const full = {
    uspsClientId: "k",
    uspsClientSecret: "s",
    uspsCrid: "1",
    uspsMid: "2",
    uspsAccountNumber: "3",
    uspsFromName: "Procollagen",
    uspsFromStreet: "100 Warehouse Way",
    uspsFromCity: "Orlando",
    uspsFromState: "FL",
    uspsFromZip: "32801",
  } as Parameters<typeof missingForLabels>[0];

  it("vacío cuando está todo", () => assert.deepEqual(missingForLabels(full), []));

  it("lista lo que falta", () => {
    assert.deepEqual(missingForLabels(null), ["Consumer Key y Consumer Secret", "CRID", "MID", "número de cuenta EPS", "dirección del remitente"]);
    assert.deepEqual(missingForLabels({ ...full!, uspsFromZip: "3280" }), ["dirección del remitente"]);
    assert.deepEqual(missingForLabels({ ...full!, uspsCrid: " ", uspsAccountNumber: null }), ["CRID", "número de cuenta EPS"]);
  });
});

// ── Con la base ───────────────────────────────────────────────────────────────

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from([0xff, 0x00, 0x80]), Buffer.from("%%EOF")]);
// USPS da una guía distinta a cada etiqueta (y la base no admite dos iguales).
let trackingSeq = 0;
const nextTracking = () => `94001118992231974${String(++trackingSeq).padStart(5, "0")}`;
let dbAvailable = false;
let seeded: { warehouseId: number; contactId: number; orderIds: number[]; shipmentIds: number[]; rateId: number | null } | null = null;
let labelCalls = 0;
let cancelCalls = 0;
let labelResponder: () => Response;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function multipartLabel(trackingNumber = nextTracking()): Response {
  const b = "bnd";
  const meta = { trackingNumber, postage: 7.99, extraServices: [], fees: [], commitment: { name: "2 Days", scheduleDeliveryDate: "2026-10-23" } };
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Type: application/json\r\nContent-Disposition: form-data; name="labelMetadata"\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/pdf\r\nContent-Disposition: form-data; filename="labelImage.pdf"; name="labelImage"\r\n\r\n`),
    PDF,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return new Response(body, { status: 200, headers: { "content-type": `multipart/form-data; boundary=${b}` } });
}

async function setSettings(patch: Partial<typeof integrationSettingsTable.$inferInsert>) {
  const [row] = await db.select().from(integrationSettingsTable).limit(1);
  const values = {
    uspsEnabled: true,
    uspsEnvironment: "production",
    uspsClientId: "key",
    uspsClientSecret: "secret",
    uspsCrid: "1111111",
    uspsMid: "902222222",
    uspsAccountNumber: "1000000099",
    uspsFromName: "Procollagen Vital Essence",
    uspsFromStreet: "100 Warehouse Way",
    uspsFromCity: "Orlando",
    uspsFromState: "FL",
    uspsFromZip: "32801",
    ...patch,
  };
  if (row) await db.update(integrationSettingsTable).set(values).where(eq(integrationSettingsTable.id, row.id));
  else await db.insert(integrationSettingsTable).values(values);
}

/** Un pedido con su despacho de courier en armado: la parada lista para comprar etiqueta. */
async function newStop(opts: { carrierId?: number | null } = {}) {
  const [order] = await db
    .insert(ordersTable)
    .values({ contactId: seeded!.contactId, status: "processing", product: "Procollagen", quantity: 1, address: "Juan Pérez, 123 Main St Apt 4, Miami, FL 33101", warehouseId: seeded!.warehouseId })
    .returning();
  const shipment = await createShipment({ kind: "courier", warehouseId: seeded!.warehouseId, carrierId: opts.carrierId ?? null, orderIds: [order.id] }, SYSTEM_ACTOR, { quiet: true });
  seeded!.orderIds.push(order.id);
  seeded!.shipmentIds.push(shipment.id);
  return { order, shipment };
}

before(async () => {
  try {
    await db.execute(sql`select 1`);
    dbAvailable = true;
  } catch {
    return;
  }
  const [warehouse] = await db.insert(warehousesTable).values({ code: `T${Date.now() % 100000}`, name: "Almacén de prueba USPS" }).returning();
  const [contact] = await db.insert(contactsTable).values({ name: "Juan Pérez" }).returning();
  const [rate] = await db.insert(exchangeRatesTable).values({ currency: "USD", buy: 58, sell: 60, source: "test" }).returning();
  seeded = { warehouseId: warehouse.id, contactId: contact.id, orderIds: [], shipmentIds: [], rateId: rate.id };
});

beforeEach(async () => {
  if (!dbAvailable) return;
  forgetUspsTokens();
  labelCalls = 0;
  cancelCalls = 0;
  labelResponder = () => multipartLabel();
  await setSettings({});
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/oauth2/v3/token")) return json({ access_token: "oauth", expires_in: 28800 });
    if (url.endsWith("/payments/v3/payment-authorization")) return json({ paymentAuthorizationToken: "pay" });
    if (url.endsWith("/labels/v3/label") && init?.method === "POST") {
      labelCalls++;
      return labelResponder();
    }
    if (url.includes("/labels/v3/label/") && init?.method === "DELETE") {
      cancelCalls++;
      return json({ message: "Refund requested" });
    }
    if (url.includes("/tracking/v3/tracking/")) return json({ status: "In Transit", statusCategory: "In Transit", statusSummary: "On its way." });
    throw new Error(`USPS no simulado: ${init?.method ?? "GET"} ${url}`);
  });
});

afterEach(() => mock.restoreAll());

after(async () => {
  if (!dbAvailable || !seeded) return;
  await db.delete(uspsLabelsTable).where(inArray(uspsLabelsTable.orderId, seeded.orderIds));
  if (seeded.shipmentIds.length) {
    await db.delete(shipmentChargesTable).where(inArray(shipmentChargesTable.shipmentId, seeded.shipmentIds));
    await db.delete(shipmentOrdersTable).where(inArray(shipmentOrdersTable.shipmentId, seeded.shipmentIds));
    await db.delete(shipmentsTable).where(inArray(shipmentsTable.id, seeded.shipmentIds));
  }
  if (seeded.orderIds.length) {
    await db.delete(orderEventsTable).where(inArray(orderEventsTable.orderId, seeded.orderIds));
    await db.delete(ordersTable).where(inArray(ordersTable.id, seeded.orderIds));
  }
  await db.delete(contactsTable).where(eq(contactsTable.id, seeded.contactId));
  await db.delete(warehousesTable).where(eq(warehousesTable.id, seeded.warehouseId));
  if (seeded.rateId) await db.delete(exchangeRatesTable).where(eq(exchangeRatesTable.id, seeded.rateId));
  await db.delete(carriersTable).where(eq(carriersTable.name, "USPS"));
  await db.delete(integrationSettingsTable);
});

const chargesOf = (shipmentId: number) => db.select().from(shipmentChargesTable).where(eq(shipmentChargesTable.shipmentId, shipmentId));
const stopOf = async (shipmentId: number) => (await db.select().from(shipmentOrdersTable).where(eq(shipmentOrdersTable.shipmentId, shipmentId)))[0];
const eventsOf = async (orderId: number) => (await db.select().from(orderEventsTable).where(eq(orderEventsTable.orderId, orderId))).map((e) => e.detail);

describe("comprar la etiqueta (producción)", () => {
  it("guarda la guía en la parada, pone a USPS de courier y anota el franqueo como costo del envío", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const { order, shipment } = await newStop();
    const { label, warnings } = await createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log);

    assert.deepEqual(warnings, []);
    assert.equal(label.status, "active");
    const tracking = label.trackingNumber!;
    assert.match(tracking, /^94001118992231974\d{5}$/);
    assert.equal(label.postageCents, 799);
    assert.equal(label.environment, "production");
    assert.equal(label.hasPdf, true);
    assert.equal(label.weightOz, 12);

    const stop = await stopOf(shipment.id);
    assert.equal(stop.trackingNumber, tracking);
    const [carrier] = await db.select().from(carriersTable).where(eq(carriersTable.name, "USPS"));
    assert.ok(carrier.trackingUrlTemplate?.includes("{tracking}"));
    const [refreshed] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, shipment.id));
    assert.equal(refreshed.carrierId, carrier.id);

    const charges = await chargesOf(shipment.id);
    assert.equal(charges.length, 1);
    assert.equal(charges[0].concept, "Courier");
    assert.equal(charges[0].amountCents, 799);
    assert.equal(charges[0].currency, "USD");
    assert.equal(charges[0].orderId, order.id);
    assert.equal(charges[0].rateToBase, await defaultRateToBase("USD"));
    const [row] = await db.select().from(uspsLabelsTable).where(eq(uspsLabelsTable.id, label.id));
    assert.equal(row.chargeId, charges[0].id);

    assert.ok((await eventsOf(order.id)).some((d) => d.includes(tracking) && d.includes("US$7.99")));
    const view = await serializeShipment(refreshed);
    assert.equal(view.stops[0].uspsLabel?.trackingNumber, tracking);
    assert.equal(view.stops[0].trackingUrl, `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`);
  });

  it("el PDF queda en la base, intacto, para reimprimirlo", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const { order, shipment } = await newStop();
    const { label } = await createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log);
    const { pdf, filename } = await uspsLabelPdf(label.id);
    assert.ok(pdf.equals(PDF));
    assert.ok(filename.endsWith(`usps-${label.trackingNumber}.pdf`), filename);
  });

  it("no se paga dos veces: la segunda etiqueta de la parada se rechaza sin llamar a USPS", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const { order, shipment } = await newStop();
    await createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log);
    assert.equal(labelCalls, 1);
    await assert.rejects(createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log), /ya tiene una etiqueta/);
    assert.equal(labelCalls, 1);
  });

  it("dos clics a la vez compran una sola", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const { order, shipment } = await newStop();
    const results = await Promise.allSettled([
      createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log),
      createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(labelCalls, 1);
  });

  it("si USPS rechaza la compra, la parada queda libre para reintentar", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const { order, shipment } = await newStop();
    labelResponder = () => json({ error: { message: "Invalid", errors: [{ detail: "toAddress.ZIPCode is invalid" }] } }, 400);
    await assert.rejects(createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log), /ZIPCode is invalid/);
    assert.equal((await db.select().from(uspsLabelsTable).where(eq(uspsLabelsTable.orderId, order.id))).length, 0);
    assert.equal((await stopOf(shipment.id)).trackingNumber, null);
    assert.equal((await chargesOf(shipment.id)).length, 0);

    labelResponder = () => multipartLabel();
    const { label } = await createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log);
    assert.equal(label.status, "active");
  });

  it("sin respuesta de USPS avisa que revise la cuenta antes de reintentar", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const { order, shipment } = await newStop();
    labelResponder = () => {
      throw new TypeError("fetch failed");
    };
    await assert.rejects(createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log), /revisa en tu cuenta de USPS/);
    assert.equal((await db.select().from(uspsLabelsTable).where(eq(uspsLabelsTable.orderId, order.id))).length, 0);
  });

  it("solo en un despacho que no ha salido, con courier y con USPS", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const sent = await newStop();
    await db.update(shipmentsTable).set({ status: "dispatched" }).where(eq(shipmentsTable.id, sent.shipment.id));
    await assert.rejects(createUspsLabel(sent.shipment.id, sent.order.id, goodInput, SYSTEM_ACTOR, log), /antes de registrar el despacho/);

    const [other] = await db.insert(carriersTable).values({ name: "Vimenpaq", kind: "courier" }).returning();
    const wrongCarrier = await newStop({ carrierId: other.id });
    await assert.rejects(createUspsLabel(wrongCarrier.shipment.id, wrongCarrier.order.id, goodInput, SYSTEM_ACTOR, log), /otro courier \(Vimenpaq\)/);
    await db.update(shipmentsTable).set({ carrierId: null }).where(eq(shipmentsTable.id, wrongCarrier.shipment.id));
    await db.delete(carriersTable).where(eq(carriersTable.id, other.id));
    assert.equal(labelCalls, 0);
  });

  it("con la integración apagada o incompleta no compra nada", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const { order, shipment } = await newStop();
    await setSettings({ uspsEnabled: false });
    await assert.rejects(createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log), /apagada/);
    await setSettings({ uspsEnabled: true, uspsAccountNumber: null, uspsFromZip: null });
    await assert.rejects(createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log), /número de cuenta EPS, dirección del remitente/);
    assert.equal(labelCalls, 0);
  });
});

describe("anular la etiqueta", () => {
  it("USPS la anula; aquí se quitan la guía y el cargo, y se puede comprar otra", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const { order, shipment } = await newStop();
    const { label } = await createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log);
    assert.equal((await chargesOf(shipment.id)).length, 1);

    const voided = await voidUspsLabel(label.id, SYSTEM_ACTOR, log);
    assert.equal(cancelCalls, 1);
    assert.equal(voided.status, "voided");
    assert.equal(voided.voidNote, "Refund requested");
    assert.equal((await stopOf(shipment.id)).trackingNumber, null);
    assert.equal((await chargesOf(shipment.id)).length, 0);
    assert.ok((await eventsOf(order.id)).some((d) => d.includes("anulada") && d.includes(label.trackingNumber!)));
    const [refreshed] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, shipment.id));
    assert.equal((await serializeShipment(refreshed)).stops[0].uspsLabel, null);

    await assert.rejects(voidUspsLabel(label.id, SYSTEM_ACTOR, log), /vigente/);

    // La parada quedó libre: la etiqueta nueva trae su propia guía.
    const again = await createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log);
    assert.notEqual(again.label.trackingNumber, label.trackingNumber);
    assert.equal((await stopOf(shipment.id)).trackingNumber, again.label.trackingNumber);
    assert.equal((await chargesOf(shipment.id)).length, 1);
    assert.equal((await db.select().from(uspsLabelsTable).where(eq(uspsLabelsTable.orderId, order.id))).length, 2, "la anulada queda de historial");
  });

  it("si USPS no la anula, sigue vigente con su guía y su cargo", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const { order, shipment } = await newStop();
    const { label } = await createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log);
    mock.restoreAll();
    mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/oauth2/v3/token")) return json({ access_token: "oauth" });
      if (init?.method === "DELETE") return json({ error: { message: "Label already scanned" } }, 400);
      throw new Error(url);
    });
    await assert.rejects(voidUspsLabel(label.id, SYSTEM_ACTOR, log), /already scanned/);
    const [row] = await db.select().from(uspsLabelsTable).where(eq(uspsLabelsTable.id, label.id));
    assert.equal(row.status, "active");
    assert.equal((await stopOf(shipment.id)).trackingNumber, label.trackingNumber);
    assert.equal((await chargesOf(shipment.id)).length, 1);
  });
});

describe("rastreo", () => {
  it("guarda el último estado de la guía sin tocar el pedido", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    const { order, shipment } = await newStop();
    const { label } = await createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log);
    const tracked = await refreshUspsTracking(label.id);
    assert.equal(tracked.trackingStatus, "In Transit");
    assert.equal(tracked.trackingSummary, "On its way.");
    assert.ok(tracked.trackingCheckedAt);
    const [o] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    assert.equal(o.status, "processing");
  });
});

describe("ambiente de pruebas", () => {
  it("guarda la etiqueta pero no toca la guía, el courier ni los cargos de la parada", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    await setSettings({ uspsEnvironment: "test" });
    const { order, shipment } = await newStop();
    const { label, warnings } = await createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log);
    assert.equal(label.environment, "test");
    assert.equal(label.status, "active");
    assert.deepEqual(warnings, []);
    assert.equal((await stopOf(shipment.id)).trackingNumber, null, "una guía de prueba no puede llegar al correo del cliente");
    assert.equal((await chargesOf(shipment.id)).length, 0);
    const [refreshed] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, shipment.id));
    assert.equal(refreshed.carrierId, null);
    assert.ok((await eventsOf(order.id)).some((d) => d.includes("PRUEBA")));
    assert.ok((await uspsLabelPdf(label.id)).pdf.equals(PDF));
  });

  it("anula en el ambiente donde se compró aunque ahora esté configurado el otro", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    await setSettings({ uspsEnvironment: "test" });
    const { order, shipment } = await newStop();
    const { label } = await createUspsLabel(shipment.id, order.id, goodInput, SYSTEM_ACTOR, log);
    await setSettings({ uspsEnvironment: "production" });
    forgetUspsTokens();
    const urls: string[] = [];
    mock.restoreAll();
    mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(String(input));
      return String(input).endsWith("/oauth2/v3/token") ? json({ access_token: "t" }) : json({ message: "ok" });
    });
    await voidUspsLabel(label.id, SYSTEM_ACTOR, log);
    assert.ok(urls.every((u) => u.startsWith("https://apis-tem.usps.com")), urls.join(", "));
  });
});

describe("borrador de la parada", () => {
  it("lee la dirección del pedido, trae el nombre del contacto y el paquete de siempre", async (t) => {
    if (!dbAvailable) return t.skip("sin base de datos local");
    await setSettings({ uspsDefaultWeightOz: 12, uspsDefaultLengthIn: 9, uspsDefaultWidthIn: 6, uspsDefaultHeightIn: 3, uspsDefaultMailClass: "PRIORITY_MAIL" });
    const { order, shipment } = await newStop();
    const draft = await uspsLabelDraft(shipment.id, order.id);
    assert.equal(draft.enabled, true);
    assert.deepEqual(draft.missing, []);
    assert.deepEqual(draft.to, { firstName: "Juan", lastName: "Pérez", streetAddress: "123 Main St", secondaryAddress: "Apt 4", city: "Miami", state: "FL", ZIPCode: "33101", ZIPPlus4: null });
    assert.deepEqual(draft.package, { mailClass: "PRIORITY_MAIL", weightOz: 12, lengthIn: 9, widthIn: 6, heightIn: 3 });
    assert.equal(draft.label, null);
    await assert.rejects(uspsLabelDraft(shipment.id, 0), /no está en el despacho/);
  });
});
