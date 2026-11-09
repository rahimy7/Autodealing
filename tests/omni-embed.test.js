import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import express from "express";
import { omniConfig, EMBED_PREFIX } from "../server/omnicanal.js";
import {
  childEnv,
  omniPublicUrl,
  omniProxy,
  handoffPage,
  handoffCsp,
  startOmnicanal,
  PANEL_CSP,
  API_CSP,
  PANEL_SESSION_KEY,
} from "../server/omni-embed.js";

const secret = "e".repeat(32);
const base = { OMNICANAL_DATABASE_URL: "postgresql://u:p@db.example.com/omnicanal", OMNICANAL_SESSION_SECRET: secret };

test("inside this service Omnicanal uses the site's database and a loopback port", () => {
  const site = "postgresql://u:p@db.example.com/premier";
  const cfg = omniConfig({ OMNICANAL_SESSION_SECRET: secret, NODE_ENV: "production", DATABASE_URL: site });
  assert.deepEqual(cfg, {
    url: "http://127.0.0.1:8090",
    secret,
    embedded: { port: 8090, databaseUrl: site, sharedDatabase: true },
  });
  // Its own database, when one is given.
  assert.deepEqual(omniConfig({ ...base, DATABASE_URL: site }).embedded, {
    port: 8090,
    databaseUrl: base.OMNICANAL_DATABASE_URL,
    sharedDatabase: false,
  });
  assert.equal(omniConfig({ ...base, OMNICANAL_PORT: "9100" }).url, "http://127.0.0.1:9100");
  assert.throws(() => omniConfig({ ...base, OMNICANAL_URL: "https://chat.example.com" }), /no las dos/);
  assert.throws(() => omniConfig({ OMNICANAL_DATABASE_URL: base.OMNICANAL_DATABASE_URL }), /SESSION_SECRET/);
  assert.throws(() => omniConfig({ OMNICANAL_SESSION_SECRET: secret }), /DATABASE_URL/);
  assert.throws(() => omniConfig({ ...base, OMNICANAL_SESSION_SECRET: "short" }), /corta/);
  assert.throws(() => omniConfig({ ...base, OMNICANAL_PORT: "80" }));
  assert.throws(() => omniConfig({ ...base, OMNICANAL_PORT: "8080" }), /mismo puerto/);
  assert.throws(() => omniConfig({ ...base, OMNICANAL_PORT: "9000", PORT: "9000" }), /mismo puerto/);
  // The schema "omnicanal" is Omnicanal's; the site can't live there when they share the database.
  assert.throws(
    () => omniConfig({ OMNICANAL_SESSION_SECRET: secret, DATABASE_URL: site, DATABASE_SCHEMA: "omnicanal" }),
    /esquema es de Omnicanal/,
  );
  // With OMNICANAL_URL the secret means an instance somewhere else, as before.
  assert.equal(
    omniConfig({ OMNICANAL_URL: "https://chat.example.com", OMNICANAL_SESSION_SECRET: secret, DATABASE_URL: site }).embedded,
    undefined,
  );
});

