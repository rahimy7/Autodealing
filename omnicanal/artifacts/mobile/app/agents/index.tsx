import { useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useListAgents } from "@workspace/api-client-react";
import { Screen } from "../../src/components/Screen";
import { Avatar, Badge, Chips, EmptyState, ListRow, Loading } from "../../src/components/ui";
import { initials } from "../../src/lib/format";
import { channelColors, channelIcons, colors, spacing } from "../../src/theme";

const FILTERS = ["all", "human", "virtual"] as const;
const FILTER_LABELS: Record<string, string> = { all: "Todos", human: "Personas", virtual: "Virtuales" };

const STATUS_TINT: Record<string, { bg: string; fg: string; label: string }> = {
  online: { bg: colors.successSoft, fg: colors.success, label: "En línea" },
  busy: { bg: colors.warningSoft, fg: colors.warning, label: "Ocupado" },
  offline: { bg: colors.muted, fg: colors.mutedForeground, label: "Desconectado" },
};

export default function AgentsListScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const { data, isLoading, isFetching, refetch } = useListAgents();

  const agents = (data ?? []).filter((agent) => filter === "all" || agent.type === filter);

  return (
    <Screen scroll={false}>
      <View style={styles.filters}>
        <Chips options={FILTERS} value={filter} onChange={setFilter} labels={FILTER_LABELS} />
      </View>

      {isLoading && agents.length === 0 ? (
        <Loading label="Cargando agentes…" />
      ) : (
        <FlatList
          data={agents}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={agents.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={<EmptyState icon="people-outline" title="Sin agentes con este filtro" />}
          renderItem={({ item }) => {
            const status = STATUS_TINT[item.status] ?? STATUS_TINT.offline;
            return (
              <ListRow
                title={item.name}
                subtitle={item.type === "virtual" ? (item.profileType ?? "Agente virtual") : item.email}
                onPress={() => router.push(`/agents/${item.id}`)}
                left={
                  <Avatar
                    label={initials(item.name)}
                    uri={item.avatar}
                    size={40}
                    background={item.type === "virtual" ? colors.botSoft : colors.muted}
                    color={item.type === "virtual" ? colors.bot : colors.foreground}
                  />
                }
                meta={
                  <View style={styles.metaRow}>
                    <Badge label={status.label} bg={status.bg} fg={status.fg} />
                    {item.type === "virtual" ? (
                      <Badge label="Virtual" bg={colors.botSoft} fg={colors.bot} icon="sparkles" />
                    ) : (
                      <Badge label={item.role === "admin" ? "Administrador" : "Agente"} />
                    )}
                    {!item.isActive ? <Badge label="Inactivo" bg={colors.destructiveSoft} fg={colors.destructive} /> : null}
                    <Badge label={`${item.activeChats} chats`} icon="chatbubbles" />
                    {(item.channels ?? []).map((channel) => (
                      <Ionicons
                        key={channel}
                        name={channelIcons[channel] ?? "chatbubble"}
                        size={13}
                        color={channelColors[channel] ?? colors.mutedForeground}
                      />
                    ))}
                  </View>
                }
              />
            );
          }}
        />
      )}

      <View style={styles.note}>
        <Ionicons name="information-circle" size={14} color={colors.mutedForeground} />
        <Text style={styles.noteText}>
          Crear agentes y editar su prompt se hace desde el panel web; aquí puedes revisarlos y
          activarlos o desactivarlos.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: {
    padding: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  separator: { height: 1, backgroundColor: colors.border },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, marginTop: 4 },
  note: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    padding: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  noteText: { flex: 1, fontSize: 11, color: colors.mutedForeground, lineHeight: 16 },
});
