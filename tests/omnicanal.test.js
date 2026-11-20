import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  mintToken,
  omniConfig,
  createClient,
  inventoryKnowledge,
  vehicleCatalog,
  vehiclePhotoSlug,
  sitePublicOrigin,
  vehicleMessage,
  messageView,
  mediaFile,
} from "../server/omnicanal.js";
import { reservationInput, appointmentInput, appointmentUpdate } from "../server/domain.js";

// Omnicanal's verifyToken (omnicanal/artifacts/api-server/src/lib/auth.ts), copied as-is in
// behaviour: if this stops accepting our tokens, salespeople can't act as agents. The copy's own
// suite checks the same thing against the real function (tests/premier-site.test.ts there).
function omnicanalVerify(secret, token) {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest().toString("base64url");
  const a = Buffer.from(signature),
    b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
  return { role: payload.role, name: payload.name, email: payload.email, agentId: payload.agentId ?? null };
}

const secret = "s".repeat(32);

test("minted tokens are accepted by Omnicanal's verifier as the right agent", () => {
  const token = mintToken(secret, { role: "agent", name: "Ana", email: "ana@x.com", agentId: 7 });
  assert.deepEqual(omnicanalVerify(secret, token), { role: "agent", name: "Ana", email: "ana@x.com", agentId: 7 });
  assert.equal(omnicanalVerify("other-secret-value-0000", token), null);
  const system = omnicanalVerify(secret, mintToken(secret, { role: "admin", name: "Sitio" }));
  assert.equal(system.agentId, null);
  assert.equal(system.role, "admin");
});

test("minted tokens are short-lived and never claim a role Omnicanal doesn't have", () => {
  const old = mintToken(secret, { role: "agent", name: "A", agentId: 1 }, 300, Date.now() - 301_000);
  assert.equal(omnicanalVerify(secret, old), null);
  const odd = omnicanalVerify(secret, mintToken(secret, { role: "superuser", name: "A", agentId: 1 }));
  assert.equal(odd.role, "agent");
});

test("configuration requires both values, https in production and a long secret", () => {
  assert.equal(omniConfig({}), null);
  assert.throws(() => omniConfig({ OMNICANAL_URL: "https://chat.example.com" }));
  assert.throws(() => omniConfig({ OMNICANAL_URL: "http://chat.example.com", OMNICANAL_SESSION_SECRET: secret }));
  assert.throws(() => omniConfig({ OMNICANAL_URL: "http://localhost:3000", OMNICANAL_SESSION_SECRET: secret, NODE_ENV: "production" }));
  assert.throws(() => omniConfig({ OMNICANAL_URL: "https://chat.example.com", OMNICANAL_SESSION_SECRET: "short" }));
  assert.throws(() => omniConfig({ OMNICANAL_URL: "https://u:p@chat.example.com", OMNICANAL_SESSION_SECRET: secret }));
  assert.deepEqual(omniConfig({ OMNICANAL_URL: "https://chat.example.com/", OMNICANAL_SESSION_SECRET: secret }), {
    url: "https://chat.example.com",
    secret,
  });
  assert.equal(omniConfig({ OMNICANAL_URL: "http://127.0.0.1:5185", OMNICANAL_SESSION_SECRET: secret, NODE_ENV: "test" }).url, "http://127.0.0.1:5185");
});

test("a refused signature is reported as an integration error, never as the user's 401", async () => {
  const fake = async () => new Response(JSON.stringify({ error: "No autenticado." }), { status: 401 });
  const client = createClient({ url: "https://x.test", secret, fetchImpl: fake });
  await assert.rejects(client.request({ role: "admin", name: "x" }, "/agents"), (e) => e.status === 502 && /SESSION_SECRET/.test(e.message));
  const forbidden = async () => new Response(JSON.stringify({ error: "Esta conversación está asignada a otro agente." }), { status: 403 });
  await assert.rejects(
    createClient({ url: "https://x.test", secret, fetchImpl: forbidden }).request({ role: "agent", agentId: 1 }, "/x"),
    (e) => e.status === 403 && e.message.includes("otro agente"),
  );
  const down = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(createClient({ url: "https://x.test", secret, fetchImpl: down }).request({}, "/x"), (e) => e.status === 502);
  const crash = async () => new Response("<html>", { status: 500 });
  await assert.rejects(createClient({ url: "https://x.test", secret, fetchImpl: crash }).request({}, "/x"), (e) => e.status === 502);
});

