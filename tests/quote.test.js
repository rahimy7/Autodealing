import test from "node:test";
import assert from "node:assert/strict";
import { quoteFigures, monthlyPayment, QUOTE_TERMS } from "../js/quote-math.js";
import { quoteInput, quoteSettingsInput, intakeInput, ROLES, sells, APPOINTMENT_KINDS } from "../server/domain.js";
import { renderQuotePage } from "../server/quote-page.js";

test("a cash quote: tax on the price minus the trade-in, fees untaxed", () => {
  const f = quoteFigures({ price: 20000, fees: 499, taxRate: 6.625, tradeIn: 4000, down: 1000 });
  assert.equal(f.tax, 1060); // (20000 - 4000) × 6.625 %
  assert.equal(f.total, 21559);
  assert.equal(f.balance, 16559);
  assert.equal(f.termMonths, 0);
  assert.equal(f.monthly, 0);
  assert.equal(f.financed, 0);
  assert.equal(f.apr, 0, "a cash quote carries no rate");
});

test("a financed quote matches the site's calculator", () => {
  const f = quoteFigures({ price: 31000, down: 3000, apr: 6.9, termMonths: 72 });
  assert.equal(f.financed, 28000);
  assert.equal(f.monthly, Math.round(monthlyPayment(28000, 6.9, 72) * 100) / 100);
  assert.ok(f.monthly > 470 && f.monthly < 480, String(f.monthly));
  assert.equal(f.totalOfPayments, Math.round(f.monthly * 72 * 100) / 100);
  assert.equal(f.interest, Math.round((f.totalOfPayments - 28000) * 100) / 100);
  assert.equal(quoteFigures({ price: 12000, apr: 0, termMonths: 24 }).monthly, 500);
  assert.equal(quoteFigures({ price: 10000, down: 12000, termMonths: 36, apr: 5 }).monthly, 0, "nothing left to finance");
});

test("quote input: allowed terms, contact required, admin-only fields parsed", () => {
  const ok = quoteInput({ customerName: "Ana", customerPhone: "2015550100", termMonths: 60, apr: "7.5", down: "1500" });
  assert.equal(ok.termMonths, 60);
  assert.equal(ok.apr, 7.5);
  assert.equal(ok.price, null);
  assert.equal(ok.taxRate, null);
  assert.equal(quoteInput({ customerName: "Ana", customerPhone: "1", termMonths: 0, apr: 99 }).apr, 0, "cash ignores the rate");
  assert.throws(() => quoteInput({ customerName: "Ana", customerPhone: "1", termMonths: 61 }), /Plazo/);
  assert.throws(() => quoteInput({ customerName: "Ana", termMonths: 0 }), /teléfono o el email/);
  assert.throws(() => quoteInput({ customerName: "Ana", customerPhone: "1", termMonths: 72, apr: 41 }), /Tasa/);
  assert.throws(() => quoteInput({ customerName: "Ana", customerPhone: "1", taxRate: 25 }), /Impuesto/);
  assert.deepEqual(QUOTE_TERMS, [0, 24, 36, 48, 60, 72, 84]);
  const settings = quoteSettingsInput({ taxRate: "6.625", docFee: "499", apr: "6.9", term: 72, validDays: 3 });
  assert.equal(settings.taxRate, 6.625);
  assert.throws(() => quoteSettingsInput({ taxRate: 0, term: 0 }), /Plazo por defecto/);
});

test("profiles: service loads units and keeps an agenda, but does not sell", () => {
  assert.deepEqual(ROLES, ["admin", "sales", "service"]);
  assert.equal(sells("admin"), true);
  assert.equal(sells("sales"), true);
  assert.equal(sells("service"), false);
  assert.ok(APPOINTMENT_KINDS.includes("service"));
  const unit = intakeInput({ body: "suv", year: "2021", make: " Toyota ", model: "RAV4", vin: "2t3w1rfv0mw123456", miles: "", ext: "Blanco" });
  assert.equal(unit.make, "Toyota");
  assert.equal(unit.vin, "2T3W1RFV0MW123456");
  assert.equal(unit.miles, 0);
  assert.throws(() => intakeInput({ body: "boat", make: "x", model: "y" }), /carrocería/);
});

test("the customer's quote page escapes what was typed and states what it leaves out", () => {
  const q = {
    number: 7,
    vehicle_id: "11111111-1111-4111-8111-111111111111",
    photo_id: "22222222-2222-4222-8222-222222222222",
    customer_name: '<script>alert("x")</script>',
    seller_name: "Ana Ventas",
    notes: "Incluye <b>alfombras</b>",
    created_at: new Date("2026-11-19T15:00:00Z"),
    valid_until_date: "2026-11-22",
    expired: false,
    vehicle: { year: 2023, make: "Honda", model: "Pilot", trim: "EX-L", stock: "P-1", vin: "", miles: 12000, condition: "used", ext: "Gris" },
    figures: quoteFigures({ price: 31000, down: 3000, apr: 6.9, termMonths: 72 }),
  };
  const dealer = { name: "Premier Line Motors", phoneNumber: "+12016250077", phone: "(201) 625-0077" };
  const html = renderQuotePage(q, dealer, { base: "https://x.test", code: "COT-00007", published: true });
  assert.ok(!html.includes("<script>alert"), "the customer's name is escaped");
  assert.ok(html.includes("&lt;b&gt;alfombras"));
  assert.match(html, /COT-00007/);
  assert.match(html, /Impuestos y cargos de registro no incluidos/);
  assert.match(html, /wa\.me\/12016250077/);
  assert.match(html, /\/media\/vehicles\/11111111-1111-4111-8111-111111111111\/22222222-2222-4222-8222-222222222222\.webp/);
  const gone = renderQuotePage({ ...q, expired: true }, dealer, { base: "https://x.test", code: "COT-00007", published: false, lang: "en" });
  assert.match(gone, /no longer available/);
  assert.ok(!gone.includes("/media/vehicles/"), "no photo once the unit is withdrawn");
});
