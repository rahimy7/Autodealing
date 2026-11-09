// Memoria de aprendizaje de los agentes virtuales. Pedida el 2026-09-18: "creemos
// una memoria que permita ir aprendiendo si el cliente se frustra con las
// respuestas, y comparando".
//
// Funciona en tres tiempos:
//   1. Detectar. Tras cada respuesta del agente se mira lo que vino después: si el
//      cliente reaccionó molesto (frustration) o si una persona del equipo entró
//      justo detrás y contestó distinto a lo mismo (human_correction). La IA
//      compara la respuesta del agente con esa reacción y, si no fue la adecuada,
//      redacta la lección.
//   2. Comparar. La lección nueva se contrasta con las que ya existen: si dice lo
//      mismo que una, suma evidencia a esa; si no, abre una nueva, sugerida.
//   3. Aplicar. Las lecciones activas van en el prompt de todos los agentes. Una
//      sugerida se activa sola cuando se repite en otra conversación (ya no es un
//      caso aislado), o la activa el equipo a mano desde Aprendizajes.
//
// Las funciones puras (qué par de mensajes se evalúa, cuándo se activa una
// lección) van separadas de las que tocan la base, para probarlas directo.
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  agentLessonsTable,
  agentFeedbackTable,
  conversationsTable,
  messagesTable,
  contactsTable,
  type AgentLesson,
  type AgentLessonStatus,
} from "@workspace/db";
import type { Log } from "./messaging";
import { reviewAgentReply, type ReplyReviewSignal } from "./openai-client";
import { isModuleEnabled } from "./client-config";
import { historyContent } from "./media";
import { formatShort } from "./time";

// Una lección que se repite en tantas conversaciones distintas deja de ser un
// caso aislado y el agente la empieza a aplicar sin esperar al equipo.
export const LESSON_AUTO_ACTIVATE_CONVERSATIONS = 2;
// Tope de lecciones en el prompt: las más repetidas primero. Más que esto diluye
// las instrucciones del negocio, que son las que mandan.
export const MAX_PROMPT_LESSONS = 12;
// Una reacción que llega más tarde que esto ya no es una reacción a esa respuesta.
const REACTION_WINDOW_MS = 24 * 60 * 60 * 1000;
// Una persona que escribe más tarde que esto no está corrigiendo al agente: está
// retomando el chat.
const CORRECTION_WINDOW_MS = 60 * 60 * 1000;

type Row = Pick<typeof messagesTable.$inferSelect, "id" | "sender" | "type" | "content" | "mediaName" | "createdAt">;

export const LESSON_SIGNAL_LABELS: Record<ReplyReviewSignal, string> = {
  frustration: "El cliente se frustró",
  human_correction: "Una persona corrigió al agente",
};

/**
 * La respuesta del agente virtual que hay que revisar a la luz de `reactionId`:
 * el último mensaje del bot justo antes de la reacción, sin otro mensaje del
 * equipo en medio. Para una frustración, entre medias solo puede haber más
 * mensajes del cliente ("??", "hola??"); para una corrección, el mensaje de la
 * persona tiene que venir directamente después del bot o tras lo que contestó el
 * cliente. Null si no hay nada que revisar.
 */
export function pickReviewPair(
  rows: Row[],
  reactionId: number,
  signal: ReplyReviewSignal,
): { bot: Row; reaction: Row } | null {
  const index = rows.findIndex((m) => m.id === reactionId);
  if (index <= 0) return null;
  const reaction = rows[index];
  if (signal === "frustration" && reaction.sender !== "contact") return null;
  if (signal === "human_correction" && reaction.sender !== "agent") return null;

  for (let i = index - 1; i >= 0; i -= 1) {
    const m = rows[i];
    if (m.sender === "bot") return { bot: m, reaction };
    // Otra persona del equipo ya había contestado: la reacción es a ella, no al bot.
    if (m.sender === "agent") return null;
  }
  return null;
}

/** Si una lección pasa a activa sola, con las conversaciones distintas en que ya se vio. */
export function shouldAutoActivate(status: AgentLessonStatus, conversations: number): boolean {
  return status === "suggested" && conversations >= LESSON_AUTO_ACTIVATE_CONVERSATIONS;
}

function transcriptOf(rows: Row[]): string {
  return rows
    .map((m) => {
      const who = m.sender === "contact" ? "Cliente" : m.sender === "bot" ? "Agente IA" : "Agente (persona)";
      return `[${formatShort(m.createdAt)}] ${who}: ${historyContent(m)}`;
    })
    .join("\n");
}

async function note(conversationId: number, content: string): Promise<void> {
  await db.insert(messagesTable).values({
    conversationId,
    sender: "bot",
    content,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });
}

