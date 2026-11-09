import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db, conversationsTable, messagesTable, agentsTable, followupsTable } from "@workspace/db";
import type { Log } from "./messaging";
import { formatDay, humanizeGap } from "./time";
import { isConversationContinuation } from "./openai-client";
import { FOLLOWUP_KIND_LABELS, FOLLOWUP_REPLY_WINDOW_MS } from "./followup-rules";

// The most recent record of what a conversation was about: the live session's
// running summary, else the last folded (dated) history segment.
function lastMatterSummary(contextSummary: string | null, historySummary: string | null): string | null {
  const current = contextSummary?.trim();
  if (current) return current;
  const segments = (historySummary ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const last = segments[segments.length - 1];
  // Strip the "[dd/mm] " date stamp so the classifier sees just the matter.
  return last ? last.replace(/^\[\d{2}\/\d{2}\]\s*/, "") : null;
}

type Conversation = typeof conversationsTable.$inferSelect;

// ── Session window ────────────────────────────────────────────────────────────
// A chat thread with a customer is permanent, but a *conversation* inside it is
// not: once the customer goes quiet for long enough (or the team resolves it) the
// conversation is over. Anything said before that point must not be treated by the
// agent as the thread it is still answering — only as background reference.
// 90 min: con 6 h, un cliente que volvía la misma tarde seguía "dentro" de la
// conversación de la mañana, así que no recibía el mensaje de bienvenida y el
// agente le contestaba como si nunca hubiera parado. Hora y media separa bien un
// ida y vuelta real de una vuelta al rato. Ajustable con CONVERSATION_IDLE_MINUTES.
const DEFAULT_IDLE_MINUTES = 90;

export const SESSION_IDLE_MINUTES = (() => {
  const raw = Number(process.env.CONVERSATION_IDLE_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDLE_MINUTES;
})();

const SESSION_IDLE_MS = SESSION_IDLE_MINUTES * 60_000;

// Human-readable idle window ("6 horas", "45 minutos") for the closure note.
function idleLabel(): string {
  if (SESSION_IDLE_MINUTES % 60 === 0) {
    const hours = SESSION_IDLE_MINUTES / 60;
    return `${hours} ${hours === 1 ? "hora" : "horas"}`;
  }
  return `${SESSION_IDLE_MINUTES} minutos`;
}

// ── Summary folding ───────────────────────────────────────────────────────────
// Closed sessions keep a one-line, date-stamped trace. Bounded so a chat that runs
// for months never grows an unbounded prompt.
const MAX_HISTORY_SEGMENTS = 5;

export function foldSummary(historySummary: string | null, sessionSummary: string | null, closedAt: Date): string | null {
  const current = sessionSummary?.trim();
  if (!current) return historySummary?.trim() || null;
  const segments = (historySummary ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  segments.push(`[${formatDay(closedAt)}] ${current}`);
  return segments.slice(-MAX_HISTORY_SEGMENTS).join("\n");
}

async function lastActivityAt(conversationId: number, fallback: Date): Promise<Date> {
  const [last] = await db
    .select({ createdAt: messagesTable.createdAt })
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(desc(messagesTable.createdAt))
    .limit(1);
  return last?.createdAt ?? fallback;
}

// ── Closing ───────────────────────────────────────────────────────────────────
// Closes the current session: folds its summary into the reference history and
// leaves an audit note in the thread. Idempotent — a session already closed is
// left untouched.
export async function closeConversationSession(
  conversationId: number,
  reason: "inactividad" | "resuelta" | "manual",
  log: Log,
): Promise<boolean> {
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!conv || conv.closedAt) return false;

  const closedAt = new Date();
  await db
    .update(conversationsTable)
    .set({
      closedAt,
      historySummary: foldSummary(conv.historySummary, conv.contextSummary, closedAt),
    })
    .where(eq(conversationsTable.id, conversationId));

  const note =
    reason === "inactividad"
      ? `🔚 Conversación cerrada por inactividad (más de ${idleLabel()} sin respuesta). Lo anterior queda solo como referencia.`
      : reason === "resuelta"
        ? "🔚 Conversación cerrada al resolverse. Lo anterior queda solo como referencia."
        : "🔚 Conversación cerrada. Lo anterior queda solo como referencia.";

  await db.insert(messagesTable).values({
    conversationId,
    sender: "bot",
    content: note,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });

  log.info({ conversationId, reason }, "conversation session closed");
  return true;
}

// ── Opening ───────────────────────────────────────────────────────────────────
// Called on every inbound message, before it is stored. When the previous session
// is closed (or has gone stale), starts a fresh one: the agent assignment, intent
// label and running summary are cleared so the workflow routes the new
// conversation from scratch — the default is a clean start "desde cero".
// EXCEPTION: if a human agent had taken the previous conversation AND the customer
// is picking up that same matter, the chat goes back to that human instead of the
// bot. A greeting or a new topic does not; it starts fresh. `incomingText` is the
// customer's message that triggered the reopen — the basis for that judgment.
// Lo que se limpia al empezar una conversación nueva además de la etiqueta y el
// resumen: la venta y el seguimiento eran de la anterior.
const SESSION_SCOPED_RESET = {
  saleClosedAt: null,
  saleProduct: null,
  saleSource: null,
  saleMarkedByAgentId: null,
  followupId: null,
} as const;

// Reabre la conversación con el agente que le escribió al cliente, si lo que
// llega es la respuesta a un seguimiento reciente (lib/followups.ts). La sesión
// arranca justo antes de ese mensaje para que el agente lo tenga en su historial;
// en una respuesta pendiente arranca donde estaba la consulta sin contestar.
// Devuelve null cuando no hay seguimiento que retomar o su agente ya no está activo.
async function resumeFollowup(conv: Conversation, idleMs: number, log: Log): Promise<Conversation | null> {
  const [followup] = await db
    .select()
    .from(followupsTable)
    .where(
      and(
        eq(followupsTable.conversationId, conv.id),
        eq(followupsTable.status, "sent"),
        gte(followupsTable.sentAt, new Date(Date.now() - FOLLOWUP_REPLY_WINDOW_MS)),
      ),
    )
    .orderBy(desc(followupsTable.sentAt))
    .limit(1);
  if (!followup?.sentAt || !followup.agentId) return null;

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, followup.agentId));
  if (!agent || agent.type !== "virtual" || !agent.isActive) return null;

  if (!conv.closedAt) {
    await closeConversationSession(conv.id, conv.status === "resolved" ? "resuelta" : "inactividad", log);
  }

  const startedAt =
    followup.kind === "unanswered" ? followup.sessionStartedAt : new Date(followup.sentAt.getTime() - 1000);

  await db
    .update(followupsTable)
    .set({ status: "replied", repliedAt: new Date(), updatedAt: new Date() })
    .where(eq(followupsTable.id, followup.id));

  const [reopened] = await db
    .update(conversationsTable)
    .set({
      ...SESSION_SCOPED_RESET,
      sessionStartedAt: startedAt,
      closedAt: null,
      contextSummary: followup.context,
      labelId: null,
      groupId: null,
      agentId: agent.id,
      status: "open",
      followupId: followup.id,
      updatedAt: sql`now()`,
    })
    .where(eq(conversationsTable.id, conv.id))
    .returning();

  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: "bot",
    content: `🆕 Nueva conversación (último contacto ${humanizeGap(idleMs)}): el cliente respondió al seguimiento de ${agent.name} (${FOLLOWUP_KIND_LABELS[followup.kind]}).`,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });

  log.info({ conversationId: conv.id, followupId: followup.id, agentId: agent.id }, "customer replied to a follow-up");
  return reopened;
}

