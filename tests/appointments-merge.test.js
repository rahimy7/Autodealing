import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { mergeLegacyAppointments } from "../server/appointments-merge.js";

const databaseUrl = process.env.DATABASE_URL;

// Two temporary schemas stand in for the site's and for Omnicanal's old one, so nothing real is read
// or changed. Contact numbers are far above any a real CRM would hold.
test("Omnicanal's old appointments move into the shared agenda and its own table goes", { skip: !databaseUrl, timeout: 60000 }, async (t) => {
  const suffix = randomBytes(5).toString("hex");
  const site = `premier_test_${suffix}`;
  const omni = `premier_test_${suffix}_omni`;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA ${site}; CREATE SCHEMA ${omni}; SET search_path TO ${site}`);
    await db.query(fs.readFileSync(new URL("../server/schema.sql", import.meta.url), "utf8"));
    await db.query(`
      CREATE TYPE ${omni}.appointment_status AS ENUM ('pending','confirmed','cancelled','completed','no_show');
      CREATE TYPE ${omni}.appointment_source AS ENUM ('ai','agent','admin');
      CREATE TABLE ${omni}.appointments (id serial PRIMARY KEY, contact_id integer NOT NULL, conversation_id integer, agent_id integer,
        service text NOT NULL, notes text, location text, starts_at timestamp NOT NULL, duration_minutes integer NOT NULL DEFAULT 60,
        status ${omni}.appointment_status NOT NULL DEFAULT 'pending', source ${omni}.appointment_source NOT NULL DEFAULT 'admin',
        reminder_sent_at timestamp, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
      INSERT INTO ${omni}.appointments(id,contact_id,conversation_id,service,notes,location,starts_at,status,source) VALUES
        (1,2000000001,5,'Corte','Prefiere la tarde','Paterson','2026-12-01 15:00','pending','ai');
      INSERT INTO ${omni}.appointments(id,contact_id,agent_id,service,starts_at,status,source) VALUES
        (2,2000000002,7,'Revisión','2026-12-02 16:30','confirmed','admin');
      INSERT INTO ${omni}.appointments(id,contact_id,service,location,starts_at,status,source,reminder_sent_at) VALUES
        (3,2000000003,'Prueba de manejo','Paterson','2026-12-03 18:00','confirmed','agent','2026-12-02 18:00');
      SELECT setval('${omni}.appointments_id_seq', 3);
      -- The site's own rows, already sent to Omnicanal before: number 3 is the same appointment as the old row 3,
      -- number 2 a different one that happens to hold the number old row 2 has.
      INSERT INTO ${site}.appointments(kind,starts_at,customer_name,status,omni_appointment_id,omni_contact_id,created_by)
        VALUES ('testdrive','2026-12-03 18:00+00','Ana','confirmed',3,2000000003,NULL),
               ('visit','2026-12-09 14:00+00','Otro','confirmed',2,2000000099,NULL);`);

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    let result;
    try {
      result = await mergeLegacyAppointments(client, { site, omni });
      assert.deepEqual(result, { merged: 2, linked: 1, dropped: true });
      // A second run finds nothing left.
      assert.deepEqual(await mergeLegacyAppointments(client, { site, omni }), { merged: 0, linked: 0, dropped: false });
    } finally {
      await client.end();
    }

    const rows = (await db.query(
      `SELECT omni_appointment_id n,omni_contact_id contact,service,status,source,location,customer_name,starts_at at,reminder_sent_at remind,omni_conversation_id conv,agent_id agent
       FROM ${site}.appointments ORDER BY starts_at`,
    )).rows;
    assert.equal(rows.length, 4, "two copied, two the site already had");
    const byContact = Object.fromEntries(rows.map((r) => [r.contact, r]));

    await t.test("an old row keeps its number and every field, with times read as UTC", () => {
      const r = byContact[2000000001];
      assert.equal(r.n, 1);
      assert.equal(r.service, "Corte");
      assert.equal(r.status, "pending");
      assert.equal(r.source, "ai");
      assert.equal(r.location, "Paterson");
      assert.equal(r.conv, 5);
      assert.equal(r.at.toISOString(), "2026-12-01T15:00:00.000Z");
      assert.equal(r.customer_name, "Cliente de Omnicanal");
    });

    await t.test("a number a different appointment already holds is replaced by a fresh one", () => {
      const copied = byContact[2000000002];
      const other = byContact[2000000099];
      assert.equal(other.n, 2, "the site's row keeps its number");
      assert.notEqual(copied.n, 2);
      assert.ok(copied.n > 3, "the new number is past every old one");
      assert.equal(copied.agent, 7);
    });

    await t.test("the site's row for an appointment Omnicanal already had is not duplicated and takes what Omnicanal added", () => {
      const linked = rows.filter((r) => r.contact === 2000000003);
      assert.equal(linked.length, 1);
      assert.equal(linked[0].customer_name, "Ana");
      assert.equal(linked[0].service, "Prueba de manejo");
      assert.equal(linked[0].location, "Paterson");
      assert.equal(linked[0].remind.toISOString(), "2026-12-02T18:00:00.000Z");
      assert.equal(linked[0].source, "agent");
    });

    await t.test("Omnicanal's table and types are gone and new rows get numbers past every old one", async () => {
      const left = (await db.query(`SELECT to_regclass('${omni}.appointments') t, (SELECT count(*) FROM pg_type ty JOIN pg_namespace n ON n.oid=ty.typnamespace WHERE n.nspname='${omni}' AND ty.typname LIKE 'appointment_%')::int types`)).rows[0];
      assert.equal(left.t, null);
      assert.equal(left.types, 0);
      const fresh = (await db.query(`INSERT INTO ${site}.appointments(starts_at,service,omni_contact_id,source) VALUES(now(),'Nueva',2000000004,'ai') RETURNING omni_appointment_id n`)).rows[0];
      assert.ok(fresh.n > Math.max(...rows.map((r) => r.n)));
    });
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${site} CASCADE; DROP SCHEMA IF EXISTS ${omni} CASCADE`);
    await db.end();
  }
});

test("without an old table there is nothing to merge", { skip: !databaseUrl }, async () => {
  const schema = `premier_test_${randomBytes(5).toString("hex")}`;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    assert.deepEqual(await mergeLegacyAppointments(db, { site: schema, omni: schema + "_missing" }), { merged: 0, linked: 0, dropped: false });
    // A table of that name that is not the old shape (the shared one) is left alone.
    await db.query(`CREATE TABLE ${schema}.appointments (id uuid PRIMARY KEY, omni_contact_id integer)`);
    assert.deepEqual(await mergeLegacyAppointments(db, { site: "public", omni: schema }), { merged: 0, linked: 0, dropped: false });
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  }
});
