import OpenAI, { toFile } from "openai";
import { formatDateTime as formatWhen } from "./time";
import { MAX_BUTTON_LABEL, MAX_INTERACTIVE_BUTTONS } from "./meta";
import { clientConfig, isModuleEnabled } from "./client-config";

// Only the key is required: without a base URL it talks to OpenAI directly (the same default the
// site's own assistant uses), so a missing or misspelled address can never leave the AI off.
const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
  if (!baseURL || !apiKey) return null;
  if (!client) client = new OpenAI({ baseURL, apiKey });
  return client;
}

const AUDIO_EXT_BY_MIME: Array<[string, string]> = [
  ["ogg", "ogg"],
  ["opus", "ogg"],
  ["mpeg", "mp3"],
  ["mp3", "mp3"],
  ["mp4", "mp4"],
  ["m4a", "m4a"],
  ["aac", "m4a"],
  ["wav", "wav"],
  ["webm", "webm"],
];

export function audioExtension(mimeType: string): string {
  const found = AUDIO_EXT_BY_MIME.find(([needle]) => mimeType.includes(needle));
  return found ? found[1] : "ogg";
}

// Transcribes a voice note with Whisper. Returns null when the AI is not
// configured or the call fails — callers fall back to a generic placeholder.
export async function transcribeAudio(data: Buffer, mimeType: string): Promise<string | null> {
  const client = getOpenAIClient();
  if (!client) return null;
  try {
    const result = await client.audio.transcriptions.create({
      model: "whisper-1",
      file: await toFile(data, `voice.${audioExtension(mimeType)}`, { type: mimeType }),
    });
    return result.text?.trim() || null;
  } catch {
    return null;
  }
}

export type ExtractedContactInfo = {
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  address: string | null;
  city: string | null;
};

function cleanField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed.slice(0, 300);
}

// Extracts contact details the customer states about themselves in a chat
// message. Returns null when the AI is not configured, the message is too short,
// or the call/parse fails — callers then skip enrichment.
export async function extractContactInfo(text: string): Promise<ExtractedContactInfo | null> {
  const client = getOpenAIClient();
  if (!client) return null;
  const trimmed = text.trim();
  if (trimmed.length < 3) return null;

  const system =
    "Eres un extractor de datos. A partir del mensaje de un CLIENTE en un chat de atención, extrae SOLO los datos que el cliente indique EXPLÍCITAMENTE sobre sí mismo. " +
    "Devuelve ÚNICAMENTE un objeto JSON (sin texto adicional, sin comillas de código) con las claves exactas: name, phone, email, company, address, city. " +
    "Usa null en cada campo que el cliente no haya indicado con claridad. No inventes ni deduzcas datos. " +
    "'name' = nombre propio de la persona; 'phone' = número de teléfono o contacto que da; 'email' = su correo electrónico; 'company' = su empresa o negocio; 'address' = calle/dirección; 'city' = ciudad, municipio o sector.";

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: trimmed },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return null;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      name: cleanField(parsed.name),
      phone: cleanField(parsed.phone),
      email: cleanField(parsed.email),
      company: cleanField(parsed.company),
      address: cleanField(parsed.address),
      city: cleanField(parsed.city),
    };
  } catch {
    return null;
  }
}

export type ContactProfileExtract = {
  summary: string | null;
  buyerStatus: string | null;
  interests: string[];
  purchaseProfile: string | null;
  facts: Array<{ label: string; value: string }>;
};

// Analyzes a conversation and returns a running summary plus commercial-profile
// data about the customer — but ONLY when something is clearly relevant (fields
// come back null / empty otherwise). Used to enrich the contact profile and give
// the agent context. Returns null when the AI is unavailable or the call fails.
export async function extractContextAndProfile(historyText: string): Promise<ContactProfileExtract | null> {
  const client = getOpenAIClient();
  if (!client) return null;
  const trimmed = historyText.trim();
  if (trimmed.length < 5) return null;

  const system =
    `Analizas una conversación de atención al cliente de ${businessShort}. Devuelve ÚNICAMENTE un objeto JSON (sin texto extra) con las claves exactas: ` +
    "summary, buyerStatus, interests, purchaseProfile, facts. " +
    "'summary' = resumen breve (1-2 frases, máx 40 palabras) del contexto para que un agente sepa responder. " +
    "'buyerStatus' = uno de 'prospecto' | 'comprador' | 'recurrente', o null si no está claro. " +
    "'interests' = arreglo de intereses concretos del cliente (strings cortos), o [] si ninguno es claro. " +
    "'purchaseProfile' = una frase sobre su perfil de compra (qué compra, presupuesto, frecuencia), o null. " +
    "'facts' = arreglo de datos RELEVANTES y concretos como {\"label\":\"...\",\"value\":\"...\"} (p.ej. objetivo, cantidad, presentación, fecha), SOLO si son claramente relevantes; [] si no hay ninguno. " +
    "No inventes ni deduzcas. Usa null/[] cuando no haya algo claramente relevante.";

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 3000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: trimmed.slice(0, 6000) },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return null;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;

    const interests = Array.isArray(parsed.interests)
      ? parsed.interests.map((x) => String(x).trim()).filter((x) => x && x.toLowerCase() !== "null").slice(0, 12)
      : [];
    const facts = Array.isArray(parsed.facts)
      ? parsed.facts
          .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
          .map((f) => ({ label: cleanField(f.label) ?? "", value: cleanField(f.value) ?? "" }))
          .filter((f) => f.label && f.value)
          .slice(0, 12)
      : [];

    return {
      summary: cleanField(parsed.summary),
      buyerStatus: cleanField(parsed.buyerStatus),
      interests,
      purchaseProfile: cleanField(parsed.purchaseProfile),
      facts,
    };
  } catch {
    return null;
  }
}

export type IntentLabel = { id: number; name: string; description: string | null };

// Classifies the customer's intent against the set of user-defined labels and
// returns the best-matching label id, or null when none clearly applies (or the
// AI is not configured). Used to tag conversations so the workflow engine can route.
export async function classifyIntent(opts: {
  message: string;
  history?: string;
  labels: IntentLabel[];
}): Promise<number | null> {
  const client = getOpenAIClient();
  if (!client) return null;
  const message = opts.message.trim();
  if (!message || opts.labels.length === 0) return null;

  const options = opts.labels
    .map((l) => `- id ${l.id}: ${l.name}${l.description ? ` — ${l.description}` : ""}`)
    .join("\n");

  const system =
    "Eres un clasificador de intención para un chat de atención al cliente. " +
    "A partir del mensaje del CLIENTE (y el contexto reciente si se da), elige la ETIQUETA que mejor describe su intención. " +
    "Responde ÚNICAMENTE con el número de id de la etiqueta elegida (solo el número). " +
    "Si ninguna etiqueta aplica con claridad, responde exactamente 'none'.";

  const user = [
    opts.history ? `Contexto reciente:\n${opts.history}\n` : "",
    `Mensaje del cliente:\n${message}\n`,
    `Etiquetas disponibles:\n${options}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 512,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const match = raw.match(/\d+/);
    if (!match) return null;
    const id = Number(match[0]);
    return opts.labels.some((l) => l.id === id) ? id : null;
  } catch {
    return null;
  }
}

// Decides whether a customer's first message in a reopened chat is picking up the
// SAME matter a previous (now closed) conversation was handling, or starting
// something new. Used to decide if a chat a human had taken should go back to that
// human, or start fresh through the flow. A bare greeting or a different topic is
// NOT a continuation. Returns false when unclear or the AI is unavailable — the
// default is a fresh start.
export async function isConversationContinuation(opts: {
  previousSummary: string;
  message: string;
}): Promise<boolean> {
  const client = getOpenAIClient();
  if (!client) return false;
  const message = opts.message.trim();
  const summary = opts.previousSummary.trim();
  if (!message || !summary) return false;

  const system =
    "Decides si el nuevo mensaje de un cliente CONTINÚA el mismo asunto de una conversación anterior que ya se había cerrado, o si empieza un tema nuevo. " +
    "Un saludo genérico ('hola', 'buenas', 'buen día'), un agradecimiento suelto o una consulta sobre OTRO tema NO son continuación. " +
    "Solo es continuación si el mensaje retoma con claridad el mismo asunto pendiente (mismo pedido, reclamo, cotización o gestión). " +
    "Responde ÚNICAMENTE con 'si' o 'no'.";
  const user = `Asunto de la conversación anterior:\n${summary}\n\nNuevo mensaje del cliente:\n${message}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 512,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim().toLowerCase() ?? "";
    if (!raw) return false;
    // Accept "si"/"sí" as an affirmative; anything else (incl. "no") is a new topic.
    return /^s[ií]\b/.test(raw) || /\bs[ií]\b/.test(raw.split(/\s+/)[0] ?? "");
  } catch {
    return false;
  }
}

// Lo que se sabe de una conversación que acaba de cerrarse, para decidir qué
// gestión le sigue: post-venta si hubo venta, recuperación si quedó una
// oportunidad, nada si no.
export type ClosedSessionAnalysis = {
  sale: boolean;
  product: string | null;
  opportunity: boolean;
  reason: string;
  summary: string | null;
};

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  const match = raw?.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// El producto tal como se llama en el catálogo, o null. Lo que el modelo devuelva
// fuera de la lista no se usa: acabaría impreso en una plantilla que el cliente lee.
export function matchCatalogProduct(value: unknown, catalog: string[]): string | null {
  const name = cleanField(value);
  if (!name) return null;
  const needle = name.toLowerCase();
  return (
    catalog.find((p) => p.toLowerCase() === needle) ??
    catalog.find((p) => p.toLowerCase().includes(needle) || needle.includes(p.toLowerCase())) ??
    null
  );
}