// Lo que la IA necesita para comparar: las lecciones que ya existen, incluidas las
// descartadas (si vuelve a pasar lo mismo, suma ahí y no abre otra igual).
async function knownLessons(): Promise<Array<{ id: number; lesson: string }>> {
  return db
    .select({ id: agentLessonsTable.id, lesson: agentLessonsTable.lesson })
    .from(agentLessonsTable)
    .orderBy(desc(agentLessonsTable.lastSeenAt))
    .limit(60);
}

const inFlight = new Set<number>();

async function reviewAfter(
  conversationId: number,
  reactionMessageId: number,
  signal: ReplyReviewSignal,
  log: Log,
): Promise<void> {
  if (!isModuleEnabled("aiAgents")) return;
  if (inFlight.has(reactionMessageId)) return;
  inFlight.add(reactionMessageId);
  try {
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
    if (!conv) return;
    const [reactionRow] = await db
      .select({ createdAt: messagesTable.createdAt })
      .from(messagesTable)
      .where(eq(messagesTable.id, reactionMessageId));
    if (!reactionRow) return;

    // El tramo del chat que lleva a la reacción: basta con los últimos mensajes.
    const rows = (
      await db
        .select({
          id: messagesTable.id,
          sender: messagesTable.sender,
          type: messagesTable.type,
          content: messagesTable.content,
          mediaName: messagesTable.mediaName,
          createdAt: messagesTable.createdAt,
        })
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.conversationId, conversationId),
            eq(messagesTable.isInternal, false),
            lte(messagesTable.createdAt, reactionRow.createdAt),
            gte(messagesTable.createdAt, new Date(reactionRow.createdAt.getTime() - REACTION_WINDOW_MS)),
          ),
        )
        .orderBy(desc(messagesTable.createdAt))
        .limit(14)
    ).reverse();

    const pair = pickReviewPair(rows, reactionMessageId, signal);
    if (!pair) return;
    const gap = pair.reaction.createdAt.getTime() - pair.bot.createdAt.getTime();
    if (gap > (signal === "human_correction" ? CORRECTION_WINDOW_MS : REACTION_WINDOW_MS)) return;

    // Una misma respuesta del bot se aprende una vez: el segundo "??" del cliente
    // no es otra lección.
    const [already] = await db
      .select({ id: agentFeedbackTable.id })
      .from(agentFeedbackTable)
      .where(eq(agentFeedbackTable.botMessageId, pair.bot.id))
      .limit(1);
    if (already) return;

    const lessons = await knownLessons();
    const review = await reviewAgentReply({ transcript: transcriptOf(rows), signal, lessons });
    if (!review?.flagged || !review.lesson) return;

    let lessonId = review.matchesLessonId;
    if (lessonId == null) {
      const [created] = await db
        .insert(agentLessonsTable)
        .values({ lesson: review.lesson, diagnosis: review.diagnosis, status: "suggested", occurrences: 1 })
        .returning({ id: agentLessonsTable.id });
      lessonId = created.id;
    }

    const [feedback] = await db
      .insert(agentFeedbackTable)
      .values({
        lessonId,
        conversationId,
        contactId: conv.contactId,
        agentId: conv.agentId,
        signal,
        botMessageId: pair.bot.id,
        reactionMessageId,
        severity: review.severity,
        aiReply: historyContent(pair.bot).slice(0, 2000),
        reaction: historyContent(pair.reaction).slice(0, 2000),
        diagnosis: review.diagnosis,
      })
      .onConflictDoNothing({ target: agentFeedbackTable.reactionMessageId })
      .returning({ id: agentFeedbackTable.id });
    if (!feedback) return;

    const activated = await refreshLessonCount(lessonId);

    const what = signal === "frustration" ? "El cliente reaccionó molesto a la respuesta del agente virtual" : "Una persona corrigió la respuesta del agente virtual";
    await note(
      conversationId,
      `🧠 ${what}${review.diagnosis ? `: ${review.diagnosis.replace(/[.\s]+$/, "")}` : ""}. Quedó en Aprendizajes${activated ? " y los agentes ya la aplican" : " como sugerencia"}.`,
    );
    log.info({ conversationId, lessonId, signal, severity: review.severity, activated }, "agent lesson recorded");
  } catch (err) {
    log.error({ err, conversationId, reactionMessageId, signal }, "agent learning failed");
  } finally {
    inFlight.delete(reactionMessageId);
  }
}

