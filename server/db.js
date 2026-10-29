import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hashPassword } from "./domain.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (
  process.env.DATABASE_SCHEMA &&
  !/^[a-z][a-z0-9_]{0,60}$/.test(process.env.DATABASE_SCHEMA)
)
  throw new Error("Invalid schema name.");
export const pool = new pg.Pool({
  options: process.env.DATABASE_SCHEMA
    ? `-c search_path=${process.env.DATABASE_SCHEMA}`
    : undefined,
  connectionString: process.env.DATABASE_URL,
  max: 8,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
});
pool.on("error", () => console.error("Database connection error."));
export const query = (q, p) => pool.query(q, p);
export async function transaction(fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function initialize() {
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(487251893)");
    await c.query(
      await fs.readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    const { rows } = await c.query("SELECT id FROM admin_users LIMIT 1");
    if (!rows.length) {
      if (!process.env.ADMIN_BOOTSTRAP_PASSWORD)
        throw new Error("Initial administrator password required.");
      await c.query(
        "INSERT INTO admin_users(id,username,name,role,password_hash) VALUES($1,$2,$3,$4,$5)",
        [
          randomUUID(),
          "admin",
          "Administración Premier",
          "admin",
          await hashPassword(process.env.ADMIN_BOOTSTRAP_PASSWORD),
        ],
      );
    }
    await c.query(
      "INSERT INTO settings(id,value) VALUES('dealer',$1) ON CONFLICT DO NOTHING",
      [
        JSON.stringify({
          name: "Premier Line Motors",
          phone: "(201) 625-0077",
          phoneNumber: "+12016250077",
          email: "info@premierlinemotors.com",
          address: "623–625 River Street",
          city: "Paterson, NJ 07524",
          instagram: "",
          facebook: "",
          tiktok: "",
        }),
      ],
    );
  });
}
