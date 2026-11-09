import express, { Router, type IRouter, type Request } from "express";
import crypto from "node:crypto";
import { z } from "zod/v4";
import { eq, and, or, desc, inArray, sql, type SQL } from "drizzle-orm";
import { db, conversationsTable, contactsTable, agentsTable, messagesTable, labelsTable, agentGroupsTable, whatsappNumbersTable, followupsTable } from "@workspace/db";
import {
  ListConversationsQueryParams,
  CreateConversationBody,
  UpdateConversationBody,
  UpdateConversationParams,
  GetConversationParams,
  AssignConversationParams,
  AssignConversationBody,
  ClaimConversationParams,
  ResolveConversationParams,
  MarkConversationReadParams,
  EscalateConversationParams,
  SendMessageBody,
  SendMessageParams,
  EditMessageBody,
  EditMessageParams,
  DeleteMessageParams,
  ListConversationsResponse,
  GetConversationResponse,
  ListMessagesResponse,
  ListMessagesParams,
  ListConversationTemplatesParams,
  ListConversationTemplatesResponse,
  SendMessageTemplateParams,
  SendMessageTemplateBody,
  MarkConversationSaleParams,
  MarkConversationSaleBody,
  ListConversationFollowupsParams,
  ListConversationFollowupsResponse,
  CancelConversationFollowupParams,
  CancelConversationFollowupResponse,
} from "@workspace/api-zod";
import {
  maybeRespondWithVirtualAgent,
  deliverConversationMessage,
  deliverConversationMedia,
  deliverConversationTemplate,
  messagingWindowState,
  maybeEnrichContactFromMessage,
  maybeUpdateContextAndProfile,
  type DeliveryOutcome,
} from "../lib/messaging";
import { fetchWhatsAppTemplates, buildTemplateComponents } from "../lib/meta";
import { loadIntegrationSettings } from "../lib/campaign-sender";
import { isStorageConfigured, uploadMedia } from "../lib/supabase";
import {
  MAX_ATTACHMENT_BYTES,
  cleanFileName,
  fileExtension,
  mediaPreview,
  mediaSummary,
  normalizeMime,
  outboundKind,
} from "../lib/media";
import { notifyChatAssigned, notifyChatQueued } from "../lib/push";
import { classifyAndRoute, escalateConversationToGroup } from "../lib/workflow-engine";
import { closeConversationSession, ensureActiveSession, openSessionForTeamMessage } from "../lib/conversation-session";
import { learnFromCustomerReaction, learnFromHumanCorrection } from "../lib/agent-learning";
import { markConversationSale, planFollowupsAfterClose } from "../lib/followups";
import { activeOrdersByConversationIds } from "../lib/orders";
import { isModuleEnabled } from "../lib/client-config";
import { requireView } from "../middlewares/auth";

const router: IRouter = Router();

type ConversationRow = typeof conversationsTable.$inferSelect;

function uniqueIds(ids: (number | null)[]): number[] {
  return [...new Set(ids.filter((id): id is number => id != null))];
}

function indexById<T extends { id: number }>(rows: T[]): Map<number, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

// Lo que la bandeja pinta junto a cada conversación, cargado en bloque: una
// consulta por tabla para toda la lista. Antes eran hasta cinco consultas por
// fila, y con cientos de conversaciones cada búsqueda lanzaba miles.
async function buildConversations(convs: ConversationRow[]) {
  const contactIds = uniqueIds(convs.map((c) => c.contactId));
  const agentIds = uniqueIds(convs.map((c) => c.agentId));
  const labelIds = uniqueIds(convs.flatMap((c) => [c.labelId, c.localityLabelId]));
  const groupIds = uniqueIds(convs.map((c) => c.groupId));
  const numberIds = uniqueIds(convs.map((c) => c.whatsappNumberId));

  const [contacts, agents, labels, groups, numbers, activeOrders] = await Promise.all([
    contactIds.length
      ? db
          .select({ id: contactsTable.id, name: contactsTable.name, phone: contactsTable.phone, avatar: contactsTable.avatar })
          .from(contactsTable)
          .where(inArray(contactsTable.id, contactIds))
      : [],
    agentIds.length
      ? db.select({ id: agentsTable.id, name: agentsTable.name }).from(agentsTable).where(inArray(agentsTable.id, agentIds))
      : [],
    labelIds.length
      ? db
          .select({ id: labelsTable.id, name: labelsTable.name, color: labelsTable.color })
          .from(labelsTable)
          .where(inArray(labelsTable.id, labelIds))
      : [],
    groupIds.length
      ? db
          .select({ id: agentGroupsTable.id, name: agentGroupsTable.name })
          .from(agentGroupsTable)
          .where(inArray(agentGroupsTable.id, groupIds))
      : [],
    numberIds.length
      ? db
          .select({ id: whatsappNumbersTable.id, label: whatsappNumbersTable.label, displayNumber: whatsappNumbersTable.displayNumber })
          .from(whatsappNumbersTable)
          .where(inArray(whatsappNumbersTable.id, numberIds))
      : [],
    activeOrdersByConversationIds(convs.map((c) => c.id)),
  ]);
  const contactById = indexById(contacts);
  const agentById = indexById(agents);
  const labelById = indexById(labels);
  const groupById = indexById(groups);
  const numberById = indexById(numbers);

  return convs.map((conv) => {
    const contact = conv.contactId != null ? contactById.get(conv.contactId) : undefined;
    const agent = conv.agentId != null ? agentById.get(conv.agentId) : undefined;
    const label = conv.labelId != null ? labelById.get(conv.labelId) : undefined;
    // La sucursal que le toca al cliente: explica en el panel por qué esta
    // conversación acabó en ese equipo y no en otro.
    const locality = conv.localityLabelId != null ? labelById.get(conv.localityLabelId) : undefined;
    const group = conv.groupId != null ? groupById.get(conv.groupId) : undefined;
    // Por cuál de nuestros números entró: es lo que la bandeja muestra como
    // distintivo para que el agente sepa a quién le está contestando.
    const number = conv.whatsappNumberId != null ? numberById.get(conv.whatsappNumberId) : undefined;

    const window = messagingWindowState(conv.lastCustomerMessageAt);

    return {
      ...conv,
      contactName: contact?.name ?? null,
      contactPhone: contact?.phone ?? null,
      contactAvatar: contact?.avatar ?? null,
      agentName: agent?.name ?? null,
      labelName: label?.name ?? null,
      labelColor: label?.color ?? null,
      localityName: locality?.name ?? null,
      localityColor: locality?.color ?? null,
      groupName: group?.name ?? null,
      activeOrder: activeOrders.get(conv.id) ?? null,
      whatsappNumberLabel: number?.label ?? null,
      whatsappNumberDisplay: number?.displayNumber ?? null,
      messagingWindowOpen: window.open,
      messagingWindowExpiresAt: window.expiresAt,
    };
  });
}

