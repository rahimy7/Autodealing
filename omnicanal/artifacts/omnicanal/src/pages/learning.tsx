import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAgentLessons,
  useUpdateAgentLesson,
  getListAgentLessonsQueryKey,
  type AgentLesson,
  type AgentLessonStatus,
} from "@workspace/api-client-react";
import { Brain, Check, ExternalLink, Loader2, Pencil, UserRound, Bot, X, Frown, UserCheck } from "lucide-react";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Aprendizajes: lo que los agentes virtuales aprendieron de chats reales donde una
// respuesta frustró al cliente o una persona del equipo la corrigió. Se entra por
// las sugeridas, que son las que esperan una decisión; las activas ya las leen
// los agentes.
const TABS: Array<{ key: AgentLessonStatus | "all"; label: string }> = [
  { key: "suggested", label: "Sugeridas" },
  { key: "active", label: "Activas" },
  { key: "dismissed", label: "Descartadas" },
  { key: "all", label: "Todas" },
];

const STATUS_LABELS: Record<AgentLessonStatus, string> = {
  suggested: "Sugerida",
  active: "Activa",
  dismissed: "Descartada",
};

const STATUS_STYLES: Record<AgentLessonStatus, string> = {
  suggested: "bg-amber-500/12 text-amber-600",
  active: "bg-emerald-500/12 text-emerald-600",
  dismissed: "bg-muted text-muted-foreground",
};

const SIGNAL_LABELS = {
  frustration: { label: "El cliente se frustró", Icon: Frown },
  human_correction: { label: "Una persona lo corrigió", Icon: UserCheck },
} as const;

function shortDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("es-DO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function LessonCard({ lesson }: { lesson: AgentLesson }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const update = useUpdateAgentLesson();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(lesson.lesson);

  const save = (data: { status?: AgentLessonStatus; lesson?: string }, done: string) => {
    update.mutate(
      { id: lesson.id, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAgentLessonsQueryKey() });
          setEditing(false);
          toast({ title: done });
        },
        onError: () => toast({ title: "No se pudo guardar", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="bg-card border border-card-border rounded-xl p-4 space-y-3" data-testid={`lesson-${lesson.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", STATUS_STYLES[lesson.status])}>
            {STATUS_LABELS[lesson.status]}
          </span>
          <span className="text-xs text-muted-foreground">
            Visto en {lesson.occurrences} {lesson.occurrences === 1 ? "conversación" : "conversaciones"} · último {shortDate(lesson.lastSeenAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {!editing && (
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setEditing(true)} data-testid={`button-lesson-edit-${lesson.id}`}>
              <Pencil className="w-3.5 h-3.5" /> Editar
            </Button>
          )}
          {lesson.status !== "active" && (
            <Button
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={update.isPending}
              onClick={() => save({ status: "active" }, "Los agentes ya aplican este aprendizaje")}
              data-testid={`button-lesson-activate-${lesson.id}`}
            >
              <Check className="w-3.5 h-3.5" /> Activar
            </Button>
          )}
          {lesson.status !== "dismissed" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              disabled={update.isPending}
              onClick={() => save({ status: "dismissed" }, "Aprendizaje descartado")}
              data-testid={`button-lesson-dismiss-${lesson.id}`}
            >
              <X className="w-3.5 h-3.5" /> Descartar
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={400} className="text-sm" data-testid={`input-lesson-${lesson.id}`} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setText(lesson.lesson); setEditing(false); }}>Cancelar</Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={!text.trim() || update.isPending}
              onClick={() => save({ lesson: text.trim() }, "Aprendizaje actualizado")}
              data-testid={`button-lesson-save-${lesson.id}`}
            >
              {update.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Guardar
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm font-medium text-foreground leading-relaxed">{lesson.lesson}</p>
      )}
      {lesson.diagnosis && <p className="text-xs text-muted-foreground">Qué pasó: {lesson.diagnosis}</p>}

      {lesson.evidence.length > 0 && (
        <div className="space-y-2 border-t border-card-border pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Comparación en chats reales</p>
          {lesson.evidence.map((e) => {
            const signal = SIGNAL_LABELS[e.signal];
            return (
              <div key={e.id} className="rounded-lg border border-card-border/70 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <signal.Icon className="w-3.5 h-3.5" /> {signal.label}
                    {e.contactName ? ` · ${e.contactName}` : ""} · {shortDate(e.createdAt)}
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    onClick={() => setLocation(`/inbox?conv=${e.conversationId}`)}
                    data-testid={`button-lesson-evidence-chat-${e.id}`}
                  >
                    <ExternalLink className="w-3 h-3" /> Ver el chat
                  </button>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  <div className="rounded-md bg-muted/50 px-3 py-2">
                    <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground mb-1"><Bot className="w-3 h-3" /> Respondió el agente</div>
                    <p className="text-sm text-foreground whitespace-pre-wrap break-words">{e.aiReply}</p>
                  </div>
                  <div className="rounded-md bg-primary/5 px-3 py-2">
                    <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground mb-1">
                      <UserRound className="w-3 h-3" /> {e.signal === "frustration" ? "Reaccionó el cliente" : "Escribió la persona"}
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap break-words">{e.reaction}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function LearningPage() {
  const [tab, setTab] = useState<AgentLessonStatus | "all">("suggested");
  const { data: lessons, isLoading } = useListAgentLessons(tab === "all" ? {} : { status: tab });
  const rows = lessons ?? [];

  return (
    <Layout>
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Aprendizajes</h1>
          <p className="text-sm text-muted-foreground">
            Lo que los agentes virtuales aprendieron de chats reales: respuestas que frustraron al cliente o que una persona tuvo que corregir.
            Una sugerida se activa sola cuando se repite en otra conversación; las activas las leen todos los agentes.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-card border border-card-border rounded-lg p-1 flex-wrap w-fit">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              data-testid={`tab-lesson-status-${t.key}`}
              className={cn(
                "text-xs font-medium px-3 py-1.5 rounded-md transition-colors",
                tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 rounded-xl bg-muted/40 animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <div className="bg-card border border-card-border rounded-xl p-10 text-center">
            <Brain className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {tab === "suggested" ? "No hay aprendizajes esperando revisión." : "No hay aprendizajes aquí."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">{rows.map((l) => <LessonCard key={`${l.id}-${l.lesson}`} lesson={l} />)}</div>
        )}
      </div>
    </Layout>
  );
}