// Lee el chat que se cerró. Devuelve null si la IA no está disponible o falla: en
// ese caso no se programa nada, porque escribirle a un cliente a ciegas es peor
// que no escribirle.
export async function analyzeClosedSession(opts: {
  transcript: string;
  catalog: string[];
}): Promise<ClosedSessionAnalysis | null> {
  const client = getOpenAIClient();
  if (!client) return null;
  const transcript = opts.transcript.trim();
  if (!transcript) return null;

  const system =
    `Analizas una conversación de WhatsApp de ${businessShort} que acaba de cerrarse. Devuelve ÚNICAMENTE un objeto JSON con las claves exactas: sale, product, opportunity, reason, summary.\n` +
    "- 'sale' (boolean): true SOLO si en esta conversación el cliente confirmó una compra o un pedido (pagó, envió comprobante, dio sus datos de envío para un pedido confirmado, o el equipo le confirmó su orden). Preguntar precios, pedir el enlace o decir 'lo voy a pensar' NO es venta.\n" +
    "- 'product' (string o null): el producto comprado o, si no hubo venta, el que más le interesó. Escríbelo EXACTAMENTE como aparece en el catálogo. null si no se habló de ninguno.\n" +
    "- 'opportunity' (boolean): si no hubo venta, true cuando vale la pena escribirle para retomarla: preguntó por productos, precios o cómo comprar, dejó la conversación a medias, o solo saludó y nadie le atendió bien. false cuando dijo claramente que no le interesa, pidió que no le escriban, ya compró por otra vía, el tema era un reclamo o soporte de un pedido, era un número equivocado o spam. Si hubo venta, false.\n" +
    "- 'reason' (string): una frase corta que explique la decisión, para el equipo.\n" +
    "- 'summary' (string o null): 1 o 2 frases con lo que buscaba el cliente y en qué quedó, para que el agente que le escriba sepa retomarlo.\n" +
    `Catálogo:\n${opts.catalog.map((p) => `- ${p}`).join("\n") || "(sin catálogo)"}\n` +
    "No inventes: si algo no está claro en la conversación, decide lo más conservador (sale false, product null).";

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 3000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: transcript.slice(-8000) },
      ],
    });
    const parsed = parseJsonObject(completion.choices[0]?.message?.content);
    if (!parsed) return null;
    const sale = parsed.sale === true;
    return {
      sale,
      product: matchCatalogProduct(parsed.product, opts.catalog),
      opportunity: !sale && parsed.opportunity === true,
      // Sin punto final: las notas del chat lo citan dentro de su propia frase.
      reason: (cleanField(parsed.reason) ?? "sin detalle").replace(/[.\s]+$/, ""),
      summary: cleanField(parsed.summary),
    };
  } catch {
    return null;
  }
}

// Redacta el mensaje con el que un agente retoma a un cliente cuando la ventana de
// 24h sigue abierta y no hace falta plantilla. `messages` es el prompt de sistema
// del agente más el historial; la instrucción va al final. Devuelve null si no
// sale un texto utilizable — quien llama cae a la plantilla.
export async function composeFollowupMessage(opts: {
  model: string | null;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  instruction: string;
}): Promise<string | null> {
  const client = getOpenAIClient();
  if (!client) return null;
  try {
    const completion = await client.chat.completions.create({
      model: opts.model || "gpt-5-mini",
      // Mismo techo que la respuesta del chat: con la base de conocimiento completa
      // el modelo razona 2–3.5k tokens y con 4096 a veces no le quedaba para el texto.
      max_completion_tokens: 8192,
      messages: [...opts.messages, { role: "system", content: opts.instruction }],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw || /ESCALAR_A_HUMANO|PEDIDO_CONFIRMADO/i.test(raw)) return null;
    const text = raw
      .replace(PHOTO_DIRECTIVE, "")
      .replace(IMAGE_DIRECTIVE, "")
      .replace(OPTIONS_DIRECTIVE, "")
      .replace(APPOINTMENT_DIRECTIVE, "")
      .replace(/^\[\d{2}\/\d{2}[^\]]*\]\s*/, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text.length >= 8 ? text : null;
  } catch {
    return null;
  }
}

// ¿Qué necesita lo último que escribió el cliente? Un "gracias", un "ok" o un
// emoji suelto no esperan respuesta: contestarle "disculpa la demora" a eso delata
// al bot. Entre medias está lo que no pregunta nada pero sí merece un acuse: a
// una clienta que contestó al formato del pedido "después de las 10:00 am
// puedo recibir", el agente que retomó el chat le preguntó "¿en qué puedo
// ayudarte hoy?" (2026-09-18); lo que tocaba era "De acuerdo, nos mantenemos en
// contacto".
//   - "answer":   pregunta, pide o abre conversación → se le contesta.
//   - "courtesy": informa, confirma o agradece algo que se le envió → una línea
//                 de cierre cortés, sin preguntarle nada.
//   - "none":     un emoji, un "ok" o una despedida que ya cierra el tema.
// "none" cuando no está claro o la IA falla — ante la duda no se le escribe.
export type PendingReplyNeed = "answer" | "courtesy" | "none";

export async function pendingReplyNeed(transcriptTail: string): Promise<PendingReplyNeed> {
  const client = getOpenAIClient();
  if (!client || !transcriptTail.trim()) return "none";
  const system =
    "Lees el final de un chat de atención al cliente. Nadie del equipo contestó lo último que escribió el cliente. " +
    "Decide qué necesita ese último mensaje del cliente y responde ÚNICAMENTE una de estas palabras: " +
    "'responder' si ESPERA una respuesta (una pregunta, un pedido, una duda, un saludo que abre conversación); " +
    "'cortesia' si no pregunta nada pero merece un acuse breve (agradece algo que se le envió, confirma, informa un dato como a qué hora puede recibir, dice que queda atento); " +
    "'nada' si no hace falta escribirle (un 'ok', un emoji suelto, una despedida que cierra el tema).";
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 512,
      messages: [
        { role: "system", content: system },
        { role: "user", content: transcriptTail.slice(-3000) },
      ],
    });
    return parsePendingReplyNeed(completion.choices[0]?.message?.content);
  } catch {
    return "none";
  }
}

// La misma decisión, pero en vivo: el cliente acaba de escribir y hay que ver si
// su mensaje pide respuesta antes de que el agente redacte (situación del chat,
// ver quickTurnSituation en followup-rules.ts). A diferencia del seguimiento,
// ante la duda o si la IA falla se contesta (null → el agente responde como
// siempre): quedarse callado ante una pregunta es peor que un cierre de más.
export async function classifyTurnSituation(transcriptTail: string): Promise<PendingReplyNeed | null> {
  const client = getOpenAIClient();
  if (!client || !transcriptTail.trim()) return null;
  const system =
    "Lees el final de un chat de atención al cliente de una tienda. El último mensaje es del cliente y hay que decidir qué necesita antes de contestarle. " +
    "Los mensajes de antes pueden ser de una conversación anterior: úsalos para entender a qué responde. Responde ÚNICAMENTE una de estas palabras: " +
    "'responder' si pregunta, pide, retoma algo pendiente, contesta a una pregunta nuestra, da datos para un pedido o saluda para abrir conversación; " +
    "'cortesia' si no pide nada: agradece, confirma, lamenta algo ('ay lástima'), informa un dato sobre algo ya hablado o se despide, y nuestro último mensaje no fue ya una despedida o un cierre cortés; " +
    "'nada' si solo acusa recibo (un 'ok', 'listo', un emoji) o vuelve a agradecer, y nuestro último mensaje ya fue una despedida o un cierre cortés ('¡Con gusto!', '¡A la orden!'): contestarle otra vez sería escribir de más.";
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 512,
      messages: [
        { role: "system", content: system },
        { role: "user", content: transcriptTail.slice(-3000) },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    return raw?.trim() ? parsePendingReplyNeed(raw) : null;
  } catch {
    return null;
  }
}

export function parsePendingReplyNeed(raw: string | null | undefined): PendingReplyNeed {
  const word = (raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (/^responder\b/.test(word)) return "answer";
  if (/^cortesia\b/.test(word)) return "courtesy";
  return "none";
}

// ── Memoria de aprendizaje ────────────────────────────────────────────────────
// Revisa la última respuesta del agente virtual a la luz de lo que vino después
// (lib/agent-learning.ts) y decide si no fue la adecuada. Si no lo fue, redacta
// la lección como una regla que el agente pueda seguir y la compara con las que
// ya existen, para sumar a una en vez de abrir una casi igual.
//   - frustration:      lo que vino después es la reacción del cliente.
//   - human_correction: lo que vino después es lo que escribió una persona del
//                       equipo que entró justo detrás del agente.
export type ReplyReviewSignal = "frustration" | "human_correction";

export type ReplyReview = {
  flagged: boolean;
  severity: "low" | "medium" | "high";
  diagnosis: string | null;
  lesson: string | null;
  matchesLessonId: number | null;
};

export function parseReplyReview(raw: string | null | undefined, lessonIds: number[]): ReplyReview | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  const severity = parsed.severity === "high" || parsed.severity === "medium" ? parsed.severity : "low";
  const match = typeof parsed.matchesLessonId === "number" ? parsed.matchesLessonId : Number(parsed.matchesLessonId);
  const lesson = cleanField(parsed.lesson);
  return {
    // Sin lección no hay nada que aprender, aunque el modelo marque el caso.
    flagged: parsed.flagged === true && !!lesson,
    severity,
    diagnosis: cleanField(parsed.diagnosis),
    lesson: lesson ? lesson.slice(0, 400) : null,
    matchesLessonId: Number.isInteger(match) && lessonIds.includes(match) ? match : null,
  };
}

