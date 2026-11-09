import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAnswerReviews,
  getListAnswerReviewsQueryKey,
  useCreateAnswerReview,
  useImportAnswerQuestions,
  useGeneratePendingAnswers,
  useUpdateAnswerReview,
  useDeleteAnswerReview,
  useProcessAnswerReview,
  useRegenerateAnswerReview,
  useApproveAnswerReview,
  type AnswerReview,
  type AnswerReviewUpdate,
  type AnswerTrainingAgent,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Check,
  GraduationCap,
  Loader2,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  Wand2,
} from "lucide-react";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/money";
import { cn } from "@/lib/utils";
import { withBase } from "@/lib/base-path";

// Entrenar respuestas: las preguntas que más hacen los clientes, con la respuesta
// que da hoy el agente virtual. El equipo le escribe indicaciones, "Procesar" le
// pide al agente que la rehaga con ellas, y "Aprobar" hace que la IA redacte la
// instrucción que desde entonces leen los agentes en los chats.
type Tab = "review" | "approved" | "dismissed" | "all";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "review", label: "Por revisar" },
  { key: "approved", label: "Aprobadas" },
  { key: "dismissed", label: "Descartadas" },
  { key: "all", label: "Todas" },
];

function inTab(item: AnswerReview, tab: Tab): boolean {
  if (tab === "all") return true;
  if (tab === "dismissed") return item.status === "dismissed";
  if (tab === "approved") return item.active;
  return item.status === "pending" || item.status === "review";
}

const STATUS_PILL: Record<AnswerReview["status"], { label: string; className: string }> = {
  pending: { label: "Sin respuesta", className: "bg-muted text-muted-foreground" },
  review: { label: "Por aprobar", className: "bg-amber-500/12 text-amber-600" },
  approved: { label: "Aprobada", className: "bg-emerald-500/12 text-emerald-600" },
  dismissed: { label: "Descartada", className: "bg-muted text-muted-foreground" },
};

function sourceLabel(item: AnswerReview): string {
  if (item.source === "knowledge") return "Base de conocimiento";
  if (item.source === "chats") return item.frequency ? `En los chats · ~${item.frequency} veces` : "En los chats";
  return "Agregada por el equipo";
}

function shortDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("es-DO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Cómo le llegaría la respuesta al cliente: el texto, las imágenes y fotos que la
// acompañan y los botones; y, si escala, que la conversación pasa a una persona.
function AnswerBubble({ item }: { item: AnswerReview }) {
  const preview = item.preview;
  if (!preview) return null;
  return (
    <div className="space-y-2">
      {preview.text ? (
        <div className="rounded-lg rounded-tl-none bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-foreground whitespace-pre-wrap break-words">
          {preview.text}
        </div>
      ) : null}
      {preview.images.map((img) => (
        <figure key={img.key} className="rounded-lg border border-card-border overflow-hidden w-fit max-w-full bg-card">
          <img src={withBase(img.url)} alt={img.key} className="max-h-48 w-auto object-contain" />
          {img.caption && <figcaption className="px-2 py-1 text-xs text-muted-foreground whitespace-pre-wrap">{img.caption}</figcaption>}
        </figure>
      ))}
      {preview.photos.map((p) => (
        <figure key={p.slug} className="rounded-lg border border-card-border overflow-hidden w-fit max-w-full bg-card">
          {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="max-h-48 w-auto object-contain" /> : null}
          <figcaption className="px-2 py-1 text-xs text-muted-foreground">Foto de {p.name}</figcaption>
        </figure>
      ))}
      {preview.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {preview.options.map((o) => (
            <span key={o} className="px-2.5 py-1 rounded-full border border-primary/30 text-xs text-primary bg-primary/5">
              {o}
            </span>
          ))}
        </div>
      )}
      {preview.escalates && (
        <p className="inline-flex items-center gap-1.5 text-xs text-amber-600">
          <UserRound className="w-3.5 h-3.5" /> Pasa la conversación a una persona del equipo
          {preview.text ? "" : " sin decirle nada al cliente"}.
        </p>
      )}
    </div>
  );
}

