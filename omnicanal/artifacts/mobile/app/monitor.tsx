import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  useListConversations,
  useListAgents,
  getListConversationsQueryKey,
  type Conversation,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { ConversationRow } from "../src/components/ConversationRow";
import { Badge, Card, Chips, EmptyState, SectionHeader, StatTile } from "../src/components/ui";
import { CONVERSATIONS_POLL_MS } from "../src/lib/config";
import { channelLabels, colors, spacing } from "../src/theme";

const CHANNELS = ["all", "whatsapp", "instagram", "facebook"] as const;

// Live work queue: what nobody has picked up, what the bots are holding, and what
// each person is carrying right now.
export default function MonitorScreen() {
  const router = useRouter();
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("all");

  const params = channel === "all" ? undefined : { channel };
  const { data: conversations, isFetching, refetch } = useListConversations(params, {
    query: {
      queryKey: getListConversationsQueryKey(params),
      refetchInterval: CONVERSATIONS_POLL_MS,
      staleTime: 0,
    },
  });
  const { data: agents } = useListAgents();

  const virtualIds = useMemo(
    () => new Set((agents ?? []).filter((a) => a.type === "virtual").map((a) => a.id)),
    [agents],
  );

  const { unassigned, byBot, byAgent } = useMemo(() => {
    const live = (conversations ?? []).filter((c) => c.status !== "resolved");
    const none: Conversation[] = [];
    const bot: Conversation[] = [];
    const grouped = new Map<number, Conversation[]>();

    for (const conversation of live) {
      if (conversation.agentId == null) {
        none.push(conversation);
        continue;
      }
      if (conversation.status === "bot" || virtualIds.has(conversation.agentId)) {
        bot.push(conversation);
        continue;
      }
      const bucket = grouped.get(conversation.agentId) ?? [];
      bucket.push(conversation);
      grouped.set(conversation.agentId, bucket);
    }
    return { unassigned: none, byBot: bot, byAgent: grouped };
  }, [conversations, virtualIds]);

  const humans = (agents ?? []).filter((a) => a.type === "human");

  return (
    <Screen refreshing={isFetching} onRefresh={refetch}>
      <View style={styles.liveRow}>
        <View style={[styles.liveDot, { backgroundColor: isFetching ? colors.primary : colors.success }]} />
        <Text style={styles.liveText}>{isFetching ? "Actualizando…" : "En vivo"}</Text>
      </View>

      <Chips options={CHANNELS} value={channel} onChange={setChannel} labels={channelLabels} />

      <View style={styles.statGrid}>
        <StatTile label="Sin asignar" value={unassigned.length} icon="alert-circle" tint={colors.warning} />
        <StatTile label="Con la IA" value={byBot.length} icon="sparkles" tint={colors.bot} />
        <StatTile
          label="Con personas"
          value={Array.from(byAgent.values()).reduce((sum, list) => sum + list.length, 0)}
          icon="people"
        />
      </View>

      <Card padded={false} style={{ overflow: "hidden" }}>
        <View style={styles.cardHeader}>
          <SectionHeader
            title="Sin asignar"
            action={<Badge label={String(unassigned.length)} bg={colors.warningSoft} fg={colors.warning} />}
          />
          <Text style={styles.hint}>Nadie las ha tomado: son las que más urgen.</Text>
        </View>
        {unassigned.length === 0 ? (
          <EmptyState icon="checkmark-circle-outline" title="Nada en espera" />
        ) : (
          unassigned.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              onPress={() => router.push(`/chat/${conversation.id}`)}
            />
          ))
        )}
      </Card>

      <Card padded={false} style={{ overflow: "hidden" }}>
        <View style={styles.cardHeader}>
          <SectionHeader
            title="Atendidas por IA"
            action={<Badge label={String(byBot.length)} bg={colors.botSoft} fg={colors.bot} />}
          />
        </View>
        {byBot.length === 0 ? (
          <EmptyState icon="sparkles-outline" title="La IA no tiene chats abiertos" />
        ) : (
          byBot
            .slice(0, 15)
            .map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                onPress={() => router.push(`/chat/${conversation.id}`)}
              />
            ))
        )}
      </Card>

      {humans.map((agent) => {
        const list = byAgent.get(agent.id) ?? [];
        if (list.length === 0) return null;
        return (
          <Card key={agent.id} padded={false} style={{ overflow: "hidden" }}>
            <View style={styles.cardHeader}>
              <SectionHeader
                title={agent.name}
                action={<Badge label={`${list.length} activos`} bg={colors.primarySoft} fg={colors.primary} />}
              />
            </View>
            {list.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                showOwner={false}
                onPress={() => router.push(`/chat/${conversation.id}`)}
              />
            ))}
          </Card>
        );
      })}

      {humans.every((agent) => (byAgent.get(agent.id) ?? []).length === 0) ? (
        <Card>
          <View style={styles.emptyAgents}>
            <Ionicons name="people-outline" size={22} color={colors.mutedForeground} />
            <Text style={styles.hint}>Ningún agente humano tiene conversaciones activas ahora mismo.</Text>
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 12, color: colors.mutedForeground },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  cardHeader: { padding: spacing.lg, paddingBottom: spacing.sm },
  hint: { fontSize: 11, color: colors.mutedForeground, lineHeight: 16 },
  emptyAgents: { flexDirection: "row", alignItems: "center", gap: spacing.md },
});
