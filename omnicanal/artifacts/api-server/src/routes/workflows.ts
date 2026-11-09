import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, workflowsTable, labelsTable, type WorkflowGraph } from "@workspace/db";
import { triggersForEvent } from "../lib/workflow-graph";
import {
  CreateWorkflowBody,
  UpdateWorkflowBody,
  UpdateWorkflowParams,
  GetWorkflowParams,
  DeleteWorkflowParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

type ChannelList = typeof workflowsTable.$inferInsert.channels;

// The graph is stored as opaque JSONB. We take it straight from the raw request
// body (never the zod-parsed copy) so node.data (kind/labelId/agentId/groupId) is
// preserved verbatim through the round-trip.
function sanitizeGraph(raw: unknown): WorkflowGraph {
  const g = (raw ?? {}) as { nodes?: unknown; edges?: unknown };
  return {
    nodes: Array.isArray(g.nodes) ? (g.nodes as WorkflowGraph["nodes"]) : [],
    edges: Array.isArray(g.edges) ? (g.edges as WorkflowGraph["edges"]) : [],
  };
}

// A general flow is stored as null (applies to every channel). An empty channel
// list means the same thing, so normalize it to null.
function normalizeChannels(channels: string[] | null | undefined): ChannelList {
  if (!channels || channels.length === 0) return null;
  return channels as ChannelList;
}

// Intent labels a flow handles = the labelIds of its "label" entry nodes.
function labelIdsInGraph(graph: WorkflowGraph): Set<number> {
  const out = new Set<number>();
  for (const n of graph?.nodes ?? []) {
    if (n?.data?.kind === "label" && typeof n.data.labelId === "number") out.add(n.data.labelId);
  }
  return out;
}

// Proactive events a flow triggers = the events of its "trigger" nodes that are
// wired to an agent (an unwired trigger does nothing, so it can't collide).
function triggerEventsInGraph(graph: WorkflowGraph): Set<string> {
  const out = new Set<string>();
  for (const event of ["closed_no_sale", "sale_closed", "unanswered"] as const) {
    if (triggersForEvent(graph, event).length > 0) out.add(event);
  }
  return out;
}

const TRIGGER_EVENT_NAMES: Record<string, string> = {
  closed_no_sale: "chat cerrado sin venta",
  sale_closed: "venta cerrada",
  unanswered: "cliente sin respuesta",
};

// Two active flows that overlap on a channel and fire the same trigger would send
// the customer the same follow-up twice. Returns the colliding flow names.
async function findTriggerConflicts(
  selfId: number | null,
  channels: ChannelList,
  graph: WorkflowGraph,
): Promise<string[]> {
  const mine = triggerEventsInGraph(graph);
  if (mine.size === 0) return [];
  const actives = await db.select().from(workflowsTable).where(eq(workflowsTable.isActive, true));
  const out: string[] = [];
  for (const other of actives) {
    if (selfId != null && other.id === selfId) continue;
    if (!channelsOverlap(channels, other.channels)) continue;
    const theirs = triggerEventsInGraph(other.graph);
    for (const event of mine) {
      if (theirs.has(event)) out.push(`el disparador "${TRIGGER_EVENT_NAMES[event]}" ya lo tiene el flujo activo "${other.name}"`);
    }
  }
  return out;
}

// Two flows share a channel when their channel sets intersect. A general flow
// (null/empty) applies to every channel, so it overlaps any other flow.
function channelsOverlap(a: ChannelList, b: ChannelList): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length === 0 || bb.length === 0) return true;
  return aa.some((c) => bb.includes(c));
}

// The anti-duplication control. Two active flows interfere only when they overlap
// on a channel AND both handle the same intent label — then a message with that
// label on that channel could be routed by either flow. Returns those collisions
// (empty when the flow can be activated safely).
async function findFlowConflicts(
  selfId: number | null,
  channels: ChannelList,
  graph: WorkflowGraph,
): Promise<Array<{ workflowId: number; workflowName: string; labelId: number }>> {
  const myLabels = labelIdsInGraph(graph);
  if (myLabels.size === 0) return [];
  const actives = await db.select().from(workflowsTable).where(eq(workflowsTable.isActive, true));
  const conflicts: Array<{ workflowId: number; workflowName: string; labelId: number }> = [];
  for (const other of actives) {
    if (selfId != null && other.id === selfId) continue;
    if (!channelsOverlap(channels, other.channels)) continue;
    const otherLabels = labelIdsInGraph(other.graph);
    for (const labelId of myLabels) {
      if (otherLabels.has(labelId)) conflicts.push({ workflowId: other.id, workflowName: other.name, labelId });
    }
  }
  return conflicts;
}

