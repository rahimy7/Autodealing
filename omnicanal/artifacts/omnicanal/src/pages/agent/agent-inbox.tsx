import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import {
  useListConversations,
  useListMessages,
  useSendMessage,
  useResolveConversation,
  useMarkConversationRead,
  getListConversationsQueryKey,
  getListMessagesQueryKey,
} from "@workspace/api-client-react";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Send, Bot, CheckCircle, Search, MessageSquare, ArrowLeft } from "lucide-react";
import { ReadFilterMenu, type ReadFilter } from "@/components/ReadFilterMenu";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import AgentLayout from "@/components/layout/AgentLayout";
import ContactAvatar from "@/components/ContactAvatar";
import ChatMessages from "@/components/ChatMessages";
import { useChatScroll } from "@/hooks/use-chat-scroll";
import { AttachButton, AttachmentChip, useAttachmentDraft } from "@/components/Attachments";
import { ReplyChip, useReplyDraft } from "@/components/Reply";
import { WindowClosedNotice, TemplateSendDialog } from "@/components/MessagingWindow";
import { SaleTrackingButton } from "@/components/SaleTracking";
import { OrderBadge } from "@/components/OrderBadge";
import { useAuth } from "@/lib/auth";
import { useOpenConversation } from "@/lib/notifications";
import { dismissHandoff } from "@/lib/handoffs";
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

const STATUS_TABS = ["all", "open", "pending", "resolved"] as const;

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

export default function AgentInbox() {
  const { user } = useAuth();
  const agentId = user?.agentId;

  // `?conv=<id>` deep link — used when a chat is taken from the general panel.
  const searchString = useSearch();
  const convFromUrl = Number(new URLSearchParams(searchString).get("conv"));

  const [selectedId, setSelectedId] = useState<number | null>(
    Number.isInteger(convFromUrl) && convFromUrl > 0 ? convFromUrl : null,
  );
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
  const attachment = useAttachmentDraft(selectedId);
  const reply = useReplyDraft(selectedId);

  // A thread that is open on screen does not need a desk alert of its own.
  useOpenConversation(selectedId);

  const queryClient = useQueryClient();

  const convParams = {
    agentId: agentId ?? undefined,
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

  const sendMessage = useSendMessage();
  const resolveConv = useResolveConversation();
  const markRead = useMarkConversationRead();

  const selectedConv = conversations?.find((c) => c.id === selectedId);
  const canSendFreeform = !selectedConv || selectedConv.messagingWindowOpen;

  const handleSelect = (conv: { id: number; unreadCount: number }) => {
    setSelectedId(conv.id);
    // Reading the chat is the acknowledgement its ribbon was waiting for.
    dismissHandoff(conv.id);
    if (conv.unreadCount > 0) {
      markRead.mutate(
        { id: conv.id },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }) },
      );
    }
  };

  const handleSend = () => {
    if (!selectedId) return;
    const onSent = () => {
      queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(selectedId) });
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      setMessageText("");
      reply.clear();
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
      { onSuccess: onSent },
    );
  };

  const handleResolve = () => {
    if (!selectedId) return;
    resolveConv.mutate(
      { id: selectedId },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }),
      },
    );
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
        {/* Left pane */}
        <div className={cn("w-full md:w-80 md:flex-shrink-0 border-r border-border flex-col bg-card/30", selectedConv ? "hidden md:flex" : "flex")}>
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-bold text-foreground mb-3">Mis Conversaciones</h2>
            <div className="flex items-stretch gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="search"
                  placeholder="Buscar..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  data-testid="input-search-agent-inbox"
                />
              </div>
              <ReadFilterMenu value={readFilter} onChange={setReadFilter} testId="agent-filter-read" />
            </div>
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
                data-testid={`agent-filter-${tab}`}
              >
                {tab === "all" ? "Todos" : STATUS_LABELS[tab]}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : (conversations ?? []).length === 0 ? (
              <div className="p-8 text-center">
                <MessageSquare className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No tienes conversaciones asignadas</p>
              </div>
            ) : (
              (conversations ?? []).map((conv) => {
                const Icon = CHANNEL_ICONS[conv.channel];
                return (
                  <button
                    key={conv.id}
                    onClick={() => handleSelect(conv)}
                    className={cn(
                      "w-full text-left px-3 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors",
                      selectedId === conv.id ? "bg-primary/10 border-l-2 border-l-primary" : "",
                    )}
                    data-testid={`agent-conv-${conv.id}`}
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
                          <span className="text-[10px] text-muted-foreground truncate flex-1">{conv.lastMessage ?? "Sin mensajes"}</span>
                          {conv.unreadCount > 0 && (
                            <span className="w-4 h-4 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center">
                              {conv.unreadCount}
                            </span>
                          )}
                        </div>
                        <span className={cn("inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full mt-1", STATUS_STYLES[conv.status])}>
                          {STATUS_LABELS[conv.status]}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right pane */}
        {selectedConv ? (
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-card/50">
              <div className="flex items-center gap-3">
                <button onClick={() => setSelectedId(null)} className="md:hidden p-1.5 -ml-1 rounded-lg text-muted-foreground hover:bg-muted" data-testid="button-back-agent-list" aria-label="Volver">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <ContactAvatar
                  name={selectedConv.contactName}
                  avatar={selectedConv.contactAvatar}
                  className="w-10 h-10 bg-gradient-to-br from-primary to-accent text-sm font-bold text-primary-foreground"
                />
                <div>
                  <div className="text-sm font-semibold text-foreground">{selectedConv.contactName}</div>
                  <div className="text-xs text-muted-foreground">{maskPhone(selectedConv.contactPhone)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("text-[10px] font-medium px-2 py-1 rounded-full", STATUS_STYLES[selectedConv.status])}>
                  {STATUS_LABELS[selectedConv.status]}
                </span>
                <SaleTrackingButton conversation={selectedConv} />
                <OrderBadge order={selectedConv.activeOrder} />
                {selectedConv.status !== "resolved" && (
                  <button
                    onClick={handleResolve}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white text-xs font-medium transition-colors shadow-sm"
                    data-testid="button-resolve-agent"
                  >
                    <CheckCircle className="w-3.5 h-3.5" /> Resolver
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

            <div className="chat-bar px-3 py-2.5 border-t border-border">
              {!canSendFreeform && selectedConv && (
                <WindowClosedNotice channel={selectedConv.channel} onOpenTemplates={() => setTemplateModalOpen(true)} />
              )}
              {reply.replyTo && (
                <ReplyChip msg={reply.replyTo} onCancel={reply.clear} disabled={sendMessage.isPending || attachment.sending} />
              )}
              {attachment.file && (
                <AttachmentChip file={attachment.file} onRemove={attachment.clear} disabled={attachment.sending} />
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
                  data-testid="textarea-agent-message"
                />
                <button
                  onClick={handleSend}
                  disabled={!canSendFreeform || (!messageText.trim() && !attachment.file) || sendMessage.isPending || attachment.sending}
                  className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary hover:bg-primary/90 flex items-center justify-center disabled:opacity-40 transition-colors shadow-md shadow-primary/20"
                  data-testid="button-send-agent"
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
              <p className="text-sm font-medium text-foreground">Selecciona una conversación</p>
              <p className="text-xs text-muted-foreground mt-1">Elige un chat para empezar a responder</p>
            </div>
          </div>
        )}
      </div>
    </AgentLayout>
  );
}
