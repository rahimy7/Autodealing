import { useMemo, useState } from "react";
import { useGetReportsOverview, getGetReportsOverviewQueryKey } from "@workspace/api-client-react";
import type { ReportAgentStat, ReportChannelStat, ReportLabelStat } from "@workspace/api-client-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  MessageSquare, CheckCircle, Clock, Users, Send, Inbox, Bot, UserCog, Tag, BarChart3,
  ArrowUpFromLine, RotateCcw, MapPin, AlertCircle, Activity, Megaphone, CalendarDays, ArrowLeftRight,
} from "lucide-react";
import Layout from "@/components/layout/Layout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { useClient } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { DateRangeFilter, formatDayKey, periodLabel, rangeToParams, shiftDay, type ReportRange } from "@/components/reports/DateRangeFilter";
import { CHANNEL_META, useReportChannels, type ReportChannel } from "@/components/reports/channels";
import { Heatmap } from "@/components/reports/Heatmap";
import { ChannelComparisonTable } from "@/components/reports/ChannelComparisonTable";
import { ChannelDetailTab } from "@/components/reports/ChannelDetailTab";
import { CampaignsTable } from "@/components/reports/CampaignsTable";
import { BacklogPanel } from "@/components/reports/BacklogPanel";
import { AgentWorkloadPanel } from "@/components/reports/AgentWorkloadPanel";
import { LocalityBreakdown } from "@/components/reports/LocalityBreakdown";
import { LabelChannelMatrix } from "@/components/reports/LabelChannelMatrix";
import { DailyComparisonBar, DailyChannelChart, DailyBreakdownTable } from "@/components/reports/DailyPerformance";
import { withBase } from "@/lib/base-path";

