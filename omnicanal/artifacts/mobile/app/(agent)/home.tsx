import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useListAgents, useListConversations, getListConversationsQueryKey } from "@workspace/api-client-react";
import { Screen } from "../../src/components/Screen";
import { ConversationRow } from "../../src/components/ConversationRow";
import { Button, Card, EmptyState, SectionHeader, StatTile, Title } from "../../src/components/ui";
import { useAuth } from "../../src/lib/auth";
import { CONVERSATIONS_POLL_MS } from "../../src/lib/config";
import { channelColors, channelIcons, channelLabels, colors, radius, spacing } from "../../src/theme";

const STATUS_TEXT: Record<string, string> = { online: "En línea", busy: "Ocupado", offline: "Desconectado" };
const STATUS_DOT: Record<string, string> = { online: colors.success, busy: colors.warning, offline: colors.mutedForeground };

export default function AgentHomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const agentId = user?.agentId ?? undefined;

  const params = { agentId };
  const { data: conversations, isFetching, refetch } = useListConversations(params, {
    query: {
      queryKey: getListConversationsQueryKey(params),
      refetchInterval: CONVERSATIONS_POLL_MS,
      staleTime: 0,
    },
  });
  const { data: agents } = useListAgents();

  const me = agents?.find((a) => a.id === user?.agentId);
  const list = conversations ?? [];
  const open = list.filter((c) => c.status === "open").length;
  const pending = list.filter((c) => c.status === "pending").length;
  const resolved = list.filter((c) => c.status === "resolved").length;
  const unread = list.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
  const recent = list.slice(0, 5);
  const resolutionRate = list.length > 0 ? Math.round((resolved / list.length) * 100) : 0;

  return (
    <Screen refreshing={isFetching} onRefresh={refetch}>
      <View style={{ gap: 4 }}>
        <View style={styles.eyebrowRow}>
          <Ionicons name="headset" size={14} color={colors.primary} />
          <Text style={styles.eyebrow}>Panel de agente</Text>
        </View>
        <Title>Hola, {user?.name?.split(" ")[0] ?? "agente"} 👋</Title>
        <Text style={styles.subtitle}>Este es el resumen de tus conversaciones.</Text>
      </View>

      <View style={styles.statGrid}>
        <StatTile label="Chats activos" value={open + pending} icon="chatbubbles" />
        <StatTile label="Sin leer" value={unread} icon="mail-unread" tint={colors.accent} />
        <StatTile label="En espera" value={pending} icon="time" tint={colors.warning} />
        <StatTile label="Resueltos" value={resolved} icon="checkmark-done" tint={colors.success} />
      </View>

      <Card style={{ gap: spacing.md }}>
        <SectionHeader
          title="Conversaciones recientes"
          action={
            <Text style={styles.link} onPress={() => router.push("/mychats")}>
              Ver todo →
            </Text>
          }
        />
        {recent.length === 0 ? (
          <EmptyState
            icon="file-tray-outline"
            title="No tienes conversaciones asignadas"
            description="Te avisaremos por notificación cuando te asignen una."
          />
        ) : (
          <View style={styles.recentList}>
            {recent.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                mine
                showOwner={false}
                onPress={() => router.push(`/chat/${conversation.id}`)}
              />
            ))}
          </View>
        )}
      </Card>

      <Card style={{ gap: spacing.lg }}>
        <SectionHeader title="Mi desempeño" />

        <View style={{ gap: 6 }}>
          <View style={styles.rowBetween}>
            <Text style={styles.metaLabel}>Tasa de resolución</Text>
            <Text style={styles.metaValue}>{resolutionRate}%</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(resolutionRate, 2)}%` }]} />
          </View>
        </View>

        <View style={styles.divider} />

        <View style={{ gap: 6 }}>
          <Text style={styles.metaLabel}>Estado actual</Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: STATUS_DOT[me?.status ?? "offline"] }]} />
            <Text style={styles.statusText}>{STATUS_TEXT[me?.status ?? "offline"]}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={{ gap: 6 }}>
          <Text style={styles.metaLabel}>Canales asignados</Text>
          {(me?.channels ?? []).length === 0 ? (
            <Text style={styles.subtitle}>Sin canales</Text>
          ) : (
            <View style={styles.channelRow}>
              {(me?.channels ?? []).map((channel) => (
                <View key={channel} style={styles.channelChip}>
                  <Ionicons
                    name={channelIcons[channel] ?? "chatbubble"}
                    size={13}
                    color={channelColors[channel] ?? colors.mutedForeground}
                  />
                  <Text style={styles.channelText}>{channelLabels[channel] ?? channel}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </Card>

      <Button label="Ir a mis chats" icon="arrow-forward" onPress={() => router.push("/mychats")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  eyebrow: { fontSize: 11, fontWeight: "700", color: colors.primary, textTransform: "uppercase", letterSpacing: 0.6 },
  subtitle: { fontSize: 13, color: colors.mutedForeground },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  link: { fontSize: 12, fontWeight: "700", color: colors.primary },
  recentList: { marginHorizontal: -spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  metaLabel: { fontSize: 12, color: colors.mutedForeground },
  metaValue: { fontSize: 12, fontWeight: "700", color: colors.foreground },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.muted, overflow: "hidden" },
  fill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  divider: { height: 1, backgroundColor: colors.border },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 14, fontWeight: "600", color: colors.foreground },
  channelRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  channelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.muted,
  },
  channelText: { fontSize: 11, fontWeight: "600", color: colors.foreground },
});
