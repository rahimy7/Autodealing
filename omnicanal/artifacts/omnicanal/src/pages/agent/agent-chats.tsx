import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useListConversations,
  useListMessages,
  useListAgents,
  useClaimConversation,
  useSendMessage,
  useMarkConversationRead,
  getListConversationsQueryKey,
  getListMessagesQueryKey,
} from "@workspace/api-client-react";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Search, MessageSquare, ArrowLeft, HandGrab, UserCheck, Users, Send } from "lucide-react";
import { ReadFilterMenu, type ReadFilter } from "@/components/ReadFilterMenu";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import AgentLayout from "@/components/layout/AgentLayout";
import ContactAvatar from "@/components/ContactAvatar";
import ChatMessages from "@/components/ChatMessages";
import { AttachButton, AttachmentChip, useAttachmentDraft } from "@/components/Attachments";
import { ReplyChip, useReplyDraft } from "@/components/Reply";
import { WindowClosedNotice, TemplateSendDialog } from "@/components/MessagingWindow";
import { SaleTrackingButton } from "@/components/SaleTracking";
import { OrderBadge } from "@/components/OrderBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useChatScroll } from "@/hooks/use-chat-scroll";
import { useAuth } from "@/lib/auth";
import { useOpenConversation } from "@/lib/notifications";
import { dismissHandoff, muteHandoff } from "@/lib/handoffs";
import { cn, maskPhone } from "@/lib/utils";

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  whatsapp: SiWhatsapp,
  instagram: SiInstagram,
  facebook: SiFacebook,
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "text-[#25D366]",
  instagram: "text-[#E1306C]",
  facebook: "text-[#1877F2]",
};

const CHANNEL_LABELS: Record<string, string> = {
  all: "Todos",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  pending: "bg-amber-100 text-amber-700",
  bot: "bg-purple-100 text-purple-700",
  resolved: "bg-green-100 text-green-700",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Abierto",
  pending: "Pendiente",
  bot: "Bot",
  resolved: "Resuelto",
};

const CHANNEL_TABS = ["all", "whatsapp", "instagram", "facebook"] as const;
const STATUS_TABS = ["all", "open", "pending", "bot", "resolved"] as const;

const MESSAGES_POLL_MS = 3000;
const CONVERSATIONS_POLL_MS = 8000;

