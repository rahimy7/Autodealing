import { useContactTags } from "@/hooks/use-contact-tags";
import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { useListConversations, useListMessages, useListAgents, useListLabels, useListWhatsappNumbers, useSendMessage, useUpdateConversation, useAssignConversation, useResolveConversation, useEscalateConversation, useMarkConversationRead, getListConversationsQueryKey, getListMessagesQueryKey } from "@workspace/api-client-react";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Send, Bot, CheckCircle, UserCheck, Search, Filter, MessageSquare, Circle, ArrowRightCircle, Sparkles, User, Tag, ArrowLeft, MapPin, Phone, Package } from "lucide-react";
import { ReadFilterMenu, type ReadFilter } from "@/components/ReadFilterMenu";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import Layout from "@/components/layout/Layout";
import ChatMessages from "@/components/ChatMessages";
import { useChatScroll } from "@/hooks/use-chat-scroll";
import { AttachButton, AttachmentChip, useAttachmentDraft } from "@/components/Attachments";
import { ReplyChip, useReplyDraft } from "@/components/Reply";
import { WindowClosedNotice, TemplateSendDialog } from "@/components/MessagingWindow";
import { SaleTrackingButton } from "@/components/SaleTracking";
import { OrderBadge, ORDER_STATUS_LABELS } from "@/components/OrderBadge";
import ContactAvatar from "@/components/ContactAvatar";
import { useOpenConversation } from "@/lib/notifications";
import { useIncognito } from "@/lib/incognito";
import { cn } from "@/lib/utils";

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  whatsapp: (props) => <SiWhatsapp {...props} />,
  instagram: (props) => <SiInstagram {...props} />,
  facebook: (props) => <SiFacebook {...props} />,
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "text-[#25D366]",
  instagram: "text-[#E1306C]",
  facebook: "text-[#1877F2]",
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-500/15 text-blue-400",
  pending: "bg-yellow-500/15 text-yellow-400",
  bot: "bg-purple-100 text-purple-700",
  resolved: "bg-green-500/15 text-green-400",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Abierto",
  pending: "Pendiente",
  bot: "Bot",
  resolved: "Resuelto",
};

const TAG_STYLES: Record<string, string> = {
  jovenes: "bg-yellow-500/15 text-yellow-600",
  junta: "bg-purple-500/15 text-purple-600",
  visitas: "bg-orange-500/15 text-orange-600",
  miembros: "bg-green-500/15 text-green-600",
  lead: "bg-blue-500/10 text-blue-400/80",
  vip: "bg-yellow-500/10 text-yellow-400/80",
  in_process: "bg-purple-500/10 text-purple-400/80",
  support: "bg-red-500/10 text-red-400/80",
};


const CHANNEL_TABS = ["all", "whatsapp", "instagram", "facebook"] as const;
const STATUS_TABS = ["all", "open", "pending", "bot", "resolved"] as const;

const MESSAGES_POLL_MS = 3000;
const CONVERSATIONS_POLL_MS = 8000;

