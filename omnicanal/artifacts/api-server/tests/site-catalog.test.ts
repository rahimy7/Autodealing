import { describe, it } from "node:test";
import assert from "node:assert/strict";

// The Premier site writes its vehicles as products so the agent can send their photos, several
// per reply (business.photosPerReply).
process.env.CLIENT_ID = "premier";
process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5/none"; // lazy pool: nothing connects
const { productConduct, PHOTO_DIRECTIVE } = await import("../src/lib/openai-client.js");
const { SiteCatalogBody } = await import("../src/routes/site-catalog.js");
const { clientConfig } = await import("../src/lib/client-config.js");

describe("vehicle photos for the virtual agent", () => {
  it("Premier shows up to three units with their photos in one reply", () => {
    assert.equal(clientConfig.business.photosPerReply, 3);
    const several = productConduct(true, 3);
    assert.match(several, /enseña de 2 a 3 productos/);
    assert.match(several, /Una marca por cada producto que enseñes, hasta 3 por mensaje/);
    assert.doesNotMatch(several, /UN SOLO producto por mensaje/);
  });

  it("everyone else keeps one product per message", () => {
    const one = productConduct(true, 1);
    assert.match(one, /UN SOLO producto por mensaje/);
    assert.match(one, /Una sola marca por mensaje/);
    assert.match(productConduct(false, 3), /UN SOLO producto por mensaje/, "no photos, no gallery");
  });

  it("accepts the site's items and refuses what Meta could not download or the agent could not name", () => {
    const item = {
      slug: "2020-jeep-grand-cherokee-limited-4x4-1a2b3c4d",
      name: "2020 Jeep Grand Cherokee Limited 4x4\n140,374 millas · SUV · 4x4 · precio con un asesor",
      url: "https://premier.example/?v=1a2b3c4d-0000-4000-8000-000000000000",
      imageUrl: "https://premier.example/media/vehicles/1a2b3c4d-0000-4000-8000-000000000000/ffff0000-0000-4000-8000-000000000000.jpg",
    };
    assert.equal(SiteCatalogBody.safeParse({ source: "site-vehiculos", items: [item] }).success, true);
    // The slug fits the marker the agent writes.
    const [m] = [...`[[FOTO:${item.slug}]]`.matchAll(PHOTO_DIRECTIVE)];
    assert.equal(m?.[1], item.slug);
    for (const bad of [
      { ...item, imageUrl: "http://premier.example/a.jpg" },
      { ...item, url: "/?v=1" },
      { ...item, slug: "Jeep Grand" },
    ])
      assert.equal(SiteCatalogBody.safeParse({ source: "site-vehiculos", items: [bad] }).success, false, JSON.stringify(bad));
    assert.equal(SiteCatalogBody.safeParse({ source: "import", items: [] }).success, false, "never another source's products");
    assert.equal(SiteCatalogBody.safeParse({ source: "site-vehiculos", items: [item, item] }).success, false, "repeated slugs");
  });
});