function QuestionCard({
  item,
  agents,
  aiAvailable,
  onTouched,
}: {
  item: AnswerReview;
  agents: AnswerTrainingAgent[];
  aiAvailable: boolean;
  onTouched: (id: number) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refresh = () => {
    onTouched(item.id);
    return queryClient.invalidateQueries({ queryKey: getListAnswerReviewsQueryKey() });
  };
  const fail = (title: string) => (err: unknown) => toast({ title, description: apiErrorMessage(err, "Vuelve a intentarlo."), variant: "destructive" });

  const update = useUpdateAnswerReview();
  const remove = useDeleteAnswerReview();
  const processAnswer = useProcessAnswerReview();
  const regenerate = useRegenerateAnswerReview();
  const approve = useApproveAnswerReview();

  const [indications, setIndications] = useState(item.indications ?? "");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setIndications(item.indications ?? "");
  }, [item.indications, dirty]);

  const [editingQuestion, setEditingQuestion] = useState(false);
  const [questionText, setQuestionText] = useState(item.question);
  const [editingInstruction, setEditingInstruction] = useState(false);
  const [instructionText, setInstructionText] = useState(item.instruction ?? "");

  const save = (data: AnswerReviewUpdate, done?: string, after?: () => void) =>
    update.mutate(
      { id: item.id, data },
      {
        onSuccess: () => {
          refresh();
          after?.();
          if (done) toast({ title: done });
        },
        onError: fail("No se pudo guardar"),
      },
    );

  const busy = item.generating || processAnswer.isPending || regenerate.isPending;
  const agentName = agents.find((a) => a.id === item.agentId)?.name;
  const pill = STATUS_PILL[item.status];
  const changedSinceApproval = item.active && item.status === "review";

  const runProcess = () =>
    processAnswer.mutate(
      { id: item.id, data: { indications: indications.trim() || null } },
      {
        onSuccess: () => {
          setDirty(false);
          refresh();
          toast({ title: indications.trim() ? "Respuesta rehecha con tus indicaciones" : "Respuesta actualizada" });
        },
        onError: fail("No se pudo procesar"),
      },
    );

  return (
    <div className="bg-card border border-card-border rounded-xl p-4 space-y-4" data-testid={`answer-review-${item.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1.5 min-w-0 flex-1">
          {editingQuestion ? (
            <div className="flex gap-2">
              <Input value={questionText} onChange={(e) => setQuestionText(e.target.value)} maxLength={500} data-testid={`input-question-${item.id}`} />
              <Button size="sm" disabled={!questionText.trim() || update.isPending} onClick={() => save({ question: questionText.trim() }, "Pregunta actualizada", () => setEditingQuestion(false))}>
                Guardar
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setQuestionText(item.question); setEditingQuestion(false); }}>
                Cancelar
              </Button>
            </div>
          ) : (
            <p className="text-sm font-semibold text-foreground">{item.question}</p>
          )}
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", pill.className)}>{pill.label}</span>
            {item.category && <span className="px-2 py-0.5 rounded-full bg-muted text-[11px]">{item.category}</span>}
            <span>{sourceLabel(item)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Select
            value={item.agentId != null ? String(item.agentId) : undefined}
            onValueChange={(v) => save({ agentId: Number(v) })}
          >
            <SelectTrigger className="h-8 w-[240px] text-xs" data-testid={`select-agent-${item.id}`}>
              <SelectValue placeholder="Probar con…" />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                  Probar con {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" data-testid={`button-question-menu-${item.id}`}>
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditingQuestion(true)}>Editar la pregunta</DropdownMenuItem>
              {item.status === "dismissed" ? (
                <DropdownMenuItem onClick={() => save({ status: "pending" }, "Pregunta recuperada")}>Recuperar</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => save({ status: "dismissed" }, item.active ? "Descartada: los agentes dejan de leer su instrucción" : "Pregunta descartada")}>
                  Descartar
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  if (!window.confirm("¿Eliminar esta pregunta? Si tiene una instrucción aprobada, los agentes dejan de leerla.")) return;
                  remove.mutate({ id: item.id }, { onSuccess: () => { refresh(); toast({ title: "Pregunta eliminada" }); }, onError: fail("No se pudo eliminar") });
                }}
              >
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
              <Bot className="w-3.5 h-3.5" /> Cómo responde {agentName ?? "el agente"}
            </p>
            {item.answer && !busy && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs"
                disabled={!aiAvailable}
                onClick={() => regenerate.mutate({ id: item.id }, { onSuccess: () => { refresh(); toast({ title: "Esta es la respuesta que da hoy" }); }, onError: fail("No se pudo preguntar al agente") })}
                data-testid={`button-regenerate-${item.id}`}
                title="Preguntarle de nuevo, sin indicaciones: lo que contestaría hoy en un chat"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Preguntar de nuevo
              </Button>
            )}
          </div>
          {busy ? (
            <div className="rounded-lg border border-dashed border-card-border p-6 text-center text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin inline mr-1.5" />
              {processAnswer.isPending ? "Rehaciendo la respuesta con tus indicaciones…" : "Preguntándole al agente…"}
            </div>
          ) : item.answer ? (
            <>
              <AnswerBubble item={item} />
              {item.answeredAt && <p className="text-[11px] text-muted-foreground">Generada {shortDate(item.answeredAt)}</p>}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-card-border p-6 text-center space-y-2">
              <p className="text-sm text-muted-foreground">{item.generationError ?? "Todavía no le preguntamos al agente."}</p>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={!aiAvailable}
                onClick={() => regenerate.mutate({ id: item.id }, { onSuccess: refresh, onError: fail("No se pudo preguntar al agente") })}
                data-testid={`button-first-answer-${item.id}`}
              >
                <Sparkles className="w-3.5 h-3.5" /> Ver cómo responde
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
            <Wand2 className="w-3.5 h-3.5" /> Indicaciones para el agente
          </p>
          <Textarea
            value={indications}
            onChange={(e) => { setIndications(e.target.value); setDirty(true); }}
            rows={5}
            maxLength={2000}
            placeholder="Ej.: Más corto. Da el precio en dólares y pregunta a dónde se lo enviamos. No menciones el envío gratis."
            className="text-sm"
            data-testid={`input-indications-${item.id}`}
          />
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="gap-1" disabled={busy || !aiAvailable} onClick={runProcess} data-testid={`button-process-${item.id}`}>
              {processAnswer.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Procesar
            </Button>
            <Button
              size="sm"
              className="gap-1"
              disabled={busy || approve.isPending || !item.answer || dirty || (item.active && item.status === "approved")}
              title={dirty ? "Procesa primero tus indicaciones para ver la respuesta que vas a aprobar" : undefined}
              onClick={() =>
                approve.mutate(
                  { id: item.id },
                  { onSuccess: () => { refresh(); toast({ title: "Aprobada: desde ahora los agentes responden así" }); }, onError: fail("No se pudo aprobar") },
                )
              }
              data-testid={`button-approve-${item.id}`}
            >
              {approve.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Aprobar
            </Button>
          </div>
          {dirty && <p className="text-[11px] text-muted-foreground text-right">Dale a Procesar para ver la respuesta con estas indicaciones antes de aprobarla.</p>}
        </div>
      </div>

      {item.instruction && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2.5 space-y-2",
            item.active ? "border-emerald-500/30 bg-emerald-500/5" : "border-card-border bg-muted/30",
          )}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
              <GraduationCap className="w-3.5 h-3.5" />
              {item.active ? "Instrucción que leen los agentes" : "Instrucción apagada"}
              {item.approvedAt && (
                <span className="normal-case font-normal tracking-normal">
                  · aprobada {shortDate(item.approvedAt)}
                  {item.approvedByName ? ` por ${item.approvedByName}` : ""}
                </span>
              )}
            </p>
            <div className="flex items-center gap-1">
              {!editingInstruction && (
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => { setInstructionText(item.instruction ?? ""); setEditingInstruction(true); }} data-testid={`button-instruction-edit-${item.id}`}>
                  <Pencil className="w-3.5 h-3.5" /> Editar
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs"
                disabled={update.isPending}
                onClick={() => save({ active: !item.active }, item.active ? "Los agentes dejan de leer esta instrucción" : "Los agentes vuelven a leer esta instrucción")}
                data-testid={`button-instruction-toggle-${item.id}`}
              >
                <Power className="w-3.5 h-3.5" /> {item.active ? "Apagar" : "Encender"}
              </Button>
            </div>
          </div>
          {editingInstruction ? (
            <div className="space-y-2">
              <Textarea value={instructionText} onChange={(e) => setInstructionText(e.target.value)} rows={4} maxLength={2000} className="text-sm" data-testid={`input-instruction-${item.id}`} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingInstruction(false)}>Cancelar</Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!instructionText.trim() || update.isPending}
                  onClick={() => save({ instruction: instructionText.trim() }, "Instrucción actualizada", () => setEditingInstruction(false))}
                >
                  Guardar
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-foreground whitespace-pre-wrap break-words">{item.instruction}</p>
          )}
          {changedSinceApproval && (
            <p className="text-[11px] text-amber-600">Hay una respuesta nueva sin aprobar; mientras tanto los agentes siguen con esta instrucción.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AnswerTrainingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListAnswerReviewsQueryKey() });
  const { data, isLoading } = useListAnswerReviews({
    query: {
      queryKey: getListAnswerReviewsQueryKey(),
      // Mientras haya respuestas generándose en segundo plano, se van mostrando.
      refetchInterval: (query) => (query.state.data?.items.some((i) => i.generating) ? 3000 : false),
    },
  });
  const items = data?.items ?? [];
  const agents = data?.agents ?? [];
  const aiAvailable = data?.aiAvailable ?? true;

  const [tab, setTab] = useState<Tab>("review");
  // Lo que el equipo acaba de tocar se queda a la vista aunque ya no sea de esta
  // pestaña (una pregunta aprobada sale de "Por revisar"): si desapareciera al
  // instante no se vería la instrucción que se guardó. Se limpia al cambiar de pestaña.
  const [touched, setTouched] = useState<ReadonlySet<number>>(new Set());
  const touch = (id: number) => setTouched((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  const changeTab = (next: Tab) => {
    setTab(next);
    setTouched(new Set());
  };
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const create = useCreateAnswerReview();
  const importQuestions = useImportAnswerQuestions();
  const generatePending = useGeneratePendingAnswers();

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.key, items.filter((i) => inTab(i, t.key)).length])) as Record<Tab, number>,
    [items],
  );
  const pendingCount = items.filter((i) => i.status === "pending" && !i.generating).length;
  const generatingCount = items.filter((i) => i.generating).length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => inTab(i, tab) || touched.has(i.id))
      .filter((i) => !q || [i.question, i.category ?? "", i.instruction ?? "", i.preview?.text ?? ""].some((s) => s.toLowerCase().includes(q)));
  }, [items, tab, search, touched]);

  // Cada pregunta nueva se le pregunta al agente enseguida: la vista es para ver
  // cómo responde, no una lista vacía.
  const answerNew = () =>
    generatePending.mutate(undefined, {
      onSuccess: (r) => {
        refresh();
        if (r.queued) toast({ title: `Preguntándole al agente ${r.queued === 1 ? "1 pregunta" : `${r.queued} preguntas`}…` });
      },
    });

  const runImport = (source: "knowledge" | "chats") =>
    importQuestions.mutate(
      { data: { source } },
      {
        onSuccess: (r) => {
          refresh();
          toast({
            title: r.added
              ? `Se agregaron ${r.added} ${r.added === 1 ? "pregunta" : "preguntas"}`
              : "No hay preguntas nuevas",
            description:
              source === "knowledge"
                ? `${r.found} en la base de conocimiento de los agentes.`
                : `La IA leyó ${r.scanned ?? 0} mensajes de clientes de los últimos 30 días y encontró ${r.found}.`,
          });
          if (r.added && aiAvailable) answerNew();
        },
        onError: (err) => toast({ title: "No se pudieron traer las preguntas", description: apiErrorMessage(err, "Vuelve a intentarlo."), variant: "destructive" }),
      },
    );

  const addQuestion = () =>
    create.mutate(
      { data: { question: newQuestion.trim(), category: newCategory.trim() || null } },
      {
        onSuccess: () => {
          setNewQuestion("");
          setNewCategory("");
          setAdding(false);
          changeTab("review");
          refresh();
          if (aiAvailable) answerNew();
        },
        onError: (err) => toast({ title: "No se pudo agregar", description: apiErrorMessage(err, "Vuelve a intentarlo."), variant: "destructive" }),
      },
    );

  return (
    <Layout>
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Entrenar respuestas</h1>
          <p className="text-sm text-muted-foreground">
            Las preguntas que más hacen los clientes y cómo las responde hoy el agente. Escríbele indicaciones, dale a Procesar para ver la respuesta
            corregida y apruébala: la IA guarda la instrucción y desde ese momento los agentes responden así en los chats.
          </p>
        </div>

        {!aiAvailable && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 inline-flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> La IA no está configurada en este servidor: se pueden ver y editar las preguntas, pero no generar respuestas.
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" className="gap-1" onClick={() => setAdding(true)} data-testid="button-add-question">
            <Plus className="w-4 h-4" /> Agregar pregunta
          </Button>
          <Button size="sm" variant="outline" className="gap-1" disabled={importQuestions.isPending} onClick={() => runImport("knowledge")} data-testid="button-import-knowledge">
            {importQuestions.isPending && importQuestions.variables?.data.source === "knowledge" ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
            Traer de la base de conocimiento
          </Button>
          <Button size="sm" variant="outline" className="gap-1" disabled={importQuestions.isPending || !aiAvailable} onClick={() => runImport("chats")} data-testid="button-import-chats">
            {importQuestions.isPending && importQuestions.variables?.data.source === "chats" ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessagesSquare className="w-4 h-4" />}
            Detectar en los chats
          </Button>
          {(pendingCount > 0 || generatingCount > 0) && (
            <Button size="sm" variant="outline" className="gap-1" disabled={generatingCount > 0 || generatePending.isPending || !aiAvailable} onClick={answerNew} data-testid="button-generate-pending">
              {generatingCount > 0 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generatingCount > 0 ? `Generando ${generatingCount}…` : `Generar las que faltan (${pendingCount})`}
            </Button>
          )}
        </div>

        {adding && (
          <div className="bg-card border border-card-border rounded-xl p-4 flex gap-2 flex-wrap items-center">
            <Input
              autoFocus
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newQuestion.trim()) addQuestion(); }}
              placeholder="¿Qué pregunta el cliente? Ej.: ¿Cuánto tarda en llegar a Santiago?"
              maxLength={500}
              className="flex-1 min-w-[240px]"
              data-testid="input-new-question"
            />
            <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Categoría (opcional)" maxLength={80} className="w-48" />
            <Button size="sm" disabled={!newQuestion.trim() || create.isPending} onClick={addQuestion} data-testid="button-save-question">
              {create.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />} Agregar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancelar</Button>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-card border border-card-border rounded-lg p-1 flex-wrap w-fit">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => changeTab(t.key)}
                data-testid={`tab-answer-${t.key}`}
                className={cn(
                  "text-xs font-medium px-3 py-1.5 rounded-md transition-colors",
                  tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {t.label} {counts[t.key] ? `(${counts[t.key]})` : ""}
              </button>
            ))}
          </div>
          {items.length > 3 && (
            <div className="relative">
              <Search className="w-4 h-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar pregunta, categoría o respuesta" className="h-9 pl-8 w-72" data-testid="input-search-answers" />
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 rounded-xl bg-muted/40 animate-pulse" />)}</div>
        ) : items.length === 0 ? (
          <div className="bg-card border border-card-border rounded-xl p-10 text-center space-y-3">
            <GraduationCap className="w-8 h-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Todavía no hay preguntas. Tráelas de la base de conocimiento de los agentes, deja que la IA detecte las que más se repiten en los chats o
              agrega una a mano.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="bg-card border border-card-border rounded-xl p-10 text-center">
            <p className="text-sm text-muted-foreground">{search ? "Ninguna pregunta coincide con la búsqueda." : "No hay preguntas aquí."}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((item) => (
              <QuestionCard key={item.id} item={item} agents={agents} aiAvailable={aiAvailable} onTouched={touch} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
