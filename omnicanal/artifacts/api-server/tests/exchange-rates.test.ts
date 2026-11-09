import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.APP_TIMEZONE = "America/Santo_Domingo";
// exchange-rates pulls in @workspace/db, which refuses to load without a
// connection string. Nothing here touches the pool — only the pure rules.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test";

const { parsePopularRates, readPopularConfig } = await import("../src/lib/popular-api.js");
const { shouldRefreshRates, isRateFromToday, exchangeRatePromptBlock, replacePesosDirectives } = await import(
  "../src/lib/exchange-rates.js"
);
const { buildSystemPrompt } = await import("../src/lib/openai-client.js");

const rate = (currency: string, sell: number, createdAt = new Date("2026-09-14T11:00:00Z")) => ({
  id: 1,
  currency,
  buy: sell - 1.8,
  sell,
  source: "popular",
  fetchedBy: null,
  createdAt,
});

describe("popular-api — parsePopularRates", () => {
  it("reads the layout the bank actually returns", () => {
    const body = {
      monedas: {
        moneda: [
          { descripcion: "USD", compra: 58.55, venta: 60.35 },
          { descripcion: "EUR", compra: 62.3, venta: 65.9 },
        ],
        fechaConsulta: "2026-9-14 - 4:19:14",
      },
    };
    assert.deepEqual(parsePopularRates(body), [
      { currency: "USD", buy: 58.55, sell: 60.35 },
      { currency: "EUR", buy: 62.3, sell: 65.9 },
    ]);
  });

  it("accepts a single currency sent as an object instead of a list", () => {
    const body = { monedas: { moneda: { descripcion: "USD", compra: 58, venta: 60 } } };
    assert.deepEqual(parsePopularRates(body), [{ currency: "USD", buy: 58, sell: 60 }]);
  });

  it("accepts amounts as text and currency names instead of codes", () => {
    const body = { tasa: [{ moneda: "Dólar estadounidense", tasaCompra: "58.10", tasaVenta: "1,060.50" }] };
    assert.deepEqual(parsePopularRates(body), [{ currency: "USD", buy: 58.1, sell: 1060.5 }]);
  });

  it("uses the one rate it has for both sides rather than dropping the currency", () => {
    assert.deepEqual(parsePopularRates([{ codigoMoneda: "EUR", venta: 65 }]), [{ currency: "EUR", buy: 65, sell: 65 }]);
    assert.deepEqual(parsePopularRates({ descripcion: "USD", tasa: 59 }), [{ currency: "USD", buy: 59, sell: 59 }]);
  });

  it("ignores unknown currencies and rates that are missing or not positive", () => {
    const body = {
      monedas: {
        moneda: [
          { descripcion: "CAD", compra: 40, venta: 42 },
          { descripcion: "USD", compra: 0, venta: null },
          { descripcion: "EUR", compra: "n/a" },
        ],
      },
    };
    assert.deepEqual(parsePopularRates(body), []);
    assert.deepEqual(parsePopularRates(null), []);
  });
});

describe("popular-api — readPopularConfig", () => {
  const complete = {
    PopularApi__ClientId: "id",
    PopularApi__ClientSecret: "secret",
    PopularApi__TokenUrl: "https://bank.example/token",
    PopularApi__BaseUrl: "https://bank.example/api",
  };

  it("fills in the query path and scope when they are not set", () => {
    assert.deepEqual(readPopularConfig(complete), {
      clientId: "id",
      clientSecret: "secret",
      tokenUrl: "https://bank.example/token",
      baseUrl: "https://bank.example/api",
      consultaTasaPath: "/consultatasa/consultaTasa",
      scope: "scope_1",
    });
  });

  it("is not configured while a required variable is missing or blank", () => {
    assert.equal(readPopularConfig({}), null);
    assert.equal(readPopularConfig({ ...complete, PopularApi__ClientSecret: "  " }), null);
    assert.equal(readPopularConfig({ ...complete, PopularApi__BaseUrl: undefined }), null);
  });
});

