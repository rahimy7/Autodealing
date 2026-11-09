// Casos: las peticiones de los clientes que hay que GESTIONAR, no solo
// contestar. Un descuento por volumen, un paquete que no llegó, un cobro que
// nadie reconoce, un pote que vino a la mitad. Antes eso vivía suelto dentro de
// un correo o de un chat y se perdía entre mensajes nuevos.
//
// Un caso se abre solo (la IA lee lo que escribió el cliente y decide si es una
// petición) o a mano desde el panel, y se cierra de una de dos maneras, que es
// la distinción que pidió el negocio:
//
//   · RESPONDIENDO  — la petición era una inquietud y la respuesta la resuelve.
//   · ACCIONANDO    — hubo que hacer algo (reponer, devolver, aplicar el descuento).
//
// Y una tercera, honesta: `rejected`, lo que se atendió y no procedía.
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  db,
  casesTable,
  caseEventsTable,
  contactsTable,
  agentsTable,
  messagesTable,
  emailMessagesTable,
  type Case,
  type CaseEvent,
} from "@workspace/db";
import { loadSettings, type Log } from "./messaging";
import { deliverMessage } from "./meta";
import { detectCustomerCase, getOpenAIClient, buildSystemPrompt, type DetectedCase } from "./openai-client";
import { collectAgentContext } from "./feed";
import { sanitizeAiEmailReply, stripQuotedReply } from "./email-format";
import { clientConfig } from "./client-config";
import { detectPastoralRequest, PASTORAL_TYPES } from "./pastoral-requests";

const church = clientConfig.id === "linaje-real";
export function isCaseTypeAllowed(type: string): boolean {
  return church ? (PASTORAL_TYPES as readonly string[]).includes(type) : !(PASTORAL_TYPES as readonly string[]).includes(type);
}

export const CASE_TYPES = [
  "prayer_request",
  "visitation",
  "bible_study",
  "worship",
  "volume_discount",
  "partnership",
  "subscription",
  "order_status",
  "order_error",
  "theft_report",
  "payment_issue",
  "refund",
  "cancellation",
  "address_change",
  "product_quality",
  "product_question",
  "other",
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "cancelled"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const CASE_RESOLUTION_KINDS = ["answered", "actioned", "rejected"] as const;
export type CaseResolutionKind = (typeof CASE_RESOLUTION_KINDS)[number];

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  prayer_request: "Petición de oración",
  visitation: "Visitación",
  bible_study: "Estudio bíblico",
  worship: "Culto",
  volume_discount: "Descuento por volumen",
  partnership: "Afiliados, distribución o alianza",
  subscription: "Afiliación o desafiliación",
  order_status: "Estado del pedido",
  order_error: "Error en el pedido",
  theft_report: "Robo o fraude",
  payment_issue: "Problema de pago",
  refund: "Devolución de dinero",
  cancellation: "Cancelación",
  address_change: "Cambio de datos de envío",
  product_quality: "Calidad del producto",
  product_question: "Consulta sobre el producto",
  other: "Otra petición",
};

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  open: church ? "Pendiente" : "Abierto",
  in_progress: church ? "En atención" : "En gestión",
  waiting_customer: church ? "Esperando respuesta" : "Esperando al cliente",
  resolved: church ? "Atendida" : "Resuelto",
  cancelled: church ? "Cancelada" : "Cancelado",
};

// Un caso que ya terminó no vuelve a contar como trabajo pendiente ni bloquea
// que se abra otro para la misma conversación.
const TERMINAL_STATUSES = new Set<CaseStatus>(["resolved", "cancelled"]);

export function isOpenCaseStatus(status: CaseStatus): boolean {
  return !TERMINAL_STATUSES.has(status);
}

// Como el código del pedido: sale del id al servirlo, no se guarda.
export function caseCode(id: number): string {
  return `${church ? "PET" : "CASO"}-${String(id).padStart(6, "0")}`;
}

// ── Expediente ────────────────────────────────────────────────────────────────

export type CaseEventKind = "opened" | "status" | "note" | "reply" | "action" | "assigned" | "resolved";

export async function logCaseEvent(
  caseId: number,
  kind: CaseEventKind,
  body: string,
  agentId: number | null = null,
): Promise<CaseEvent> {
  const [row] = await db.insert(caseEventsTable).values({ caseId, kind, body, agentId }).returning();
  return row;
}

