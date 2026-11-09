import { and, desc, eq, gt, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import {
  db,
  conversationsTable,
  contactsTable,
  agentsTable,
  messagesTable,
  workflowsTable,
  followupsTable,
  productsTable,
  ordersTable,
  type Followup,
  type FollowupKind,
  type WorkflowTriggerEvent,
} from "@workspace/db";
import {
  composeAgentFollowup,
  deliverConversationMessage,
  maybeRespondWithVirtualAgent,
  humanHandoffStillFresh,
  type DeliveryOutcome,
  type Log,
} from "./messaging";
import { activeWorkflowsFor } from "./workflow-engine";
import { triggersForEvent, triggerNumber } from "./workflow-graph";
import { analyzeClosedSession, pendingReplyNeed } from "./openai-client";
import { historyContent } from "./media";
import { clientConfig, isModuleEnabled } from "./client-config";
import { formatShort, humanizeGap, localClock, localDayKey } from "./time";
import {
  FOLLOWUP_KIND_LABELS,
  MARKETING_KINDS,
  POST_SALE_KINDS,
  SELF_STARTED_KINDS,
  TRIGGER_DEFAULTS,
  WINBACK_COOLDOWN_MS,
  COURTESY_CONTEXT,
  addBusinessDays,
  deliveryBusinessDays,
  pendingNudge,
  canSendFreeform,
  customerOnlyGreeted,
  isBareAcknowledgement,
  postSaleOrderGate,
  quietHoursDelayMs,
  winbackInstruction,
} from "./followup-rules";

// ── Motor de seguimientos ─────────────────────────────────────────────────────
// Lo que un agente virtual hace sin que el cliente haya escrito: retomar un chat
// que cerró sin venta, acompañar una venta hasta la entrega y la recompra, y
// contestar a quien se quedó esperando. Qué se hace y con qué agente lo deciden
// los nodos "trigger" de los workflows activos; aquí solo está el cómo.
//
// Todo pasa por la tabla `followups`: primero se programa (con su motivo en una
// nota interna del chat, para que el equipo lo vea y pueda cancelarlo) y el
// barrido del scheduler lo envía cuando vence, volviendo a comprobar en ese
// momento que siga teniendo sentido.

type Conversation = typeof conversationsTable.$inferSelect;
type Agent = typeof agentsTable.$inferSelect;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Post-venta: con el cliente en plena conversación no se le interrumpe; se
// pospone y se reintenta. Tras estos intentos sale igual.
const LIVE_CHAT_MS = 2 * HOUR_MS;
const POSTPONE_MS = 6 * HOUR_MS;
const MAX_LIVE_POSTPONES = 4;
// Hasta cuánto hacia atrás se busca a quien se quedó sin respuesta.
const UNANSWERED_LOOKBACK_MS = 72 * HOUR_MS;
// Post-venta esperando a que el pedido salga: se vuelve a mirar cada tanto, y
// pasado este tiempo desde que se programó, se da por perdido.
const ORDER_RECHECK_MS = 12 * HOUR_MS;
const ORDER_WAIT_LIMIT_MS = 21 * DAY_MS;
// Qué pedido cuenta para el post-venta: el más reciente del cliente, abierto
// desde un poco antes de programar el seguimiento (el pedido suele crearse con
// PEDIDO_CONFIRMADO, antes de que la conversación cierre).
const ORDER_LOOKBACK_MS = 30 * DAY_MS;

const planning = new Set<number>();
const sending = new Set<number>();

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

// El disparador que aplica a un canal para un evento: el del flujo más
// específico, como en el enrutado por etiqueta. Uno solo, para no duplicar envíos.
async function activeTrigger(channel: Conversation["channel"], event: WorkflowTriggerEvent) {
  for (const wf of await activeWorkflowsFor(channel)) {
    const [first] = triggersForEvent(wf.graph, event);
    if (first) return { ...first, workflowId: wf.id };
  }
  return null;
}

async function activeVirtualAgent(agentId: number | null): Promise<Agent | null> {
  if (!agentId) return null;
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  return agent && agent.type === "virtual" && agent.isActive ? agent : null;
}

async function sessionMessages(conv: Conversation) {
  return db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conv.id),
        gte(messagesTable.createdAt, conv.sessionStartedAt),
        eq(messagesTable.isInternal, false),
      ),
    )
    .orderBy(messagesTable.createdAt);
}

// Los últimos mensajes de la sesión anterior a la actual, para leer a qué contesta
// el cliente cuando la sesión empezó con su mensaje.
async function previousSessionRows(conv: Conversation) {
  const rows = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conv.id),
        lt(messagesTable.createdAt, conv.sessionStartedAt),
        eq(messagesTable.isInternal, false),
      ),
    )
    .orderBy(desc(messagesTable.createdAt))
    .limit(4);
  return rows.reverse();
}

