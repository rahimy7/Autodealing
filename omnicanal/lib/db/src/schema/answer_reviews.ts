import { serial, text, integer, timestamp, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { agentsTable } from "./agents";

// Entrenar respuestas (2026-10-15): las preguntas comunes de los clientes, con la
// respuesta que da hoy el agente virtual. El equipo le escribe indicaciones, la
// IA rehace la respuesta con ellas y, cuando el equipo la aprueba, la IA redacta
// la instrucción que desde entonces leen los agentes en su prompt
// (activeAnswerGuidesForPrompt en lib/answer-training.ts).
//
//   - pending:   todavía no se le pidió la respuesta al agente.
//   - review:    hay respuesta y espera que el equipo la apruebe o la corrija.
//   - approved:  aprobada; su instrucción la leen los agentes.
//   - dismissed: no interesa entrenarla.
//
// `active` va aparte del estado a propósito: si se vuelve a procesar una pregunta
// ya aprobada, pasa a `review` pero la instrucción anterior sigue funcionando hasta
// que se apruebe la nueva.
export const answerReviewStatusEnum = pgEnum("answer_review_status", ["pending", "review", "approved", "dismissed"]);

// De dónde salió la pregunta: la base de conocimiento, los chats reales o el equipo.
export const answerReviewSourceEnum = pgEnum("answer_review_source", ["knowledge", "chats", "manual"]);

export type AnswerPreview = {
  /** El texto que le llegaría al cliente, sin marcas. */
  text: string;
  /** Imágenes fijas del negocio ([[IMAGEN:clave]]). */
  images: Array<{ key: string; url: string; caption: string | null }>;
  /** Fotos de producto ([[FOTO:slug]]). */
  photos: Array<{ slug: string; name: string; imageUrl: string | null }>;
  /** Botones ([[OPCIONES: …]]). */
  options: string[];
  /** El agente escaló a una persona (ESCALAR_A_HUMANO). */
  escalates: boolean;
};

export const answerReviewsTable = pgTable(
  "answer_reviews",
  {
    id: serial("id").primaryKey(),
    question: text("question").notNull(),
    // La pregunta normalizada (minúsculas, sin tildes ni signos): evita duplicarla
    // al volver a traerla de la base o de los chats.
    questionKey: text("question_key").notNull(),
    category: text("category"),
    source: answerReviewSourceEnum("source").notNull().default("manual"),
    // Cuántas veces apareció en los chats revisados (solo las detectadas en chats).
    frequency: integer("frequency"),
    // El agente con el que se prueba. La instrucción aprobada la leen todos.
    agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
    // La última respuesta del agente, tal cual la escribió (con sus marcas), y cómo
    // la vería el cliente.
    answer: text("answer"),
    preview: jsonb("preview").$type<AnswerPreview>(),
    answeredAt: timestamp("answered_at"),
    // En cola para generar su respuesta (botón "Generar las que faltan").
    generating: boolean("generating").notNull().default(false),
    generationError: text("generation_error"),
    // Lo que el equipo le pide al agente para esta respuesta.
    indications: text("indications"),
    status: answerReviewStatusEnum("status").notNull().default("pending"),
    // La instrucción que leen los agentes mientras `active` sea true.
    instruction: text("instruction"),
    approvedAnswer: text("approved_answer"),
    active: boolean("active").notNull().default(false),
    approvedById: integer("approved_by_id").references(() => agentsTable.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("answer_reviews_question_key_idx").on(t.questionKey), index("answer_reviews_active_idx").on(t.active)],
);

export type AnswerReview = typeof answerReviewsTable.$inferSelect;
