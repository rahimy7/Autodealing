import { useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListFeedThreads,
  useGetFeedThread,
  useReplyFeedThread,
  useResolveFeedThread,
  useReopenFeedThread,
  useMigrateFeedThread,
  useMarkFeedThreadRead,
  usePublishFeedDraft,
  useDeleteFeedDraft,
  getListFeedThreadsQueryKey,
  getGetFeedThreadQueryKey,
  type FeedThread,
  type ListFeedThreadsParams,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet, SheetAction } from "../src/components/Sheet";
import { ChannelDot } from "../src/components/ConversationRow";
import { Badge, Button, Chips, EmptyState, Field, ListRow, Loading } from "../src/components/ui";
import { errorMessage, formatDateTime, timeAgo } from "../src/lib/format";
import { colors, radius, spacing } from "../src/theme";

const CHANNELS = ["all", "facebook", "instagram"] as const;
const CHANNEL_LABELS: Record<string, string> = { all: "Todos", facebook: "Facebook", instagram: "Instagram" };
const STATUSES = ["open", "resolved", "migrated", "all"] as const;
const STATUS_LABELS: Record<string, string> = {
  open: "Abiertos",
  resolved: "Resueltos",
  migrated: "En DM",
  all: "Todos",
};
const STATUS_TINT: Record<string, { bg: string; fg: string }> = {
  open: { bg: colors.infoSoft, fg: colors.info },
  resolved: { bg: colors.successSoft, fg: colors.success },
  migrated: { bg: colors.botSoft, fg: colors.bot },
};

