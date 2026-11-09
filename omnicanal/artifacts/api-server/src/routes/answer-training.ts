import { Router, type IRouter, type Request, type Response } from "express";
import {
  ApproveAnswerReviewParams,
  ApproveAnswerReviewResponse,
  CreateAnswerReviewBody,
  DeleteAnswerReviewParams,
  GeneratePendingAnswersResponse,
  ImportAnswerQuestionsBody,
  ImportAnswerQuestionsResponse,
  ListAnswerReviewsResponse,
  ProcessAnswerReviewBody,
  ProcessAnswerReviewParams,
  ProcessAnswerReviewResponse,
  RegenerateAnswerReviewParams,
  RegenerateAnswerReviewResponse,
  UpdateAnswerReviewBody,
  UpdateAnswerReviewParams,
  UpdateAnswerReviewResponse,
} from "@workspace/api-zod";
import {
  AnswerTrainingError,
  addQuestion,
  approveAnswer,
  deleteReview,
  detectChatQuestions,
  generatePendingAnswers,
  importKnowledgeQuestions,
  listAnswerReviews,
  processAnswer,
  regenerateAnswer,
  updateReview,
} from "../lib/answer-training";

// Entrenar respuestas (lib/answer-training.ts): las preguntas comunes con la
// respuesta que da hoy el agente, las indicaciones del equipo y la instrucción
// aprobada. Solo quien tiene la vista "answer-training" (VIEW_GATES).
const router: IRouter = Router();

// Los errores esperables (sin IA, pregunta repetida, sin respuesta que aprobar)
// llegan al panel con su mensaje; el resto sigue al manejador general.
async function run(res: Response, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    if (err instanceof AnswerTrainingError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}

function reviewOut(row: Awaited<ReturnType<typeof updateReview>>) {
  return UpdateAnswerReviewResponse.parse({ ...row, approvedByName: null });
}

router.get("/answer-training", async (_req, res): Promise<void> => {
  res.json(ListAnswerReviewsResponse.parse(await listAnswerReviews()));
});

router.post("/answer-training", async (req, res): Promise<void> => {
  const body = CreateAnswerReviewBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  await run(res, async () => {
    const row = await addQuestion(body.data);
    res.status(201).json(reviewOut(row));
  });
});

router.post("/answer-training/import", async (req, res): Promise<void> => {
  const body = ImportAnswerQuestionsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  await run(res, async () => {
    const result =
      body.data.source === "knowledge" ? await importKnowledgeQuestions() : await detectChatQuestions(body.data.days ?? 30);
    req.log.info({ source: body.data.source, ...result }, "answer training: questions imported");
    res.json(ImportAnswerQuestionsResponse.parse(result));
  });
});

router.post("/answer-training/generate-pending", async (_req, res): Promise<void> => {
  res.json(GeneratePendingAnswersResponse.parse(await generatePendingAnswers()));
});

function idParam(req: Request, res: Response, schema: typeof UpdateAnswerReviewParams): number | null {
  const params = schema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return null;
  }
  return params.data.id;
}

router.patch("/answer-training/:id", async (req, res): Promise<void> => {
  const id = idParam(req, res, UpdateAnswerReviewParams);
  if (id == null) return;
  const body = UpdateAnswerReviewBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  await run(res, async () => {
    const row = await updateReview(id, body.data);
    res.json(reviewOut(row));
  });
});

router.delete("/answer-training/:id", async (req, res): Promise<void> => {
  const id = idParam(req, res, DeleteAnswerReviewParams);
  if (id == null) return;
  await run(res, async () => {
    await deleteReview(id);
    res.status(204).end();
  });
});

router.post("/answer-training/:id/process", async (req, res): Promise<void> => {
  const id = idParam(req, res, ProcessAnswerReviewParams);
  if (id == null) return;
  const body = ProcessAnswerReviewBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  await run(res, async () => {
    const row = await processAnswer(id, body.data.indications);
    res.json(ProcessAnswerReviewResponse.parse({ ...row, approvedByName: null }));
  });
});

router.post("/answer-training/:id/regenerate", async (req, res): Promise<void> => {
  const id = idParam(req, res, RegenerateAnswerReviewParams);
  if (id == null) return;
  await run(res, async () => {
    const row = await regenerateAnswer(id);
    res.json(RegenerateAnswerReviewResponse.parse({ ...row, approvedByName: null }));
  });
});

router.post("/answer-training/:id/approve", async (req, res): Promise<void> => {
  const id = idParam(req, res, ApproveAnswerReviewParams);
  if (id == null) return;
  await run(res, async () => {
    const row = await approveAnswer(id, req.user?.agentId ?? null);
    req.log.info({ answerReviewId: id }, "answer training: answer approved, agents now read its instruction");
    res.json(ApproveAnswerReviewResponse.parse({ ...row, approvedByName: null }));
  });
});

export default router;