function timeAgo(date: string) {
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function InboxPage() {
  const { labels: TAG_LABELS } = useContactTags();
  // `?conv=<id>` deep link — how a desk notification opens the chat it is about.
  const searchString = useSearch();
  const convFromUrl = Number(new URLSearchParams(searchString).get("conv"));

  const [selectedId, setSelectedId] = useState<number | null>(
    Number.isInteger(convFromUrl) && convFromUrl > 0 ? convFromUrl : null,
  );
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  // Por cuál de nuestros números filtrar. Solo aparece cuando hay más de uno:
  // con un número el filtro no distingue nada y sería ruido en la barra.
  const [numberFilter, setNumberFilter] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  // La búsqueda sale al servidor cuando se deja de escribir, no con cada tecla.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [messageText, setMessageText] = useState("");
  const [sendAs, setSendAs] = useState<"agent" | "contact">("agent");
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const attachment = useAttachmentDraft(selectedId);
  const reply = useReplyDraft(selectedId);

  // A thread that is open on screen does not need a desk alert of its own.
  useOpenConversation(selectedId);

  const queryClient = useQueryClient();
  const { data: agents } = useListAgents();
  const { data: labels } = useListLabels();
  const updateConv = useUpdateConversation();

  const { data: whatsappNumbers } = useListWhatsappNumbers();
  const numbers = whatsappNumbers?.numbers ?? [];
  const showNumberFilter = numbers.length > 1;

  const convParams = {
    channel: channelFilter !== "all" ? channelFilter as any : undefined,
    status: statusFilter !== "all" ? statusFilter as any : undefined,
    whatsappNumberId: numberFilter !== "all" ? numberFilter : undefined,
    read: readFilter !== "all" ? readFilter : undefined,
    search: debouncedSearch || undefined,
  };

  const { data: conversations, isLoading: convsLoading } = useListConversations(convParams, {
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
  const escalateConv = useEscalateConversation();
  const assignConv = useAssignConversation();
  const markRead = useMarkConversationRead();
  const incognito = useIncognito();

  const handleSelect = (conv: { id: number; unreadCount: number }) => {
    setSelectedId(conv.id);
    // En incógnito se mira sin dejar acuse: el contador sigue para quien atiende.
    if (conv.unreadCount > 0 && !incognito) {
      markRead.mutate(
        { id: conv.id },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }) },
      );
    }
  };

  const selectedConv = conversations?.find(c => c.id === selectedId);
  const assignedAgent = selectedConv ? agents?.find(a => a.id === selectedConv.agentId) : null;
  const isVirtualAssigned = assignedAgent?.type === "virtual";
  // "Como cliente" simula un inbound: eso reabre la ventana en vez de necesitarla
  // abierta, así que no lo bloquea aunque la conversación real la tenga cerrada.
  const canSendFreeform = !selectedConv || selectedConv.messagingWindowOpen || sendAs === "contact";

  const refresh = () => {
    if (selectedId) queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(selectedId) });
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
  };

  const handleSend = () => {
    if (!selectedId) return;
    // Con un archivo adjunto, lo escrito viaja como su pie. Los adjuntos salen
    // siempre como agente: no hay simulación de un cliente que manda archivos.
    const onSent = () => {
      setMessageText("");
      reply.clear();
      refresh();
    };
    if (attachment.file) {
      attachment.send(messageText, onSent, reply.replyTo?.id);
      return;
    }
    if (!messageText.trim()) return;
    sendMessage.mutate(
      {
        conversationId: selectedId,
        data: { content: messageText, type: "text", sender: sendAs, replyToMessageId: reply.replyTo?.id },
      },
      { onSuccess: onSent },
    );
  };

  const handleResolve = () => {
    if (!selectedId) return;
    resolveConv.mutate({ id: selectedId }, { onSuccess: refresh });
  };

  const handleEscalate = () => {
    if (!selectedId) return;
    escalateConv.mutate({ id: selectedId }, { onSuccess: refresh });
  };

  const handleAssign = (agentId: number) => {
    if (!selectedId) return;
    assignConv.mutate({ id: selectedId, data: { agentId } }, { onSuccess: refresh });
  };

  const handleSetLabel = (labelId: number | null) => {
    if (!selectedId) return;
    updateConv.mutate({ id: selectedId, data: { labelId } }, { onSuccess: refresh });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const threadRef = useChatScroll(selectedId, messages?.length ?? 0);

  return (
    <Layout>
      <div className="flex h-full">
        {/* Left pane — conversation list */}
        <div className={cn("w-full md:w-80 md:flex-shrink-0 border-r border-border flex-col", selectedConv ? "hidden md:flex" : "flex")}>
          {/* Search */}
          <div className="p-3 border-b border-border">
            <div className="flex items-stretch gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="search"
                  placeholder="Buscar conversaciones..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted/40 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  data-testid="input-search-inbox"
                />
              </div>
              <ReadFilterMenu value={readFilter} onChange={setReadFilter} testId="filter-read" />
            </div>
          </div>

          {/* Channel filter */}
          <div className="flex border-b border-border">
            {CHANNEL_TABS.map((tab) => {
              const Icon = tab !== "all" ? CHANNEL_ICONS[tab] : null;
              return (
                <button
                  key={tab}
                  onClick={() => setChannelFilter(tab)}
                  className={cn("flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1", channelFilter === tab ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground")}
                  data-testid={`filter-channel-${tab}`}
                >
                  {Icon ? <Icon className={`w-3.5 h-3.5 ${CHANNEL_COLORS[tab]}`} /> : <MessageSquare className="w-3.5 h-3.5" />}
                  {tab === "all" ? "Todo" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              );
            })}
          </div>

          {/* Filtro por número receptor. Con un solo número no se muestra. */}
          {showNumberFilter && (
            <div className="flex gap-1 p-2 border-b border-border overflow-x-auto">
              <button
                onClick={() => setNumberFilter("all")}
                className={cn("px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap transition-colors flex-shrink-0 inline-flex items-center gap-1", numberFilter === "all" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}
                data-testid="filter-number-all"
              >
                <Phone className="w-2.5 h-2.5" /> Todos los números
              </button>
              {numbers.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setNumberFilter(n.id)}
                  className={cn("px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap transition-colors flex-shrink-0", numberFilter === n.id ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}
                  title={n.displayNumber ?? n.phoneNumberId}
                  data-testid={`filter-number-${n.id}`}
                >
                  {n.label || n.displayNumber || n.phoneNumberId}
                </button>
              ))}
            </div>
          )}

          {/* Status filter */}
          <div className="flex gap-1 p-2 border-b border-border overflow-x-auto">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={cn("px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap transition-colors flex-shrink-0", statusFilter === tab ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}
                data-testid={`filter-status-${tab}`}
              >
                {tab === "all" ? "Todos" : STATUS_LABELS[tab]}
              </button>
            ))}
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {convsLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                {(conversations ?? []).map((conv) => {
                  const Icon = CHANNEL_ICONS[conv.channel];
                  return (
                    <button
                      key={conv.id}
                      onClick={() => handleSelect(conv)}
                      className={cn("w-full text-left px-3 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors", selectedId === conv.id ? "bg-primary/10 border-l-2 border-l-primary" : "")}
                      data-testid={`conversation-item-${conv.id}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <ContactAvatar
                          name={conv.contactName}
                          avatar={conv.contactAvatar}
                          className="w-8 h-8 bg-muted text-xs font-bold text-foreground"
                        >
                          {Icon && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-background flex items-center justify-center">
                              <Icon className={`w-2.5 h-2.5 ${CHANNEL_COLORS[conv.channel]}`} />
                            </div>
                          )}
                        </ContactAvatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-foreground truncate">{conv.contactName ?? "Desconocido"}</span>
                            <span className="text-[10px] text-muted-foreground flex-shrink-0 ml-1">{timeAgo(conv.updatedAt)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-muted-foreground truncate flex-1">{conv.lastMessage ?? "Sin mensajes"}</span>
                            {conv.unreadCount > 0 && (
                              <span className="w-4 h-4 rounded-full bg-primary text-[9px] font-bold text-background flex items-center justify-center flex-shrink-0">{conv.unreadCount}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_STYLES[conv.status]}`}>{STATUS_LABELS[conv.status]}</span>
                            {conv.labelName ? (
                              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${conv.labelColor ?? "#14b8a6"}22`, color: conv.labelColor ?? "#14b8a6" }}>{conv.labelName}</span>
                            ) : conv.label ? (
                              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${TAG_STYLES[conv.label]}`}>{TAG_LABELS[conv.label]}</span>
                            ) : null}
                            {/* La sucursal a la que pertenece el cliente: es lo que
                                explica en qué equipo acabó la conversación. */}
                            {conv.localityName && (
                              <span
                                className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full"
                                style={{ backgroundColor: `${conv.localityColor ?? "#6366f1"}22`, color: conv.localityColor ?? "#6366f1" }}
                                title="Sucursal asignada según la zona del cliente"
                              >
                                <MapPin className="w-2 h-2" /> {conv.localityName.replace(/^Sucursal\s+/i, "")}
                              </span>
                            )}
                            {/* Por cuál de nuestros números entró. Solo se marca
                                cuando hay más de uno: con uno solo es evidente. */}
                            {showNumberFilter && conv.whatsappNumberLabel && (
                              <span
                                className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
                                title={`Recibido por ${conv.whatsappNumberDisplay ?? conv.whatsappNumberLabel}`}
                              >
                                <Phone className="w-2 h-2" /> {conv.whatsappNumberLabel}
                              </span>
                            )}
                            {/* Vista rápida: el detalle clicable está en el header
                                del chat (OrderBadge), no aquí — la fila entera ya
                                es un botón y no puede llevar otro adentro. */}
                            {conv.activeOrder && (
                              <span
                                className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/12 text-amber-600"
                                title={`${conv.activeOrder.code}${conv.activeOrder.product ? ` · ${conv.activeOrder.product}` : ""}`}
                              >
                                <Package className="w-2 h-2" /> {ORDER_STATUS_LABELS[conv.activeOrder.status]}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {(conversations ?? []).length === 0 && (
                  <div className="p-8 text-center">
                    <MessageSquare className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">Sin conversaciones</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right pane — message thread */}
        {selectedConv ? (
          // min-w-0: sin él, un elemento flexible no se encoge por debajo de su
          // contenido, y en el móvil el panel se salía de la pantalla.
          <div className="flex-1 flex flex-col min-w-0">
            {/* Conversation header */}
            <div className="px-4 sm:px-5 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap bg-card/50">
              <div className="flex items-center gap-3">
                <button onClick={() => setSelectedId(null)} className="md:hidden p-1.5 -ml-1 rounded-lg text-muted-foreground hover:bg-muted" data-testid="button-back-inbox-list" aria-label="Volver">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <ContactAvatar
                  name={selectedConv.contactName}
                  avatar={selectedConv.contactAvatar}
                  className="w-8 h-8 bg-primary/20 text-sm font-bold text-primary"
                />
                <div>
                  <div className="text-sm font-semibold text-foreground">{selectedConv.contactName ?? "Desconocido"}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {selectedConv.contactPhone && <span>{selectedConv.contactPhone}</span>}
                    {selectedConv.agentName && <span>· {selectedConv.agentName}</span>}
                    {/* Por dónde va a salir lo que se escriba aquí. Con varios
                        números el agente necesita verlo antes de contestar, no
                        después. */}
                    {showNumberFilter && selectedConv.whatsappNumberLabel && (
                      <span
                        className="inline-flex items-center gap-1 text-[11px]"
                        title={`Las respuestas salen por ${selectedConv.whatsappNumberDisplay ?? selectedConv.whatsappNumberLabel}`}
                      >
                        · <Phone className="w-3 h-3" /> {selectedConv.whatsappNumberLabel}
                        {selectedConv.whatsappNumberDisplay ? ` · ${selectedConv.whatsappNumberDisplay}` : ""}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className={cn(
                    "flex items-center gap-1 pl-2 pr-1 py-1 rounded-full",
                    !assignedAgent
                      ? "bg-muted text-muted-foreground"
                      : isVirtualAssigned
                        ? "bg-purple-100 text-purple-700"
                        : "bg-blue-100 text-blue-700",
                  )}
                  title="Asignar o reasignar la conversación a un agente"
                >
                  {isVirtualAssigned ? <Sparkles className="w-3 h-3 flex-shrink-0" /> : <User className="w-3 h-3 flex-shrink-0" />}
                  <select
                    value={selectedConv.agentId ?? ""}
                    onChange={(e) => e.target.value && handleAssign(Number(e.target.value))}
                    disabled={assignConv.isPending}
                    className="bg-transparent text-[10px] font-medium focus:outline-none cursor-pointer max-w-[140px] disabled:opacity-50"
                    data-testid="select-assign-agent"
                  >
                    <option value="" disabled>
                      Asignar agente…
                    </option>
                    {(agents ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.type === "virtual" ? "🤖" : "👤"} {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${STATUS_STYLES[selectedConv.status]}`}>{STATUS_LABELS[selectedConv.status]}</span>
                <div
                  className="flex items-center gap-1 pl-2 pr-1 py-1 rounded-full bg-muted text-muted-foreground"
                  title="Etiqueta de intención del cliente"
                  style={selectedConv.labelColor ? { backgroundColor: `${selectedConv.labelColor}22`, color: selectedConv.labelColor } : undefined}
                >
                  <Tag className="w-3 h-3 flex-shrink-0" />
                  <select
                    value={selectedConv.labelId ?? ""}
                    onChange={(e) => handleSetLabel(e.target.value ? Number(e.target.value) : null)}
                    disabled={updateConv.isPending}
                    className="bg-transparent text-[10px] font-medium focus:outline-none cursor-pointer max-w-[120px] disabled:opacity-50"
                    data-testid="select-conversation-label"
                  >
                    <option value="">Sin etiqueta</option>
                    {(labels ?? []).map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
                {assignedAgent?.escalateToAgentId && (
                  <button
                    onClick={handleEscalate}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-600 text-xs font-medium hover:bg-amber-500/25 transition-colors"
                    data-testid="button-escalate-conversation"
                    title="Escalar al agente configurado"
                  >
                    <ArrowRightCircle className="w-3.5 h-3.5" /> Escalar
                  </button>
                )}
                <SaleTrackingButton conversation={selectedConv} />
                <OrderBadge order={selectedConv.activeOrder} />
                {selectedConv.status !== "resolved" && (
                  <button
                    onClick={handleResolve}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs font-medium hover:bg-green-500/25 transition-colors"
                    data-testid="button-resolve-conversation"
                  >
                    <CheckCircle className="w-3.5 h-3.5" /> Resolver
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-3 md:px-10 space-y-1.5 chat-wallpaper">
              {msgsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
                      <div className={`h-10 rounded-xl animate-pulse ${i % 2 === 0 ? "bg-muted/50 w-48" : "bg-primary/20 w-40"}`} />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <ChatMessages messages={messages ?? []} editable onReply={reply.start} />
                  {(messages ?? []).length === 0 && (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-sm text-muted-foreground">No hay mensajes en esta conversación</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Message input */}
            <div className="chat-bar px-3 py-2.5 border-t border-border">
              {!canSendFreeform && (
                <WindowClosedNotice channel={selectedConv.channel} onOpenTemplates={() => setTemplateModalOpen(true)} />
              )}
              {isVirtualAssigned && (
                <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-purple-50 border border-purple-200">
                  <Sparkles className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" />
                  <span className="text-[11px] text-purple-700 flex-1">
                    Conversación con IA. Prueba el agente enviando como cliente:
                  </span>
                  <div className="flex gap-1 bg-card rounded-lg p-0.5">
                    <button
                      onClick={() => setSendAs("agent")}
                      className={cn("px-2 py-0.5 rounded text-[10px] font-medium transition-colors", sendAs === "agent" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                      data-testid="send-as-agent"
                    >
                      Como agente
                    </button>
                    <button
                      onClick={() => setSendAs("contact")}
                      className={cn("px-2 py-0.5 rounded text-[10px] font-medium transition-colors", sendAs === "contact" ? "bg-purple-500 text-white" : "text-muted-foreground")}
                      data-testid="send-as-contact"
                    >
                      Como cliente
                    </button>
                  </div>
                </div>
              )}
              {reply.replyTo && (
                <ReplyChip msg={reply.replyTo} onCancel={reply.clear} disabled={sendMessage.isPending || attachment.sending} />
              )}
              {attachment.file && (
                <AttachmentChip file={attachment.file} onRemove={attachment.clear} disabled={attachment.sending} />
              )}
              <div className={cn("flex items-end gap-2 bg-white rounded-lg py-2.5", sendAs === "agent" ? "pl-2 pr-3" : "px-4")}>
                {sendAs === "agent" && (
                  <AttachButton onPick={attachment.pick} disabled={attachment.sending || !canSendFreeform} />
                )}
                <textarea
                  ref={reply.inputRef}
                  placeholder={
                    !canSendFreeform
                      ? "Envía una plantilla para reabrir la conversación…"
                      : attachment.file
                        ? "Añade un pie (opcional)..."
                        : "Escribe un mensaje..."
                  }
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={sendAs === "agent" ? attachment.onPaste : undefined}
                  disabled={!canSendFreeform}
                  rows={1}
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none disabled:cursor-not-allowed"
                  style={{ maxHeight: "120px" }}
                  data-testid="textarea-message-input"
                />
                <button
                  onClick={handleSend}
                  disabled={!canSendFreeform || (!messageText.trim() && !attachment.file) || sendMessage.isPending || attachment.sending}
                  className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary flex items-center justify-center disabled:opacity-40 hover:bg-primary/80 transition-colors"
                  data-testid="button-send-message"
                >
                  <Send className="w-3.5 h-3.5 text-background" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-1.5 px-1">Enter para enviar · Shift+Enter para nueva línea</p>
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
          <div className="hidden md:flex flex-1 items-center justify-center">
            <div className="text-center">
              <MessageSquare className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground">Selecciona una conversación</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Elige un chat de la lista para ver los mensajes</p>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
