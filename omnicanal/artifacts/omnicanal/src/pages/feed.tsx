import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListFeedThreads,
  useGetFeedThread,
  useReplyFeedThread,
  usePublishFeedDraft,
  useRegenerateFeedDraft,
  useDeleteFeedDraft,
  useMigrateFeedThread,
  useResolveFeedThread,
  useReopenFeedThread,
  useMarkFeedThreadRead,
  getListFeedThreadsQueryKey,
  getGetFeedThreadQueryKey,
  type FeedThread,
  type FeedComment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  MessageCircle,
  ArrowRightCircle,
  CheckCircle,
  RotateCcw,
  RefreshCw,
  Trash2,
  Send,
  ExternalLink,
  Globe,
  Lock,
  ArrowLeft,
  Sparkles,
  Bot,
} from "lucide-react";
import { SiInstagram, SiFacebook } from "react-icons/si";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useIncognito } from "@/lib/incognito";
import { cn } from "@/lib/utils";

// ── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  facebook: (p) => <SiFacebook {...p} />,
  instagram: (p) => <SiInstagram {...p} />,
};
const CHANNEL_COLOR: Record<string, string> = {
  facebook: "text-[#1877F2]",
  instagram: "text-[#E1306C]",
};
const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  open: { label: "Abierto", cls: "bg-blue-500/15 text-blue-400" },
  resolved: { label: "Resuelto", cls: "bg-green-500/15 text-green-400" },
  migrated: { label: "Migrado a DM", cls: "bg-purple-500/15 text-purple-400" },
};

const THREAD_POLL_MS = 10_000;
const LIST_POLL_MS = 15_000;

