import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Image } from "expo-image";
import {
  useGetConversation,
  useListMessages,
  useListAgents,
  useSendMessage,
  useEditMessage,
  useDeleteMessage,
  useResolveConversation,
  useMarkConversationRead,
  useClaimConversation,
  useAssignConversation,
  useEscalateConversation,
  getGetConversationQueryKey,
  getListAgentsQueryKey,
  getListConversationsQueryKey,
  getListMessagesQueryKey,
  type Message,
} from "@workspace/api-client-react";
import { MessageBubble, DayDivider } from "../../src/components/MessageBubble";
import { ChannelDot } from "../../src/components/ConversationRow";
import { ComposerChip } from "../../src/components/Reply";
import { TemplateSheet, WindowClosedNotice } from "../../src/components/MessagingWindow";
import { SaleSheet, saleThisSession } from "../../src/components/SaleTracking";
import { Sheet, SheetAction } from "../../src/components/Sheet";
import { Avatar, Badge, EmptyState, Loading } from "../../src/components/ui";
import { useAuth } from "../../src/lib/auth";
import { MESSAGES_POLL_MS } from "../../src/lib/config";
import {
  MAX_ATTACHMENT_BYTES,
  afterSheetCloses,
  pickDocument,
  pickFromLibrary,
  takePhoto,
  uploadAttachment,
  type PickedFile,
} from "../../src/lib/media";
import { dayLabel, errorMessage, initials, maskPhone } from "../../src/lib/format";
import { channelLabels, chatColors, colors, radius, spacing, statusColors, statusLabels } from "../../src/theme";

type Row = { kind: "day"; key: string; label: string } | { kind: "message"; key: string; message: Message };

// Day separators are interleaved once, here, so the list itself stays dumb.
function buildRows(messages: Message[]): Row[] {
  const rows: Row[] = [];
  let lastDay = "";
  for (const message of messages) {
    const label = dayLabel(message.createdAt);
    if (label !== lastDay) {
      rows.push({ kind: "day", key: `day-${label}-${message.id}`, label });
      lastDay = label;
    }
    rows.push({ kind: "message", key: `msg-${message.id}`, message });
  }
  return rows;
}