// ── Serialización ─────────────────────────────────────────────────────────────

export type SerializedCase = Awaited<ReturnType<typeof serializeCases>>[number];

export async function serializeCases(rows: Case[]) {
  const contactIds = [...new Set(rows.map((c) => c.contactId))];
  const agentIds = [
    ...new Set(
      rows.flatMap((c) => [c.assignedAgentId, c.createdByAgentId]).filter((id): id is number => id != null),
    ),
  ];

  const [contacts, agents] = await Promise.all([
    contactIds.length
      ? db
          .select({ id: contactsTable.id, name: contactsTable.name, phone: contactsTable.phone, email: contactsTable.email })
          .from(contactsTable)
          .where(inArray(contactsTable.id, contactIds))
      : [],
    agentIds.length
      ? db.select({ id: agentsTable.id, name: agentsTable.name }).from(agentsTable).where(inArray(agentsTable.id, agentIds))
      : [],
  ]);
  const contactById = new Map(contacts.map((c) => [c.id, c] as const));
  const agentById = new Map(agents.map((a) => [a.id, a] as const));

  return rows.map((c) => {
    const contact = contactById.get(c.contactId);
    return {
      id: c.id,
      code: caseCode(c.id),
      contactId: c.contactId,
      contactName: contact?.name ?? null,
      contactPhone: contact?.phone ?? null,
      contactEmail: contact?.email ?? null,
      type: c.type as CaseType,
      status: c.status as CaseStatus,
      priority: c.priority as CasePriority,
      channel: c.channel,
      emailThreadId: c.emailThreadId,
      conversationId: c.conversationId,
      orderId: c.orderId,
      subject: c.subject,
      description: c.description,
      requestedAction: c.requestedAction,
      resolutionKind: (c.resolutionKind as CaseResolutionKind | null) ?? null,
      resolution: c.resolution,
      assignedAgentId: c.assignedAgentId,
      assignedAgentName: c.assignedAgentId != null ? (agentById.get(c.assignedAgentId)?.name ?? null) : null,
      createdByAgentName: c.createdByAgentId != null ? (agentById.get(c.createdByAgentId)?.name ?? null) : null,
      openedByAi: c.openedByAi,
      resolvedAt: c.resolvedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  });
}

export async function serializeCase(row: Case) {
  const [out] = await serializeCases([row]);
  return out;
}

export async function caseEventsFor(caseId: number) {
  const rows = await db
    .select()
    .from(caseEventsTable)
    .where(eq(caseEventsTable.caseId, caseId))
    .orderBy(caseEventsTable.createdAt, caseEventsTable.id);
  const agentIds = [...new Set(rows.map((e) => e.agentId).filter((id): id is number => id != null))];
  const agents = agentIds.length
    ? await db.select({ id: agentsTable.id, name: agentsTable.name }).from(agentsTable).where(inArray(agentsTable.id, agentIds))
    : [];
  const agentById = new Map(agents.map((a) => [a.id, a.name] as const));
  return rows.map((e) => ({
    id: e.id,
    kind: e.kind as CaseEventKind,
    body: e.body,
    agentName: e.agentId != null ? (agentById.get(e.agentId) ?? null) : null,
    createdAt: e.createdAt,
  }));
}

// Afiliación o desafiliación: el negocio pidió que SIEMPRE quede como caso,
// sin depender de que la IA lo reconozca como petición — "afiliar" cubre
// también "desafiliar", "afiliado/a" y "afiliarme/te" por ser subcadena. Son
// DOS cosas de negocio distintas que comparten la misma palabra:
//   · el programa de afiliados/referidos (link propio, comisión por venta) → "partnership"
//   · la compra recurrente del producto (que le sigan cobrando y enviando) → "subscription"
// Revisando el historial real, lo que los clientes escriben es casi siempre lo
// primero ("mi link de afiliada", "el plan de afiliados"); por eso el tipo por
// defecto cuando la IA no distingue cuál de las dos es "partnership" (ver
// SUBSCRIPTION_HINT_RE más abajo para el caso contrario).
export const AFFILIATION_RE = /afiliaci[oó]n|afiliad[oa]s?\b|afiliar/i;

// Lo que distingue a la compra recurrente del programa de afiliados cuando
// ambas comparten la palabra "afiliad-": que el cliente hable de que le
// cobren o le envíen periódicamente, no de un link o una comisión.
const SUBSCRIPTION_HINT_RE = /compra recurrente|suscripci[oó]n|cobro (mensual|recurrente|autom[aá]tico)|me (sigan|vuelvan a) cobrar|cancelar (mi|la) suscripci[oó]n|env[ií]o (mensual|recurrente|autom[aá]tico)/i;

// ── Apertura ──────────────────────────────────────────────────────────────────

/**
 * El caso sin terminar de este origen, si lo hay. Un cliente que insiste tres
 * veces por el mismo paquete perdido tiene UN caso, no tres: lo nuevo que
 * escriba se anota en el expediente del que ya está abierto.
 */
export async function openCaseFor(
  origin: { emailThreadId?: number | null; conversationId?: number | null; type?: CaseType },
): Promise<Case | null> {
  const conditions = [];
  if (origin.emailThreadId != null) conditions.push(eq(casesTable.emailThreadId, origin.emailThreadId));
  if (origin.conversationId != null) conditions.push(eq(casesTable.conversationId, origin.conversationId));
  if (conditions.length === 0) return null;
  const rows = await db
    .select()
    .from(casesTable)
    .where(and(or(...conditions)!, origin.type ? eq(casesTable.type, origin.type) : undefined, inArray(casesTable.status, ["open", "in_progress", "waiting_customer"])))
    .orderBy(desc(casesTable.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export type OpenCaseInput = {
  contactId: number;
  channel: string;
  type: CaseType;
  subject: string;
  description?: string | null;
  requestedAction?: string | null;
  priority?: CasePriority;
  emailThreadId?: number | null;
  conversationId?: number | null;
  orderId?: number | null;
  createdByAgentId?: number | null;
  openedByAi?: boolean;
};

export async function createCase(input: OpenCaseInput): Promise<Case> {
  if (!isCaseTypeAllowed(input.type)) throw new Error("Tipo de petición no disponible para esta instancia.");
  const [row] = await db
    .insert(casesTable)
    .values({
      contactId: input.contactId,
      channel: input.channel,
      type: input.type,
      subject: input.subject.slice(0, 200),
      description: input.description ?? null,
      requestedAction: input.requestedAction ?? null,
      priority: input.priority ?? "normal",
      emailThreadId: input.emailThreadId ?? null,
      conversationId: input.conversationId ?? null,
      orderId: input.orderId ?? null,
      createdByAgentId: input.createdByAgentId ?? null,
      openedByAi: input.openedByAi ?? false,
    })
    .returning();
  await logCaseEvent(
    row.id,
    "opened",
    input.openedByAi
      ? church ? `Petición registrada desde ${input.channel}.` : `Abierto automáticamente al leer lo que escribió el cliente por ${input.channel}.`
      : church ? "Petición registrada desde el panel." : "Abierto a mano desde el panel.",
    input.createdByAgentId ?? null,
  );
  return row;
}

/**
 * Lee lo que acaba de escribir el cliente y abre un caso si es una petición que
 * alguien tiene que gestionar. Si ya había uno abierto para ese mismo origen, no
 * abre otro: anota en su expediente que el cliente volvió a escribir.
 *
 * Nunca lanza — que el detector falle no puede tumbar la entrada de un correo ni
 * la respuesta de un chat.
 */
export async function maybeOpenCase(
  input: {
    contactId: number;
    channel: string;
    text: string;
    context?: string | null;
    emailThreadId?: number | null;
    conversationId?: number | null;
    /**
     * Avisar por WhatsApp al equipo si el caso sale urgente. Se apaga al ponerse
     * al día con un buzón atrasado: quince avisos de golpe por correos de hace
     * tres semanas no son una alerta, son ruido.
     */
    notify?: boolean;
  },
  log: Log,
): Promise<Case | null> {
  try {
    if (church) {
      const request = detectPastoralRequest(input.text);
      if (!request) return null;
      const existing = await openCaseFor({ ...input, type: request.type });
      if (existing) return existing;
      const row = await createCase({
        contactId: input.contactId, channel: input.channel, type: request.type,
        subject: request.subject, description: input.text.slice(0, 2000),
        conversationId: input.conversationId ?? null, emailThreadId: input.emailThreadId ?? null,
        openedByAi: true,
      });
      if (row.conversationId != null) await noteCaseInChat(row, "registrada");
      log.info({ requestId: row.id, type: row.type }, "pastoral request registered");
      // Prayer details stay in the authenticated record; no external notification.
      return row;
    }
    const existing = await openCaseFor(input);
    if (existing) {
      await logCaseEvent(existing.id, "note", `El cliente volvió a escribir por ${input.channel}.`);
      return existing;
    }
    const detectedByAi = await detectCustomerCase(input.text, input.context);
    // Afiliación/desafiliación abre caso siempre, así el detector de la IA no
    // lo reconozca como petición gestionable — el negocio lo pidió sin
    // excepción, por cualquier canal.
    const isAffiliation = AFFILIATION_RE.test(input.text);
    const detected: DetectedCase | null =
      detectedByAi && (!isAffiliation || detectedByAi.type !== "other")
        ? detectedByAi
        : isAffiliation
          ? SUBSCRIPTION_HINT_RE.test(input.text)
            ? {
                type: "subscription",
                subject: "Afiliación o desafiliación a la compra recurrente",
                description: input.text.slice(0, 500),
                requestedAction: null,
                priority: "normal",
              }
            : {
                type: "partnership",
                subject: "Afiliación o desafiliación del programa de afiliados",
                description: input.text.slice(0, 500),
                requestedAction: null,
                priority: "normal",
              }
          : detectedByAi;
    if (!detected) return null;

    const row = await createCase({
      contactId: input.contactId,
      channel: input.channel,
      type: detected.type,
      subject: detected.subject,
      description: detected.description,
      requestedAction: detected.requestedAction,
      priority: detected.priority,
      emailThreadId: input.emailThreadId ?? null,
      conversationId: input.conversationId ?? null,
      openedByAi: true,
    });
    log.info({ caseId: row.id, type: row.type, priority: row.priority, channel: input.channel }, "case opened by ai");

    if (input.conversationId != null) await noteCaseInChat(row, "abierto");
    if (input.notify !== false) void notifyCaseOpened(row, log);
    return row;
  } catch (err) {
    log.error({ err, channel: input.channel }, "case detection failed");
    return null;
  }
}

// Deja constancia en el propio chat, como hace el pedido: quien lea esa
// conversación entiende que lo que pidió el cliente quedó registrado y dónde.
async function noteCaseInChat(row: Case, what: string): Promise<void> {
  if (row.conversationId == null) return;
  await db.insert(messagesTable).values({
    conversationId: row.conversationId,
    sender: "bot",
    content: `🗂️ ${church ? "Petición" : "Caso"} ${caseCode(row.id)} ${what}: ${row.subject}`,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });
}

// ── Aviso al equipo ───────────────────────────────────────────────────────────

// Un robo o un cobro que el cliente no reconoce no puede esperar a que alguien
// abra el panel. Va por WhatsApp al mismo número del equipo que ya recibe los
// pedidos (business.orderNotificationPhone); sin número configurado, no hace
// nada. Solo lo urgente y lo alto: avisar de todo es no avisar de nada.
export async function notifyCaseOpened(row: Case, log: Log): Promise<void> {
  const to = clientConfig.business.orderNotificationPhone;
  if (!to) return;
  if (row.priority !== "urgent" && row.priority !== "high") return;

  const [contact] = await db
    .select({ name: contactsTable.name, phone: contactsTable.phone, email: contactsTable.email })
    .from(contactsTable)
    .where(eq(contactsTable.id, row.contactId));

  const lines = [
    `${row.priority === "urgent" ? "🚨" : "⚠️"} Caso ${caseCode(row.id)} — ${CASE_TYPE_LABELS[row.type as CaseType]}`,
    row.subject,
    `Cliente: ${contact?.name ?? "Sin nombre"}${contact?.phone ? ` · ${contact.phone}` : ""}${contact?.email ? ` · ${contact.email}` : ""}`,
  ];
  if (row.requestedAction) lines.push(`Pide: ${row.requestedAction}`);
  lines.push(`Entró por ${row.channel}.`);

  try {
    const settings = await loadSettings();
    if (!settings) return;
    const result = await deliverMessage(settings, "whatsapp", to, lines.join("\n"));
    if (!result.ok && !result.skipped) log.error({ caseId: row.id, error: result.error }, "case notification failed");
  } catch (err) {
    log.error({ err, caseId: row.id }, "case notification crashed");
  }
}

// ── Cierre ────────────────────────────────────────────────────────────────────

export const CASE_RESOLUTION_LABELS: Record<CaseResolutionKind, string> = {
  answered: church ? "Orientación brindada" : "Resuelto respondiendo",
  actioned: church ? "Atención realizada" : "Resuelto accionando",
  rejected: "Atendido, no procede",
};

/**
 * Cierra el caso diciendo CÓMO se cerró. `resolution` es lo que se le dijo al
 * cliente o lo que se hizo — sin eso el caso queda cerrado y nadie sabe qué pasó,
 * que es exactamente el problema que la vista viene a resolver.
 */
export async function resolveCase(
  caseId: number,
  input: { kind: CaseResolutionKind; resolution: string; agentId: number | null },
  log: Log,
): Promise<Case | null> {
  const [row] = await db
    .update(casesTable)
    .set({
      status: "resolved",
      resolutionKind: input.kind,
      resolution: input.resolution,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(casesTable.id, caseId))
    .returning();
  if (!row) return null;
  await logCaseEvent(row.id, "resolved", `${CASE_RESOLUTION_LABELS[input.kind]}: ${input.resolution}`, input.agentId);
  if (row.conversationId != null) await noteCaseInChat(row, church ? "atendida" : "resuelto");
  log.info({ caseId: row.id, kind: input.kind }, "case resolved");
  return row;
}

// ── Consultas para otras vistas ───────────────────────────────────────────────

/** Los casos sin cerrar de estos hilos de correo, para la pastilla del hilo. */
export async function openCasesByEmailThreadIds(threadIds: number[]): Promise<Map<number, Case[]>> {
  const ids = [...new Set(threadIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(casesTable)
    .where(
      and(inArray(casesTable.emailThreadId, ids), inArray(casesTable.status, ["open", "in_progress", "waiting_customer"])),
    );
  const out = new Map<number, Case[]>();
  for (const row of rows) {
    if (row.emailThreadId == null) continue;
    const arr = out.get(row.emailThreadId);
    if (arr) arr.push(row);
    else out.set(row.emailThreadId, [row]);
  }
  return out;
}

/** Cuántos casos hay sin cerrar. Lo pide el menú para la pastilla del contador. */
export async function openCaseCount(): Promise<number> {
  const rows = await db
    .select({ id: casesTable.id })
    .from(casesTable)
    .where(inArray(casesTable.status, ["open", "in_progress", "waiting_customer"]));
  return rows.length;
}

// ── Qué contestar o qué hacer ─────────────────────────────────────────────────

// El caso llega con lo que el cliente escribió; la sugerencia lo cruza con lo
// que la empresa sabe (las mismas bases de conocimiento que usan los agentes) y
// propone una de dos cosas: el texto de la respuesta, o la gestión que hay que
// hacer. Nunca las dos a medias, y nunca una respuesta inventada: sin base para
// contestar, propone la gestión y deja el texto vacío.
export type CaseSuggestion = {
  kind: CaseResolutionKind;
  reply: string | null;
  action: string | null;
  note: string | null;
};

async function caseSourceTranscript(row: Case): Promise<string> {
  if (row.emailThreadId != null) {
    const rows = await db
      .select({ direction: emailMessagesTable.direction, bodyText: emailMessagesTable.bodyText, sentAt: emailMessagesTable.sentAt })
      .from(emailMessagesTable)
      .where(
        and(
          eq(emailMessagesTable.threadId, row.emailThreadId),
          eq(emailMessagesTable.isDraft, false),
          eq(emailMessagesTable.isInternal, false),
        ),
      )
      .orderBy(desc(emailMessagesTable.sentAt))
      .limit(8);
    return rows
      .reverse()
      .map((m) => `${m.direction === "in" ? "Cliente" : "Nosotros"}: ${stripQuotedReply(m.bodyText).slice(0, 2000)}`)
      .join("\n\n");
  }
  if (row.conversationId != null) {
    const rows = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.conversationId, row.conversationId), eq(messagesTable.isInternal, false)))
      .orderBy(desc(messagesTable.createdAt))
      .limit(20);
    return rows
      .reverse()
      .map((m) => `${m.sender === "contact" ? "Cliente" : "Nosotros"}: ${m.content}`)
      .join("\n");
  }
  return "";
}

async function pickVirtualAgentForCases(channel: string) {
  const candidates = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.type, "virtual"), eq(agentsTable.isActive, true)))
    .orderBy(agentsTable.id);
  return (
    candidates.find((a) => (a.channels ?? []).includes(channel)) ??
    candidates.find((a) => (a.channels ?? []).length === 0) ??
    candidates[0] ??
    null
  );
}

export async function suggestCaseResolution(row: Case, log: Log): Promise<CaseSuggestion> {
  const client = getOpenAIClient();
  if (!client) return { kind: "actioned", reply: null, action: null, note: "La IA no está configurada en esta instancia." };

  const agent = await pickVirtualAgentForCases(row.channel);
  if (!agent) return { kind: "actioned", reply: null, action: null, note: "No hay ningún agente virtual activo del que tomar el conocimiento." };
  const ctx = await collectAgentContext(agent.id);
  if (!ctx) return { kind: "actioned", reply: null, action: null, note: "El agente ya no existe." };

  const systemPrompt = buildSystemPrompt({
    agentName: agent.name,
    profileType: agent.profileType,
    customPrompt: agent.systemPrompt,
    capabilities: ctx.caps.map((c) => ({
      name: c.name,
      description: c.description,
      category: c.category,
      examples: c.examples,
      level: c.level,
    })),
    knowledge: ctx.kbs.filter((k) => k.content?.trim()).map((k) => ({ name: k.name, content: k.content })),
    contactContext: null,
    exchangeRate: null,
  });

  const instructions = church ? `Estás ayudando al equipo de la Iglesia Adventista Linaje Real con una petición de oración, visitación, estudio bíblico o culto.
Devuelve únicamente JSON con kind (answered, actioned o rejected), reply, action y note.
Propón una respuesta breve y respetuosa o una gestión pastoral concreta. No inventes horarios, disponibilidad, inscripciones ni visitas confirmadas. No prometas curaciones ni resultados espirituales.
No des diagnósticos ni sustituyas atención profesional. No incluyas información de otras personas. No solicites detalles privados innecesarios. El equipo revisará cualquier propuesta antes de enviarla.
Si falta información, indícalo en note y propón en action qué debe confirmar el equipo; reply puede ser null.` : `AHORA NO ESTÁS CHATEANDO: estás resolviendo un CASO interno del equipo.
Devuelve ÚNICAMENTE un objeto JSON con las claves: kind, reply, action, note.
- "kind": "answered" si con lo que sabes el caso se resuelve CONTESTÁNDOLE al cliente; "actioned" si hace falta que una persona haga algo (devolver dinero, reponer un envío, autorizar un descuento, revisar con el courier); "rejected" si lo que pide no procede según las políticas que conoces.
- "reply": el texto que habría que enviarle al cliente, listo para mandar, si y solo si lo puedes fundamentar en lo que sabes. Si no tienes la información, "reply": null. NUNCA inventes precios, plazos, políticas ni promesas. NUNCA escribas que vas a escalar, transferir, consultar con el equipo ni que alguien se pondrá en contacto.
- "action": qué tiene que hacer el equipo, en una o dos líneas, cuando contestar no alcanza. Null si no hace falta.
- "note": por qué no puedes proponer nada, si es el caso. Null si propusiste algo.
El precio, las cuentas, los envíos y las políticas salen SOLO de lo que tienes arriba.`;

  const transcript = await caseSourceTranscript(row);
  const user = [
    `Tipo de caso: ${CASE_TYPE_LABELS[row.type as CaseType]}`,
    `Asunto: ${row.subject}`,
    row.description ? `Lo que cuenta el cliente: ${row.description}` : "",
    row.requestedAction ? `Lo que pide: ${row.requestedAction}` : "",
    transcript ? `\nConversación:\n${transcript}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: `${systemPrompt}\n\n${instructions}` },
        { role: "user", content: user },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    const match = raw?.match(/\{[\s\S]*\}/);
    if (!match) return { kind: "actioned", reply: null, action: null, note: "La IA no devolvió una propuesta." };
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const kind = CASE_RESOLUTION_KINDS.includes(parsed.kind as CaseResolutionKind)
      ? (parsed.kind as CaseResolutionKind)
      : "actioned";
    const clean = (v: unknown): string | null => {
      if (typeof v !== "string") return null;
      const t = sanitizeAiEmailReply(v).text.trim();
      return t || null;
    };
    return { kind, reply: clean(parsed.reply), action: clean(parsed.action), note: clean(parsed.note) };
  } catch (err) {
    log.error({ err, caseId: row.id }, "case suggestion failed");
    return { kind: "actioned", reply: null, action: null, note: "La IA no pudo analizar el caso." };
  }
}
