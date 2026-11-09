// Crea el esquema de Omnicanal antes de `drizzle-kit push`. drizzle-kit 0.31 no crea
// el esquema de su schemaFilter: si no existe, push falla al leer la base. Mismo
// nombre que src/schema/pg-schema.ts.
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('CREATE SCHEMA IF NOT EXISTS "omnicanal"');
} finally {
  await client.end();
}