function timeAgo(date: string | null | undefined) {
  if (!date) return "";
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

// ── Thread list item ──────────────────────────────────────────────────────────

function ThreadItem({
  thread,
  selected,
  onClick,
}: {
  thread: FeedThread;
  selected: boolean;
  onClick: () => void;
}) {
  const ChanIcon = CHANNEL_ICON[thread.channel] ?? (() => null);
  const chip = STATUS_CHIP[thread.status] ?? STATUS_CHIP.open;
  const caption = thread.post?.caption ?? null;
  const mediaUrl = thread.post?.mediaUrl ?? null;

  return (
    <button
      onClick={onClick}
      data-testid={`feed-thread-${thread.id}`}
      className={cn(
        "w-full text-left px-4 py-3 flex gap-3 border-b border-border transition-colors",
        selected ? "bg-primary/10" : "hover:bg-accent/50",
      )}
    >
      {/* Post thumbnail */}
      <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-card border border-border overflow-hidden flex items-center justify-center">
        {mediaUrl ? (
          <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <ChanIcon className={cn("w-5 h-5", CHANNEL_COLOR[thread.channel])} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <ChanIcon className={cn("w-3 h-3 flex-shrink-0", CHANNEL_COLOR[thread.channel])} />
          <span className="text-xs font-medium text-foreground truncate">
            {thread.contactName ?? "Cliente"}
          </span>
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0", chip.cls)}>
            {chip.label}
          </span>
          {thread.unreadCount > 0 && (
            <span className="ml-auto flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {thread.unreadCount}
            </span>
          )}
        </div>
        {/* Caption preview */}
        {caption && (
          <p className="text-[11px] text-muted-foreground truncate mt-0.5 italic">
            "{caption.slice(0, 60)}{caption.length > 60 ? "…" : ""}"
          </p>
        )}
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {thread.lastComment ?? "—"}
        </p>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">
          {timeAgo(thread.lastCommentAt)}
          {thread.labelName && (
            <span
              className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px]"
              style={{ background: `${thread.labelColor ?? "#14b8a6"}20`, color: thread.labelColor ?? "#14b8a6" }}
            >
              {thread.labelName}
            </span>
          )}
        </p>
      </div>
    </button>
  );
}

// ── Comment bubble ────────────────────────────────────────────────────────────

function CommentBubble({ comment }: { comment: FeedComment & { authorAgentName?: string | null } }) {
  if (comment.isInternal) {
    return (
      <div className="flex justify-center my-1">
        <span className="text-[11px] text-muted-foreground/60 italic px-2">{comment.content}</span>
      </div>
    );
  }

  const isIn = comment.direction === "in";
  const isPrivate = comment.delivery === "private_reply";
  const isDraft = comment.isDraft;

  return (
    <div className={cn("flex", isIn ? "justify-start" : "justify-end")}>
      <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", isIn ? "bg-card border border-border text-foreground" : isDraft ? "bg-amber-500/10 border border-amber-500/30 text-amber-200" : "bg-primary/15 text-foreground")}>
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          {isIn ? (
            <span className="text-[11px] font-semibold text-muted-foreground">{comment.authorName ?? "Cliente"}</span>
          ) : (
            <>
              {comment.isAiSuggestion && <Bot className="w-3 h-3 text-primary flex-shrink-0" />}
              <span className="text-[11px] font-semibold text-muted-foreground">
                {comment.authorAgentName ?? "Agente"}
              </span>
            </>
          )}
          {isPrivate && (
            <span className="text-[10px] flex items-center gap-0.5 text-purple-400">
              <Lock className="w-2.5 h-2.5" /> privado
            </span>
          )}
          {!isIn && !isPrivate && !isDraft && (
            <span className="text-[10px] flex items-center gap-0.5 text-muted-foreground/60">
              <Globe className="w-2.5 h-2.5" /> público
            </span>
          )}
          {isDraft && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">
              Borrador IA
            </span>
          )}
        </div>
        {comment.content}
        <p className="text-[10px] text-right mt-1 text-muted-foreground/50">
          {comment.publishedAt ? timeAgo(comment.publishedAt) : timeAgo(comment.createdAt)}
        </p>
      </div>
    </div>
  );
}

// ── Thread detail panel ───────────────────────────────────────────────────────

function ThreadDetail({ threadId, onBack }: { threadId: number; onBack: () => void }) {
  const [replyText, setReplyText] = useState("");
  const [replyMode, setReplyMode] = useState<"both" | "public_only" | "private_only">("both");
  const [migrateText, setMigrateText] = useState("");
  const [migrateOpen, setMigrateOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data, isLoading } = useGetFeedThread(threadId, {
    query: { queryKey: getGetFeedThreadQueryKey(threadId), refetchInterval: THREAD_POLL_MS, staleTime: 0 },
  });
  const thread = data?.thread;
  const comments = data?.comments ?? [];

  const invalidateThread = () => {
    queryClient.invalidateQueries({ queryKey: getGetFeedThreadQueryKey(threadId) });
    queryClient.invalidateQueries({ queryKey: getListFeedThreadsQueryKey() });
  };

  const reply = useReplyFeedThread();
  const publishDraft = usePublishFeedDraft();
  const regenerateDraft = useRegenerateFeedDraft();
  const deleteDraft = useDeleteFeedDraft();
  const migrate = useMigrateFeedThread();
  const resolve = useResolveFeedThread();
  const reopen = useReopenFeedThread();
  const markRead = useMarkFeedThreadRead();
  const incognito = useIncognito();

  const handleSend = () => {
    if (!replyText.trim()) return;
    reply.mutate(
      { id: threadId, data: { content: replyText.trim(), mode: replyMode } },
      {
        onSuccess: () => {
          setReplyText("");
          invalidateThread();
          toast({ title: "Respuesta enviada" });
        },
        onError: () => toast({ title: "Error al enviar a Meta", variant: "destructive" }),
      },
    );
  };

  const handlePublishDraft = (commentId: number) => {
    publishDraft.mutate(
      { commentId, data: { alsoPrivate: true } },
      {
        onSuccess: () => { invalidateThread(); toast({ title: "Borrador publicado" }); },
        onError: () => toast({ title: "Error al publicar en Meta", variant: "destructive" }),
      },
    );
  };

  const handleRegenerateDraft = (commentId: number) => {
    regenerateDraft.mutate(
      { commentId },
      { onSuccess: () => { invalidateThread(); toast({ title: "Borrador regenerado" }); } },
    );
  };

  const handleDeleteDraft = (commentId: number) => {
    deleteDraft.mutate(
      { commentId },
      { onSuccess: () => { invalidateThread(); toast({ title: "Borrador descartado" }); } },
    );
  };

  const handleMigrate = () => {
    if (!migrateText.trim()) return;
    migrate.mutate(
      { id: threadId, data: { message: migrateText.trim() } },
      {
        onSuccess: (res) => {
          setMigrateOpen(false);
          setMigrateText("");
          invalidateThread();
          toast({ title: "Migrado a chat privado" });
          if (res.conversationId) setLocation(`/inbox`);
        },
        onError: () => toast({ title: "Error al migrar a DM", variant: "destructive" }),
      },
    );
  };

  const handleResolve = () =>
    resolve.mutate(
      { id: threadId },
      { onSuccess: () => { invalidateThread(); toast({ title: "Hilo resuelto" }); } },
    );

  const handleReopen = () =>
    reopen.mutate(
      { id: threadId },
      { onSuccess: () => { invalidateThread(); toast({ title: "Hilo reabierto" }); } },
    );

  // Mark as read on open — unless the admin is reading in incognito mode.
  useState(() => {
    if (thread?.unreadCount && thread.unreadCount > 0 && !incognito) {
      markRead.mutate({ id: threadId }, { onSuccess: invalidateThread });
    }
  });

  if (isLoading || !thread) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const ChanIcon = CHANNEL_ICON[thread.channel] ?? (() => null);
  const chip = STATUS_CHIP[thread.status] ?? STATUS_CHIP.open;
  const isOpen = thread.status === "open";
  const hasDraft = comments.some((c) => c.isDraft);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50 flex-shrink-0">
        <button onClick={onBack} className="md:hidden p-1 -ml-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <ChanIcon className={cn("w-4 h-4 flex-shrink-0", CHANNEL_COLOR[thread.channel])} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {thread.contactName ?? "Cliente"}
          </p>
          {thread.post?.caption && (
            <p className="text-xs text-muted-foreground truncate italic">
              "{thread.post.caption.slice(0, 80)}{thread.post.caption.length > 80 ? "…" : ""}"
            </p>
          )}
        </div>
        <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0", chip.cls)}>
          {chip.label}
        </span>
        {thread.post?.permalink && (
          <a href={thread.post.permalink} target="_blank" rel="noopener noreferrer" className="p-1.5 text-muted-foreground hover:text-foreground flex-shrink-0" title="Ver publicación">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
        {thread.migratedConversationId && (
          <button onClick={() => setLocation("/inbox")} className="text-xs text-purple-400 hover:underline flex items-center gap-1 flex-shrink-0">
            <ArrowRightCircle className="w-3.5 h-3.5" /> Ver chat
          </button>
        )}
        {/* Resolve / Reopen */}
        {isOpen ? (
          <Button size="sm" variant="ghost" onClick={handleResolve} className="gap-1 text-green-400 hover:text-green-300 flex-shrink-0" title="Resolver">
            <CheckCircle className="w-4 h-4" />
          </Button>
        ) : thread.status === "resolved" ? (
          <Button size="sm" variant="ghost" onClick={handleReopen} className="gap-1 text-muted-foreground flex-shrink-0" title="Reabrir">
            <RotateCcw className="w-4 h-4" />
          </Button>
        ) : null}
      </div>

      {/* Comments timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {comments.map((c) => (
          <div key={c.id}>
            <CommentBubble comment={c} />
            {/* Draft action bar */}
            {c.isDraft && (
              <div className="flex gap-2 justify-end mt-1.5 flex-wrap">
                <Button size="sm" variant="ghost" onClick={() => handleDeleteDraft(c.id)} className="gap-1 text-muted-foreground hover:text-red-400 h-7 text-xs">
                  <Trash2 className="w-3 h-3" /> Descartar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleRegenerateDraft(c.id)} disabled={regenerateDraft.isPending} className="gap-1 text-muted-foreground hover:text-foreground h-7 text-xs">
                  <RefreshCw className="w-3 h-3" /> Regenerar
                </Button>
                <Button size="sm" onClick={() => handlePublishDraft(c.id)} disabled={publishDraft.isPending} className="gap-1 h-7 text-xs bg-primary hover:bg-primary/90">
                  <Sparkles className="w-3 h-3" /> Aprobar y publicar
                </Button>
              </div>
            )}
          </div>
        ))}
        {comments.filter((c) => !c.isInternal).length === 0 && (
          <div className="text-center py-8 text-muted-foreground/40 text-sm">Sin comentarios aún</div>
        )}
      </div>

      {/* Reply compose */}
      {isOpen && (
        <div className="border-t border-border px-4 py-3 space-y-2 flex-shrink-0 bg-card/30">
          {/* Migrate to DM section */}
          {!migrateOpen ? (
            <div className="flex gap-2">
              <Textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Escribe una respuesta pública…"
                rows={2}
                className="flex-1 resize-none text-sm"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend(); }}
                data-testid="feed-reply-input"
              />
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                <Select value={replyMode} onValueChange={(v) => setReplyMode(v as typeof replyMode)}>
                  <SelectTrigger className="h-8 text-xs w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Público + Privado</SelectItem>
                    <SelectItem value="public_only">Solo público</SelectItem>
                    <SelectItem value="private_only">Solo privado</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleSend} disabled={!replyText.trim() || reply.isPending} className="gap-1 h-8" data-testid="feed-reply-send">
                  <Send className="w-3.5 h-3.5" />
                </Button>
                {thread.status !== "migrated" && (
                  <Button size="sm" variant="outline" onClick={() => setMigrateOpen(true)} className="gap-1 h-8 text-xs text-purple-400 border-purple-500/30 hover:bg-purple-500/10" title="Migrar a chat privado" data-testid="feed-migrate-button">
                    <ArrowRightCircle className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium text-purple-400 flex items-center gap-1.5">
                <Lock className="w-3 h-3" /> Mensaje inicial del chat privado
              </p>
              <Textarea
                value={migrateText}
                onChange={(e) => setMigrateText(e.target.value)}
                placeholder="Hola, te escribimos por privado para ayudarte mejor…"
                rows={2}
                className="resize-none text-sm"
                data-testid="feed-migrate-input"
              />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => { setMigrateOpen(false); setMigrateText(""); }}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={handleMigrate} disabled={!migrateText.trim() || migrate.isPending} className="gap-1 bg-purple-600 hover:bg-purple-700" data-testid="feed-migrate-confirm">
                  <ArrowRightCircle className="w-3.5 h-3.5" /> Migrar a chat
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type ChannelFilter = "all" | "facebook" | "instagram";
type StatusFilter = "all" | "open" | "resolved" | "migrated";

export default function FeedPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const queryClient = useQueryClient();

  const listParams = {
    channel: channelFilter !== "all" ? channelFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  };
  const { data, isLoading } = useListFeedThreads(listParams as Parameters<typeof useListFeedThreads>[0], {
    query: { queryKey: getListFeedThreadsQueryKey(listParams as Parameters<typeof getListFeedThreadsQueryKey>[0]), refetchInterval: LIST_POLL_MS, staleTime: 0 },
  });

  const threads = data?.threads ?? [];

  const handleSelect = (t: FeedThread) => {
    setSelectedId(t.id);
  };

  return (
    <Layout>
      <div className="flex h-full overflow-hidden">
        {/* Left panel — thread list */}
        <div className={cn("flex flex-col border-r border-border bg-card/30 w-full md:w-80 lg:w-96 flex-shrink-0 overflow-hidden", selectedId ? "hidden md:flex" : "flex")}>
          {/* Header */}
          <div className="px-4 py-4 border-b border-border flex-shrink-0 space-y-3">
            <div>
              <h1 className="text-base font-bold text-foreground flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-primary" /> Feed de Publicaciones
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Comentarios en publicaciones de Facebook e Instagram
              </p>
            </div>
            {/* Channel tabs */}
            <Tabs value={channelFilter} onValueChange={(v) => { setChannelFilter(v as ChannelFilter); setSelectedId(null); }}>
              <TabsList className="w-full">
                <TabsTrigger value="all" className="flex-1 text-xs">Todos</TabsTrigger>
                <TabsTrigger value="facebook" className="flex-1 text-xs gap-1">
                  <SiFacebook className="w-3 h-3 text-[#1877F2]" /> Facebook
                </TabsTrigger>
                <TabsTrigger value="instagram" className="flex-1 text-xs gap-1">
                  <SiInstagram className="w-3 h-3 text-[#E1306C]" /> Instagram
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {/* Status filter */}
            <div className="flex gap-1 flex-wrap">
              {(["open", "all", "resolved", "migrated"] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setSelectedId(null); }}
                  className={cn(
                    "text-[11px] px-2 py-0.5 rounded-full font-medium transition-colors",
                    statusFilter === s
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  {{ open: "Abiertos", all: "Todos", resolved: "Resueltos", migrated: "Migrados" }[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Thread list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-card border border-border animate-pulse" />
                ))}
              </div>
            ) : threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <MessageCircle className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">Sin comentarios</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Los comentarios en tus publicaciones aparecerán aquí.
                </p>
              </div>
            ) : (
              threads.map((t) => (
                <ThreadItem
                  key={t.id}
                  thread={t}
                  selected={selectedId === t.id}
                  onClick={() => handleSelect(t)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right panel — thread detail */}
        <div className={cn("flex-1 min-w-0 overflow-hidden", selectedId ? "flex flex-col" : "hidden md:flex")}>
          {selectedId ? (
            <ThreadDetail key={selectedId} threadId={selectedId} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <MessageCircle className="w-10 h-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">Selecciona un hilo para ver la conversación</p>
              <p className="text-xs text-muted-foreground/50 mt-1">
                Los comentarios de usuarios en tus publicaciones de Facebook e Instagram
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