async function buildConversation(conv: ConversationRow) {
  const [enriched] = await buildConversations([conv]);
  return enriched;
}

// Ni WhatsApp, ni Messenger, ni Instagram dejan borrar o editar para el cliente
// un mensaje que el negocio ya mandó por su API — eso solo existe en las apps de
// consumidor. Por eso editar y borrar aquí son solo del panel: la fila real
// (`content`, `mediaUrl`, `mediaName`) nunca se toca y sigue siendo la consulta
// de auditoría directa por columna; lo que ve el front es esta vista aparte.
const DELETED_MESSAGE_PLACEHOLDER = "🚫 Este mensaje fue eliminado";

type MessageRow = typeof messagesTable.$inferSelect;

// Lo que el panel muestra de un mensaje: el texto editado, o el aviso si se borró.
function displayContent(m: MessageRow): string {
  if (m.isDeleted) return DELETED_MESSAGE_PLACEHOLDER;
  return m.isEdited && m.editedContent != null ? m.editedContent : m.content;
}

function toApiMessage(m: MessageRow, quoted: MessageRow | null = null) {
  const deleted = m.isDeleted;
  return {
    id: m.id,
    conversationId: m.conversationId,
    sender: m.sender,
    content: displayContent(m),
    // Borrado sale como texto y sin archivo: así ningún cliente —el panel, el
    // móvil, un aviso push— intenta pintar la foto o el audio que había detrás.
    type: deleted ? ("text" as const) : m.type,
    mediaUrl: deleted ? null : m.mediaUrl,
    mediaName: deleted ? null : m.mediaName,
    isAiSuggestion: m.isAiSuggestion,
    isInternal: m.isInternal,
    isEdited: m.isEdited,
    isDeleted: m.isDeleted,
    onChannel: m.externalMessageId != null,
    status: m.status,
    failedReason: m.failedReason,
    replyTo: quoted
      ? {
          id: quoted.id,
          sender: quoted.sender,
          content: displayContent(quoted),
          type: quoted.isDeleted ? ("text" as const) : quoted.type,
        }
      : null,
    createdAt: m.createdAt,
  };
}

// Mensajes listos para la API, con la cita de los que responden a otro. Los
// citados casi siempre vienen en el mismo lote; los que no —uno de otra
// conversación del mismo cliente— se cargan todos en una consulta.
async function serializeMessages(rows: MessageRow[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = uniqueIds(rows.map((r) => r.replyToMessageId)).filter((id) => !byId.has(id));
  if (missing.length) {
    const quoted = await db.select().from(messagesTable).where(inArray(messagesTable.id, missing));
    for (const q of quoted) byId.set(q.id, q);
  }
  return rows.map((r) => toApiMessage(r, r.replyToMessageId != null ? (byId.get(r.replyToMessageId) ?? null) : null));
}

async function serializeMessage(row: MessageRow) {
  const [out] = await serializeMessages([row]);
  return out;
}

// El mensaje que se cita al responder. Tiene que ser del mismo hilo, seguir
// visible y tener id en el canal: sin ese id Meta no puede mostrarle la cita al
// cliente, y el panel enseñaría una respuesta citada que en su teléfono no lo es.
async function loadReplyTarget(
  conversationId: number,
  messageId: number,
): Promise<{ ok: true; row: MessageRow } | { ok: false; error: string }> {
  const [row] = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.id, messageId), eq(messagesTable.conversationId, conversationId)));
  if (!row || row.isInternal) return { ok: false, error: "El mensaje que quieres responder no está en esta conversación." };
  if (row.isDeleted) return { ok: false, error: "No se puede responder un mensaje eliminado." };
  if (!row.externalMessageId) return { ok: false, error: "Ese mensaje no pasó por el canal, así que no se puede citar." };
  return { ok: true, row };
}