// Cuánto tiempo después del último mensaje de una persona del equipo se entiende
// que lo que escribe el cliente es la respuesta a ese mensaje. El de la ventana de
// WhatsApp: pasado ese día, la persona ya no podía seguir el hilo sin plantilla.
const HUMAN_THREAD_WINDOW_MS = 24 * 60 * 60 * 1000;

// ¿El último mensaje real del chat (antes del que está entrando) lo escribió una
// persona del equipo, y hace menos de un día?
async function customerAnswersHuman(conversationId: number): Promise<boolean> {
  const [last] = await db
    .select({ sender: messagesTable.sender, createdAt: messagesTable.createdAt })
    .from(messagesTable)
    .where(and(eq(messagesTable.conversationId, conversationId), eq(messagesTable.isInternal, false)))
    .orderBy(desc(messagesTable.createdAt))
    .limit(1);
  return last?.sender === "agent" && Date.now() - last.createdAt.getTime() < HUMAN_THREAD_WINDOW_MS;
}

// ── Una persona del equipo escribe ────────────────────────────────────────────
// Quien le escribe al cliente en una conversación ya cerrada (o que se quedó
// quieta más de la ventana) empieza una conversación nueva, y es suya. Antes la
// conversación seguía cerrada con el mensaje de la persona dentro: cuando el
// cliente contestaba, esa respuesta abría OTRA sesión que ya no incluía lo que la
// persona le mandó, y el bot la contestaba desde cero. Pasó el 2026-09-18 dos
// veces: a una clienta le mandaron la guía de UPS, contestó "Gracias" y el bot le
// preguntó "¿en qué puedo ayudarte hoy?"; a otra le mandaron el
// formato del pedido, contestó a qué hora podía recibir y le salió lo mismo.
// La asignación a la persona la hace quien llama (takeOverConversation); aquí
// solo se abre la sesión. Devuelve true si abrió una.
export async function openSessionForTeamMessage(conversationId: number, agentName: string, log: Log): Promise<boolean> {
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!conv) return false;

  const lastAt = await lastActivityAt(conversationId, conv.createdAt);
  const idleMs = Date.now() - lastAt.getTime();
  const wasClosed = conv.closedAt != null || conv.status === "resolved";
  if (!wasClosed && idleMs < SESSION_IDLE_MS) return false;

  if (!conv.closedAt) {
    await closeConversationSession(conversationId, wasClosed ? "resuelta" : "inactividad", log);
  }

  await db
    .update(conversationsTable)
    .set({
      ...SESSION_SCOPED_RESET,
      sessionStartedAt: sql`now()`,
      closedAt: null,
      contextSummary: null,
      labelId: null,
      status: "open",
      updatedAt: sql`now()`,
    })
    .where(eq(conversationsTable.id, conversationId));

  await db.insert(messagesTable).values({
    conversationId,
    sender: "bot",
    content: `🆕 Nueva conversación iniciada por ${agentName} (último contacto ${humanizeGap(idleMs)}).`,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });

  log.info({ conversationId, idleMinutes: Math.round(idleMs / 60_000) }, "team member opened a new session");
  return true;
}

