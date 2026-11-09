import { Router, type IRouter } from "express";
import { eq, gte } from "drizzle-orm";
import { db, planSettingsTable, messagesTable, agentsTable } from "@workspace/db";
import { UpdatePlanBody, GetPlanResponse, UpdatePlanResponse } from "@workspace/api-zod";

const router: IRouter = Router();

async function ensurePlan() {
  const [row] = await db.select().from(planSettingsTable).orderBy(planSettingsTable.id).limit(1);
  if (row) return row;
  const [created] = await db.insert(planSettingsTable).values({}).returning();
  return created;
}

async function buildPlan() {
  const plan = await ensurePlan();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const msgs = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(gte(messagesTable.createdAt, startOfMonth));
  const agents = await db.select({ id: agentsTable.id }).from(agentsTable);

  return {
    planName: plan.planName,
    monthlyPrice: plan.monthlyPrice,
    messagesUsed: msgs.length,
    messagesLimit: plan.messagesLimit,
    agentsUsed: agents.length,
    agentsLimit: plan.agentsLimit,
  };
}

router.get("/plan", async (_req, res): Promise<void> => {
  res.json(GetPlanResponse.parse(await buildPlan()));
});

router.put("/plan", async (req, res): Promise<void> => {
  const parsed = UpdatePlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const plan = await ensurePlan();
  const updateData: Partial<typeof planSettingsTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.planName !== undefined) updateData.planName = parsed.data.planName;
  if (parsed.data.monthlyPrice !== undefined) updateData.monthlyPrice = parsed.data.monthlyPrice;
  if (parsed.data.messagesLimit !== undefined) updateData.messagesLimit = parsed.data.messagesLimit;
  if (parsed.data.agentsLimit !== undefined) updateData.agentsLimit = parsed.data.agentsLimit;

  await db.update(planSettingsTable).set(updateData).where(eq(planSettingsTable.id, plan.id));
  res.json(UpdatePlanResponse.parse(await buildPlan()));
});

export default router;