// El resumen que ve la lista de conversaciones. Sin esto, borrar o editar el
// último mensaje del hilo dejaba el texto viejo (o el que se acaba de borrar)
// en la vista previa, aunque el propio mensaje ya mostrara el cambio.
// Aplica a un mensaje ya guardado el resultado de su envío a Meta: si lo aceptó,
// le graba el id de canal (para poder citarlo o corregirlo después); si lo
// rechazó —típicamente la ventana de 24h cerrada— lo marca "failed", que es lo
// que pinta el icono de fallido en el panel, y deja además una nota interna con
// el motivo en el hilo, visible de inmediato sin pasar el mouse por el icono.
async function applyDeliveryOutcome(
  message: MessageRow,
  conv: ConversationRow,
  delivery: DeliveryOutcome,
  noun: string = "El mensaje",
): Promise<MessageRow> {
  let sent = message;
  if (delivery.externalMessageId) {
    [sent] = await db
      .update(messagesTable)
      .set({ externalMessageId: delivery.externalMessageId })
      .where(eq(messagesTable.id, message.id))
      .returning();
  }
  if (!delivery.ok) {
    [sent] = await db
      .update(messagesTable)
      .set({ status: "failed", failedReason: delivery.error ?? null })
      .where(eq(messagesTable.id, message.id))
      .returning();
    await db.insert(messagesTable).values({
      conversationId: conv.id,
      sender: "bot",
      content: `⚠️ ${noun} no le llegó al cliente: ${delivery.error ?? "el canal lo rechazó"}.`,
      type: "text",
      isAiSuggestion: false,
      isInternal: true,
    });
  }
  return sent;
}

async function recomputeLastMessage(conversationId: number) {
  const [latest] = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.conversationId, conversationId), eq(messagesTable.isInternal, false)))
    .orderBy(desc(messagesTable.id))
    .limit(1);
  await db
    .update(conversationsTable)
    .set({ lastMessage: latest ? displayContent(latest) : null })
    .where(eq(conversationsTable.id, conversationId));
}

router.get("/conversations", async (req, res): Promise<void> => {
  const query = ListConversationsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { channel, status, agentId, whatsappNumberId, contactId, read, search } = query.data;

  // Todo el filtrado va en la consulta. Antes se traía la tabla entera, se
  // completaba fila a fila y solo al final se descartaba lo que no coincidía.
  const conditions: SQL[] = [];
  if (channel && channel !== "all") conditions.push(eq(conversationsTable.channel, channel));
  if (status && status !== "all") conditions.push(eq(conversationsTable.status, status));
  if (agentId != null) conditions.push(eq(conversationsTable.agentId, agentId));
  if (whatsappNumberId != null) conditions.push(eq(conversationsTable.whatsappNumberId, whatsappNumberId));
  if (contactId != null) conditions.push(eq(conversationsTable.contactId, contactId));
  if (read === "unread") conditions.push(sql`${conversationsTable.unreadCount} > 0`);
  if (read === "read") conditions.push(eq(conversationsTable.unreadCount, 0));

  const term = search?.trim();
  if (term) {
    const like = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(
      or(sql`${contactsTable.name} ilike ${like}`, sql`${conversationsTable.lastMessage} ilike ${like}`)!,
    );
  }

  const rows = await db
    .select({ conversation: conversationsTable })
    .from(conversationsTable)
    .leftJoin(contactsTable, eq(contactsTable.id, conversationsTable.contactId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(conversationsTable.updatedAt));

  const enriched = await buildConversations(rows.map((r) => r.conversation));
  res.json(ListConversationsResponse.parse(enriched));
});

router.post("/conversations", requireView("inbox"), async (req, res): Promise<void> => {
  const parsed = CreateConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [conv] = await db
    .insert(conversationsTable)
    .values({
      channel: parsed.data.channel,
      contactId: parsed.data.contactId,
      agentId: parsed.data.agentId ?? null,
      status: "open",
      unreadCount: 0,
    })
    .returning();

  const enriched = await buildConversation(conv);
  res.status(201).json(GetConversationResponse.parse(enriched));
});

router.get("/conversations/:id", async (req, res): Promise<void> => {
  const params = GetConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, params.data.id));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const enriched = await buildConversation(conv);
  res.json(GetConversationResponse.parse(enriched));
});

router.patch("/conversations/:id", requireView("inbox"), async (req, res): Promise<void> => {
  const params = UpdateConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Partial<typeof conversationsTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.agentId !== undefined) updateData.agentId = parsed.data.agentId;
  if (parsed.data.label !== undefined) updateData.label = parsed.data.label as typeof updateData.label;
  if (parsed.data.labelId !== undefined) updateData.labelId = parsed.data.labelId;

  const [conv] = await db.update(conversationsTable).set(updateData).where(eq(conversationsTable.id, params.data.id)).returning();

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const enriched = await buildConversation(conv);
  res.json(GetConversationResponse.parse(enriched));
});

router.post("/conversations/:id/assign", requireView("inbox"), async (req, res): Promise<void> => {
  const params = AssignConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AssignConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [conv] = await db
    .update(conversationsTable)
    .set({ agentId: parsed.data.agentId, updatedAt: new Date() })
    .where(eq(conversationsTable.id, params.data.id))
    .returning();

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  // El agente se entera por el móvil aunque no tenga el panel abierto.
  if (parsed.data.agentId != null) {
    void notifyChatAssigned(conv, parsed.data.agentId, `asignado por ${req.user!.name}`, req.log);
  }

  const enriched = await buildConversation(conv);
  res.json(GetConversationResponse.parse(enriched));
});