const REVIEW_SIGNAL_GUIDE: Record<ReplyReviewSignal, string> = {
  frustration:
    "Lo último del chat es la reacción del CLIENTE a la última respuesta del agente. Márcala (flagged true) si esa respuesta lo frustró o molestó: repite su pregunta porque no se la contestaron, dice que ya lo dijo o que no le entienden, reclama, se queja del bot, pide una persona, contesta seco o con enojo. " +
    "Una pregunta nueva, un 'ok', un 'gracias' o seguir con la compra NO es frustración.",
  human_correction:
    "Lo último del chat es un mensaje de una PERSONA DEL EQUIPO ('Agente (persona)') que entró justo después de la respuesta del agente virtual. Márcala (flagged true) si la persona corrigió o reemplazó la respuesta del agente porque no era la adecuada: le contestó distinto a lo mismo, el agente preguntó algo que no venía a cuento, saludó como si empezara un chat nuevo, dio un dato mal o de más. " +
    "Si la persona solo continúa el trámite (manda la guía del envío, confirma un pago, sigue con el pedido, contesta algo nuevo del cliente), NO es corrección.",
};

export async function reviewAgentReply(opts: {
  transcript: string;
  signal: ReplyReviewSignal;
  lessons: Array<{ id: number; lesson: string }>;
}): Promise<ReplyReview | null> {
  const client = getOpenAIClient();
  if (!client || !opts.transcript.trim()) return null;
  const system =
    `Revisas chats de ${businessShort} donde contesta un agente virtual ('Agente IA'). ${REVIEW_SIGNAL_GUIDE[opts.signal]} ` +
    "Devuelve ÚNICAMENTE un objeto JSON con las claves: flagged (boolean), severity ('low'|'medium'|'high'), diagnosis (una frase para el equipo: qué hizo mal el agente), lesson (una regla corta en imperativo, en español, que el agente pueda seguir la próxima vez sin mencionar a este cliente; null si no hay nada que aprender), matchesLessonId (el id de la lección existente que ya dice lo mismo, o null). " +
    "La lección describe la situación y la conducta correcta ('Si el cliente agradece algo que le envió el equipo, responde con un cierre cortés y no le preguntes en qué puedes ayudarle'). Nunca inventa precios, descuentos, plazos ni políticas que no estén en el chat.\n" +
    `Lecciones que ya existen:\n${opts.lessons.map((l) => `- id ${l.id}: ${l.lesson}`).join("\n") || "(ninguna)"}`;
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: opts.transcript.slice(-6000) },
      ],
    });
    return parseReplyReview(
      completion.choices[0]?.message?.content,
      opts.lessons.map((l) => l.id),
    );
  } catch {
    return null;
  }
}

// El negocio al que sirve esta instancia. Los prompts de abajo son del core (la
// forma de atender es la misma para todos los clientes); lo único que cambia por
// instancia es de quién dice el agente que trabaja, y eso sale de la
// configuración del cliente.
const business = clientConfig.business;

/** "Decolor by NicaDom (tiendas de pinturas…, República Dominicana)" */
const businessFull = (() => {
  const context = [business.descriptor, business.country].filter((part) => part !== "").join(", ");
  return context === "" ? business.displayName : `${business.displayName} (${context})`;
})();

/** "Decolor by NicaDom", sin el paréntesis, para las menciones siguientes. */
const businessShort = business.displayName;

const CORE_PROFILE_PROMPTS: Record<string, string> = {
  sales:
    `Eres un asesor de ventas de ${businessFull}. Tu meta es entender qué necesita el cliente y recomendarle el producto adecuado del catálogo. Pregunta por el uso previsto y las condiciones en que se va a usar antes de recomendar. Cuando recomiendes un producto, comparte el enlace de su ficha. Los detalles de presentación de cada producto están en tu catálogo: eso se responde, no se escala. No inventes precios ni inventario: si te piden cotizar, un precio o confirmar si hay existencia en una tienda, no preguntes cantidades ni des rodeos, responde solo 'ESCALAR_A_HUMANO'.`,
  support:
    `Eres un agente de atención al cliente de ${businessShort}. Resuelves dudas sobre uso y aplicación de productos, rendimiento, sucursales y horarios. Sé empático y resolutivo. Si la consulta exige precios, verificar un pedido, tramitar una garantía, gestionar un reembolso o atender una queja formal, responde solo 'ESCALAR_A_HUMANO' sin anunciarlo.`,
  reservations:
    `Eres el asistente de agenda de ${businessShort}. Coordinas citas y visitas. Pide solo lo imprescindible y de uno en uno: nombre, teléfono, sucursal o dirección, y día y hora preferidos. Resume la cita y pide confirmación antes de darla por hecha. Nunca confirmes una cita sin disponibilidad verificada ni hables de precios o productos: en esos casos responde solo 'ESCALAR_A_HUMANO'.`,
  qualifier:
    `Eres el calificador de prospectos de ${businessShort}. Tu meta es entender el proyecto en pocas preguntas: qué necesita, de qué tamaño, para cuándo y si es particular, profesional o distribuidor. No asesores en detalle ni cotices. En cuanto tengas el panorama, escala con 'ESCALAR_A_HUMANO' incluyendo un resumen de dos líneas del prospecto.`,
  general:
    `Eres el asistente virtual de ${businessFull}. Atiendes la primera línea: entiendes qué necesita el cliente y lo resuelves si es una duda sencilla de producto, sucursales u horarios. Si el tema requiere precios, cotización, verificación de pedido o asesoría técnica de fondo, responde solo 'ESCALAR_A_HUMANO' sin explicarle nada al cliente.`,
  winback:
    `Eres el asesor de ventas de ${businessFull} que retoma a los clientes que escribieron y no llegaron a comprar. Tu trabajo empieza cuando esa conversación ya se cerró: el sistema te dice qué buscaba el cliente y tú le escribes para ayudarle a dar el siguiente paso, sin presionar. Cuando responde, averigua con una pregunta qué lo frenó (una duda del producto, el momento, la confianza) y resuélvelo con tu base de conocimiento: recomienda el producto adecuado y comparte el enlace de su ficha. No inventes descuentos, promociones, precios ni existencias. Si dice que no le interesa, agradécele en una línea y no insistas. Cuando quiera comprar, pida un precio o un descuento, o haya que cerrar el pedido, responde solo 'ESCALAR_A_HUMANO'.`,
  postsale:
    `Eres el agente de post-venta de ${businessShort}. Acompañas a quien ya compró: confirmas que el pedido llegó bien, preguntas cómo le fue y, cuando toca, le recuerdas reponer. Si el pedido llegó bien, alégrate en una línea y ofrece ayuda con el modo de uso según tu base de conocimiento. Si su experiencia fue buena, agradécesela. Si el pedido no ha llegado, llegó dañado o incompleto, o hay una queja, un cambio o una devolución, no pidas datos ni prometas nada: responde solo 'ESCALAR_A_HUMANO'. Si quiere volver a comprar, responde solo 'ESCALAR_A_HUMANO'.`,
};

// Perfiles que solo trabajan desde un disparador de workflow (un chat cerrado sin
// venta, una venta cerrada): escriben ellos primero y atienden la respuesta a su
// mensaje. Nunca son la primera línea: pickVirtualAgentForChannel los salta, o
// el agente de post-venta acabaría contestando el "hola" de un cliente nuevo.
export const PROACTIVE_PROFILES = new Set(["winback", "postsale"]);

// Personas efectivas de la instancia: las del core, sustituidas perfil a perfil
// por las que el cliente haya afinado en su configuración.
export const PROFILE_PROMPTS: Record<string, string> = {
  ...CORE_PROFILE_PROMPTS,
  ...business.aiPrompts,
};

// Perfiles a los que se les permite adjuntar la foto del producto. Los perfiles
// de agenda y calificación conversan sobre logística, no sobre catálogo: enviar
// imágenes ahí solo alarga la conversación.
export const PHOTO_ENABLED_PROFILES = new Set(["sales", "support", "general", "winback", "postsale"]);

// Marca que el agente escribe para que el backend adjunte la foto del producto.
// Se procesa y se retira del texto en messaging.ts, igual que ESCALAR_A_HUMANO.
export const PHOTO_DIRECTIVE = /\[\[FOTO:\s*([a-z0-9-]+)\s*\]\]/gi;

// Marca de imagen fija del negocio: [[IMAGEN:cuentas]]. Las imágenes y cuándo
// enviarlas las declara el cliente (business.agentImages); la entrega y el retiro
// del texto ocurren en messaging.ts, con las mismas reglas que las fotos.
export const IMAGE_DIRECTIVE = /\[\[IMAGEN:\s*([a-z0-9-]+)\s*\]\]/gi;

// La hora con la que va cada turno del historial ([15/10 16:43]). El prompt le
// prohíbe al modelo copiarla, y aun así a veces arranca la respuesta con ella:
// 2026-10-15, "[15/10 16:43] ¿Qué producto quieres y cuántos?". El correo ya la
// quitaba (sanitizeAiEmailReply); el chat no.
export const ECHOED_TIMESTAMP = /^\[\d{1,2}\/\d{1,2}[^\]\n]*\][ \t]*/gm;

// ── Lo que el cliente ya recibió ──────────────────────────────────────────────
// Una foto, las cuentas o el enlace de un producto se mandan una vez por
// conversación. El prompt lo pide, pero el modelo tiende a repetirlos en cada
// mensaje del pedido (foto + enlace + precio, tres veces seguidas), así que
// messaging.ts lo hace cumplir con estas funciones.

