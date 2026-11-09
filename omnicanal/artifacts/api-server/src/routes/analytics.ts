import { Router, type IRouter } from "express";
import {
  GetAnalyticsSummaryResponse,
  GetChannelBreakdownResponse,
  GetAgentPerformanceResponse,
  GetDailyVolumeResponse,
  GetDailyVolumeQueryParams,
  GetReportsOverviewResponse,
} from "@workspace/api-zod";
import { loadReportsOverview, renderReportsCsv } from "../lib/reports";
import { loadDailyVolume, loadDashboardToday } from "../lib/dashboard";

const router: IRouter = Router();

// El panel de control mira el día de hoy del negocio y lo mide de verdad: de
// dónde sale cada cifra está en lib/dashboard.ts. Las tres primeras rutas son
// cortes del mismo día, así que se piden juntas y contestan lo mismo.

router.get("/analytics/summary", async (_req, res): Promise<void> => {
  const { summary } = await loadDashboardToday();
  res.json(GetAnalyticsSummaryResponse.parse(summary));
});

router.get("/analytics/channel-breakdown", async (_req, res): Promise<void> => {
  const { byChannel } = await loadDashboardToday();
  res.json(GetChannelBreakdownResponse.parse(byChannel));
});

router.get("/analytics/agent-performance", async (_req, res): Promise<void> => {
  const { byAgent } = await loadDashboardToday();
  res.json(GetAgentPerformanceResponse.parse(byAgent));
});

router.get("/analytics/daily-volume", async (req, res): Promise<void> => {
  const queryParams = GetDailyVolumeQueryParams.safeParse(req.query);
  const days = queryParams.success ? (queryParams.data.days ?? 30) : 30;
  res.json(GetDailyVolumeResponse.parse(await loadDailyVolume(days)));
});

// Admin reports: real performance metrics for the selected period, broken down by
// agent, by channel, by intent label, by locality, plus campaign delivery,
// backlog, activity heatmap and a labels × channel cross-tab. Everything is
// computed from actual message timestamps — no mock values — and internal audit
// notes (routing/escalation/session-closure) are excluded from customer traffic
// counts but still consumed as event log for takeovers, escalations and reopens.
router.get("/analytics/reports", async (req, res): Promise<void> => {
  const payload = await loadReportsOverview(parseReportsQuery(req.query));
  res.json(GetReportsOverviewResponse.parse(payload));
});

router.get("/analytics/reports.csv", async (req, res): Promise<void> => {
  const payload = await loadReportsOverview(parseReportsQuery(req.query));
  const filename = `reportes-${payload.periodFrom}-a-${payload.periodTo}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // BOM so Excel opens UTF-8 correctly.
  res.send("\uFEFF" + renderReportsCsv(payload));
});

// `from` y `to` se quedan como el día tal cual ("2026-09-14"): convertirlos con
// `new Date` los volvería la medianoche de UTC, que en el negocio es la noche
// anterior. El día del negocio lo resuelve `resolveWindow`.
function parseReportsQuery(q: unknown): { days: number | null; from: string | null; to: string | null } {
  const source = (q ?? {}) as Record<string, unknown>;
  const daysRaw = source["days"];
  const days = typeof daysRaw === "string" ? Number.parseInt(daysRaw, 10) : typeof daysRaw === "number" ? daysRaw : null;
  const dayKey = (value: unknown): string | null => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
  };
  return {
    days: days != null && Number.isFinite(days) ? Math.min(Math.max(days, 1), 365) : null,
    from: dayKey(source["from"]),
    to: dayKey(source["to"]),
  };
}

export default router;

