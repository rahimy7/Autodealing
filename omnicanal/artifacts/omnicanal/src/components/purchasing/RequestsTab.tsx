import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPurchaseRequests,
  getListPurchaseRequestsQueryKey,
  useCreatePurchaseRequest,
  useUpdatePurchaseRequest,
  useConvertPurchaseRequest,
  useRunReorderSweep,
  useListWarehouses,
  type PurchaseRequest,
  type PurchaseRequestStatus,
} from "@workspace/api-client-react";
import { ClipboardList, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiErrorMessage, formatDateTime, invalidateApi } from "@/lib/money";
import { ProductPicker, WarehouseSelect, isKit } from "@/components/inventory/pickers";
import { REQUEST_STATUS_LABELS, StatusPill, SupplierSelect } from "./shared";

type LineDraft = { key: string; productId: number | null; quantity: string; supplierId: number | null; reason: string | null };

const STATUS_STYLES: Record<PurchaseRequestStatus, string> = {
  open: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  approved: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  ordered: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-muted text-muted-foreground",
};

function linesFrom(request: PurchaseRequest | null): LineDraft[] {
  if (!request) return [{ key: String(Math.random()), productId: null, quantity: "", supplierId: null, reason: null }];
  return request.items
    .filter((i) => i.purchaseOrderItemId == null)
    .map((i) => ({ key: String(i.id), productId: i.productId, quantity: String(i.quantity), supplierId: i.suggestedSupplierId ?? null, reason: i.reason ?? null }));
}

