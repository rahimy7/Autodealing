import { eq, and, gte, inArray, desc } from "drizzle-orm";
import {
  db,
  conversationsTable,
  agentsTable,
  messagesTable,
  labelsTable,
  workflowsTable,
  agentGroupsTable,
  agentGroupMembersTable,
  capabilitiesTable,
} from "@workspace/db";
import { classifyIntent } from "./openai-client";
import type { Log } from "./messaging";
import { resolveTargetFromLabel } from "./workflow-graph";

// El canal por el que entra la conversación, tal y como lo guarda la tabla.
type Channel = (typeof conversationsTable.$inferSelect)["channel"];

async function countActiveConversations(agentId: number): Promise<number> {
  const rows = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.agentId, agentId), inArray(conversationsTable.status, ["open", "pending"])));
  return rows.length;
}

async function leastBusy(memberIds: number[]): Promise<number | null> {
  if (memberIds.length === 0) return null;
  let best: number | null = null;
  let bestCount = Infinity;
  for (const id of memberIds) {
    const count = await countActiveConversations(id);
    if (count < bestCount) {
      bestCount = count;
      best = id;
    }
  }
  return best;
}

// Deja la conversación esperando en la cola del grupo, sin dueño. Es lo que la
// hace visible para el equipo —isHumanOwned cuenta la cola como manos humanas— y
// lo que impide que el flujo se la devuelva al agente virtual en el mensaje
// siguiente.
async function queueToGroup(
  groupId: number,
  groupName: string,
  conv: typeof conversationsTable.$inferSelect,
  labelName: string,
  log: Log,
): Promise<true> {
  await db
    .update(conversationsTable)
    .set({ groupId, agentId: null, status: "pending", followupId: null, updatedAt: new Date() })
    .where(eq(conversationsTable.id, conv.id));
  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: "bot",
    content: `🔀 En cola del grupo "${groupName}" (etiqueta "${labelName}").`,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });
  log.info({ conversationId: conv.id, groupId }, "conversation queued to group");
  return true;
}

// Routes a conversation escalated to a group per its distribution rule. Returns
// true when handed to a human (or queued), so the virtual agent stays quiet.
async function routeToGroup(
  groupId: number,
  conv: typeof conversationsTable.$inferSelect,
  labelId: number,
  labelName: string,
  log: Log,
): Promise<boolean> {
  const [group] = await db.select().from(agentGroupsTable).where(eq(agentGroupsTable.id, groupId));
  if (!group) {
    log.error({ conversationId: conv.id, groupId }, "workflow group not found");
    return false;
  }
  const memberRows = await db
    .select()
    .from(agentGroupMembersTable)
    .where(eq(agentGroupMembersTable.groupId, groupId))
    .orderBy(agentGroupMembersTable.id);
  // Un miembro que apunta a un agente borrado no atiende a nadie. 2026-09-20: el
  // único miembro del grupo humano se había borrado desde el panel y la membresía
  // se quedó ahí, así que cada escalación asignaba el chat a ese id inexistente:
  // el cliente recibía el aviso de traspaso, el chat no aparecía en la bandeja de
  // nadie y al mensaje siguiente el flujo se lo devolvía al agente virtual, que
  // volvía a escalar y a repetirle el aviso. Se ignoran para que el grupo cuente
  // como vacío y la conversación quede en cola, a la vista del equipo.
  const allMemberIds = memberRows.map((m) => m.agentId);
  const liveMembers = allMemberIds.length
    ? await db.select({ id: agentsTable.id }).from(agentsTable).where(inArray(agentsTable.id, allMemberIds))
    : [];
  const liveIds = new Set(liveMembers.map((a) => a.id));
  const memberIds = allMemberIds.filter((id) => liveIds.has(id));
  if (memberIds.length < allMemberIds.length) {
    log.error(
      { groupId, missing: allMemberIds.filter((id) => !liveIds.has(id)) },
      "workflow group has members pointing to agents that no longer exist",
    );
  }

  // Manual rule (or an empty group): park it in the group's queue for a supervisor.
  if (group.distributionRule === "manual" || memberIds.length === 0) {
    return queueToGroup(groupId, group.name, conv, labelName, log);
  }

  let chosenId: number | null = null;
  if (group.distributionRule === "round_robin") {
    const len = memberIds.length;
    const idx = (((group.rotationIndex ?? 0) % len) + len) % len;
    chosenId = memberIds[idx];
    await db
      .update(agentGroupsTable)
      .set({ rotationIndex: (group.rotationIndex ?? 0) + 1 })
      .where(eq(agentGroupsTable.id, groupId));
  } else if (group.distributionRule === "least_busy") {
    chosenId = await leastBusy(memberIds);
  } else if (group.distributionRule === "by_capability") {
    const caps = await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.agentId, memberIds));
    const needle = labelName.toLowerCase();
    const matching = [
      ...new Set(
        caps
          .filter((c) => {
            // Match the intent label against the capability's name, its category,
            // or any of its keywords (case-insensitive, substring both ways).
            const haystack = [c.name, c.category ?? "", ...(c.keywords ?? [])].map((s) => s.toLowerCase());
            return haystack.some((h) => h.length > 0 && (h.includes(needle) || needle.includes(h)));
          })
          .map((c) => c.agentId),
      ),
    ];
    chosenId = await leastBusy(matching.length > 0 ? matching : memberIds);
  }

  if (!chosenId) return false;

  const [member] = await db.select().from(agentsTable).where(eq(agentsTable.id, chosenId));
  // Se borró entre el filtro de arriba y esta consulta: a la cola, nunca a un id
  // que no va a contestar.
  if (!member) return queueToGroup(groupId, group.name, conv, labelName, log);

  await db
    .update(conversationsTable)
    .set({ groupId, agentId: chosenId, status: "pending", followupId: null, updatedAt: new Date() })
    .where(eq(conversationsTable.id, conv.id));
  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: "bot",
    content: `🔀 Derivado al grupo "${group.name}" → ${member.name} (etiqueta "${labelName}").`,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });
  log.info(
    { conversationId: conv.id, groupId, chosenId, rule: group.distributionRule },
    "conversation routed to group member",
  );
  return true;
}

