import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  agentGroupsTable,
  agentGroupMembersTable,
  agentsTable,
  capabilitiesTable,
  conversationsTable,
} from "@workspace/db";
import {
  CreateGroupBody,
  UpdateGroupBody,
  UpdateGroupParams,
  GetGroupParams,
  DeleteGroupParams,
  AddGroupMemberBody,
  AddGroupMemberParams,
  RemoveGroupMemberParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

type Group = typeof agentGroupsTable.$inferSelect;

// Full group view: members with their live utilization (active conversations)
// and capabilities, plus how many conversations sit in the manual queue.
async function buildGroupDetail(group: Group) {
  const memberRows = await db
    .select()
    .from(agentGroupMembersTable)
    .where(eq(agentGroupMembersTable.groupId, group.id));

  const members = [];
  for (const m of memberRows) {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, m.agentId));
    if (!agent) continue;
    const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.agentId, m.agentId));
    const active = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(and(eq(conversationsTable.agentId, m.agentId), inArray(conversationsTable.status, ["open", "pending"])));
    members.push({
      agentId: agent.id,
      name: agent.name,
      status: agent.status,
      activeConversations: active.length,
      capabilities: caps.map((c) => c.name),
    });
  }

  const queued = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.groupId, group.id), eq(conversationsTable.status, "pending")));

  return { ...group, memberCount: members.length, queuedConversations: queued.length, members };
}

async function reloadDetail(id: number) {
  const [group] = await db.select().from(agentGroupsTable).where(eq(agentGroupsTable.id, id));
  return group ? buildGroupDetail(group) : null;
}

router.get("/groups", async (_req, res): Promise<void> => {
  const groups = await db.select().from(agentGroupsTable).orderBy(agentGroupsTable.createdAt);
  const detailed = await Promise.all(groups.map(buildGroupDetail));
  res.json(detailed);
});

router.get("/groups/:id", async (req, res): Promise<void> => {
  const params = GetGroupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const detail = await reloadDetail(params.data.id);
  if (!detail) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  res.json(detail);
});

router.post("/groups", async (req, res): Promise<void> => {
  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [group] = await db
    .insert(agentGroupsTable)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      distributionRule: parsed.data.distributionRule ?? "round_robin",
    })
    .returning();
  res.status(201).json(await buildGroupDetail(group));
});

router.patch("/groups/:id", async (req, res): Promise<void> => {
  const params = UpdateGroupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Partial<typeof agentGroupsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.distributionRule !== undefined) updateData.distributionRule = parsed.data.distributionRule;

  const [group] = await db
    .update(agentGroupsTable)
    .set(updateData)
    .where(eq(agentGroupsTable.id, params.data.id))
    .returning();
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  res.json(await buildGroupDetail(group));
});

router.delete("/groups/:id", async (req, res): Promise<void> => {
  const params = DeleteGroupParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [group] = await db.delete(agentGroupsTable).where(eq(agentGroupsTable.id, params.data.id)).returning();
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  await db.delete(agentGroupMembersTable).where(eq(agentGroupMembersTable.groupId, params.data.id));
  res.sendStatus(204);
});

router.post("/groups/:id/members", async (req, res): Promise<void> => {
  const params = AddGroupMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AddGroupMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, parsed.data.agentId));
  if (!agent) {
    res.status(404).json({ error: "Agente no encontrado." });
    return;
  }
  if (agent.type !== "human") {
    res.status(400).json({ error: "Solo agentes humanos pueden formar parte de un grupo." });
    return;
  }

  const [existing] = await db
    .select()
    .from(agentGroupMembersTable)
    .where(and(eq(agentGroupMembersTable.groupId, params.data.id), eq(agentGroupMembersTable.agentId, parsed.data.agentId)));
  if (!existing) {
    await db.insert(agentGroupMembersTable).values({ groupId: params.data.id, agentId: parsed.data.agentId });
  }

  const detail = await reloadDetail(params.data.id);
  if (!detail) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  res.json(detail);
});

router.delete("/groups/:id/members/:agentId", async (req, res): Promise<void> => {
  const params = RemoveGroupMemberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db
    .delete(agentGroupMembersTable)
    .where(and(eq(agentGroupMembersTable.groupId, params.data.id), eq(agentGroupMembersTable.agentId, params.data.agentId)));

  const detail = await reloadDetail(params.data.id);
  if (!detail) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  res.json(detail);
});

export default router;