function transcriptOf(rows: Array<typeof messagesTable.$inferSelect>): string {
  return rows
    .map((m) => {
      const who = m.sender === "contact" ? "Cliente" : m.sender === "bot" ? "Agente IA" : "Agente";
      return `[${formatShort(m.createdAt)}] ${who}: ${historyContent(m)}`;
    })
    .join("\n");
}

async function catalogNames(): Promise<string[]> {
  // Lo mismo que ve el agente: lo que publica la web y sigue activo (no los kits
  // ni los productos creados en el panel para el inventario).
  const rows = await db
    .select({ name: productsTable.name })
    .from(productsTable)
    .where(and(eq(productsTable.source, "import"), eq(productsTable.active, true)))
    .limit(300);
  return rows.map((r) => r.name);
}

function hasSaleThisSession(conv: Conversation): boolean {
  return conv.saleClosedAt != null && conv.saleClosedAt.getTime() >= conv.sessionStartedAt.getTime();
}

// ¿Esta sesión la abrió el cliente contestando a un post-venta nuestro? Si es así,
// lo que diga aquí ("sí, ya lo recibí") no vuelve a armar el ciclo: ya está armado
// y es justo el que le escribió.
async function answeringPostSaleFollowup(conv: Conversation): Promise<boolean> {
  if (conv.followupId == null) return false;
  const [followup] = await db
    .select({ kind: followupsTable.kind })
    .from(followupsTable)
    .where(eq(followupsTable.id, conv.followupId));
  return followup != null && POST_SALE_KINDS.includes(followup.kind);
}

function dayLabel(date: Date): string {
  return formatShort(date).split(" ")[0];
}

// Inserta el seguimiento si esa gestión no estaba ya programada para esta sesión.
async function schedule(values: typeof followupsTable.$inferInsert): Promise<Followup | null> {
  const [row] = await db
    .insert(followupsTable)
    .values(values)
    .onConflictDoNothing({
      target: [followupsTable.conversationId, followupsTable.kind, followupsTable.sessionStartedAt],
    })
    .returning();
  return row ?? null;
}

async function schedulePostSale(
  conv: Conversation,
  trigger: NonNullable<Awaited<ReturnType<typeof activeTrigger>>>,
  product: string | null,
  context: string | null,
  from: Date,
  log: Log,
): Promise<void> {
  const agent = await activeVirtualAgent(trigger.agentId);
  if (!agent) {
    log.warn({ conversationId: conv.id, agentId: trigger.agentId }, "post-venta no programado: el agente está inactivo");
    return;
  }
  const steps: Array<[FollowupKind, number]> = [
    ["delivery_check", triggerNumber(trigger.trigger.data.deliveryDays, TRIGGER_DEFAULTS.deliveryDays)],
    ["satisfaction", triggerNumber(trigger.trigger.data.satisfactionDays, TRIGGER_DEFAULTS.satisfactionDays)],
    ["repurchase", triggerNumber(trigger.trigger.data.repurchaseDays, TRIGGER_DEFAULTS.repurchaseDays)],
  ];
  const scheduled: string[] = [];
  for (const [kind, days] of steps) {
    if (days <= 0) continue;
    const dueAt = new Date(from.getTime() + days * DAY_MS);
    const row = await schedule({
      conversationId: conv.id,
      contactId: conv.contactId,
      agentId: agent.id,
      workflowId: trigger.workflowId,
      kind,
      dueAt,
      product,
      context: [product ? `Compró ${product}.` : "Compró en esta conversación.", context].filter(Boolean).join(" "),
      sessionStartedAt: conv.sessionStartedAt,
    });
    if (row) scheduled.push(`${FOLLOWUP_KIND_LABELS[kind]} el ${dayLabel(dueAt)}`);
  }
  if (scheduled.length) {
    await note(conv.id, `📦 Post-venta programado con ${agent.name}: ${scheduled.join(", ")}.`);
    log.info({ conversationId: conv.id, agentId: agent.id, steps: scheduled.length }, "post-sale follow-ups scheduled");
  }
}

