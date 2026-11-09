import { useMemo } from "react";
import type { ReportChannelStat, ReportCampaignStat, ReportLabelChannelCell } from "@workspace/api-client-react";
import { MessageSquare, Clock, CheckCircle, Users, Send, Inbox, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReportChannel } from "./channels";

function fmtMin(m: number): string {
  if (m <= 0) return "—";
  if (m < 1) return `${Math.round(m * 60)}s`;
  if (m < 60) return `${m.toFixed(1)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function StatTile({ label, value, icon: Icon, sub, tone = "primary" }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; sub?: string; tone?: "primary" | "green" | "yellow" | "purple" }) {
  const bg = tone === "green" ? "bg-green-500/12" : tone === "yellow" ? "bg-yellow-500/12" : tone === "purple" ? "bg-purple-500/12" : "bg-primary/12";
  const fg = tone === "green" ? "text-green-600" : tone === "yellow" ? "text-yellow-600" : tone === "purple" ? "text-purple-600" : "text-primary";
  return (
    <div className="bg-card border border-card-border rounded-xl p-4 flex items-start gap-3">
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0", bg)}>
        <Icon className={cn("w-4.5 h-4.5", fg)} />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold text-foreground tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground font-medium mt-0.5">{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground/70 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export function ChannelDetailTab({
  channel,
  channelStats,
  campaignStats,
  labelCells,
}: {
  channel: ReportChannel;
  channelStats: ReportChannelStat[];
  campaignStats: ReportCampaignStat[];
  labelCells: ReportLabelChannelCell[];
}) {
  const stat = channelStats.find((c) => c.channel === channel);
  const camp = campaignStats.find((c) => c.channel === channel);
  const labels = useMemo(
    () =>
      labelCells
        .filter((c) => c.channel === channel)
        .sort((a, b) => b.conversations - a.conversations)
        .slice(0, 8),
    [labelCells, channel],
  );

  if (!stat) return <p className="p-5 text-sm text-muted-foreground text-center">Sin datos del canal en el periodo.</p>;

  const maxLabel = Math.max(...labels.map((l) => l.conversations), 1);

  return (
    <div className="p-5 space-y-6" data-testid={`report-channel-detail-${channel}`}>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Conversaciones" value={stat.conversations} icon={MessageSquare} />
        <StatTile label="Tasa resolución" value={`${stat.resolutionRate}%`} icon={CheckCircle} tone="green" sub={`${stat.resolved} resueltas`} />
        <StatTile label="1ª respuesta" value={fmtMin(stat.avgFirstResponseMinutes)} icon={Clock} tone="yellow" sub={`p95 ${fmtMin(stat.p95FirstResponseMinutes)}`} />
        <StatTile label="Resolución avg" value={fmtMin(stat.avgResolutionMinutes)} icon={Clock} tone="purple" />
        <StatTile label="Recibidos / enviados" value={`${stat.inboundMessages.toLocaleString("es-DO")} / ${stat.outboundMessages.toLocaleString("es-DO")}`} icon={Send} />
        <StatTile label="Nuevos / recurrentes" value={`${stat.newContacts} / ${stat.returningContacts}`} icon={Users} tone="green" />
      </div>

      <div className={cn("grid grid-cols-1 gap-4", camp && "lg:grid-cols-2")}>
        <div className="bg-card border border-card-border rounded-xl">
          <div className="px-5 py-3 border-b border-card-border">
            <h3 className="text-sm font-semibold text-foreground">Top intents del canal</h3>
          </div>
          <div className="p-5 space-y-3">
            {labels.length === 0 && <p className="text-sm text-muted-foreground text-center">Sin conversaciones etiquetadas.</p>}
            {labels.map((l) => (
              <div key={l.labelId ?? "none"}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
                  <span className="text-sm text-foreground truncate">{l.labelName}</span>
                  <span className="ml-auto text-xs font-semibold tabular-nums">{l.conversations}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(l.conversations / maxLabel) * 100}%`, background: l.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* El correo no tiene campañas: solo salen por los canales de Meta. */}
        {camp && (
          <div className="bg-card border border-card-border rounded-xl">
            <div className="px-5 py-3 border-b border-card-border">
              <h3 className="text-sm font-semibold text-foreground">Campañas del canal</h3>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <StatTile label="Campañas" value={camp.campaignsSent} icon={Send} />
              <StatTile label="Destinatarios" value={camp.recipients.toLocaleString("es-DO")} icon={Users} />
              <StatTile label="Enviados (aceptados por Meta)" value={camp.sent.toLocaleString("es-DO")} icon={Inbox} tone="green" />
              <StatTile label="Fallidos" value={camp.failed.toLocaleString("es-DO")} icon={XCircle} tone="yellow" />
            </div>
          </div>
        )}
      </div>

      <div className="bg-card border border-card-border rounded-xl">
        <div className="px-5 py-3 border-b border-card-border">
          <h3 className="text-sm font-semibold text-foreground">Distribución de mensajes</h3>
        </div>
        <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatTile label="Msg/conversación" value={stat.avgMessagesPerConversation.toFixed(1)} icon={MessageSquare} />
          <StatTile label="Mediana 1ª resp." value={fmtMin(stat.medianFirstResponseMinutes)} icon={Clock} tone="yellow" />
          <StatTile label="p95 1ª resp." value={fmtMin(stat.p95FirstResponseMinutes)} icon={Clock} tone="yellow" />
        </div>
      </div>
    </div>
  );
}
