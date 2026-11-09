import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { purchaseOrderStatusAfterReceipt, reorderReason, purchaseOrderEmail } from "../src/lib/purchasing";
import { creditNoteBalance, restockValue, unitRefundValue } from "../src/lib/returns";

describe("purchaseOrderStatusAfterReceipt", () => {
  it("queda recibida cuando llegó todo, en parte cuando llegó algo", () => {
    assert.equal(purchaseOrderStatusAfterReceipt([{ quantity: 10, receivedQuantity: 10 }, { quantity: 5, receivedQuantity: 5 }], "sent"), "received");
    assert.equal(purchaseOrderStatusAfterReceipt([{ quantity: 10, receivedQuantity: 4 }, { quantity: 5, receivedQuantity: 0 }], "sent"), "partial");
    assert.equal(purchaseOrderStatusAfterReceipt([{ quantity: 10, receivedQuantity: 0 }], "sent"), "sent");
  });
});

describe("reorderReason", () => {
  it("dice por qué se pide", () => {
    assert.equal(reorderReason({ available: 4, onOrder: 10, requested: 0, minQuantity: 20, targetQuantity: 40 }), "Disponible 4 · viene 10 · mínimo 20 · objetivo 40");
  });
});

describe("purchaseOrderEmail", () => {
  it("lleva las líneas, el total y a dónde entregar", () => {
    const { subject, body } = purchaseOrderEmail(
      {
        id: 1,
        code: "OC-000001",
        supplierId: 1,
        supplierName: "Laboratorio Caribe",
        supplierEmail: "ventas@lab.example",
        warehouseId: 1,
        warehouseName: "Almacén principal",
        status: "draft",
        currency: "DOP",
        rateToBase: null,
        orderDate: "2026-10-04",
        expectedDate: "2026-10-20",
        supplierReference: null,
        notes: null,
        sentAt: null,
        totalCents: 380_000,
        items: [{ id: 1, productId: 3, productName: "Procollagen", sku: "PROC-01", quantity: 2, unitCostCents: 190_000, totalCents: 380_000, receivedQuantity: 0, pendingQuantity: 2 }],
        receipts: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      "Procollagen Vital Essence",
    );
    assert.equal(subject, "Orden de compra OC-000001 — Procollagen Vital Essence");
    assert.match(body, /- Procollagen \(PROC-01\): 2 x RD\$1,900\.00 = RD\$3,800\.00/);
    assert.match(body, /Entregar en: Almacén principal · fecha esperada 2026-10-20/);
    assert.match(body, /Total: RD\$3,800\.00/);
  });
});

describe("creditNoteBalance", () => {
  it("es el monto menos lo aplicado y lo reembolsado; anulada no deja saldo", () => {
    assert.equal(creditNoteBalance({ amountCents: 10_000, refundedCents: 2_000, status: "issued" }, 3_000), 5_000);
    assert.equal(creditNoteBalance({ amountCents: 10_000, refundedCents: 0, status: "void" }, 0), 0);
    assert.equal(creditNoteBalance({ amountCents: 1_000, refundedCents: 600, status: "issued" }, 600), 0);
  });
});

describe("restockValue", () => {
  it("lo devuelto vuelve al costo unitario con que salió", () => {
    assert.equal(restockValue({ quantity: -5, valueCents: -16_000 }, 2), 6_400);
    assert.equal(restockValue({ quantity: 0, valueCents: 0 }, 1), 0);
  });
});

describe("unitRefundValue", () => {
  it("una unidad vale su parte del total de la línea; en un kit, su parte del kit", () => {
    assert.equal(unitRefundValue({ totalCents: 19_000, quantity: 2 }, 1), 9_500);
    assert.equal(unitRefundValue({ totalCents: 19_800, quantity: 1 }, 1 / 3), 6_600);
  });
});
