import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { isHostedImage, toPublicUrl } = await import("../src/lib/public-url.js");

// The welcome message can carry a picture the panel itself serves (/clients/premier/welcome.jpg)
// instead of an uploaded object.
describe("welcome message image", () => {
  it("tells a hosted picture from an uploaded object", () => {
    assert.equal(isHostedImage("/clients/premier/welcome.jpg"), true);
    assert.equal(isHostedImage("https://cdn.example.com/a.jpg"), true);
    assert.equal(isHostedImage("custom-oferta-1a2b3c4d.jpeg"), false);
  });

  it("builds the address Meta downloads from the instance's public address", () => {
    // Inside the Premier site that address already ends in /omnicanal (server/omni-embed.js), which
    // is where the panel's own files are served.
    assert.equal(
      toPublicUrl("/clients/premier/welcome.jpg", { PUBLIC_BASE_URL: "https://premier.example/omnicanal" }),
      "https://premier.example/omnicanal/clients/premier/welcome.jpg",
    );
    assert.equal(
      toPublicUrl("/clients/premier/welcome.jpg", { RAILWAY_PUBLIC_DOMAIN: "premier.up.railway.app" }),
      "https://premier.up.railway.app/clients/premier/welcome.jpg",
    );
    // No public address: the picture is skipped (the text still goes out), never sent as a relative path.
    assert.equal(toPublicUrl("/clients/premier/welcome.jpg", {}), null);
  });
});

// Files kept in the database are handed to Meta through signed, expiring links.
describe("signed media links", () => {
  it("opens only the file it was signed for, until it expires", async () => {
    const { signMediaPath, verifyMediaSignature } = await import("../src/lib/media-signature.js");
    const secret = "s".repeat(48);
    const exp = 2_000_000_000;
    const sig = signMediaPath(secret, "custom-oferta-1a2b.jpeg", exp);
    const now = exp - 600;
    assert.equal(verifyMediaSignature(secret, "custom-oferta-1a2b.jpeg", exp, sig, now), true);
    assert.equal(verifyMediaSignature(secret, "chat-12-9f3c.pdf", exp, sig, now), false, "another file");
    assert.equal(verifyMediaSignature(secret, "custom-oferta-1a2b.jpeg", exp + 1, sig, now), false, "another expiry");
    assert.equal(verifyMediaSignature("x".repeat(48), "custom-oferta-1a2b.jpeg", exp, sig, now), false, "another secret");
    assert.equal(verifyMediaSignature(secret, "custom-oferta-1a2b.jpeg", exp, sig, exp + 1), false, "expired");
    assert.equal(verifyMediaSignature(secret, "custom-oferta-1a2b.jpeg", exp, "", now), false, "no signature");
    assert.equal(verifyMediaSignature(secret, "custom-oferta-1a2b.jpeg", exp, "zz", now), false, "malformed signature");
    assert.equal(verifyMediaSignature("", "custom-oferta-1a2b.jpeg", exp, sig, now), false, "no secret");
    assert.equal(verifyMediaSignature(secret, "custom-oferta-1a2b.jpeg", Number.NaN, sig, now), false, "bad expiry");
  });
});

describe("custom message updates", () => {
  it("change only the fields they name", async () => {
    // Importing the route opens a pool lazily: nothing connects until a query runs.
    process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5/none";
    const { UpdateBody } = await import("../src/routes/custom-messages.js");
    assert.deepEqual(UpdateBody.parse({ imagePath: "/clients/premier/welcome.jpg" }), { imagePath: "/clients/premier/welcome.jpg" });
    assert.deepEqual(UpdateBody.parse({}), {});
    // What an update does send is still validated.
    assert.equal(UpdateBody.safeParse({ imagePath: "/etc/passwd" }).success, false);
    assert.equal(UpdateBody.safeParse({ imagePath: "/clients/premier/welcome.jpg", channels: ["sms"] }).success, false);
    assert.equal(UpdateBody.safeParse({ buttons: [{ id: "a", label: "x" }, { id: "b", label: "y" }, { id: "c", label: "z" }, { id: "d", label: "w" }] }).success, false);
  });
});