// Deja la conversación en manos de `agent` y lo apunta en el propio hilo. La usan
// /claim y la respuesta de un agente desde el panel: quien contesta un chat se
// queda con él.
async function takeOverConversation(
  conv: typeof conversationsTable.$inferSelect,
  agent: { agentId: number; name: string },
) {
  const [previousAgent] = conv.agentId
    ? await db.select().from(agentsTable).where(eq(agentsTable.id, conv.agentId))
    : [null];

  const [updated] = await db
    .update(conversationsTable)
    .set({ agentId: agent.agentId, status: "open", updatedAt: new Date() })
    .where(eq(conversationsTable.id, conv.id))
    .returning();

  // Audit trail in the thread itself, same convention as /escalate.
  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: "bot",
    content: previousAgent
      ? `👤 ${agent.name} tomó la conversación (antes: ${previousAgent.name})`
      : `👤 ${agent.name} tomó la conversación`,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });

  return updated;
}

// Self-service takeover: an agent pulls a chat out of the general panel into
// their own inbox. Unlike /assign (admin-only) the target agent is the caller.
router.post("/conversations/:id/claim", async (req, res): Promise<void> => {
  const params = ClaimConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const claimerId = req.user?.agentId;
  if (!claimerId) {
    res.status(403).json({ error: "Solo un agente puede tomar una conversación." });
    return;
  }

  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, params.data.id));
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  if (conv.agentId === claimerId) {
    const enriched = await buildConversation(conv);
    res.json(GetConversationResponse.parse(enriched));
    return;
  }

  const updated = await takeOverConversation(conv, { agentId: claimerId, name: req.user!.name });

  const enriched = await buildConversation(updated);
  res.json(GetConversationResponse.parse(enriched));
});

router.post("/conversations/:id/escalate", async (req, res): Promise<void> => {
  const params = EscalateConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, params.data.id));
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  if (!conv.agentId) {
    res.status(409).json({ error: "Conversación sin agente asignado: no se puede escalar." });
    return;
  }

  const [currentAgent] = await db.select().from(agentsTable).where(eq(agentsTable.id, conv.agentId));
  if (!currentAgent?.escalateToAgentId && !currentAgent?.escalateToGroupId) {
    res.status(409).json({ error: "El agente actual no tiene un destino de escalación configurado." });
    return;
  }

  // Prefer escalating to a human group (distribution rules pick the member).
  if (currentAgent.escalateToGroupId) {
    const handed = await escalateConversationToGroup(params.data.id, currentAgent.escalateToGroupId, req.log);
    if (!handed) {
      res.status(409).json({ error: "No se pudo escalar al grupo (¿grupo vacío o inexistente?)." });
      return;
    }
    const [updated] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, params.data.id));
    // El grupo pudo repartirla a un miembro o dejarla en cola: en el primer caso
    // avisa a esa persona, en el segundo a quien tenga que repartirla.
    if (updated?.agentId) {
      void notifyChatAssigned(updated, updated.agentId, "escalada a tu grupo", req.log);
    } else if (updated) {
      const [group] = await db
        .select()
        .from(agentGroupsTable)
        .where(eq(agentGroupsTable.id, currentAgent.escalateToGroupId));
      void notifyChatQueued(updated, group?.name ?? "sin nombre", req.log);
    }
    const enriched = await buildConversation(updated);
    res.json(GetConversationResponse.parse(enriched));
    return;
  }

  const [target] = await db.select().from(agentsTable).where(eq(agentsTable.id, currentAgent.escalateToAgentId!));
  if (!target) {
    res.status(409).json({ error: "El agente destino de escalación ya no existe." });
    return;
  }

  const [updated] = await db
    .update(conversationsTable)
    .set({
      agentId: target.id,
      status: target.type === "human" ? "pending" : "open",
      updatedAt: new Date(),
    })
    .where(eq(conversationsTable.id, params.data.id))
    .returning();

  await db.insert(messagesTable).values({
    conversationId: params.data.id,
    sender: "bot",
    content: `🔁 Escalado de ${currentAgent.name} a ${target.name}`,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });

  void notifyChatAssigned(updated, target.id, `escalada desde ${currentAgent.name}`, req.log);

  const enriched = await buildConversation(updated);
  res.json(GetConversationResponse.parse(enriched));
});

router.post("/conversations/:id/resolve", async (req, res): Promise<void> => {
  const params = ResolveConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  // Resolving ends the conversation: its context is folded into the reference
  // history so the next message from this customer starts a new one.
  // Se decide aquí y no en el barrido: la sesión que se cierra al resolver ya no
  // pasa por él. En segundo plano, porque lee el chat con la IA.
  const closedNow = await closeConversationSession(params.data.id, "resuelta", req.log);
  if (closedNow && isModuleEnabled("aiAgents")) {
    void planFollowupsAfterClose(params.data.id, req.log);
  }
  // Una sesión que ya se había cerrado por inactividad no deja la nota del
  // cierre, y el estado "resuelta" se pierde en cuanto el cliente vuelve a
  // escribir. Esta nota es la que conserva cuándo se resolvió para los reportes.
  if (!closedNow && existing.status !== "resolved") {
    await db.insert(messagesTable).values({
      conversationId: params.data.id,
      sender: "bot",
      content: "🔚 Conversación marcada como resuelta.",
      type: "text",
      isAiSuggestion: false,
      isInternal: true,
    });
  }

  const [conv] = await db
    .update(conversationsTable)
    .set({ status: "resolved", updatedAt: new Date() })
    .where(eq(conversationsTable.id, params.data.id))
    .returning();

  const enriched = await buildConversation(conv);
  res.json(GetConversationResponse.parse(enriched));
});