// Builds a human-readable 409 body from the raw conflicts (resolving label names).
async function conflictResponse(conflicts: Array<{ workflowId: number; workflowName: string; labelId: number }>) {
  const labelIds = [...new Set(conflicts.map((c) => c.labelId))];
  const labels = labelIds.length
    ? await db.select().from(labelsTable).where(inArray(labelsTable.id, labelIds))
    : [];
  const nameOf = (id: number) => labels.find((l) => l.id === id)?.name ?? `#${id}`;
  const detail = conflicts
    .map((c) => `la etiqueta "${nameOf(c.labelId)}" ya la maneja el flujo activo "${c.workflowName}"`)
    .filter((v, i, a) => a.indexOf(v) === i);
  return {
    error:
      `No se puede activar: habría interferencia de flujos. ${detail.join("; ")}. ` +
      `Desactiva ese flujo, o usa otra etiqueta o canal para este.`,
    conflicts: conflicts.map((c) => ({ ...c, labelName: nameOf(c.labelId) })),
  };
}

function triggerConflictMessage(detail: string[]): string {
  return (
    `No se puede activar: el cliente recibiría el mismo seguimiento dos veces. ${[...new Set(detail)].join("; ")}. ` +
    "Desactiva ese flujo, quita el disparador de uno de los dos o usa otro canal."
  );
}

router.get("/workflows", async (_req, res): Promise<void> => {
  const rows = await db.select().from(workflowsTable).orderBy(workflowsTable.createdAt);
  res.json(rows);
});

router.get("/workflows/:id", async (req, res): Promise<void> => {
  const params = GetWorkflowParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [workflow] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, params.data.id));
  if (!workflow) {
    res.status(404).json({ error: "Workflow not found" });
    return;
  }
  res.json(workflow);
});

router.post("/workflows", async (req, res): Promise<void> => {
  const parsed = CreateWorkflowBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const isActive = parsed.data.isActive ?? true;
  const channels = normalizeChannels(parsed.data.channels);
  const graph = sanitizeGraph(req.body?.graph);

  if (isActive) {
    const conflicts = await findFlowConflicts(null, channels, graph);
    if (conflicts.length > 0) {
      res.status(409).json(await conflictResponse(conflicts));
      return;
    }
    const triggerConflicts = await findTriggerConflicts(null, channels, graph);
    if (triggerConflicts.length > 0) {
      res.status(409).json({ error: triggerConflictMessage(triggerConflicts), conflicts: [] });
      return;
    }
  }

  const [workflow] = await db
    .insert(workflowsTable)
    .values({ name: parsed.data.name, channels, isActive, graph })
    .returning();

  res.status(201).json(workflow);
});

router.patch("/workflows/:id", async (req, res): Promise<void> => {
  const params = UpdateWorkflowParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateWorkflowBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Workflow not found" });
    return;
  }

  // Validate against the state the flow WOULD have after this patch.
  const nextIsActive = parsed.data.isActive ?? existing.isActive;
  const nextChannels =
    parsed.data.channels !== undefined ? normalizeChannels(parsed.data.channels) : existing.channels;
  const nextGraph = req.body?.graph !== undefined ? sanitizeGraph(req.body.graph) : existing.graph;

  if (nextIsActive) {
    const conflicts = await findFlowConflicts(existing.id, nextChannels, nextGraph);
    if (conflicts.length > 0) {
      res.status(409).json(await conflictResponse(conflicts));
      return;
    }
    const triggerConflicts = await findTriggerConflicts(existing.id, nextChannels, nextGraph);
    if (triggerConflicts.length > 0) {
      res.status(409).json({ error: triggerConflictMessage(triggerConflicts), conflicts: [] });
      return;
    }
  }

  const updateData: Partial<typeof workflowsTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.channels !== undefined) updateData.channels = nextChannels;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
  if (req.body?.graph !== undefined) updateData.graph = nextGraph;

  const [workflow] = await db
    .update(workflowsTable)
    .set(updateData)
    .where(eq(workflowsTable.id, params.data.id))
    .returning();

  res.json(workflow);
});

router.delete("/workflows/:id", async (req, res): Promise<void> => {
  const params = DeleteWorkflowParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [workflow] = await db.delete(workflowsTable).where(eq(workflowsTable.id, params.data.id)).returning();

  if (!workflow) {
    res.status(404).json({ error: "Workflow not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