// El cliente pide otra vez algo que ya se le mandó ("pásame la foto", "¿me
// mandas las cuentas de nuevo?"): entonces sí se repite.
const RESEND_REQUEST = /\b(fotos?|im[aá]gen(es)?|cuentas?|enlaces?|links?|p[aá]gina)\b/i;

export function asksToResend(customerMessage: string): boolean {
  return RESEND_REQUEST.test(customerMessage);
}

// El cliente pregunta cómo o dónde comprar, o dice que lo quiere: ahí el enlace de
// la tienda en línea es parte de la respuesta —otra vía para comprar—, aunque ya
// le hubiera llegado con la bienvenida. Pedido el 2026-09-18: "cuando un cliente
// pregunta cómo puedo comprar lista bien los pasos pero debe compartir el enlace
// de la página también".
// 2026-10-15: "¿cómo se compra?", "¿cómo lo pido?" y "¿cómo hago el pedido?"
// también: la respuesta a cómo comprar es un mensaje fijo que empieza por el
// enlace, y sin él ese mensaje queda cojo.
const PURCHASE_INTENT =
  /\b(c[oó]mo\s+(puedo\s+|hago\s+para\s+|hago\s+(mi\s+|el\s+|un\s+)?|se\s+puede\s+|se\s+hace\s+(mi\s+|el\s+|un\s+)?|se\s+|lo\s+|la\s+|los\s+|las\s+|le\s+hago\s+para\s+)?(compr|ped|pid|orden|adquir|consegu)\w*|d[oó]nde\s+(lo\s+|la\s+|los\s+|puedo\s+)?(compr|consig|ped)\w*|me\s+interesa\w*|quiero\s+(compr|ped|orden|adquir)\w*|lo\s+quiero|la\s+quiero|quisiera\s+(compr|ped|orden)\w*)/i;

export function showsPurchaseIntent(customerMessage: string): boolean {
  return PURCHASE_INTENT.test(customerMessage);
}

const LINK_PATTERN = /https?:\/\/[^\s<>()]+/gi;

// Puntuación que el modelo pega al final de un enlace y que no forma parte de él.
function trimLink(raw: string): string {
  return raw.replace(/[.,;:!?…]+$/, "");
}

function linkKey(link: string): string {
  return trimLink(link).replace(/\/+$/, "").toLowerCase();
}

/** Los enlaces que trae un texto, sin la puntuación que los sigue. */
export function linksIn(text: string): string[] {
  return [...text.matchAll(LINK_PATTERN)].map((m) => trimLink(m[0]));
}

/**
 * Quita de la respuesta los enlaces que el cliente ya tiene: el del pie de la foto
 * que sale con este mismo mensaje, o uno que ya se le mandó antes. Si no queda
 * texto, devuelve el original: un mensaje vacío sería peor que un enlace repetido.
 */
export function removeLinks(text: string, links: Iterable<string>): string {
  const drop = new Set([...links].map(linkKey));
  if (!drop.size) return text;

  const cleaned = text
    .replace(/\(\s*(https?:\/\/[^\s<>()]+)\s*\)/gi, (whole, link: string) => (drop.has(linkKey(link)) ? "" : whole))
    .replace(LINK_PATTERN, (raw, offset: number, whole: string) => {
      const link = trimLink(raw);
      if (!drop.has(linkKey(link))) return raw;
      // "Cuesta US$100. https://….": sin el enlace, su punto final quedaría doble.
      const tail = raw.slice(link.length);
      return /[.!?:]\s*$/.test(whole.slice(0, offset)) ? tail.replace(/^[.,;:]+/, "") : tail;
    })
    .split("\n")
    .map((line) => line.replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || text;
}

// Marca de opciones: [[OPCIONES: Interior | Exterior]]. Se procesa y se retira
// del texto en messaging.ts, que las entrega como botones del canal.
export const OPTIONS_DIRECTIVE = /\[\[OPCIONES:\s*([^\]]+?)\s*\]\]/gi;

// Marca de cita: [[CITA: Corte de cabello | 2026-08-15 15:00 | Sucursal Naco]].
// La procesa messaging.ts, que comprueba la disponibilidad y crea la cita.
export const APPOINTMENT_DIRECTIVE = /\[\[CITA:\s*([^\]]+?)\s*\]\]/gi;

// Solo el perfil de reservas agenda. Es la misma cautela que con las fotos: la
// marca se documenta en el prompt de ese perfil, pero un prompt escrito a mano
// podría arrastrarla a otro rol, y una cita creada por el agente de ventas sin
// que nadie la pidiera es peor que una cita no creada.
export const APPOINTMENT_ENABLED_PROFILES = new Set(["reservations"]);

export interface ParsedAppointmentDirective {
  service: string;
  /** Hora de reloj del negocio, tal cual la escribió el agente ("2026-08-15 15:00"). */
  when: string;
  location: string | null;
}

/**
 * Lee la marca de cita. Devuelve `null` cuando no hay marca o cuando le falta
 * alguna de las dos partes obligatorias: sin servicio o sin fecha no hay cita
 * que crear, y agendar a medias es peor que no agendar.
 */
export function parseAppointmentDirective(reply: string): ParsedAppointmentDirective | null {
  const match = new RegExp(APPOINTMENT_DIRECTIVE.source, "i").exec(reply);
  if (!match) return null;

  const [service, when, location] = match[1].split("|").map((part) => part.trim());
  if (!service || !when) return null;

  return { service, when, location: location || null };
}

// Convierte la marca del agente en botones listos para el canal. Devuelve lista
// vacía cuando no hay marca o cuando lo que escribió no sirve como botonera
// (una sola opción, o etiquetas que no caben): en ese caso messaging.ts manda el
// mensaje como texto normal, que se lee igual de bien.
export function parseOptionButtons(reply: string): Array<{ id: string; label: string }> {
  const match = new RegExp(OPTIONS_DIRECTIVE.source, "i").exec(reply);
  if (!match) return [];

  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of match[1].split("|")) {
    // Se limpian viñetas y numeración por si el modelo las arrastra al interior
    // de la marca ("1. Interior", "- Exterior").
    const label = raw.trim().replace(/^[-•*]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
    if (!label) continue;
    // Una etiqueta que no cabe se descartaría al cortarla a mitad de palabra:
    // mejor renunciar a los botones que enseñar "Interior y exteri".
    if ([...label].length > MAX_BUTTON_LABEL) return [];
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }

  // Un solo botón no es una elección; el cliente responde igual escribiendo.
  if (labels.length < 2) return [];

  return labels.slice(0, MAX_INTERACTIVE_BUTTONS).map((label, i) => ({
    id: `opt_${i}_${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`,
    label,
  }));
}

// ── El canal de la conversación ───────────────────────────────────────────────
// La misma persona puede escribir por WhatsApp, Instagram o Facebook, y lo que el
// agente puede dar por hecho cambia con el canal: por WhatsApp tiene su número (y
// con él, el país), por Instagram y Messenger no. Sin decírselo, el agente hablaba
// de "este WhatsApp" en un mensaje directo de Instagram y no pedía el teléfono
// para el envío porque "se usa ese número".

const CHANNEL_NAMES: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram (mensaje directo)",
  facebook: "Facebook Messenger",
};

/** WhatsApp da el número con código de país y sin "+" (18097878732). */
function displayPhone(phone: string | null | undefined): string | null {
  const raw = phone?.trim();
  if (!raw) return null;
  return /^\d{11,15}$/.test(raw) ? `+${raw}` : raw;
}

/** Qué sabe el agente del canal y qué no puede dar por hecho. Null si el canal no es un chat conocido. */
export function channelPromptBlock(channel: string | null | undefined, phone: string | null | undefined): string | null {
  const name = channel ? CHANNEL_NAMES[channel] : undefined;
  if (!channel || !name) return null;
  const lines = [`CANAL DE ESTA CONVERSACIÓN: ${name}.`];
  if (channel === "whatsapp") {
    const number = displayPhone(phone);
    lines.push(
      number
        ? `- El cliente te escribe por WhatsApp desde el número ${number}: ese es su teléfono, no se lo pidas. Su código de país te dice desde dónde escribe.`
        : "- El cliente te escribe por WhatsApp, pero su número no está disponible: si hace falta su teléfono, pídeselo.",
    );
  } else {
    const network = channel === "instagram" ? "Instagram" : "Facebook";
    lines.push(
      `- El cliente te escribe por ${network}, no por WhatsApp: no tienes su teléfono ni sabes desde qué país escribe. Si hacen falta, pídeselos.`,
      `- Donde tu base de conocimiento o tus instrucciones digan "este WhatsApp" o "este número", aquí es este chat de ${network}. No le digas que te escribe por WhatsApp ni lo mandes a WhatsApp salvo que lo pida.`,
    );
  }
  lines.push("- Si nombras el canal, usa el nombre correcto de este.");
  return lines.join("\n");
}

// Conducta común a TODOS los agentes virtuales. Va aparte de PROFILE_PROMPTS
// porque el prompt personalizado de un agente sustituye a la plantilla del rol
// (ver buildSystemPrompt); estas reglas deben aplicarse igualmente, y son las
// que evitan que el bot abrume al cliente.
// Con varios agentes que se pasan la conversación según la intención, "di tu
// nombre en el primer mensaje" hacía que cada uno se presentara al recibirla: el
// cliente leía "soy Daniela" y dos mensajes después "soy Sofía". Por eso el
// cliente puede apagar los nombres (business.agentsIntroduceByName).
const NAME_CONDUCT = business.agentsIntroduceByName
  ? "- Di tu nombre solo en el primer mensaje; después no vuelvas a presentarte."
  : `- No te presentes: ni con un nombre ni con un "soy…". Para el cliente hay un solo chat de ${businessShort}, aunque lo atiendan varios asistentes. Si te pregunta con quién habla, dile que con el asistente virtual de ${businessShort}.`;