router.post("/conversations/:id/read", async (req, res): Promise<void> => {
  const params = MarkConversationReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [conv] = await db
    .update(conversationsTable)
    .set({ unreadCount: 0 })
    .where(eq(conversationsTable.id, params.data.id))
    .returning();

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const enriched = await buildConversation(conv);
  res.json(GetConversationResponse.parse(enriched));
});

router.get("/conversations/:conversationId/messages", async (req, res): Promise<void> => {
  const params = ListMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, params.data.conversationId))
    .orderBy(messagesTable.createdAt);

  res.json(ListMessagesResponse.parse(await serializeMessages(messages)));
});

// Quién puede escribirle al cliente en esta conversación. Lo comparten el texto y
// los adjuntos: un admin, siempre; un agente, en sus chats, en los que no son de
// nadie y en los que está contestando un agente virtual —relevar al bot es justo
// lo que hace desde el Chat General, y ahí está la mayoría de los chats: el bot
// se queda con la conversación en cuanto responde—. Solo el chat que otra
// persona está atendiendo le queda cerrado, y para eso está /claim.
async function replyForbidden(
  user: Request["user"],
  conv: typeof conversationsTable.$inferSelect,
): Promise<string | null> {
  if (user?.role === "admin") return null;
  if (conv.agentId === null || conv.agentId === user?.agentId) return null;
  const [owner] = await db.select().from(agentsTable).where(eq(agentsTable.id, conv.agentId));
  if (owner?.type === "virtual") return null;
  return "Esta conversación está asignada a otro agente.";
}

// Un mensaje libre (texto o adjunto) solo sale dentro de la ventana de 24h de
// Meta desde el último mensaje real del cliente; pasada esa ventana el canal la
// rechaza igual, así que se corta antes en vez de gastar la llamada a Graph.
// Sin canal real (conversación interna/demo) no hay ventana que comprobar.
// La plantilla (sendMessageTemplate) es la única vía que sigue funcionando
// después: por eso este chequeo no aplica ahí.
function windowClosedError(conv: typeof conversationsTable.$inferSelect): string | null {
  if (!conv.externalId) return null;
  if (messagingWindowState(conv.lastCustomerMessageAt).open) return null;
  return conv.channel === "whatsapp"
    ? "La ventana de 24 horas para responder libremente está cerrada. Envía una plantilla aprobada para reabrir la conversación."
    : "La ventana de 24 horas para responder está cerrada. Espera a que el cliente vuelva a escribir.";
}