// ── Al cerrarse una conversación ──────────────────────────────────────────────
// Lee el chat y decide: si hubo venta (marcada por el agente o detectada por la
// IA), arranca el post-venta; si no, y cerró con una etiqueta del disparador y
// quedó una oportunidad, programa el intento del agente de ventas.
export async function planFollowupsAfterClose(conversationId: number, log: Log): Promise<void> {
  if (planning.has(conversationId)) return;
  planning.add(conversationId);
  try {
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
    // Las plantillas solo existen en WhatsApp: en Instagram y Facebook, pasada la
    // ventana de 24h, no hay forma de escribirle al cliente.
    if (!conv?.closedAt || conv.channel !== "whatsapp" || !conv.externalId) return;

    const [winbackTrigger, saleTrigger] = await Promise.all([
      activeTrigger(conv.channel, "closed_no_sale"),
      activeTrigger(conv.channel, "sale_closed"),
    ]);
    if (!winbackTrigger && !saleTrigger) return;

    const rows = await sessionMessages(conv);
    if (!rows.some((m) => m.sender === "contact")) return;

    const markedSale = hasSaleThisSession(conv);
    // Quien solo saludó no dejó nada que analizar, y es justo a quien hay que
    // venderle: recibió la bienvenida (o el saludo del agente) y no volvió a
    // escribir. La IA lo daba por "ya atendido" y no se le escribía.
    const onlyGreeted = customerOnlyGreeted(rows);
    const analysis = onlyGreeted
      ? null
      : await analyzeClosedSession({ transcript: transcriptOf(rows), catalog: await catalogNames() });

    let saleProduct = conv.saleProduct ?? analysis?.product ?? null;
    if (!markedSale && analysis?.sale) {
      await db
        .update(conversationsTable)
        .set({ saleClosedAt: conv.closedAt, saleProduct, saleSource: "ai" })
        .where(eq(conversationsTable.id, conv.id));
      await note(
        conv.id,
        `🧾 La IA detectó una venta cerrada${saleProduct ? ` (${saleProduct})` : ""}: ${analysis.reason}. Si no es así, desmárcala con "Venta cerrada".`,
      );
    } else if (markedSale && !conv.saleProduct && saleProduct) {
      await db.update(conversationsTable).set({ saleProduct }).where(eq(conversationsTable.id, conv.id));
    }

    if (markedSale || analysis?.sale) {
      // Contestar a nuestro propio post-venta no es una venta nueva. 2026-09-20: a
      // una clienta se le preguntó "¿llegó tu pedido?", contestó "Sí, ya lo
      // recibí", la IA leyó esa confirmación como venta cerrada al cerrarse la
      // sesión y le rearmó el ciclo entero — dos horas después le volvió a
      // preguntar si le había llegado. El ciclo se arma al cerrar la venta, no
      // cada vez que el cliente responde a lo que ese ciclo le manda.
      if (saleTrigger && !(await answeringPostSaleFollowup(conv))) {
        await schedulePostSale(conv, saleTrigger, saleProduct, analysis?.summary ?? null, new Date(), log);
      } else if (saleTrigger) {
        await note(conv.id, "📦 Post-venta no reprogramado: el cliente estaba contestando al post-venta anterior.");
      }
      return;
    }

    if (!winbackTrigger) return;
    const labelIds = winbackTrigger.trigger.data.labelIds ?? [];
    if (labelIds.length > 0 && (conv.labelId == null || !labelIds.includes(conv.labelId))) return;

    let opportunity: { product: string | null; reason: string; context: string };
    if (onlyGreeted) {
      opportunity = {
        product: null,
        reason: "solo saludó y no volvió a escribir",
        context: "El cliente solo saludó y no dijo qué buscaba.",
      };
    } else if (!analysis) {
      log.warn({ conversationId }, "winback no programado: no se pudo analizar la conversación");
      return;
    } else if (!analysis.opportunity) {
      await note(conv.id, `💡 Sin seguimiento de ventas: ${analysis.reason}.`);
      return;
    } else {
      opportunity = {
        product: analysis.product,
        reason: analysis.reason,
        context: [analysis.summary, `Por qué se le escribe: ${analysis.reason}.`].filter(Boolean).join(" "),
      };
    }

    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, conv.contactId));
    if (contact?.marketingOptOutAt) {
      await note(conv.id, "💡 Sin seguimiento de ventas: el cliente pidió no recibir promociones.");
      return;
    }
    const [recent] = await db
      .select({ id: followupsTable.id, sentAt: followupsTable.sentAt })
      .from(followupsTable)
      .where(
        and(
          eq(followupsTable.contactId, conv.contactId),
          eq(followupsTable.kind, "winback"),
          inArray(followupsTable.status, ["scheduled", "sent", "replied"]),
          gt(followupsTable.createdAt, new Date(Date.now() - WINBACK_COOLDOWN_MS)),
        ),
      )
      .limit(1);
    if (recent) {
      await note(conv.id, "💡 Sin seguimiento de ventas: ya se le escribió para retomar una venta hace menos de 14 días.");
      return;
    }

    const agent = await activeVirtualAgent(winbackTrigger.agentId);
    if (!agent) {
      log.warn({ conversationId, agentId: winbackTrigger.agentId }, "winback no programado: el agente está inactivo");
      return;
    }

    const delayHours = triggerNumber(winbackTrigger.trigger.data.delayHours, TRIGGER_DEFAULTS.winbackDelayHours);
    const dueAt = new Date(conv.closedAt.getTime() + delayHours * HOUR_MS);
    const row = await schedule({
      conversationId: conv.id,
      contactId: conv.contactId,
      agentId: agent.id,
      workflowId: winbackTrigger.workflowId,
      kind: "winback",
      dueAt,
      product: opportunity.product,
      context: opportunity.context,
      sessionStartedAt: conv.sessionStartedAt,
    });
    if (row) {
      await note(
        conv.id,
        `💡 ${agent.name} retomará este chat el ${formatShort(dueAt)} para intentar cerrar la venta${opportunity.product ? ` (${opportunity.product})` : ""}. Motivo: ${opportunity.reason}.`,
      );
      log.info({ conversationId, followupId: row.id, dueAt }, "winback follow-up scheduled");
    }
  } catch (err) {
    log.error({ err, conversationId }, "follow-up planning failed");
  } finally {
    planning.delete(conversationId);
  }
}