const BASE_CONDUCT = `Cómo conversas (aplica siempre):
- Saludo: una sola línea corta. Si el cliente solo saludó, pregunta en qué puedes ayudar; si ya trae una pregunta, respóndela en ese mismo mensaje sin preguntarle en qué puedes ayudar. NO te presentes con una lista de servicios, catálogo, horarios ni promociones que nadie pidió.
- Responde solo lo que te preguntaron. Nada de información extra "por si acaso".
- Por defecto, 1 o 2 oraciones. Extiéndete solo si el cliente pide detalle o especificaciones.
- Una pregunta a la vez. No encadenes varias en el mismo mensaje.
- Pregunta solo lo imprescindible para avanzar. Si con lo que ya sabes puedes responder o recomendar, hazlo sin preguntar; cada pregunta de más cansa al cliente.
${NAME_CONDUCT}
- Nunca digas de qué área, departamento o rol eres. Nada de "soy de ventas", "del área de soporte", "soy la ejecutiva de atención" ni "te atiende el departamento de…". Para el cliente hay un solo chat: responde y ya.
- Tampoco nombres a los demás agentes ni digas que alguien más se encargará: el reparto interno no es asunto del cliente.
- No repitas lo que ya dijiste —un precio, un enlace, una foto, el resumen del pedido— ni resumas la conversación salvo que te lo pidan: cada mensaje lleva solo lo nuevo que hace falta para el siguiente paso.
- Si el cliente ya confirmó algo ("sí", "ese", "quiero 1"), no se lo vuelvas a confirmar: sigue con lo que falta.
- Nada de listas ni viñetas salvo que el cliente pida comparar o enumerar. En chat, texto corrido.
- Si el cliente ya dio un dato, no se lo vuelvas a pedir.
- No preguntes algo que luego no puedas atender: si preguntas por el color, el acabado o la presentación, es porque tienes esa información en tu base de conocimiento y sabrás seguir la conversación.
- Si el cliente te devuelve tu propia pregunta ("¿cuáles tienes?", "¿qué opciones hay?", "¿de qué colores?"), respóndele con lo que dice tu base de conocimiento y solo después vuelve a preguntarle qué prefiere. Devolverle la pregunta o traspasarlo sin contestar es el peor cierre posible.
- Emojis: úsalos cuando aporten calidez o claridad, uno o dos por mensaje como mucho. Nunca los encadenes ni sustituyas palabras por iconos.
- Antes de escribir, mira dónde quedó la conversación, incluido lo que le mandó una persona del equipo (un pedido, una guía de envío, un formato, una foto): tu mensaje tiene que encajar como la respuesta a lo último que pasó, no como un chat que empieza.
- Si el cliente no pide nada —agradece, confirma, se despide o te da un dato sobre algo ya hablado ('gracias', 'ok', 'perfecto', 'después de las 10 puedo recibir', 'quedo atenta')—, contéstale con un cierre cortés de una línea que acuse lo que dijo ('¡Siempre a la orden! 🙌', 'De acuerdo, anotado. Nos mantenemos en contacto.'). No le preguntes en qué puedes ayudarle ni le ofrezcas nada: ya estaba atendido, y preguntárselo le dice que nadie leyó el chat.`;

// Preguntas cerradas → botones. El cliente no quiere escribir: si la pregunta
// tiene respuestas contables, la marca las convierte en botones reales
// (interactivos en WhatsApp, quick replies en Messenger/IG) y responder es un
// toque. Los límites de aquí son los del canal, no una preferencia de estilo:
// WhatsApp rechaza el mensaje si se pasan.
const OPTIONS_CONDUCT = `Preguntas con opciones:
- Si tu pregunta tiene 2 o 3 respuestas posibles claras (interior o exterior; pared, madera o metal; sí o no; mañana o tarde), termina el mensaje con la marca [[OPCIONES: Primera | Segunda]] y el sistema las envía como botones para que el cliente solo tenga que tocar.
- Máximo 3 opciones y cada etiqueta de 20 caracteres o menos. Puedes abrir la etiqueta con un emoji si ayuda a distinguirla.
- La pregunta va sola en el texto: no enumeres las opciones también ahí, se verían dos veces.
- Si la respuesta es abierta (nombre, dirección, color exacto, cuántos litros), pregunta normal y sin marca.
- Nunca pongas como opción algo que no puedes resolver (precios, existencias, estado de un pedido).`;

// Qué hacer cuando el tema se sale de lo que el agente sabe o le toca. Al cliente
// SÍ se le avisa que pasa con una persona, pero ese aviso lo escribe el backend
// (handoffNotice en branches.ts), no el modelo: así el texto es siempre el mismo,
// nombra la tienda que le toca y no promete tiempos de respuesta que nadie
// garantizó. Por eso la respuesta correcta del agente sigue siendo SOLO la palabra
// clave — si además se despide, se disculpa o pide datos del tema que no puede
// resolver, mete al cliente más hondo en un callejón sin salida.
const SCOPE_CONDUCT = `Fuera de tu alcance (regla dura):
- Antes de escalar, busca el dato en tu base de conocimiento. Lo que está ahí (colores, acabado, usos, rendimiento, tiempos de secado, sucursales, horarios, y el precio o las formas de pago cuando vienen en ella) se responde, aunque la pregunta suene a inventario: "¿qué colores tiene?" o "¿cuáles hay?" preguntan por el catálogo, no por las existencias de una tienda.
- Si el tema no te corresponde (precios o existencias que no estén en tu base de conocimiento, cotizaciones, estado de pedidos, garantías, reclamos formales, o cualquier asunto que no domines) o la respuesta no está en tu base de conocimiento: NO respondas y NO pidas datos para avanzar en ese tema.
- En ese caso tu respuesta debe ser EXACTAMENTE la palabra ESCALAR_A_HUMANO y nada más: sin saludo, sin disculpa, sin explicación, sin pregunta, sin despedida.
- No lo anuncies tú: del aviso de que lo pasa con un asesor se encarga el sistema, que además le dice qué tienda lo va a atender. Si lo escribes tú, el cliente lo lee dos veces.
- Nunca digas que no manejas un tema, que no tienes esa información ni que lo vas a consultar. Tampoco preguntes tú de qué zona, ciudad o tienda es para poder derivarlo: eso también lo pregunta el sistema.
- Nunca inventes ni aproximes para salir del paso.`;

// Instrucciones de producto: el enlace una vez por producto, foto solo en los
// perfiles que la tienen habilitada (y entonces el enlace va en su pie).
export function productConduct(canSendPhoto: boolean, photosPerReply = business.photosPerReply): string {
  // A client that sells by showing several units (business.photosPerReply > 1) shows them together
  // when the customer asks what there is; everyone else keeps one product per message.
  const several = canSendPhoto && photosPerReply > 1;
  const lines = [
    "Productos:",
    `- La primera vez que hables de un producto concreto en la conversación, comparte el enlace de su ficha tal cual aparece en la base de conocimiento${canSendPhoto ? " (con la foto, ver abajo)" : ""}. Después no lo repitas: el cliente ya lo tiene, salvo que te lo vuelva a pedir.`,
    several
      ? `- Cuando el cliente pregunte qué hay, pida opciones o nombre un tipo de producto, enseña de 2 a ${photosPerReply} productos concretos que encajen en el mismo mensaje, cada uno con su foto. Cuando ya hablan de uno en particular, habla solo de ese.`
      : "- UN SOLO producto por mensaje, con UN SOLO enlace. Si hay varias opciones válidas, pregunta lo que te falte para decidir en vez de enumerarlas todas.",
    "- No copies la tabla de especificaciones completa. Da el dato que preguntaron y deja el enlace para el resto.",
    "- Nunca inventes un producto, un enlace ni una especificación. Si no está en tu base de conocimiento, escala en silencio (ver 'Fuera de tu alcance').",
  ];
  if (canSendPhoto) {
    // Redactado en imperativo y no como permiso. "Envía foto solo cuando…"
    // describía un permiso con condiciones, y el modelo resolvía la duda no
    // mandándola nunca: comprobado contra gpt-5-mini, con el catálogo entero y
    // con la mitad, no emitía la marca en ningún caso. Con la regla en
    // imperativo y el disparador atado a un hecho verificable —haber nombrado un
    // producto— sí la emite. El tope de una foto por mensaje lo sigue aplicando
    // el backend, así que ser tajante aquí no puede producir ráfagas.
    //
    // "La primera vez" y no "siempre": con "siempre" la foto y el enlace salían en
    // cada mensaje del pedido (confirmación, datos del envío, pago). El disparador
    // sigue siendo verificable —si ya nombró el producto, está en su historial— y
    // el backend no reenvía una foto que ya salió en la sesión.
    lines.push(
      "- La primera vez que nombres un producto concreto en la conversación, termina el mensaje con [[FOTO:identificador]], usando el Identificador que aparece junto al nombre en tu base de conocimiento. Es una marca para el sistema: él adjunta la imagen con el nombre y el enlace en el pie, así que en ese mensaje no escribas el enlace, no describas la foto ni pegues su URL.",
      several
        ? `- Una marca por cada producto que enseñes, hasta ${photosPerReply} por mensaje, todas al final y en el orden en que los nombraste. Si un producto ya salió en la conversación, no pongas su marca otra vez salvo que el cliente pida la foto.`
        : "- Una sola marca por mensaje, la del producto del que estás hablando. Si aún no has concretado cuál, no pongas ninguna. Si ese producto ya salió en la conversación, no la pongas otra vez salvo que el cliente pida la foto.",
    );
  }
  return lines.join("\n");
}