router.post("/conversations/:conversationId/messages", async (req, res): Promise<void> => {
  const params = SendMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const sender = parsed.data.sender ?? "agent";

  const [existing] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, params.data.conversationId));
  if (!existing) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  if (req.user?.role !== "admin" && sender !== "agent") {
    res.status(403).json({ error: "Solo un administrador puede enviar como cliente." });
    return;
  }
  const forbidden = await replyForbidden(req.user, existing);
  if (forbidden) {
    res.status(403).json({ error: forbidden });
    return;
  }
  if (sender === "agent") {
    const blocked = windowClosedError(existing);
    if (blocked) {
      res.status(409).json({ error: blocked });
      return;
    }
  }

  let replyTarget: MessageRow | null = null;
  if (parsed.data.replyToMessageId != null) {
    const target = await loadReplyTarget(existing.id, parsed.data.replyToMessageId);
    if (!target.ok) {
      res.status(409).json({ error: target.error });
      return;
    }
    replyTarget = target.row;
  }

  // Quien contesta un chat se queda con él, sin pasar antes por "Tomar". Si no,
  // la conversación seguía sin dueño —o a nombre del agente virtual— con una
  // persona ya atendiéndola: no aparecía en su bandeja y el bot podía hablar
  // encima. Va antes del mensaje para que el hilo lea "tomó" y luego la respuesta.
  // Si la conversación ya estaba cerrada, este mensaje abre una nueva: la
  // respuesta del cliente tiene que caer en la misma sesión que lo que se le mandó.
  if (sender === "agent") {
    await openSessionForTeamMessage(existing.id, req.user?.name ?? "el equipo", req.log);
  }
  if (sender === "agent" && req.user?.agentId && existing.agentId !== req.user.agentId) {
    await takeOverConversation(existing, { agentId: req.user.agentId, name: req.user.name });
  }

  // A simulated inbound goes through the same session boundary as a real one, so
  // testing from the panel after a pause behaves like a customer writing back.
  if (sender === "contact") {
    await ensureActiveSession(params.data.conversationId, parsed.data.content, req.log);
  }

  const [message] = await db
    .insert(messagesTable)
    .values({
      conversationId: params.data.conversationId,
      sender,
      content: parsed.data.content,
      type: parsed.data.type,
      isAiSuggestion: false,
      replyToMessageId: replyTarget?.id ?? null,
    })
    .returning();

  const [conv] = await db
    .update(conversationsTable)
    .set({
      lastMessage: parsed.data.content,
      // Un "contact" aquí es un inbound simulado desde el panel (probar el bot):
      // le abre la ventana de 24h igual que uno real, para que probarlo no deje
      // la conversación con la ventana cerrada por accidente.
      ...(sender === "contact" ? { lastCustomerMessageAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(conversationsTable.id, params.data.conversationId))
    .returning();

  // Memoria de aprendizaje (lib/agent-learning.ts): si una persona contesta justo
  // detrás del bot, o el cliente reacciona molesto, se compara con lo que dijo el bot.
  if (sender === "agent") learnFromHumanCorrection(existing.id, message.id, req.log);
  else learnFromCustomerReaction(existing.id, message.id, req.log);

  if (sender === "contact") {
    // Enrich the contact + update its profile/context from what the customer said.
    if (existing.contactId) {
      void maybeEnrichContactFromMessage(existing.contactId, parsed.data.content, req.log);
      void maybeUpdateContextAndProfile(existing.contactId, params.data.conversationId, req.log);
    }
    // Inbound (or simulated inbound): classify intent + route, then let an
    // assigned virtual agent reply unless the workflow handed it to a human.
    try {
      const { routedToHuman } = await classifyAndRoute(params.data.conversationId, req.log);
      if (!routedToHuman) {
        await maybeRespondWithVirtualAgent(params.data.conversationId, req.log);
      }
    } catch (err) {
      req.log.error({ err }, "virtual agent reply failed");
    }
  } else if (conv) {
    // Outbound from a human agent: deliver to the customer's real channel.
    let delivery: DeliveryOutcome;
    try {
      delivery = await deliverConversationMessage(conv, parsed.data.content, req.log, {
        replyTo: replyTarget?.externalMessageId,
      });
    } catch (err) {
      req.log.error({ err }, "meta delivery failed");
      delivery = { ok: false, externalMessageId: null, error: "error inesperado al enviarlo" };
    }
    const sent = await applyDeliveryOutcome(message, conv, delivery);
    res.status(201).json(await serializeMessage(sent));
    return;
  }

  res.status(201).json(await serializeMessage(message));
});

// Editar y borrar mensajes desde el panel. Cloud API, Messenger y la API de
// Instagram no dan forma de editar ni de borrar para el cliente un mensaje que el
// negocio ya mandó (probado contra Meta: `edit` no es un tipo válido y `revoke`
// es solo el aviso de que el CLIENTE borró uno suyo). Lo que cambia aquí es la
// copia del panel. Lo único que puede llegarle al cliente es una corrección como
// mensaje nuevo que cita al original; borrar no tiene equivalente. Quién puede
// tocar esta conversación es la misma regla que decide quién puede contestarle
// (replyForbidden).
router.patch("/conversations/:conversationId/messages/:messageId", async (req, res): Promise<void> => {
  const params = EditMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = EditMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, params.data.conversationId));
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const forbidden = await replyForbidden(req.user, conv);
  if (forbidden) {
    res.status(403).json({ error: forbidden });
    return;
  }

  const [existing] = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.id, params.data.messageId), eq(messagesTable.conversationId, conv.id)));
  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  if (existing.isInternal) {
    res.status(409).json({ error: "No se puede editar una nota interna." });
    return;
  }
  if (existing.isDeleted) {
    res.status(409).json({ error: "El mensaje ya fue eliminado." });
    return;
  }
  if (existing.sender === "contact") {
    res.status(409).json({ error: "No se puede editar un mensaje del cliente." });
    return;
  }
  if (existing.type !== "text") {
    res.status(409).json({ error: "Solo se puede editar un mensaje de texto." });
    return;
  }

  const [updated] = await db
    .update(messagesTable)
    .set({
      editedContent: parsed.data.content,
      isEdited: true,
      editedAt: new Date(),
      editedByAgentId: req.user?.agentId ?? null,
    })
    .where(eq(messagesTable.id, existing.id))
    .returning();

  // La corrección es un mensaje más del hilo: el panel muestra lo mismo que el
  // teléfono del cliente, el original y debajo la corrección que lo cita.
  if (parsed.data.sendCorrection && existing.externalMessageId) {
    await openSessionForTeamMessage(conv.id, req.user?.name ?? "el equipo", req.log);
    if (req.user?.agentId && conv.agentId !== req.user.agentId) {
      await takeOverConversation(conv, { agentId: req.user.agentId, name: req.user.name });
    }
    const correctionText = `✏️ Corrección: ${parsed.data.content}`;
    const [correction] = await db
      .insert(messagesTable)
      .values({
        conversationId: conv.id,
        sender: "agent",
        content: correctionText,
        type: "text",
        isAiSuggestion: false,
        replyToMessageId: existing.id,
      })
      .returning();
    await db.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, conv.id));

    let delivery: DeliveryOutcome;
    try {
      delivery = await deliverConversationMessage(conv, correctionText, req.log, { replyTo: existing.externalMessageId });
    } catch (err) {
      req.log.error({ err }, "meta correction delivery failed");
      delivery = { ok: false, externalMessageId: null, error: "error inesperado al enviarla" };
    }
    await applyDeliveryOutcome(correction, conv, delivery, "La corrección");
  }

  await recomputeLastMessage(conv.id);

  res.json(await serializeMessage(updated));
});

router.delete("/conversations/:conversationId/messages/:messageId", async (req, res): Promise<void> => {
  const params = DeleteMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, params.data.conversationId));
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const forbidden = await replyForbidden(req.user, conv);
  if (forbidden) {
    res.status(403).json({ error: forbidden });
    return;
  }

  const [existing] = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.id, params.data.messageId), eq(messagesTable.conversationId, conv.id)));
  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  if (existing.isInternal) {
    res.status(409).json({ error: "No se puede eliminar una nota interna." });
    return;
  }
  if (existing.isDeleted) {
    res.status(409).json({ error: "El mensaje ya fue eliminado." });
    return;
  }
  // Lo que escribió el cliente sigue en su WhatsApp pase lo que pase: ocultarlo
  // del panel dejaría al equipo viendo una conversación distinta de la real.
  if (existing.sender === "contact") {
    res.status(409).json({ error: "No se puede eliminar un mensaje del cliente." });
    return;
  }

  const [updated] = await db
    .update(messagesTable)
    .set({
      isDeleted: true,
      deletedAt: new Date(),
      deletedByAgentId: req.user?.agentId ?? null,
    })
    .where(eq(messagesTable.id, existing.id))
    .returning();

  await recomputeLastMessage(conv.id);

  res.json(await serializeMessage(updated));
});

