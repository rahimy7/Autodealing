import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import { createReviewDemo, REVIEW_EMAIL, REVIEW_PASSWORD } from "../src/middlewares/review-demo";
import { GetAnalyticsSummaryResponse, ListContactsResponse, ListConversationsResponse, ListMessagesResponse, ListAgentsResponse, ListProductsResponse } from "@workspace/api-zod";

let productionCalls = 0;
const app = express();
app.use(express.json());
app.use("/api", createReviewDemo());
app.use((_req, res) => { productionCalls++; res.status(418).json({ production: true }); });
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw Error("No test port");
const base = `http://127.0.0.1:${address.port}/api`;
after(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));
async function call(path: string, token?: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  // The individual contract assertions below validate these HTTP payloads.
  return { status: res.status, body: await res.json() as any };
}
async function login() {
  const response = await call("/auth/login", undefined, { email: REVIEW_EMAIL, password: REVIEW_PASSWORD });
  assert.equal(response.status, 200);
  assert.match(response.body.user.name, /ficticios/);
  return response.body.token as string;
}

test("ordinary production login and bearer requests retain their existing path", async () => {
  const before = productionCalls;
  assert.equal((await call("/auth/login", undefined, { email: "ordinary@example.com", password: "invalid" })).status, 418);
  assert.equal((await call("/contacts", "ordinary-production-token")).status, 418);
  assert.equal(productionCalls, before + 2);
});
test("invalid demo passwords and forged demo tokens never reach production", async () => {
  const before = productionCalls;
  assert.equal((await call("/auth/login", undefined, { email: REVIEW_EMAIL, password: "wrong" })).status, 401);
  for (const path of ["/contacts", "/settings", "/media/private", "/webhooks/whatsapp"]) {
    assert.equal((await call(path, "omniai-demo.forged", {}, "POST")).status, 401);
  }
  assert.equal(productionCalls, before);
});
test("sandbox fixtures conform to the mobile API contracts", async () => {
  const token = await login();
  for (const [path, schema] of [
    ["/contacts", ListContactsResponse], ["/conversations", ListConversationsResponse],
    ["/conversations/1/messages", ListMessagesResponse], ["/agents", ListAgentsResponse],
    ["/products", ListProductsResponse], ["/analytics/summary", GetAnalyticsSummaryResponse],
  ] as const) {
    const response = await call(path, token);
    assert.equal(response.status, 200, path);
    assert.ok(schema.safeParse(response.body).success, `${path}: ${JSON.stringify(schema.safeParse(response.body))}`);
  }
});
test("messages are simulated per session and cannot reach a real channel", async () => {
  const first = await login(), second = await login();
  const before = productionCalls;
  assert.equal((await call("/conversations/1/messages", first, { content: "Respuesta ficticia", type: "text" })).status, 201);
  const own = await call("/conversations/1/messages", first), other = await call("/conversations/1/messages", second);
  assert.equal(own.body.length, 3);
  assert.equal(other.body.length, 2);
  assert.equal(own.body[2].onChannel, false);
  assert.equal((await call("/conversations/99999/messages", first, { content: "Do not send" })).status, 404);
  assert.equal(productionCalls, before);
});
test("all unsupported reads, uploads, settings, webhooks and writes fail closed", async () => {
  const token = await login(), before = productionCalls;
  for (const path of ["/settings", "/platform-admin/clients", "/media/private", "/webhooks/whatsapp", "/orders", "/shopify-labels", "/future-sensitive-endpoint"]) {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const response = await call(path, token, method === "GET" ? undefined : {}, method);
      assert.equal(response.status, 403, `${method} ${path}`);
    }
  }
  assert.equal(productionCalls, before);
});
test("push tokens are not registered and logout invalidates only the demo session", async () => {
  const token = await login(), before = productionCalls;
  assert.equal((await call("/push/devices", token, { token: "not-a-real-device" })).status, 200);
  assert.equal((await call("/push/test", token, {})).body.devices, 0);
  await call("/auth/logout", token, {});
  assert.equal((await call("/contacts", token)).status, 401);
  assert.equal(productionCalls, before);
});
test("synthetic contact creation and conversation resolution stay in the session", async () => {
  const token = await login(), other = await login();
  const response = await call("/contacts", token, { name: "Cliente ficticio" });
  assert.equal(response.status, 201);
  assert.equal((await call("/contacts", token)).body.length, 5);
  assert.equal((await call("/contacts", other)).body.length, 4);
  assert.equal((await call("/conversations/1/resolve", token, {})).body.status, "resolved");
  assert.equal((await call("/conversations/1", other)).body.status, "open");
});
