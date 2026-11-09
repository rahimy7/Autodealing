import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetShipmentDispatchPlan,
  useGetOrderDispatchPlan,
  getGetShipmentDispatchPlanQueryKey,
  getGetOrderDispatchPlanQueryKey,
  useDispatchShipment,
  useUpdateOrder,
  useListCarriers,
  type DispatchPlan,
  type LotSelection,
  type ShipmentKind,
} from "@workspace/api-client-react";
import { AlertTriangle, Loader2, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, formatDay, invalidateApi } from "@/lib/money";

type Target =
  | { kind: "shipment"; shipmentId: number; code: string }
  | { kind: "order"; orderId: number; code: string; thenDeliver?: boolean };

const partKey = (p: { orderItemId: number; productId: number }) => `${p.orderItemId}:${p.productId}`;

/** Las cantidades por lote que propone el plan, para arrancar el editor. */
function initialPicks(plan: DispatchPlan): Record<string, Record<number, string>> {
  const out: Record<string, Record<number, string>> = {};
  for (const part of plan.parts) {
    if (!part.tracked) continue;
    out[partKey(part)] = Object.fromEntries(part.picks.map((p) => [p.lotId, String(p.quantity)]));
  }
  return out;
}

export default function DispatchDialog({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const shipmentId = target?.kind === "shipment" ? target.shipmentId : 0;
  const orderId = target?.kind === "order" ? target.orderId : 0;
  const shipmentPlan = useGetShipmentDispatchPlan(shipmentId, {
    query: { enabled: target?.kind === "shipment", queryKey: getGetShipmentDispatchPlanQueryKey(shipmentId), staleTime: 0 },
  });
  const orderPlan = useGetOrderDispatchPlan(orderId, {
    query: { enabled: target?.kind === "order", queryKey: getGetOrderDispatchPlanQueryKey(orderId), staleTime: 0 },
  });
  const plan = target?.kind === "shipment" ? shipmentPlan.data : orderPlan.data;
  const loading = target?.kind === "shipment" ? shipmentPlan.isLoading : orderPlan.isLoading;
  const planError = target?.kind === "shipment" ? shipmentPlan.error : orderPlan.error;
  const { data: carriers } = useListCarriers();
  const dispatchShipment = useDispatchShipment();
  const updateOrder = useUpdateOrder();

  const [picks, setPicks] = useState<Record<string, Record<number, string>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [allowUnlinked, setAllowUnlinked] = useState(false);
  const [kind, setKind] = useState<ShipmentKind>("courier");
  const [carrierId, setCarrierId] = useState<string>("none");
  const [tracking, setTracking] = useState("");

  useEffect(() => {
    if (plan) setPicks(initialPicks(plan));
  }, [plan]);
  useEffect(() => {
    if (!target) {
      setEditing(null);
      setAllowUnlinked(false);
      setTracking("");
      setCarrierId("none");
      setKind("courier");
    }
  }, [target]);

  const lotsByProduct = useMemo(() => {
    const map = new Map<number, DispatchPlan["availableLots"]>();
    for (const lot of plan?.availableLots ?? []) {
      const list = map.get(lot.productId) ?? [];
      list.push(lot);
      map.set(lot.productId, list);
    }
    return map;
  }, [plan]);

  // Solo viajan al API las líneas que la persona cambió; lo demás sale FEFO.
  const selections = (): LotSelection[] | null => {
    if (!plan) return [];
    const out: LotSelection[] = [];
    for (const part of plan.parts) {
      if (!part.tracked) continue;
      const chosen = picks[partKey(part)] ?? {};
      const suggested = Object.fromEntries(part.picks.map((p) => [p.lotId, p.quantity]));
      const entries = Object.entries(chosen)
        .map(([lotId, qty]) => ({ lotId: Number(lotId), quantity: Number(qty) || 0 }))
        .filter((e) => e.quantity > 0);
      const changed =
        entries.length !== part.picks.length || entries.some((e) => suggested[e.lotId] !== e.quantity);
      if (!changed) continue;
      const total = entries.reduce((s, e) => s + e.quantity, 0);
      if (total !== part.quantity) {
        toast({ title: `${part.productName}: los lotes suman ${total} y salen ${part.quantity}`, variant: "destructive" });
        return null;
      }
      out.push({ orderItemId: part.orderItemId, productId: part.productId, picks: entries });
    }
    return out;
  };

  const onDone = (title: string) => {
    void invalidateApi(queryClient, "/api/shipments", "/api/orders", "/api/inventory");
    toast({ title });
    onClose();
  };
  const onFail = (err: unknown) => toast({ title: apiErrorMessage(err, "No se pudo despachar"), variant: "destructive" });

  const submit = () => {
    if (!target) return;
    const chosen = selections();
    if (chosen == null) return;
    if (target.kind === "shipment") {
      dispatchShipment.mutate(
        { id: target.shipmentId, data: { selections: chosen, allowUnlinked } },
        { onSuccess: () => onDone(`Despacho ${target.code} registrado: el inventario ya se descontó`), onError: onFail },
      );
      return;
    }
    updateOrder.mutate(
      {
        id: target.orderId,
        data: {
          status: target.thenDeliver ? "delivered" : "shipped",
          dispatch: {
            kind,
            carrierId: carrierId === "none" ? null : Number(carrierId),
            trackingNumber: tracking.trim() || null,
            selections: chosen,
            allowUnlinked,
          },
        },
      },
      { onSuccess: () => onDone(`Pedido ${target.code} ${target.thenDeliver ? "despachado y entregado" : "despachado"}`), onError: onFail },
    );
  };

  const pending = dispatchShipment.isPending || updateOrder.isPending;
  const blocked = !plan || (plan.hasShortage && editing == null) || (plan.unlinked.length > 0 && !allowUnlinked);

  return (
    <Dialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar despacho {target?.code}</DialogTitle>
          <DialogDescription>
            Al registrarlo, lo que sale se descuenta del inventario por lote (primero lo que vence antes) y {target?.kind === "shipment" ? "los pedidos pasan" : "el pedido pasa"} a Enviado.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="h-32 rounded-lg bg-muted/40 animate-pulse" />
        ) : planError ? (
          <p className="text-sm text-destructive">{apiErrorMessage(planError, "No se pudo calcular el despacho.")}</p>
        ) : plan ? (
          <div className="space-y-4">
            {target?.kind === "order" && (
              <div className="grid gap-2 sm:grid-cols-3">
                <Select value={kind} onValueChange={(v) => setKind(v as ShipmentKind)}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="courier">Courier</SelectItem>
                    <SelectItem value="trip">Reparto propio</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={carrierId} onValueChange={setCarrierId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Courier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin courier</SelectItem>
                    {(carriers ?? [])
                      .filter((c) => c.active)
                      .map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Número de guía" className="h-9 text-sm" data-testid="input-dispatch-tracking" />
              </div>
            )}

            <div className="space-y-2">
              {plan.parts.length === 0 && plan.unlinked.length === 0 && <p className="text-sm text-muted-foreground">No hay nada pendiente de salir.</p>}
              {plan.parts.map((part) => {
                const key = partKey(part);
                const lots = lotsByProduct.get(part.productId) ?? [];
                return (
                  <div key={key} className="border border-card-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-medium">{part.productName}</span> x{part.quantity}
                        {target?.kind === "shipment" && <span className="text-xs text-muted-foreground"> · PED-{String(part.orderId).padStart(6, "0")}</span>}
                      </div>
                      {part.tracked && lots.length > 0 && (
                        <button type="button" onClick={() => setEditing(editing === key ? null : key)} className="text-xs text-primary hover:underline">
                          {editing === key ? "Listo" : "Cambiar lotes"}
                        </button>
                      )}
                    </div>
                    {!part.tracked ? (
                      <p className="text-xs text-muted-foreground">No controla inventario: sale sin movimiento.</p>
                    ) : editing === key ? (
                      <div className="space-y-1.5">
                        {lots.map((lot) => (
                          <div key={lot.lotId} className="flex items-center gap-2 text-xs">
                            <span className="flex-1">
                              Lote {lot.label} · vence {formatDay(lot.expiryDate)} · {lot.quantity} en almacén
                            </span>
                            <Input
                              type="number"
                              min={0}
                              max={lot.quantity}
                              value={picks[key]?.[lot.lotId] ?? ""}
                              onChange={(e) => setPicks((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), [lot.lotId]: e.target.value } }))}
                              className="h-7 w-20 text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {part.picks.map((p) => `Lote ${p.label} x${p.quantity} (vence ${formatDay(p.expiryDate)})`).join(" · ") || "—"}
                        {part.shortage > 0 && (
                          <span className="ml-1 inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400">
                            <AlertTriangle className="w-3.5 h-3.5" /> faltan {part.shortage}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {plan.unlinked.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-2">
                <p>
                  Hay líneas sin vincular al catálogo ({plan.unlinked.map((u) => u.description).join(", ")}): no descuentan inventario. Lo mejor es vincularlas en el pedido.
                </p>
                <label className="flex items-center gap-2">
                  <Checkbox checked={allowUnlinked} onCheckedChange={(v) => setAllowUnlinked(v === true)} />
                  Despachar igual
                </label>
              </div>
            )}
            {plan.hasShortage && (
              <p className="text-xs text-red-600 dark:text-red-400">No hay existencias para todo. Recibe la mercancía o ajusta el inventario antes de despachar.</p>
            )}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={onClose}>
                Cancelar
              </Button>
              <Button className="flex-1 gap-1.5" onClick={submit} disabled={pending || blocked} data-testid="button-confirm-dispatch">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
                Registrar salida
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export type DispatchTarget = Target;
