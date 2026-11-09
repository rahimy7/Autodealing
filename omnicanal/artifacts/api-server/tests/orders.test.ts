import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Order } from "@workspace/db";
import { isActiveOrderStatus, orderCode, pickActiveOrder } from "../src/lib/orders";

function mkOrder(overrides: Partial<Order> & Pick<Order, "id">): Order {
  return {
    contactId: 1,
    conversationId: 10,
    status: "pending",
    product: "Procollagen",
    quantity: 1,
    amount: null,
    currency: null,
    address: null,
    email: null,
    paymentProofMessageId: null,
    paymentProofPath: null,
    shippingLabelPath: null,
    notes: null,
    createdByAgentId: null,
    source: "chat",
    warehouseId: null,
    priceCurrency: null,
    rateToBase: null,
    subtotalCents: 0,
    discountCents: 0,
    discountReason: null,
    shippingChargeCents: 0,
    totalCents: 0,
    shippingCostCents: 0,
    emailThreadId: null,
    externalId: null,
    externalName: null,
    isSubscription: false,
    externalFinancialStatus: null,
    externalNote: null,
    externalTracking: null,
    customerLocale: null,
    replacesOrderId: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

describe("orderCode", () => {
  it("pads the id into a display code the team can read out loud", () => {
    assert.equal(orderCode(1), "PED-000001");
    assert.equal(orderCode(123), "PED-000123");
    assert.equal(orderCode(1_000_000), "PED-1000000");
  });
});

describe("isActiveOrderStatus", () => {
  it("is active for everything except the two ways an order ends", () => {
    assert.equal(isActiveOrderStatus("pending"), true);
    assert.equal(isActiveOrderStatus("processing"), true);
    assert.equal(isActiveOrderStatus("shipped"), true);
    assert.equal(isActiveOrderStatus("delivered"), false);
    assert.equal(isActiveOrderStatus("cancelled"), false);
  });
});

describe("pickActiveOrder", () => {
  it("returns null when there is nothing unfinished", () => {
    assert.equal(pickActiveOrder([]), null);
    assert.equal(pickActiveOrder([mkOrder({ id: 1, status: "delivered" }), mkOrder({ id: 2, status: "cancelled" })]), null);
  });

  it("picks the most recent order that hasn't finished, ignoring older or terminal ones", () => {
    const older = mkOrder({ id: 1, status: "pending", createdAt: new Date("2026-09-01T00:00:00Z") });
    const newer = mkOrder({ id: 2, status: "processing", createdAt: new Date("2026-09-05T00:00:00Z") });
    const cancelledLater = mkOrder({ id: 3, status: "cancelled", createdAt: new Date("2026-09-10T00:00:00Z") });
    const picked = pickActiveOrder([older, newer, cancelledLater]);
    assert.equal(picked?.id, 2);
  });
});
