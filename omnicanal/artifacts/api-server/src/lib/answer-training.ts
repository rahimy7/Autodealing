import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  db,
  answerReviewsTable,
  agentsTable,
  capabilitiesTable,
  knowledgeBasesTable,
  messagesTable,
  productsTable,
  type AnswerReview,
  type AnswerPreview,
  type ExchangeRate,
} from "@workspace/db";
import {
  APPOINTMENT_DIRECTIVE,
  ECHOED_TIMESTAMP,
  IMAGE_DIRECTIVE,
  OPTIONS_DIRECTIVE,
  PHOTO_DIRECTIVE,
  PROACTIVE_PROFILES,
  buildSystemPrompt,
  getOpenAIClient,
  parseOptionButtons,
} from "./openai-client";
import { exchangeRatePromptBlock, getTodayRatesForAgent, replacePesosDirectives } from "./exchange-rates";
import { activeLessonsForPrompt } from "./agent-learning";
import { clientConfig, isModuleEnabled } from "./client-config";
import { formatShort } from "./time";
import { logger } from "./logger";

// Entrenar respuestas (2026-10-15). El equipo ve las preguntas comunes de los
// clientes con la respuesta que da hoy el agente virtual, le escribe
// indicaciones, la IA rehace la respuesta con ellas y, al aprobarla, redacta la
// instrucción que desde entonces leen los agentes en su prompt (bloque
// "RESPUESTAS APROBADAS POR EL EQUIPO" de buildSystemPrompt).
//
// La respuesta "de hoy" es una prueba en seco: el mismo prompt que arma el chat
// para ese agente (instrucciones, base de conocimiento, tasa del día,
// aprendizajes y respuestas ya aprobadas), sin conversación, sin cliente y sin
// enviar nada a nadie.

// Tope de respuestas aprobadas en el prompt, las más recientes primero.
export const MAX_PROMPT_GUIDES = 60;
// Una pregunta que lleva más que esto "generando" quedó colgada (se reinició el
// servidor a media cola): se da por libre.
const STALE_GENERATION_MS = 10 * 60_000;

export class AnswerTrainingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// ── Preguntas ────────────────────────────────────────────────────────────────

/** La pregunta reducida a lo que la distingue: sin tildes, signos ni mayúsculas. */
export function normalizeQuestionKey(question: string): string {
  return question
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Las preguntas de una base de conocimiento con formato de preguntas frecuentes:
 * `## Categoría` y luego `**¿Pregunta?**` con su respuesta debajo (el formato de
 * scripts/catalog-docs.ts y del editor de preguntas del panel). catalog-docs corta
 * las líneas a 80 columnas, así que una pregunta larga puede ocupar dos.
 */
export function parseKnowledgeQuestions(content: string): Array<{ question: string; category: string | null }> {
  const out: Array<{ question: string; category: string | null }> = [];
  const lines = content.split("\n");
  let category: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      category = heading[1];
      continue;
    }
    if (!line.startsWith("**")) continue;
    const rest = line.slice(2);
    const close = rest.indexOf("**");
    let text: string;
    if (close === rest.length - 2 && close > 0) {
      text = rest.slice(0, close);
    } else if (close === -1) {
      // La negrita sigue en la línea de abajo (como mucho dos más).
      const parts = [rest];
      let j = i + 1;
      for (; j < lines.length && j <= i + 2; j++) {
        const next = lines[j].trim();
        if (next.endsWith("**")) {
          parts.push(next.slice(0, -2));
          break;
        }
        parts.push(next);
      }
      if (j > i + 2 || j >= lines.length) continue;
      text = parts.join(" ");
      i = j;
    } else {
      // "**Nota:** texto": negrita dentro de una línea, no una pregunta.
      continue;
    }
    const question = text.replace(/\s+/g, " ").trim();
    if (question.includes("?")) out.push({ question, category });
  }
  return out;
}