// ── "Venta cerrada" desde el panel ────────────────────────────────────────────
// La marca del agente humano manda sobre la IA. Marcarla cancela la recuperación
// pendiente y arranca el post-venta desde ya; desmarcarla borra el post-venta que
// aún no salió.
export async function markConversationSale(
  conversationId: number,
  input: { closed: boolean; product: string | null; agentId: number | null; agentName: string },
  log: Log,
): Promise<Conversation | null> {
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!conv) return null;

  if (!input.closed) {
    const [updated] = await db
      .update(conversationsTable)
      .set({ saleClosedAt: null, saleProduct: null, saleSource: null, saleMarkedByAgentId: null })
      .where(eq(conversationsTable.id, conversationId))
      .returning();
    const removed = await db
      .delete(followupsTable)
      .where(
        and(
          eq(followupsTable.conversationId, conversationId),
          eq(followupsTable.status, "scheduled"),
          inArray(followupsTable.kind, POST_SALE_KINDS),
        ),
      )
      .returning({ id: followupsTable.id });
    await note(
      conversationId,
      `🧾 ${input.agentName} desmarcó la venta.${removed.length ? ` Se cancelaron ${removed.length} seguimiento(s) de post-venta.` : ""}`,
    );
    return updated;
  }

  const product = input.product?.trim() || conv.saleProduct || null;
  const [updated] = await db
    .update(conversationsTable)
    .set({
      saleClosedAt: hasSaleThisSession(conv) ? conv.saleClosedAt : new Date(),
      saleProduct: product,
      saleSource: "agent",
      saleMarkedByAgentId: input.agentId,
    })
    .where(eq(conversationsTable.id, conversationId))
    .returning();

  const cancelled = await db
    .update(followupsTable)
    .set({ status: "cancelled", detail: `venta marcada como cerrada por ${input.agentName}`, updatedAt: new Date() })
    .where(
      and(
        eq(followupsTable.conversationId, conversationId),
        eq(followupsTable.status, "scheduled"),
        eq(followupsTable.kind, "winback"),
      ),
    )
    .returning({ id: followupsTable.id });

  await note(
    conversationId,
    `🧾 ${input.agentName} marcó la venta como cerrada${product ? ` (${product})` : ""}.${cancelled.length ? " Se canceló el seguimiento de ventas pendiente." : ""}`,
  );

  if (updated.channel === "whatsapp" && updated.externalId) {
    const trigger = await activeTrigger(updated.channel, "sale_closed");
    if (trigger) await schedulePostSale(updated, trigger, product, updated.contextSummary, new Date(), log);
  }
  return updated;
}

// ── Envío ─────────────────────────────────────────────────────────────────────
// El catálogo de plantillas de Meta ya no se consulta desde aquí: desde el
// 2026-09-20 las plantillas las envía una persona desde el panel
// (routes/conversations.ts), nunca un agente virtual.

async function finish(
  followup: Followup,
  status: Followup["status"],
  patch: Partial<typeof followupsTable.$inferInsert> = {},
): Promise<void> {
  await db
    .update(followupsTable)
    .set({ status, ...patch, updatedAt: new Date() })
    .where(eq(followupsTable.id, followup.id));
}

async function postpone(followup: Followup, ms: number, detail: string): Promise<void> {
  await db
    .update(followupsTable)
    .set({ dueAt: new Date(Date.now() + ms), attempts: followup.attempts + 1, detail, updatedAt: new Date() })
    .where(eq(followupsTable.id, followup.id));
}