test("the child sees Omnicanal's names, never the site's database or bootstrap password", () => {
  const cfg = omniConfig(base);
  const env = childEnv(
    {
      ...base,
      DATABASE_URL: "postgresql://site/premier",
      DATABASE_SCHEMA: "premier",
      ADMIN_BOOTSTRAP_PASSWORD: "site-password",
      PORT: "8080",
      NODE_ENV: "production",
      AI_INTEGRATIONS_OPENAI_API_KEY: "sk-test",
      RAILWAY_PUBLIC_DOMAIN: "premier.up.railway.app",
    },
    cfg,
  );
  assert.equal(env.DATABASE_URL, base.OMNICANAL_DATABASE_URL);
  assert.equal(env.SESSION_SECRET, secret);
  assert.equal(env.PORT, "8090");
  assert.equal(env.HOST, "127.0.0.1");
  assert.equal(env.CLIENT_ID, "premier");
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.AI_INTEGRATIONS_OPENAI_API_KEY, "sk-test");
  assert.equal(env.PUBLIC_BASE_URL, "https://premier.up.railway.app/omnicanal");
  // The team's hours, so Omnicanal's background checks let the database sleep the rest of the time.
  assert.deepEqual(
    [env.SCHEDULER_DAYS, env.SCHEDULER_HOURS, env.SCHEDULER_INTERVAL_MINUTES],
    ["1-5", "09:00-17:00", "60"],
  );
  const custom = childEnv({ ...base, SCHEDULER_HOURS: "10:00-14:00" }, cfg);
  assert.equal(custom.SCHEDULER_HOURS, "10:00-14:00");
  for (const name of ["DATABASE_SCHEMA", "ADMIN_BOOTSTRAP_PASSWORD", "OMNICANAL_DATABASE_URL", "OMNICANAL_SESSION_SECRET"])
    assert.equal(env[name], undefined, name);

  assert.equal(omniPublicUrl({ PUBLIC_BASE_URL: "https://premierlinemotors.com/" }), "https://premierlinemotors.com/omnicanal");
  assert.equal(omniPublicUrl({ PUBLIC_BASE_URL: "https://premierlinemotors.com/omnicanal" }), "https://premierlinemotors.com/omnicanal");
  assert.equal(omniPublicUrl({}), "");
  assert.equal(childEnv({ ...base, PUBLIC_BASE_URL: "" }, cfg).PUBLIC_BASE_URL, undefined);
});

// A stand-in for Omnicanal that reports what reached it.
async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}
function siteWithProxy(port) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(EMBED_PREFIX, omniProxy({ port }));
  app.use(express.json());
  app.get("/api/inventory", (_req, res) => res.json({ site: true }));
  return app;
}

