import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { OMNICANAL_SCHEMA } from "./schema/pg-schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// A deployed container has no database on its own loopback, so a localhost URL
// there is always a misconfigured env var (typically the local .env value copied
// into the host's variables). Refuse to boot instead of coming up "healthy" and
// failing every single query with ECONNREFUSED.
if (process.env.NODE_ENV === "production") {
  let host: string | null = null;
  try {
    host = new URL(process.env.DATABASE_URL).hostname;
  } catch {
    // Not URL-shaped (e.g. a libpq key=value string) — leave it to the driver.
  }

  if (host && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) {
    throw new Error(
      `DATABASE_URL points at ${host}, which in a deployed container is the ` +
        "container itself, not a database. Point it at the managed database — " +
        "on Railway, set it to the reference ${{Postgres.DATABASE_URL}}.",
    );
  }
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Managed Postgres (Neon, Railway…) drops idle connections when it suspends or
  // restarts the compute — the backend sends 57P01 and the pooled client dies.
  // Recycle idle clients before that happens and fail fast instead of hanging
  // when the database is unreachable.
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
});

// `pg` emits this when an *idle* client dies (server restart, suspend, network
// drop). It is not tied to any query, so with no listener Node treats it as an
// unhandled 'error' event and kills the process. Swallowing it is correct: the
// pool discards the dead client and opens a fresh one on the next query.
pool.on("error", (err) => {
  console.error("Postgres idle client error (pool will reconnect):", err);
});

// Las tablas van con su esquema en cada consulta de drizzle; algunas consultas
// escritas a mano no lo llevan y deben encontrar las de Omnicanal antes que las de
// otra aplicación que comparta la base (el sitio de Premier, en "public").
pool.on("connect", (client) => {
  client.query(`SET search_path TO ${OMNICANAL_SCHEMA}, public`).catch((err) => {
    console.error("Could not set search_path on a new Postgres connection:", err);
  });
});

export const db = drizzle(pool, { schema });

export * from "./schema";
