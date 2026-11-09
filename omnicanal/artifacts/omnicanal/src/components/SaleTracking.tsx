import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useMarkConversationSale,
  useListConversationFollowups,
  useCancelConversationFollowup,
  useListProducts,
  getListConversationFollowupsQueryKey,
  getListConversationsQueryKey,
  getListProductsQueryKey,
  getListMessagesQueryKey,
  type Conversation,
  type Followup,
} from "@workspace/api-client-react";
import { BadgeCheck, CalendarClock, Loader2, ShoppingBag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// "Venta cerrada" y los seguimientos de la conversación. Marcarla es lo que le
// dice al sistema que no hay venta que recuperar y que toca el post-venta; la IA
// también la detecta al cerrarse el chat, pero lo que marca una persona manda.
// Lo comparten las tres bandejas que atienden (admin, agente, Chat General).

const KIND_LABELS: Record<Followup["kind"], string> = {
  winback: "Recuperar venta",
  delivery_check: "Confirmar entrega",
  satisfaction: "Encuesta de satisfacción",
  repurchase: "Recordatorio de recompra",
  unanswered: "Respuesta pendiente",
};

const STATUS_LABELS: Record<Followup["status"], { label: string; className: string }> = {
  scheduled: { label: "Programado", className: "bg-sky-500/15 text-sky-600" },
  sent: { label: "Enviado", className: "bg-emerald-500/15 text-emerald-600" },
  replied: { label: "Respondió", className: "bg-violet-500/15 text-violet-600" },
  skipped: { label: "Omitido", className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelado", className: "bg-muted text-muted-foreground" },
  failed: { label: "Falló", className: "bg-red-500/15 text-red-600" },
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("es-DO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function saleThisSession(conv: Conversation): boolean {
  if (!conv.saleClosedAt) return false;
  return new Date(conv.saleClosedAt).getTime() >= new Date(conv.sessionStartedAt).getTime();
}

export function SaleTrackingButton({ conversation }: { conversation: Conversation }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState("");

  const marked = saleThisSession(conversation);
  const markSale = useMarkConversationSale();
  const cancelFollowup = useCancelConversationFollowup();
  const { data: followups, isLoading } = useListConversationFollowups(conversation.id, {
    query: { enabled: open, queryKey: getListConversationFollowupsQueryKey(conversation.id) },
  });
  // El catálogo solo sugiere nombres: el producto se puede escribir libre.
  const { data: products } = useListProducts(undefined, {
    query: { enabled: open, retry: false, queryKey: getListProductsQueryKey() },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversation.id) });
    queryClient.invalidateQueries({ queryKey: getListConversationFollowupsQueryKey(conversation.id) });
  };

  const fail = (title: string) => (err: unknown) =>
    toast({ title, description: err instanceof Error ? err.message : "Inténtalo de nuevo.", variant: "destructive" });

  const submit = (closed: boolean) =>
    markSale.mutate(
      { id: conversation.id, data: { closed, product: closed ? product.trim() || null : null } },
      {
        onSuccess: () => {
          refresh();
          setProduct("");
          toast({
            title: closed ? "Venta marcada como cerrada" : "Venta desmarcada",
            description: closed
              ? "Se programó el seguimiento post-venta si hay un flujo activo para ello."
              : "Se cancelaron los seguimientos post-venta pendientes.",
          });
        },
        onError: fail("No se pudo actualizar la venta"),
      },
    );

  const pending = (followups ?? []).filter((f) => f.status === "scheduled").length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            marked
              ? "bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm"
              : "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20",
          )}
          title={marked ? "Venta cerrada en esta conversación" : "Marcar esta conversación como venta cerrada"}
          data-testid="button-sale-tracking"
        >
          {marked ? <BadgeCheck className="w-3.5 h-3.5" /> : <ShoppingBag className="w-3.5 h-3.5" />}
          {marked ? "Vendido" : "Venta cerrada"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        {marked ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">Venta cerrada</p>
            <p className="text-xs text-muted-foreground">
              {conversation.saleProduct ? <span className="font-medium text-foreground">{conversation.saleProduct}</span> : "Sin producto indicado"}
              {" · "}
              {conversation.saleSource === "ai" ? "detectada por la IA" : "marcada por el equipo"}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={markSale.isPending}
              onClick={() => submit(false)}
              data-testid="button-unmark-sale"
            >
              {markSale.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              No hubo venta: desmarcar
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">¿Cerraste la venta?</p>
            <p className="text-xs text-muted-foreground">
              Arranca el seguimiento post-venta (entrega, satisfacción y recompra) y cancela el intento de recuperación.
            </p>
            <Input
              list={`sale-products-${conversation.id}`}
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="Producto vendido (opcional)"
              className="h-8 text-xs"
              data-testid="input-sale-product"
            />
            <datalist id={`sale-products-${conversation.id}`}>
              {(products ?? []).map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <Button
              size="sm"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={markSale.isPending}
              onClick={() => submit(true)}
              data-testid="button-mark-sale"
            >
              {markSale.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Marcar venta cerrada
            </Button>
          </div>
        )}

        <div className="space-y-2 border-t border-card-border pt-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <CalendarClock className="w-3.5 h-3.5" /> Seguimientos{pending ? ` · ${pending} pendiente${pending === 1 ? "" : "s"}` : ""}
          </p>
          {isLoading && <p className="text-xs text-muted-foreground">Cargando…</p>}
          {!isLoading && (followups ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">Ninguno todavía.</p>
          )}
          <ul className="space-y-1.5 max-h-56 overflow-y-auto">
            {(followups ?? []).map((f) => (
              <li key={f.id} className="flex items-start gap-2 rounded-lg border border-card-border px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-foreground truncate">{KIND_LABELS[f.kind]}</span>
                    <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full", STATUS_LABELS[f.status].className)}>
                      {STATUS_LABELS[f.status].label}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {f.status === "scheduled" ? `Sale el ${when(f.dueAt)}` : f.sentAt ? `Enviado el ${when(f.sentAt)}` : when(f.dueAt)}
                    {f.agentName ? ` · ${f.agentName}` : ""}
                  </p>
                  {f.detail && f.status !== "sent" && <p className="text-[10px] text-muted-foreground/80">{f.detail}</p>}
                </div>
                {f.status === "scheduled" && (
                  <button
                    type="button"
                    className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                    title="Cancelar este seguimiento"
                    disabled={cancelFollowup.isPending}
                    onClick={() =>
                      cancelFollowup.mutate(
                        { id: conversation.id, followupId: f.id },
                        { onSuccess: refresh, onError: fail("No se pudo cancelar") },
                      )
                    }
                    data-testid={`button-cancel-followup-${f.id}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
