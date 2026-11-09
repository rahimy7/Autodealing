import type { ReportAgentStat } from "@workspace/api-client-react";
import { Bot, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";

function fmtMin(m: number): string {
  if (m <= 0) return "—";
  if (m < 60) return `${m.toFixed(0)}m`;
  const h = m / 60;
  return h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`;
}

function rateColor(rate: number): string {
  return rate >= 70
    ? "bg-green-500/15 text-green-600"
    : rate >= 40
      ? "bg-yellow-500/15 text-yellow-600"
      : "bg-red-500/15 text-red-600";
}

export function AgentWorkloadPanel({ rows }: { rows: ReportAgentStat[] }) {
  const maxConv = Math.max(...rows.map((r) => r.conversations), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[900px]" data-testid="report-agent-workload">
        <thead>
          <tr className="border-b border-card-border text-xs text-muted-foreground">
            <th className="text-left font-medium px-5 py-3">Agente</th>
            <th className="text-left font-medium px-3 py-3">Tipo</th>
            <th className="text-left font-medium px-3 py-3 w-40">Conversaciones</th>
            <th className="text-right font-medium px-3 py-3">Resueltas</th>
            <th className="text-right font-medium px-3 py-3">Tasa</th>
            <th className="text-right font-medium px-3 py-3">Mensajes</th>
            <th className="text-right font-medium px-3 py-3">1ª resp</th>
            <th className="text-right font-medium px-3 py-3">Resolución</th>
            <th className="text-right font-medium px-3 py-3" title="Minutos activos aprox. según mensajes salientes">Activo (aprox)</th>
            <th className="text-right font-medium px-3 py-3">Chats concurrentes</th>
            <th className="text-right font-medium px-3 py-3">Utilización</th>
            <th className="text-right font-medium px-5 py-3">Takeovers</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.agentId} className="border-b border-card-border/60 hover:bg-muted/40 transition-colors" data-testid={`report-workload-row-${a.agentId}`}>
              <td className="px-5 py-3 font-medium text-foreground whitespace-nowrap">{a.agentName}</td>
              <td className="px-3 py-3">
                <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full", a.type === "virtual" ? "bg-purple-500/12 text-purple-600" : "bg-primary/12 text-primary")}>
                  {a.type === "virtual" ? <Bot className="w-3 h-3" /> : <UserCog className="w-3 h-3" />}
                  {a.type === "virtual" ? "IA" : "Humano"}
                </span>
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${(a.conversations / maxConv) * 100}%` }} />
                  </div>
                  <span className="text-xs text-foreground tabular-nums w-8 text-right">{a.conversations}</span>
                </div>
              </td>
              <td className="px-3 py-3 text-right text-green-600 tabular-nums">{a.resolved}</td>
              <td className="px-3 py-3 text-right">
                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", rateColor(a.resolutionRate))}>{a.resolutionRate}%</span>
              </td>
              <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">{a.messages}</td>
              <td className="px-3 py-3 text-right text-muted-foreground tabular-nums whitespace-nowrap">{fmtMin(a.avgFirstResponseMinutes)}</td>
              <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">{fmtMin(a.avgResolutionMinutes)}</td>
              <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">{fmtMin(a.activeMinutes)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{a.avgConcurrentChats.toFixed(1)}</td>
              <td className="px-3 py-3 text-right">
                <UtilizationBar percent={a.utilizationPercent} />
              </td>
              <td className="px-5 py-3 text-right text-muted-foreground tabular-nums">{a.takeovers}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={12} className="px-5 py-8 text-center text-muted-foreground text-sm">Sin actividad de agentes en el periodo.</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="text-[11px] text-muted-foreground px-5 py-2">Utilización aproximada = minutos activos ÷ jornada de 8h por día del rango.</p>
    </div>
  );
}

function UtilizationBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const color = clamped >= 80 ? "bg-red-500" : clamped >= 60 ? "bg-green-500" : clamped >= 30 ? "bg-yellow-500" : "bg-muted-foreground/50";
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-xs tabular-nums w-8 text-right">{clamped}%</span>
    </div>
  );
}