test("the client signs each request and sends JSON to /api", async () => {
  let seen;
  const fake = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ id: 4 }), { status: 201 });
  };
  const client = createClient({ url: "https://x.test", secret, fetchImpl: fake });
  assert.deepEqual(await client.request({ role: "agent", name: "Ana", agentId: 7 }, "/contacts", { method: "POST", body: { name: "Z" } }), { id: 4 });
  assert.equal(seen.url, "https://x.test/api/contacts");
  assert.equal(seen.init.redirect, "error");
  assert.equal(omnicanalVerify(secret, seen.init.headers.Authorization.slice(7)).agentId, 7);
  assert.equal(seen.init.body, '{"name":"Z"}');
});

const v = (status, data, id = "11111111-1111-4111-8111-111111111111", stock = "PL-1") => ({ id, stock, status, data });
const car = { year: 2022, make: "Honda", model: "Accord", trim: "EX", price: 22500, miles: 20000, condition: "used", cats: ["sedan"], fuel: "gas", trans: { es: "Automática" }, ext: { es: "Blanco" } };

test("the virtual agent only learns about real units for sale", () => {
  const text = inventoryKnowledge(
    [
      v("available", car),
      v("reserved", { ...car, model: "Civic" }, "22222222-2222-4222-8222-222222222222", "PL-2"),
      v("available", { ...car, model: "DemoCar", demo: true }, "33333333-3333-4333-8333-333333333333", "PL-3"),
      v("sold", { ...car, model: "Sold" }, "44444444-4444-4444-8444-444444444444", "PL-4"),
      v("draft", { ...car, model: "Draft" }, "55555555-5555-4555-8555-555555555555", "PL-5"),
      v("available", { ...car, model: "Pilot", priceOnRequest: true, price: 0 }, "66666666-6666-4666-8666-666666666666", "PL-6"),
    ],
    { dealer: { name: "Premier", phone: "(201) 625-0077" }, publicUrl: "https://premier.test/" },
  );
  assert.match(text, /2022 Honda Accord EX — stock PL-1/);
  assert.match(text, /USD 22,500/);
  assert.match(text, /https:\/\/premier\.test\/\?v=11111111-1111-4111-8111-111111111111/);
  assert.match(text, /Civic[\s\S]*Estado: reservado/);
  assert.match(text, /Pilot[\s\S]*a consultar con un vendedor/);
  for (const hidden of ["DemoCar", "Sold", "Draft"]) assert.ok(!text.includes(hidden), hidden);
  assert.ok(text.indexOf("Accord") < text.indexOf("Civic"), "available units come first");
  assert.match(inventoryKnowledge([], { dealer: { name: "P" } }), /no hay vehículos confirmados/);
});

test("each listed unit with a photo becomes a product the agent can send, with a JPEG and its page", () => {
  const units = [
    v("available", car),
    v("reserved", { ...car, model: "Civic" }, "22222222-2222-4222-8222-222222222222", "PL-2"),
    v("available", { ...car, model: "DemoCar", demo: true }, "33333333-3333-4333-8333-333333333333", "PL-3"),
    v("sold", { ...car, model: "Sold" }, "44444444-4444-4444-8444-444444444444", "PL-4"),
    v("available", { ...car, model: "Pilot", priceOnRequest: true, price: 0, cats: ["suv"], drive: "AWD" }, "66666666-6666-4666-8666-666666666666", "PL-6"),
    v("available", { ...car, model: "NoPhoto" }, "77777777-7777-4777-8777-777777777777", "PL-7"),
  ];
  const photos = new Map(units.filter((u) => u.data.model !== "NoPhoto").map((u, i) => [u.id, `aaaaaaaa-0000-4000-8000-00000000000${i}`]));
  const items = vehicleCatalog(units, { publicUrl: "https://premier.test/", photos });
  assert.deepEqual(items.map((i) => i.slug).sort(), ["2022-honda-accord-ex-11111111", "2022-honda-civic-ex-22222222", "2022-honda-pilot-ex-66666666"]);
  assert.equal(items.at(-1).slug, "2022-honda-civic-ex-22222222", "reserved units come last");
  for (const hidden of ["DemoCar", "Sold", "NoPhoto"]) assert.ok(!items.some((i) => i.name.includes(hidden)), hidden);
  const accord = items.find((i) => i.vehicleId === "11111111-1111-4111-8111-111111111111");
  assert.equal(accord.url, "https://premier.test/?v=11111111-1111-4111-8111-111111111111");
  assert.equal(accord.imageUrl, `https://premier.test/media/vehicles/11111111-1111-4111-8111-111111111111/${photos.get(accord.vehicleId)}.jpg`);
  assert.equal(accord.name, "2022 Honda Accord EX\n20,000 millas · sedán · USD 22,500");
  const pilot = items.find((i) => i.slug.startsWith("2022-honda-pilot"));
  assert.equal(pilot.name, "2022 Honda Pilot EX\n20,000 millas · SUV · AWD · precio con un asesor");
  assert.match(items.find((i) => i.name.includes("Civic")).name, /reservado$/);
  // The slug is what the agent writes in [[FOTO:…]]: Omnicanal's marker takes [a-z0-9-].
  for (const i of items) assert.match(i.slug, /^[a-z0-9][a-z0-9-]*$/);
  assert.equal(vehiclePhotoSlug(v("available", { year: 2021, make: "Citroën", model: "C5 Aircross" }, "abcdef12-3456-4789-8abc-def012345678")), "2021-citroen-c5-aircross-abcdef12");
  // Meta downloads the photo by itself: no public https address, no photos.
  assert.deepEqual(vehicleCatalog(units, { publicUrl: "", photos }), []);
  assert.deepEqual(vehicleCatalog(units, { publicUrl: "http://localhost:8080", photos }), []);

  // The knowledge base names the photo so the agent can ask for it.
  const text = inventoryKnowledge(units, { dealer: { name: "Premier" }, publicUrl: "https://premier.test", photoSlugs: new Map(items.map((i) => [i.vehicleId, i.slug])) });
  assert.match(text, /Accord EX — stock PL-1[\s\S]*Identificador: 2022-honda-accord-ex-11111111/);
  assert.ok(!/NoPhoto[^•]*Identificador/.test(text), "a unit without a photo has no identifier");
});

