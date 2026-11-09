import { serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Un caso es una PETICIÓN del cliente que no se contesta y se olvida: pide un
// descuento por volumen, reporta que le cobraron y no le llegó, avisa de que el
// pote vino a la mitad. Hasta ahora eso vivía suelto en un correo o en un chat;
// el caso le pone expediente, dueño y un final registrado.
//
// Se distingue de un pedido (`orders`) en que un pedido es una venta en curso y
// un caso es algo que hay que resolver. Se distingue de una conversación en que
// la conversación termina cuando el cliente deja de escribir y el caso no.

// El tipo decide cómo se resuelve y a quién le toca. Está fijo en el core
// porque el panel filtra por él; lo que un cliente concreto no usa simplemente
// no aparece.
export const caseTypeEnum = pgEnum("case_type", [
  "prayer_request",
  "visitation",
  "bible_study",
  "worship",
  // Comerciales
  "volume_discount", // descuento por comprar varias unidades, revendedores
  "partnership", // distribuidores, alianzas, afiliados
  "subscription", // afiliarse (inscribirse) o desafiliarse (darse de baja) de la compra recurrente
  // Problemas con el pedido
  "order_status", // "¿dónde está mi pedido?"
  "order_error", // llegó otro producto, faltó algo, llegó dañado
  "theft_report", // paquete robado o extraviado, cobro no reconocido, fraude
  "payment_issue", // el pago falló, se cobró dos veces, no se acredita
  "refund", // devolución del dinero
  "cancellation", // cancelar el pedido
  "address_change", // corregir los datos de envío
  // Producto
  "product_quality", // contenido, caducidad, el producto no es lo que esperaba
  "product_question", // cómo se toma, contraindicaciones, qué producto le sirve
  "other",
]);

// `open` es lo que nadie ha tocado; `in_progress` lo que alguien ya está
// atendiendo; `waiting_customer` lo que espera un dato del cliente (la foto del
// paquete, el número de la transferencia) y por eso no cuenta como demora
// nuestra. Termina en `resolved` o en `cancelled`.
export const caseStatusEnum = pgEnum("case_status", [
  "open",
  "in_progress",
  "waiting_customer",
  "resolved",
  "cancelled",
]);

export const casePriorityEnum = pgEnum("case_priority", ["low", "normal", "high", "urgent"]);

// Las dos maneras de cerrar un caso, que es lo que pidió el negocio: hay
// peticiones que se resuelven CONTESTANDO ("¿me sirve si estoy lactando?") y
// otras que exigen HACER algo (devolver el dinero, reponer el envío, aplicar el
// descuento). `rejected` es el cierre honesto del que se atendió y no procede.
export const caseResolutionEnum = pgEnum("case_resolution_kind", ["answered", "actioned", "rejected"]);

export const casesTable = pgTable(
  "cases",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id").notNull(),
    type: caseTypeEnum("type").notNull().default("other"),
    status: caseStatusEnum("status").notNull().default("open"),
    priority: casePriorityEnum("priority").notNull().default("normal"),
    // Por dónde entró la petición: "email", "whatsapp", "instagram", "facebook"
    // o "manual" (alguien la cargó desde el panel).
    channel: text("channel").notNull().default("manual"),
    // De dónde salió. Un caso vive atado a su origen para poder contestar por
    // el mismo sitio por el que el cliente escribió.
    emailThreadId: integer("email_thread_id"),
    conversationId: integer("conversation_id"),
    orderId: integer("order_id"),
    subject: text("subject").notNull(),
    // Qué pide el cliente, dicho en corto. Lo redacta la IA al abrirlo o quien
    // lo carga a mano.
    description: text("description"),
    // La acción concreta que espera ("que le devuelvan los US$100", "que le
    // repongan el pote"). Separada de la descripción porque es lo que se compara
    // con lo que al final se hizo.
    requestedAction: text("requested_action"),
    resolutionKind: caseResolutionEnum("resolution_kind"),
    resolution: text("resolution"),
    assignedAgentId: integer("assigned_agent_id"),
    // Quién lo abrió a mano. Null cuando lo abrió la IA leyendo el correo o el chat.
    createdByAgentId: integer("created_by_agent_id"),
    openedByAi: boolean("opened_by_ai").notNull().default(false),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("cases_contact_idx").on(t.contactId),
    index("cases_status_idx").on(t.status),
    index("cases_email_thread_idx").on(t.emailThreadId),
    index("cases_conversation_idx").on(t.conversationId),
  ],
);

// El expediente del caso: qué pasó y cuándo. Es lo que permite que alguien que
// no estuvo entienda en diez segundos por qué se cerró como se cerró.
export const caseEventKindEnum = pgEnum("case_event_kind", [
  "opened",
  "status",
  "note",
  "reply", // se le contestó al cliente (correo o chat)
  "action", // se hizo algo: reembolso, reposición, descuento aplicado
  "assigned",
  "resolved",
]);

export const caseEventsTable = pgTable(
  "case_events",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id").notNull(),
    kind: caseEventKindEnum("kind").notNull(),
    body: text("body").notNull(),
    // Quién lo hizo. Null = el sistema o la IA.
    agentId: integer("agent_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("case_events_case_idx").on(t.caseId)],
);

export const insertCaseSchema = createInsertSchema(casesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCase = z.infer<typeof insertCaseSchema>;
export type Case = typeof casesTable.$inferSelect;
export type CaseEvent = typeof caseEventsTable.$inferSelect;
