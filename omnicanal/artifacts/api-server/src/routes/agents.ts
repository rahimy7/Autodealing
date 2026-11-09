import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  agentsTable,
  agentGroupsTable,
  agentGroupMembersTable,
  conversationsTable,
  capabilitiesTable,
  knowledgeBasesTable,
} from "@workspace/db";
import {
  CreateAgentBody,
  UpdateAgentBody,
  UpdateAgentParams,
  DeleteAgentParams,
  GetAgentParams,
  ListAgentsResponse,
  UpdateAgentResponse,
  AssistAgentPromptBody,
  AssistAgentPromptResponse,
  AssistCapabilityBody,
  AssistCapabilityResponse,
  CreateCapabilityBody,
  CreateCapabilityParams,
  UpdateCapabilityBody,
  UpdateCapabilityParams,
  DeleteCapabilityParams,
  UpdateMyPresenceBody,
  UpdateMyPresenceResponse,
} from "@workspace/api-zod";
import { generateAgentPrompt, generateCapabilityDescription } from "../lib/openai-client";
import { hashPassword } from "../lib/auth";
import { isConnected, touchPresence } from "../lib/presence";
import { clearViewCache, grantDefaultViews } from "../lib/view-access";
import { requireView } from "../middlewares/auth";

const router: IRouter = Router();

// Serialize a capability row, resolving its linked knowledge base name.
async function serializeCapability(c: typeof capabilitiesTable.$inferSelect) {
  let knowledgeBaseName: string | null = null;
  if (c.knowledgeBaseId) {
    const [kb] = await db.select().from(knowledgeBasesTable).where(eq(knowledgeBasesTable.id, c.knowledgeBaseId));
    knowledgeBaseName = kb?.name ?? null;
  }
  return { ...c, knowledgeBaseName };
}

// AI assistant: draft a virtual-agent system prompt from a short brief.
router.post("/agents/assist-prompt", requireView("agents", "admin"), async (req, res): Promise<void> => {
  const parsed = AssistAgentPromptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await generateAgentPrompt({
    profileType: parsed.data.profileType,
    brief: parsed.data.brief,
    agentName: parsed.data.agentName ?? null,
    tone: parsed.data.tone ?? null,
    model: parsed.data.model ?? null,
  });

  res.json(AssistAgentPromptResponse.parse(result));
});

// AI assistant: draft a capability description from its name / short brief.
router.post("/agents/assist-capability", requireView("agents", "admin"), async (req, res): Promise<void> => {
  const parsed = AssistCapabilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await generateCapabilityDescription({ name: parsed.data.name, brief: parsed.data.brief ?? null });
  res.json(AssistCapabilityResponse.parse(result));
});

// Never expose the password hash, even on routes that don't run a zod response parse.
function serializeAgent(a: typeof agentsTable.$inferSelect) {
  const { passwordHash: _passwordHash, ...rest } = a;
  // Virtual agents don't have a real access role; report "agent" to keep the API shape stable.
  const role = a.type === "virtual" ? "agent" : (a.role ?? "agent");
  return { ...rest, role, status: effectiveStatus(a), channels: a.channels ?? [] };
}

/**
 * What the rest of the platform should see. For a human, being connected is the
 * session's business, not the column's: with a live session they are online —
 * or busy, if that is what they chose — and without one they are offline, no
 * matter what the column says. The column only ever carries the availability
 * choice, so a row left at "offline" by an older sign-out (or by a seed) never
 * contradicts an agent who is sitting in front of the panel right now.
 *
 * Virtual agents have no session to derive anything from, so their column is
 * the whole truth.
 */
function effectiveStatus(a: typeof agentsTable.$inferSelect): typeof a.status {
  if (a.type === "virtual") return a.status;
  if (!isConnected(a.id)) return "offline";
  return a.status === "busy" ? "busy" : "online";
}

router.get("/agents", async (_req, res): Promise<void> => {
  const agents = await db.select().from(agentsTable).orderBy(agentsTable.createdAt);
  res.json(ListAgentsResponse.parse(agents.map(serializeAgent)));
});

// Agent detail, including its capabilities (for the edit view).
router.get("/agents/:id", async (req, res): Promise<void> => {
  const params = GetAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, params.data.id));
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.agentId, agent.id));
  const capabilities = await Promise.all(caps.map(serializeCapability));
  res.json({ ...serializeAgent(agent), capabilities });
});

