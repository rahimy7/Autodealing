import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  useListEmailThreads,
  useGetGmailSettings,
  useSyncGmailNow,
  getListEmailThreadsQueryKey,
  type EmailThread,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Screen } from "../../src/components/Screen";
import { Avatar, Badge, Chips, EmptyState, ErrorNote, ListRow, Loading, SearchInput } from "../../src/components/ui";
import { initials, timeAgo } from "../../src/lib/format";
import { colors, spacing } from "../../src/theme";

const STATUSES = ["open", "all", "resolved"] as const;
const STATUS_LABELS: Record<string, string> = { open: "Abiertos", all: "Todos", resolved: "Resueltos" };

export default function EmailListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("open");

  const { data: gmail } = useGetGmailSettings();
  const sync = useSyncGmailNow();

  const params = { search: search.trim() || undefined, status: status !== "all" ? status : undefined };
  const { data, isLoading, isFetching, refetch } = useListEmailThreads(params, {
    query: { queryKey: getListEmailThreadsQueryKey(params) },
  });
  const threads = data?.threads ?? [];

  const handleSync = () =>
    sync.mutate(undefined, {
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListEmailThreadsQueryKey() }),
    });

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              {gmail?.connected ? (
                <Pressable onPress={handleSync} disabled={sync.isPending} hitSlop={10}>
                  <Ionicons name="refresh" size={20} color={colors.primaryForeground} />
                </Pressable>
              ) : null}
              <Pressable onPress={() => router.push("/email/compose")} hitSlop={10} disabled={!gmail?.connected}>
                <Ionicons name="create-outline" size={22} color={gmail?.connected ? colors.primaryForeground : `${colors.primaryForeground}66`} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Screen scroll={false}>
        <View style={styles.filters}>
          {gmail && !gmail.connected ? (
            <ErrorNote message="Gmail no está conectado. Configúralo desde el panel web en Configuración → Correo." />
          ) : null}
          {gmail?.connected && gmail.lastError ? <ErrorNote message={gmail.lastError} /> : null}
          <SearchInput value={search} onChangeText={setSearch} placeholder="Buscar por asunto, cliente o correo…" />
          <Chips options={STATUSES} value={status} onChange={setStatus} labels={STATUS_LABELS} />
        </View>

        {isLoading && threads.length === 0 ? (
          <Loading label="Cargando correos…" />
        ) : (
          <FlatList
            data={threads}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={threads.length === 0 ? { flexGrow: 1 } : undefined}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
            ListEmptyComponent={
              <EmptyState icon="mail-outline" title="Sin correos" description="Los correos de tus clientes aparecerán aquí." />
            }
            renderItem={({ item }: { item: EmailThread }) => (
              <ListRow
                title={item.contactName ?? item.customerEmail}
                subtitle={item.subject ?? "(sin asunto)"}
                onPress={() => router.push(`/email/${item.id}`)}
                left={
                  <Avatar
                    label={initials(item.contactName ?? item.customerEmail)}
                    uri={item.contactAvatar}
                    size={40}
                    background={colors.primarySoft}
                    color={colors.primary}
                  />
                }
                right={
                  item.unreadCount > 0 ? (
                    <View style={styles.unread}>
                      <Text style={styles.unreadText}>{item.unreadCount}</Text>
                    </View>
                  ) : undefined
                }
                meta={
                  <View style={styles.metaRow}>
                    <Text style={styles.preview} numberOfLines={1}>
                      {item.lastMessagePreview ?? "—"}
                    </Text>
                    <View style={styles.badgeRow}>
                      {item.status === "resolved" ? <Badge label="Resuelto" bg={colors.successSoft} fg={colors.success} /> : null}
                      {item.hasDraft ? <Badge label="Borrador IA" bg={colors.warningSoft} fg={colors.warning} icon="sparkles" /> : null}
                      {item.labelName ? <Badge label={item.labelName} bg={colors.accentSoft} fg={colors.accent} /> : null}
                      <Badge label={timeAgo(item.lastMessageAt)} icon="time" />
                    </View>
                  </View>
                }
              />
            )}
          />
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  filters: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  separator: { height: 1, backgroundColor: colors.border },
  metaRow: { gap: 4 },
  preview: { fontSize: 12, color: colors.mutedForeground },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  unread: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: { color: colors.primaryForeground, fontSize: 11, fontWeight: "800" },
});
