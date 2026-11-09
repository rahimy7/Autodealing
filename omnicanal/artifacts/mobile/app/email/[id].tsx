import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEmailThread,
  useMarkEmailThreadRead,
  useReplyEmailThread,
  useGenerateEmailDraft,
  useSendEmailDraft,
  useDeleteEmailDraft,
  useResolveEmailThread,
  useReopenEmailThread,
  useListEmailContactCandidates,
  useLinkEmailThreadContact,
  getGetEmailThreadQueryKey,
  getListEmailThreadsQueryKey,
  getListEmailContactCandidatesQueryKey,
  type EmailMessage,
} from "@workspace/api-client-react";
import { Sheet, SheetAction } from "../../src/components/Sheet";
import { Avatar, Badge, Button, EmptyState, Field, Loading, SearchInput } from "../../src/components/ui";
import { EmailAttachmentChips, useEmailAttachmentStaging } from "../../src/components/EmailAttachments";
import { formatBytes, openEmailAttachment } from "../../src/lib/email-media";
import { useAuth } from "../../src/lib/auth";
import { errorMessage, formatDateTime, initials } from "../../src/lib/format";
import { colors, radius, spacing } from "../../src/theme";

function EmailMessageCard({ message, token }: { message: EmailMessage; token: string | null }) {
  if (message.isInternal) {
    return (
      <View style={styles.internalRow}>
        <Text style={styles.internalText}>{message.bodyText}</Text>
      </View>
    );
  }
  const isIn = message.direction === "in";
  const author = isIn ? message.fromName ?? message.fromAddress ?? "Cliente" : message.authorAgentName ?? "Nosotros";

  return (
    <View style={[styles.messageCard, isIn ? styles.messageIn : styles.messageOut]}>
      <View style={styles.messageHeader}>
        <Text style={styles.messageAuthor} numberOfLines={1}>
          {author}
        </Text>
        <Text style={styles.messageTime}>{formatDateTime(message.sentAt ?? message.createdAt)}</Text>
      </View>
      <Text style={styles.messageBody}>{message.bodyOwnText ?? message.bodyText}</Text>
      {message.attachments.length > 0 ? (
        <View style={styles.attachmentList}>
          {message.attachments.map((a) => (
            <Pressable
              key={a.partId}
              style={styles.attachmentChip}
              onPress={() =>
                openEmailAttachment(message.id, a.partId, a.filename, token).catch((err) =>
                  Alert.alert("No se pudo abrir el adjunto", errorMessage(err)),
                )
              }
            >
              <Ionicons name="document-attach-outline" size={14} color={colors.primary} />
              <Text style={styles.attachmentChipText} numberOfLines={1}>
                {a.filename}
              </Text>
              <Text style={styles.attachmentChipSize}>{formatBytes(a.size)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function EmailThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const threadId = Number(id);
  const validId = Number.isInteger(threadId) && threadId > 0;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<EmailMessage>>(null);

  const [reply, setReply] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const staging = useEmailAttachmentStaging(token);

  const { data, isLoading } = useGetEmailThread(threadId, {
    query: { enabled: validId, queryKey: getGetEmailThreadQueryKey(threadId), refetchInterval: 15_000 },
  });
  const thread = data?.thread;
  const messages = data?.messages ?? [];
  const draft = messages.find((m) => m.isDraft) ?? null;
  const timeline = messages.filter((m) => !m.isDraft);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetEmailThreadQueryKey(threadId) });
    queryClient.invalidateQueries({ queryKey: getListEmailThreadsQueryKey() });
  };

  const markRead = useMarkEmailThreadRead();
  const cleared = useRef(false);
  useEffect(() => {
    if (!thread || cleared.current) return;
    if (thread.unreadCount > 0) {
      cleared.current = true;
      markRead.mutate({ id: threadId }, { onSuccess: invalidate });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id, thread?.unreadCount]);

  useEffect(() => {
    if (timeline.length === 0) return;
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 80);
    return () => clearTimeout(timer);
  }, [timeline.length]);

  const send = useReplyEmailThread();
  const generate = useGenerateEmailDraft();
  const resolve = useResolveEmailThread();
  const reopen = useReopenEmailThread();
  const sendDraft = useSendEmailDraft();
  const deleteDraft = useDeleteEmailDraft();
  const linkContact = useLinkEmailThreadContact();

  const linkParams = { threadId, search: linkSearch.trim() || undefined };
  const { data: linkData } = useListEmailContactCandidates(linkParams, {
    query: { queryKey: getListEmailContactCandidatesQueryKey(linkParams), enabled: linkOpen },
  });

  const handleSend = () => {
    const content = reply.trim();
    if (!content || staging.isUploading) return;
    send.mutate(
      { id: threadId, data: { content, ...(staging.attachmentIds.length ? { attachmentIds: staging.attachmentIds } : {}) } },
      {
        onSuccess: () => {
          setReply("");
          staging.reset();
          invalidate();
        },
        onError: (err) => Alert.alert("No se pudo enviar", errorMessage(err)),
      },
    );
  };

  const handleGenerate = () =>
    generate.mutate(
      { id: threadId },
      {
        onSuccess: (res) => {
          invalidate();
          if (!res.draft && res.note) Alert.alert("Sin borrador", res.note);
        },
        onError: (err) => Alert.alert("La IA no respondió", errorMessage(err)),
      },
    );

  const handleSendDraft = () => {
    if (!draft) return;
    sendDraft.mutate(
      { messageId: draft.id, data: { ...(staging.attachmentIds.length ? { attachmentIds: staging.attachmentIds } : {}) } },
      {
        onSuccess: () => {
          staging.reset();
          invalidate();
        },
        onError: (err) => Alert.alert("Gmail no aceptó el envío", errorMessage(err)),
      },
    );
  };

  if (!validId) return <EmptyState icon="alert-circle-outline" title="Correo no válido" />;
  if (isLoading && !thread) return <Loading label="Abriendo correo…" />;
  if (!thread) return <EmptyState icon="alert-circle-outline" title="No encontramos este correo" />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={styles.headerTitle}>
              <Avatar label={initials(thread.contactName ?? thread.customerEmail)} uri={thread.contactAvatar} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={styles.headerName} numberOfLines={1}>
                  {thread.contactName ?? thread.customerEmail}
                </Text>
                <Text style={styles.headerMeta} numberOfLines={1}>
                  {thread.subject ?? "(sin asunto)"}
                </Text>
              </View>
            </View>
          ),
          headerRight: () => (
            <Pressable onPress={() => setActionsOpen(true)} hitSlop={10}>
              <Ionicons name="ellipsis-vertical" size={20} color={colors.primaryForeground} />
            </Pressable>
          ),
        }}
      />

      <View style={styles.statusBar}>
        <Badge label={thread.status === "resolved" ? "Resuelto" : "Abierto"} bg={thread.status === "resolved" ? colors.successSoft : colors.infoSoft} fg={thread.status === "resolved" ? colors.success : colors.info} />
        {thread.labelName ? <Badge label={thread.labelName} bg={colors.accentSoft} fg={colors.accent} /> : null}
        <Text style={styles.customerEmail} numberOfLines={1}>
          {thread.customerEmail}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 44 : 0}
      >
        <FlatList
          ref={listRef}
          data={timeline}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
          renderItem={({ item }) => <EmailMessageCard message={item} token={token} />}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<EmptyState icon="mail-open-outline" title="Sin correos en este hilo" />}
        />

        {draft ? (
          <View style={[styles.draftWrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.draftHeader}>
              <Ionicons name="sparkles" size={14} color={colors.warning} />
              <Text style={styles.draftTitle}>Borrador de {draft.authorAgentName ?? "la IA"}</Text>
            </View>
            <TextInput
              value={draft.bodyText}
              multiline
              editable={false}
              style={styles.draftText}
            />
            <EmailAttachmentChips staging={staging} />
            <Pressable onPress={() => setLinkOpen(false)} style={styles.attachRow} hitSlop={6}>
              <AttachButton staging={staging} />
            </Pressable>
            <View style={styles.draftActions}>
              <Button
                label="Descartar"
                variant="secondary"
                size="sm"
                icon="trash"
                style={{ flex: 1 }}
                loading={deleteDraft.isPending}
                onPress={() => {
                  staging.discardAll();
                  deleteDraft.mutate({ messageId: draft.id }, { onSuccess: invalidate, onError: (err) => Alert.alert("No se pudo descartar", errorMessage(err)) });
                }}
              />
              <Button
                label="Enviar"
                size="sm"
                icon="send"
                style={{ flex: 1 }}
                loading={sendDraft.isPending}
                disabled={staging.isUploading}
                onPress={handleSendDraft}
              />
            </View>
          </View>
        ) : (
          <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <EmailAttachmentChips staging={staging} />
            <View style={styles.composer}>
              <AttachButton staging={staging} />
              <TextInput
                value={reply}
                onChangeText={setReply}
                placeholder="Escribe tu respuesta…"
                placeholderTextColor={colors.mutedForeground}
                style={styles.composerInput}
                multiline
              />
              <Pressable onPress={handleGenerate} disabled={generate.isPending} hitSlop={6} style={styles.aiButton}>
                {generate.isPending ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="sparkles" size={20} color={colors.primary} />}
              </Pressable>
              <Pressable
                onPress={handleSend}
                disabled={!reply.trim() || send.isPending || staging.isUploading}
                style={({ pressed }) => [
                  styles.sendButton,
                  (!reply.trim() || send.isPending || staging.isUploading) && { opacity: 0.4 },
                  pressed && { opacity: 0.7 },
                ]}
              >
                {send.isPending ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Ionicons name="send" size={18} color={colors.primaryForeground} />}
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* ── Acciones ─────────────────────────────────────────────────────────── */}
      <Sheet visible={actionsOpen} onClose={() => setActionsOpen(false)} title={thread.contactName ?? "Correo"}>
        <SheetAction
          icon="link"
          label="Vincular a un contacto"
          description="Une este hilo con la ficha de un cliente que ya escribe por otro canal."
          onPress={() => {
            setActionsOpen(false);
            setLinkOpen(true);
          }}
        />
        {thread.status === "resolved" ? (
          <SheetAction
            icon="refresh"
            label="Reabrir hilo"
            onPress={() => {
              setActionsOpen(false);
              reopen.mutate({ id: threadId }, { onSuccess: invalidate, onError: (err) => Alert.alert("No se pudo reabrir", errorMessage(err)) });
            }}
          />
        ) : (
          <SheetAction
            icon="checkmark-done"
            label="Marcar como resuelto"
            tint={colors.success}
            onPress={() => {
              setActionsOpen(false);
              resolve.mutate({ id: threadId }, { onSuccess: invalidate, onError: (err) => Alert.alert("No se pudo resolver", errorMessage(err)) });
            }}
          />
        )}
        {thread.contactId ? (
          <SheetAction
            icon="person"
            label="Ver ficha del contacto"
            onPress={() => {
              setActionsOpen(false);
              router.push(`/contact/${thread.contactId}`);
            }}
          />
        ) : null}
      </Sheet>

      {/* ── Vincular contacto ────────────────────────────────────────────────── */}
      <Sheet
        visible={linkOpen}
        onClose={() => setLinkOpen(false)}
        title="Vincular a un contacto"
        description="Sus chats, correos y datos quedarán juntos en una sola ficha."
      >
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <SearchInput value={linkSearch} onChangeText={setLinkSearch} placeholder="Buscar por nombre, teléfono o correo…" />
          {(linkData?.candidates ?? []).length === 0 ? (
            <Text style={styles.emptyHint}>{linkSearch ? "Ningún contacto coincide." : "Sin sugerencias. Busca por nombre o teléfono."}</Text>
          ) : (
            (linkData?.candidates ?? []).map((c) => (
              <View key={c.id} style={styles.candidateRow}>
                <Avatar label={initials(c.name)} uri={c.avatar} size={32} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.candidateName}>{c.name}</Text>
                  <Text style={styles.candidateReason}>{c.reason}</Text>
                </View>
                <Button
                  label="Vincular"
                  size="sm"
                  variant="secondary"
                  loading={linkContact.isPending}
                  onPress={() =>
                    linkContact.mutate(
                      { id: threadId, data: { contactId: c.id } },
                      {
                        onSuccess: () => {
                          setLinkOpen(false);
                          invalidate();
                        },
                        onError: (err) => Alert.alert("No se pudo vincular", errorMessage(err)),
                      },
                    )
                  }
                />
              </View>
            ))
          )}
        </View>
      </Sheet>
    </View>
  );
}