// Qué se puede hacer con un mensaje, con las mismas reglas que el panel
// (omnicanal/src/components/ChatMessages.tsx). Editar y eliminar solo tocan lo
// que salió de nuestro lado, y solo en el panel: Meta no deja editar ni borrar un
// mensaje ya enviado. Citar exige que el mensaje exista en el canal, o el cliente
// no vería la cita.
function messageActions(msg: Message, windowOpen: boolean) {
  const ours = msg.sender !== "contact";
  return {
    reply: !msg.isDeleted && msg.onChannel && windowOpen,
    edit: ours && !msg.isDeleted && msg.type === "text",
    remove: ours && !msg.isDeleted,
  };
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user, token } = useAuth();

  const isAdmin = user?.role === "admin";
  const myAgentId = user?.agentId ?? null;

  const [text, setText] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  // El archivo elegido para mandar; lo que se escriba viaja como su pie.
  const [attachment, setAttachment] = useState<PickedFile | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  // El mensaje al que se responde (se cita) y el que se está editando. Editar usa
  // la misma caja de texto, como WhatsApp; lo que hubiera escrito vuelve al salir.
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [sendCorrection, setSendCorrection] = useState(true);
  const draftBeforeEdit = useRef("");
  const [menuFor, setMenuFor] = useState<Message | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listRef = useRef<FlatList<Row>>(null);
  const inputRef = useRef<TextInput>(null);
  // Si el hilo está abajo del todo. Mientras lo esté, lo nuevo lo sigue; si subió
  // a leer o a ver una cita, no se le arrastra al final.
  const atEnd = useRef(true);

  const validId = Number.isInteger(conversationId) && conversationId > 0;

  const { data: conversation, isLoading: convLoading } = useGetConversation(conversationId, {
    query: {
      enabled: validId,
      queryKey: getGetConversationQueryKey(conversationId),
      refetchInterval: MESSAGES_POLL_MS * 2,
    },
  });

  const { data: messages, isLoading: msgsLoading } = useListMessages(conversationId, {
    query: {
      enabled: validId,
      queryKey: getListMessagesQueryKey(conversationId),
      refetchInterval: MESSAGES_POLL_MS,
      staleTime: 0,
    },
  });

  // Quién lleva el chat hay que resolverlo contra la lista de agentes: la
  // conversación solo trae el nombre, y por el nombre no se distingue al bot de
  // una persona —que es justo de lo que depende poder contestar—. El admin la
  // pide además para el selector de asignación.
  const ownerId = conversation?.agentId ?? null;
  const { data: agents } = useListAgents({
    query: {
      queryKey: getListAgentsQueryKey(),
      enabled: (isAdmin && assignOpen) || (!isAdmin && ownerId != null && ownerId !== myAgentId),
    },
  });

  const sendMessage = useSendMessage();
  const editMessage = useEditMessage();
  const deleteMessage = useDeleteMessage();
  const resolveConversation = useResolveConversation();
  const markRead = useMarkConversationRead();
  const claimConversation = useClaimConversation();
  const assignConversation = useAssignConversation();
  const escalateConversation = useEscalateConversation();

  const mine = !!conversation && conversation.agentId === myAgentId && myAgentId != null;
  const owner = ownerId != null ? agents?.find((a) => a.id === ownerId) : null;
  // El chat que atiende otra persona es el único que queda en solo lectura. En el
  // del bot, o en el que no es de nadie, se contesta directo: la API lo reasigna a
  // quien responde. Pedir "Tomar chat" antes cerraba justo los chats que más se
  // atienden, porque el bot se queda con la conversación en cuanto contesta.
  // Mientras la lista de agentes no ha llegado no se sabe quién lo lleva y se deja
  // escribir: quien decide es la API, que responde con el motivo si el chat era de
  // un compañero.
  const heldByPerson = !!owner && owner.type !== "virtual" && owner.id !== myAgentId;
  const canReply = isAdmin || !heldByPerson;
  // La ventana de 24h de Meta. Cerrada, el canal rechaza un mensaje libre: en
  // WhatsApp se reabre con una plantilla, en Instagram/Facebook hay que esperar
  // a que el cliente escriba.
  const windowOpen = conversation?.messagingWindowOpen ?? true;
  const busy =
    sendMessage.isPending ||
    resolveConversation.isPending ||
    claimConversation.isPending ||
    assignConversation.isPending ||
    escalateConversation.isPending;

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
    queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
  }, [queryClient, conversationId]);

  // Opening a chat clears its unread badge, exactly like the panel does.
  const cleared = useRef(false);
  useEffect(() => {
    if (!conversation || cleared.current) return;
    if ((conversation.unreadCount ?? 0) > 0) {
      cleared.current = true;
      markRead.mutate(
        { id: conversationId },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }) },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, conversation?.unreadCount]);

  const rows = useMemo(() => buildRows(messages ?? []), [messages]);

  useEffect(() => {
    if (rows.length === 0 || !atEnd.current) return;
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 80);
    return () => clearTimeout(timer);
  }, [rows.length]);

  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  const focusComposer = () => {
    void afterSheetCloses().then(() => inputRef.current?.focus());
  };

  const send = () => {
    const content = text.trim();
    if (!validId) return;
    if (editing) {
      saveEdit(content);
      return;
    }
    if (attachment) {
      void sendAttachment(content);
      return;
    }
    if (!content) return;
    const quoted = replyTo;
    setText("");
    setReplyTo(null);
    atEnd.current = true;
    sendMessage.mutate(
      { conversationId, data: { content, type: "text", replyToMessageId: quoted?.id } },
      {
        onSuccess: invalidate,
        onError: (err) => {
          setText(content);
          setReplyTo(quoted);
          Alert.alert("No se pudo enviar", errorMessage(err));
        },
      },
    );
  };

  const sendAttachment = async (caption: string) => {
    if (!attachment || uploading) return;
    setUploading(true);
    try {
      await uploadAttachment(conversationId, attachment, caption, token, replyTo?.id);
      setAttachment(null);
      setText("");
      setReplyTo(null);
      atEnd.current = true;
      invalidate();
    } catch (err) {
      Alert.alert("No se pudo enviar el archivo", errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const choose = async (pick: () => Promise<PickedFile | null>) => {
    setAttachOpen(false);
    try {
      await afterSheetCloses();
      const picked = await pick();
      if (!picked) return;
      if (picked.size != null && picked.size > MAX_ATTACHMENT_BYTES) {
        Alert.alert("Archivo demasiado grande", "El máximo es 16 MB.");
        return;
      }
      setAttachment(picked);
    } catch (err) {
      Alert.alert("No se pudo adjuntar", errorMessage(err));
    }
  };

  // ── Acciones sobre un mensaje ───────────────────────────────────────────────

  const startReply = (msg: Message) => {
    setMenuFor(null);
    if (editing) cancelEdit();
    setReplyTo(msg);
    focusComposer();
  };

  const startEdit = (msg: Message) => {
    setMenuFor(null);
    if (!editing) draftBeforeEdit.current = text;
    setReplyTo(null);
    setEditing(msg);
    setText(msg.content);
    // Con la ventana cerrada la corrección no llegaría: se ofrece apagada.
    setSendCorrection(msg.onChannel && windowOpen);
    focusComposer();
  };

  const cancelEdit = () => {
    setEditing(null);
    setText(draftBeforeEdit.current);
    draftBeforeEdit.current = "";
  };

  const saveEdit = (content: string) => {
    const msg = editing;
    if (!msg) return;
    if (!content || content === msg.content) {
      cancelEdit();
      return;
    }
    editMessage.mutate(
      {
        conversationId,
        messageId: msg.id,
        data: { content, sendCorrection: msg.onChannel && sendCorrection },
      },
      {
        onSuccess: () => {
          cancelEdit();
          invalidate();
        },
        onError: (err) => Alert.alert("No se pudo editar el mensaje", errorMessage(err)),
      },
    );
  };

  // Sin confirmación, como en el panel: solo se oculta ahí, el texto original
  // sigue en la base.
  const removeMessage = (msg: Message) => {
    setMenuFor(null);
    if (editing?.id === msg.id) cancelEdit();
    if (replyTo?.id === msg.id) setReplyTo(null);
    deleteMessage.mutate(
      { conversationId, messageId: msg.id },
      {
        onSuccess: invalidate,
        onError: (err) => Alert.alert("No se pudo eliminar el mensaje", errorMessage(err)),
      },
    );
  };

  // Tocar una cita lleva al mensaje citado y lo resalta un momento, como WhatsApp.
  const jumpTo = (messageId: number) => {
    const index = rows.findIndex((row) => row.kind === "message" && row.message.id === messageId);
    if (index < 0) return;
    atEnd.current = false;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    setHighlightId(messageId);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1600);
  };

  const sending = sendMessage.isPending || uploading || editMessage.isPending;
  const canSend = editing
    ? !!text.trim() && !editMessage.isPending
    : windowOpen && (!!text.trim() || !!attachment) && !sendMessage.isPending && !uploading;

  const runAction = (
    label: string,
    mutate: (onDone: () => void, onFail: (err: unknown) => void) => void,
  ) => {
    setActionsOpen(false);
    mutate(
      () => invalidate(),
      (err) => Alert.alert(label, errorMessage(err)),
    );
  };

  if (!validId) {
    return <EmptyState icon="alert-circle-outline" title="Conversación no válida" />;
  }
  if (convLoading && !conversation) {
    return <Loading label="Abriendo conversación…" />;
  }
  if (!conversation) {
    return <EmptyState icon="alert-circle-outline" title="No encontramos esta conversación" description="Puede que se haya cerrado o que no tengas acceso." />;
  }

  const status = statusColors[conversation.status] ?? { bg: colors.muted, fg: colors.mutedForeground };
  const sold = saleThisSession(conversation);
  const menuActions = menuFor ? messageActions(menuFor, windowOpen) : null;

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={styles.headerTitle}>
              <Avatar
                label={initials(conversation.contactName)}
                uri={conversation.contactAvatar}
                size={34}
                badge={<ChannelDot channel={conversation.channel} size={14} />}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.headerName} numberOfLines={1}>
                  {conversation.contactName ?? "Contacto"}
                </Text>
                <Text style={styles.headerMeta} numberOfLines={1}>
                  {channelLabels[conversation.channel] ?? conversation.channel} ·{" "}
                  {mine ? "asignada a ti" : (conversation.agentName ?? "sin asignar")}
                </Text>
              </View>
            </View>
          ),
          headerRight: () => (
            <Pressable onPress={() => setActionsOpen(true)} hitSlop={10}>
              <Ionicons name="ellipsis-vertical" size={20} color={colors.foreground} />
            </Pressable>
          ),
        }}
      />

      <View style={styles.statusBar}>
        <Badge label={statusLabels[conversation.status] ?? conversation.status} bg={status.bg} fg={status.fg} />
        {sold ? <Badge label="Vendido" icon="bag-check" bg={colors.successSoft} fg={colors.success} /> : null}
        {conversation.labelName ? (
          <Badge label={conversation.labelName} bg={colors.accentSoft} fg={colors.accent} />
        ) : null}
        {conversation.groupName ? <Badge label={conversation.groupName} icon="people" /> : null}
        {conversation.contactPhone ? (
          <Text style={styles.phone} numberOfLines={1}>
            {isAdmin ? conversation.contactPhone : maskPhone(conversation.contactPhone)}
          </Text>
        ) : null}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: chatColors.wallpaper }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 44 : 0}
      >
        {msgsLoading && rows.length === 0 ? (
          <Loading label="Cargando mensajes…" />
        ) : rows.length === 0 ? (
          <EmptyState icon="chatbubble-ellipses-outline" title="Sin mensajes todavía" description="Escribe el primero." />
        ) : (
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(row) => row.key}
            contentContainerStyle={{ paddingVertical: spacing.md }}
            renderItem={({ item }) => {
              if (item.kind === "day") return <DayDivider label={item.label} />;
              const actions = messageActions(item.message, windowOpen);
              const actionable = canReply && !item.message.isInternal && (actions.reply || actions.edit || actions.remove);
              return (
                <MessageBubble
                  message={item.message}
                  onLongPress={actionable ? () => setMenuFor(item.message) : undefined}
                  onQuotePress={jumpTo}
                  highlighted={highlightId === item.message.id}
                />
              );
            }}
            extraData={highlightId}
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              atEnd.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 120;
            }}
            scrollEventThrottle={100}
            onContentSizeChange={() => {
              if (atEnd.current) listRef.current?.scrollToEnd({ animated: false });
            }}
            // Un mensaje citado lejos puede no estar renderizado todavía: se acerca
            // la lista a su altura estimada y se vuelve a intentar.
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
              setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }), 150);
            }}
            keyboardDismissMode="interactive"
          />
        )}

        {canReply ? (
          <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            {!windowOpen && !editing ? (
              <WindowClosedNotice channel={conversation.channel} onOpenTemplates={() => setTemplatesOpen(true)} />
            ) : null}
            {editing ? (
              <ComposerChip quote={editing} title="Editando mensaje" onCancel={cancelEdit} disabled={editMessage.isPending}>
                {/* Meta no edita mensajes enviados: esto le manda al cliente un
                    mensaje nuevo que cita al original. Sin id de canal (nunca salió
                    por Meta) no hay nada que citar. */}
                {editing.onChannel ? (
                  <Pressable
                    onPress={() => setSendCorrection((value) => !value)}
                    disabled={editMessage.isPending}
                    style={styles.correctionRow}
                    hitSlop={6}
                  >
                    <Ionicons
                      name={sendCorrection ? "checkbox" : "square-outline"}
                      size={18}
                      color={sendCorrection ? colors.primary : colors.mutedForeground}
                    />
                    <Text style={styles.correctionText}>Enviar corrección al cliente («✏️ Corrección: …»)</Text>
                  </Pressable>
                ) : null}
              </ComposerChip>
            ) : replyTo ? (
              <ComposerChip quote={replyTo} title="Respondiendo" onCancel={() => setReplyTo(null)} disabled={sending} />
            ) : null}
            {attachment && !editing ? (
              <View style={styles.attachmentRow}>
                {attachment.isImage ? (
                  <Image source={{ uri: attachment.uri }} style={styles.attachmentThumb} contentFit="cover" />
                ) : (
                  <View style={[styles.attachmentThumb, styles.attachmentIcon]}>
                    <Ionicons
                      name={attachment.mimeType.startsWith("video/") ? "videocam" : "document-text"}
                      size={20}
                      color={colors.mutedForeground}
                    />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.attachmentName} numberOfLines={1}>
                    {attachment.name}
                  </Text>
                  <Text style={styles.attachmentHint}>
                    {uploading ? "Enviando…" : "Lo que escribas irá como pie"}
                  </Text>
                </View>
                <Pressable onPress={() => setAttachment(null)} disabled={uploading} hitSlop={10}>
                  <Ionicons name="close-circle" size={22} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.composer}>
              <Pressable
                onPress={() => setAttachOpen(true)}
                disabled={uploading || !!editing || !windowOpen}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.attachButton,
                  (pressed || uploading || !!editing || !windowOpen) && { opacity: 0.4 },
                ]}
              >
                <Ionicons name="attach" size={24} color={colors.mutedForeground} />
              </Pressable>
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={setText}
                editable={windowOpen || !!editing}
                placeholder={
                  editing
                    ? "Escribe el texto corregido…"
                    : !windowOpen
                      ? conversation.channel === "whatsapp"
                        ? "Envía una plantilla para reabrir la conversación…"
                        : "Espera a que el cliente vuelva a escribir…"
                      : attachment
                        ? "Añade un pie (opcional)…"
                        : "Escribe un mensaje…"
                }
                placeholderTextColor={colors.mutedForeground}
                style={[styles.composerInput, !windowOpen && !editing && { opacity: 0.6 }]}
                multiline
              />
              <Pressable
                onPress={send}
                disabled={!canSend}
                style={({ pressed }) => [styles.sendButton, !canSend && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
              >
                {uploading || editMessage.isPending ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Ionicons name={editing ? "checkmark" : "send"} size={18} color={colors.primaryForeground} />
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={[styles.readonly, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <Ionicons name="eye" size={16} color={colors.mutedForeground} />
            <Text style={styles.readonlyText}>
              Solo lectura: la atiende {owner?.name ?? conversation.agentName ?? "otro agente"}.
            </Text>
            <Pressable
              onPress={() =>
                claimConversation.mutate(
                  { id: conversationId },
                  {
                    onSuccess: invalidate,
                    onError: (err) => Alert.alert("No se pudo tomar el chat", errorMessage(err)),
                  },
                )
              }
              disabled={claimConversation.isPending}
              style={styles.claimButton}
            >
              <Text style={styles.claimText}>{claimConversation.isPending ? "Tomando…" : "Tomar chat"}</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* ── Message actions ─────────────────────────────────────────────────── */}
      <Sheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title="Mensaje"
        description={menuFor ? menuFor.content.slice(0, 120) : undefined}
      >
        {menuFor && menuActions?.reply ? (
          <SheetAction
            icon="arrow-undo"
            label="Responder"
            description="Tu respuesta le llega al cliente citando este mensaje."
            onPress={() => startReply(menuFor)}
          />
        ) : null}
        {menuFor && menuActions?.edit ? (
          <SheetAction
            icon="create"
            label="Editar"
            description={
              menuFor.onChannel
                ? "Cambia el texto en el panel y, si quieres, le manda la corrección al cliente."
                : "Cambia el texto en el panel."
            }
            onPress={() => startEdit(menuFor)}
          />
        ) : null}
        {menuFor && menuActions?.remove ? (
          <SheetAction
            icon="trash"
            label="Eliminar"
            description="Deja de verse en el panel. Meta no permite borrarlo del teléfono del cliente."
            tint={colors.destructive}
            disabled={deleteMessage.isPending}
            onPress={() => removeMessage(menuFor)}
          />
        ) : null}
      </Sheet>

      {/* ── Actions ─────────────────────────────────────────────────────────── */}
      <Sheet
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={conversation.contactName ?? "Conversación"}
        description={`${channelLabels[conversation.channel] ?? conversation.channel} · ${statusLabels[conversation.status] ?? conversation.status}`}
      >
        {!mine && !isAdmin ? (
          <SheetAction
            icon="hand-left"
            label="Tomar el chat"
            description="Pasa a tus conversaciones y queda registrado en el hilo."
            disabled={busy}
            onPress={() =>
              runAction("No se pudo tomar el chat", (done, fail) =>
                claimConversation.mutate({ id: conversationId }, { onSuccess: done, onError: fail }),
              )
            }
          />
        ) : null}

        {isAdmin ? (
          <SheetAction
            icon="person-add"
            label="Asignar a un agente"
            description={conversation.agentName ? `Ahora: ${conversation.agentName}` : "Sin asignar"}
            disabled={busy}
            onPress={() => {
              setActionsOpen(false);
              setAssignOpen(true);
            }}
          />
        ) : null}

        {/* Como en el panel: el admin y quien lleva el chat marcan la venta. */}
        {mine || isAdmin ? (
          <SheetAction
            icon={sold ? "bag-check" : "bag-handle"}
            label={sold ? "Vendido" : "Venta cerrada"}
            description={
              sold
                ? "Ver la venta y los seguimientos, o desmarcarla."
                : "Arranca el post-venta y cancela la recuperación de la venta."
            }
            tint={colors.success}
            onPress={() => {
              setActionsOpen(false);
              setSaleOpen(true);
            }}
          />
        ) : null}

        {canReply && !windowOpen && conversation.channel === "whatsapp" ? (
          <SheetAction
            icon="document-text"
            label="Enviar plantilla"
            description="Reabre la conversación pasadas las 24h."
            onPress={() => {
              setActionsOpen(false);
              setTemplatesOpen(true);
            }}
          />
        ) : null}

        <SheetAction
          icon="trending-up"
          label="Escalar"
          description="Deriva al destino configurado para el agente actual."
          disabled={busy}
          onPress={() =>
            runAction("No se pudo escalar", (done, fail) =>
              escalateConversation.mutate({ id: conversationId }, { onSuccess: done, onError: fail }),
            )
          }
        />

        {conversation.status !== "resolved" ? (
          <SheetAction
            icon="checkmark-done"
            label="Marcar como resuelta"
            description="Cierra la sesión actual del chat."
            tint={colors.success}
            disabled={busy}
            onPress={() =>
              runAction("No se pudo resolver", (done, fail) =>
                resolveConversation.mutate({ id: conversationId }, { onSuccess: done, onError: fail }),
              )
            }
          />
        ) : null}

        {isAdmin && conversation.contactId ? (
          <SheetAction
            icon="person"
            label="Ver ficha del contacto"
            onPress={() => {
              setActionsOpen(false);
              router.push(`/contact/${conversation.contactId}`);
            }}
          />
        ) : null}
      </Sheet>

      {/* ── Attach ─────────────────────────────────────────────────────────── */}
      <Sheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        title="Adjuntar"
        description="Una foto, un video o un documento para el cliente."
      >
        <SheetAction
          icon="images"
          label="Galería"
          description="Una foto o un video del teléfono."
          onPress={() => void choose(pickFromLibrary)}
        />
        <SheetAction icon="camera" label="Cámara" description="Toma una foto ahora." onPress={() => void choose(takePhoto)} />
        <SheetAction
          icon="document-attach"
          label="Documento"
          description="PDF, Word, Excel u otro archivo."
          onPress={() => void choose(pickDocument)}
        />
      </Sheet>

      <TemplateSheet
        conversationId={conversationId}
        visible={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onSent={() => {
          atEnd.current = true;
          invalidate();
        }}
      />

      <SaleSheet conversation={conversation} visible={saleOpen} onClose={() => setSaleOpen(false)} />

      {/* ── Assign picker (admin) ───────────────────────────────────────────── */}
      <Sheet
        visible={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Asignar conversación"
        description="El agente recibe una notificación en su teléfono."
      >
        {(agents ?? []).filter((a) => a.isActive !== false).map((agent) => (
          <SheetAction
            key={agent.id}
            icon={agent.type === "virtual" ? "sparkles" : "person"}
            label={agent.name}
            description={agent.type === "virtual" ? "Agente virtual" : agent.email}
            selected={conversation.agentId === agent.id}
            disabled={busy}
            onPress={() => {
              setAssignOpen(false);
              assignConversation.mutate(
                { id: conversationId, data: { agentId: agent.id } },
                {
                  onSuccess: invalidate,
                  onError: (err) => Alert.alert("No se pudo asignar", errorMessage(err)),
                },
              );
            }}
          />
        ))}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerTitle: { flexDirection: "row", alignItems: "center", gap: spacing.sm, maxWidth: 240 },
  headerName: { fontSize: 15, fontWeight: "700", color: colors.primaryForeground },
  headerMeta: { fontSize: 11, color: "rgba(255, 255, 255, 0.85)" },
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
  phone: { flex: 1, textAlign: "right", fontSize: 11, color: colors.mutedForeground },
  composerWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  attachButton: {
    width: 32,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  attachmentThumb: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.muted },
  attachmentIcon: { alignItems: "center", justifyContent: "center" },
  attachmentName: { fontSize: 13, fontWeight: "600", color: colors.foreground },
  attachmentHint: { fontSize: 11, color: colors.mutedForeground },
  correctionRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 2 },
  correctionText: { flex: 1, fontSize: 11, color: colors.mutedForeground },
  composerInput: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 14,
    color: colors.foreground,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  readonly: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  readonlyText: { flex: 1, fontSize: 12, color: colors.mutedForeground },
  claimButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  claimText: { color: colors.primaryForeground, fontSize: 12, fontWeight: "700" },
});