// Un archivo que el equipo le manda al cliente: foto, video, audio o documento.
// Cuerpo binario crudo, como las imágenes de los mensajes personalizados, y fuera
// del contrato OpenAPI por la misma razón: orval no tiene buena forma para un
// cuerpo binario. Nombre, tipo y pie viajan en la query.
//
// Los clientes lo mandan como application/octet-stream sea cual sea el archivo:
// con su tipo real, un .json adjunto se lo comería el parser JSON global antes de
// llegar aquí.
const AttachmentQuery = z.object({
  name: z.string().max(300).optional(),
  type: z.string().max(200).optional(),
  caption: z.string().trim().max(1024).optional(),
  // El mensaje al que responde el archivo, como en replyToMessageId del texto.
  replyTo: z.coerce.number().int().positive().optional(),
});

router.post(
  "/conversations/:conversationId/attachments",
  express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
  async (req, res): Promise<void> => {
    const params = SendMessageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const query = AttachmentQuery.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }
    const data: unknown = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) {
      res.status(400).json({ error: "El archivo está vacío." });
      return;
    }
    if (!isStorageConfigured()) {
      res.status(503).json({ error: "El almacenamiento de archivos no está configurado." });
      return;
    }

    const [existing] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, params.data.conversationId));
    if (!existing) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const forbidden = await replyForbidden(req.user, existing);
    if (forbidden) {
      res.status(403).json({ error: forbidden });
      return;
    }
    const blocked = windowClosedError(existing);
    if (blocked) {
      res.status(409).json({ error: blocked });
      return;
    }
    let replyTarget: MessageRow | null = null;
    if (query.data.replyTo != null) {
      const target = await loadReplyTarget(existing.id, query.data.replyTo);
      if (!target.ok) {
        res.status(409).json({ error: target.error });
        return;
      }
      replyTarget = target.row;
    }

    const mimeType = normalizeMime(query.data.type);
    const givenName = cleanFileName(query.data.name);
    const ext = fileExtension(mimeType, givenName);
    const name = givenName ?? `archivo.${ext}`;
    const caption = query.data.caption || null;
    const kind = outboundKind(mimeType, data.length, existing.channel);
    const path = `chat-${existing.id}-${crypto.randomUUID()}.${ext}`;

    if (!(await uploadMedia(path, data, mimeType))) {
      res.status(502).json({ error: "No se pudo guardar el archivo." });
      return;
    }

    // Igual que al contestar con texto: quien manda un archivo se queda con el chat.
    await openSessionForTeamMessage(existing.id, req.user?.name ?? "el equipo", req.log);
    if (req.user?.agentId && existing.agentId !== req.user.agentId) {
      await takeOverConversation(existing, { agentId: req.user.agentId, name: req.user.name });
    }

    const content = caption ?? mediaSummary(kind, name);
    const [message] = await db
      .insert(messagesTable)
      .values({
        conversationId: existing.id,
        sender: "agent",
        content,
        type: kind,
        mediaUrl: `/api/media/${path}`,
        mediaName: name,
        isAiSuggestion: false,
        replyToMessageId: replyTarget?.id ?? null,
      })
      .returning();

    const [conv] = await db
      .update(conversationsTable)
      .set({ lastMessage: mediaPreview(kind, name, content), updatedAt: new Date() })
      .where(eq(conversationsTable.id, existing.id))
      .returning();

    // Si el canal lo rechaza, el archivo ya está en el hilo y quien lo mandó cree
    // que salió. La nota interna lo deja a la vista, en el panel y en el móvil.
    let delivery: DeliveryOutcome;
    try {
      delivery = await deliverConversationMedia(conv, { kind, path, data, mimeType, name, caption }, req.log, {
        replyTo: replyTarget?.externalMessageId,
      });
    } catch (err) {
      req.log.error({ err }, "meta media delivery failed");
      delivery = { ok: false, externalMessageId: null, error: "error inesperado al enviarlo" };
    }
    const sent = await applyDeliveryOutcome(message, conv, delivery, "El archivo");

    res.status(201).json(await serializeMessage(sent));
  },
);

// Plantillas de WhatsApp aprobadas por Meta que se le pueden mandar a este
// cliente. Solo existen para WhatsApp: Instagram y Facebook no tienen catálogo
// de plantillas descargable, así que ahí sale vacío en vez de error — es lo que
// permite al front decidir sin preguntar primero por el canal.
router.get("/conversations/:conversationId/templates", async (req, res): Promise<void> => {
  const params = ListConversationTemplatesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, params.data.conversationId));
  if (!existing) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const forbidden = await replyForbidden(req.user, existing);
  if (forbidden) {
    res.status(403).json({ error: forbidden });
    return;
  }
  if (existing.channel !== "whatsapp") {
    res.json(ListConversationTemplatesResponse.parse([]));
    return;
  }

  const settings = await loadIntegrationSettings();
  if (!settings) {
    res.status(400).json({ error: "No hay configuración de integraciones." });
    return;
  }
  const result = await fetchWhatsAppTemplates(settings);
  if (!result.ok) {
    res.status(502).json({ error: result.error });
    return;
  }
  // Solo tiene sentido ofrecer las ya aprobadas: una en revisión o rechazada
  // Meta la rechazaría igual al enviarla.
  const approved = result.templates.filter((t) => t.status === "APPROVED");
  res.json(ListConversationTemplatesResponse.parse(approved));
});