// El agente con el que se prueba una pregunta nueva: el de ventas, que es el que
// atiende a quien pregunta para comprar; si no hay, el primer agente virtual que
// contesta chats (los proactivos solo escriben desde un seguimiento).
async function respondingAgents() {
  const rows = await db
    .select({ id: agentsTable.id, name: agentsTable.name, profileType: agentsTable.profileType })
    .from(agentsTable)
    .where(and(eq(agentsTable.type, "virtual"), eq(agentsTable.isActive, true)))
    .orderBy(asc(agentsTable.id));
  return rows.filter((a) => !PROACTIVE_PROFILES.has(a.profileType ?? ""));
}

async function defaultAgentId(): Promise<number | null> {
  const agents = await respondingAgents();
  return (agents.find((a) => a.profileType === "sales") ?? agents[0])?.id ?? null;
}

async function insertQuestions(
  items: Array<{ question: string; category: string | null; frequency?: number | null }>,
  source: "knowledge" | "chats" | "manual",
): Promise<AnswerReview[]> {
  const agentId = await defaultAgentId();
  const seen = new Set<string>();
  const values = items
    .map((q) => ({ ...q, question: q.question.trim(), questionKey: normalizeQuestionKey(q.question) }))
    .filter((q) => q.questionKey && !seen.has(q.questionKey) && seen.add(q.questionKey))
    .map((q) => ({
      question: q.question,
      questionKey: q.questionKey,
      category: q.category?.trim() || null,
      frequency: q.frequency ?? null,
      source,
      agentId,
    }));
  if (!values.length) return [];
  return db.insert(answerReviewsTable).values(values).onConflictDoNothing({ target: answerReviewsTable.questionKey }).returning();
}

/** Trae a la lista las preguntas de las bases de conocimiento que leen los agentes virtuales. */
export async function importKnowledgeQuestions(): Promise<{ added: number; found: number }> {
  const linked = await db
    .selectDistinct({ id: capabilitiesTable.knowledgeBaseId })
    .from(capabilitiesTable)
    .innerJoin(agentsTable, eq(agentsTable.id, capabilitiesTable.agentId))
    .where(and(eq(agentsTable.type, "virtual"), isNotNull(capabilitiesTable.knowledgeBaseId)));
  const ids = linked.map((r) => r.id).filter((id): id is number => id != null);
  const kbs = ids.length
    ? await db.select().from(knowledgeBasesTable).where(inArray(knowledgeBasesTable.id, ids))
    : await db.select().from(knowledgeBasesTable);
  const questions = kbs.flatMap((kb) => parseKnowledgeQuestions(kb.content ?? ""));
  const added = await insertQuestions(questions, "knowledge");
  return { added: added.length, found: questions.length };
}

// Lo que los clientes escribieron en los chats, para que la IA saque las
// preguntas que más se repiten. Mensajes de texto del cliente, sin notas
// internas, deduplicados y recortados: es un muestreo, no un conteo exacto.
const CHAT_SAMPLE_MESSAGES = 1200;