function timeAgo(date: string) {
  const d = new Date(date);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function AgentChats() {
  const { user } = useAuth();
  const agentId = user?.agentId;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [search, setSearch] = useState("");
  // La búsqueda sale al servidor cuando se deja de escribir, no con cada tecla.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [messageText, setMessageText] = useState("");
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  // Qué se hará si el agente confirma quitarle el chat a un compañero: tomarlo a
  // secas, o tomarlo para mandar lo que ya tiene escrito.
  const [confirmIntent, setConfirmIntent] = useState<"claim" | "send" | "template" | null>(null);
  const attachment = useAttachmentDraft(selectedId);
  const reply = useReplyDraft(selectedId);

  // A thread that is open on screen does not need a desk alert of its own.
  useOpenConversation(selectedId);

  // `?conv=<id>` — por ahí entran el aviso de traspaso y la notificación del
  // sistema. Es un efecto y no un estado inicial porque esta pantalla es la única
  // del agente: cuando el aviso llega, ya está montada.
  const convFromUrl = Number(new URLSearchParams(useSearch()).get("conv"));
  useEffect(() => {
    if (!Number.isInteger(convFromUrl) || convFromUrl <= 0) return;
    setSelectedId(convFromUrl);
    dismissHandoff(convFromUrl);
    // Consumido: si no, volver a pulsar el mismo aviso no abriría nada, y el chat
    // que el agente elija después quedaría contradicho por la URL.
    setLocation("/agent/chats", { replace: true });
  }, [convFromUrl, setLocation]);

  // No agentId filter here: this panel deliberately shows the whole operation.
  const convParams = {
    channel: channelFilter !== "all" ? (channelFilter as any) : undefined,
    status: statusFilter !== "all" ? (statusFilter as any) : undefined,
    read: readFilter !== "all" ? readFilter : undefined,
    search: debouncedSearch || undefined,
  };

  const { data: conversations, isLoading } = useListConversations(convParams, {
    query: {
      queryKey: getListConversationsQueryKey(convParams),
      // Mientras llega el resultado del filtro nuevo, la lista anterior sigue a
      // la vista en vez de vaciarse al spinner.
      placeholderData: keepPreviousData,
      refetchInterval: CONVERSATIONS_POLL_MS,
      refetchOnWindowFocus: true,
      staleTime: 0,
    },
  });

  const { data: messages, isLoading: msgsLoading } = useListMessages(selectedId!, {
    query: {
      enabled: !!selectedId,
      queryKey: getListMessagesQueryKey(selectedId!),
      refetchInterval: selectedId ? MESSAGES_POLL_MS : false,
      refetchOnWindowFocus: true,
      staleTime: 0,
    },
  });

  const { data: agents } = useListAgents();
  const claimConv = useClaimConversation();
  const sendMessage = useSendMessage();
  const markRead = useMarkConversationRead();

  const selectedConv = conversations?.find((c) => c.id === selectedId);
  const canSendFreeform = !selectedConv || selectedConv.messagingWindowOpen;
  const isMine = !!selectedConv && selectedConv.agentId === agentId;
  const assignedAgent = selectedConv?.agentId ? agents?.find((a) => a.id === selectedConv.agentId) : null;
  // El chat que atiende otra persona es el único que hay que tomar antes de
  // escribir. En el del bot, o en el que no es de nadie, se contesta directo: la
  // API lo reasigna en el mismo envío. Mientras la lista de agentes no ha
  // llegado no se sabe quién lo lleva, y se intenta: quien decide es la API, que
  // responde con el motivo si el chat era de un compañero.
  const heldByPerson = !!assignedAgent && assignedAgent.type !== "virtual" && assignedAgent.id !== agentId;

  const handleSelect = (conv: { id: number; agentId?: number | null; unreadCount: number }) => {
    setSelectedId(conv.id);
    // Los no leídos ajenos no se tocan: ese contador es de quien lleva el chat.
    // En los propios, abrirlos es el acuse que esperaba su aviso.
    if (conv.agentId !== agentId) return;
    dismissHandoff(conv.id);
    if (conv.unreadCount > 0) {
      markRead.mutate(
        { id: conv.id },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }) },
      );
    }
  };

  // Contestar es quedarse con el chat: la API se lo asigna a quien escribe, así
  // que desde aquí se responde sin pasar antes por "Tomar".
  const send = () => {
    if (!selectedId) return;
    // El chat llega a sus manos por la misma vía que un traspaso, pero anunciarle
    // el que se acaba de dar él mismo sería absurdo.
    muteHandoff(selectedId);
    const onSent = () => {
      queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(selectedId) });
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      setMessageText("");
      reply.clear();
      // Ya es suyo y acaba de leerlo para contestar.
      if ((selectedConv?.unreadCount ?? 0) > 0) {
        markRead.mutate(
          { id: selectedId },
          { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }) },
        );
      }
    };
    // Con un archivo adjunto, lo escrito viaja como su pie.
    if (attachment.file) {
      attachment.send(messageText, onSent, reply.replyTo?.id);
      return;
    }
    if (!messageText.trim()) return;
    sendMessage.mutate(
      {
        conversationId: selectedId,
        data: { content: messageText, type: "text", replyToMessageId: reply.replyTo?.id },
      },
      {
        onSuccess: onSent,
        onError: (err: unknown) =>
          toast({
            title: "No se pudo enviar el mensaje",
            description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
            variant: "destructive",
          }),
      },
    );
  };

  const claim = (then?: () => void) => {
    if (!selectedId) return;
    muteHandoff(selectedId);
    claimConv.mutate(
      { id: selectedId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(selectedId) });
          setConfirmIntent(null);
          if (then) {
            then();
            return;
          }
          toast({
            title: "Chat tomado",
            description: `${selectedConv?.contactName ?? "La conversación"} ahora es tuyo.`,
          });
        },
        onError: (err: unknown) => {
          setConfirmIntent(null);
          toast({
            title: "No se pudo tomar el chat",
            description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleSend = () => {
    if (!selectedConv) return;
    if (!messageText.trim() && !attachment.file) return;
    // Quitarle el chat a un compañero merece una confirmación, se haga con el
    // botón o escribiendo en él.
    if (heldByPerson) {
      setConfirmIntent("send");
      return;
    }
    send();
  };

  // Mandar la plantilla también le quita el chat a quien lo lleve: misma
  // confirmación que al escribir, y el modal se abre ya con el chat tomado.
  const handleOpenTemplates = () => {
    if (!selectedConv) return;
    if (heldByPerson) {
      setConfirmIntent("template");
      return;
    }
    setTemplateModalOpen(true);
  };

  const handleClaimClick = () => {
    if (!selectedConv) return;
    if (heldByPerson) {
      setConfirmIntent("claim");
      return;
    }
    claim();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const threadRef = useChatScroll(selectedId, messages?.length ?? 0);

  return (
    <AgentLayout>
      <div className="flex h-full">
        {/* Left pane — every conversation in the operation */}
        <div className={cn("w-full md:w-80 md:flex-shrink-0 border-r border-border flex-col bg-card/30", selectedConv ? "hidden md:flex" : "flex")}>
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-bold text-foreground">Chat General</h2>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">Todas las conversaciones · si contestas, el chat pasa a ti</p>
            <div className="flex items-stretch gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="search"
                  placeholder="Buscar..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  data-testid="input-search-agent-chats"
                />
              </div>
              <ReadFilterMenu value={readFilter} onChange={setReadFilter} testId="agent-chats-read" />
            </div>
          </div>

          <div className="flex gap-1 p-2 border-b border-border overflow-x-auto">
            {CHANNEL_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setChannelFilter(tab)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors",
                  channelFilter === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
                data-testid={`agent-chats-channel-${tab}`}
              >
                {CHANNEL_LABELS[tab]}
              </button>
            ))}
          </div>

          <div className="flex gap-1 p-2 border-b border-border overflow-x-auto">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors",
                  statusFilter === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
                data-testid={`agent-chats-status-${tab}`}
              >
                {tab === "all" ? "Todos" : STATUS_LABELS[tab]}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : (conversations ?? []).length === 0 ? (
              <div className="p-8 text-center">
                <MessageSquare className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No hay conversaciones con estos filtros</p>
              </div>
            ) : (
              (conversations ?? []).map((conv) => {
                const Icon = CHANNEL_ICONS[conv.channel];
                const mine = conv.agentId === agentId;
                return (
                  <button
                    key={conv.id}
                    onClick={() => handleSelect(conv)}
                    className={cn(
                      "w-full text-left px-3 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors",
                      selectedId === conv.id ? "bg-primary/10 border-l-2 border-l-primary" : "",
                    )}
                    data-testid={`agent-chats-conv-${conv.id}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <ContactAvatar
                        name={conv.contactName}
                        avatar={conv.contactAvatar}
                        className="w-9 h-9 bg-gradient-to-br from-muted to-muted/60 text-xs font-bold text-foreground"
                      >
                        {Icon && (
                          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-card flex items-center justify-center">
                            <Icon className={cn("w-2.5 h-2.5", CHANNEL_COLORS[conv.channel])} />
                          </div>
                        )}
                      </ContactAvatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground truncate">{conv.contactName}</span>
                          <span className="text-[10px] text-muted-foreground">{timeAgo(conv.updatedAt)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="text-[10px] text-muted-foreground truncate flex-1">{conv.lastMessage ?? "Sin mensajes"}</p>
                          {conv.unreadCount > 0 && (
                            <span className="w-4 h-4 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center flex-shrink-0">
                              {conv.unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          <span className={cn("inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full", STATUS_STYLES[conv.status])}>
                            {STATUS_LABELS[conv.status]}
                          </span>
                          <span
                            className={cn(
                              "inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full",
                              mine
                                ? "bg-primary/15 text-primary"
                                : conv.agentName
                                  ? "bg-muted text-muted-foreground"
                                  : "bg-orange-100 text-orange-700",
                            )}
                          >
                            {mine ? "Mío" : (conv.agentName ?? "Sin asignar")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right pane — read-only thread */}
        {selectedConv ? (
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3 bg-card/50">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => setSelectedId(null)}
                  className="md:hidden p-1.5 -ml-1 rounded-lg text-muted-foreground hover:bg-muted"
                  data-testid="button-back-agent-chats"
                  aria-label="Volver"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <ContactAvatar
                  name={selectedConv.contactName}
                  avatar={selectedConv.contactAvatar}
                  className="w-10 h-10 bg-gradient-to-br from-primary to-accent text-sm font-bold text-primary-foreground"
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{selectedConv.contactName}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{maskPhone(selectedConv.contactPhone)}</span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <UserCheck className="w-3 h-3" />
                      {isMine ? "Asignado a ti" : (assignedAgent?.name ?? selectedConv.agentName ?? "Sin asignar")}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={cn("text-[10px] font-medium px-2 py-1 rounded-full", STATUS_STYLES[selectedConv.status])}>
                  {STATUS_LABELS[selectedConv.status]}
                </span>
                {isMine && <SaleTrackingButton conversation={selectedConv} />}
                <OrderBadge order={selectedConv.activeOrder} />
                {/* Tomarlo sin escribir sigue estando: sirve para reservarlo antes de
                    ponerse a redactar. Contestar hace lo mismo por su cuenta. */}
                {!isMine && (
                  <button
                    onClick={handleClaimClick}
                    disabled={claimConv.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition-colors shadow-sm disabled:opacity-40"
                    data-testid="button-claim-chat"
                  >
                    <HandGrab className="w-3.5 h-3.5" /> Tomar chat
                  </button>
                )}
              </div>
            </div>

            <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-3 md:px-10 space-y-1.5 chat-wallpaper">
              {msgsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
                      <div className={`h-10 rounded-xl animate-pulse ${i % 2 === 0 ? "bg-muted w-48" : "bg-primary/30 w-40"}`} />
                    </div>
                  ))}
                </div>
              ) : (
                <ChatMessages messages={messages ?? []} editable onReply={reply.start} />
              )}
            </div>

            {/* Se contesta desde aquí, sea de quien sea el chat: esta es la única
                pantalla del agente. */}
            <div className="chat-bar px-3 py-2.5 border-t border-border">
              {!canSendFreeform && (
                <WindowClosedNotice channel={selectedConv.channel} onOpenTemplates={handleOpenTemplates} />
              )}
              {reply.replyTo && (
                <ReplyChip msg={reply.replyTo} onCancel={reply.clear} disabled={sendMessage.isPending || attachment.sending} />
              )}
              {attachment.file && (
                <AttachmentChip file={attachment.file} onRemove={attachment.clear} disabled={attachment.sending} />
              )}
              {!isMine && (
                <p className="mb-1.5 px-1 text-[10px] text-muted-foreground" data-testid="text-takeover-hint">
                  {heldByPerson
                    ? `Lo atiende ${assignedAgent?.name ?? "otro agente"}: al enviar te lo quedas tú.`
                    : "Al responder, el chat pasa a ti."}
                </p>
              )}
              <div className="flex items-end gap-2 bg-white rounded-lg pl-2 pr-3 py-2.5">
                <AttachButton onPick={attachment.pick} disabled={attachment.sending || !canSendFreeform} />
                <textarea
                  ref={reply.inputRef}
                  placeholder={
                    !canSendFreeform
                      ? "Envía una plantilla para reabrir la conversación…"
                      : attachment.file
                        ? "Añade un pie (opcional)..."
                        : "Escribe tu respuesta..."
                  }
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={attachment.onPaste}
                  disabled={!canSendFreeform}
                  rows={1}
                  className="flex-1 bg-transparent text-sm text-foreground resize-none focus:outline-none disabled:cursor-not-allowed"
                  style={{ maxHeight: "120px" }}
                  data-testid="textarea-agent-chats-message"
                />
                <button
                  onClick={handleSend}
                  disabled={
                    !canSendFreeform ||
                    (!messageText.trim() && !attachment.file) ||
                    sendMessage.isPending ||
                    attachment.sending ||
                    claimConv.isPending
                  }
                  className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary hover:bg-primary/90 flex items-center justify-center disabled:opacity-40 transition-colors shadow-md shadow-primary/20"
                  data-testid="button-send-agent-chats"
                >
                  <Send className="w-4 h-4 text-primary-foreground" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5 px-1">Enter para enviar · Shift+Enter para nueva línea</p>
            </div>
            {selectedId != null && (
              <TemplateSendDialog
                conversationId={selectedId}
                open={templateModalOpen}
                onOpenChange={setTemplateModalOpen}
              />
            )}
          </div>
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center bg-muted/20">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">Panel general de conversaciones</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Abre cualquier chat del equipo y contéstalo: al responder pasa a estar a tu nombre
              </p>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={confirmIntent !== null} onOpenChange={(open) => !open && setConfirmIntent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Tomar este chat?</AlertDialogTitle>
            <AlertDialogDescription>
              La conversación con {selectedConv?.contactName ?? "este contacto"} la está atendiendo{" "}
              <strong>{assignedAgent?.name ?? selectedConv?.agentName ?? "otro agente"}</strong>.{" "}
              {confirmIntent === "claim"
                ? "Si lo tomas, pasará a tu nombre y se registrará el cambio en el hilo."
                : confirmIntent === "template"
                  ? "Si envías una plantilla, el chat pasará a tu nombre y se registrará el cambio en el hilo."
                  : "Si envías tu respuesta, el chat pasará a tu nombre y se registrará el cambio en el hilo."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-claim">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                claim(
                  confirmIntent === "send"
                    ? send
                    : confirmIntent === "template"
                      ? () => setTemplateModalOpen(true)
                      : undefined,
                )
              }
              disabled={claimConv.isPending}
              data-testid="button-confirm-claim"
            >
              {claimConv.isPending
                ? "Tomando..."
                : confirmIntent === "send"
                  ? "Sí, tomar y responder"
                  : confirmIntent === "template"
                    ? "Sí, tomar y elegir plantilla"
                    : "Sí, tomar chat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AgentLayout>
  );
}
