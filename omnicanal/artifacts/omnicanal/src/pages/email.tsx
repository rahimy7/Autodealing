import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListEmailThreads,
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
  useGetGmailSettings,
  useSyncGmailNow,
  getListEmailThreadsQueryKey,
  getGetEmailThreadQueryKey,
  getListEmailContactCandidatesQueryKey,
  customFetch,
  type EmailThread,
  type EmailMessage,
  type EmailContactCandidate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Mail,
  ArrowLeft,
  CheckCircle,
  RotateCcw,
  RefreshCw,
  Trash2,
  Send,
  Sparkles,
  Bot,
  Paperclip,
  Link2,
  UserRound,
  Search,
  Loader2,
  ChevronDown,
  ChevronUp,
  Code2,
  AlertTriangle,
  Phone,
  PenSquare,
} from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import Layout from "@/components/layout/Layout";
import ContactAvatar from "@/components/ContactAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useModules } from "@/lib/platform";
import { useIncognito } from "@/lib/incognito";
import { cn } from "@/lib/utils";
import { AttachmentPicker, useAttachmentStaging } from "@/components/email/AttachmentPicker";
import ComposeEmailDialog from "@/components/email/ComposeEmailDialog";
import { CaseBadge } from "@/components/CaseBadge";

// ── Constantes ────────────────────────────────────────────────────────────────

// Los otros canales por los que el mismo cliente nos escribe. Es lo que se ve de
// un vistazo cuando una ficha junta correo y WhatsApp.
const OTHER_CHANNELS: Record<string, { Icon: React.ComponentType<{ className?: string }>; cls: string; label: string }> = {
  whatsapp: { Icon: SiWhatsapp, cls: "text-[#25D366]", label: "WhatsApp" },
  instagram: { Icon: SiInstagram, cls: "text-[#E1306C]", label: "Instagram" },
  facebook: { Icon: SiFacebook, cls: "text-[#1877F2]", label: "Facebook" },
};

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  open: { label: "Abierto", cls: "bg-blue-500/15 text-blue-400" },
  resolved: { label: "Resuelto", cls: "bg-green-500/15 text-green-400" },
};

const THREAD_POLL_MS = 15_000;
const LIST_POLL_MS = 20_000;

