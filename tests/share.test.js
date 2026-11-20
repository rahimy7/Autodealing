import test from "node:test";
import assert from "node:assert/strict";
import { vehiclePreview, injectPreview, priceLabel } from "../server/share.js";

const vehicle = {
  id: "8652085e-477d-47b9-b217-815b69b943e8",
  photo: "6e211ba5-064d-4416-9cb8-26a731edb440",
  data: { year: 2018, make: "Toyota", model: "Sienna", trim: "XLE", price: 24900, miles: 131260, drive: "FWD" },
};
const dealer = { name: "Premier Line Motors", city: "Paterson, NJ 07524" };
const page = '<html><head>\n  <title>Old</title>\n  <meta name="description" content="Old text">\n</head><body></body></html>';

test("a shared vehicle link previews its photo, title and price", () => {
  const p = vehiclePreview(vehicle, dealer, { base: "https://example.test" });
  assert.equal(p.title, "2018 Toyota Sienna XLE · $24,900");
  assert.equal(p.description, "131,260 millas · FWD · Premier Line Motors, Paterson, NJ 07524");
  assert.equal(p.image, `https://example.test/media/vehicles/${vehicle.id}/${vehicle.photo}.jpg`);
  assert.equal(p.url, `https://example.test/?v=${vehicle.id}`);
  const html = injectPreview(page, p);
  assert.match(html, /<title>2018 Toyota Sienna XLE · \$24,900<\/title>/);
  assert.match(html, /<meta name="description" content="131,260 millas/);
  assert.match(html, /<meta property="og:image" content="https:\/\/example\.test\/media\/vehicles\/.+\.jpg">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.equal(html.match(/og:title/g).length, 1);
});

test("price on request, English and a unit without photos", () => {
  const p = vehiclePreview({ ...vehicle, photo: null, data: { ...vehicle.data, priceOnRequest: true } }, dealer, { base: "https://example.test", lang: "en" });
  assert.equal(p.title, "2018 Toyota Sienna XLE · Contact for price");
  assert.match(p.description, /^131,260 miles/);
  assert.equal(p.url, `https://example.test/?v=${vehicle.id}&lang=en`);
  assert.equal(p.image, "https://example.test/img/premier-logo.png");
  const html = injectPreview(page, p);
  assert.doesNotMatch(html, /og:image:width/);
  assert.match(html, /content="summary"/);
  assert.equal(priceLabel({ price: 0 }), "Consultar precio");
});

test("vehicle text cannot break out of the tags", () => {
  const p = vehiclePreview({ ...vehicle, data: { ...vehicle.data, model: 'Sienna"><script>alert(1)</script>$&' } }, dealer, { base: "https://example.test" });
  const html = injectPreview(page, p);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Sienna&quot;&gt;&lt;script&gt;/);
  // "$&" stays literal instead of being read as a replacement pattern.
  assert.match(html, /<title>[^<]*\$&amp;/);
});
