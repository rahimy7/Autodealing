import { integer, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";
import { agentsTable } from "./agents";

// Qué vistas del panel puede abrir cada usuario (2026-10-06). Una fila por usuario
// y vista: tener la fila es tener el acceso. Es independiente del rol del usuario:
// el rol solo decide con qué vistas arranca alguien nuevo (DEFAULT_VIEWS_BY_ROLE en
// @workspace/platform-config); desde ahí manda esta tabla.
//
// `view_key` es una clave de VIEW_KEYS. No es un enum de Postgres a propósito: una
// pantalla nueva no debe pedir una migración, y una clave que ya no exista se
// ignora al leer en vez de romper el inicio de sesión.
//
// El administrador de entorno (el de ADMIN_EMAIL) no tiene fila de agente y por
// eso tampoco filas aquí: ve todo el panel siempre, para que nadie pueda quedarse
// sin forma de volver a dar acceso.
export const viewAccessTable = pgTable(
  "view_access",
  {
    agentId: integer("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    viewKey: text("view_key").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.viewKey] })],
);

export type ViewAccess = typeof viewAccessTable.$inferSelect;
