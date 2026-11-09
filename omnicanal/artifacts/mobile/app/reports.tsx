import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useGetReportsOverview } from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { BarRow, Badge, Card, Chips, EmptyState, Loading, SectionHeader, StatTile } from "../src/components/ui";
import { channelColors, channelLabels, colors, radius, spacing } from "../src/theme";

const PERIODS = ["7", "30", "90"] as const;
const PERIOD_LABELS: Record<string, string> = { "7": "7 días", "30": "30 días", "90": "90 días" };

export default function ReportsScreen() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("30");
  const { data, isLoading, isFetching, refetch } = useGetReportsOverview({ days: Number(period) });

  if (isLoading && !data) return <Loading label="Calculando reportes…" />;

  const summary = data?.summary;
  const daily = data?.daily ?? [];
  const peak = Math.max(1, ...daily.map((d) => d.conversations));
  const channelTotal = (data?.byChannel ?? []).reduce((sum, c) => sum + c.conversations, 0);
  const labelTotal = (data?.byLabel ?? []).reduce((sum, l) => sum + l.conversations, 0);

  return (
    <Screen refreshing={isFetching} onRefresh={refetch}>
      <Chips options={PERIODS} value={period} onChange={setPeriod} labels={PERIOD_LABELS} />

      <View style={styles.statGrid}>
        <StatTile label="Conversaciones" value={summary?.conversations ?? "—"} icon="chatbubbles" />
        <StatTile
          label="Tasa de resolución"
          value={summary ? `${summary.resolutionRate}%` : "—"}
          icon="checkmark-done"
          tint={colors.success}
        />
        <StatTile
          label="1ª respuesta"
          value={summary ? `${summary.avgFirstResponseMinutes} min` : "—"}
          icon="timer"
          tint={colors.warning}
        />
        <StatTile label="Contactos alcanzados" value={summary?.contactsReached ?? "—"} icon="people" tint={colors.accent} />
        <StatTile label="Mensajes entrantes" value={summary?.inboundMessages ?? "—"} icon="download" tint={colors.info} />
        <StatTile label="Enviados por personas" value={summary?.outboundMessages ?? "—"} icon="send" />
        <StatTile label="Enviados por IA" value={summary?.botMessages ?? "—"} icon="sparkles" tint={colors.bot} />
        <StatTile label="Agentes activos" value={summary?.activeAgents ?? "—"} icon="person" />
      </View>

      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="Volumen diario" />
        {daily.length === 0 ? (
          <EmptyState icon="bar-chart-outline" title="Sin datos en el periodo" />
        ) : (
          <View style={styles.chart}>
            {daily.slice(-14).map((day) => (
              <View key={day.date} style={styles.chartColumn}>
                <View style={styles.chartTrack}>
                  <View style={[styles.chartBar, { height: `${Math.max((day.conversations / peak) * 100, 3)}%` }]} />
                </View>
                <Text style={styles.chartLabel}>{new Date(day.date).getDate()}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="Por canal" />
        {(data?.byChannel ?? []).length === 0 ? (
          <EmptyState icon="pie-chart-outline" title="Sin datos por canal" />
        ) : (
          (data?.byChannel ?? []).map((stat) => (
            <View key={stat.channel} style={{ gap: 4 }}>
              <BarRow
                label={channelLabels[stat.channel] ?? stat.channel}
                value={stat.conversations}
                total={channelTotal}
                color={channelColors[stat.channel] ?? colors.primary}
              />
              <Text style={styles.subMeta}>
                {stat.resolutionRate}% resueltas · {stat.inboundMessages} entrantes · {stat.outboundMessages} salientes ·{" "}
                {stat.avgFirstResponseMinutes} min
              </Text>
            </View>
          ))
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="Por intención" />
        {(data?.byLabel ?? []).length === 0 ? (
          <EmptyState icon="pricetags-outline" title="Sin conversaciones clasificadas" />
        ) : (
          (data?.byLabel ?? []).map((stat) => (
            <BarRow
              key={stat.labelId ?? "none"}
              label={stat.labelName}
              value={stat.conversations}
              total={labelTotal}
              color={stat.color || colors.accent}
            />
          ))
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="Por agente" />
        {(data?.byAgent ?? []).length === 0 ? (
          <EmptyState icon="people-outline" title="Sin actividad de agentes" />
        ) : (
          (data?.byAgent ?? []).map((stat) => (
            <View key={stat.agentId} style={styles.agentRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.agentTitleRow}>
                  <Text style={styles.agentName}>{stat.agentName}</Text>
                  {stat.type === "virtual" ? <Badge label="IA" bg={colors.botSoft} fg={colors.bot} /> : null}
                </View>
                <Text style={styles.subMeta}>
                  {stat.conversations} chats · {stat.messages} mensajes · {stat.avgFirstResponseMinutes} min
                </Text>
              </View>
              <View style={styles.score}>
                <Text style={styles.scoreText}>{stat.resolutionRate}%</Text>
              </View>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 130 },
  chartColumn: { flex: 1, alignItems: "center", gap: 3 },
  chartTrack: { flex: 1, width: "100%", justifyContent: "flex-end", backgroundColor: colors.muted, borderRadius: 4 },
  chartBar: { width: "100%", backgroundColor: colors.primary, borderRadius: 4 },
  chartLabel: { fontSize: 9, color: colors.mutedForeground },
  subMeta: { fontSize: 11, color: colors.mutedForeground },
  agentRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  agentTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  agentName: { fontSize: 13, fontWeight: "600", color: colors.foreground },
  score: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  scoreText: { fontSize: 12, fontWeight: "800", color: colors.primary },
});
