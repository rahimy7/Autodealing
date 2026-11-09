import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  useGetAnalyticsSummary,
  useGetChannelBreakdown,
  useGetAgentPerformance,
  useGetDailyVolume,
} from "@workspace/api-client-react";
import { Screen } from "../../src/components/Screen";
import { NavMenu } from "../../src/components/NavMenu";
import { BarRow, Card, EmptyState, SectionHeader, StatTile, Title } from "../../src/components/ui";
import { useAuth } from "../../src/lib/auth";
import { formatDayKey } from "../../src/lib/format";
import { channelColors, channelLabels, colors, radius, spacing } from "../../src/theme";

// El panel es el día de hoy del negocio tal como va: el servidor cuenta desde la
// medianoche de la zona del cliente y manda con qué día lo hizo. Lo primero que
// se ve es la venta cerrada — resolver un chat es cerrar la ventana, vender es
// el negocio.

export default function AdminDashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const summary = useGetAnalyticsSummary();
  const channels = useGetChannelBreakdown();
  const agents = useGetAgentPerformance();
  const daily = useGetDailyVolume({ days: 7 });

  const refreshing = summary.isFetching || channels.isFetching || agents.isFetching || daily.isFetching;
  const refresh = () => {
    summary.refetch();
    channels.refetch();
    agents.refetch();
    daily.refetch();
  };

  const data = summary.data;
  const channelStats = channels.data ?? [];
  const channelTotal = channelStats.reduce((sum, c) => sum + c.conversations, 0);
  const performance = (agents.data ?? []).slice(0, 6);
  const volume = daily.data ?? [];
  const peak = Math.max(1, ...volume.map((d) => d.conversations));

  // Sin respuestas medidas no hay media: un "0.0 min" se leería como que se
  // contesta al instante, que es justo lo contrario de lo que pasó.
  const avgResponse = data && data.respondedToday > 0 ? `${data.avgResponseMinutes.toFixed(1)} min` : "—";
  const dayLabel = formatDayKey(data?.day, { weekday: "long", day: "numeric", month: "long" });
  const saleRate =
    data && data.conversationsToday > 0 ? Math.round((data.salesClosedToday / data.conversationsToday) * 100) : null;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1, gap: 4 }}>
          <Title>Hola, {user?.name?.split(" ")[0] ?? "admin"} 👋</Title>
          <Text style={styles.subtitle}>
            {dayLabel ? `Hoy, ${dayLabel}` : "Resumen de la operación"}
          </Text>
        </View>
        <NavMenu />
      </View>

      <View style={styles.statGrid}>
        <StatTile
          label="Ventas cerradas hoy"
          value={data?.salesClosedToday ?? "—"}
          icon="pricetag"
          tint={colors.warning}
          hint={saleRate != null ? `${saleRate}% de los chats de hoy` : undefined}
        />
        <StatTile
          label="Conversaciones hoy"
          value={data?.conversationsToday ?? "—"}
          icon="chatbubbles"
          hint={data ? `${data.newConversationsToday} empezaron hoy` : undefined}
        />
        {/* "Abierta" es lo que nadie ha cerrado todavía, de cualquier canal y de
            cualquier día: es lo único de esta rejilla que no es de hoy. */}
        <StatTile
          label="Abiertas ahora"
          value={data?.openConversations ?? "—"}
          icon="folder-open"
          tint={colors.info}
          hint="Sin cerrar, de cualquier día"
        />
        <StatTile label="Atendidas por el bot" value={data?.botHandledToday ?? "—"} icon="sparkles" tint={colors.bot} />
        <StatTile
          label="Respuesta media hoy"
          value={avgResponse}
          icon="timer"
          tint={colors.success}
          hint={data && data.respondedToday > 0 ? `Sobre ${data.respondedToday} respuestas` : undefined}
        />
        <StatTile
          label="Mensajes enviados hoy"
          value={data?.messagesSentToday ?? "—"}
          icon="send"
          hint={data ? `${data.messagesReceivedToday} recibidos` : undefined}
        />
        <StatTile
          label="Contactos nuevos hoy"
          value={data?.newContactsToday ?? "—"}
          icon="people"
          tint={colors.accent}
          hint={data ? `${data.totalContacts.toLocaleString("es-DO")} en total` : undefined}
        />
        <StatTile label="Campañas enviadas hoy" value={data?.campaignsSentToday ?? "—"} icon="megaphone" tint={colors.accent} />
      </View>

      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="Últimos 7 días" />
        {volume.length === 0 ? (
          <EmptyState icon="bar-chart-outline" title="Sin datos todavía" />
        ) : (
          <>
            <View style={styles.chart}>
              {volume.map((day) => (
                <View key={day.date} style={styles.chartColumn}>
                  <Text style={styles.chartValue}>{day.conversations}</Text>
                  <View style={styles.chartTrack}>
                    <View
                      style={[
                        styles.chartBar,
                        { height: `${Math.max((day.conversations / peak) * 100, 3)}%` },
                      ]}
                    />
                  </View>
                  {/* La venta del día, debajo de su columna: es la cifra que se
                      viene a mirar. */}
                  <Text style={[styles.chartSales, day.sales > 0 && { color: colors.warning }]}>
                    {day.sales > 0 ? `🧾 ${day.sales}` : "·"}
                  </Text>
                  <Text style={styles.chartLabel}>{formatDayKey(day.date, { weekday: "short" }).slice(0, 3)}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.chartFootnote}>Barra: conversaciones del día · 🧾 ventas cerradas</Text>
          </>
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeader
          title="Hoy por canal"
          action={
            <Text style={styles.link} onPress={() => router.push("/reports")}>
              Reportes →
            </Text>
          }
        />
        {channelTotal === 0 ? (
          <EmptyState icon="pie-chart-outline" title="Todavía no ha entrado nada hoy" />
        ) : (
          channelStats.map((stat) => (
            <View key={stat.channel} style={{ gap: 2 }}>
              <BarRow
                label={channelLabels[stat.channel] ?? stat.channel}
                value={stat.conversations}
                total={channelTotal}
                color={channelColors[stat.channel] ?? colors.primary}
              />
              <Text style={styles.channelMeta}>
                {stat.messages} mensajes ·{" "}
                <Text style={stat.sales > 0 ? { color: colors.warning, fontWeight: "700" } : undefined}>
                  {stat.sales} {stat.sales === 1 ? "venta" : "ventas"}
                </Text>
              </Text>
            </View>
          ))
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeader
          title="Hoy por agente"
          action={
            <Text style={styles.link} onPress={() => router.push("/agents")}>
              Agentes →
            </Text>
          }
        />
        {performance.length === 0 ? (
          <EmptyState icon="people-outline" title="Nadie ha atendido nada hoy" />
        ) : (
          performance.map((agent) => (
            <View key={agent.agentId} style={styles.agentRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.agentName}>
                  {agent.agentType === "virtual" ? "✨ " : ""}
                  {agent.agentName}
                </Text>
                <Text style={styles.agentMeta}>
                  {agent.conversations} chats · {agent.salesClosed} {agent.salesClosed === 1 ? "venta" : "ventas"}
                  {agent.respondedCount > 0 ? ` · ${agent.avgResponseMinutes.toFixed(1)} min` : ""}
                </Text>
              </View>
              <View style={styles.agentScore}>
                <Text style={styles.agentScoreText}>
                  {agent.conversations > 0 ? Math.round((agent.salesClosed / agent.conversations) * 100) : 0}%
                </Text>
              </View>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  subtitle: { fontSize: 13, color: colors.mutedForeground, textTransform: "capitalize" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  link: { fontSize: 12, fontWeight: "700", color: colors.primary },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, height: 160 },
  chartColumn: { flex: 1, alignItems: "center", gap: 4 },
  chartValue: { fontSize: 10, color: colors.mutedForeground, fontWeight: "600" },
  chartTrack: { flex: 1, width: "100%", justifyContent: "flex-end", backgroundColor: colors.muted, borderRadius: 6 },
  chartBar: { width: "100%", backgroundColor: colors.primary, borderRadius: 6 },
  chartSales: { fontSize: 9, fontWeight: "700", color: colors.mutedForeground },
  chartLabel: { fontSize: 10, color: colors.mutedForeground },
  chartFootnote: { fontSize: 10, color: colors.mutedForeground, textAlign: "center" },
  channelMeta: { fontSize: 10, color: colors.mutedForeground },
  agentRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  agentName: { fontSize: 13, fontWeight: "600", color: colors.foreground },
  agentMeta: { fontSize: 11, color: colors.mutedForeground, marginTop: 1 },
  agentScore: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  agentScoreText: { fontSize: 12, fontWeight: "800", color: colors.primary },
});