// Mueve la fecha sin gastar intento: el seguimiento no falló, todavía no es hora.
async function reschedule(followup: Followup, ms: number, detail: string): Promise<void> {
  await db
    .update(followupsTable)
    .set({ dueAt: new Date(Date.now() + ms), detail, updatedAt: new Date() })
    .where(eq(followupsTable.id, followup.id));
}

async function recordOutbound(
  conv: Conversation,
  content: string,
  type: "text" | "template",
  send: () => Promise<DeliveryOutcome>,
  log: Log,
): Promise<{ messageId: number; delivery: DeliveryOutcome }> {
  const [message] = await db
    .insert(messagesTable)
    .values({ conversationId: conv.id, sender: "bot", content, type, isAiSuggestion: false })
    .returning({ id: messagesTable.id });
  let delivery: DeliveryOutcome;
  try {
    delivery = await send();
  } catch (err) {
    log.error({ err, conversationId: conv.id }, "follow-up delivery threw");
    delivery = { ok: false, externalMessageId: null, error: "error inesperado al enviarlo" };
  }
  await db
    .update(messagesTable)
    .set(
      delivery.ok
        ? { externalMessageId: delivery.externalMessageId }
        : { status: "failed", failedReason: delivery.error ?? "Meta rechazó el envío" },
    )
    .where(eq(messagesTable.id, message.id));
  await db
    .update(conversationsTable)
    .set({ lastMessage: content, updatedAt: new Date() })
    .where(eq(conversationsTable.id, conv.id));
  return { messageId: message.id, delivery };
}

// Hubo algún mensaje real (de cualquiera de los dos lados) después de este momento.
async function activitySince(conversationId: number, since: Date, sender?: "contact" | "team"): Promise<boolean> {
  const [row] = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conversationId),
        eq(messagesTable.isInternal, false),
        gt(messagesTable.createdAt, since),
        ...(sender === "contact" ? [eq(messagesTable.sender, "contact")] : []),
        ...(sender === "team" ? [ne(messagesTable.sender, "contact")] : []),
      ),
    )
    .limit(1);
  return !!row;
}