export async function ensureActiveSession(
  conversationId: number,
  incomingText: string | null,
  log: Log,
): Promise<{ conv: Conversation; startedNew: boolean; resumedFollowup: boolean }> {
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!conv) throw new Error(`conversation ${conversationId} not found`);

  const lastAt = await lastActivityAt(conversationId, conv.createdAt);
  const idleMs = Date.now() - lastAt.getTime();
  const wasClosed = conv.closedAt != null || conv.status === "resolved";
  const wentStale = idleMs >= SESSION_IDLE_MS;

  if (!wasClosed && !wentStale) return { conv, startedNew: false, resumedFollowup: false };

  // A conversation with no messages yet has nothing to close — it already *is* the
  // new session, so it only needs its closed/resolved state cleared.
  const [anyMessage] = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .limit(1);
  if (!anyMessage) {
    const [fresh] = await db
      .update(conversationsTable)
      .set({ sessionStartedAt: new Date(), closedAt: null, status: "open" })
      .where(eq(conversationsTable.id, conversationId))
      .returning();
    return { conv: fresh, startedNew: false, resumedFollowup: false };
  }

  // Contesta a un seguimiento nuestro: lo retoma el agente que le escribió, por
  // encima de la regla de volver con el humano, porque es a ese mensaje al que
  // está respondiendo. Salvo que después del seguimiento haya escrito una persona
  // del equipo: entonces le contesta a ella.
  const answersHuman = await customerAnswersHuman(conversationId);
  const resumed = answersHuman ? null : await resumeFollowup(conv, idleMs, log);
  if (resumed) return { conv: resumed, startedNew: true, resumedFollowup: true };

  // What the previous conversation was about — captured before it is folded away —
  // and who was handling it, so we can tell "continues that matter" from "new".
  const previousMatter = lastMatterSummary(conv.contextSummary, conv.historySummary);
  const [owner] = conv.agentId
    ? await db.select().from(agentsTable).where(eq(agentsTable.id, conv.agentId))
    : [null];

  if (!conv.closedAt) {
    await closeConversationSession(conversationId, wasClosed ? "resuelta" : "inactividad", log);
  }

  // Reassign to the human only when the customer is continuing that same matter;
  // otherwise the conversation starts from scratch and the flow routes it.
  // Si lo último que se escribió en el chat lo escribió esa persona, el cliente le
  // está contestando a ella: se queda con ella sin preguntarle a la IA. Pedido el
  // 2026-09-18: a una clienta el equipo le mandó la guía del envío, ella
  // contestó "Gracias", el clasificador leyó un agradecimiento suelto como tema
  // nuevo y el bot le preguntó "¿en qué puedo ayudarte hoy?".
  let keepHuman = false;
  if (owner?.type === "human" && answersHuman) {
    keepHuman = true;
  } else if (owner?.type === "human" && incomingText?.trim() && previousMatter) {
    keepHuman = await isConversationContinuation({ previousSummary: previousMatter, message: incomingText });
  }

  // The session boundary is compared against message timestamps, which Postgres
  // stamps itself — so it has to come off the same clock, not this process's.
  const [reopened] = await db
    .update(conversationsTable)
    .set({
      ...SESSION_SCOPED_RESET,
      sessionStartedAt: sql`now()`,
      closedAt: null,
      contextSummary: null,
      labelId: null,
      // Continuing with the human keeps the chat (and the group that routed them
      // there); otherwise release everything so the flow re-routes from scratch.
      ...(keepHuman ? { status: "pending" } : { groupId: null, agentId: null, status: "open" }),
      updatedAt: sql`now()`,
    })
    .where(eq(conversationsTable.id, conversationId))
    .returning();

  await db.insert(messagesTable).values({
    conversationId,
    sender: "bot",
    content: keepHuman
      ? `🆕 Nueva conversación (último contacto ${humanizeGap(idleMs)}). El cliente retoma el asunto anterior con ${owner!.name}.`
      : `🆕 Nueva conversación (último contacto ${humanizeGap(idleMs)}).`,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });

  log.info(
    { conversationId, idleMinutes: Math.round(idleMs / 60_000), keptHuman: keepHuman },
    "new conversation session started",
  );
  return { conv: reopened, startedNew: true, resumedFollowup: false };
}