function timeAgo(date: string | null | undefined) {
  if (!date) return "";
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d`;
  return new Date(date).toLocaleDateString("es-DO", { day: "2-digit", month: "short" });
}

function fullDate(date: string | null | undefined) {
  if (!date) return "";
  return new Date(date).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LinkedChannels({ channels, className }: { channels: string[]; className?: string }) {
  const others = channels.filter((c) => OTHER_CHANNELS[c]);
  if (others.length === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)} title={`También escribe por ${others.map((c) => OTHER_CHANNELS[c].label).join(", ")}`}>
      {others.map((c) => {
        const { Icon, cls } = OTHER_CHANNELS[c];
        return <Icon key={c} className={cn("w-3 h-3", cls)} />;
      })}
    </span>
  );
}

// ── Lista ─────────────────────────────────────────────────────────────────────

function ThreadItem({ thread, selected, onClick }: { thread: EmailThread; selected: boolean; onClick: () => void }) {
  const unread = thread.unreadCount > 0;
  return (
    <button
      onClick={onClick}
      data-testid={`email-thread-${thread.id}`}
      className={cn(
        "w-full text-left px-4 py-3 flex gap-3 border-b border-border transition-colors",
        selected ? "bg-primary/10" : "hover:bg-accent/50",
      )}
    >
      <ContactAvatar
        name={thread.contactName ?? thread.customerEmail}
        avatar={thread.contactAvatar}
        className="w-10 h-10 bg-primary/15 text-sm font-semibold text-primary"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn("text-sm truncate", unread ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>
            {thread.contactName ?? thread.customerEmail}
          </span>
          <LinkedChannels channels={thread.contactChannels} />
          <span className="ml-auto text-[10px] text-muted-foreground/70 flex-shrink-0">{timeAgo(thread.lastMessageAt)}</span>
        </div>
        <p className={cn("text-xs truncate mt-0.5", unread ? "text-foreground font-medium" : "text-foreground/80")}>
          {thread.subject ?? "(sin asunto)"}
        </p>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{thread.lastMessagePreview ?? "—"}</p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {thread.status === "resolved" && (
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", STATUS_CHIP.resolved.cls)}>Resuelto</span>
          )}
          {thread.hasDraft && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 font-medium">Borrador IA</span>
          )}
          {thread.labelName && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: `${thread.labelColor ?? "#14b8a6"}20`, color: thread.labelColor ?? "#14b8a6" }}
            >
              {thread.labelName}
            </span>
          )}
          {unread && (
            <span className="ml-auto w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {thread.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Mensaje ───────────────────────────────────────────────────────────────────

async function downloadAttachment(messageId: number, partId: string, filename: string) {
  const blob = await customFetch<Blob>(`/api/email/messages/${messageId}/attachments/${encodeURIComponent(partId)}`, {
    responseType: "blob",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function MessageCard({ message }: { message: EmailMessage }) {
  const { toast } = useToast();
  const [showQuoted, setShowQuoted] = useState(false);
  const [showHtml, setShowHtml] = useState(false);

  if (message.isInternal) {
    return (
      <div className="flex justify-center">
        <span className="text-[11px] text-muted-foreground/70 italic px-3 text-center">{message.bodyText}</span>
      </div>
    );
  }

  const isIn = message.direction === "in";
  const own = message.bodyOwnText ?? message.bodyText;
  const hasQuoted = own.trim().length < message.bodyText.trim().length;
  const author = isIn
    ? message.fromName ?? message.fromAddress ?? "Cliente"
    : message.authorAgentName ?? message.fromName ?? "Nosotros";

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        isIn ? "bg-card border-border" : "bg-primary/10 border-primary/20 ml-6 sm:ml-12",
      )}
      data-testid={`email-message-${message.id}`}
    >
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm">
            {!isIn && message.isAiSuggestion && <Bot className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
            <span className="font-semibold text-foreground truncate">{author}</span>
            {isIn && message.fromName && message.fromAddress && (
              <span className="text-xs text-muted-foreground truncate">&lt;{message.fromAddress}&gt;</span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            para {message.toAddresses.join(", ") || "—"}
            {message.ccAddresses.length > 0 && ` · cc ${message.ccAddresses.join(", ")}`}
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground flex-shrink-0">{fullDate(message.sentAt ?? message.createdAt)}</span>
      </div>

      {showHtml && message.bodyHtml ? (
        // sandbox vacío: sin scripts, sin formularios y sin acceso al panel. Un
        // correo es contenido de terceros y así se trata.
        <iframe
          title={`Correo ${message.id}`}
          sandbox=""
          srcDoc={message.bodyHtml}
          className="mt-3 w-full h-[420px] rounded-lg bg-white border border-border"
        />
      ) : (
        <div className="mt-3 text-sm text-foreground whitespace-pre-wrap break-words">
          {showQuoted ? message.bodyText : own}
        </div>
      )}

      {message.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {message.attachments.map((a) => (
            <button
              key={a.partId}
              type="button"
              onClick={() =>
                downloadAttachment(message.id, a.partId, a.filename).catch(() =>
                  toast({ title: "No se pudo descargar el adjunto", variant: "destructive" }),
                )
              }
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border bg-muted/30 hover:bg-muted/60 transition-colors max-w-[240px]"
            >
              <Paperclip className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{a.filename}</span>
              <span className="text-muted-foreground flex-shrink-0">{fileSize(a.size)}</span>
            </button>
          ))}
        </div>
      )}

      {(hasQuoted || message.bodyHtml) && (
        <div className="mt-2 flex gap-3">
          {hasQuoted && !showHtml && (
            <button type="button" onClick={() => setShowQuoted((v) => !v)} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              {showQuoted ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showQuoted ? "Ocultar texto citado" : "Mostrar texto citado"}
            </button>
          )}
          {message.bodyHtml && (
            <button type="button" onClick={() => setShowHtml((v) => !v)} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <Code2 className="w-3 h-3" /> {showHtml ? "Ver como texto" : "Ver formato original"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Borrador ──────────────────────────────────────────────────────────────────

function DraftCard({ draft, threadId, onChanged }: { draft: EmailMessage; threadId: number; onChanged: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState(draft.bodyText);
  useEffect(() => setText(draft.bodyText), [draft.id, draft.bodyText]);
  const staging = useAttachmentStaging();

  const send = useSendEmailDraft();
  const discard = useDeleteEmailDraft();
  const regenerate = useGenerateEmailDraft();

  const handleSend = () =>
    send.mutate(
      {
        messageId: draft.id,
        data: { content: text.trim(), ...(staging.attachmentIds.length ? { attachmentIds: staging.attachmentIds } : {}) },
      },
      {
        onSuccess: () => {
          staging.reset();
          onChanged();
          toast({ title: "Correo enviado" });
        },
        onError: (err) => toast({ title: "Gmail no aceptó el envío", description: errorText(err), variant: "destructive" }),
      },
    );

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 ml-6 sm:ml-12" data-testid="email-draft">
      <div className="flex items-center gap-1.5 mb-2">
        <Bot className="w-3.5 h-3.5 text-amber-500" />
        <span className="text-xs font-semibold text-amber-500">Borrador de {draft.authorAgentName ?? "la IA"}</span>
        <span className="text-[10px] text-muted-foreground">· revísalo y edítalo antes de enviar</span>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(14, Math.max(5, text.split("\n").length + 1))}
        className="text-sm bg-background/60"
        data-testid="email-draft-text"
      />
      <div className="mt-2">
        <AttachmentPicker staging={staging} disabled={send.isPending} />
      </div>
      <div className="flex gap-2 justify-end mt-2 flex-wrap">
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 text-muted-foreground hover:text-red-400 h-8 text-xs"
          disabled={discard.isPending}
          onClick={() => {
            staging.discardAll();
            discard.mutate({ messageId: draft.id }, { onSuccess: onChanged });
          }}
        >
          <Trash2 className="w-3 h-3" /> Descartar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 text-muted-foreground hover:text-foreground h-8 text-xs"
          disabled={regenerate.isPending}
          onClick={() =>
            regenerate.mutate(
              { id: threadId },
              {
                onSuccess: (res) => {
                  onChanged();
                  if (!res.draft && res.note) toast({ title: "Sin borrador nuevo", description: res.note });
                },
              },
            )
          }
        >
          {regenerate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Regenerar
        </Button>
        <Button size="sm" className="gap-1 h-8 text-xs" disabled={!text.trim() || send.isPending} onClick={handleSend} data-testid="email-draft-send">
          {send.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Aprobar y enviar
        </Button>
      </div>
    </div>
  );
}

function errorText(err: unknown): string | undefined {
  const data = (err as { data?: { error?: string } } | null)?.data;
  if (data?.error) return data.error;
  return err instanceof Error ? err.message : undefined;
}

// ── Vincular contacto ─────────────────────────────────────────────────────────

function LinkContactDialog({
  thread,
  open,
  onOpenChange,
  onLinked,
}: {
  thread: EmailThread;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [confirming, setConfirming] = useState<EmailContactCandidate | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (!open) {
      setSearch("");
      setConfirming(null);
    }
  }, [open]);

  const params = { threadId: thread.id, ...(debounced ? { search: debounced } : {}) };
  const { data, isFetching } = useListEmailContactCandidates(params, {
    query: { queryKey: getListEmailContactCandidatesQueryKey(params), enabled: open },
  });
  const link = useLinkEmailThreadContact();
  const candidates = data?.candidates ?? [];

  const confirm = () => {
    if (!confirming) return;
    link.mutate(
      { id: thread.id, data: { contactId: confirming.id } },
      {
        onSuccess: () => {
          toast({ title: "Contacto vinculado", description: `Este correo ahora es de ${confirming.name}.` });
          onOpenChange(false);
          onLinked();
        },
        onError: (err) => toast({ title: "No se pudo vincular", description: errorText(err), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Vincular a un contacto</DialogTitle>
          <DialogDescription>
            Si quien escribe ya es cliente por WhatsApp u otro canal, únelos: sus chats, correos y datos quedarán en una sola ficha.
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              Se unirá <span className="font-semibold">{thread.contactName ?? thread.customerEmail}</span> con{" "}
              <span className="font-semibold">{confirming.name}</span>. La ficha de {confirming.name} se conserva y recibe las conversaciones,
              correos y datos de la otra. Esto no se puede deshacer.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirming(null)}>
                Volver
              </Button>
              <Button onClick={confirm} disabled={link.isPending} data-testid="email-link-confirm">
                {link.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Unir contactos
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, teléfono o correo…"
                className="pl-9"
                autoFocus
                data-testid="email-link-search"
              />
            </div>
            {!debounced && (
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Sugerencias</p>
            )}
            <div className="max-h-80 overflow-y-auto divide-y divide-border rounded-lg border border-border">
              {isFetching && candidates.length === 0 ? (
                <div className="p-6 flex justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : candidates.length === 0 ? (
                <p className="p-6 text-center text-xs text-muted-foreground">
                  {debounced ? "Ningún contacto coincide." : "No hay sugerencias. Busca al contacto por su nombre o teléfono."}
                </p>
              ) : (
                candidates.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                    <ContactAvatar name={c.name} avatar={c.avatar} className="w-8 h-8 bg-primary/15 text-xs font-semibold text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground truncate">{c.name}</span>
                        <LinkedChannels channels={c.channels} />
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[c.phone, c.email].filter(Boolean).join(" · ") || "Sin teléfono ni correo"}
                      </div>
                      <div className="text-[10px] text-primary/80">{c.reason}</div>
                    </div>
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setConfirming(c)}>
                      Vincular
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Detalle ───────────────────────────────────────────────────────────────────

function ThreadDetail({ threadId, onBack }: { threadId: number; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const modules = useModules();
  const [, setLocation] = useLocation();
  const [reply, setReply] = useState("");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const staging = useAttachmentStaging();

  const { data, isLoading } = useGetEmailThread(threadId, {
    query: { queryKey: getGetEmailThreadQueryKey(threadId), refetchInterval: THREAD_POLL_MS, staleTime: 0 },
  });
  const thread = data?.thread;
  const messages = data?.messages ?? [];
  const draft = messages.find((m) => m.isDraft) ?? null;
  const timeline = messages.filter((m) => !m.isDraft);
  const lastInbound = [...timeline].reverse().find((m) => m.direction === "in" && !m.isInternal);
  const replyTo = lastInbound?.replyTo ?? lastInbound?.fromAddress ?? thread?.customerEmail ?? "";

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetEmailThreadQueryKey(threadId) });
    void queryClient.invalidateQueries({ queryKey: getListEmailThreadsQueryKey() });
  };

  const markRead = useMarkEmailThreadRead();
  const incognito = useIncognito();
  const unread = thread?.unreadCount ?? 0;
  useEffect(() => {
    // En incógnito el correo se lee sin acuse: sigue sin leer aquí y en Gmail.
    if (unread > 0 && !incognito) markRead.mutate({ id: threadId }, { onSuccess: refresh });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, unread, incognito]);

  const send = useReplyEmailThread();
  const generate = useGenerateEmailDraft();
  const resolve = useResolveEmailThread();
  const reopen = useReopenEmailThread();

  const ccList = cc
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const ccInvalid = ccList.some((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));

  const handleSend = () => {
    if (!reply.trim() || ccInvalid || staging.isUploading) return;
    send.mutate(
      {
        id: threadId,
        data: {
          content: reply.trim(),
          ...(ccList.length ? { cc: ccList } : {}),
          ...(staging.attachmentIds.length ? { attachmentIds: staging.attachmentIds } : {}),
        },
      },
      {
        onSuccess: () => {
          setReply("");
          setCc("");
          setShowCc(false);
          staging.reset();
          refresh();
          toast({ title: "Correo enviado" });
        },
        onError: (err) => toast({ title: "Gmail no aceptó el envío", description: errorText(err), variant: "destructive" }),
      },
    );
  };

  const handleGenerate = () =>
    generate.mutate(
      { id: threadId },
      {
        onSuccess: (res) => {
          refresh();
          if (!res.draft) toast({ title: "Sin borrador", description: res.note ?? undefined });
        },
        onError: (err) => toast({ title: "La IA no respondió", description: errorText(err), variant: "destructive" }),
      },
    );

  if (isLoading || !thread) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isOpen = thread.status === "open";
  const chip = STATUS_CHIP[thread.status] ?? STATUS_CHIP.open;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Cabecera */}
      <div className="px-4 py-3 border-b border-border bg-card/50 flex-shrink-0 space-y-2">
        <div className="flex items-start gap-2">
          <button onClick={onBack} className="md:hidden p-1 -ml-1 mt-0.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="flex-1 min-w-0 text-base font-semibold text-foreground break-words">{thread.subject ?? "(sin asunto)"}</h2>
          <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0", chip.cls)}>{chip.label}</span>
          {isOpen ? (
            <Button
              size="sm"
              variant="ghost"
              title="Marcar como resuelto"
              className="h-7 px-2 text-green-400 hover:text-green-300 flex-shrink-0"
              onClick={() => resolve.mutate({ id: threadId }, { onSuccess: () => { refresh(); toast({ title: "Hilo resuelto" }); } })}
              data-testid="email-resolve"
            >
              <CheckCircle className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              title="Reabrir"
              className="h-7 px-2 text-muted-foreground flex-shrink-0"
              onClick={() => reopen.mutate({ id: threadId }, { onSuccess: refresh })}
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <ContactAvatar
            name={thread.contactName ?? thread.customerEmail}
            avatar={thread.contactAvatar}
            className="w-6 h-6 bg-primary/15 text-[10px] font-semibold text-primary"
          />
          <span className="font-medium text-foreground">{thread.contactName ?? "Cliente"}</span>
          <span className="text-muted-foreground">{thread.customerEmail}</span>
          {thread.contactPhone && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Phone className="w-3 h-3" /> {thread.contactPhone}
            </span>
          )}
          <LinkedChannels channels={thread.contactChannels} />
          {/* Lo que este cliente pidió y sigue sin resolverse. Va en la cabecera
              del hilo porque es donde está mirando quien lo va a contestar. */}
          {(thread.openCases ?? []).map((c) => (
            <CaseBadge key={c.id} caseRow={c} />
          ))}
          {thread.labelName && (
            <span
              className="px-1.5 py-0.5 rounded-full text-[10px]"
              style={{ background: `${thread.labelColor ?? "#14b8a6"}20`, color: thread.labelColor ?? "#14b8a6" }}
            >
              {thread.labelName}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setLinkOpen(true)} data-testid="email-link-contact">
              <Link2 className="w-3 h-3" /> Vincular contacto
            </Button>
            {modules.crm && thread.contactId && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setLocation(`/contacts/${thread.contactId}`)}>
                <UserRound className="w-3 h-3" /> Ficha
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Correos */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {timeline.map((m) => (
          <MessageCard key={m.id} message={m} />
        ))}
        {draft && <DraftCard draft={draft} threadId={threadId} onChanged={refresh} />}
      </div>

      {/* Respuesta */}
      {!draft && (
        <div className="border-t border-border px-4 py-3 space-y-2 flex-shrink-0 bg-card/30">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>
              Para <span className="text-foreground">{replyTo}</span>
            </span>
            <button type="button" className="hover:text-foreground" onClick={() => setShowCc((v) => !v)}>
              {showCc ? "Quitar CC" : "Añadir CC"}
            </button>
          </div>
          {showCc && (
            <Input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="cc: correo@empresa.com, otro@empresa.com"
              className={cn("h-8 text-xs", ccInvalid && "border-destructive")}
            />
          )}
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Escribe tu respuesta… (Ctrl+Enter para enviar)"
            rows={4}
            className="resize-none text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
            }}
            data-testid="email-reply-input"
          />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <AttachmentPicker staging={staging} disabled={send.isPending} />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" disabled={generate.isPending} onClick={handleGenerate} data-testid="email-generate-draft">
                {generate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Borrador con IA
              </Button>
              <Button
                size="sm"
                className="gap-1 h-8"
                disabled={!reply.trim() || ccInvalid || send.isPending || staging.isUploading}
                onClick={handleSend}
                data-testid="email-reply-send"
              >
                {send.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Enviar
              </Button>
            </div>
          </div>
        </div>
      )}

      <LinkContactDialog thread={thread} open={linkOpen} onOpenChange={setLinkOpen} onLinked={refresh} />
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

type StatusFilter = "open" | "all" | "resolved";

export default function EmailPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const id = Number(new URLSearchParams(window.location.search).get("thread"));
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(selectedId ? "all" : "open");
  const [composeOpen, setComposeOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: gmail } = useGetGmailSettings();
  const sync = useSyncGmailNow();

  const params = useMemo(
    () => ({
      ...(statusFilter !== "all" ? { status: statusFilter } : {}),
      ...(debounced ? { search: debounced } : {}),
    }),
    [statusFilter, debounced],
  );
  const { data, isLoading } = useListEmailThreads(params, {
    query: { queryKey: getListEmailThreadsQueryKey(params), refetchInterval: LIST_POLL_MS, staleTime: 0 },
  });
  const threads = data?.threads ?? [];

  const handleSync = () =>
    sync.mutate(undefined, {
      onSuccess: (res) => {
        void queryClient.invalidateQueries({ queryKey: getListEmailThreadsQueryKey() });
        toast({ title: res.ok ? "Buzón al día" : "No se pudo sincronizar", description: res.message ?? undefined, variant: res.ok ? "default" : "destructive" });
      },
    });

  const notConnected = gmail && !gmail.connected;

  return (
    <Layout>
      <div className="flex h-full overflow-hidden">
        {/* Lista */}
        <div className={cn("flex flex-col border-r border-border bg-card/30 w-full md:w-80 lg:w-96 flex-shrink-0 overflow-hidden", selectedId ? "hidden md:flex" : "flex")}>
          <div className="px-4 py-4 border-b border-border flex-shrink-0 space-y-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <h1 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Mail className="w-4 h-4 text-primary" /> Correo
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {gmail?.connected ? gmail.emailAddress : "Correos de clientes desde Gmail"}
                </p>
              </div>
              {gmail?.connected && (
                <Button size="icon" variant="ghost" className="h-8 w-8" title="Buscar correos nuevos" onClick={handleSync} disabled={sync.isPending || !gmail.enabled}>
                  <RefreshCw className={cn("w-4 h-4", sync.isPending && "animate-spin")} />
                </Button>
              )}
              <Button
                size="icon"
                className="h-8 w-8"
                title="Redactar correo"
                onClick={() => setComposeOpen(true)}
                disabled={!gmail?.connected}
                data-testid="email-compose-open"
              >
                <PenSquare className="w-4 h-4" />
              </Button>
            </div>

            {notConnected && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  Gmail no está conectado.{" "}
                  <Link href="/settings?tab=email" className="underline hover:text-amber-200">
                    Configúralo en Configuración → Correo
                  </Link>
                  .
                </span>
              </div>
            )}
            {gmail?.connected && gmail.lastError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{gmail.lastError}</span>
              </div>
            )}

            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por asunto, cliente o correo…"
                className="h-8 pl-8 text-xs"
                data-testid="email-search"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              {(["open", "all", "resolved"] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "text-[11px] px-2 py-0.5 rounded-full font-medium transition-colors",
                    statusFilter === s ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  {{ open: "Abiertos", all: "Todos", resolved: "Resueltos" }[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-20 rounded-lg bg-card border border-border animate-pulse" />
                ))}
              </div>
            ) : threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <Mail className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">{debounced ? "Sin resultados" : "Sin correos"}</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Los correos de tus clientes aparecerán aquí.</p>
              </div>
            ) : (
              threads.map((t) => <ThreadItem key={t.id} thread={t} selected={selectedId === t.id} onClick={() => setSelectedId(t.id)} />)
            )}
          </div>
        </div>

        {/* Detalle */}
        <div className={cn("flex-1 min-w-0 overflow-hidden", selectedId ? "flex flex-col" : "hidden md:flex")}>
          {selectedId ? (
            <ThreadDetail key={selectedId} threadId={selectedId} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full w-full text-center p-8">
              <Mail className="w-10 h-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">Selecciona un correo para leer el hilo</p>
              <p className="text-xs text-muted-foreground/50 mt-1">La IA deja un borrador listo para revisar en cada correo nuevo</p>
            </div>
          )}
        </div>
      </div>

      <ComposeEmailDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onSent={(threadId) => {
          void queryClient.invalidateQueries({ queryKey: getListEmailThreadsQueryKey() });
          setStatusFilter("all");
          setSelectedId(threadId);
        }}
      />
    </Layout>
  );
}