// Recuenta en cuántas conversaciones distintas se vio la lección y la activa si
// ya toca. Devuelve true si quedó activa en esta pasada.
async function refreshLessonCount(lessonId: number): Promise<boolean> {
  const [{ conversations }] = await db
    .select({ conversations: sql<number>`count(distinct ${agentFeedbackTable.conversationId})::int` })
    .from(agentFeedbackTable)
    .where(eq(agentFeedbackTable.lessonId, lessonId));
  const [lesson] = await db.select().from(agentLessonsTable).where(eq(agentLessonsTable.id, lessonId));
  if (!lesson) return false;
  const activate = shouldAutoActivate(lesson.status, conversations);
  await db
    .update(agentLessonsTable)
    .set({
      occurrences: Math.max(conversations, 1),
      lastSeenAt: new Date(),
      updatedAt: new Date(),
      ...(activate ? { status: "active" as const } : {}),
    })
    .where(eq(agentLessonsTable.id, lessonId));
  return activate;
}

/** El cliente acaba de escribir: ¿le molestó la última respuesta del agente? Fire-and-forget. */
export function learnFromCustomerReaction(conversationId: number, customerMessageId: number, log: Log): void {
  void reviewAfter(conversationId, customerMessageId, "frustration", log);
}

/** Una persona del equipo acaba de escribir: ¿estaba corrigiendo al agente? Fire-and-forget. */
export function learnFromHumanCorrection(conversationId: number, agentMessageId: number, log: Log): void {
  void reviewAfter(conversationId, agentMessageId, "human_correction", log);
}

/** Las lecciones que el agente lee en su prompt: las activas, las más repetidas primero. */
export async function activeLessonsForPrompt(): Promise<string[]> {
  if (!isModuleEnabled("aiAgents")) return [];
  const rows = await db
    .select({ lesson: agentLessonsTable.lesson })
    .from(agentLessonsTable)
    .where(eq(agentLessonsTable.status, "active"))
    .orderBy(desc(agentLessonsTable.occurrences), desc(agentLessonsTable.lastSeenAt))
    .limit(MAX_PROMPT_LESSONS);
  return rows.map((r) => r.lesson);
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export type LessonEvidence = {
  id: number;
  signal: ReplyReviewSignal;
  severity: string;
  conversationId: number;
  contactName: string | null;
  aiReply: string;
  reaction: string;
  diagnosis: string | null;
  createdAt: Date;
};

export type LessonWithEvidence = AgentLesson & { evidence: LessonEvidence[] };

const EVIDENCE_PER_LESSON = 5;

export async function listLessons(filter: { status?: AgentLessonStatus; id?: number } = {}): Promise<LessonWithEvidence[]> {
  const lessons = await db
    .select()
    .from(agentLessonsTable)
    .where(
      and(
        ...(filter.status ? [eq(agentLessonsTable.status, filter.status)] : []),
        ...(filter.id != null ? [eq(agentLessonsTable.id, filter.id)] : []),
      ),
    )
    .orderBy(desc(agentLessonsTable.lastSeenAt))
    .limit(200);
  if (!lessons.length) return [];

  const feedback = await db
    .select({
      id: agentFeedbackTable.id,
      lessonId: agentFeedbackTable.lessonId,
      signal: agentFeedbackTable.signal,
      severity: agentFeedbackTable.severity,
      conversationId: agentFeedbackTable.conversationId,
      contactName: contactsTable.name,
      aiReply: agentFeedbackTable.aiReply,
      reaction: agentFeedbackTable.reaction,
      diagnosis: agentFeedbackTable.diagnosis,
      createdAt: agentFeedbackTable.createdAt,
    })
    .from(agentFeedbackTable)
    .leftJoin(contactsTable, eq(contactsTable.id, agentFeedbackTable.contactId))
    .where(inArray(agentFeedbackTable.lessonId, lessons.map((l) => l.id)))
    .orderBy(desc(agentFeedbackTable.createdAt));

  const byLesson = new Map<number, LessonEvidence[]>();
  for (const f of feedback) {
    if (f.lessonId == null) continue;
    const list = byLesson.get(f.lessonId) ?? [];
    if (list.length >= EVIDENCE_PER_LESSON) continue;
    list.push({ ...f, signal: f.signal as ReplyReviewSignal });
    byLesson.set(f.lessonId, list);
  }
  return lessons.map((l) => ({ ...l, evidence: byLesson.get(l.id) ?? [] }));
}

export async function updateLesson(
  id: number,
  patch: { status?: AgentLessonStatus; lesson?: string },
): Promise<LessonWithEvidence | null> {
  const text = patch.lesson?.trim();
  const [updated] = await db
    .update(agentLessonsTable)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(text ? { lesson: text } : {}),
      updatedAt: new Date(),
    })
    .where(eq(agentLessonsTable.id, id))
    .returning();
  if (!updated) return null;
  const [withEvidence] = await listLessons({ id });
  return withEvidence ?? { ...updated, evidence: [] };
}
