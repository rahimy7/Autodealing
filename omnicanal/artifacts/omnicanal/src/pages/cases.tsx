import { useClient } from "@/lib/platform";
import PastoralRequestsPage from "./pastoral-requests";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCases,
  useCreateCase,
  useUpdateCase,
  useGetCase,
  useAddCaseEvent,
  useResolveCase,
  useSuggestCaseResolution,
  useListContacts,
  useListAgents,
  getListCasesQueryKey,
  getGetCaseQueryKey,
  getListContactsQueryKey,
  type Case,
  type CaseType,
  type CaseStatus,
  type CasePriority,
  type CaseResolutionKind,
} from "@workspace/api-client-react";
import {
  Plus,
  Search,
  FolderOpen,
  ExternalLink,
  Sparkles,
  Loader2,
  X,
  Mail,
  MessageSquare,
  Send,
  CheckCircle2,
  Hammer,
  Ban,
  Package,
  RotateCcw,
} from "lucide-react";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CASE_TYPE_LABELS,
  CASE_STATUS_LABELS,
  CASE_STATUS_STYLES,
  CASE_PRIORITY_LABELS,
  CASE_PRIORITY_STYLES,
  CASE_RESOLUTION_LABELS,
} from "@/components/CaseBadge";

const TYPES = Object.keys(CASE_TYPE_LABELS).filter(type => !["prayer_request", "visitation", "bible_study", "worship"].includes(type)) as CaseType[];
const STATUSES = Object.keys(CASE_STATUS_LABELS) as CaseStatus[];
const PRIORITIES = Object.keys(CASE_PRIORITY_LABELS) as CasePriority[];

// "Pendientes" no es un estado: es todo lo que sigue siendo trabajo. Es la
// pestaña con la que se entra, porque es la única pregunta que importa al abrir
// la vista — qué falta por resolver.
const TABS: Array<{ key: string; label: string }> = [
  { key: "pending", label: "Pendientes" },
  { key: "open", label: "Abiertos" },
  { key: "in_progress", label: "En gestión" },
  { key: "waiting_customer", label: "Esperando al cliente" },
  { key: "resolved", label: "Resueltos" },
  { key: "all", label: "Todos" },
];

const CHANNEL_ICON: Record<string, typeof Mail> = {
  email: Mail,
  whatsapp: MessageSquare,
  instagram: MessageSquare,
  facebook: MessageSquare,
  chat: MessageSquare,
};

function shortDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("es-DO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function ContactPicker({ onPick }: { onPick: (contact: { id: number; name: string; phone: string | null }) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const contactParams = { search: debounced || undefined };
  const { data: contacts } = useListContacts(contactParams, {
    query: { enabled: debounced.length > 1, queryKey: getListContactsQueryKey(contactParams) },
  });

  return (
    <div className="space-y-1.5">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cliente por nombre, teléfono o correo…" data-testid="input-case-contact-search" />
      {debounced.length > 1 && (contacts ?? []).length > 0 && (
        <div className="border border-card-border rounded-lg divide-y divide-card-border max-h-40 overflow-y-auto">
          {(contacts ?? []).slice(0, 8).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick({ id: c.id, name: c.name, phone: c.phone ?? null })}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
              data-testid={`option-case-contact-${c.id}`}
            >
              <div className="font-medium text-foreground">{c.name}</div>
              <div className="text-xs text-muted-foreground">{c.phone ?? c.email ?? ""}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cierre ────────────────────────────────────────────────────────────────────

// Las dos maneras de terminar un caso, una al lado de la otra: se contesta, o se
// hace algo. Elegir una cambia qué se pide abajo, no abre otra pantalla.
const RESOLUTION_CHOICES: Array<{ kind: CaseResolutionKind; label: string; hint: string; Icon: typeof CheckCircle2 }> = [
  { kind: "answered", label: "Respondiendo", hint: "La respuesta resuelve lo que preguntaba.", Icon: CheckCircle2 },
  { kind: "actioned", label: "Accionando", hint: "Hubo que hacer una gestión.", Icon: Hammer },
  { kind: "rejected", label: "No procede", hint: "Se atendió y no corresponde.", Icon: Ban },
];

function ResolvePanel({
  caseRow,
  onDone,
}: {
  caseRow: Case;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const resolve = useResolveCase();
  const suggest = useSuggestCaseResolution();
  const [kind, setKind] = useState<CaseResolutionKind>("answered");
  const [resolution, setResolution] = useState("");
  const [reply, setReply] = useState("");
  const [suggestion, setSuggestion] = useState<{ note: string | null } | null>(null);

  const canWriteToCustomer = caseRow.emailThreadId != null || caseRow.conversationId != null;

  const askAi = () => {
    suggest.mutate(
      { id: caseRow.id },
      {
        onSuccess: (s) => {
          setSuggestion({ note: s.note ?? null });
          setKind(s.kind);
          if (s.reply) setReply(s.reply);
          if (s.action) setResolution(s.action);
          if (!s.reply && !s.action && s.note) {
            toast({ title: "La IA no propuso nada", description: s.note });
          }
        },
        onError: () => toast({ title: "No se pudo consultar a la IA", variant: "destructive" }),
      },
    );
  };

  const submit = () => {
    const text = resolution.trim();
    if (!text) {
      toast({ title: "Escribe qué se respondió o qué se hizo", variant: "destructive" });
      return;
    }
    resolve.mutate(
      {
        id: caseRow.id,
        data: {
          kind,
          resolution: text,
          replyToCustomer: kind !== "rejected" && reply.trim() ? reply.trim() : null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: `Caso ${caseRow.code} resuelto` });
          onDone();
        },
        onError: (err) => toast({ title: "No se pudo cerrar el caso", description: (err as Error)?.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-3 border-t border-card-border pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Resolver</h3>
        <Button type="button" size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={askAi} disabled={suggest.isPending} data-testid="button-case-suggest">
          {suggest.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          Qué contestar o qué hacer
        </Button>
      </div>

      {suggestion?.note && <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">{suggestion.note}</p>}

      <div className="grid grid-cols-3 gap-2">
        {RESOLUTION_CHOICES.map(({ kind: k, label, hint, Icon }) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            title={hint}
            data-testid={`button-case-resolution-${k}`}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors",
              kind === k ? "border-primary bg-primary/10 text-primary" : "border-card-border text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {kind !== "rejected" && canWriteToCustomer && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Respuesta al cliente {caseRow.emailThreadId != null ? "(sale por correo)" : "(sale por el chat)"} — opcional
          </label>
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={5}
            className="text-sm"
            placeholder="Déjalo vacío para cerrar el caso sin escribirle."
            data-testid="input-case-reply"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {kind === "actioned" ? "Qué se hizo" : kind === "rejected" ? "Por qué no procede" : "Qué se le respondió"}
        </label>
        <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} className="text-sm resize-none" data-testid="input-case-resolution" />
      </div>

      <Button className="w-full gap-2" onClick={submit} disabled={resolve.isPending} data-testid="button-case-resolve">
        {resolve.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : reply.trim() && kind !== "rejected" ? <Send className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
        {reply.trim() && kind !== "rejected" ? "Responder y cerrar" : "Cerrar el caso"}
      </Button>
    </div>
  );
}

// ── Detalle ───────────────────────────────────────────────────────────────────

function CaseDialog({ caseId, open, onOpenChange }: { caseId: number | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetCase(caseId ?? 0, { query: { enabled: open && caseId != null, queryKey: getGetCaseQueryKey(caseId ?? 0) } });
  const updateCase = useUpdateCase();
  const addEvent = useAddCaseEvent();
  const { data: agents } = useListAgents();
  const [note, setNote] = useState("");
  const [noteKind, setNoteKind] = useState<"note" | "action">("note");

  const row = data?.case;
  const events = data?.events ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
    if (caseId != null) queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
  };

  const patch = (patchData: Parameters<typeof updateCase.mutate>[0]["data"]) => {
    if (!row) return;
    updateCase.mutate(
      { id: row.id, data: patchData },
      { onSuccess: invalidate, onError: () => toast({ title: "No se pudo actualizar el caso", variant: "destructive" }) },
    );
  };

  const submitNote = () => {
    if (!row || !note.trim()) return;
    addEvent.mutate(
      { id: row.id, data: { kind: noteKind, body: note.trim() } },
      {
        onSuccess: () => {
          setNote("");
          invalidate();
        },
        onError: () => toast({ title: "No se pudo guardar", variant: "destructive" }),
      },
    );
  };

  const humanAgents = (agents ?? []).filter((a) => a.type === "human");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {row ? `${row.code} · ${CASE_TYPE_LABELS[row.type]}` : "Caso"}
          </DialogTitle>
          {row && <DialogDescription className="text-left">{row.subject}</DialogDescription>}
        </DialogHeader>

        {isLoading || !row ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : (
          <div className="space-y-4 overflow-y-auto pr-1 -mr-1">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-semibold text-foreground">{row.contactName ?? "Cliente"}</div>
                <div className="text-xs text-muted-foreground">{[row.contactPhone, row.contactEmail].filter(Boolean).join(" · ") || "Sin datos de contacto"}</div>
              </div>
              <div className="flex items-center gap-2">
                {row.emailThreadId != null && (
                  <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setLocation(`/email?thread=${row.emailThreadId}`)} data-testid="button-case-view-email">
                    <Mail className="w-3.5 h-3.5" /> Ver el correo
                  </Button>
                )}
                {row.conversationId != null && (
                  <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setLocation(`/inbox?conv=${row.conversationId}`)} data-testid="button-case-view-conversation">
                    <ExternalLink className="w-3.5 h-3.5" /> Ver el chat
                  </Button>
                )}
                {row.orderId != null && (
                  <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setLocation(`/orders?order=${row.orderId}`)} data-testid="button-case-view-order">
                    <Package className="w-3.5 h-3.5" /> Ver el pedido
                  </Button>
                )}
                {/* Lo que pide devolver el producto se gestiona como devolución: vuelve
                    al inventario por lote y se resuelve con nota de crédito,
                    reembolso o reposición (2026-10-04). */}
                {row.orderId != null && (row.type === "refund" || row.type === "order_error" || row.type === "product_quality") && (
                  <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setLocation(`/orders?view=returns&order=${row.orderId}&case=${row.id}`)} data-testid="button-case-open-return">
                    <RotateCcw className="w-3.5 h-3.5" /> Abrir devolución
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Estado</label>
                <Select value={row.status} onValueChange={(v) => patch({ status: v as CaseStatus })}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-case-status"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{CASE_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Tipo</label>
                <Select value={row.type} onValueChange={(v) => patch({ type: v as CaseType })}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-case-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{CASE_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Prioridad</label>
                <Select value={row.priority} onValueChange={(v) => patch({ priority: v as CasePriority })}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-case-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{CASE_PRIORITY_LABELS[p]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Responsable</label>
                <Select
                  value={row.assignedAgentId != null ? String(row.assignedAgentId) : "none"}
                  onValueChange={(v) => patch({ assignedAgentId: v === "none" ? null : Number(v) })}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid="select-case-assignee"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin asignar</SelectItem>
                    {humanAgents.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {row.description && (
              <div className="bg-muted/50 rounded-lg px-3 py-2.5">
                <div className="text-[11px] font-medium text-muted-foreground mb-1">Lo que cuenta el cliente</div>
                <p className="text-sm text-foreground whitespace-pre-wrap">{row.description}</p>
              </div>
            )}
            {row.requestedAction && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg px-3 py-2.5">
                <div className="text-[11px] font-medium text-primary mb-1">Lo que pide</div>
                <p className="text-sm text-foreground whitespace-pre-wrap">{row.requestedAction}</p>
              </div>
            )}

            {row.resolutionKind && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2.5">
                <div className="text-[11px] font-medium text-emerald-600 mb-1">{CASE_RESOLUTION_LABELS[row.resolutionKind]}</div>
                <p className="text-sm text-foreground whitespace-pre-wrap">{row.resolution}</p>
              </div>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Expediente</h3>
              <div className="space-y-1.5">
                {events.map((e) => (
                  <div key={e.id} className="flex gap-2 text-xs">
                    <span className="text-muted-foreground tabular-nums whitespace-nowrap">{shortDate(e.createdAt)}</span>
                    <span className="text-foreground flex-1 whitespace-pre-wrap">
                      {e.body}
                      {e.agentName && <span className="text-muted-foreground"> — {e.agentName}</span>}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Select value={noteKind} onValueChange={(v) => setNoteKind(v as "note" | "action")}>
                  <SelectTrigger className="h-8 w-28 text-xs" data-testid="select-case-note-kind"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="note">Nota</SelectItem>
                    <SelectItem value="action">Gestión</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitNote(); }}
                  placeholder={noteKind === "action" ? "Qué se hizo…" : "Qué se averiguó…"}
                  className="h-8 text-sm"
                  data-testid="input-case-note"
                />
                <Button size="sm" className="h-8" onClick={submitNote} disabled={addEvent.isPending || !note.trim()} data-testid="button-case-add-note">Añadir</Button>
              </div>
            </div>

            {row.status !== "resolved" && row.status !== "cancelled" && (
              <ResolvePanel caseRow={row} onDone={() => { invalidate(); onOpenChange(false); }} />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Alta a mano ───────────────────────────────────────────────────────────────

function NewCaseDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (c: Case) => void }) {
  const { toast } = useToast();
  const createCase = useCreateCase();
  const [contact, setContact] = useState<{ id: number; name: string; phone: string | null } | null>(null);
  const [type, setType] = useState<CaseType>("other");
  const [priority, setPriority] = useState<CasePriority>("normal");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [requestedAction, setRequestedAction] = useState("");

  useEffect(() => {
    if (!open) return;
    setContact(null);
    setType("other");
    setPriority("normal");
    setSubject("");
    setDescription("");
    setRequestedAction("");
  }, [open]);

  const submit = () => {
    if (!contact) {
      toast({ title: "Elige el cliente primero", variant: "destructive" });
      return;
    }
    if (!subject.trim()) {
      toast({ title: "Ponle un asunto al caso", variant: "destructive" });
      return;
    }
    createCase.mutate(
      {
        data: {
          contactId: contact.id,
          type,
          priority,
          subject: subject.trim(),
          description: description.trim() || null,
          requestedAction: requestedAction.trim() || null,
        },
      },
      {
        onSuccess: (created) => {
          toast({ title: "Caso abierto", description: created.code });
          onOpenChange(false);
          onCreated(created);
        },
        onError: () => toast({ title: "No se pudo abrir el caso", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo caso</DialogTitle>
          <DialogDescription>Una petición que hay que gestionar y que no puede quedar en un chat.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {contact ? (
            <div className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
              <div>
                <div className="text-sm font-medium text-foreground">{contact.name}</div>
                {contact.phone && <div className="text-xs text-muted-foreground">{contact.phone}</div>}
              </div>
              <button type="button" onClick={() => setContact(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <ContactPicker onPick={setContact} />
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Tipo</label>
              <Select value={type} onValueChange={(v) => setType(v as CaseType)}>
                <SelectTrigger data-testid="select-new-case-type"><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{CASE_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Prioridad</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as CasePriority)}>
                <SelectTrigger data-testid="select-new-case-priority"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{CASE_PRIORITY_LABELS[p]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Asunto</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ej: Pide precio por 12 unidades para revender" data-testid="input-new-case-subject" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Lo que cuenta el cliente</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="text-sm resize-none" data-testid="input-new-case-description" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Lo que pide</label>
            <Input value={requestedAction} onChange={(e) => setRequestedAction(e.target.value)} placeholder="Ej: que le den precio de mayorista" data-testid="input-new-case-action" />
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button className="flex-1" onClick={submit} disabled={createCase.isPending} data-testid="button-submit-case">Abrir caso</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Vista ─────────────────────────────────────────────────────────────────────

export default function CasesPage() {
  const church = useClient().id === "linaje-real";
  return church ? <PastoralRequestsPage /> : <CommercialCasesPage />;
}

function CommercialCasesPage() {
  const searchString = useSearch();
  const caseFromUrl = Number(new URLSearchParams(searchString).get("case"));
  const [, setLocation] = useLocation();

  const [tab, setTab] = useState<string>("pending");
  const [typeFilter, setTypeFilter] = useState<CaseType | "all">("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: cases, isLoading } = useListCases({
    status: tab === "all" ? undefined : (tab as never),
    type: typeFilter === "all" ? undefined : typeFilter,
    search: debouncedSearch || undefined,
  });

  const [selected, setSelected] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  // `?case=<id>` — desde la pastilla del correo o del chat.
  useEffect(() => {
    if (!Number.isInteger(caseFromUrl) || caseFromUrl <= 0) return;
    setSelected(caseFromUrl);
    setLocation("/cases", { replace: true });
  }, [caseFromUrl, setLocation]);

  const rows = useMemo(() => cases ?? [], [cases]);

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">Casos</h1>
            <p className="text-sm text-muted-foreground">Lo que los clientes piden y hay que gestionar, hasta que se resuelve.</p>
          </div>
          <Button size="sm" onClick={() => setNewOpen(true)} className="gap-2" data-testid="button-new-case"><Plus className="w-4 h-4" /> Nuevo caso</Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-card border border-card-border rounded-lg p-1 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                data-testid={`tab-case-status-${t.key}`}
                className={cn(
                  "text-xs font-medium px-3 py-1.5 rounded-md transition-colors",
                  tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as CaseType | "all")}>
            <SelectTrigger className="h-9 w-56 text-sm" data-testid="select-case-type-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              {TYPES.map((t) => <SelectItem key={t} value={t}>{CASE_TYPE_LABELS[t]}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por código, asunto o cliente…" className="pl-8 h-9 text-sm" data-testid="input-case-search" />
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-lg bg-muted/40 animate-pulse" />)}</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center">
              <FolderOpen className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No hay casos aquí.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="border-b border-card-border text-xs text-muted-foreground">
                    <th className="text-left font-medium px-4 py-3">Código</th>
                    <th className="text-left font-medium px-3 py-3">Cliente</th>
                    <th className="text-left font-medium px-3 py-3">Petición</th>
                    <th className="text-left font-medium px-3 py-3 w-44">Tipo</th>
                    <th className="text-left font-medium px-3 py-3 w-24">Prioridad</th>
                    <th className="text-left font-medium px-3 py-3 w-32">Estado</th>
                    <th className="text-left font-medium px-4 py-3 w-28">Entró</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const Icon = CHANNEL_ICON[c.channel] ?? FolderOpen;
                    return (
                      <tr
                        key={c.id}
                        className="border-b border-card-border/60 hover:bg-muted/40 transition-colors cursor-pointer"
                        onClick={() => setSelected(c.id)}
                        data-testid={`case-row-${c.id}`}
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium text-primary">{c.code}</span>
                          {c.openedByAi && <span className="block text-[10px] text-muted-foreground">abierto por IA</span>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-foreground">{c.contactName ?? "Sin nombre"}</div>
                          <div className="text-xs text-muted-foreground">{c.contactEmail ?? c.contactPhone ?? "—"}</div>
                        </td>
                        <td className="px-3 py-3 text-foreground max-w-[280px] truncate" title={c.subject}>{c.subject}</td>
                        <td className="px-3 py-3 text-muted-foreground text-xs">{CASE_TYPE_LABELS[c.type]}</td>
                        <td className="px-3 py-3">
                          <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", CASE_PRIORITY_STYLES[c.priority])}>
                            {CASE_PRIORITY_LABELS[c.priority]}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", CASE_STATUS_STYLES[c.status])}>
                            {CASE_STATUS_LABELS[c.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Icon className="w-3 h-3" /> {shortDate(c.createdAt)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <CaseDialog caseId={selected} open={selected != null} onOpenChange={(v) => { if (!v) setSelected(null); }} />
      <NewCaseDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(c) => setSelected(c.id)} />
    </Layout>
  );
}
