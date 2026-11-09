import { pgSchema } from "drizzle-orm/pg-core";

// Todas las tablas y tipos de Omnicanal viven en el esquema "omnicanal" de su base.
// Así puede compartir la base del sitio de Premier, cuyas tablas están en "public"
// (las dos tienen una tabla `appointments`): cada consulta lleva el esquema, y
// drizzle-kit solo mira este (schemaFilter en drizzle.config.ts), así que nunca ve
// ni toca las tablas del sitio. Las consultas escritas a mano sin esquema resuelven
// aquí por el search_path que fija la conexión (src/index.ts).
export const OMNICANAL_SCHEMA = "omnicanal";
// Exportado desde el índice del esquema: drizzle-kit solo reconoce un esquema que
// encuentra declarado ahí; sin él, push intenta borrar "omnicanal" como sobrante.
export const omnicanalSchema = pgSchema(OMNICANAL_SCHEMA);
const omnicanal = omnicanalSchema;

/** pgTable de drizzle, dentro del esquema de Omnicanal. */
export const pgTable = omnicanal.table;
/** pgEnum de drizzle, dentro del esquema de Omnicanal. */
export const pgEnum = omnicanal.enum.bind(omnicanal) as typeof omnicanal.enum;
