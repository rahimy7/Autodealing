import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, labelsTable, workflowsTable } from "@workspace/db";
import {
  CreateLabelBody,
  UpdateLabelBody,
  UpdateLabelParams,
  DeleteLabelParams,
  ListLabelsResponse,
  UpdateLabelResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip combining diacritics
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "etiqueta"
  );
}

// The intent classifier only considers ACTIVE labels, so two active labels sharing
// a slug would compete and make classification ambiguous. Reject that (a partial
// unique index in the schema backs this up against races). Inactive duplicates are
// allowed — they don't take part in classification.
async function activeSlugTaken(slug: string, exceptId: number | null): Promise<boolean> {
  const rows = await db
    .select({ id: labelsTable.id })
    .from(labelsTable)
    .where(and(eq(labelsTable.slug, slug), eq(labelsTable.isActive, true)));
  return rows.some((r) => r.id !== exceptId);
}

// Deleting a label leaves its "label" nodes dangling in every workflow graph (the
// graph is opaque JSONB, so there is no FK to cascade). Strip those nodes and any
// edge touching them so the flows stay coherent and the engine never looks for a
// label that no longer exists.
async function removeLabelFromWorkflows(labelId: number): Promise<void> {
  const flows = await db.select().from(workflowsTable);
  for (const wf of flows) {
    const nodes = wf.graph?.nodes ?? [];
    const labelNodeIds = new Set(
      nodes.filter((n) => n?.data?.kind === "label" && n.data.labelId === labelId).map((n) => n.id),
    );
    if (labelNodeIds.size === 0) continue;
    const nextNodes = nodes.filter((n) => !labelNodeIds.has(n.id));
    const nextEdges = (wf.graph?.edges ?? []).filter(
      (e) => !labelNodeIds.has(e.source) && !labelNodeIds.has(e.target),
    );
    await db
      .update(workflowsTable)
      .set({ graph: { nodes: nextNodes, edges: nextEdges }, updatedAt: new Date() })
      .where(eq(workflowsTable.id, wf.id));
  }
}

router.get("/labels", async (_req, res): Promise<void> => {
  const rows = await db.select().from(labelsTable).orderBy(labelsTable.createdAt);
  res.json(ListLabelsResponse.parse(rows));
});

router.post("/labels", async (req, res): Promise<void> => {
  const parsed = CreateLabelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const slug = slugify(parsed.data.name);
  const isActive = parsed.data.isActive ?? true;
  if (isActive && (await activeSlugTaken(slug, null))) {
    res.status(409).json({ error: "Ya existe una etiqueta activa con ese nombre." });
    return;
  }

  const [label] = await db
    .insert(labelsTable)
    .values({
      name: parsed.data.name,
      slug,
      kind: parsed.data.kind ?? "intent",
      color: parsed.data.color ?? "#14b8a6",
      description: parsed.data.description ?? null,
      isActive,
      isSafeForAutoReply: (parsed.data as Record<string, unknown>).isSafeForAutoReply as boolean | undefined ?? false,
      isSafeForEmailAutoReply:
        (parsed.data as Record<string, unknown>).isSafeForEmailAutoReply as boolean | undefined ?? false,
      autoMigrateToDm: (parsed.data as Record<string, unknown>).autoMigrateToDm as boolean | undefined ?? false,
    })
    .returning();

  res.status(201).json(label);
});

router.patch("/labels/:id", async (req, res): Promise<void> => {
  const params = UpdateLabelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateLabelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(labelsTable).where(eq(labelsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Label not found" });
    return;
  }

  const nextSlug = parsed.data.name !== undefined ? slugify(parsed.data.name) : existing.slug;
  const nextActive = parsed.data.isActive ?? existing.isActive;
  if (nextActive && (await activeSlugTaken(nextSlug, existing.id))) {
    res.status(409).json({ error: "Ya existe una etiqueta activa con ese nombre." });
    return;
  }

  const updateData: Partial<typeof labelsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) {
    updateData.name = parsed.data.name;
    updateData.slug = nextSlug;
  }
  if (parsed.data.kind !== undefined) updateData.kind = parsed.data.kind;
  if (parsed.data.color !== undefined && parsed.data.color !== null) updateData.color = parsed.data.color;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
  if ((parsed.data as Record<string, unknown>).isSafeForAutoReply !== undefined)
    updateData.isSafeForAutoReply = (parsed.data as Record<string, unknown>).isSafeForAutoReply as boolean;
  if ((parsed.data as Record<string, unknown>).isSafeForEmailAutoReply !== undefined)
    updateData.isSafeForEmailAutoReply = (parsed.data as Record<string, unknown>)
      .isSafeForEmailAutoReply as boolean;
  if ((parsed.data as Record<string, unknown>).autoMigrateToDm !== undefined)
    updateData.autoMigrateToDm = (parsed.data as Record<string, unknown>).autoMigrateToDm as boolean;

  const [label] = await db.update(labelsTable).set(updateData).where(eq(labelsTable.id, params.data.id)).returning();

  res.json(UpdateLabelResponse.parse(label));
});

router.delete("/labels/:id", async (req, res): Promise<void> => {
  const params = DeleteLabelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [label] = await db.delete(labelsTable).where(eq(labelsTable.id, params.data.id)).returning();

  if (!label) {
    res.status(404).json({ error: "Label not found" });
    return;
  }

  await removeLabelFromWorkflows(params.data.id);

  res.sendStatus(204);
});

export default router;