export default function FeedScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("all");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("open");
  const [selected, setSelected] = useState<FeedThread | null>(null);
  const [reply, setReply] = useState("");
  const [replyMode, setReplyMode] = useState<"public_only" | "private_only" | "both">("public_only");

  const params: ListFeedThreadsParams = {
    channel: channel !== "all" ? channel : undefined,
    status: status !== "all" ? status : undefined,
  };
  const { data, isLoading, isFetching, refetch } = useListFeedThreads(params, {
    query: { queryKey: getListFeedThreadsQueryKey(params), refetchInterval: 15_000 },
  });
  const { data: detail } = useGetFeedThread(selected?.id ?? 0, {
    query: {
      queryKey: getGetFeedThreadQueryKey(selected?.id ?? 0),
      enabled: !!selected,
      refetchInterval: 8_000,
    },
  });

  const replyThread = useReplyFeedThread();
  const resolveThread = useResolveFeedThread();
  const reopenThread = useReopenFeedThread();
  const migrateThread = useMigrateFeedThread();
  const markRead = useMarkFeedThreadRead();
  const publishDraft = usePublishFeedDraft();
  const deleteDraft = useDeleteFeedDraft();

  const threads = data?.threads ?? [];
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListFeedThreadsQueryKey() });
    if (selected) queryClient.invalidateQueries({ queryKey: getGetFeedThreadQueryKey(selected.id) });
  };

  const open = (thread: FeedThread) => {
    setSelected(thread);
    setReply("");
    if (thread.unreadCount > 0) {
      markRead.mutate({ id: thread.id }, { onSuccess: invalidate });
    }
  };

  const send = () => {
    const content = reply.trim();
    if (!content || !selected) return;
    replyThread.mutate(
      { id: selected.id, data: { content, mode: replyMode } },
      {
        onSuccess: (result) => {
          setReply("");
          invalidate();
          if (result.migratedConversationId) {
            router.push(`/chat/${result.migratedConversationId}`);
          }
        },
        onError: (err) => Alert.alert("No se pudo responder", errorMessage(err)),
      },
    );
  };

  return (
    <Screen scroll={false}>
      <View style={styles.filters}>
        <Chips options={CHANNELS} value={channel} onChange={setChannel} labels={CHANNEL_LABELS} />
        <Chips options={STATUSES} value={status} onChange={setStatus} labels={STATUS_LABELS} />
      </View>

      {isLoading && threads.length === 0 ? (
        <Loading label="Cargando comentarios…" />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={threads.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState icon="chatbox-outline" title="Sin hilos" description="Aquí aparecen los comentarios de tus publicaciones." />
          }
          renderItem={({ item }) => {
            const tint = STATUS_TINT[item.status] ?? STATUS_TINT.open;
            return (
              <ListRow
                title={item.contactName ?? "Alguien"}
                subtitle={item.lastComment ?? "Sin comentarios"}
                onPress={() => open(item)}
                left={<ChannelDot channel={item.channel} size={26} />}
                right={
                  item.unreadCount > 0 ? (
                    <View style={styles.unread}>
                      <Text style={styles.unreadText}>{item.unreadCount}</Text>
                    </View>
                  ) : undefined
                }
                meta={
                  <View style={styles.metaRow}>
                    <Badge label={STATUS_LABELS[item.status] ?? item.status} bg={tint.bg} fg={tint.fg} />
                    {item.labelName ? <Badge label={item.labelName} bg={colors.accentSoft} fg={colors.accent} /> : null}
                    <Badge label={timeAgo(item.lastCommentAt)} icon="time" />
                  </View>
                }
              />
            );
          }}
        />
      )}

      <Sheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.contactName ?? "Hilo"}
        description={detail?.thread.post?.caption ?? undefined}
      >
        <View style={styles.thread}>
          {(detail?.comments ?? []).map((comment) => (
            <View
              key={comment.id}
              style={[
                styles.comment,
                comment.direction === "out" ? styles.commentOut : styles.commentIn,
                comment.isDraft && styles.commentDraft,
              ]}
            >
              <View style={styles.commentHeader}>
                <Text style={styles.commentAuthor}>
                  {comment.authorAgentName ?? comment.authorName ?? (comment.direction === "out" ? "Nosotros" : "Cliente")}
                </Text>
                {comment.isDraft ? <Badge label="Borrador IA" bg={colors.warningSoft} fg={colors.warning} /> : null}
                {comment.delivery === "private_reply" ? <Badge label="DM" bg={colors.botSoft} fg={colors.bot} /> : null}
              </View>
              <Text style={styles.commentBody}>{comment.content}</Text>
              <Text style={styles.commentTime}>{formatDateTime(comment.publishedAt ?? comment.createdAt)}</Text>

              {comment.isDraft ? (
                <View style={styles.draftActions}>
                  <Button
                    label="Publicar"
                    size="sm"
                    icon="send"
                    style={{ flex: 1 }}
                    loading={publishDraft.isPending}
                    onPress={() =>
                      publishDraft.mutate(
                        { commentId: comment.id, data: { alsoPrivate: false } },
                        { onSuccess: invalidate, onError: (err) => Alert.alert("No se pudo publicar", errorMessage(err)) },
                      )
                    }
                  />
                  <Button
                    label="Descartar"
                    size="sm"
                    variant="secondary"
                    style={{ flex: 1 }}
                    loading={deleteDraft.isPending}
                    onPress={() =>
                      deleteDraft.mutate(
                        { commentId: comment.id },
                        { onSuccess: invalidate, onError: (err) => Alert.alert("No se pudo descartar", errorMessage(err)) },
                      )
                    }
                  />
                </View>
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.form}>
          <Chips
            options={["public_only", "private_only", "both"] as const}
            value={replyMode}
            onChange={setReplyMode}
            labels={{ public_only: "Público", private_only: "Solo DM", both: "Ambos" }}
          />
          <Field
            label="Responder"
            value={reply}
            onChangeText={setReply}
            placeholder="Escribe la respuesta…"
            multiline
          />
          <Button label="Enviar respuesta" icon="send" onPress={send} loading={replyThread.isPending} />
        </View>

        {selected ? (
          <>
            <SheetAction
              icon="mail"
              label="Pasar a mensaje privado"
              description={
                reply.trim()
                  ? "Se enviará el texto que escribiste arriba como primer DM."
                  : "Abre un DM con esta persona y sigue la conversación ahí."
              }
              onPress={() =>
                migrateThread.mutate(
                  {
                    id: selected.id,
                    data: {
                      message:
                        reply.trim() ||
                        "¡Hola! Te escribimos por privado para ayudarte mejor con tu consulta.",
                    },
                  },
                  {
                    onSuccess: (result) => {
                      invalidate();
                      setSelected(null);
                      if (result.conversationId) router.push(`/chat/${result.conversationId}`);
                    },
                    onError: (err) => Alert.alert("No se pudo migrar", errorMessage(err)),
                  },
                )
              }
            />
            {selected.status === "resolved" ? (
              <SheetAction
                icon="refresh"
                label="Reabrir hilo"
                onPress={() =>
                  reopenThread.mutate(
                    { id: selected.id },
                    {
                      onSuccess: () => {
                        setSelected(null);
                        invalidate();
                      },
                      onError: (err) => Alert.alert("No se pudo reabrir", errorMessage(err)),
                    },
                  )
                }
              />
            ) : (
              <SheetAction
                icon="checkmark-done"
                label="Marcar como resuelto"
                tint={colors.success}
                onPress={() =>
                  resolveThread.mutate(
                    { id: selected.id },
                    {
                      onSuccess: () => {
                        setSelected(null);
                        invalidate();
                      },
                      onError: (err) => Alert.alert("No se pudo resolver", errorMessage(err)),
                    },
                  )
                }
              />
            )}
            {selected.migratedConversationId ? (
              <SheetAction
                icon="chatbubbles"
                label="Abrir la conversación en DM"
                onPress={() => {
                  const id = selected.migratedConversationId!;
                  setSelected(null);
                  router.push(`/chat/${id}`);
                }}
              />
            ) : null}
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  separator: { height: 1, backgroundColor: colors.border },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  unread: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: { color: colors.primaryForeground, fontSize: 11, fontWeight: "800" },
  thread: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm },
  comment: { padding: spacing.md, borderRadius: radius.md, gap: 4 },
  commentIn: { backgroundColor: colors.muted },
  commentOut: { backgroundColor: colors.primarySoft },
  commentDraft: { borderWidth: 1, borderColor: colors.warning, borderStyle: "dashed" },
  commentHeader: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  commentAuthor: { fontSize: 12, fontWeight: "700", color: colors.foreground },
  commentBody: { fontSize: 13, color: colors.foreground, lineHeight: 18 },
  commentTime: { fontSize: 10, color: colors.mutedForeground },
  draftActions: { flexDirection: "row", gap: spacing.sm, marginTop: 4 },
  form: { padding: spacing.lg, gap: spacing.md },
});
