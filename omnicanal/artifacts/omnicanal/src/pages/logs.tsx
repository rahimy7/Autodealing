import { useState } from "react";
import { useListErrorLogs, useClearErrorLogs, getListErrorLogsQueryKey } from "@workspace/api-client-react";
import type { ErrorLog } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCcw, Search, Trash2 } from "lucide-react";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Los errores se consultan solos mientras la página está abierta: quien la tiene
// delante suele estar esperando a ver si algo vuelve a fallar.
const POLL_MS = 15_000;

const LEVELS = [
  { value: "all", label: "Todos" },
  { value: "error", label: "Errores" },
  { value: "fatal", label: "Fatales" },
] as const;

type LevelFilter = (typeof LEVELS)[number]["value"];

function formatWhen(value: string): string {
  const date = new Date(value);
  return date.toLocaleString("es-DO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// El detalle se guarda como JSON en una sola línea; leerlo así no hay quien pueda.
function prettyDetail(detail: string): string {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}

function LogRow({ log }: { log: ErrorLog }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="border-b border-border last:border-0" data-testid={`log-${log.id}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-3 hover:bg-muted/50 flex items-start gap-3"
      >
        <Chevron className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                log.level === "fatal" ? "bg-red-500/15 text-red-600" : "bg-orange-500/15 text-orange-600",
              )}
            >
              {log.level}
            </span>
            <span className="font-medium text-foreground break-words">{log.message}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            <span>{formatWhen(log.createdAt)}</span>
            {log.url ? (
              <span className="font-mono">
                {log.method} {log.url}
              </span>
            ) : null}
            {log.requestId ? <span className="font-mono">#{log.requestId}</span> : null}
          </div>
        </div>
      </button>

      {open ? (
        <div className="px-4 pb-4 pl-11">
          {log.detail ? (
            <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-words">
              {prettyDetail(log.detail)}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">Sin detalle.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function LogsPage() {
  const [level, setLevel] = useState<LevelFilter>("all");
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmClear, setConfirmClear] = useState(false);

  const params = { level, search: search.trim() || undefined };
  const { data: logs, isLoading, isFetching, refetch } = useListErrorLogs(params, {
    query: {
      queryKey: getListErrorLogsQueryKey(params),
      refetchInterval: POLL_MS,
      staleTime: 0,
    },
  });
  const clearLogs = useClearErrorLogs();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListErrorLogsQueryKey() });

  const submitClear = () =>
    clearLogs.mutate(undefined, {
      onSuccess: (result) => {
        setConfirmClear(false);
        invalidate();
        toast({ title: `Se borraron ${result.deleted} registros` });
      },
      onError: () => toast({ title: "No se pudieron borrar", variant: "destructive" }),
    });

  return (
    <Layout>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-primary" /> Errores del sistema
            </h1>
            <p className="text-sm text-muted-foreground">
              Lo que falló en el servidor, sin entrar al hosting. Se guardan 14 días.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void refetch()} className="gap-2" data-testid="button-refresh-logs">
              <RefreshCcw className={cn("w-4 h-4", isFetching && "animate-spin")} /> Actualizar
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmClear(true)}
              className="gap-2 text-destructive"
              data-testid="button-clear-logs"
            >
              <Trash2 className="w-4 h-4" /> Vaciar
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {LEVELS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setLevel(option.value)}
                className={cn(
                  "text-xs font-medium px-3 py-1.5 rounded-md transition-colors",
                  level === option.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`filter-level-${option.value}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar en el mensaje, el detalle o la ruta"
              className="pl-9"
              data-testid="input-search-logs"
            />
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : (logs ?? []).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {search || level !== "all" ? "Nada que coincida con el filtro." : "Ningún error registrado."}
            </p>
          ) : (
            (logs ?? []).map((log) => <LogRow key={log.id} log={log} />)
          )}
        </div>
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vaciar el registro de errores</DialogTitle>
            <DialogDescription>
              Se borran todos los errores guardados. Los que ocurran después se seguirán registrando.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={submitClear} disabled={clearLogs.isPending}>
              Vaciar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