async function validateEscalationTarget(targetId: number | null | undefined, selfId?: number): Promise<string | null> {
  if (targetId == null) return null;
  if (selfId != null && targetId === selfId) return "Un agente no puede escalar hacia sí mismo.";
  const [target] = await db.select().from(agentsTable).where(eq(agentsTable.id, targetId));
  if (!target) return "El agente destino de escalación no existe.";
  return null;
}

async function validateEscalationGroup(groupId: number | null | undefined): Promise<string | null> {
  if (groupId == null) return null;
  const [group] = await db.select().from(agentGroupsTable).where(eq(agentGroupsTable.id, groupId));
  if (!group) return "El grupo destino de escalación no existe.";
  return null;
}

router.post("/agents", requireView("agents", "admin"), async (req, res): Promise<void> => {
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const escErr = await validateEscalationTarget(parsed.data.escalateToAgentId);
  if (escErr) {
    res.status(400).json({ error: escErr });
    return;
  }
  const groupErr = await validateEscalationGroup(parsed.data.escalateToGroupId);
  if (groupErr) {
    res.status(400).json({ error: groupErr });
    return;
  }

  const isVirtual = parsed.data.type === "virtual";
  if (!isVirtual && !parsed.data.password) {
    res.status(400).json({ error: "Un agente humano necesita una contraseña para iniciar sesión." });
    return;
  }

  const [agent] = await db
    .insert(agentsTable)
    .values({
      name: parsed.data.name,
      email: parsed.data.email.trim().toLowerCase(),
      passwordHash: isVirtual || !parsed.data.password ? null : await hashPassword(parsed.data.password),
      channels: parsed.data.channels ?? [],
      // Availability choice, not connectivity: a human still reads as offline
      // until they sign in, and as "online" the moment they do.
      status: "online",
      activeChats: 0,
      type: parsed.data.type ?? "human",
      // Virtual agents are always stored with role "agent" — the role field only
      // controls login permissions for human users.
      role: isVirtual ? "agent" : (parsed.data.role ?? "agent"),
      profileType: parsed.data.profileType ?? null,
      systemPrompt: parsed.data.systemPrompt ?? null,
      model: parsed.data.model ?? (isVirtual ? "gpt-5-mini" : null),
      escalateToAgentId: parsed.data.escalateToAgentId ?? null,
      escalateToGroupId: parsed.data.escalateToGroupId ?? null,
      isActive: true,
    })
    .returning();

  // Un usuario nuevo arranca con las vistas de su rol; desde Administración se le
  // ajustan. Los agentes virtuales no inician sesión, así que no llevan vistas.
  if (agent.type === "human") await grantDefaultViews(agent.id, agent.role);

  res.status(201).json(serializeAgent(agent));
});

router.patch("/agents/:id", requireView("agents", "admin"), async (req, res): Promise<void> => {
  const params = UpdateAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.escalateToAgentId !== undefined) {
    const escErr = await validateEscalationTarget(parsed.data.escalateToAgentId, params.data.id);
    if (escErr) {
      res.status(400).json({ error: escErr });
      return;
    }
  }
  if (parsed.data.escalateToGroupId !== undefined) {
    const groupErr = await validateEscalationGroup(parsed.data.escalateToGroupId);
    if (groupErr) {
      res.status(400).json({ error: groupErr });
      return;
    }
  }

  const updateData: Partial<typeof agentsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.email !== undefined) updateData.email = parsed.data.email.trim().toLowerCase();
  if (parsed.data.password) updateData.passwordHash = await hashPassword(parsed.data.password);
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.channels !== undefined) updateData.channels = parsed.data.channels;
  if (parsed.data.role !== undefined) updateData.role = parsed.data.role;
  if (parsed.data.profileType !== undefined) updateData.profileType = parsed.data.profileType;
  if (parsed.data.systemPrompt !== undefined) updateData.systemPrompt = parsed.data.systemPrompt;
  if (parsed.data.model !== undefined) updateData.model = parsed.data.model;
  if (parsed.data.escalateToAgentId !== undefined)
    updateData.escalateToAgentId = parsed.data.escalateToAgentId;
  if (parsed.data.escalateToGroupId !== undefined)
    updateData.escalateToGroupId = parsed.data.escalateToGroupId;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;

  const [agent] = await db
    .update(agentsTable)
    .set(updateData)
    .where(eq(agentsTable.id, params.data.id))
    .returning();

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  res.json(UpdateAgentResponse.parse(serializeAgent(agent)));
});

