import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  useListConversations,
  getListConversationsQueryKey,
  type ListConversationsParams,
} from "@workspace/api-client-react";
import { ConversationRow } from "./ConversationRow";
import { Chips, EmptyState, Loading, SearchInput } from "./ui";
import { Sheet, SheetAction } from "./Sheet";
import { CONVERSATIONS_POLL_MS } from "../lib/config";
import { channelIcons, channelLabels, colors, radius, spacing, statusLabels } from "../theme";

const CHANNEL_TABS = ["all", "whatsapp", "instagram", "facebook"] as const;
const STATUS_TABS = ["all", "open", "pending", "bot", "resolved"] as const;
const READ_TABS = ["all", "unread", "read"] as const;
const READ_CHIP_LABELS: Record<string, string> = { all: "Todos", unread: "No leídos", read: "Leídos" };
const READ_CHIP_ICONS: Record<string, "mail-outline" | "mail-unread-outline" | "mail-open-outline"> = {
  all: "mail-outline",
  unread: "mail-unread-outline",
  read: "mail-open-outline",
};

const STATUS_CHIP_LABELS: Record<string, string> = { all: "Todos", ...statusLabels };
const CHANNEL_CHIP_ICONS: Record<string, "apps" | "logo-whatsapp" | "logo-instagram" | "logo-facebook" | "chatbubble"> = {
  all: "apps",
  ...channelIcons,
};
const STATUS_ICONS: Record<(typeof STATUS_TABS)[number], "layers-outline" | "chatbubble-ellipses-outline" | "time-outline" | "sparkles-outline" | "checkmark-done-outline"> = {
  all: "layers-outline",
  open: "chatbubble-ellipses-outline",
  pending: "time-outline",
  bot: "sparkles-outline",
  resolved: "checkmark-done-outline",
};

type ChannelTab = (typeof CHANNEL_TABS)[number];
type StatusTab = (typeof STATUS_TABS)[number];
type ReadTab = (typeof READ_TABS)[number];

/**
 * The one conversation list in the app. The admin inbox, an agent's own chats and
 * the read-only team panel differ only in which `agentId` they pin and whether
 * the owner badge is worth showing.
 */
export function ConversationList({
  agentId,
  myAgentId,
  showChannelFilter = true,
  showOwner = true,
  emptyTitle = "No hay conversaciones",
  emptyDescription,
  header,
}: {
  /** Pins the list to one agent's chats. `undefined` shows the whole operation. */
  agentId?: number;
  myAgentId?: number | null;
  showChannelFilter?: boolean;
  showOwner?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  header?: React.ReactNode;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<ChannelTab>("all");
  const [status, setStatus] = useState<StatusTab>("all");
  const [read, setRead] = useState<ReadTab>("all");
  const [search, setSearch] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);

  const params: ListConversationsParams = {
    agentId,
    channel: channel !== "all" ? channel : undefined,
    status: status !== "all" ? status : undefined,
    read: read !== "all" ? read : undefined,
    search: search.trim() || undefined,
  };

  const { data, isLoading, isFetching, refetch } = useListConversations(params, {
    query: {
      queryKey: getListConversationsQueryKey(params),
      refetchInterval: CONVERSATIONS_POLL_MS,
      staleTime: 0,
    },
  });

  const conversations = data ?? [];

  return (
    <View style={styles.root}>
      <View style={styles.filters}>
        {header}
        <SearchInput value={search} onChangeText={setSearch} placeholder="Buscar contacto o mensaje..." />
        {showChannelFilter ? (
          <Chips
            options={CHANNEL_TABS}
            value={channel}
            onChange={setChannel}
            labels={channelLabels}
            icons={CHANNEL_CHIP_ICONS}
          />
        ) : null}
        <Chips options={READ_TABS} value={read} onChange={setRead} labels={READ_CHIP_LABELS} icons={READ_CHIP_ICONS} />
        <Pressable
          onPress={() => setStatusOpen(true)}
          style={({ pressed }) => [styles.statusButton, pressed && { backgroundColor: colors.muted }]}
        >
          <Ionicons name={STATUS_ICONS[status]} size={16} color={colors.primary} />
          <Text style={styles.statusLabel}>Estado</Text>
          <Text style={styles.statusValue}>{STATUS_CHIP_LABELS[status]}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {isLoading && conversations.length === 0 ? (
        <Loading label="Cargando conversaciones…" />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <ConversationRow
              conversation={item}
              mine={myAgentId != null && item.agentId === myAgentId}
              showOwner={showOwner}
              onPress={() => router.push(`/chat/${item.id}`)}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState icon="chatbubbles-outline" title={emptyTitle} description={emptyDescription} />
          }
          contentContainerStyle={conversations.length === 0 ? { flexGrow: 1 } : undefined}
        />
      )}

      <Sheet
        visible={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Filtrar por estado"
        description="Muestra solo las conversaciones en el estado seleccionado."
      >
        {STATUS_TABS.map((option) => (
          <SheetAction
            key={option}
            icon={STATUS_ICONS[option]}
            label={STATUS_CHIP_LABELS[option]}
            tint={status === option ? colors.primary : colors.foreground}
            selected={status === option}
            onPress={() => {
              setStatus(option);
              setStatusOpen(false);
            }}
          />
        ))}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  filters: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statusButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  statusLabel: { fontSize: 12, fontWeight: "600", color: colors.mutedForeground },
  statusValue: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.foreground },
});
