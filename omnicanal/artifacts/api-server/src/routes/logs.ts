import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db, errorLogsTable } from "@workspace/db";
import {
  ListErrorLogsQueryParams,
  ListErrorLogsResponse,
  ClearErrorLogsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// Los errores del servidor, del más reciente al más antiguo. Es lo que el panel
// enseña en Errores del sistema; sin esto, revisarlos obligaba a entrar al
// hosting.
router.get("/logs", async (req, res): Promise<void> => {
  const query = ListErrorLogsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const filters: SQL[] = [];
  if (query.data.level && query.data.level !== "all") {
    filters.push(eq(errorLogsTable.level, query.data.level));
  }
  if (query.data.search) {
    const like = `%${query.data.search}%`;
    const match = or(
      ilike(errorLogsTable.message, like),
      ilike(errorLogsTable.detail, like),
      ilike(errorLogsTable.url, like),
    );
    if (match) filters.push(match);
  }

  const limit = Math.min(query.data.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const rows = await db
    .select()
    .from(errorLogsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(errorLogsTable.id))
    .limit(limit);

  res.json(ListErrorLogsResponse.parse(rows));
});

router.delete("/logs", async (_req, res): Promise<void> => {
  const gone = await db.delete(errorLogsTable).returning({ id: errorLogsTable.id });
  res.json(ClearErrorLogsResponse.parse({ deleted: gone.length }));
});

export default router;