// ── Idle sweep ────────────────────────────────────────────────────────────────
// Closes conversations that went quiet, so the panel shows them as finished
// without waiting for the customer to write again. Opening a new session is still
// driven by the next inbound message.
//
// `onClosed` recibe cada conversación que este barrido cerró de verdad: es donde
// el motor de seguimientos decide si le toca recuperación o post-venta. Las que
// se cierran porque el cliente volvió a escribir (ensureActiveSession) no pasan
// por aquí, y está bien: el cliente ya está de vuelta.
export async function sweepIdleConversations(
  log: Log,
  onClosed?: (conversationId: number) => Promise<void>,
): Promise<number> {
  const cutoff = new Date(Date.now() - SESSION_IDLE_MS);
  const stale = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(
      and(
        isNull(conversationsTable.closedAt),
        lt(conversationsTable.updatedAt, cutoff),
        or(
          eq(conversationsTable.status, "open"),
          eq(conversationsTable.status, "pending"),
          eq(conversationsTable.status, "bot"),
        ),
      ),
    );

  let closed = 0;
  for (const row of stale) {
    const lastAt = await lastActivityAt(row.id, cutoff);
    if (Date.now() - lastAt.getTime() < SESSION_IDLE_MS) continue;
    if (await closeConversationSession(row.id, "inactividad", log)) {
      closed += 1;
      if (onClosed) await onClosed(row.id);
    }
  }
  if (closed > 0) log.info({ closed }, "idle conversations closed by sweep");
  return closed;
}