describe("exchange-rates — shouldRefreshRates", () => {
  // Santo Domingo is UTC-4 all year: 07:00 local is 11:00 UTC.
  const at = (iso: string) => new Date(iso);

  it("fetches right away when no rate was ever stored", () => {
    assert.equal(shouldRefreshRates({ now: at("2026-09-14T08:00:00Z"), lastFetchedAt: null, lastFailureAt: null }), true);
  });

  it("waits for 07:00 business time before replacing yesterday's rate", () => {
    const lastFetchedAt = at("2026-09-13T11:00:00Z");
    assert.equal(shouldRefreshRates({ now: at("2026-09-14T10:59:00Z"), lastFetchedAt, lastFailureAt: null }), false);
    assert.equal(shouldRefreshRates({ now: at("2026-09-14T11:00:00Z"), lastFetchedAt, lastFailureAt: null }), true);
  });

  it("fetches only once a day", () => {
    const lastFetchedAt = at("2026-09-14T11:01:00Z");
    assert.equal(shouldRefreshRates({ now: at("2026-09-14T23:00:00Z"), lastFetchedAt, lastFailureAt: null }), false);
    // 01:00 UTC on the 15th is still the evening of the 14th in Santo Domingo.
    assert.equal(shouldRefreshRates({ now: at("2026-09-15T01:00:00Z"), lastFetchedAt, lastFailureAt: null }), false);
  });

  it("still fetches the day's rate after a manual refresh made before 07:00", () => {
    const lastFetchedAt = at("2026-09-14T10:30:00Z");
    assert.equal(shouldRefreshRates({ now: at("2026-09-14T11:05:00Z"), lastFetchedAt, lastFailureAt: null }), true);
  });

  it("backs off for an hour after a failed attempt", () => {
    const lastFetchedAt = at("2026-09-13T11:00:00Z");
    const lastFailureAt = at("2026-09-14T11:00:00Z");
    assert.equal(shouldRefreshRates({ now: at("2026-09-14T11:30:00Z"), lastFetchedAt, lastFailureAt }), false);
    assert.equal(shouldRefreshRates({ now: at("2026-09-14T12:00:00Z"), lastFetchedAt, lastFailureAt }), true);
  });
});

describe("exchange-rates — isRateFromToday", () => {
  it("compares calendar days in the business timezone, not UTC", () => {
    // 23:30 on the 13th in Santo Domingo is already the 14th in UTC.
    const lateEvening = rate("USD", 60, new Date("2026-09-14T03:30:00Z"));
    assert.equal(isRateFromToday(lateEvening, new Date("2026-09-14T04:30:00Z")), false);
    assert.equal(isRateFromToday(lateEvening, new Date("2026-09-14T03:45:00Z")), true);
  });
});

describe("exchange-rates — replacePesosDirectives", () => {
  const rates = [rate("USD", 60.35), rate("EUR", 65.9)];

  it("converts the dollar amount at the selling rate, to the cent", () => {
    assert.equal(
      replacePesosDirectives("El kit te sale en [[PESOS: 198]] al cambio de hoy.", rates),
      "El kit te sale en RD$11,949.30 al cambio de hoy.",
    );
    assert.equal(replacePesosDirectives("Son [[pesos:100]]", rates), "Son RD$6,035.00");
  });

  it("accepts the amount written with a currency sign and thousands separator", () => {
    assert.equal(replacePesosDirectives("[[PESOS: US$1,250.50]]", rates), "RD$75,467.68");
    assert.equal(replacePesosDirectives("[[PESOS: $78]] y [[PESOS: 45 USD]]", rates), "RD$4,707.30 y RD$2,715.75");
  });

  it("falls back to the dollar price when there is no rate instead of inventing pesos", () => {
    assert.equal(replacePesosDirectives("Serían [[PESOS: 198]]", null), "Serían US$198.00");
    assert.equal(replacePesosDirectives("Serían [[PESOS: 198]]", [rate("EUR", 65.9)]), "Serían US$198.00");
  });

  it("never leaves an unreadable marker in front of the customer", () => {
    assert.equal(replacePesosDirectives("Serían [[PESOS: el total]]", rates), "Serían el equivalente en pesos");
    assert.equal(replacePesosDirectives("Sin marca", rates), "Sin marca");
  });
});

describe("exchange-rates — the rate in the agent prompt", () => {
  it("gives the agent the selling rate and a worked example computed by the system", () => {
    const block = exchangeRatePromptBlock([rate("EUR", 65.9), rate("USD", 60.35)]);
    assert.ok(block);
    assert.match(block, /1 dólar = RD\$60\.35/);
    assert.match(block, /\[\[PESOS: 100\]\].*RD\$6,035\.00/);
    assert.doesNotMatch(block, /65\.9/);
  });

  it("keeps the pesos amount and the rate out of a dollar sale", () => {
    const block = exchangeRatePromptBlock([rate("USD", 60.35)]);
    assert.ok(block);
    assert.match(block, /No agregues pesos a un precio que nadie te pidió en pesos/);
    assert.match(block, /Si ya dijo que paga en dólares, no le menciones pesos/);
    assert.match(block, /Menciona la tasa solo si te la preguntan/);
  });

  it("has nothing to say without the dollar rate", () => {
    assert.equal(exchangeRatePromptBlock([]), null);
    assert.equal(exchangeRatePromptBlock([rate("EUR", 65.9)]), null);
  });

  it("only reaches the system prompt when there is a rate for today", () => {
    const base = { agentName: "Daniela", profileType: "sales", customPrompt: "Vendes colágeno." };
    const block = exchangeRatePromptBlock([rate("USD", 60.35)]);
    assert.match(buildSystemPrompt({ ...base, exchangeRate: block }), /Tasa de cambio del día/);
    assert.doesNotMatch(buildSystemPrompt({ ...base, exchangeRate: null }), /Tasa de cambio|PESOS/);
  });
});
