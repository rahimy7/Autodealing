import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
const databaseUrl = process.env.DATABASE_URL;
test(
  "Neon end-to-end: access, photos, inventory, inquiries, sale atomicity and permissions",
  { skip: !databaseUrl, timeout: 180000 },
  async (t) => {
    const schema = "premier_test_" + randomBytes(6).toString("hex");
    const db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
    await db.query(`CREATE SCHEMA ${schema}`);
    const password = "Test-" + randomBytes(18).toString("hex");
    const proc = spawn(process.execPath, ["server/index.js"], {
      env: {
        ...process.env,
        PORT: "5182",
        DATABASE_SCHEMA: schema,
        ADMIN_BOOTSTRAP_PASSWORD: password,
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    proc.stdout.on("data", (x) => (logs += x));
    proc.stderr.on("data", (x) => (logs += x));
    const base = "http://127.0.0.1:5182";
    let cookie = "",
      csrf = "",
      vehicle,
      idPhoto,
      saleId,
      userId;
    const send = async (
      url,
      { method = "GET", body, auth = true, csrfOverride } = {},
    ) => {
      const headers = {};
      if (auth && cookie) headers.Cookie = cookie;
      if (auth && csrf) headers["X-CSRF-Token"] = csrfOverride ?? csrf;
      if (body && !(body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(body);
      }
      const r = await fetch(base + url, { method, body, headers });
      const raw = await r.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
      return { status: r.status, data, response: r };
    };
    try {
      for (let i = 0; i < 80; i++) {
        try {
          const r = await fetch(base + "/health");
          if (r.ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
        if (i === 79) throw new Error("Server failed to start: " + logs);
      }
      await t.test(
        "admin API rejects anonymous users and accepts authenticated session",
        async () => {
          assert.equal(
            (await send("/api/admin/vehicles", { auth: false })).status,
            401,
          );
          const r = await send("/api/auth/login", {
            method: "POST",
            body: { username: "admin", password },
            auth: false,
          });
          assert.equal(r.status, 200);
          cookie = r.response.headers.get("set-cookie").split(";")[0];
          csrf = r.data.user.csrf;
          assert.ok(r.response.headers.get("set-cookie").includes("HttpOnly"));
        },
      );
      await t.test(
        "cross-origin and missing CSRF writes are rejected",
        async () => {
          assert.equal(
            (
              await send("/api/admin/vehicles", {
                method: "POST",
                body: {},
                csrfOverride: "wrong",
              })
            ).status,
            403,
          );
          const r = await fetch(base + "/api/auth/login", {
            method: "POST",
            headers: {
              Origin: "https://evil.example",
              "Content-Type": "application/json",
            },
            body: "{}",
          });
          assert.equal(r.status, 403);
        },
      );
      await t.test(
        "draft vehicle is private and duplicate stock is rejected",
        async () => {
          const body = {
            stock: "QA-PRIVATE",
            vin: "1HGCM82633A004352",
            make: "Honda",
            model: "Accord",
            year: 2022,
            status: "draft",
            cats: ["sedan"],
            price: 22000,
            miles: 20000,
            purchaseCost: 15000,
            desc: {
              es: "A & B <script>not executable</script>",
              en: "Description",
            },
          };
          const r = await send("/api/admin/vehicles", { method: "POST", body });
          assert.equal(r.status, 201);
          vehicle = r.data.id;
          assert.equal(
            (await send("/api/admin/vehicles", { method: "POST", body }))
              .status,
            409,
          );
          assert.equal(
            (await send("/api/inventory", { auth: false })).data.length,
            0,
          );
        },
      );
      await t.test(
        "photos are compressed, drafts private, reorder and delete supported",
        async () => {
          const sharp = (await import("sharp")).default;
          const buffer = await sharp({
            create: {
              width: 40,
              height: 30,
              channels: 3,
              background: "#335577",
            },
          })
            .png()
            .toBuffer();
          const form = new FormData();
          form.append(
            "photo",
            new Blob([buffer], { type: "image/png" }),
            "qa.png",
          );
          const r = await send(`/api/admin/vehicles/${vehicle}/photos`, {
            method: "POST",
            body: form,
          });
          assert.equal(r.status, 201);
          idPhoto = r.data.id;
          assert.equal(
            (await send("/api/photos/" + idPhoto, { auth: false })).status,
            404,
          );
          const privateImage = await send("/api/photos/" + idPhoto);
          assert.equal(privateImage.status, 200);
          assert.match(
            privateImage.response.headers.get("content-type"),
            /image\/webp/,
          );
          assert.equal(
            (
              await send(`/api/admin/vehicles/${vehicle}/photos/order`, {
                method: "PUT",
                body: { ids: [idPhoto, idPhoto] },
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await send(`/api/admin/vehicles/${vehicle}/photos/order`, {
                method: "PUT",
                body: { ids: [idPhoto] },
              })
            ).status,
            200,
          );
        },
      );
      await t.test(
        "publication updates catalogue and optimistic version prevents lost writes",
        async () => {
          const v = (await send("/api/admin/vehicles")).data[0];
          const body = { ...v, status: "available" };
          assert.equal(
            (
              await send("/api/admin/vehicles/" + vehicle, {
                method: "PUT",
                body,
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await send("/api/admin/vehicles/" + vehicle, {
                method: "PUT",
                body,
              })
            ).status,
            409,
          );
          const r = await send("/api/inventory", { auth: false });
          assert.equal(r.data[0].id, vehicle);
          assert.equal(r.data[0].purchaseCost, undefined);
          assert.equal(r.data[0].purchase_cost, undefined);
          assert.equal(
            (await send("/api/photos/" + idPhoto, { auth: false })).status,
            200,
          );
        },
      );
      await t.test(
        "expense adds to sale cost and public forms store leads",
        async () => {
          assert.equal(
            (
              await send(`/api/admin/vehicles/${vehicle}/expenses`, {
                method: "POST",
                body: {
                  description: "Transport",
                  amount: 500,
                  date: "2026-10-28",
                },
              })
            ).status,
            201,
          );
          assert.equal(
            (
              await send("/api/leads", {
                method: "POST",
                auth: false,
                body: {
                  kind: "testdrive",
                  name: "QA Test",
                  phone: "0000000000",
                  vehicle,
                  msg: "Test only",
                },
              })
            ).status,
            201,
          );
          assert.equal(
            (await send("/api/admin/leads")).data[0].vehicle_id,
            vehicle,
          );
        },
      );
      await t.test(
        "concurrent sale requests produce exactly one sale and remove vehicle publicly",
        async () => {
          const body = {
            vehicleId: vehicle,
            price: 22000,
            buyerName: "QA buyer",
            soldAt: "2026-10-28",
          };
          const results = await Promise.all([
            send("/api/admin/sales", { method: "POST", body }),
            send("/api/admin/sales", { method: "POST", body }),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
          saleId = results.find((r) => r.status === 201).data.id;
          assert.equal(
            (await send("/api/inventory", { auth: false })).data.length,
            0,
          );
          const s = (await send("/api/admin/sales")).data[0];
          assert.equal(Number(s.cost), 15500);
          assert.equal(
            (await send("/api/photos/" + idPhoto, { auth: false })).status,
            404,
          );
        },
      );
      await t.test(
        "cancellation preserves sale history and returns stock to catalogue",
        async () => {
          assert.equal(
            (
              await send("/api/admin/sales/" + saleId + "/cancel", {
                method: "POST",
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await send("/api/admin/sales/" + saleId + "/cancel", {
                method: "POST",
              })
            ).status,
            409,
          );
          assert.equal(
            (await send("/api/inventory", { auth: false })).data.length,
            1,
          );
          assert.ok((await send("/api/admin/sales")).data[0].cancelled_at);
        },
      );
      await t.test(
        "sales role cannot see costs, settings or users",
        async () => {
          const created = await send("/api/admin/users", {
            method: "POST",
            body: {
              username: "qa-sales",
              name: "QA Sales",
              role: "sales",
              password,
            },
          });
          assert.equal(created.status, 201);
          userId = created.data.id;
          const adminCookie = cookie,
            adminCsrf = csrf;
          const login = await send("/api/auth/login", {
            method: "POST",
            auth: false,
            body: { username: "qa-sales", password },
          });
          cookie = login.response.headers.get("set-cookie").split(";")[0];
          csrf = login.data.user.csrf;
          for (const url of [
            "/api/admin/settings",
            "/api/admin/users",
            `/api/admin/vehicles/${vehicle}/expenses`,
          ])
            assert.equal((await send(url)).status, 403);
          assert.equal(
            (await send("/api/admin/vehicles")).data[0].purchaseCost,
            undefined,
          );
          assert.equal(
            (await send("/api/admin/sales")).data[0].cost,
            undefined,
          );
          const salesCookie = cookie;
          cookie = adminCookie;
          csrf = adminCsrf;
          assert.equal(
            (
              await send("/api/admin/users/" + userId + "/active", {
                method: "PUT",
                body: { active: false },
              })
            ).status,
            200,
          );
          const r = await fetch(base + "/api/admin/vehicles", {
            headers: { Cookie: salesCookie },
          });
          assert.equal(r.status, 401);
        },
      );
      await t.test(
        "demo units cannot generate sales; settings and audit persist",
        async () => {
          const v = (await send("/api/admin/vehicles")).data[0];
          assert.equal(
            (
              await send("/api/admin/vehicles/" + vehicle, {
                method: "PUT",
                body: { ...v, demo: true },
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await send("/api/admin/sales", {
                method: "POST",
                body: {
                  vehicleId: vehicle,
                  price: 22000,
                  buyerName: "QA",
                  soldAt: "2026-10-28",
                },
              })
            ).status,
            409,
          );
          const dashboard = (await send("/api/admin/dashboard")).data;
          assert.equal(dashboard.sales.count, 0);
          assert.equal(dashboard.leads, 1);
          assert.ok(dashboard.recent.length);
          assert.ok((await send("/api/admin/settings")).data.name);
        },
      );
      await t.test(
        "website content is editable while private server files remain inaccessible",
        async () => {
          const r = await send("/api/admin/content", {
            method: "PUT",
            body: {
              es: {
                "hero.lead": "Contenido de prueba",
                "not.allowed": "ignored",
              },
              en: { "hero.lead": "Test content" },
            },
          });
          assert.equal(r.status, 200);
          const content = (await send("/api/content", { auth: false })).data;
          assert.equal(content.es["hero.lead"], "Contenido de prueba");
          assert.equal(content.es["not.allowed"], undefined);
          assert.equal(
            (await send("/server/db.js", { auth: false })).status,
            404,
          );
          assert.equal((await send("/.env", { auth: false })).status, 404);
          const adminPage = await send("/admin/", { auth: false });
          assert.equal(adminPage.status, 200);
          assert.ok(
            adminPage.response.headers
              .get("content-security-policy")
              .includes("frame-ancestors 'none'"),
          );
        },
      );
      await t.test("logout invalidates the session", async () => {
        assert.equal(
          (await send("/api/auth/logout", { method: "POST" })).status,
          200,
        );
        assert.equal((await send("/api/auth/me")).status, 401);
      });
    } finally {
      proc.kill("SIGTERM");
      await new Promise((r) => {
        if (proc.exitCode !== null) return r();
        proc.once("exit", r);
        setTimeout(() => {
          proc.kill("SIGKILL");
          r();
        }, 4000).unref();
      });
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
      await db.end();
    }
  },
);