function AttachButton({ staging }: { staging: ReturnType<typeof useEmailAttachmentStaging> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={6} style={styles.attachButton}>
        <Ionicons name="attach" size={22} color={colors.mutedForeground} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Adjuntar archivo">
        <SheetAction
          icon="image"
          label="Foto o video de la galería"
          onPress={async () => {
            setOpen(false);
            const { pickFromLibrary } = await import("../../src/lib/media");
            const file = await pickFromLibrary();
            if (file) staging.addFile(file);
          }}
        />
        <SheetAction
          icon="document"
          label="Documento"
          onPress={async () => {
            setOpen(false);
            const { pickDocument } = await import("../../src/lib/media");
            const file = await pickDocument();
            if (file) staging.addFile(file);
          }}
        />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  headerTitle: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  headerName: { color: colors.primaryForeground, fontSize: 14, fontWeight: "700" },
  headerMeta: { color: `${colors.primaryForeground}CC`, fontSize: 11 },
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  customerEmail: { flex: 1, fontSize: 11, color: colors.mutedForeground, textAlign: "right" },
  messageCard: { borderRadius: radius.md, padding: spacing.md, gap: 6, maxWidth: "92%" },
  messageIn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignSelf: "flex-start" },
  messageOut: { backgroundColor: colors.primarySoft, alignSelf: "flex-end" },
  messageHeader: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  messageAuthor: { fontSize: 12, fontWeight: "700", color: colors.foreground, flexShrink: 1 },
  messageTime: { fontSize: 10, color: colors.mutedForeground },
  messageBody: { fontSize: 13, color: colors.foreground, lineHeight: 19 },
  attachmentList: { gap: 6, marginTop: 2 },
  attachmentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.muted,
  },
  attachmentChipText: { flex: 1, fontSize: 12, color: colors.foreground },
  attachmentChipSize: { fontSize: 10, color: colors.mutedForeground },
  internalRow: { alignItems: "center", paddingVertical: 4 },
  internalText: { fontSize: 11, color: colors.mutedForeground, fontStyle: "italic", textAlign: "center" },
  composerWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  attachButton: { padding: 4 },
  attachRow: { alignSelf: "flex-start" },
  composerInput: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.foreground,
  },
  aiButton: { padding: 4 },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  draftWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.warning,
    backgroundColor: colors.warningSoft,
    padding: spacing.md,
    gap: spacing.sm,
  },
  draftHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  draftTitle: { fontSize: 12, fontWeight: "700", color: colors.warning },
  draftText: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 13,
    color: colors.foreground,
    maxHeight: 160,
  },
  draftActions: { flexDirection: "row", gap: spacing.sm },
  emptyHint: { fontSize: 12, color: colors.mutedForeground, textAlign: "center", paddingVertical: spacing.lg },
  candidateRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  candidateName: { fontSize: 13, fontWeight: "600", color: colors.foreground },
  candidateReason: { fontSize: 11, color: colors.primary },
});
