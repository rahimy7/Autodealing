import { Router, type IRouter } from "express";
import {
  ListAgentLessonsQueryParams,
  ListAgentLessonsResponse,
  UpdateAgentLessonParams,
  UpdateAgentLessonBody,
  UpdateAgentLessonResponse,
} from "@workspace/api-zod";
import { listLessons, updateLesson } from "../lib/agent-learning";

// Aprendizajes: lo que los agentes virtuales aprendieron de chats reales
// (lib/agent-learning.ts). El equipo revisa las sugeridas, activa o descarta, y
// puede reescribir la regla antes de que la lean los agentes. Solo administración
// (ADMIN_PREFIXES en middlewares/auth.ts).
const router: IRouter = Router();

router.get("/agent-lessons", async (req, res): Promise<void> => {
  const query = ListAgentLessonsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const lessons = await listLessons({ status: query.data.status });
  res.json(ListAgentLessonsResponse.parse(lessons));
});

router.patch("/agent-lessons/:id", async (req, res): Promise<void> => {
  const params = UpdateAgentLessonParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateAgentLessonBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const updated = await updateLesson(params.data.id, body.data);
  if (!updated) {
    res.status(404).json({ error: "Aprendizaje no encontrado." });
    return;
  }
  req.log.info({ lessonId: updated.id, status: updated.status }, "agent lesson updated from the panel");
  res.json(UpdateAgentLessonResponse.parse(updated));
});

export default router;