test("the site's public address comes from PUBLIC_BASE_URL or Railway's domain", () => {
  assert.equal(sitePublicOrigin({ PUBLIC_BASE_URL: "https://premierlinemotors.com/" }), "https://premierlinemotors.com");
  assert.equal(sitePublicOrigin({ PUBLIC_BASE_URL: "https://premierlinemotors.com/omnicanal" }), "https://premierlinemotors.com");
  assert.equal(sitePublicOrigin({ RAILWAY_PUBLIC_DOMAIN: "premier-production.up.railway.app" }), "https://premier-production.up.railway.app");
  assert.equal(sitePublicOrigin({}), "");
});

test("a shared vehicle carries its price and public link", () => {
  const message = vehicleMessage(v("available", car), "https://premier.test");
  assert.equal(message, "2022 Honda Accord EX\nPrecio: $22,500 · 20,000 millas\nFotos y detalles: https://premier.test/?v=11111111-1111-4111-8111-111111111111");
});

test("attachments are served through this site and odd file names are dropped", () => {
  assert.equal(mediaFile("/api/media/abc-1.jpg"), "abc-1.jpg");
  assert.equal(mediaFile("/api/media/../../etc/passwd"), "passwd");
  assert.equal(mediaFile("/api/media/a b.jpg"), null);
  assert.equal(mediaFile(null), null);
  const m = messageView({ id: 1, sender: "contact", content: "", type: "image", mediaUrl: "/api/media/x.jpg", isInternal: false, isDeleted: false, status: "failed", failedReason: "24h", createdAt: "2026-01-01" });
  assert.equal(m.media, "/api/admin/crm/media/x.jpg");
  assert.equal(m.failed, true);
});

test("reservations and appointments validate the customer and the slot", () => {
  assert.throws(() => reservationInput({ customerName: "" }));
  assert.throws(() => reservationInput({ customerName: "Ana" }), /teléfono o el email/);
  assert.throws(() => reservationInput({ customerName: "Ana", customerPhone: "1", days: 31 }));
  assert.throws(() => reservationInput({ customerName: "Ana", customerEmail: "bad" }));
  assert.equal(reservationInput({ customerName: "Ana", customerPhone: "201", deposit: "500" }).deposit, 500);
  const base = { kind: "testdrive", date: "2026-11-10", time: "14:30", customerName: "Ana", customerPhone: "201" };
  assert.equal(appointmentInput(base).durationMinutes, 60);
  for (const patch of [{ kind: "party" }, { time: "25:00" }, { date: "2026-13-01" }, { durationMinutes: 5 }, { vehicleId: "x" }])
    assert.throws(() => appointmentInput({ ...base, ...patch }));
  assert.throws(() => appointmentUpdate({}));
  assert.throws(() => appointmentUpdate({ status: "done" }));
  assert.deepEqual(appointmentUpdate({ status: "completed" }), { status: "completed" });
});
