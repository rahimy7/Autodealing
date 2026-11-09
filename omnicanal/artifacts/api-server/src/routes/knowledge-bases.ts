import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, knowledgeBasesTable } from "@workspace/db";
import {
  CreateKnowledgeBaseBody,
  UpdateKnowledgeBaseBody,
  UpdateKnowledgeBaseParams,
  GetKnowledgeBaseParams,
  DeleteKnowledgeBaseParams,
  ListKnowledgeBasesResponse,
  GetKnowledgeBaseResponse,
  UpdateKnowledgeBaseResponse,
  AssistKnowledgeQuestionBody,
  AssistKnowledgeQuestionResponse,
} from "@workspace/api-zod";
import { generateKnowledgeQuestion } from "../lib/openai-client";

const router: IRouter = Router();

// AI assistant behind the "IA" button of the question editor: rewords a question
// and suggests a category to file it under. Registered before the `:id` routes
// only for readability — the method (POST) and this literal path don't collide
// with them either way.
router.post("/knowledge-bases/assist-question", async (req, res): Promise<void> => {
  const parsed = AssistKnowledgeQuestionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await generateKnowledgeQuestion({
    question: parsed.data.question,
    answer: parsed.data.answer ?? null,
    categories: parsed.data.categories ?? [],
  });
  res.json(AssistKnowledgeQuestionResponse.parse(result));
});

router.get("/knowledge-bases", async (_req, res): Promise<void> => {
  const rows = await db.select().from(knowledgeBasesTable).orderBy(knowledgeBasesTable.createdAt);
  res.json(ListKnowledgeBasesResponse.parse(rows));
});

router.get("/knowledge-bases/:id", async (req, res): Promise<void> => {
  const params = GetKnowledgeBaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [kb] = await db.select().from(knowledgeBasesTable).where(eq(knowledgeBasesTable.id, params.data.id));
  if (!kb) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }
  res.json(GetKnowledgeBaseResponse.parse(kb));
});

router.post("/knowledge-bases", async (req, res): Promise<void> => {
  const parsed = CreateKnowledgeBaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [kb] = await db
    .insert(knowledgeBasesTable)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      content: parsed.data.content ?? "",
    })
    .returning();
  res.status(201).json(kb);
});

router.patch("/knowledge-bases/:id", async (req, res): Promise<void> => {
  const params = UpdateKnowledgeBaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateKnowledgeBaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Partial<typeof knowledgeBasesTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.content !== undefined) updateData.content = parsed.data.content ?? "";

  const [kb] = await db
    .update(knowledgeBasesTable)
    .set(updateData)
    .where(eq(knowledgeBasesTable.id, params.data.id))
    .returning();
  if (!kb) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }
  res.json(UpdateKnowledgeBaseResponse.parse(kb));
});

router.delete("/knowledge-bases/:id", async (req, res): Promise<void> => {
  const params = DeleteKnowledgeBaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [kb] = await db.delete(knowledgeBasesTable).where(eq(knowledgeBasesTable.id, params.data.id)).returning();
  if (!kb) {
    res.status(404).json({ error: "Knowledge base not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
