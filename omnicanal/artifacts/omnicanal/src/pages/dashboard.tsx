import { useGetAnalyticsSummary, useGetChannelBreakdown, useGetAgentPerformance, useGetDailyVolume } from "@workspace/api-client-react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { MessageSquare, Users, Bot, Clock, Megaphone, Send, Activity, ShoppingBag, Sparkles } from "lucide-react";
import Layout from "@/components/layout/Layout";
import { formatDayKey } from "@/lib/day";
// El correo entra en el panel igual que el chat, así que los canales se pintan
// con el mismo mapa que los reportes.
import { CHANNEL_META, type ReportChannel } from "@/components/reports/channels";

// El panel es el día de hoy del negocio, no un total histórico: cada cifra sale
// de lo que pasó hoy y el servidor manda con qué día la contó. La que manda es
// la venta cerrada — resolver un chat es cerrar la ventana, vender es el negocio.

// El mismo ámbar con el que los Reportes pintan la venta, para que la serie se
// reconozca sin leer la leyenda.
const SALES_COLOR = "#f59e0b";
const CONV_COLOR = "hsl(190 90% 45%)";
const MSG_COLOR = "hsl(270 70% 60%)";

function StatCard({
  label,
  value,
  icon: Icon,
  sub,
  color = "primary",
  highlight,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  sub?: string;
  color?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`bg-card border rounded-xl p-4 sm:p-5 flex items-start gap-3 sm:gap-4 ${highlight ? "border-amber-500/40 ring-1 ring-amber-500/20" : "border-card-border"}`}
      data-testid={`stat-card-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${color === "primary" ? "bg-primary/15" : color === "green" ? "bg-green-500/15" : color === "yellow" ? "bg-yellow-500/15" : color === "amber" ? "bg-amber-500/20" : "bg-purple-500/15"}`}>
        <Icon className={`w-5 h-5 ${color === "primary" ? "text-primary" : color === "green" ? "text-green-400" : color === "yellow" ? "text-yellow-400" : color === "amber" ? "text-amber-500" : "text-purple-400"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xl sm:text-2xl font-bold text-foreground tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground font-medium mt-0.5">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/60 mt-1">{sub}</div>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading: sumLoading } = useGetAnalyticsSummary();
  const { data: channels } = useGetChannelBreakdown();
  const { data: agentPerf } = useGetAgentPerformance();
  const { data: daily } = useGetDailyVolume({ days: 14 });

  const chartData = daily?.slice(-14).map(d => ({
    date: formatDayKey(d.date, { month: "short", day: "numeric" }),
    conversaciones: d.conversations,
    mensajes: d.messages,
    ventas: d.sales,
  })) ?? [];

  // Sin respuestas medidas no hay media que enseñar: un "0.0 min" ahí se lee
  // como "contestamos al instante", que es justo lo contrario de lo que pasó.
  const dayLabel = formatDayKey(summary?.day, { weekday: "long", day: "numeric", month: "long" });
  const avgResponse = summary && summary.respondedToday > 0 ? `${summary.avgResponseMinutes.toFixed(1)} min` : "—";
  const channelTotal = (channels ?? []).reduce((sum, c) => sum + c.conversations, 0);

  return (
    <Layout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              {dayLabel ? `Hoy, ${dayLabel}` : "Vista general de la plataforma"}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-card border border-card-border rounded-lg px-3 py-2">
            <Activity className="w-3.5 h-3.5 text-green-400" />
            Sistema operativo
          </div>
        </div>

        {/* KPI Grid */}
        {sumLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-card border border-card-border rounded-xl p-5 h-24 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard
              label="Ventas Cerradas Hoy"
              value={summary?.salesClosedToday ?? 0}
              icon={ShoppingBag}
              color="amber"
              highlight
              sub={
                summary && summary.conversationsToday > 0
                  ? `${Math.round((summary.salesClosedToday / summary.conversationsToday) * 100)}% de los chats de hoy`
                  : "Sin chats todavía"
              }
            />
            <StatCard
              label="Conversaciones Hoy"
              value={summary?.conversationsToday ?? 0}
              icon={MessageSquare}
              color="primary"
              sub={`${summary?.newConversationsToday ?? 0} empezaron hoy`}
            />
            {/* "Abierta" es lo que nadie ha cerrado todavía, de cualquier canal y
                de cualquier día: es lo único de esta fila que no es de hoy. */}
            <StatCard label="Abiertas Ahora" value={summary?.openConversations ?? 0} icon={Activity} color="yellow" sub="Chats y correos sin cerrar" />
            <StatCard label="Atendidas por el Bot Hoy" value={summary?.botHandledToday ?? 0} icon={Bot} color="purple" />
            <StatCard
              label="Tiempo Respuesta Hoy"
              value={avgResponse}
              icon={Clock}
              color="primary"
              sub={summary && summary.respondedToday > 0 ? `Sobre ${summary.respondedToday} respuestas` : "Nada contestado aún"}
            />
            <StatCard
              label="Mensajes Enviados Hoy"
              value={summary?.messagesSentToday ?? 0}
              icon={Send}
              color="primary"
              sub={`${summary?.messagesReceivedToday ?? 0} recibidos`}
            />
            <StatCard
              label="Contactos Nuevos Hoy"
              value={summary?.newContactsToday ?? 0}
              icon={Users}
              color="green"
              sub={`${(summary?.totalContacts ?? 0).toLocaleString("es-DO")} en total`}
            />
            <StatCard label="Campañas Enviadas Hoy" value={summary?.campaignsSentToday ?? 0} icon={Megaphone} color="yellow" />
          </div>
        )}

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Daily volume chart */}
          <div className="lg:col-span-2 bg-card border border-card-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Volumen Diario</h2>
                <p className="text-xs text-muted-foreground">Últimos 14 días del negocio</p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: CONV_COLOR }} /> Chats</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: MSG_COLOR }} /> Mensajes</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: SALES_COLOR }} /> Ventas</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              {/* Las ventas van en su propio eje, a la derecha: contra los miles
                  de mensajes, una línea de 5 a 20 sería una raya pegada al suelo
                  — que es justo la cifra que se viene a mirar. Mismo criterio
                  que la gráfica de Reportes. */}
              <ComposedChart data={chartData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CONV_COLOR} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={CONV_COLOR} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={MSG_COLOR} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={MSG_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--card-border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis yAxisId="volumen" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis yAxisId="ventas" orientation="right" tick={{ fontSize: 10, fill: SALES_COLOR }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: "8px", fontSize: "12px", color: "hsl(var(--foreground))" }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Area yAxisId="volumen" type="monotone" dataKey="mensajes" stroke={MSG_COLOR} fill="url(#msgGrad)" strokeWidth={2} name="Mensajes" />
                <Area yAxisId="volumen" type="monotone" dataKey="conversaciones" stroke={CONV_COLOR} fill="url(#convGrad)" strokeWidth={2} name="Chats" />
                <Line yAxisId="ventas" type="monotone" dataKey="ventas" stroke={SALES_COLOR} strokeWidth={2.5} dot={{ r: 3 }} name="Ventas" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Channel breakdown */}
          <div className="bg-card border border-card-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">Desglose por Canal</h2>
            <p className="text-xs text-muted-foreground mb-4">Chats de hoy y lo que dejaron</p>
            <div className="space-y-3">
              {(channels ?? []).map((ch) => {
                const meta = CHANNEL_META[ch.channel as ReportChannel];
                const Icon = meta?.Icon;
                const color = meta?.color ?? "hsl(190 90% 50%)";
                const pct = channelTotal ? Math.round((ch.conversations / channelTotal) * 100) : 0;
                return (
                  <div key={ch.channel} data-testid={`channel-stat-${ch.channel}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {Icon && <Icon className="w-3.5 h-3.5" style={{ color }} />}
                      <span className="text-xs font-medium text-foreground">{meta?.label ?? ch.channel}</span>
                      <span className="ml-auto text-xs font-bold text-foreground">{ch.conversations}</span>
                      <span className="text-[10px] text-muted-foreground">chats</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {ch.messages} mensajes ·{" "}
                      <span className={ch.sales > 0 ? "text-amber-500 font-semibold" : ""}>
                        {ch.sales} {ch.sales === 1 ? "venta" : "ventas"}
                      </span>
                    </div>
                  </div>
                );
              })}
              {channelTotal === 0 && (
                <p className="text-xs text-muted-foreground py-4 text-center">Todavía no ha entrado nada hoy.</p>
              )}
            </div>
          </div>
        </div>

        {/* Agent performance */}
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-card-border">
            <h2 className="text-sm font-semibold text-foreground">Rendimiento de Agentes</h2>
            <p className="text-xs text-muted-foreground">Lo que lleva cada quien hoy, del que atendió algo</p>
          </div>
          <table className="w-full text-sm" data-testid="agent-performance-table">
            <thead>
              <tr className="border-b border-card-border">
                <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">Agente</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-5 py-3">Conversaciones</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-5 py-3">Ventas cerradas</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-5 py-3">T. Respuesta</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-5 py-3">Cierre</th>
              </tr>
            </thead>
            <tbody>
              {(agentPerf ?? []).map((a) => {
                const rate = a.conversations > 0 ? Math.round((a.salesClosed / a.conversations) * 100) : 0;
                return (
                  <tr key={a.agentId} className="border-b border-card-border/50 hover:bg-muted/30 transition-colors" data-testid={`agent-row-${a.agentId}`}>
                    <td className="px-5 py-3 font-medium text-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {a.agentType === "virtual" && <Sparkles className="w-3 h-3 text-purple-400" />}
                        {a.agentName}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground tabular-nums">{a.conversations}</td>
                    <td className="px-5 py-3 text-right text-amber-500 font-semibold tabular-nums">{a.salesClosed}</td>
                    <td className="px-5 py-3 text-right text-muted-foreground tabular-nums">
                      {a.respondedCount > 0 ? `${a.avgResponseMinutes.toFixed(1)} min` : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${rate >= 30 ? "bg-green-500/15 text-green-400" : rate >= 10 ? "bg-yellow-500/15 text-yellow-400" : "bg-muted text-muted-foreground"}`}>
                        {rate}%
                      </span>
                    </td>
                  </tr>
                );
              })}
              {(agentPerf ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground text-sm">
                    Nadie ha atendido nada hoy todavía
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