// Escalate a conversation to a human group on demand (e.g. when a virtual agent
// signals it can't help). Reuses the group distribution rules. Returns true when
// the conversation was handed to the group (routed to a member or queued).
export async function escalateConversationToGroup(
  conversationId: number,
  groupId: number,
  log: Log,
): Promise<boolean> {
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!conv) {
    log.error({ conversationId, groupId }, "escalateConversationToGroup: conversation not found");
    return false;
  }
  let labelName = "escalación";
  if (conv.labelId != null) {
    const [label] = await db.select().from(labelsTable).where(eq(labelsTable.id, conv.labelId));
    if (label) labelName = label.name;
  }
  return routeToGroup(groupId, conv, conv.labelId ?? 0, labelName, log);
}

// Los flujos activos que aplican a un canal, del más específico al más general:
// primero los que nombran ese canal, después los generales (sin canales). Dentro
// de cada tramo gana el más recientemente editado, así que un duplicado despistado
// nunca vuelve el enrutado indeterminado.
export async function activeWorkflowsFor(channel: Channel) {
  const workflows = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.isActive, true))
    .orderBy(desc(workflowsTable.updatedAt));
  const coversChannel = (w: typeof workflowsTable.$inferSelect) => (w.channels ?? []).includes(channel);
  const isGeneral = (w: typeof workflowsTable.$inferSelect) => (w.channels ?? []).length === 0;
  return [...workflows.filter(coversChannel), ...workflows.filter(isGeneral)];
}

/**
 * A qué grupo humano manda el flujo una etiqueta. Es lo que convierte una
 * etiqueta de localidad ("Sucursal Santiago") en la gente que atiende esa tienda:
 * el mapa vive en el flujo, editable desde el panel, y no en el código.
 *
 * Devuelve null si el flujo no tiene esa etiqueta cableada a un grupo — quien
 * llame decide el respaldo.
 */
export async function resolveGroupForLabel(labelId: number, channel: Channel): Promise<number | null> {
  for (const wf of await activeWorkflowsFor(channel)) {
    const target = resolveTargetFromLabel(wf.graph, labelId);
    if (target?.data.kind === "group" && target.data.groupId) return target.data.groupId;
  }
  return null;
}

export type RouteResult = { routedToHuman: boolean };