async function processFollowup(followup: Followup, log: Log): Promise<void> {
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, followup.conversationId));
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, followup.contactId));
  if (!conv || !contact || !conv.externalId) {
    await finish(followup, "skipped", { detail: "la conversación ya no tiene a quién escribirle" });
    return;
  }

  if (followup.workflowId) {
    const [wf] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, followup.workflowId));
    if (!wf?.isActive) {
      await finish(followup, "cancelled", { detail: "el flujo que lo programó está desactivado" });
      return;
    }
  }
  const agent = await activeVirtualAgent(followup.agentId);
  if (!agent) {
    await finish(followup, "cancelled", { detail: "el agente que debía enviarlo está inactivo" });
    return;
  }
  if (MARKETING_KINDS.includes(followup.kind) && contact.marketingOptOutAt) {
    await finish(followup, "cancelled", { detail: "el cliente pidió no recibir promociones" });
    return;
  }

  if (followup.kind === "winback") {
    if (!conv.closedAt || (await activitySince(conv.id, followup.createdAt))) {
      await finish(followup, "cancelled", { detail: "la conversación siguió después del cierre" });
      await note(conv.id, `💡 Se canceló el seguimiento de ventas de ${agent.name}: la conversación siguió.`);
      return;
    }
  }

  if (POST_SALE_KINDS.includes(followup.kind) && !conv.closedAt && followup.attempts < MAX_LIVE_POSTPONES) {
    const [last] = await db
      .select({ createdAt: messagesTable.createdAt })
      .from(messagesTable)
      .where(and(eq(messagesTable.conversationId, conv.id), eq(messagesTable.isInternal, false)))
      .orderBy(desc(messagesTable.createdAt))
      .limit(1);
    if (last && Date.now() - last.createdAt.getTime() < LIVE_CHAT_MS) {
      await postpone(followup, POSTPONE_MS, "pospuesto: el cliente estaba en una conversación");
      return;
    }
  }

  // Post-venta solo con un pedido de verdad en Pedidos, y el de entrega solo con el
  // pedido ya enviado. Antes salía por una venta que la IA creyó leer en el chat.
  if (POST_SALE_KINDS.includes(followup.kind) && isModuleEnabled("orders")) {
    const [order] = await db
      .select({ id: ordersTable.id, status: ordersTable.status })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.contactId, followup.contactId),
          gte(ordersTable.createdAt, new Date(followup.createdAt.getTime() - ORDER_LOOKBACK_MS)),
        ),
      )
      .orderBy(desc(ordersTable.createdAt))
      .limit(1);
    const gate = postSaleOrderGate(followup.kind, order?.status ?? null);
    if (gate.action === "cancel") {
      await finish(followup, "cancelled", { detail: gate.detail });
      await note(conv.id, `📦 No se envió la ${FOLLOWUP_KIND_LABELS[followup.kind]} de ${agent.name}: ${gate.detail}.`);
      return;
    }
    if (gate.action === "wait") {
      if (Date.now() - followup.createdAt.getTime() > ORDER_WAIT_LIMIT_MS) {
        await finish(followup, "cancelled", { detail: `${gate.detail} después de 21 días` });
        await note(conv.id, `📦 Se canceló la ${FOLLOWUP_KIND_LABELS[followup.kind]} de ${agent.name}: ${gate.detail} después de 21 días.`);
        return;
      }
      await reschedule(followup, ORDER_RECHECK_MS, `esperando a que el pedido cambie de estado: ${gate.detail}`);
      return;
    }
  }

  // Un solo mensaje por iniciativa propia hasta que el cliente conteste: si ya se
  // le mandó un seguimiento después de su último mensaje y no respondió, este no
  // sale (regla del 2026-09-19: el bot no escribe varias veces sin respuesta).
  if (SELF_STARTED_KINDS.includes(followup.kind)) {
    const sent = await db
      .select({ kind: followupsTable.kind, sentAt: followupsTable.sentAt })
      .from(followupsTable)
      .where(
        and(
          eq(followupsTable.conversationId, conv.id),
          ne(followupsTable.id, followup.id),
          eq(followupsTable.status, "sent"),
          // Contestarle tarde a quien esperaba no es escribirle por iniciativa propia.
          inArray(followupsTable.kind, SELF_STARTED_KINDS),
        ),
      );
    const previous = pendingNudge(conv.lastCustomerMessageAt, sent);
    if (previous) {
      const detail = `ya se le escribió (${FOLLOWUP_KIND_LABELS[previous.kind]}) y no ha respondido`;
      await finish(followup, "skipped", { detail });
      await note(conv.id, `🤐 No se envió la ${FOLLOWUP_KIND_LABELS[followup.kind]} de ${agent.name}: ${detail}. El bot no escribe dos veces seguidas sin respuesta del cliente.`);
      return;
    }
  }

  // Ventana de silencio: de madrugada no se le escribe a nadie por iniciativa
  // nuestra. No gasta intento —no es un reintento, es la hora— y no toca a quien
  // escribió y está esperando respuesta.
  if (SELF_STARTED_KINDS.includes(followup.kind)) {
    const wait = quietHoursDelayMs(localClock(new Date()));
    if (wait > 0) {
      await reschedule(followup, wait, "pospuesto hasta las 8:00: ventana de silencio de la madrugada");
      return;
    }
  }

  if (followup.kind === "unanswered") {
    const since = conv.lastCustomerMessageAt ?? followup.createdAt;
    if (await activitySince(conv.id, since, "team")) {
      await finish(followup, "cancelled", { detail: "el equipo ya le respondió" });
      return;
    }
  }

  const freeform = canSendFreeform(conv.lastCustomerMessageAt);

  // Un cierre cortés no justifica una plantilla: con la ventana cerrada no sale.
  if (followup.kind === "unanswered" && !freeform && followup.context?.includes(COURTESY_CONTEXT)) {
    await finish(followup, "skipped", { detail: "solo tocaba un cierre cortés y la ventana de 24h ya cerró" });
    return;
  }

  // Respuesta pendiente con la ventana abierta: el agente contesta de verdad lo que
  // el cliente preguntó, en vez de mandarle una plantilla que solo lo hace esperar.
  // Retoma, no empieza: lee dónde quedó y, si el cliente no pedía nada, cierra con
  // cortesía (takeoverInstruction en followup-rules.ts).
  if (followup.kind === "unanswered" && freeform) {
    await db
      .update(conversationsTable)
      .set({ agentId: agent.id, groupId: null, status: "open", updatedAt: new Date() })
      .where(eq(conversationsTable.id, conv.id));
    await note(
      conv.id,
      `🤖 ${agent.name} retomó la conversación: ${humanizeGap(Date.now() - (conv.lastCustomerMessageAt ?? followup.createdAt).getTime())} sin respuesta del equipo.`,
    );
    await maybeRespondWithVirtualAgent(conv.id, log, { takeover: true });
    await finish(followup, "sent", { sentAt: new Date(), detail: "respondió el agente dentro de la ventana de 24h" });
    return;
  }

  let content: string | null = null;
  let outcome: { messageId: number; delivery: DeliveryOutcome } | null = null;

  if (followup.kind === "winback" && freeform) {
    const rows = await sessionMessages(conv);
    const instruction = winbackInstruction(followup.context, {
      onlyGreeted: customerOnlyGreeted(rows),
      answered: rows.some((m) => m.sender !== "contact"),
      lastFromUs: rows.at(-1)?.sender !== "contact",
    });
    content = await composeAgentFollowup(conv, agent, instruction);
    if (content) {
      const text = content;
      outcome = await recordOutbound(conv, text, "text", () => deliverConversationMessage(conv, text, log), log);
    }
  }

  // Las plantillas las manda una persona, nunca un agente virtual (regla del
  // 2026-09-20). Antes, cuando la ventana de 24h estaba cerrada, el seguimiento
  // caía en una plantilla y el agente virtual se la enviaba al cliente sin que
  // nadie del equipo lo hubiera decidido. Ahora el seguimiento no sale: queda la
  // nota en el chat para que el equipo escriba él desde el panel si quiere.
  if (!outcome) {
    const motivo = freeform
      ? "no se pudo redactar el mensaje"
      : "la ventana de 24 h ya cerró y solo cabría una plantilla";
    await finish(followup, "skipped", {
      detail: `${motivo}; las plantillas las envía una persona del equipo`,
    });
    await note(
      conv.id,
      `📋 No salió ${FOLLOWUP_KIND_LABELS[followup.kind]} de ${agent.name}: ${motivo}. Las plantillas solo las envía una persona del equipo, desde el panel.`,
    );
    log.info(
      { conversationId: conv.id, followupId: followup.id, kind: followup.kind, freeform },
      "follow-up skipped: templates are human-only",
    );
    return;
  }

  const label = FOLLOWUP_KIND_LABELS[followup.kind];
  if (!outcome.delivery.ok) {
    await finish(followup, "failed", {
      messageId: outcome.messageId,
      detail: outcome.delivery.error ?? "Meta rechazó el envío",
    });
    await note(conv.id, `⚠️ No salió el seguimiento de ${agent.name} (${label}): ${outcome.delivery.error ?? "Meta lo rechazó"}.`);
    return;
  }
  await finish(followup, "sent", { sentAt: new Date(), messageId: outcome.messageId });
  await note(
    conv.id,
    `📨 ${agent.name} envió el seguimiento de ${label}. Si el cliente responde en los próximos 3 días, lo atiende ${agent.name}.`,
  );
  log.info({ conversationId: conv.id, followupId: followup.id, kind: followup.kind }, "follow-up sent");
}

