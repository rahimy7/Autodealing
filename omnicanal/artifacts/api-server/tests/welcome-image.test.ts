import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { isSiteImage, toPublicUrl } = await import("../src/lib/public-url.js");

// The welcome message can carry a picture the site itself serves (/img/welcome.jpg) instead of an
// object in the media bucket, so it works without a storage account.
describe("welcome message image", () => {
  it("tells a site picture from a bucket object", () => {
    assert.equal(isSiteImage("/img/welcome.jpg"), true);
    assert.equal(isSiteImage("https://cdn.example.com/a.jpg"), true);
    assert.equal(isSiteImage("custom-oferta-1a2b3c4d.jpeg"), false);
  });

  it("builds the address Meta downloads from the site's public domain", () => {
    assert.equal(toPublicUrl("/img/welcome.jpg", { PUBLIC_BASE_URL: "https://premier.example/" }), "https://premier.example/img/welcome.jpg");
    assert.equal(toPublicUrl("/img/welcome.jpg", { RAILWAY_PUBLIC_DOMAIN: "premier.up.railway.app" }), "https://premier.up.railway.app/img/welcome.jpg");
    // No public address: the picture is skipped (the text still goes out), never sent as a relative path.
    assert.equal(toPublicUrl("/img/welcome.jpg", {}), null);
  });
});
