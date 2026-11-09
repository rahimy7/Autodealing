import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeOrderEmail, emailLanguage, trackingUrlFor, orderLabelFor } from "../src/lib/order-notifications";

const base = {
  businessName: "Procollagen Vital Essence",
  orderLabel: "PED-000123",
  customerName: "María Pérez",
  items: [
    { description: "Procollagen", quantity: 2 },
    { description: "NAD Advanced", quantity: 1 },
  ],
};

describe("composeOrderEmail", () => {
  it("confirma el pago con lo que se compró", () => {
    const { subject, body } = composeOrderEmail("confirmed", base);
    assert.equal(subject, "Tu pedido PED-000123 está en preparación");
    assert.match(body, /^Hola, María:/);
    assert.match(body, /- Procollagen x2\n- NAD Advanced/);
  });

  it("al despachar por courier da el courier, la guía y el enlace", () => {
    const { subject, body } = composeOrderEmail("dispatched", {
      ...base,
      shipmentKind: "courier",
      carrierName: "UPS",
      trackingNumber: "1Z999",
      trackingUrl: "https://www.ups.com/track?tracknum=1Z999",
    });
    assert.equal(subject, "Tu pedido PED-000123 va en camino");
    assert.match(body, /salió con UPS\. Número de guía: 1Z999\./);
    assert.match(body, /https:\/\/www\.ups\.com\/track\?tracknum=1Z999/);
  });

  it("en un viaje propio no inventa guía ni plazo", () => {
    const { body } = composeOrderEmail("dispatched", { ...base, shipmentKind: "trip" });
    assert.match(body, /salió hoy en nuestra ruta de entrega\./);
    assert.doesNotMatch(body, /guía|hoy mismo|horas/);
  });

  it("no saluda con un nombre que no es nombre", () => {
    assert.match(composeOrderEmail("delivered", { ...base, customerName: "Cliente 8095551234" }).body, /^Hola:/);
    assert.match(composeOrderEmail("delivered", { ...base, customerName: "+1 809 555 1234" }).body, /^Hola:/);
  });

  it("cuenta la devolución y la nota de crédito", () => {
    const { body } = composeOrderEmail("refund", { ...base, returnCode: "DEV-000004", creditNote: { code: "NC-000009", amount: "US$100.00" } });
    assert.match(body, /Recibimos tu devolución DEV-000004 del pedido PED-000123\. Emitimos la nota de crédito NC-000009 por US\$100\.00 a tu favor\./);
  });

  it("escribe en inglés cuando el cliente usa inglés", () => {
    const { subject, body } = composeOrderEmail("delivered", base, "en");
    assert.equal(subject, "Your order PED-000123 was delivered");
    assert.match(body, /^Hi María,/);
  });
});

describe("emailLanguage", () => {
  it("solo cambia a inglés si el idioma del cliente lo dice", () => {
    assert.equal(emailLanguage("en-US"), "en");
    assert.equal(emailLanguage("es"), "es");
    assert.equal(emailLanguage(null), "es");
  });
});

describe("trackingUrlFor", () => {
  it("rellena la guía en la plantilla del courier", () => {
    assert.equal(trackingUrlFor("https://track.example/?n={tracking}", "AB 12"), "https://track.example/?n=AB%2012");
    assert.equal(trackingUrlFor(null, "AB12"), null);
    assert.equal(trackingUrlFor("https://track.example/?n={tracking}", "  "), null);
  });
});

describe("orderLabelFor", () => {
  it("usa el número de Shopify cuando el pedido vino de allí", () => {
    assert.equal(orderLabelFor({ id: 12, externalName: "#1045" }), "#1045 (PED-000012)");
    assert.equal(orderLabelFor({ id: 12, externalName: null }), "PED-000012");
  });
});