// Envía los seguimientos que vencieron. Pocos por vuelta: cada uno puede llevar
// una llamada a la IA y otra a Meta, y la vuelta siguiente llega en un minuto.
export async function sweepFollowups(log: Log, limit = 20): Promise<number> {
  const due = await db
    .select()
    .from(followupsTable)
    .where(and(eq(followupsTable.status, "scheduled"), lte(followupsTable.dueAt, new Date())))
    .orderBy(followupsTable.dueAt)
    .limit(limit);

  let processed = 0;
  for (const followup of due) {
    if (sending.has(followup.id)) continue;
    sending.add(followup.id);
    try {
      await processFollowup(followup, log);
      processed += 1;
    } catch (err) {
      log.error({ err, followupId: followup.id }, "follow-up processing failed");
      await finish(followup, "failed", { detail: "error inesperado al procesarlo" }).catch(() => undefined);
    } finally {
      sending.delete(followup.id);
    }
  }
  return processed;
}

// ── Clientes sin respuesta ────────────────────────────────────────────────────
// Busca a quien escribió y lleva el tiempo del disparador sin que nadie le
// conteste, y le programa la gestión al agente de atención. Una vez por sesión:
// si el cliente vuelve a escribir y otra vez nadie le contesta, es otra sesión.
export async function sweepUnansweredConversations(log: Log, limit = 20): Promise<number> {
  const trigger = await activeTrigger("whatsapp", "unanswered");
  if (!trigger) return 0;
  const agent = await activeVirtualAgent(trigger.agentId);
  if (!agent) return 0;

  const delayHours = triggerNumber(trigger.trigger.data.delayHours, TRIGGER_DEFAULTS.unansweredDelayHours);
  const now = Date.now();
  const candidates = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.channel, "whatsapp"),
        sql`${conversationsTable.externalId} is not null`,
        lte(conversationsTable.lastCustomerMessageAt, new Date(now - delayHours * HOUR_MS)),
        gte(conversationsTable.lastCustomerMessageAt, new Date(now - UNANSWERED_LOOKBACK_MS)),
        sql`not exists (
          select 1 from ${messagesTable} m
          where m.conversation_id = ${conversationsTable.id}
            and m.is_internal = false
            and m.sender <> 'contact'
            and m.created_at >= ${conversationsTable.lastCustomerMessageAt}
        )`,
        sql`not exists (
          select 1 from ${followupsTable} f
          where f.conversation_id = ${conversationsTable.id}
            and f.session_started_at = ${conversationsTable.sessionStartedAt}
            and (f.kind = 'unanswered' or (f.kind = 'winback' and f.status in ('scheduled', 'sent')))
        )`,
      ),
    )
    .limit(limit);

  let created = 0;
  for (const conv of candidates) {
    const rows = await sessionMessages(conv);
    const lastFromCustomer = [...rows].reverse().find((m) => m.sender === "contact");
    if (!lastFromCustomer) continue;
    // Lo que ya está con una persona se queda con esa persona hasta que pase su
    // ventana de gracia (2026-09-20). Sin esto, el seguimiento se la pasaba al
    // agente virtual a las 2 horas y se saltaba la ventana entera: el chat volvía
    // al bot justo después de habérselo prometido a un humano.
    if (await humanHandoffStillFresh(conv)) continue;
    // Un "sí", un "ok" o un "de acuerdo" a secas no dejan nada pendiente: no hace
    // falta gastar una llamada al modelo para saberlo.
    const need = isBareAcknowledgement(historyContent(lastFromCustomer))
      ? "none"
      : // Se lee con lo último de la sesión anterior delante: "puedo recibir después
        // de las 10" solo se entiende junto al formato del pedido que lo provocó.
        await pendingReplyNeed(transcriptOf([...(await previousSessionRows(conv)), ...rows].slice(-10)));
    // Un cierre cortés no es urgente: de madrugada espera a las 8:00, como lo que
    // arranca solo. Lo que el cliente preguntó sí se contesta al momento.
    const now = new Date();
    const dueAt = need === "courtesy" ? new Date(now.getTime() + quietHoursDelayMs(localClock(now))) : now;
    const skip =
      need === "none"
        ? "el último mensaje del cliente no esperaba respuesta"
        : need === "courtesy" && !canSendFreeform(conv.lastCustomerMessageAt, dueAt)
          ? "solo tocaba un cierre cortés y la ventana de 24h ya habrá cerrado"
          : null;
    const said = `El cliente escribió «${historyContent(lastFromCustomer).slice(0, 300)}» y nadie del equipo le contestó.`;
    const row = await schedule({
      conversationId: conv.id,
      contactId: conv.contactId,
      agentId: agent.id,
      workflowId: trigger.workflowId,
      kind: "unanswered",
      dueAt,
      // Se registra también cuando no hace falta contestar, ya resuelto: así la
      // misma sesión no se vuelve a evaluar en cada vuelta.
      status: skip ? "skipped" : "scheduled",
      detail: skip,
      context: need === "courtesy" ? `${said} ${COURTESY_CONTEXT}` : said,
      sessionStartedAt: conv.sessionStartedAt,
    });
    if (row && !skip) created += 1;
  }
  if (created > 0) log.info({ created }, "unanswered conversations handed to the support agent");
  return created;
}

