import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, tenantOverridesTable } from "@workspace/db";
import { clientConfig } from "../lib/client-config";
import { MODULE_KEYS } from "@workspace/platform-config";
import { z } from "zod";

const router: IRouter = Router();

// ── helpers ────────────────────────────────────────────────────────────────────

async function ensureRow() {
  const [row] = await db.select().from(tenantOverridesTable).orderBy(tenantOverridesTable.id).limit(1);
  if (row) return row;
  const [created] = await db
    .insert(tenantOverridesTable)
    .values({ clientId: clientConfig.id, monthlyPrice: 0, subscriptionStatus: "active" })
    .returning();
  return created;
}

function parseModulesJson(json: string | null | undefined): Record<string, boolean> | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, boolean>;
  } catch {
    return null;
  }
}

function parseBrandingJson(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildResponse(row: typeof tenantOverridesTable.$inferSelect) {
  return {
    clientId: row.clientId,
    subscriptionStatus: row.subscriptionStatus,
    subscriptionPaidUntil: row.subscriptionPaidUntil?.toISOString() ?? null,
    monthlyPrice: row.monthlyPrice,
    blockedManually: row.blockedManually,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
    modules: parseModulesJson(row.modulesJson) ?? {},
    branding: parseBrandingJson(row.brandingJson) ?? {},
    // Lista completa de módulos disponibles con su estado efectivo
    allModules: MODULE_KEYS.map((key) => ({
      key,
      enabled: parseModulesJson(row.modulesJson)?.[key] ?? clientConfig.modules[key] ?? true,
    })),
  };
}

const UpdateBody = z.object({
  modules: z.record(z.boolean()).optional(),
  branding: z
    .object({
      logoUrl: z.string().nullable().optional(),
      primaryColor: z.string().nullable().optional(),
      secondaryColor: z.string().nullable().optional(),
      accentColor: z.string().nullable().optional(),
      productName: z.string().optional(),
      tagline: z.string().optional(),
    })
    .optional(),
  subscriptionStatus: z.enum(["active", "trial", "suspended"]).optional(),
  subscriptionPaidUntil: z.string().nullable().optional(),
  monthlyPrice: z.number().int().nonnegative().optional(),
  blockedManually: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

// ── GET /platform-admin/tenant ─────────────────────────────────────────────────
router.get("/tenant", async (_req, res): Promise<void> => {
  const row = await ensureRow();
  res.json(buildResponse(row));
});

// ── PUT /platform-admin/tenant ─────────────────────────────────────────────────
router.put("/tenant", async (req, res): Promise<void> => {
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const row = await ensureRow();
  const upd: Partial<typeof tenantOverridesTable.$inferInsert> = { updatedAt: new Date() };

  if (parsed.data.modules !== undefined) {
    upd.modulesJson = JSON.stringify(parsed.data.modules);
  }
  if (parsed.data.branding !== undefined) {
    const existing = parseBrandingJson(row.brandingJson) ?? {};
    upd.brandingJson = JSON.stringify({ ...existing, ...parsed.data.branding });
  }
  if (parsed.data.subscriptionStatus !== undefined) upd.subscriptionStatus = parsed.data.subscriptionStatus;
  if (parsed.data.subscriptionPaidUntil !== undefined) {
    upd.subscriptionPaidUntil = parsed.data.subscriptionPaidUntil ? new Date(parsed.data.subscriptionPaidUntil) : null;
  }
  if (parsed.data.monthlyPrice !== undefined) upd.monthlyPrice = parsed.data.monthlyPrice;
  if (parsed.data.blockedManually !== undefined) upd.blockedManually = parsed.data.blockedManually;
  if (parsed.data.notes !== undefined) upd.notes = parsed.data.notes;

  await db.update(tenantOverridesTable).set(upd).where(eq(tenantOverridesTable.id, row.id));

  const updated = await ensureRow();
  res.json(buildResponse(updated));
});

export default router;