// Reabre una conversación cuya ventana de 24h cerró, con una plantilla ya
// aprobada. A diferencia del envío libre, esto funciona precisamente PORQUE la
// ventana está cerrada — por eso no pasa por windowClosedError.
router.post("/conversations/:conversationId/messages/template", async (req, res): Promise<void> => {
  const params = SendMessageTemplateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SendMessageTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, params.data.conversationId));
  if (!existing) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const forbidden = await replyForbidden(req.user, existing);
  if (forbidden) {
    res.status(403).json({ error: forbidden });
    return;
  }
  if (existing.channel !== "whatsapp") {
    res.status(400).json({ error: "Las plantillas de Meta solo existen para WhatsApp." });
    return;
  }
  if (!existing.externalId) {
    res.status(400).json({ error: "Esta conversación no tiene un canal real al que enviarle." });
    return;
  }

  await openSessionForTeamMessage(existing.id, req.user?.name ?? "el equipo", req.log);
  if (req.user?.agentId && existing.agentId !== req.user.agentId) {
    await takeOverConversation(existing, { agentId: req.user.agentId, name: req.user.name });
  }

  const components = buildTemplateComponents({ variables: parsed.data.variables ?? [] });
  const content = `📋 Plantilla: ${parsed.data.name}`;
  const [message] = await db
    .insert(messagesTable)
    .values({
      conversationId: existing.id,
      sender: "agent",
      content,
      type: "template",
      isAiSuggestion: false,
    })
    .returning();

  const [conv] = await db
    .update(conversationsTable)
    .set({ lastMessage: content, updatedAt: new Date() })
    .where(eq(conversationsTable.id, existing.id))
    .returning();

  let delivery: DeliveryOutcome;
  try {
    delivery = await deliverConversationTemplate(
      conv,
      { name: parsed.data.name, language: parsed.data.language, components },
      req.log,
    );
  } catch (err) {
    req.log.error({ err }, "meta template delivery failed");
    delivery = { ok: false, externalMessageId: null, error: "error inesperado al enviarla" };
  }
  const sent = await applyDeliveryOutcome(message, conv, delivery, "La plantilla");

  res.status(201).json(await serializeMessage(sent));
});

// ── Venta cerrada y seguimientos ──────────────────────────────────────────────
// Lo marca quien atiende el chat: con eso el sistema sabe que no hay venta que
// recuperar y que toca acompañar la entrega (lib/followups.ts).
router.post("/conversations/:id/sale", async (req, res): Promise<void> => {
  const params = MarkConversationSaleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = MarkConversationSaleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const forbidden = await replyForbidden(req.user, existing);
  if (forbidden) {
    res.status(403).json({ error: forbidden });
    return;
  }

  const updated = await markConversationSale(
    existing.id,
    {
      closed: parsed.data.closed,
      product: parsed.data.product ?? null,
      agentId: req.user?.agentId ?? null,
      agentName: req.user?.name ?? "Un agente",
    },
    req.log,
  );
  if (!updated) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.json(GetConversationResponse.parse(await buildConversation(updated)));
});

function toApiFollowup(f: typeof followupsTable.$inferSelect, agentName: string | null) {
  return {
    id: f.id,
    conversationId: f.conversationId,
    agentId: f.agentId,
    agentName,
    kind: f.kind,
    status: f.status,
    dueAt: f.dueAt,
    attempts: f.attempts,
    product: f.product,
    templateName: f.templateName,
    sentAt: f.sentAt,
    repliedAt: f.repliedAt,
    detail: f.detail,
    createdAt: f.createdAt,
  };
}

router.get("/conversations/:id/followups", async (req, res): Promise<void> => {
  const params = ListConversationFollowupsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select({ followup: followupsTable, agentName: agentsTable.name })
    .from(followupsTable)
    .leftJoin(agentsTable, eq(agentsTable.id, followupsTable.agentId))
    .where(eq(followupsTable.conversationId, params.data.id))
    .orderBy(desc(followupsTable.createdAt))
    .limit(50);
  res.json(ListConversationFollowupsResponse.parse(rows.map((r) => toApiFollowup(r.followup, r.agentName))));
});

router.post("/conversations/:id/followups/:followupId/cancel", async (req, res): Promise<void> => {
  const params = CancelConversationFollowupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const forbidden = await replyForbidden(req.user, existing);
  if (forbidden) {
    res.status(403).json({ error: forbidden });
    return;
  }
  const who = req.user?.name ?? "un agente";
  const [cancelled] = await db
    .update(followupsTable)
    .set({ status: "cancelled", detail: `cancelado por ${who}`, updatedAt: new Date() })
    .where(
      and(
        eq(followupsTable.id, params.data.followupId),
        eq(followupsTable.conversationId, existing.id),
        eq(followupsTable.status, "scheduled"),
      ),
    )
    .returning();
  if (!cancelled) {
    res.status(404).json({ error: "Ese seguimiento ya no está pendiente." });
    return;
  }
  await db.insert(messagesTable).values({
    conversationId: existing.id,
    sender: "bot",
    content: `🚫 ${who} canceló un seguimiento programado.`,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });
  const [agent] = cancelled.agentId
    ? await db.select({ name: agentsTable.name }).from(agentsTable).where(eq(agentsTable.id, cancelled.agentId))
    : [];
  res.json(CancelConversationFollowupResponse.parse(toApiFollowup(cancelled, agent?.name ?? null)));
});

export default router;