router.delete("/agents/:id", requireView("agents", "admin"), async (req, res): Promise<void> => {
  const params = DeleteAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Borrar el agente y dejar atrás lo que lo señala es lo que creó el agente
  // fantasma del 2026-09-20: la membresía del grupo humano siguió apuntando a un
  // id que ya no existía, así que las escalaciones "llegaban" a nadie y el
  // cliente recibía el aviso de traspaso una y otra vez. Se va todo junto o no se
  // va nada: las membresías, y las conversaciones quedan sin dueño para que el
  // flujo las vuelva a enrutar a alguien que sí atiende.
  const agent = await db.transaction(async (tx) => {
    const [deleted] = await tx.delete(agentsTable).where(eq(agentsTable.id, params.data.id)).returning();
    if (!deleted) return null;
    await tx.delete(agentGroupMembersTable).where(eq(agentGroupMembersTable.agentId, params.data.id));
    await tx
      .update(conversationsTable)
      .set({ agentId: null, updatedAt: new Date() })
      .where(eq(conversationsTable.agentId, params.data.id));
    return deleted;
  });

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  // Sus filas de view_access se fueron con la llave foránea; falta la copia en memoria.
  clearViewCache(params.data.id);
  res.sendStatus(204);
});

/**
 * Heartbeat from the signed-in agent's panel, and the only way an agent changes
 * their own availability. Admin accounts backed by an agent row beat too — they
 * show up in the same roster.
 */
router.post("/agents/me/presence", async (req, res): Promise<void> => {
  const parsed = UpdateMyPresenceBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const agentId = req.user?.agentId;
  if (!agentId) {
    res.status(400).json({ error: "Esta cuenta no está asociada a un agente." });
    return;
  }

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  touchPresence(agentId);

  // Only the availability choice is stored; going offline is done by closing the
  // panel or signing out, which is what stops the heartbeat above.
  let current = agent;
  if (parsed.data.status !== undefined && parsed.data.status !== agent.status) {
    [current] = await db
      .update(agentsTable)
      .set({ status: parsed.data.status })
      .where(eq(agentsTable.id, agentId))
      .returning();
  }

  res.json(UpdateMyPresenceResponse.parse(serializeAgent(current)));
});

// ── Capabilities ────────────────────────────────────────────────────────────────
router.post("/agents/:id/capabilities", requireView("agents", "admin"), async (req, res): Promise<void> => {
  const params = CreateCapabilityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateCapabilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, params.data.id));
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const [cap] = await db
    .insert(capabilitiesTable)
    .values({
      agentId: params.data.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      knowledgeBaseId: parsed.data.knowledgeBaseId ?? null,
      category: parsed.data.category ?? null,
      keywords: parsed.data.keywords ?? [],
      examples: parsed.data.examples ?? null,
      level: parsed.data.level ?? null,
    })
    .returning();
  res.status(201).json(await serializeCapability(cap));
});

router.patch("/capabilities/:id", requireView("agents", "admin"), async (req, res): Promise<void> => {
  const params = UpdateCapabilityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCapabilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Partial<typeof capabilitiesTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.knowledgeBaseId !== undefined) updateData.knowledgeBaseId = parsed.data.knowledgeBaseId;
  if (parsed.data.category !== undefined) updateData.category = parsed.data.category;
  if (parsed.data.keywords !== undefined) updateData.keywords = parsed.data.keywords ?? [];
  if (parsed.data.examples !== undefined) updateData.examples = parsed.data.examples;
  if (parsed.data.level !== undefined) updateData.level = parsed.data.level;

  const [cap] = await db
    .update(capabilitiesTable)
    .set(updateData)
    .where(eq(capabilitiesTable.id, params.data.id))
    .returning();
  if (!cap) {
    res.status(404).json({ error: "Capability not found" });
    return;
  }
  res.json(await serializeCapability(cap));
});

router.delete("/capabilities/:id", requireView("agents", "admin"), async (req, res): Promise<void> => {
  const params = DeleteCapabilityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [cap] = await db.delete(capabilitiesTable).where(eq(capabilitiesTable.id, params.data.id)).returning();
  if (!cap) {
    res.status(404).json({ error: "Capability not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
