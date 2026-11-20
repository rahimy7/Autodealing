import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url));

test("the phone app computes quotes with the server's own function, byte for byte", async () => {
  const [server, app] = await Promise.all([read("../js/quote-math.js"), read("../mobile/src/lib/quote-math.js")]);
  assert.ok(server.equals(app), "mobile/src/lib/quote-math.js differs from js/quote-math.js: run `npm run sync:quote-math` in mobile/");
});

test("the phone app is configured as its own package and ships no server address or secret", async () => {
  const { expo } = JSON.parse(await read("../mobile/app.json"));
  assert.equal(expo.android.package, "com.premierlinemotors.app");
  assert.equal(expo.ios.bundleIdentifier, "com.premierlinemotors.app");
  assert.equal(expo.extra.apiUrl, "", "the server address is typed in the app or set at build time, never committed");
  const permissions = JSON.stringify(expo.plugins);
  assert.match(permissions, /cámara/, "the camera permission says why the app needs it");
  const server = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");
  assert.match(server, /^mobile$/m, "the phone app stays out of the server image");
});

test("Android release builds only allow plain http to the phone's own loopback addresses", async () => {
  const { createRequire } = await import("node:module");
  const { XML } = createRequire(import.meta.url)("../mobile/plugins/with-local-cleartext.js");
  assert.match(XML, /<base-config cleartextTrafficPermitted="false"/, "everything else stays https only");
  const allowed = [...XML.matchAll(/<domain[^>]*>([^<]+)<\/domain>/g)].map((m) => m[1]);
  assert.deepEqual(allowed, ["localhost", "127.0.0.1", "10.0.2.2"]);
  const { expo } = JSON.parse(await read("../mobile/app.json"));
  assert.ok(expo.plugins.includes("./plugins/with-local-cleartext"));
});