// Imágenes fijas del negocio (business.agentImages). Solo se enseñan las que el
// cliente declaró: una marca que no existe no llega a ningún lado.
function agentImagesConduct(): string {
  const images = Object.entries(business.agentImages);
  if (!images.length) return "";
  return [
    "Imágenes que puedes enviar:",
    ...images.map(([key, image]) => `- [[IMAGEN:${key}]]: ${image.description}`),
    "- Cuando corresponda, termina el mensaje con esa marca: el sistema envía la imagen junto con tu texto (detrás, o delante si esa imagen va primero). Una sola imagen por mensaje, no describas la imagen ni pegues su enlace, y no la vuelvas a enviar si ya se la mandaste en esta conversación, salvo que te la pida otra vez.",
  ].join("\n");
}

// Agenda: el agente de reservas deja de ser un recolector de datos que termina
// escalando. Con el módulo `appointments` encendido escribe la marca y el
// backend crea la cita — comprobando antes que el hueco esté libre, que es lo
// único que el modelo no puede verificar por su cuenta.
const APPOINTMENT_CONDUCT = `Agendar citas:
- Cuando tengas el servicio, el día y la hora, cierra la cita escribiendo al final la marca [[CITA: servicio | AAAA-MM-DD HH:MM | lugar]]. El lugar es opcional: [[CITA: servicio | AAAA-MM-DD HH:MM]].
- La hora va en formato de 24 horas y en hora local del negocio, la misma en la que están fechados los mensajes.
- Escribe la fecha completa aunque el cliente diga "mañana" o "el sábado": tú sabes qué día es hoy porque está en tu contexto.
- En el texto confirma la cita con naturalidad ("Listo, te espero el sábado a las 3:00 p. m."). No escribas la marca dentro de la frase ni menciones que existe.
- Una cita por mensaje. Si el horario resulta estar ocupado, el sistema no la agenda y le ofrece al cliente otra hora: no lo des por hecho dos veces.
- Si te falta el servicio, el día o la hora, pregúntalo antes; no agendes con datos a medias ni inventes un horario que el cliente no dijo.`;

export const PROFILE_LABELS: Record<string, string> = {
  sales: "Ventas (asesora, recomienda productos y cierra ventas)",
  support: "Atención al cliente (dudas, quejas, garantías y soporte)",
  reservations: "Reservas y agenda (agenda citas, visitas y confirmaciones)",
  qualifier: "Calificador de leads (filtra prospectos y entrega leads listos)",
  general: "Asistente general (conversación general, deriva cuando hace falta)",
  winback: "Ventas · recuperación (retoma los chats que cerraron sin venta)",
  postsale: "Post-venta (confirma la entrega, mide la satisfacción y promueve la recompra)",
};

// Uses the LLM as a prompt engineer to draft a system prompt for a virtual agent
// from a short natural-language brief. Falls back to the static profile template
// when the AI is not configured or the call fails.
export async function generateAgentPrompt(opts: {
  profileType: string;
  brief: string;
  agentName?: string | null;
  tone?: string | null;
  model?: string | null;
}): Promise<{ ok: boolean; systemPrompt: string; message: string | null }> {
  const template = PROFILE_PROMPTS[opts.profileType] ?? PROFILE_PROMPTS.general;
  const client = getOpenAIClient();
  if (!client) {
    return {
      ok: false,
      systemPrompt: template,
      message: "La IA no está configurada (falta la API key de OpenAI). Se cargó una plantilla base editable.",
    };
  }

  const profileLabel = PROFILE_LABELS[opts.profileType] ?? PROFILE_LABELS.general;
  const toneLine = opts.tone ? `Tono deseado: ${opts.tone}.` : "";
  const nameLine = opts.agentName ? `El agente se llama "${opts.agentName}".` : "";

  const system =
    `Eres un ingeniero de prompts experto. Redactas instrucciones de sistema (system prompts) para agentes virtuales de atención al cliente de ${businessFull} que atienden por WhatsApp, Instagram y Facebook. ` +
    "Devuelve ÚNICAMENTE el texto del prompt en español, sin comillas, sin encabezados ni explicaciones. " +
    "El prompt debe: definir el rol y objetivo del agente, dar pautas de estilo (breve y conversacional), prohibir inventar precios o promesas, y describir en qué situaciones debe derivar la conversación. " +
    "La derivación es silenciosa: indica que ante un tema fuera de su alcance no debe responderlo ni pedir datos sobre él, sino contestar solo con la palabra clave ESCALAR_A_HUMANO, sin anunciarle al cliente que no puede ayudarlo ni que lo va a transferir.";

  const user = [
    `Perfil del agente: ${profileLabel}.`,
    nameLine,
    toneLine,
    `Descripción del negocio y de lo que debe hacer este agente:\n${opts.brief}`,
    "Redacta el system prompt (máx. ~180 palabras).",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: opts.model || "gpt-5-mini",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      return { ok: false, systemPrompt: template, message: "La IA no devolvió contenido. Se cargó una plantilla base." };
    }
    return { ok: true, systemPrompt: text, message: null };
  } catch {
    return { ok: false, systemPrompt: template, message: "No se pudo contactar a la IA. Se cargó una plantilla base editable." };
  }
}

// Drafts a short description for an agent capability from its name (and optional
// brief). Falls back to a generic sentence when the AI is unavailable.
export async function generateCapabilityDescription(opts: {
  name: string;
  brief?: string | null;
}): Promise<{ ok: boolean; description: string; message: string | null }> {
  const fallback = `Capacidad para ${opts.name.toLowerCase()}.`;
  const client = getOpenAIClient();
  if (!client) {
    return { ok: false, description: fallback, message: "La IA no está configurada; se cargó una descripción base editable." };
  }
  const system =
    `Redactas descripciones breves y claras de una CAPACIDAD (habilidad) de un agente de atención al cliente de ${businessFull}. ` +
    "Devuelve ÚNICAMENTE la descripción en español (1-2 oraciones, máx. ~40 palabras), sin comillas ni encabezados. Describe qué sabe hacer el agente con esta capacidad.";
  const user = [`Capacidad: ${opts.name}.`, opts.brief ? `Contexto: ${opts.brief}` : ""].filter(Boolean).join("\n");
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return { ok: false, description: fallback, message: "La IA no devolvió contenido; se cargó una base editable." };
    return { ok: true, description: text, message: null };
  } catch {
    return { ok: false, description: fallback, message: "No se pudo contactar a la IA; se cargó una base editable." };
  }
}

// AI assistant behind the "IA" button in the knowledge-base question editor: it
// rewords the question so it is clear, complete and in the customer's terms
// (admins often type it as a note to themselves, e.g. "envio a domicilio" instead
// of "¿Envían a domicilio?"), and assigns it a category so similar questions land
// together and the filter box in the editor actually groups them. Reuses one of
// the categories already in this knowledge base when it fits, instead of
// inventing a near-duplicate ("Envíos" vs "Envío" vs "Entregas").
export async function generateKnowledgeQuestion(opts: {
  question: string;
  answer?: string | null;
  categories?: string[];
}): Promise<{ ok: boolean; question: string; category: string; message: string | null }> {
  const fallbackQuestion = opts.question.trim();
  const fallbackCategory = opts.categories?.[0] ?? "General";
  const client = getOpenAIClient();
  if (!client) {
    return {
      ok: false,
      question: fallbackQuestion,
      category: fallbackCategory,
      message: "La IA no está configurada; la pregunta quedó tal como se escribió.",
    };
  }

  const categories = (opts.categories ?? []).filter((c) => c.trim());
  const system =
    "Ayudas a mantener ordenada la base de conocimiento de un agente de atención al cliente. " +
    "A partir de una pregunta que un administrador escribió (a veces como una nota rápida, no como pregunta) y, si la da, su respuesta, devuelve ÚNICAMENTE un objeto JSON (sin texto adicional) con las claves exactas: question, category. " +
    "'question' = la misma pregunta reescrita en español, clara, completa y tal como la haría el cliente, terminada en '?'; conserva su sentido exacto, sin inventar información nueva ni cambiar lo que pregunta. " +
    "'category' = una categoría corta (2-4 palabras, en español) que agrupe esta pregunta con otras del mismo tema, para poder filtrarlas después. " +
    (categories.length
      ? `Si alguna de estas categorías ya existentes le queda bien, ÚSALA TAL CUAL (no la reformules ni crees una parecida): ${categories.join(", ")}. Solo si ninguna aplica, propón una nueva.`
      : "Aún no hay categorías creadas: propón la primera que tenga sentido para esta pregunta.");
  const user = [`Pregunta: ${opts.question.trim()}`, opts.answer?.trim() ? `Respuesta: ${opts.answer.trim()}` : ""]
    .filter(Boolean)
    .join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) {
      return { ok: false, question: fallbackQuestion, category: fallbackCategory, message: "La IA no devolvió contenido; la pregunta quedó igual." };
    }
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return { ok: false, question: fallbackQuestion, category: fallbackCategory, message: "La IA no devolvió contenido; la pregunta quedó igual." };
    }
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const question = cleanField(parsed.question) ?? fallbackQuestion;
    const category = cleanField(parsed.category) ?? fallbackCategory;
    return { ok: true, question, category, message: null };
  } catch {
    return { ok: false, question: fallbackQuestion, category: fallbackCategory, message: "No se pudo contactar a la IA; la pregunta quedó igual." };
  }
}

// Palabras con las que empieza el cargo dentro del nombre de un agente.
const ROLE_WORDS =
  /^(ejecutiv[oa]|asesor[a]?|asistente|agente|represent\w*|consultor[a]?|especialista|encargad[oa]|de|del|ia|bot|virtual)\b/i;