test("the panel and its API are served under /omnicanal, body untouched and without the site's cookie", async () => {
  const upstream = await listen((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const seen = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("latin1") };
      if (req.url.startsWith("/api/")) {
        res.writeHead(200, { "content-type": "application/json", connection: "keep-alive" });
        res.end(JSON.stringify(seen));
      } else {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<!doctype html><p>${req.url}</p>`);
      }
    });
  });
  const site = await listen(siteWithProxy(upstream.port));
  const url = (p) => `http://127.0.0.1:${site.port}${p}`;
  try {
    const bare = await fetch(url("/omnicanal?x=1"), { redirect: "manual" });
    assert.equal(bare.status, 308);
    assert.equal(bare.headers.get("location"), "/omnicanal/?x=1");

    const panel = await fetch(url("/omnicanal/inbox?tab=2"));
    assert.equal(panel.status, 200);
    assert.match(await panel.text(), /<p>\/inbox\?tab=2<\/p>/);
    assert.equal(panel.headers.get("content-security-policy"), PANEL_CSP);
    assert.equal(panel.headers.get("x-content-type-options"), "nosniff");

    // Meta signs the exact bytes it sends, so they must arrive as they left.
    const raw = '{"entry":[{"x":"ñ  \\u00e9"}]}  \n';
    const hook = await fetch(url("/omnicanal/api/webhooks/meta?hub=1"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=abc",
        cookie: "premier_sid=" + "a".repeat(64) + "; other=1",
        "x-forwarded-for": "10.9.9.9",
      },
      body: raw,
    });
    assert.equal(hook.status, 200);
    assert.equal(hook.headers.get("content-security-policy"), API_CSP);
    const seen = await hook.json();
    assert.equal(seen.method, "POST");
    assert.equal(seen.url, "/api/webhooks/meta?hub=1");
    assert.equal(Buffer.from(seen.body, "latin1").toString(), raw);
    assert.equal(seen.headers["x-hub-signature-256"], "sha256=abc");
    assert.equal(seen.headers.cookie, "other=1");
    assert.equal(seen.headers.host, `127.0.0.1:${upstream.port}`);
    assert.equal(seen.headers["x-forwarded-host"], `127.0.0.1:${site.port}`);
    assert.equal(seen.headers["x-forwarded-proto"], "http");
    assert.equal(seen.headers["x-forwarded-prefix"], "/omnicanal");
    // One value, the client as the site resolved it: Omnicanal trusts exactly one hop.
    assert.equal(seen.headers["x-forwarded-for"], "10.9.9.9");

    const alone = await fetch(url("/omnicanal/api/agents"), { headers: { cookie: "premier_sid=" + "b".repeat(64) } });
    assert.equal((await alone.json()).headers.cookie, undefined);

    // The site's own routes are not affected.
    assert.deepEqual(await (await fetch(url("/api/inventory"))).json(), { site: true });
  } finally {
    site.server.close();
    upstream.server.close();
  }
});

test("while Omnicanal is starting or down the site answers 503, as JSON for the API", async () => {
  const probe = await listen(() => {});
  const port = probe.port;
  await new Promise((resolve) => probe.server.close(resolve));
  const site = await listen(siteWithProxy(port));
  try {
    const api = await fetch(`http://127.0.0.1:${site.port}/omnicanal/api/config`);
    assert.equal(api.status, 503);
    assert.match((await api.json()).error, /arrancando/);
    const page = await fetch(`http://127.0.0.1:${site.port}/omnicanal/`);
    assert.equal(page.status, 503);
    assert.match(await page.text(), /arrancando/);
  } finally {
    site.server.close();
  }
});

test("the sign-in page leaves the session where the panel reads it, whatever the name says", () => {
  const user = { role: "admin", name: "Ana </script><script>alert(1)</script>\u2028", email: "", agentId: null };
  const nonce = "bm9uY2U=";
  const html = handoffPage({ token: "body.sig", user }, nonce);
  assert.ok(!html.includes("<script>alert"), "the name cannot open a script");
  assert.equal(handoffCsp(nonce), `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  const scripts = [...html.matchAll(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0][1], nonce);
  const store = new Map();
  let went = null;
  vm.runInNewContext(scripts[0][2], {
    localStorage: { setItem: (k, v) => store.set(k, v) },
    location: { replace: (to) => (went = to) },
  });
  assert.deepEqual(JSON.parse(store.get(PANEL_SESSION_KEY)), { token: "body.sig", user });
  assert.equal(went, "/omnicanal/");
});

test("the site starts Omnicanal with its environment, starts it again if it stops, and stops it", { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-embed-"));
  const entry = path.join(dir, "fake-omnicanal.mjs");
  fs.writeFileSync(
    entry,
    `import http from "node:http";
const started = Date.now();
http.createServer((req, res) => {
  if (req.url === "/crash") { res.end("bye"); setTimeout(() => process.exit(3), 10); return; }
  res.end(JSON.stringify({ db: process.env.DATABASE_URL, secret: process.env.SESSION_SECRET, site: process.env.ADMIN_BOOTSTRAP_PASSWORD ?? null, started }));
}).listen(Number(process.env.PORT), process.env.HOST);`,
  );
  const probe = await listen(() => {});
  const port = probe.port;
  await new Promise((resolve) => probe.server.close(resolve));
  const cfg = omniConfig({ ...base, OMNICANAL_PORT: String(port) });
  let migrated = 0;
  const running = startOmnicanal(cfg, {
    env: { ...base, ADMIN_BOOTSTRAP_PASSWORD: "site-only", PATH: process.env.PATH },
    entry,
    migrate: async () => (migrated++, true),
  });
  const ask = async (p = "/") => {
    for (let i = 0; i < 100; i++) {
      try {
        return await (await fetch(`http://127.0.0.1:${port}${p}`)).text();
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("Omnicanal never answered");
  };
  try {
    const first = JSON.parse(await ask());
    assert.equal(migrated, 1, "the schema is brought up to date before starting");
    assert.equal(first.db, base.OMNICANAL_DATABASE_URL);
    assert.equal(first.secret, secret);
    assert.equal(first.site, null);
    assert.equal(running.state.running, true);

    await ask("/crash");
    await new Promise((r) => setTimeout(r, 300));
    const again = JSON.parse(await ask());
    assert.ok(again.started > first.started, "a new process answered");
    assert.match(running.state.error, /código 3/);
  } finally {
    await running.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
  assert.equal(running.state.running, false);
});

test("without a build the site keeps running and says what is missing", () => {
  const running = startOmnicanal(omniConfig(base), { entry: "/nonexistent/index.mjs", migrate: async () => true });
  assert.equal(running.state.running, false);
  assert.match(running.state.error, /omnicanal:build/);
});
