import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL;
const PORT = "5187";
const base = `http://127.0.0.1:${PORT}`;

// One administration, one set of credentials: with ADMIN_PASSWORD set, the administrator's password
// is the one in the environment (server/admin-env.js). Each start below is a real server on a
// temporary schema.
test("the administrator's password and e-mail can live in the environment", { skip: !databaseUrl, timeout: 120000 }, async (t) => {
  const schema = "premier_test_" + randomBytes(6).toString("hex");
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query(`CREATE SCHEMA ${schema}`);
  const bootstrap = "Boot-" + randomBytes(12).toString("hex");
  const owner = "Env-" + randomBytes(12).toString("hex");
  const rotated = "New-" + randomBytes(12).toString("hex");
  const email = "owner@premier.test";

  const start = async (env) => {
    const proc = spawn(process.execPath, ["server/index.js"], {
      env: {
        ...process.env,
        PORT,
        DATABASE_SCHEMA: schema,
        ADMIN_BOOTSTRAP_PASSWORD: bootstrap,
        NODE_ENV: "test",
        OMNICANAL_URL: "",
        OMNICANAL_SESSION_SECRET: "",
        ADMIN_PASSWORD: "",
        ADMIN_EMAIL: "",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    proc.stdout.on("data", (x) => (logs += x));
    proc.stderr.on("data", (x) => (logs += x));
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/health")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
      if (i === 99) throw new Error("Server failed to start: " + logs);
    }
    const stop = () =>
      new Promise((resolve) => {
        proc.once("exit", resolve);
        proc.kill("SIGTERM");
      });
    return { logs: () => logs, stop };
  };
  const login = async (username, password) => {
    const r = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    return { status: r.status, cookie: r.headers.get("set-cookie")?.split(";")[0] };
  };
  const me = async (cookie) => (await fetch(base + "/api/auth/me", { headers: { Cookie: cookie } })).status;

  try {
    await t.test("with ADMIN_PASSWORD set, the account's password is that one, and the e-mail signs in too", async () => {
      const s = await start({ ADMIN_PASSWORD: owner, ADMIN_EMAIL: email });
      try {
        assert.equal((await login("admin", owner)).status, 200);
        assert.equal((await login(email, owner)).status, 200, "the e-mail is the user name too");
        assert.equal((await login(email.toUpperCase(), owner)).status, 200, "whatever its case");
        assert.equal((await login("admin", bootstrap)).status, 401, "the first password no longer opens it");
        assert.equal((await login(email, bootstrap)).status, 401);
        assert.match(s.logs(), /se tomó de ADMIN_PASSWORD/);
      } finally {
        await s.stop();
      }
    });

    await t.test("restarting with the same value changes nothing and keeps open sessions", async () => {
      const first = await start({ ADMIN_PASSWORD: owner, ADMIN_EMAIL: email });
      let cookie;
      try {
        cookie = (await login("admin", owner)).cookie;
        assert.equal(await me(cookie), 200);
      } finally {
        await first.stop();
      }
      const again = await start({ ADMIN_PASSWORD: owner, ADMIN_EMAIL: email });
      try {
        assert.doesNotMatch(again.logs(), /se tomó de ADMIN_PASSWORD/);
        assert.equal(await me(cookie), 200, "the session survives a restart");
      } finally {
        await again.stop();
      }
    });

    await t.test("changing the variable changes the password and ends the sessions open with the old one", async () => {
      const before = await start({ ADMIN_PASSWORD: owner, ADMIN_EMAIL: email });
      let cookie;
      try {
        cookie = (await login("admin", owner)).cookie;
      } finally {
        await before.stop();
      }
      const after = await start({ ADMIN_PASSWORD: rotated, ADMIN_EMAIL: email });
      try {
        assert.equal(await me(cookie), 401, "the old session is closed");
        assert.equal((await login("admin", owner)).status, 401);
        assert.equal((await login("admin", rotated)).status, 200);
        const { rows } = await db.query(`SELECT action FROM ${schema}.audit_log WHERE action='password.changed.env'`);
        assert.ok(rows.length >= 2, "each change is in the history");
      } finally {
        await after.stop();
      }
    });

    await t.test("without ADMIN_PASSWORD the stored password is never touched and the e-mail means nothing", async () => {
      const s = await start({ ADMIN_EMAIL: email });
      try {
        assert.equal((await login("admin", rotated)).status, 200, "the password stays as it was");
        assert.equal((await login(email, rotated)).status, 401, "no alias without the password in the environment");
      } finally {
        await s.stop();
      }
    });

    await t.test("a password that is too short is ignored, and says so", async () => {
      const s = await start({ ADMIN_PASSWORD: "short", ADMIN_EMAIL: email });
      try {
        assert.match(s.logs(), /al menos 12 caracteres/);
        assert.equal((await login("admin", "short")).status, 401);
        assert.equal((await login("admin", rotated)).status, 200);
      } finally {
        await s.stop();
      }
    });
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  }
});