// ── Pedido enviado ────────────────────────────────────────────────────────────
// Al pasar un pedido a Enviado, la confirmación de entrega pendiente de ese
// cliente se corre a cuando el paquete ya debería haber llegado (de 2 a 3 días
// hábiles en República Dominicana, de 1 a 5 en Estados Unidos): preguntar "¿te llegó?" el día después de despacharlo es preguntar
// antes de tiempo. Si ya estaba programada para más tarde, se deja.
export async function alignDeliveryCheckWithShipment(
  order: { contactId: number; email: string | null },
  log: Log,
): Promise<void> {
  const weekdayOf = (date: Date) => new Date(`${localDayKey(date)}T12:00:00Z`).getUTCDay();
  const earliest = addBusinessDays(new Date(), deliveryBusinessDays(order), weekdayOf);
  const moved = await db
    .update(followupsTable)
    .set({ dueAt: earliest, updatedAt: new Date() })
    .where(
      and(
        eq(followupsTable.contactId, order.contactId),
        eq(followupsTable.kind, "delivery_check"),
        eq(followupsTable.status, "scheduled"),
        lt(followupsTable.dueAt, earliest),
      ),
    )
    .returning({ id: followupsTable.id, conversationId: followupsTable.conversationId });
  for (const row of moved) {
    await note(row.conversationId, `📦 Pedido enviado: la confirmación de entrega se movió al ${formatShort(earliest)}.`);
  }
  if (moved.length) log.info({ contactId: order.contactId, moved: moved.length }, "delivery check aligned with shipment");
}
