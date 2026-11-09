import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListReturns,
  getListReturnsQueryKey,
  useCreateReturn,
  useReceiveReturn,
  useCancelReturn,
  useGetReturnableLines,
  getGetReturnableLinesQueryKey,
  useListOrders,
  getListOrdersQueryKey,
  type Return,
  type ReturnCondition,
  type ReturnResolution,
  type ReturnStatus,
} from "@workspace/api-client-react";
import { Plus, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiErrorMessage, centsToInput, formatCents, formatDateTime, invalidateApi, parseCents } from "@/lib/money";

const STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: "Por recibir",
  received: "Recibida",
  closed: "Cerrada",
  cancelled: "Cancelada",
};

const STATUS_STYLES: Record<ReturnStatus, string> = {
  requested: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  received: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  closed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

const RESOLUTION_LABELS: Record<ReturnResolution, string> = {
  credit_note: "Nota de crédito (saldo a favor)",
  refund: "Devolver el dinero",
  replacement: "Reponer el producto",
  none: "Sin compensación",
};

/** El pedido a devolver: se busca por código, #Shopify o cliente. */
function OrderSearch({ onPick }: { onPick: (order: { id: number; code: string; contactName: string | null }) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const params = { search: debounced || undefined };
  const { data: orders } = useListOrders(params, { query: { enabled: debounced.length > 1, queryKey: getListOrdersQueryKey(params) } });
  const shipped = (orders ?? []).filter((o) => o.stockOut || o.status === "shipped" || o.status === "delivered");
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pedido (PED-…, #Shopify) o cliente…" className="pl-8" data-testid="input-return-order-search" />
      </div>
      {debounced.length > 1 && (
        <div className="border border-card-border rounded-lg divide-y divide-card-border max-h-48 overflow-y-auto">
          {shipped.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Ningún pedido despachado coincide.</p>}
          {shipped.slice(0, 10).map((o) => (
            <button key={o.id} type="button" onClick={() => onPick({ id: o.id, code: o.code, contactName: o.contactName ?? null })} className="w-full text-left px-3 py-2 text-sm hover:bg-muted">
              <span className="font-medium">{o.code}</span> · {o.contactName ?? "Sin nombre"} <span className="text-xs text-muted-foreground">· {o.product}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewReturnDialog({
  open,
  onOpenChange,
  initialOrderId,
  caseId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialOrderId: number | null;
  caseId: number | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateReturn();
  const [orderId, setOrderId] = useState<number | null>(initialOrderId);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [condition, setCondition] = useState<Record<string, ReturnCondition>>({});
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (open) {
      setOrderId(initialOrderId);
      setQty({});
      setCondition({});
      setReason("");
      setNotes("");
    }
  }, [open, initialOrderId]);
  const params = { orderId: orderId ?? 0 };
  const { data: returnable, error } = useGetReturnableLines(params, { query: { enabled: orderId != null, queryKey: getGetReturnableLinesQueryKey(params) } });
  const keyOf = (l: { orderItemId: number; productId: number; lotId?: number | null }) => `${l.orderItemId}:${l.productId}:${l.lotId ?? "-"}`;

  const submit = () => {
    if (!returnable) return;
    const lines = returnable.lines
      .map((l) => ({ orderItemId: l.orderItemId, productId: l.productId, lotId: l.lotId ?? null, quantity: Number(qty[keyOf(l)] || 0), condition: condition[keyOf(l)] ?? "restock" }))
      .filter((l) => l.quantity > 0);
    if (lines.length === 0) {
      toast({ title: "Pon cuántas unidades vuelven", variant: "destructive" });
      return;
    }
    create.mutate(
      { data: { orderId: returnable.orderId, caseId, reason: reason.trim() || null, notes: notes.trim() || null, lines } },
      {
        onSuccess: (r) => {
          void invalidateApi(queryClient, "/api/returns", "/api/orders");
          toast({ title: `Devolución ${r.code} abierta`, description: "Recíbela cuando llegue la mercancía." });
          onOpenChange(false);
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo abrir la devolución"), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva devolución</DialogTitle>
          <DialogDescription>Lo que vuelve en buen estado entra al mismo lote y con el costo con que salió; lo dañado queda como merma.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {orderId == null ? (
            <OrderSearch onPick={(o) => setOrderId(o.id)} />
          ) : (
            <div className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2 text-sm">
              <span>
                Pedido <span className="font-medium">{returnable?.orderCode ?? `#${orderId}`}</span>
                {caseId != null && <span className="text-xs text-muted-foreground"> · desde el caso CASO-{String(caseId).padStart(6, "0")}</span>}
              </span>
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => setOrderId(null)}>
                Cambiar
              </button>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{apiErrorMessage(error, "No se pudo leer el pedido.")}</p>}
          {returnable && returnable.lines.length === 0 && <p className="text-sm text-muted-foreground">De este pedido no queda nada por devolver (no ha salido o ya volvió todo).</p>}
          {returnable && returnable.lines.length > 0 && (
            <div className="border border-card-border rounded-lg divide-y divide-card-border">
              {returnable.lines.map((l) => {
                const k = keyOf(l);
                return (
                  <div key={k} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid={`returnable-${k}`}>
                    <div className="flex-1 min-w-[200px] text-sm">
                      <div className="font-medium">{l.productName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {l.description !== l.productName ? `${l.description} · ` : ""}
                        {l.lotLabel ? `lote ${l.lotLabel} · ` : ""}
                        hasta {l.quantity} · {formatCents(l.unitPriceCents, returnable.currency)} c/u
                      </div>
                    </div>
                    <Input type="number" min={0} max={l.quantity} value={qty[k] ?? ""} onChange={(e) => setQty((p) => ({ ...p, [k]: e.target.value }))} placeholder="0" className="h-8 w-20 text-sm" />
                    <Select value={condition[k] ?? "restock"} onValueChange={(v) => setCondition((p) => ({ ...p, [k]: v as ReturnCondition }))}>
                      <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="restock">Vuelve a existencias</SelectItem>
                        <SelectItem value="damaged">Dañado (merma)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          )}
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (llegó dañado, no era lo que pidió…)" />
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notas" className="text-sm resize-none" />
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={submit} disabled={create.isPending || !returnable?.lines.length} data-testid="button-create-return">
              Abrir devolución
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({ ret, onClose }: { ret: Return | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const receive = useReceiveReturn();
  const [resolution, setResolution] = useState<ReturnResolution>("credit_note");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [ncf, setNcf] = useState("");
  useEffect(() => {
    if (ret) {
      setResolution("credit_note");
      setAmount(centsToInput(ret.suggestedAmountCents));
      setMethod("");
      setNcf("");
    }
  }, [ret]);

  const submit = () => {
    if (!ret) return;
    const amountCents = parseCents(amount);
    if ((resolution === "credit_note" || resolution === "refund") && (amountCents == null || amountCents <= 0)) {
      toast({ title: "Pon el monto", variant: "destructive" });
      return;
    }
    receive.mutate(
      { id: ret.id, data: { resolution, amountCents, refundMethod: method.trim() || null, fiscalNumber: ncf.trim() || null } },
      {
        onSuccess: () => {
          void invalidateApi(queryClient, "/api/returns", "/api/orders", "/api/inventory", "/api/credit-notes");
          toast({ title: `Devolución ${ret.code} recibida` });
          onClose();
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo recibir"), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={ret != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Recibir {ret?.code}</DialogTitle>
          <DialogDescription>
            {ret?.items.map((i) => `${i.productName} x${i.quantity}${i.condition === "damaged" ? " (dañado)" : ""}`).join(", ")}. Al recibirla, lo vendible vuelve a existencias y se le avisa al cliente por correo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={resolution} onValueChange={(v) => setResolution(v as ReturnResolution)}>
            <SelectTrigger data-testid="select-return-resolution">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RESOLUTION_LABELS) as ReturnResolution[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {RESOLUTION_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(resolution === "credit_note" || resolution === "refund") && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Monto ({ret?.currency})</label>
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-return-amount" />
              </div>
              {resolution === "refund" ? (
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Cómo se devolvió</label>
                  <Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Transferencia, Zelle…" />
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">NCF (opcional)</label>
                  <Input value={ncf} onChange={(e) => setNcf(e.target.value)} placeholder="B04…" />
                </div>
              )}
            </div>
          )}
          {resolution === "replacement" && <p className="text-xs text-muted-foreground">Se crea un pedido nuevo a precio cero, En proceso, listo para despachar.</p>}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={submit} disabled={receive.isPending} data-testid="button-receive-return">
              Recibir
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ReturnsView() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const urlParams = new URLSearchParams(searchString);
  const urlOrder = Number(urlParams.get("order")) || null;
  const urlCase = Number(urlParams.get("case")) || null;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ReturnStatus | "all">("requested");
  const params = { status: status === "all" ? undefined : status };
  const { data: returns, isLoading } = useListReturns(params, { query: { queryKey: getListReturnsQueryKey(params) } });
  const cancel = useCancelReturn();
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<Return | null>(null);

  // `?view=returns&order=<id>&case=<id>`: desde un caso que pide devolución.
  useEffect(() => {
    if (urlOrder != null) setCreating(true);
  }, [urlOrder]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-card border border-card-border rounded-lg p-1 flex-wrap">
          {(["requested", "received", "cancelled", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn("text-xs font-medium px-3 py-1.5 rounded-md transition-colors", status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted")}
            >
              {s === "all" ? "Todas" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <Button size="sm" className="gap-1.5 ml-auto" onClick={() => setCreating(true)} data-testid="button-new-return">
          <Plus className="w-4 h-4" /> Nueva devolución
        </Button>
      </div>
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/40 animate-pulse" />)}</div>
        ) : (returns ?? []).length === 0 ? (
          <div className="p-10 text-center">
            <RotateCcw className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Sin devoluciones en este estado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-3">Devolución</th>
                  <th className="text-left font-medium px-3 py-3">Cliente</th>
                  <th className="text-left font-medium px-3 py-3">Qué vuelve</th>
                  <th className="text-left font-medium px-3 py-3">Resolución</th>
                  <th className="text-left font-medium px-3 py-3">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {(returns ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-card-border/60 hover:bg-muted/40" data-testid={`return-row-${r.id}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.code}</div>
                      <button type="button" onClick={() => setLocation(`/orders?order=${r.orderId}`)} className="text-xs text-primary hover:underline">
                        {r.orderCode}
                      </button>
                      <div className="text-[11px] text-muted-foreground">{formatDateTime(r.createdAt)}</div>
                    </td>
                    <td className="px-3 py-2.5">{r.contactName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.items.map((i) => (
                        <div key={i.id}>
                          {i.productName} x{i.quantity}
                          {i.lotLabel ? ` · lote ${i.lotLabel}` : ""}
                          {i.condition === "damaged" ? <span className="text-red-600"> · dañado</span> : ""}
                        </div>
                      ))}
                      {r.reason && <div className="text-muted-foreground">{r.reason}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.status === "received" ? RESOLUTION_LABELS[r.resolution] : `Sugerido ${formatCents(r.suggestedAmountCents, r.currency)}`}
                      {r.creditNoteCode && <div className="text-muted-foreground">{r.creditNoteCode}</div>}
                      {r.replacementOrderId != null && (
                        <button type="button" onClick={() => setLocation(`/orders?order=${r.replacementOrderId}`)} className="text-primary hover:underline">
                          Reposición {r.replacementOrderCode}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", STATUS_STYLES[r.status])}>{STATUS_LABELS[r.status]}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {r.status === "requested" && (
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" className="h-7 text-xs" onClick={() => setReceiving(r)} data-testid={`button-open-receive-${r.id}`}>
                            Recibir
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() =>
                              cancel.mutate(
                                { id: r.id },
                                {
                                  onSuccess: () => void invalidateApi(queryClient, "/api/returns", "/api/orders"),
                                  onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo cancelar"), variant: "destructive" }),
                                },
                              )
                            }
                          >
                            Cancelar
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <NewReturnDialog
        open={creating}
        onOpenChange={(o) => {
          setCreating(o);
          if (!o && urlOrder != null) setLocation("/orders?view=returns", { replace: true });
        }}
        initialOrderId={urlOrder}
        caseId={urlCase}
      />
      <ReceiveDialog ret={receiving} onClose={() => setReceiving(null)} />
    </div>
  );
}