/**
 * El nombre con el que el agente se presenta al cliente. En el panel conviene que
 * la fila diga "Nico Ejecutivo de ventas" — así se sabe quién es quién —, pero al
 * cliente le llega "Soy Nico", sin departamento: para él hay un solo chat, y saber
 * que le contesta "el de ventas" solo le da a entender que lo van a pasear de un
 * área a otra.
 */
export function speakingName(agentName: string): string {
  // Lo que va tras una coma es siempre cargo ("Ana Isabel, Ejecutiva de…").
  const beforeComma = agentName.split(",")[0];
  const words: string[] = [];
  for (const word of beforeComma.trim().split(/\s+/)) {
    // El cargo empieza donde aparece su primera palabra; de ahí en adelante sobra.
    if (words.length > 0 && ROLE_WORDS.test(word)) break;
    words.push(word);
  }
  return words.join(" ") || agentName.trim();
}

export function buildSystemPrompt(opts: {
  agentName: string;
  profileType: string | null;
  customPrompt: string | null;
  capabilities?: Array<{
    name: string;
    description: string | null;
    category?: string | null;
    examples?: string | null;
    level?: string | null;
  }>;
  knowledge?: Array<{ name: string; content: string }>;
  contactContext?: string | null;
  // Trace of previous, already-closed conversations with this contact.
  referenceContext?: string | null;
  session?: {
    now: Date;
    startedAt: Date;
    isNew: boolean;
  };
  // El cliente está contestando a un seguimiento que escribimos nosotros (ver
  // lib/followups.ts): el agente tiene que saber por qué le escribió.
  followup?: {
    purpose: string;
    context: string | null;
  } | null;
  // La tasa del día y cómo pedir un monto en pesos (exchangeRatePromptBlock en
  // lib/exchange-rates.ts). Null cuando no hay tasa de hoy: sin ella el agente no
  // sabe de la marca y se rige por lo que diga su prompt.
  exchangeRate?: string | null;
  // Por dónde llega la conversación (whatsapp, instagram, facebook) y, en WhatsApp,
  // el número del cliente. Sin canal (el correo, un borrador) no se dice nada.
  channel?: string | null;
  phone?: string | null;
  // Los últimos mensajes de la sesión anterior, ya formateados con su hora, cuando
  // terminó hace poco (ver previousSessionTail en messaging.ts).
  previousTail?: string | null;
  // Lecciones activas de la memoria de aprendizaje (lib/agent-learning.ts).
  lessons?: string[];
  // Respuestas que el equipo aprobó en "Entrenar respuestas" (lib/answer-training.ts).
  guides?: Array<{ question: string; instruction: string }>;
}): string {
  const base =
    opts.customPrompt?.trim() ||
    PROFILE_PROMPTS[opts.profileType ?? "general"] ||
    PROFILE_PROMPTS.general;

  const contextBlock = opts.contactContext?.trim()
    ? `\n\nContexto del cliente (consúltalo para responder acorde a esta persona; no lo repitas literalmente):\n${opts.contactContext.trim()}`
    : "";

  // Explicitly fenced off from the live thread: the agent may use it if the
  // customer brings it up, but must never assume the old topic is still open.
  const referenceBlock = opts.referenceContext?.trim()
    ? `\n\nHISTORIAL DE CONVERSACIONES ANTERIORES YA CERRADAS (solo referencia, NO es la conversación actual):\n${opts.referenceContext.trim()}\nNo retomes estos temas por tu cuenta ni des por hecho que siguen abiertos. Úsalos únicamente si el cliente los menciona ahora.`
    : "";

  const sessionBlock = opts.session
    ? `\n\nMomento actual: ${formatWhen(opts.session.now)}.\nEsta conversación comenzó el ${formatWhen(opts.session.startedAt)}.${
        opts.session.isNew
          ? "\nATENCIÓN: es una CONVERSACIÓN NUEVA. El cliente ya había escrito antes, pero aquella conversación se cerró. Salúdalo y pregúntale en qué puede ayudarle hoy, partiendo de cero: no continúes ni menciones temas anteriores salvo que él los saque." +
            " Excepción: si su mensaje contesta a lo último que se le dijo antes (lo tienes abajo, en los últimos mensajes antes de esta conversación) —un 'gracias', un 'ok', una confirmación o un dato sobre algo que se le envió—, no lo saludes como nuevo ni le preguntes en qué puedes ayudarle: respóndele a eso en una línea."
          : ""
      }`
    : "";

  // Lo último que se habló antes de que empezara esta sesión. El cliente muchas
  // veces le contesta a eso ("Gracias" a la guía del envío que le mandaron, "puedo
  // recibir después de las 10" al formato del pedido), y sin verlo el agente solo
  // tenía un "Gracias" suelto al que responder "¿en qué puedo ayudarte?".
  const previousTailBlock = opts.previousTail?.trim()
    ? `\n\nÚLTIMOS MENSAJES ANTES DE ESTA CONVERSACIÓN (de la anterior, ya cerrada; úsalos para entender a qué responde el cliente, no para retomar temas por tu cuenta):\n${opts.previousTail.trim()}`
    : "";

  // Lo aprendido de chats reales donde una respuesta molestó al cliente
  // (lib/agent-learning.ts). Va detrás del conocimiento y con la advertencia de
  // que no manda sobre las reglas del negocio: una lección la redacta la IA.
  const lessonsBlock = opts.lessons?.length
    ? `\n\nAPRENDIZAJES DE CONVERSACIONES REALES (respuestas que ya frustraron a clientes; no las repitas):\n${opts.lessons
        .map((l) => `- ${l}`)
        .join("\n")}\nSi alguno choca con tus instrucciones de arriba (precios, escalamiento, límites de salud, pedidos), mandan tus instrucciones.`
    : "";

  // Lo que el equipo aprobó a mano en "Entrenar respuestas": vio la respuesta del
  // agente, la corrigió con indicaciones y la dio por buena. A diferencia de los
  // aprendizajes, que redacta la IA sola, esto es una decisión del equipo, así que
  // para esa pregunta manda. Los textos modelo van entre « » para delimitarlos, y
  // el modelo tiende a copiar las comillas (pasó con el mensaje de cómo comprar).
  const guidesBlock = opts.guides?.length
    ? `\n\nRESPUESTAS APROBADAS POR EL EQUIPO (el equipo revisó cómo respondes estas preguntas y aprobó cómo hacerlo; cuando te pregunten esto o algo equivalente, responde así aunque tu base de conocimiento o los aprendizajes digan otra cosa):\n${opts.guides
        .map((g) => `- Si preguntan «${g.question}» (o algo equivalente): ${g.instruction}`)
        .join("\n")}\nCuando una de estas instrucciones trae un texto modelo entre « », escríbelo sin las comillas.`
    : "";

  const followupBlock = opts.followup
    ? `\n\nSEGUIMIENTO: esta conversación la retomaste tú con un mensaje de ${opts.followup.purpose}, y el cliente está respondiendo a ese mensaje (es el tuyo más reciente del historial).${
        opts.followup.context?.trim() ? `\nPor qué le escribiste: ${opts.followup.context.trim()}` : ""
      }\nContinúa desde ahí: no lo saludes como si fuera una conversación nueva ni te vuelvas a presentar.`
    : "";

  const capsBlock = opts.capabilities?.length
    ? `\n\nCapacidades que dominas:\n${opts.capabilities
        .map((c) => {
          let line = `- ${c.name}`;
          if (c.category) line += ` [${c.category}]`;
          if (c.level) line += ` (nivel ${c.level})`;
          if (c.description) line += `: ${c.description}`;
          if (c.examples?.trim()) line += `\n  Ejemplos: ${c.examples.trim()}`;
          return line;
        })
        .join("\n")}`
    : "";

  const knowledgeBlock = opts.knowledge?.length
    ? `\n\nBase de conocimiento (usa esta información para responder con precisión; no la inventes ni la contradigas):\n${opts.knowledge
        .map((k) => `### ${k.name}\n${k.content}`)
        .join("\n\n")}`
    : "";

  const exchangeRateBlock = opts.exchangeRate?.trim() ? `\n\n${opts.exchangeRate.trim()}` : "";

  const canSendPhoto = PHOTO_ENABLED_PROFILES.has(opts.profileType ?? "general");
  const imagesConduct = canSendPhoto ? agentImagesConduct() : "";
  const imagesBlock = imagesConduct ? `\n\n${imagesConduct}` : "";

  // La conducta de agenda solo entra donde puede cumplirse: en una instancia sin
  // el módulo de citas, enseñarle la marca al modelo solo lograría que prometa
  // citas que nadie va a guardar.
  const canBook =
    isModuleEnabled("appointments") && APPOINTMENT_ENABLED_PROFILES.has(opts.profileType ?? "general");
  const appointmentBlock = canBook ? `\n\n${APPOINTMENT_CONDUCT}` : "";

  const identity = business.agentsIntroduceByName ? `Tu nombre es ${speakingName(opts.agentName)}. ` : "";
  const channel = channelPromptBlock(opts.channel, opts.phone);
  const channelBlock = channel ? `\n\n${channel}` : "";

  return `${identity}${base}${channelBlock}${sessionBlock}${followupBlock}${contextBlock}${referenceBlock}${previousTailBlock}${capsBlock}${knowledgeBlock}${exchangeRateBlock}${guidesBlock}${lessonsBlock}

${BASE_CONDUCT}

${SCOPE_CONDUCT}

${OPTIONS_CONDUCT}

${productConduct(canSendPhoto)}${imagesBlock}${appointmentBlock}