// Classifies the conversation's intent against the active labels, tags it, then
// consults the active workflow (channel-specific first, else general) to decide
// who should handle it. Returns whether the conversation ended up with a human,
// so the caller can skip the virtual agent's auto-reply.
export async function classifyAndRoute(conversationId: number, log: Log): Promise<RouteResult> {
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!conv) return { routedToHuman: false };

  // ── 1. Classify intent → tag the conversation ──────────────────────────────
  // Solo etiquetas de intención: las de localidad describen dónde está el cliente,
  // no qué quiere, y las decide el mapa de zonas cuando toca traspasar. Metidas
  // aquí, un "estoy en Santiago" se leería como intención y lo mandaría a una
  // persona antes de que el agente virtual intentara ayudarlo.
  const activeLabels = await db
    .select()
    .from(labelsTable)
    .where(and(eq(labelsTable.isActive, true), eq(labelsTable.kind, "intent")));
  let labelId = conv.labelId ?? null;

  if (activeLabels.length > 0) {
    // Classify against the current session only: intent from a conversation that
    // already closed must not decide where a new one is routed.
    const history = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.conversationId, conversationId),
          gte(messagesTable.createdAt, conv.sessionStartedAt),
          eq(messagesTable.isInternal, false),
        ),
      )
      .orderBy(messagesTable.createdAt);
    const lastInbound = [...history].reverse().find((m) => m.sender === "contact");
    if (lastInbound) {
      const detected = await classifyIntent({
        message: lastInbound.content,
        history: history
          .slice(-8)
          .map((m) => `${m.sender}: ${m.content}`)
          .join("\n"),
        labels: activeLabels.map((l) => ({ id: l.id, name: l.name, description: l.description })),
      });
      if (detected) {
        labelId = detected;
        if (detected !== conv.labelId) {
          await db
            .update(conversationsTable)
            .set({ labelId: detected, updatedAt: new Date() })
            .where(eq(conversationsTable.id, conversationId));
          log.info({ conversationId, labelId: detected }, "conversation intent classified");
        }
      }
    }
  }

  if (!labelId) return { routedToHuman: false };

  // Ya escalada y esperando en la cola de un grupo: es del equipo aunque todavía
  // no tenga una persona concreta asignada. 2026-09-20: sin esta línea, un chat
  // ya traspasado volvía al agente virtual en cada mensaje del cliente —el
  // guardián de abajo solo mira `agentId`— y cada vuelta le repetía el aviso de
  // "en breve te estará atendiendo". Es la misma regla que aplica isHumanOwned.
  if (conv.status === "pending" && conv.groupId != null) return { routedToHuman: true };

  // A human agent already owns the conversation → never auto-reroute.
  // (Va antes que el seguimiento: si el agente del seguimiento ya escaló a una
  // persona, la conversación es de esa persona.)
  if (conv.agentId) {
    const [current] = await db.select().from(agentsTable).where(eq(agentsTable.id, conv.agentId));
    if (current?.type === "human") return { routedToHuman: true };
  }

  // El cliente contesta a un seguimiento nuestro: lo lleva el agente que le
  // escribió, que escala por su cuenta cuando toca. Enrutarlo por la etiqueta
  // ("Ventas") se lo quitaría a mitad de la conversación que él mismo abrió.
  if (conv.followupId) return { routedToHuman: false };

  // ── 2. Resolve the handling node across the active flows ────────────────────
  // Several active flows may serve the same channel, each covering a different
  // intent label (one flow per use-case). The first flow that actually handles the
  // detected label decides the target.
  let target: ReturnType<typeof resolveTargetFromLabel> = null;
  for (const wf of await activeWorkflowsFor(conv.channel)) {
    target = resolveTargetFromLabel(wf.graph, labelId);
    if (target) break;
  }
  if (!target) return { routedToHuman: false };

  // ── 3. Resolve the handling agent ──────────────────────────────────────────
  let targetAgentId: number | null = null;
  if (target.data.kind === "agent") {
    targetAgentId = target.data.agentId ?? null;
  } else if (target.data.kind === "escalation") {
    targetAgentId = target.data.agentId ?? null;
    if (!targetAgentId && conv.agentId) {
      const [current] = await db.select().from(agentsTable).where(eq(agentsTable.id, conv.agentId));
      targetAgentId = current?.escalateToAgentId ?? null;
    }
  } else if (target.data.kind === "group") {
    if (!target.data.groupId) return { routedToHuman: false };
    const labelName = activeLabels.find((l) => l.id === labelId)?.name ?? "intención";
    const handled = await routeToGroup(target.data.groupId, conv, labelId, labelName, log);
    return { routedToHuman: handled };
  }

  if (!targetAgentId) return { routedToHuman: false };

  // Already assigned to the resolved target — nothing to do beyond reporting type.
  if (targetAgentId === conv.agentId) {
    const [current] = await db.select().from(agentsTable).where(eq(agentsTable.id, targetAgentId));
    return { routedToHuman: current?.type === "human" };
  }

  const [targetAgent] = await db.select().from(agentsTable).where(eq(agentsTable.id, targetAgentId));
  if (!targetAgent) {
    log.error({ conversationId, targetAgentId }, "workflow target agent not found");
    return { routedToHuman: false };
  }
  // Un agente virtual apagado no contesta: asignarle la conversación la dejaría
  // sin nadie. Se queda donde estaba.
  if (targetAgent.type === "virtual" && !targetAgent.isActive) {
    log.warn({ conversationId, targetAgentId }, "workflow target agent is inactive — not routed");
    return { routedToHuman: false };
  }

  await db
    .update(conversationsTable)
    .set({
      agentId: targetAgent.id,
      status: targetAgent.type === "human" ? "pending" : "open",
      updatedAt: new Date(),
    })
    .where(eq(conversationsTable.id, conversationId));

  const labelName = activeLabels.find((l) => l.id === labelId)?.name ?? "intención";
  await db.insert(messagesTable).values({
    conversationId,
    sender: "bot",
    content: `🔀 Derivado a ${targetAgent.name} según la etiqueta "${labelName}".`,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });
  log.info(
    { conversationId, targetAgentId: targetAgent.id, labelId, type: targetAgent.type },
    "conversation routed by workflow",
  );

  return { routedToHuman: targetAgent.type === "human" };
}
