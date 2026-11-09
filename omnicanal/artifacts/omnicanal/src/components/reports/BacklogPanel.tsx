import type { ReportBacklog } from "@workspace/api-client-react";
import { AlertCircle, Clock, Hourglass } from "lucide-react";
import { CHANNEL_META } from "./channels";

function fmtMin(m: number): string {
  if (m <= 0) return "—";
  if (m < 60) return `${m.toFixed(0)} min`;
  const h = Math.floor(m / 60);
  const min = Math.round(m - h * 60);
  return `${h}h ${min}m`;
}

export function BacklogPanel({ backlog }: { backlog: ReportBacklog }) {
  return (
    <div className="p-5 space-y-5" data-testid="report-backlog">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile icon={AlertCircle} label="En cola ahora" value={backlog.pendingConversations.toString()} tone={backlog.pendingConversations > 0 ? "yellow" : "green"} />
        <Tile icon={Clock} label="Espera promedio" value={fmtMin(backlog.avgQueueMinutes)} tone="primary" />
        <Tile icon={Hourglass} label="Más antigua" value={fmtMin(backlog.oldestQueueAgeMinutes)} tone={backlog.oldestQueueAgeMinutes > 60 ? "red" : "primary"} />
      </div>

      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase mb-2">Por canal</h3>
        <div className="space-y-2">
          {backlog.byChannel.map((c) => {
            const meta = CHANNEL_META[c.channel];
            return (
              <div key={c.channel} className="flex items-center gap-3 py-1.5" data-testid={`report-backlog-${c.channel}`}>
                {meta && <meta.Icon className="w-4 h-4" style={{ color: meta.color }} />}
                <span className="text-sm text-foreground">{meta?.label ?? c.channel}</span>
                <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">{c.pending}</span>
                <span className="text-[11px] text-muted-foreground w-20 text-right tabular-nums">
                  {c.pending > 0 ? fmtMin(c.oldestAgeMinutes) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, icon: Icon, tone }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; tone: "primary" | "yellow" | "red" | "green" }) {
  const bg =
    tone === "yellow" ? "bg-yellow-500/12" : tone === "red" ? "bg-red-500/12" : tone === "green" ? "bg-green-500/12" : "bg-primary/12";
  const fg =
    tone === "yellow" ? "text-yellow-600" : tone === "red" ? "text-red-600" : tone === "green" ? "text-green-600" : "text-primary";
  return (
    <div className="bg-card border border-card-border rounded-xl p-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${bg}`}>
        <Icon className={`w-4 h-4 ${fg}`} />
      </div>
      <div>
        <div className="text-lg font-bold text-foreground tabular-nums leading-tight">{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