Reglas importantes:
- Responde siempre en español dominicano natural, cercano y sin jerga, con el mismo trato (tú o usted) en todos los mensajes.
- No inventes precios, stock, fechas ni promesas que no puedas cumplir.
- Cada mensaje del historial empieza con su hora entre corchetes ([dd/mm hh:mm]) solo para que ubiques el tiempo transcurrido. Nunca escribas esos corchetes en tu respuesta.
- Ten en cuenta el tiempo entre mensajes: si pasaron horas o días desde el último, trátalo como un contacto nuevo y no como una frase más de lo que se venía hablando.
- Para escalar, escribe literalmente la palabra clave ESCALAR_A_HUMANO. Si escalas porque el tema no te corresponde, esa palabra debe ser TODA tu respuesta: el sistema reasigna la conversación en silencio y el siguiente agente contesta.`;
}

// ── Pedidos ───────────────────────────────────────────────────────────────────

export type ExtractedOrderDetails = {
  product: string | null;
  quantity: number;
  address: string | null;
  email: string | null;
  // Las líneas del pedido vinculadas al catálogo (2026-10-04, para el
  // inventario). Vacío cuando no se pasó catálogo o nada casó con él.
  items: Array<{ slug: string; quantity: number }>;
};

// Lee el pedido del final de la conversación (producto, cantidad, dirección de
// envío) para no dejar el pedido en blanco esperando a que alguien lo transcriba
// a mano. Se llama justo cuando el cliente dice que pagó (PEDIDO_CONFIRMADO), así
// que el pedido está fresco en los últimos mensajes. El monto NO se extrae aquí:
// quien verifica el pago lo confirma contra la transferencia real, no contra lo
// que el chat diga.
export async function extractOrderDetails(
  transcript: string,
  catalog: Array<{ slug: string; name: string }> = [],
): Promise<ExtractedOrderDetails> {
  const fallback: ExtractedOrderDetails = { product: null, quantity: 1, address: null, email: null, items: [] };
  const client = getOpenAIClient();
  if (!client) return fallback;
  const trimmed = transcript.trim();
  if (!trimmed) return fallback;

  const system =
    "Lees el final de una conversación de ventas por chat donde el cliente acaba de decir que pagó. Devuelve ÚNICAMENTE un objeto JSON (sin texto adicional) con las claves exactas: product, quantity, address, email. " +
    "'product' = el o los productos que se acordó vender, tal como se nombraron en la conversación (por ejemplo 'Procollagen' o 'Kit de los 3 productos'), o null si no quedó claro. " +
    "'quantity' = cuántas unidades en total, como número entero; 1 si no se dijo cuántas. " +
    "'address' = la dirección o los datos de entrega que el cliente dio (calle, sector, oficina de Vimenpaq/Domex, ciudad…), tal cual los escribió, o null si no los dio. " +
    "'email' = el correo que el cliente dio para el rastreo del envío (se pide en pedidos a Estados Unidos), o null si no lo dio. " +
    "No inventes ni completes con nada que no esté en la conversación." +
    // 2026-10-04: las líneas del pedido contra el catálogo, para comprometer el
    // inventario. Se agrega a lo de arriba sin cambiarlo.
    (catalog.length
      ? " Además de esas claves, incluye 'items' = la lista de lo que se acordó vender, cada elemento {\"slug\": …, \"quantity\": …}, usando SOLO slugs de este catálogo (slug — nombre): " +
        catalog.map((p) => `${p.slug} — ${p.name}`).join("; ") +
        ". Un kit o paquete que esté en el catálogo va como su propio slug, no desarmado. Si un producto no está en el catálogo, déjalo fuera de 'items' (sigue en 'product'). Lista vacía si no quedó claro."
      : "");

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: trimmed.slice(-4000) },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return fallback;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const quantity = Number(parsed.quantity);
    const known = new Set(catalog.map((p) => p.slug));
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .map((raw) => {
        const entry = raw as Record<string, unknown>;
        const slug = typeof entry?.slug === "string" ? entry.slug.trim() : "";
        const qty = Number(entry?.quantity);
        return { slug, quantity: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : 1 };
      })
      .filter((item) => known.has(item.slug));
    return {
      product: cleanField(parsed.product),
      quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1,
      address: cleanField(parsed.address),
      email: cleanField(parsed.email),
      items,
    };
  } catch {
    return fallback;
  }
}

// ── Casos ─────────────────────────────────────────────────────────────────────

// Los tipos de caso, con la frase que los distingue. La lista viaja al modelo
// tal cual, así que se lee como se lee una instrucción: el orden importa poco,
// la precisión de cada línea mucho.
const CASE_TYPE_GUIDE = [
  ["volume_discount", "pide precio especial por comprar varias unidades, al por mayor, para revender o para un grupo"],
  ["partnership", "quiere afiliarse o desafiliarse del PROGRAMA DE AFILIADOS/REFERIDOS (link propio, código, comisión por venta), reclama por su link de afiliado, o propone distribuir, representar la marca o una alianza comercial"],
  ["subscription", "quiere afiliarse o desafiliarse de la COMPRA RECURRENTE del producto: que le sigan cobrando y enviando cada cierto tiempo automáticamente, o que dejen de hacerlo — no confundir con 'partnership' (programa de afiliados), que es lo que casi siempre significa 'afiliación' en este negocio"],
  ["order_status", "pregunta dónde está su pedido, cuándo llega o por qué se demora"],
  ["order_error", "recibió algo distinto a lo que compró, incompleto, dañado o con el envase abierto"],
  ["theft_report", "denuncia un robo, un paquete que desapareció, un cobro que no reconoce o un fraude con su tarjeta o con alguien que se hizo pasar por la marca"],
  ["payment_issue", "el pago le falló, le cobraron dos veces o la transferencia no se acredita"],
  ["refund", "pide que le devuelvan el dinero"],
  ["cancellation", "pide cancelar un pedido"],
  ["address_change", "quiere corregir la dirección, el teléfono o los datos de entrega"],
  ["product_quality", "reclama por el contenido, el peso, la caducidad o que el producto no le funcionó"],
  ["product_question", "pregunta cómo se toma, si puede tomarlo con su condición, o cuál producto le conviene"],
  ["other", "cualquier otra petición que pida una gestión y no encaje arriba"],
] as const;

export type DetectedCase = {
  type: (typeof CASE_TYPE_GUIDE)[number][0];
  subject: string;
  description: string;
  requestedAction: string | null;
  priority: "low" | "normal" | "high" | "urgent";
};

const CASE_TYPES = new Set<string>(CASE_TYPE_GUIDE.map(([t]) => t));
const CASE_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

/**
 * ¿Lo que escribió el cliente es una PETICIÓN que hay que gestionar, o solo
 * conversación? Devuelve null para lo segundo — que es la mayoría: un saludo,
 * un "gracias", una pregunta de precio que el agente contesta y ahí muere.
 *
 * Abrir un caso de más es peor que no abrirlo: la vista de Casos vale mientras
 * lo que hay dentro sea de verdad trabajo pendiente.
 */
export async function detectCustomerCase(text: string, context?: string | null): Promise<DetectedCase | null> {
  const client = getOpenAIClient();
  if (!client) return null;
  const trimmed = text.trim();
  if (trimmed.length < 15) return null;

  const system =
    "Lees lo que un cliente le escribió a una tienda y decides si abre un CASO: una petición que alguien del equipo tiene que gestionar (un reclamo, una devolución, un descuento por volumen, un robo, un error en el pedido, un dato que corregir, afiliarse o desafiliarse de la compra recurrente). " +
    "Responde ÚNICAMENTE un objeto JSON, sin texto alrededor.\n" +
    'Si NO es una petición que haya que gestionar —un saludo, un agradecimiento, una pregunta suelta de precio o de horario, publicidad que nos mandan, un correo automático— responde {"case": false}.\n' +
    'Si lo es, responde {"case": true, "type": …, "subject": …, "description": …, "requestedAction": …, "priority": …}.\n' +
    `'type' es uno de: ${CASE_TYPE_GUIDE.map(([t, d]) => `${t} (${d})`).join("; ")}.\n` +
    "'subject' = un título de menos de 80 caracteres que diga de qué es el caso, en español ('Reclama que el pote llegó a la mitad').\n" +
    "'description' = dos o tres líneas con lo que cuenta el cliente, sin adornos ni interpretaciones.\n" +
    "'requestedAction' = qué pide exactamente que hagamos ('que le repongan el pote', 'que le devuelvan los US$100'), o null si no lo dice.\n" +
    "'priority' = urgent para robo, fraude o cobro no reconocido; high para dinero de por medio, un pedido que no llegó o un producto en mal estado; normal para el resto; low para lo que no corre prisa.\n" +
    "No inventes datos que el cliente no haya escrito.";

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: system },
        { role: "user", content: [context ? `Contexto: ${context}` : "", trimmed.slice(0, 4000)].filter(Boolean).join("\n\n") },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return null;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (parsed.case !== true) return null;
    const type = typeof parsed.type === "string" && CASE_TYPES.has(parsed.type) ? parsed.type : "other";
    const subject = cleanField(parsed.subject);
    if (!subject) return null;
    const priority = typeof parsed.priority === "string" && CASE_PRIORITIES.has(parsed.priority) ? parsed.priority : "normal";
    return {
      type: type as DetectedCase["type"],
      subject: subject.slice(0, 120),
      description: (typeof parsed.description === "string" ? parsed.description.trim() : "").slice(0, 2000) || subject,
      requestedAction: cleanField(parsed.requestedAction),
      priority: priority as DetectedCase["priority"],
    };
  } catch {
    return null;
  }
}