function RequestDialog({ request, open, onOpenChange }: { request: PurchaseRequest | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: warehouses } = useListWarehouses();
  const create = useCreatePurchaseRequest();
  const update = useUpdatePurchaseRequest();
  const convert = useConvertPurchaseRequest();
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(linesFrom(null));
  useEffect(() => {
    if (open) {
      setWarehouseId(request?.warehouseId ?? null);
      setNotes(request?.notes ?? "");
      setLines(linesFrom(request));
    }
  }, [open, request]);
  const editable = !request || request.status === "open" || request.status === "approved";
  const effectiveWarehouse = warehouseId ?? warehouses?.find((w) => w.isDefault)?.id ?? warehouses?.[0]?.id ?? null;
  const patchLine = (key: string, change: Partial<LineDraft>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...change } : l)));

  const payload = () => {
    const items = [];
    for (const l of lines) {
      const quantity = Number(l.quantity);
      if (l.productId == null) continue;
      if (!Number.isInteger(quantity) || quantity <= 0) return null;
      items.push({ productId: l.productId, quantity, suggestedSupplierId: l.supplierId, reason: l.reason });
    }
    return items;
  };
  const refresh = () => invalidateApi(queryClient, "/api/purchasing", "/api/inventory");
  const fail = (err: unknown, fallback: string) => toast({ title: apiErrorMessage(err, fallback), variant: "destructive" });

  const save = (then?: () => void) => {
    const items = payload();
    if (items == null || items.length === 0) {
      toast({ title: "Cada línea necesita producto y cantidad", variant: "destructive" });
      return;
    }
    if (request) {
      update.mutate({ id: request.id, data: { notes: notes.trim() || null, items } }, { onSuccess: () => { void refresh(); then ? then() : toast({ title: "Guardado" }); }, onError: (e) => fail(e, "No se pudo guardar") });
    } else {
      if (effectiveWarehouse == null) return;
      create.mutate(
        { data: { warehouseId: effectiveWarehouse, notes: notes.trim() || null, items } },
        { onSuccess: (r) => { void refresh(); toast({ title: `Pedido de compra ${r.code} abierto` }); onOpenChange(false); }, onError: (e) => fail(e, "No se pudo abrir") },
      );
    }
  };

  const setStatus = (status: "approved" | "cancelled" | "open") =>
    request && update.mutate({ id: request.id, data: { status } }, { onSuccess: () => { void refresh(); onOpenChange(false); }, onError: (e) => fail(e, "No se pudo cambiar") });

  const toOrders = () =>
    request &&
    save(() =>
      convert.mutate(
        { id: request.id },
        {
          onSuccess: (orders) => {
            void refresh();
            toast({ title: `${orders.length === 1 ? "Orden creada" : `${orders.length} órdenes creadas`}: ${orders.map((o) => o.code).join(", ")}`, description: "Revisa costos y envíalas al proveedor en Órdenes de compra." });
            onOpenChange(false);
          },
          onError: (e) => fail(e, "No se pudo convertir"),
        },
      ),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {request ? `Pedido de compra ${request.code}` : "Nuevo pedido de compra"}
            {request && <StatusPill className={STATUS_STYLES[request.status]}>{REQUEST_STATUS_LABELS[request.status]}</StatusPill>}
          </DialogTitle>
          <DialogDescription>
            {request?.origin === "reorder" ? "Lo abrió el punto de reorden: cada mañana se completa con lo que haga falta." : "La necesidad interna: lo que hace falta comprar y a quién."} Se convierte en una orden de compra por proveedor.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!request && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Almacén que lo necesita</label>
              <WarehouseSelect value={effectiveWarehouse} onChange={setWarehouseId} />
            </div>
          )}
          <div className="space-y-2">
            {lines.map((l, index) => (
              <div key={l.key} className="border border-card-border rounded-lg p-2.5 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-[200px]">
                    {editable ? (
                      <ProductPicker value={l.productId} onChange={(p) => patchLine(l.key, { productId: p.id })} filter={(p) => !isKit(p)} testId={`picker-request-product-${index}`} />
                    ) : (
                      <span className="text-sm font-medium">{request?.items.find((i) => String(i.id) === l.key)?.productName ?? "Producto"}</span>
                    )}
                  </div>
                  <Input type="number" min={1} value={l.quantity} onChange={(e) => patchLine(l.key, { quantity: e.target.value })} disabled={!editable} placeholder="Cant." className="h-9 w-24" />
                  <SupplierSelect value={l.supplierId} onChange={(id) => patchLine(l.key, { supplierId: id })} allowNone className="w-48" />
                  {editable && (
                    <button type="button" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} className="text-muted-foreground hover:text-destructive" aria-label="Quitar">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {l.reason && <div className="text-[11px] text-muted-foreground">{l.reason}</div>}
              </div>
            ))}
            {request?.items.filter((i) => i.purchaseOrderItemId != null).map((i) => (
              <div key={i.id} className="text-xs text-muted-foreground px-1">
                {i.productName} x{i.quantity} → ya en {i.purchaseOrderCode}
              </div>
            ))}
            {editable && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setLines((prev) => [...prev, { key: String(Math.random()), productId: null, quantity: "", supplierId: null, reason: null }])}>
                <Plus className="w-3.5 h-3.5" /> Producto
              </Button>
            )}
          </div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notas" className="text-sm resize-none" disabled={!editable} />
          <div className="flex flex-wrap gap-2 justify-end">
            {request && editable && (
              <Button variant="ghost" onClick={() => setStatus("cancelled")}>
                Cancelar pedido
              </Button>
            )}
            {editable && (
              <Button variant="outline" onClick={() => save()} disabled={create.isPending || update.isPending} data-testid="button-save-request">
                {request ? "Guardar" : "Abrir pedido de compra"}
              </Button>
            )}
            {request?.status === "open" && (
              <Button variant="outline" onClick={() => setStatus("approved")}>
                Aprobar
              </Button>
            )}
            {request && editable && (
              <Button onClick={toOrders} disabled={convert.isPending} data-testid="button-convert-request">
                Convertir en órdenes de compra
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function RequestsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<PurchaseRequestStatus | "all">("open");
  const params = { status: status === "all" ? undefined : status };
  const { data: requests, isLoading } = useListPurchaseRequests(params, { query: { queryKey: getListPurchaseRequestsQueryKey(params) } });
  const sweep = useRunReorderSweep();
  const [editing, setEditing] = useState<PurchaseRequest | null>(null);
  const [open, setOpen] = useState(false);

  const runSweep = () =>
    sweep.mutate(undefined, {
      onSuccess: (r) => {
        void invalidateApi(queryClient, "/api/purchasing", "/api/inventory");
        toast({
          title: r.linesAdded ? `${r.linesAdded} ${r.linesAdded === 1 ? "producto agregado" : "productos agregados"} a pedidos de compra` : "Nada nuevo que pedir",
          description: r.newlyLow ? `${r.newlyLow} bajaron del mínimo${r.alerted ? " (se avisó al equipo por WhatsApp)" : ""}.` : undefined,
        });
      },
      onError: (e) => toast({ title: apiErrorMessage(e, "No se pudo calcular"), variant: "destructive" }),
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-card border border-card-border rounded-lg p-1 flex-wrap">
          {(["open", "approved", "ordered", "cancelled", "all"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} className={cn("text-xs font-medium px-3 py-1.5 rounded-md transition-colors", status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted")}>
              {s === "all" ? "Todos" : REQUEST_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={runSweep} disabled={sweep.isPending} data-testid="button-run-reorder">
            <RefreshCw className={cn("w-4 h-4", sweep.isPending && "animate-spin")} /> Calcular necesidades
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => { setEditing(null); setOpen(true); }} data-testid="button-new-request">
            <Plus className="w-4 h-4" /> Pedido de compra
          </Button>
        </div>
      </div>
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/40 animate-pulse" />)}</div>
        ) : (requests ?? []).length === 0 ? (
          <div className="p-10 text-center">
            <ClipboardList className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Sin pedidos de compra en este estado. Fija puntos de reorden en Inventario → Existencias para que se abran solos.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-3">Pedido</th>
                  <th className="text-left font-medium px-3 py-3">Almacén</th>
                  <th className="text-left font-medium px-3 py-3">Productos</th>
                  <th className="text-left font-medium px-3 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {(requests ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-card-border/60 hover:bg-muted/40 cursor-pointer" onClick={() => { setEditing(r); setOpen(true); }} data-testid={`request-row-${r.id}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-primary">{r.code}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.origin === "reorder" ? "Punto de reorden" : "A mano"} · {formatDateTime(r.createdAt)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{r.warehouseName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.items.map((i) => (
                        <div key={i.id}>
                          {i.productName} x{i.quantity}
                          <span className="text-muted-foreground"> · {i.suggestedSupplierName ?? "sin proveedor"}{i.purchaseOrderCode ? ` → ${i.purchaseOrderCode}` : ""}</span>
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill className={STATUS_STYLES[r.status]}>{REQUEST_STATUS_LABELS[r.status]}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <RequestDialog request={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}
