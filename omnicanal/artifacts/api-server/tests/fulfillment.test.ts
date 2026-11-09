import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocateShipmentCost, isShipmentComplete } from "../src/lib/fulfillment";
import { computeOrderTotals, orderTransition, summarizeItems } from "../src/lib/orders";

describe("allocateShipmentCost", () => {
  it("reparte en partes iguales y da los centavos sobrantes a los de id más bajo", () => {
    const out = allocateShipmentCost([{ orderId: null, amountCents: 1000, rateToBase: 1 }], [30, 10, 20]);
    assert.deepEqual([...out.entries()], [
      [10, 334],
      [20, 333],
      [30, 333],
    ]);
    assert.equal([...out.values()].reduce((a, b) => a + b, 0), 1000);
  });

  it("un cargo de un paquete va entero a ese pedido", () => {
    const out = allocateShipmentCost(
      [
        { orderId: 20, amountCents: 500, rateToBase: 1 },
        { orderId: null, amountCents: 200, rateToBase: 1 },
      ],
      [10, 20],
    );
    assert.deepEqual(Object.fromEntries(out), { 10: 100, 20: 600 });
  });

  it("lleva cada cargo a la moneda base antes de repartir", () => {
    // 6350 DOP con la base en USD a 63.5 → 100 USD.
    const out = allocateShipmentCost([{ orderId: null, amountCents: 635_000, rateToBase: 1 / 63.5 }], [1, 2]);
    assert.deepEqual(Object.fromEntries(out), { 1: 5000, 2: 5000 });
  });

  it("sin pedidos no reparte nada", () => {
    assert.equal(allocateShipmentCost([{ orderId: null, amountCents: 100, rateToBase: 1 }], []).size, 0);
  });
});

describe("isShipmentComplete", () => {
  it("termina cuando ninguna parada sigue pendiente", () => {
    assert.equal(isShipmentComplete([{ deliveryStatus: "delivered" }, { deliveryStatus: "failed" }]), true);
    assert.equal(isShipmentComplete([{ deliveryStatus: "delivered" }, { deliveryStatus: "pending" }]), false);
    assert.equal(isShipmentComplete([]), false);
  });
});

describe("orderTransition", () => {
  it("pasar a Enviado despacha (descuenta inventario)", () => {
    assert.deepEqual(orderTransition("processing", "shipped", { stockOut: false }), { ok: true, effect: "dispatch" });
    assert.deepEqual(orderTransition("pending", "delivered", { stockOut: false }), { ok: true, effect: "dispatch_then_deliver" });
  });

  it("lo que ya salió del almacén no se cancela ni vuelve atrás desde el estado", () => {
    for (const to of ["cancelled", "pending", "processing"] as const) {
      assert.equal(orderTransition("shipped", to, { stockOut: true }).ok, false);
    }
    assert.deepEqual(orderTransition("shipped", "delivered", { stockOut: true }), { ok: true, effect: "none" });
  });

  it("lo que no ha sacado nada se mueve libre, como antes del inventario", () => {
    assert.deepEqual(orderTransition("pending", "cancelled", { stockOut: false }), { ok: true, effect: "none" });
    assert.deepEqual(orderTransition("cancelled", "pending", { stockOut: false }), { ok: true, effect: "none" });
    // Un pedido Enviado de antes del inventario no sacó nada: puede volver.
    assert.deepEqual(orderTransition("shipped", "processing", { stockOut: false }), { ok: true, effect: "none" });
  });
});

describe("computeOrderTotals", () => {
  it("suma líneas con su descuento, resta el del pedido y suma el envío", () => {
    const t = computeOrderTotals(
      [
        { quantity: 2, unitPriceCents: 10_000, discountCents: 1_000 },
        { quantity: 1, unitPriceCents: 7_800, discountCents: 0 },
      ],
      2_000,
      500,
    );
    assert.deepEqual(t, { lineTotals: [19_000, 7_800], subtotalCents: 26_800, discountCents: 2_000, totalCents: 25_300 });
  });

  it("ningún descuento deja un total negativo", () => {
    const t = computeOrderTotals([{ quantity: 1, unitPriceCents: 1_000, discountCents: 5_000 }], 9_999, 0);
    assert.equal(t.lineTotals[0], 0);
    assert.equal(t.discountCents, 0);
    assert.equal(t.totalCents, 0);
  });
});

describe("summarizeItems", () => {
  it("arma el resumen que leen el aviso, el badge y el app", () => {
    assert.deepEqual(
      summarizeItems([
        { description: "Procollagen", quantity: 2 },
        { description: "NAD Advanced", quantity: 1 },
      ]),
      { product: "Procollagen x2, NAD Advanced", quantity: 3 },
    );
    assert.deepEqual(summarizeItems([]), { product: null, quantity: 1 });
  });
});