/** Detecta con la IA las preguntas que más se repiten en los chats de los últimos `days` días. */
export async function detectChatQuestions(days = 30): Promise<{ added: number; found: number; scanned: number }> {
  const client = getOpenAIClient();
  if (!client) throw new AnswerTrainingError("La IA no está configurada en este servidor.", 503);
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);
  const rows = await db
    .select({ content: messagesTable.content })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sender, "contact"),
        eq(messagesTable.isInternal, false),
        eq(messagesTable.type, "text"),
        gte(messagesTable.createdAt, since),
      ),
    )
    .orderBy(desc(messagesTable.createdAt))
    .limit(CHAT_SAMPLE_MESSAGES * 3);

  const seen = new Set<string>();
  const sample: string[] = [];
  for (const r of rows) {
    const text = (r.content ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 8) continue;
    const key = normalizeQuestionKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sample.push(text.slice(0, 200));
    if (sample.length >= CHAT_SAMPLE_MESSAGES) break;
  }
  if (!sample.length) return { added: 0, found: 0, scanned: 0 };

  const existing = await db.select({ question: answerReviewsTable.question }).from(answerReviewsTable);
  const system =
    "Analizas los mensajes que los clientes le escriben a un negocio por WhatsApp, Instagram y Facebook para encontrar las preguntas que más se repiten. " +
    "Devuelve ÚNICAMENTE un objeto JSON (sin texto adicional) con la clave 'questions': una lista de hasta 25 objetos {question, category, count}, de la más repetida a la menos. " +
    "'question' = la pregunta tal como la haría un cliente cualquiera, en español, clara y terminada en '?', sin nombres, teléfonos, direcciones ni números de pedido. " +
    "'category' = 2-4 palabras que agrupen el tema (por ejemplo: Precios, Envíos, Formas de pago, Uso del producto). " +
    "'count' = cuántos de los mensajes hacen esa misma pregunta, aproximado. " +
    "Agrupa las que preguntan lo mismo con otras palabras. Deja fuera saludos, agradecimientos, datos sueltos (nombres, direcciones), comprobantes y reclamos de un pedido concreto: solo preguntas que cualquier cliente podría hacer. " +
    (existing.length
      ? `Estas ya están en la lista; no las repitas ni devuelvas otras equivalentes: ${existing.map((e) => `«${e.question}»`).join(" ")}`
      : "");
  const completion = await client.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 16_000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Mensajes de clientes (uno por línea):\n${sample.join("\n")}` },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new AnswerTrainingError("La IA no devolvió preguntas; vuelve a intentarlo.", 502);
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new AnswerTrainingError("La IA no devolvió preguntas; vuelve a intentarlo.", 502);
  }
  const list = Array.isArray((parsed as { questions?: unknown }).questions) ? (parsed as { questions: unknown[] }).questions : [];
  const questions = list
    .map((q) => q as { question?: unknown; category?: unknown; count?: unknown })
    .filter((q) => typeof q.question === "string" && q.question.trim())
    .map((q) => ({
      question: String(q.question).trim(),
      category: typeof q.category === "string" ? q.category : null,
      frequency: Number.isFinite(Number(q.count)) ? Math.max(1, Math.round(Number(q.count))) : null,
    }));
  const added = await insertQuestions(questions, "chats");
  return { added: added.length, found: questions.length, scanned: sample.length };
}

/** Una pregunta escrita a mano por el equipo. */
export async function addQuestion(input: { question: string; category?: string | null }): Promise<AnswerReview> {
  const [row] = await insertQuestions([{ question: input.question, category: input.category ?? null }], "manual");
  if (!row) throw new AnswerTrainingError("Esa pregunta ya está en la lista.", 409);
  return row;
}

// ── La respuesta del agente ──────────────────────────────────────────────────

/** El texto que le llegaría al cliente: sin marcas, con los pesos ya calculados. */
export function answerText(raw: string, rates: ExchangeRate[] | null): string {
  return replacePesosDirectives(raw, rates)
    .replace(PHOTO_DIRECTIVE, "")
    .replace(IMAGE_DIRECTIVE, "")
    .replace(ECHOED_TIMESTAMP, "")
    .replace(OPTIONS_DIRECTIVE, "")
    .replace(APPOINTMENT_DIRECTIVE, "")
    .replace(/ESCALAR_A_HUMANO|PEDIDO_CONFIRMADO/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cómo vería el cliente la respuesta: el texto, las imágenes y fotos que la acompañan y los botones. */
export async function buildAnswerPreview(raw: string, rates: ExchangeRate[] | null): Promise<AnswerPreview> {
  const imageKeys = [...new Set([...raw.matchAll(IMAGE_DIRECTIVE)].map((m) => m[1].toLowerCase()))];
  const photoSlugs = [...new Set([...raw.matchAll(PHOTO_DIRECTIVE)].map((m) => m[1].toLowerCase()))];
  const products = photoSlugs.length
    ? await db
        .select({ slug: productsTable.slug, name: productsTable.name, imageUrl: productsTable.imageUrl })
        .from(productsTable)
        .where(inArray(productsTable.slug, photoSlugs))
    : [];
  return {
    text: answerText(raw, rates),
    images: imageKeys.flatMap((key) => {
      const image = clientConfig.business.agentImages[key];
      return image ? [{ key, url: image.url, caption: image.caption }] : [];
    }),
    photos: products.map((p) => ({ slug: p.slug, name: p.name, imageUrl: p.imageUrl })),
    options: parseOptionButtons(raw).map((o) => o.label),
    escalates: /ESCALAR_A_HUMANO/i.test(raw),
  };
}

// Lo que el equipo pidió para esta respuesta. Va como mensaje de sistema después
// de la pregunta, que es donde el chat pone las instrucciones del turno.
export function indicationsInstruction(indications: string, previousAnswer: string | null): string {
  return [
    "INDICACIONES DEL EQUIPO PARA ESTA RESPUESTA: el equipo revisó cómo respondes esta pregunta y te pide lo siguiente. Síguelo al pie de la letra aunque cambie lo que dicen tus instrucciones de arriba, y no menciones que te lo pidieron:",
    indications.trim(),
    previousAnswer?.trim()
      ? `Tu respuesta anterior fue esta:\n«${previousAnswer.trim()}»\nEscribe la respuesta corregida completa, tal como la recibiría el cliente (no expliques los cambios).`
      : "Escribe tu respuesta tal como la recibiría el cliente.",
  ].join("\n");
}

// El agente con sus capacidades y bases de conocimiento, como lo arma el chat
// (agentConversationPrompt en messaging.ts; collectAgentContext en feed.ts hace
// lo mismo, pero importarlo cerraría un ciclo messaging → aquí → feed → messaging).
async function agentContext(agentId: number) {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) return null;
  const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.agentId, agentId));
  const kbIds = [...new Set(caps.map((c) => c.knowledgeBaseId).filter((x): x is number => x != null))];
  const kbs = kbIds.length ? await db.select().from(knowledgeBasesTable).where(inArray(knowledgeBasesTable.id, kbIds)) : [];
  return { agent, caps, kbs };
}

async function askAgent(
  agentId: number,
  question: string,
  indications: { text: string; previousAnswer: string | null } | null,
): Promise<{ raw: string; preview: AnswerPreview }> {
  const client = getOpenAIClient();
  if (!client) throw new AnswerTrainingError("La IA no está configurada en este servidor.", 503);
  const ctx = await agentContext(agentId);
  if (!ctx) throw new AnswerTrainingError("Ese agente ya no existe; elige otro.", 404);

  const rates = await getTodayRatesForAgent();
  const [lessons, guides] = await Promise.all([activeLessonsForPrompt(), activeAnswerGuidesForPrompt()]);
  const now = new Date();
  const system = buildSystemPrompt({
    agentName: ctx.agent.name,
    profileType: ctx.agent.profileType,
    customPrompt: ctx.agent.systemPrompt,
    capabilities: ctx.caps.map((c) => ({
      name: c.name,
      description: c.description,
      category: c.category,
      examples: c.examples,
      level: c.level,
    })),
    knowledge: ctx.kbs.filter((k) => k.content?.trim()).map((k) => ({ name: k.name, content: k.content })),
    // Una conversación nueva por WhatsApp, sin número: el agente no sabe de dónde
    // escribe, como con quien pregunta por primera vez desde Instagram.
    session: { now, startedAt: now, isNew: true },
    exchangeRate: rates ? exchangeRatePromptBlock(rates) : null,
    channel: "whatsapp",
    phone: null,
    lessons,
    guides,
  });
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: system },
    { role: "user", content: `[${formatShort(now)}] ${question}` },
  ];
  if (indications?.text.trim()) {
    messages.push({ role: "system", content: indicationsInstruction(indications.text, indications.previousAnswer) });
  }

  const completion = await client.chat.completions.create({
    model: ctx.agent.model || "gpt-5-mini",
    max_completion_tokens: 8192,
    messages,
  });
  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) throw new AnswerTrainingError("El agente no devolvió respuesta; vuelve a intentarlo.", 502);
  return { raw, preview: await buildAnswerPreview(raw, rates) };
}

async function getReview(id: number): Promise<AnswerReview> {
  const [row] = await db.select().from(answerReviewsTable).where(eq(answerReviewsTable.id, id));
  if (!row) throw new AnswerTrainingError("Esa pregunta ya no existe.", 404);
  return row;
}

async function requireAgentFor(row: AnswerReview): Promise<number> {
  const agentId = row.agentId ?? (await defaultAgentId());
  if (!agentId) throw new AnswerTrainingError("No hay agentes virtuales activos con los que probar.", 409);
  return agentId;
}

async function saveAnswer(row: AnswerReview, agentId: number, result: { raw: string; preview: AnswerPreview }) {
  const [updated] = await db
    .update(answerReviewsTable)
    .set({
      agentId,
      answer: result.raw,
      preview: result.preview,
      answeredAt: new Date(),
      generating: false,
      generationError: null,
      status: row.status === "dismissed" ? "dismissed" : "review",
      updatedAt: new Date(),
    })
    .where(eq(answerReviewsTable.id, row.id))
    .returning();
  return updated;
}

/** La respuesta que da hoy el agente, sin indicaciones. */
export async function regenerateAnswer(id: number): Promise<AnswerReview> {
  const row = await getReview(id);
  const agentId = await requireAgentFor(row);
  return saveAnswer(row, agentId, await askAgent(agentId, row.question, null));
}

/** "Procesar": guarda las indicaciones (si vienen) y rehace la respuesta con ellas. */
export async function processAnswer(id: number, indications?: string | null): Promise<AnswerReview> {
  let row = await getReview(id);
  if (indications !== undefined) {
    [row] = await db
      .update(answerReviewsTable)
      .set({ indications: indications?.trim() || null, updatedAt: new Date() })
      .where(eq(answerReviewsTable.id, id))
      .returning();
  }
  const agentId = await requireAgentFor(row);
  const text = row.indications?.trim() ?? "";
  const result = await askAgent(agentId, row.question, text ? { text, previousAnswer: row.answer } : null);
  return saveAnswer(row, agentId, result);
}

// Una sola cola a la vez: el botón "Generar las que faltan" no debería lanzar dos.
let pendingRun: Promise<void> | null = null;

/** Pone en cola las preguntas sin respuesta y las va generando en segundo plano. */
export async function generatePendingAnswers(): Promise<{ queued: number }> {
  if (pendingRun) return { queued: 0 };
  const staleBefore = new Date(Date.now() - STALE_GENERATION_MS);
  await db
    .update(answerReviewsTable)
    .set({ generating: false })
    .where(and(eq(answerReviewsTable.generating, true), lt(answerReviewsTable.updatedAt, staleBefore)));
  const queued = await db
    .update(answerReviewsTable)
    .set({ generating: true, generationError: null, updatedAt: new Date() })
    .where(and(eq(answerReviewsTable.status, "pending"), eq(answerReviewsTable.generating, false)))
    .returning({ id: answerReviewsTable.id });
  if (!queued.length) return { queued: 0 };

  const ids = queued.map((q) => q.id);
  pendingRun = (async () => {
    // De dos en dos: cada respuesta tarda unos segundos y no hace falta más.
    for (let i = 0; i < ids.length; i += 2) {
      await Promise.all(
        ids.slice(i, i + 2).map(async (id) => {
          try {
            await regenerateAnswer(id);
          } catch (err) {
            logger.warn({ err, answerReviewId: id }, "answer training: generation failed");
            await db
              .update(answerReviewsTable)
              .set({ generating: false, generationError: err instanceof Error ? err.message : "No se pudo generar.", updatedAt: new Date() })
              .where(eq(answerReviewsTable.id, id));
          }
        }),
      );
    }
  })().finally(() => {
    pendingRun = null;
  });
  return { queued: ids.length };
}

// ── Aprobar ──────────────────────────────────────────────────────────────────

/**
 * La instrucción que leerán los agentes, redactada por la IA a partir de la
 * pregunta, lo que pidió el equipo y la respuesta que aprobó. Sin IA, la
 * respuesta aprobada como modelo.
 */
export async function draftInstruction(input: { question: string; indications: string | null; answer: string }): Promise<string> {
  const fallback = `Responde con este texto: «${input.answer.trim()}»`;
  const client = getOpenAIClient();
  if (!client) return fallback;
  const system =
    "Redactas instrucciones para un agente virtual de atención al cliente. El equipo revisó cómo responde una pregunta, le dio indicaciones y aprobó la respuesta final. " +
    "Escribe la instrucción que el agente leerá en su prompt para responder así de ahora en adelante. Devuelve ÚNICAMENTE un objeto JSON (sin texto adicional) con la clave 'instruction'. " +
    "La instrucción: en español, en imperativo, de 1 a 3 frases, máximo 700 caracteres. " +
    "El sistema ya la antepone con 'Si preguntan «la pregunta» (o algo equivalente):', así que no digas de qué trata la pregunta ni la amplíes a otros temas ('responde a preguntas sobre envíos' está mal). " +
    "Di solo lo que piden las indicaciones del equipo (qué decir, qué no decir, cómo empezar o terminar) y cierra con la respuesta aprobada como modelo entre « ». No agregues reglas que el equipo no pidió (tono cordial, ser conciso, revisar datos). " +
    "Si las indicaciones piden un texto exacto, di que se responda con ese texto tal cual; si no, preséntala como modelo de contenido y tono, que se adapta si el cliente ya dio datos que la cambian. " +
    "Si la respuesta aprobada trae marcas entre dobles corchetes ([[IMAGEN:…]], [[FOTO:…]], [[PESOS:…]], [[OPCIONES:…]]) o ESCALAR_A_HUMANO, déjalas dentro del texto modelo tal cual, sin comentarlas; si no trae ninguna, no las menciones.";
  const user = [
    `Pregunta: ${input.question}`,
    `Indicaciones del equipo: ${input.indications?.trim() || "(ninguna: el equipo aprobó la respuesta tal como salió)"}`,
    `Respuesta aprobada:\n${input.answer.trim()}`,
  ].join("\n");
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]) as { instruction?: unknown };
    const instruction = typeof parsed.instruction === "string" ? parsed.instruction.trim() : "";
    return instruction || fallback;
  } catch (err) {
    logger.warn({ err }, "answer training: instruction draft failed, using the approved answer as is");
    return fallback;
  }
}

/** "Aprobar": la IA redacta la instrucción y los agentes la empiezan a leer. */
export async function approveAnswer(id: number, approvedById: number | null): Promise<AnswerReview> {
  const row = await getReview(id);
  if (!row.answer?.trim()) throw new AnswerTrainingError("Primero genera la respuesta del agente.", 409);
  const instruction = await draftInstruction({ question: row.question, indications: row.indications, answer: row.answer });
  const [updated] = await db
    .update(answerReviewsTable)
    .set({
      instruction,
      approvedAnswer: row.answer,
      active: true,
      status: "approved",
      approvedById,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(answerReviewsTable.id, id))
    .returning();
  return updated;
}

/** Las respuestas aprobadas que leen los agentes, las más recientes primero. */
export async function activeAnswerGuidesForPrompt(): Promise<Array<{ question: string; instruction: string }>> {
  if (!isModuleEnabled("aiAgents")) return [];
  const rows = await db
    .select({ question: answerReviewsTable.question, instruction: answerReviewsTable.instruction })
    .from(answerReviewsTable)
    .where(and(eq(answerReviewsTable.active, true), isNotNull(answerReviewsTable.instruction)))
    .orderBy(desc(answerReviewsTable.approvedAt))
    .limit(MAX_PROMPT_GUIDES);
  return rows.filter((r) => r.instruction?.trim()).map((r) => ({ question: r.question, instruction: r.instruction!.trim() }));
}

// ── Lista y edición ──────────────────────────────────────────────────────────

export async function listAnswerReviews() {
  const staleBefore = Date.now() - STALE_GENERATION_MS;
  const [rows, agents] = await Promise.all([
    db
      .select({ review: answerReviewsTable, approvedByName: agentsTable.name })
      .from(answerReviewsTable)
      .leftJoin(agentsTable, eq(agentsTable.id, answerReviewsTable.approvedById))
      .orderBy(sql`${answerReviewsTable.frequency} desc nulls last`, asc(answerReviewsTable.id)),
    respondingAgents(),
  ]);
  return {
    items: rows.map(({ review, approvedByName }) => ({
      ...review,
      generating: review.generating && review.updatedAt.getTime() > staleBefore,
      approvedByName: approvedByName ?? null,
    })),
    agents: agents.map((a) => ({ id: a.id, name: a.name, profileType: a.profileType ?? null })),
    aiAvailable: getOpenAIClient() != null,
  };
}

export async function updateReview(
  id: number,
  patch: {
    question?: string;
    category?: string | null;
    agentId?: number | null;
    indications?: string | null;
    instruction?: string;
    active?: boolean;
    status?: "pending" | "dismissed";
  },
): Promise<AnswerReview> {
  const row = await getReview(id);
  const set: Partial<typeof answerReviewsTable.$inferInsert> = { updatedAt: new Date() };
  if (patch.question !== undefined) {
    const question = patch.question.trim();
    if (!question) throw new AnswerTrainingError("La pregunta no puede quedar vacía.");
    set.question = question;
    set.questionKey = normalizeQuestionKey(question);
  }
  if (patch.category !== undefined) set.category = patch.category?.trim() || null;
  if (patch.agentId !== undefined) set.agentId = patch.agentId;
  if (patch.indications !== undefined) set.indications = patch.indications?.trim() || null;
  if (patch.instruction !== undefined) {
    if (!row.instruction) throw new AnswerTrainingError("Esta pregunta todavía no tiene instrucción: apruébala primero.", 409);
    if (!patch.instruction.trim()) throw new AnswerTrainingError("La instrucción no puede quedar vacía.");
    set.instruction = patch.instruction.trim();
  }
  if (patch.active !== undefined) {
    if (patch.active && !(set.instruction ?? row.instruction)) {
      throw new AnswerTrainingError("Esta pregunta todavía no tiene instrucción: apruébala primero.", 409);
    }
    set.active = patch.active;
  }
  if (patch.status === "dismissed") {
    set.status = "dismissed";
    set.active = false;
  } else if (patch.status === "pending") {
    // Recuperar una descartada: vuelve a donde estaba su respuesta.
    set.status = row.active ? "approved" : row.answer ? "review" : "pending";
  }
  try {
    const [updated] = await db.update(answerReviewsTable).set(set).where(eq(answerReviewsTable.id, id)).returning();
    return updated;
  } catch (err) {
    if ((err as { cause?: { code?: string } }).cause?.code === "23505" || (err as { code?: string }).code === "23505") {
      throw new AnswerTrainingError("Ya hay otra pregunta igual en la lista.", 409);
    }
    throw err;
  }
}

export async function deleteReview(id: number): Promise<void> {
  const deleted = await db.delete(answerReviewsTable).where(eq(answerReviewsTable.id, id)).returning({ id: answerReviewsTable.id });
  if (!deleted.length) throw new AnswerTrainingError("Esa pregunta ya no existe.", 404);
}