function formatDuration(minutes: number): string {
  if (minutes <= 0) return "—";
  if (minutes < 1) return `${Math.round(minutes * 60)} s`;
  if (minutes < 60) return `${minutes.toFixed(1)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

function rateColor(rate: number): string {
  return rate >= 70 ? "bg-green-500/15 text-green-600" : rate >= 40 ? "bg-yellow-500/15 text-yellow-600" : "bg-red-500/15 text-red-600";
}

function StatTile({ label, value, icon: Icon, sub, tone = "primary" }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; sub?: string; tone?: "primary" | "green" | "yellow" | "purple" | "red" }) {
  const bg = tone === "green" ? "bg-green-500/12" : tone === "yellow" ? "bg-yellow-500/12" : tone === "purple" ? "bg-purple-500/12" : tone === "red" ? "bg-red-500/12" : "bg-primary/12";
  const fg = tone === "green" ? "text-green-600" : tone === "yellow" ? "text-yellow-600" : tone === "purple" ? "text-purple-600" : tone === "red" ? "text-red-600" : "text-primary";
  return (
    <div className="bg-card border border-card-border rounded-xl p-4 flex items-start gap-3" data-testid={`report-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
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

function SectionCard({ title, subtitle, icon: Icon, children, className }: { title: string; subtitle?: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card border border-card-border rounded-xl", className)}>
      <div className="px-5 py-4 border-b border-card-border flex items-center gap-2.5">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold text-foreground leading-tight">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function LabelBreakdown({ rows }: { rows: ReportLabelStat[] }) {
  const maxConv = Math.max(...rows.map((r) => r.conversations), 1);
  if (rows.length === 0) return <p className="p-5 text-sm text-muted-foreground text-center">Aún no hay conversaciones etiquetadas.</p>;
  return (
    <div className="p-5 space-y-3">
      {rows.map((r) => (
        <div key={r.labelId ?? "none"} data-testid={`report-label-${r.labelId ?? "none"}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: r.color }} />
            <span className="text-sm font-medium text-foreground truncate">{r.labelName}</span>
            <span className="ml-auto text-xs font-semibold text-foreground tabular-nums">{r.conversations}</span>
            <span className="text-[11px] text-muted-foreground w-10 text-right tabular-nums">{r.share}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(r.conversations / maxConv) * 100}%`, background: r.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChannelBreakdown({ rows }: { rows: ReportChannelStat[] }) {
  const maxConv = Math.max(...rows.map((r) => r.conversations), 1);
  const active = rows.filter((r) => r.conversations > 0);
  return (
    <div className="p-5 space-y-4">
      {active.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sin conversaciones en el periodo.</p>}
      {active.map((r) => {
        const meta = CHANNEL_META[r.channel];
        return (
          <div key={r.channel} data-testid={`report-channel-${r.channel}`}>
            <div className="flex items-center gap-2 mb-1.5">
              {meta && <meta.Icon className="w-4 h-4 flex-shrink-0" style={{ color: meta.color }} />}
              <span className="text-sm font-medium text-foreground">{meta?.label ?? r.channel}</span>
              <span className="ml-auto text-sm font-bold text-foreground tabular-nums">{r.conversations}</span>
              <span className="text-[11px] text-muted-foreground">conv.</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(r.conversations / maxConv) * 100}%`, background: meta?.color ?? "hsl(var(--primary))" }} />
            </div>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
              <span>{r.resolutionRate}% resueltas</span>
              <span>·</span>
              <span>{formatDuration(r.avgFirstResponseMinutes)} 1ª resp.</span>
              <span className="ml-auto tabular-nums">{r.inboundMessages}↓ / {r.outboundMessages}↑</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgentTable({ rows }: { rows: ReportAgentStat[] }) {
  const maxConv = Math.max(...rows.map((r) => r.conversations), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]" data-testid="report-agent-table">
        <thead>
          <tr className="border-b border-card-border">
            <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">Agente</th>
            <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3">Tipo</th>
            <th className="text-left text-xs font-medium text-muted-foreground px-3 py-3 w-48">Conversaciones</th>
            <th className="text-right text-xs font-medium text-muted-foreground px-3 py-3">Resueltas</th>
            <th className="text-right text-xs font-medium text-muted-foreground px-3 py-3">Mensajes</th>
            <th className="text-right text-xs font-medium text-muted-foreground px-3 py-3">1ª resp.</th>
            <th className="text-right text-xs font-medium text-muted-foreground px-5 py-3">Tasa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.agentId} className="border-b border-card-border/60 hover:bg-muted/40 transition-colors" data-testid={`report-agent-row-${a.agentId}`}>
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
              <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">{a.messages}</td>
              <td className="px-3 py-3 text-right text-muted-foreground tabular-nums whitespace-nowrap">{formatDuration(a.avgFirstResponseMinutes)}</td>
              <td className="px-5 py-3 text-right">
                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", rateColor(a.resolutionRate))}>{a.resolutionRate}%</span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground text-sm">No hay datos de agentes en el periodo.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const [range, setRange] = useState<ReportRange>({ kind: "preset", days: 30 });
  const params = useMemo(() => rangeToParams(range), [range]);
  const { data, isLoading } = useGetReportsOverview(params);
  const { token } = useAuth();
  const { locale } = useClient();
  const [isExporting, setIsExporting] = useState(false);
  const channels = useReportChannels(data?.byChannel);
  const [selectedChannel, setSelectedChannel] = useState<ReportChannel>("whatsapp");
  const activeChannel = channels.includes(selectedChannel) ? selectedChannel : (channels[0] ?? "whatsapp");

  const summary = data?.summary;
  const dailySales = useMemo(() => (data?.daily ?? []).reduce((s, d) => s + d.sales, 0), [data]);

  // Mismo largo que el periodo actual, terminando justo el día anterior a que
  // empiece — así "comparar" siempre es contra un tramo del mismo tamaño.
  const [compareEnabled, setCompareEnabled] = useState(false);
  const compareParams = useMemo(() => {
    if (!data) return undefined;
    const prevTo = shiftDay(data.periodFrom, -1);
    const prevFrom = shiftDay(prevTo, -(data.periodDays - 1));
    return { from: prevFrom, to: prevTo };
  }, [data]);
  const { data: compareData, isFetching: isCompareLoading } = useGetReportsOverview(compareParams, {
    query: { enabled: compareEnabled && !!compareParams, queryKey: getGetReportsOverviewQueryKey(compareParams) },
  });
  const compareSales = useMemo(() => (compareData?.daily ?? []).reduce((s, d) => s + d.sales, 0), [compareData]);
  const chartData =
    data?.daily.map((d) => ({
      date: formatDayKey(d.date, { month: "short", day: "numeric" }),
      conversaciones: d.conversations,
      mensajes: d.messages,
    })) ?? [];

  const exportCsv = async () => {
    setIsExporting(true);
    try {
      const q = new URLSearchParams();
      if (params.days != null) q.set("days", String(params.days));
      if (params.from) q.set("from", params.from);
      if (params.to) q.set("to", params.to);
      const res = await fetch(withBase(`/api/analytics/reports.csv?${q.toString()}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "reportes.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Layout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">Reportes</h1>
            <p className="text-sm text-muted-foreground" data-testid="report-period-label">
              {data ? (
                <>
                  Mostrando <span className="font-medium text-foreground">{periodLabel(data.periodFrom, data.periodTo)}</span>
                  {" "}— conversaciones con actividad en esas fechas, en todos los canales.
                </>
              ) : (
                "Desempeño del sistema, agentes y canales — todas las métricas operativas."
              )}
            </p>
          </div>
          <DateRangeFilter value={range} onChange={setRange} onExport={exportCsv} isExporting={isExporting} />
        </div>

        <Tabs defaultValue="general">
          <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-card border border-card-border p-1">
            <TabsTrigger value="general" data-testid="report-tab-general" className="flex-1 min-w-[110px]">General</TabsTrigger>
            <TabsTrigger value="channels" data-testid="report-tab-channels" className="flex-1 min-w-[110px]">Por canal</TabsTrigger>
            <TabsTrigger value="daily" data-testid="report-tab-daily" className="flex-1 min-w-[110px]">Por día</TabsTrigger>
            <TabsTrigger value="agents" data-testid="report-tab-agents" className="flex-1 min-w-[110px]">Agentes</TabsTrigger>
            <TabsTrigger value="campaigns" data-testid="report-tab-campaigns" className="flex-1 min-w-[110px]">Campañas</TabsTrigger>
            <TabsTrigger value="backlog" data-testid="report-tab-backlog" className="flex-1 min-w-[110px]">Backlog & carga</TabsTrigger>
          </TabsList>

          {/* ── General ─────────────────────────────────────────────────────── */}
          <TabsContent value="general" className="space-y-6 mt-4">
            {isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="bg-card border border-card-border rounded-xl h-20 animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  <StatTile label="Conversaciones" value={summary?.conversations ?? 0} icon={MessageSquare} sub="con actividad en el periodo" />
                  <StatTile label="Tasa resolución" value={`${summary?.resolutionRate ?? 0}%`} icon={CheckCircle} tone="green" sub={`${summary?.resolved ?? 0} resueltas`} />
                  <StatTile label="1ª respuesta" value={formatDuration(summary?.avgFirstResponseMinutes ?? 0)} icon={Clock} tone="yellow" sub={`p95 ${formatDuration(summary?.p95FirstResponseMinutes ?? 0)}`} />
                  <StatTile label="Resolución avg" value={formatDuration(summary?.avgResolutionMinutes ?? 0)} icon={Clock} tone="purple" sub={`p95 ${formatDuration(summary?.p95ResolutionMinutes ?? 0)}`} />
                  <StatTile label="AHT (handling)" value={formatDuration(summary?.avgHandlingMinutes ?? 0)} icon={Activity} tone="primary" />
                  <StatTile label="Mensajes recibidos" value={(summary?.inboundMessages ?? 0).toLocaleString("es-DO")} icon={Inbox} />
                  <StatTile label="Enviados / IA" value={`${(summary?.outboundMessages ?? 0).toLocaleString("es-DO")} / ${(summary?.botMessages ?? 0).toLocaleString("es-DO")}`} icon={Send} tone="purple" />
                  <StatTile label="Contactos" value={summary?.contactsReached ?? 0} icon={Users} tone="green" sub={`${summary?.activeAgents ?? 0} agentes activos`} />
                  <StatTile label="Nuevos / recurrentes" value={`${summary?.newContacts ?? 0} / ${summary?.returningContacts ?? 0}`} icon={Users} sub={`${summary?.returningShare ?? 0}% recurrentes`} />
                  <StatTile label="Escalaciones" value={summary?.botToHumanEscalations ?? 0} icon={ArrowUpFromLine} tone="yellow" sub={`${summary?.escalationRate ?? 0}% del bot`} />
                  <StatTile label="Takeovers" value={summary?.takeovers ?? 0} icon={UserCog} sub={`${summary?.takeoverRate ?? 0}% del total`} />
                  <StatTile label="Reaperturas" value={summary?.reopenedConversations ?? 0} icon={RotateCcw} tone="red" sub={`${summary?.reopenRate ?? 0}% del total`} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <SectionCard title="Volumen diario" subtitle={data ? `Por día · ${periodLabel(data.periodFrom, data.periodTo)}` : undefined} icon={BarChart3} className="lg:col-span-2">
                    <div className="p-5 pt-4">
                      <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="rpConv" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                              <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="rpMsg" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.35} />
                              <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} minTickGap={20} />
                          <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip
                            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: "8px", fontSize: "12px", color: "hsl(var(--foreground))" }}
                            labelStyle={{ color: "hsl(var(--foreground))" }}
                          />
                          <Area type="monotone" dataKey="conversaciones" stroke="hsl(var(--chart-1))" fill="url(#rpConv)" strokeWidth={2} />
                          <Area type="monotone" dataKey="mensajes" stroke="hsl(var(--chart-2))" fill="url(#rpMsg)" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                      <div className="flex items-center justify-center gap-5 mt-2">
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(var(--chart-1))" }} /> Conversaciones activas</span>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(var(--chart-2))" }} /> Mensajes</span>
                      </div>
                    </div>
                  </SectionCard>

                  <SectionCard title="Por canal" subtitle="Resumen rápido" icon={MessageSquare}>
                    <ChannelBreakdown rows={data?.byChannel ?? []} />
                  </SectionCard>
                </div>

                <SectionCard title="Horas pico" subtitle={`Actividad por día de la semana × hora (${locale.timezone})`} icon={Activity}>
                  <Heatmap cells={data?.heatmap ?? []} metric="messages" />
                </SectionCard>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <SectionCard title="Uso por intento (etiqueta)" subtitle="Distribución de las conversaciones según la intención detectada" icon={Tag}>
                    <LabelBreakdown rows={data?.byLabel ?? []} />
                  </SectionCard>
                  <SectionCard title="Por sucursal" subtitle="Localidad resuelta desde la zona del cliente" icon={MapPin}>
                    <LocalityBreakdown rows={data?.byLocality ?? []} />
                  </SectionCard>
                </div>

                <SectionCard title="Etiquetas × canal" subtitle="Cruce de intenciones con el canal donde ocurren" icon={Tag}>
                  <LabelChannelMatrix cells={data?.labelByChannel ?? []} channels={channels} />
                </SectionCard>
              </>
            )}
          </TabsContent>

          {/* ── Por canal ───────────────────────────────────────────────────── */}
          <TabsContent value="channels" className="space-y-4 mt-4">
            <SectionCard title="Comparativa por canal" subtitle="Todas las métricas al mismo nivel para elegir dónde intervenir" icon={MessageSquare}>
              <ChannelComparisonTable rows={(data?.byChannel ?? []).filter((r) => channels.includes(r.channel))} />
            </SectionCard>

            <SectionCard title="Detalle por canal" subtitle="Zoom completo sobre un canal a la vez" icon={MessageSquare}>
              <div className="p-4">
                <Tabs value={activeChannel} onValueChange={(v) => setSelectedChannel(v as ReportChannel)}>
                  <TabsList className="bg-muted p-1 h-auto flex-wrap">
                    {channels.map((ch) => {
                      const meta = CHANNEL_META[ch];
                      return (
                        <TabsTrigger key={ch} value={ch} data-testid={`report-channel-tab-${ch}`} className="flex items-center gap-1.5">
                          <meta.Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                          {meta.label}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                  {channels.map((ch) => (
                    <TabsContent key={ch} value={ch}>
                      <ChannelDetailTab
                        channel={ch}
                        channelStats={data?.byChannel ?? []}
                        campaignStats={data?.byCampaignChannel ?? []}
                        labelCells={data?.labelByChannel ?? []}
                      />
                    </TabsContent>
                  ))}
                </Tabs>
              </div>
            </SectionCard>
          </TabsContent>

          {/* ── Por día ─────────────────────────────────────────────────────── */}
          <TabsContent value="daily" className="space-y-4 mt-4">
            <SectionCard title="Comparar periodos" subtitle="Total del periodo actual contra el mismo número de días justo antes" icon={ArrowLeftRight}>
              <DailyComparisonBar
                current={{ conversations: summary?.conversations ?? 0, sales: dailySales }}
                previous={compareEnabled && compareData ? { conversations: compareData.summary.conversations, sales: compareSales } : null}
                previousLabel={compareEnabled && compareData ? periodLabel(compareData.periodFrom, compareData.periodTo) : null}
                enabled={compareEnabled}
                onToggle={setCompareEnabled}
                isLoading={isCompareLoading}
              />
            </SectionCard>

            <SectionCard title="Conversaciones y ventas por día" subtitle={data ? `Por canal · ${periodLabel(data.periodFrom, data.periodTo)}` : undefined} icon={CalendarDays}>
              <DailyChannelChart rows={data?.daily ?? []} channels={channels} />
            </SectionCard>

            <SectionCard title="Detalle diario" subtitle="Conversaciones y ventas cerradas, por canal y por día" icon={CalendarDays}>
              <DailyBreakdownTable rows={data?.daily ?? []} channels={channels} />
            </SectionCard>
          </TabsContent>

          {/* ── Agentes ─────────────────────────────────────────────────────── */}
          <TabsContent value="agents" className="space-y-4 mt-4">
            <SectionCard title="Desempeño por agente" subtitle="Conversaciones, resolución y tiempo de respuesta" icon={UserCog}>
              <AgentTable rows={data?.byAgent ?? []} />
            </SectionCard>
            <SectionCard title="Carga y utilización" subtitle="Minutos activos aprox., chats concurrentes, takeovers" icon={Activity}>
              <AgentWorkloadPanel rows={data?.byAgent ?? []} />
            </SectionCard>
          </TabsContent>

          {/* ── Campañas ────────────────────────────────────────────────────── */}
          <TabsContent value="campaigns" className="space-y-4 mt-4">
            <SectionCard title="Envíos por canal" subtitle="Campañas cuya fecha de envío cae dentro del rango" icon={Megaphone}>
              <CampaignsTable rows={data?.byCampaignChannel ?? []} />
            </SectionCard>
          </TabsContent>

          {/* ── Backlog & carga ─────────────────────────────────────────────── */}
          <TabsContent value="backlog" className="space-y-4 mt-4">
            <SectionCard title="Backlog en vivo" subtitle="Chats en cola y correos sin responder ahora mismo (no depende del rango de fechas)" icon={AlertCircle}>
              <BacklogPanel
                backlog={
                  data
                    ? { ...data.backlog, byChannel: data.backlog.byChannel.filter((c) => channels.includes(c.channel)) }
                    : { pendingConversations: 0, avgQueueMinutes: 0, oldestQueueAgeMinutes: 0, byChannel: [] }
                }
              />
            </SectionCard>
            <SectionCard title="Carga por agente" subtitle="Concurrencia y utilización estimadas" icon={UserCog}>
              <AgentWorkloadPanel rows={data?.byAgent ?? []} />
            </SectionCard>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
