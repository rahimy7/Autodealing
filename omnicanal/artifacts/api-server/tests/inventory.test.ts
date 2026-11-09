import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sortLotsForPicking,
  planLotPicks,
  splitValue,
  lotUnitValue,
  reorderNeed,
  stockStatus,
  explodeLine,
} from "../src/lib/inventory";
import { rateToBaseFrom, toBaseCents, formatMoney } from "../src/lib/money";

const at = (iso: string) => new Date(iso);

describe("sortLotsForPicking (FEFO, luego PEPS)", () => {
  it("sale primero el que vence antes, y los que no vencen al final", () => {
    const lots = [
      { lotId: 1, quantity: 5, expiryDate: null, receivedAt: at("2026-01-01T00:00:00Z") },
      { lotId: 2, quantity: 5, expiryDate: "2027-06-01", receivedAt: at("2026-03-01T00:00:00Z") },
      { lotId: 3, quantity: 5, expiryDate: "2027-01-01", receivedAt: at("2026-05-01T00:00:00Z") },
    ];
    assert.deepEqual(sortLotsForPicking(lots).map((l) => l.lotId), [3, 2, 1]);
  });

  it("con el mismo vencimiento (o sin él) sale el que entró primero", () => {
    const lots = [
      { lotId: 7, quantity: 1, expiryDate: null, receivedAt: at("2026-02-01T00:00:00Z") },
      { lotId: 8, quantity: 1, expiryDate: null, receivedAt: at("2026-01-01T00:00:00Z") },
      { lotId: 9, quantity: 1, expiryDate: "2027-01-01", receivedAt: at("2026-03-01T00:00:00Z") },
      { lotId: 10, quantity: 1, expiryDate: "2027-01-01", receivedAt: at("2026-02-01T00:00:00Z") },
    ];
    assert.deepEqual(sortLotsForPicking(lots).map((l) => l.lotId), [10, 9, 8, 7]);
  });
});

describe("planLotPicks", () => {
  const lots = [
    { lotId: 1, quantity: 3, expiryDate: "2027-01-01", receivedAt: at("2026-01-01T00:00:00Z") },
    { lotId: 2, quantity: 10, expiryDate: "2028-01-01", receivedAt: at("2026-01-01T00:00:00Z") },
  ];

  it("toma del lote que vence antes y completa con el siguiente", () => {
    assert.deepEqual(planLotPicks(lots, 5), {
      picks: [
        { lotId: 1, quantity: 3 },
        { lotId: 2, quantity: 2 },
      ],
      shortage: 0,
    });
  });

  it("dice cuánto falta cuando no alcanza", () => {
    assert.equal(planLotPicks(lots, 15).shortage, 2);
  });

  it("ignora saldos vacíos", () => {
    assert.deepEqual(planLotPicks([{ ...lots[0], quantity: 0 }, lots[1]], 1).picks, [{ lotId: 2, quantity: 1 }]);
  });
});

describe("splitValue (PEPS sin descuadre)", () => {
  it("toma la parte proporcional", () => {
    assert.equal(splitValue({ quantity: 3, valueCents: 1000 }, 1), 333);
  });

  it("quien se lleva lo último se lleva todo el valor que queda", () => {
    // 1000 / 3 no es exacto: tras sacar 1 y 1, el último saca lo que queda,
    // y el lote termina en cero, no en un centavo huérfano.
    let balance = { quantity: 3, valueCents: 1000 };
    const taken: number[] = [];
    for (let i = 0; i < 3; i++) {
      const v = splitValue(balance, 1);
      taken.push(v);
      balance = { quantity: balance.quantity - 1, valueCents: balance.valueCents - v };
    }
    assert.equal(taken.reduce((a, b) => a + b, 0), 1000);
    assert.deepEqual(balance, { quantity: 0, valueCents: 0 });
  });

  it("no da valor por nada", () => {
    assert.equal(splitValue({ quantity: 0, valueCents: 500 }, 1), 0);
    assert.equal(splitValue({ quantity: 5, valueCents: 500 }, 0), 0);
  });
});

describe("lotUnitValue", () => {
  it("es el costo unitario de entrada del lote", () => {
    assert.equal(lotUnitValue({ initialQuantity: 10, totalCostCents: 25_000 }, 4), 10_000);
  });
});

describe("reorderNeed", () => {
  it("no pide mientras lo proyectado esté por encima del mínimo", () => {
    assert.deepEqual(reorderNeed({ available: 11, onOrder: 0, requested: 0, minQuantity: 10, targetQuantity: 40 }), { projected: 11, need: 0 });
  });

  it("pide hasta el objetivo contando lo que ya viene y lo ya pedido", () => {
    assert.deepEqual(reorderNeed({ available: 4, onOrder: 10, requested: 6, minQuantity: 20, targetQuantity: 40 }), { projected: 20, need: 20 });
  });

  it("lo vendido de más también cuenta (disponible negativo)", () => {
    assert.equal(reorderNeed({ available: -5, onOrder: 0, requested: 0, minQuantity: 0, targetQuantity: 10 }).need, 15);
  });
});

describe("stockStatus", () => {
  it("separa vendido de más, bajo el mínimo y bien", () => {
    assert.equal(stockStatus(-1, null), "negative");
    assert.equal(stockStatus(5, 5), "low");
    assert.equal(stockStatus(6, 5), "ok");
    assert.equal(stockStatus(0, null), "ok");
  });
});

describe("explodeLine (kits)", () => {
  const components = new Map([[100, [{ componentProductId: 1, quantity: 1 }, { componentProductId: 2, quantity: 2 }]]]);

  it("un kit sale como sus componentes por la cantidad vendida", () => {
    assert.deepEqual(explodeLine(100, 3, components), [
      { productId: 1, quantity: 3 },
      { productId: 2, quantity: 6 },
    ]);
  });

  it("un producto que no es kit sale tal cual", () => {
    assert.deepEqual(explodeLine(5, 2, components), [{ productId: 5, quantity: 2 }]);
  });
});

describe("money", () => {
  it("convierte a la base con la tasa del banco (pesos por moneda extranjera)", () => {
    // Base USD, documento en DOP: 1 DOP = 1/63.5 USD.
    assert.equal(rateToBaseFrom("DOP", { USD: 63.5 }, "USD")!.toFixed(6), (1 / 63.5).toFixed(6));
    // Base DOP, documento en USD: 1 USD = 63.5 DOP.
    assert.equal(rateToBaseFrom("USD", { USD: 63.5 }, "DOP"), 63.5);
    assert.equal(rateToBaseFrom("USD", {}, "USD"), 1);
    assert.equal(rateToBaseFrom("EUR", { USD: 63.5 }, "USD"), null);
  });

  it("lleva centavos a la base redondeando", () => {
    assert.equal(toBaseCents(635_000, 1 / 63.5), 10_000);
    assert.equal(toBaseCents(1234, null), 1234);
  });

  it("formatea con el símbolo de la moneda", () => {
    assert.equal(formatMoney(125_000, "USD"), "US$1,250.00");
    assert.equal(formatMoney(-500, "DOP"), "-RD$5.00");
  });
});
