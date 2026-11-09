import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  // Solo el esquema de Omnicanal (src/schema/pg-schema.ts). La base puede ser la del
  // sitio de Premier: sin este filtro, push vería sus tablas de "public" como
  // sobrantes y ofrecería borrarlas.
  schemaFilter: ["omnicanal"],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
