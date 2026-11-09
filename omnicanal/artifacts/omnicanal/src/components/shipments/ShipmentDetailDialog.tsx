import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetShipment,
  getGetShipmentQueryKey,
  useUpdateShipment,
  useUpdateShipmentStop,
  useRemoveShipmentOrder,
  useMarkShipmentStopDelivered,
  useMarkShipmentStopFailed,
  useAddShipmentCharge,
  useDeleteShipmentCharge,
  useCancelShipment,
  useAddShipmentOrders,
  useListPendingDispatchOrders,
  getListPendingDispatchOrdersQueryKey,
  useListCarriers,
  type Shipment,
  type ShipmentStatus,
} from "@workspace/api-client-react";
import { Ban, CheckCircle2, ExternalLink, Plus, Tag, Trash2, Truck, XCircle, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useClient } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { apiErrorMessage, formatCents, formatDateTime, invalidateApi, parseCents } from "@/lib/money";
import { fromNaturalRate, naturalRateLabel, toNaturalRate, useSuggestedRate } from "@/lib/rates";
import DispatchDialog, { type DispatchTarget } from "./DispatchDialog";
import UspsLabelDialog, { type UspsLabelTarget } from "./UspsLabelDialog";
import ShopifyLabelDialog, { type ShopifyLabelTarget } from "./ShopifyLabelDialog";

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  planning: "Armando",
  dispatched: "En ruta",
  completed: "Cerrado",
  cancelled: "Cancelado",
};

export const SHIPMENT_STATUS_STYLES: Record<ShipmentStatus, string> = {
  planning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  dispatched: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-muted text-muted-foreground",
};

const CONCEPTS = ["Courier", "Combustible", "Chofer", "Peaje", "Empaque", "Otro"];

function useRefresh() {
  const queryClient = useQueryClient();
  return () => invalidateApi(queryClient, "/api/shipments", "/api/orders", "/api/inventory");
}

function TrackingInput({ shipment, stopOrderId, value }: { shipment: Shipment; stopOrderId: number; value: string | null }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const update = useUpdateShipmentStop();
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const save = () => {
    if ((value ?? "") === text.trim()) return;
    update.mutate(
      { id: shipment.id, orderId: stopOrderId, data: { trackingNumber: text.trim() || null } },
      { onSuccess: () => void refresh(), onError: (err) => toast({ title: apiErrorMessage(err, "No se guardó la guía"), variant: "destructive" }) },
    );
  };
  return <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={save} placeholder="Guía" className="h-7 text-xs w-36" data-testid={`input-stop-tracking-${stopOrderId}`} />;
}

type Stop = Shipment["stops"][number];

/**
 * Lo que se puede hacer con la etiqueta de un paquete, según de dónde viene el
 * pedido: los de Shopify se etiquetan con Shopify (o ya traen su guía); los demás,
 * con USPS directo. Una etiqueta ya comprada se abre desde su chip.
 */
function StopLabelActions({
  shipment,
  stop,
  onUsps,
  onShopify,
}: {
  shipment: Shipment;
  stop: Stop;
  onUsps: (t: UspsLabelTarget) => void;
  onShopify: (t: ShopifyLabelTarget) => void;
}) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const update = useUpdateShipmentStop();
  const planning = shipment.status === "planning";
  const target = { shipmentId: shipment.id, orderId: stop.orderId, orderCode: stop.orderCode };
  const chip = "flex items-center gap-1 text-[11px] text-primary hover:underline mt-1";
  const carrierOk = !shipment.carrierName || shipment.carrierName.trim().toLowerCase() === "usps" || stop.orderSource === "shopify";

  if (stop.uspsLabel) {
    return (
      <button type="button" onClick={() => onUsps(target)} className={chip} data-testid={`button-stop-usps-${stop.orderId}`}>
        <Tag className="w-3 h-3" />
        {`USPS${stop.uspsLabel.environment === "test" ? " (prueba)" : ""} · ${formatCents(stop.uspsLabel.postageCents, stop.uspsLabel.currency)}`}
      </button>
    );
  }
  if (stop.shopifyLabel) {
    return (
      <button type="button" onClick={() => onShopify(target)} className={chip} data-testid={`button-stop-shopify-${stop.orderId}`}>
        <Tag className="w-3 h-3" /> Etiqueta de Shopify{stop.shopifyLabel.status === "creating" ? " (sin confirmar)" : ""}
      </button>
    );
  }
  const ext = stop.externalTracking[0];
  if (ext && !stop.trackingNumber && planning) {
    return (
      <div className="mt-1 text-[11px] text-muted-foreground" data-testid={`stop-shopify-tracking-${stop.orderId}`}>
        En Shopify: <span className="font-mono">{ext.number}</span>
        {ext.company ? ` (${ext.company})` : ""}{" "}
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() =>
            update.mutate(
              { id: shipment.id, orderId: stop.orderId, data: { trackingNumber: ext.number } },
              { onSuccess: () => void refresh(), onError: (err) => toast({ title: apiErrorMessage(err, "No se guardó la guía"), variant: "destructive" }) },
            )
          }
          data-testid={`button-use-shopify-tracking-${stop.orderId}`}
        >
          Usar
        </button>
      </div>
    );
  }
  if (!planning || shipment.kind !== "courier" || !carrierOk || shipment.status === "cancelled" || stop.externalTracking.length > 0) return null;
  return stop.orderSource === "shopify" ? (
    <button type="button" onClick={() => onShopify(target)} className={chip} data-testid={`button-stop-shopify-${stop.orderId}`}>
      <Tag className="w-3 h-3" /> Etiqueta Shopify
    </button>
  ) : (
    <button type="button" onClick={() => onUsps(target)} className={chip} data-testid={`button-stop-usps-${stop.orderId}`}>
      <Tag className="w-3 h-3" /> Etiqueta USPS
    </button>
  );
}

function AddOrdersPanel({ shipment, onDone }: { shipment: Shipment; onDone: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const add = useAddShipmentOrders();
  const params = { warehouseId: shipment.warehouseId, includePending: true };
  const { data: pending } = useListPendingDispatchOrders(params, { query: { queryKey: getListPendingDispatchOrdersQueryKey(params) } });
  const [chosen, setChosen] = useState<number[]>([]);
  const submit = () =>
    add.mutate(
      { id: shipment.id, data: { orderIds: chosen } },
      {
        onSuccess: () => {
          void refresh();
          onDone();
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudieron agregar"), variant: "destructive" }),
      },
    );
  return (
    <div className="border border-card-border rounded-lg p-3 space-y-2">
      {(pending ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">No hay más pedidos listos para salir de este almacén.</p>
      ) : (
        <div className="max-h-56 overflow-y-auto divide-y divide-card-border">
          {(pending ?? []).map((o) => (
            <label key={o.id} className="flex items-center gap-2 py-1.5 text-sm">
              <Checkbox checked={chosen.includes(o.id)} onCheckedChange={(v) => setChosen((prev) => (v === true ? [...prev, o.id] : prev.filter((id) => id !== o.id)))} />
              <span className="font-medium">{o.code}</span>
              <span className="text-muted-foreground truncate">
                {o.contactName ?? "Sin nombre"} · {o.product ?? "—"}
              </span>
              {o.status === "pending" && <span className="text-[10px] text-amber-600">pago sin confirmar</span>}
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cerrar
        </Button>
        <Button size="sm" onClick={submit} disabled={chosen.length === 0 || add.isPending}>
          Agregar {chosen.length || ""}
        </Button>
      </div>
    </div>
  );
}

function ChargeForm({ shipment }: { shipment: Shipment }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const add = useAddShipmentCharge();
  const base = shipment.costCurrency;
  const [concept, setConcept] = useState("Courier");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(base);
  const [rate, setRate] = useState("");
  const [orderId, setOrderId] = useState("all");
  const suggested = useSuggestedRate(currency, base);
  useEffect(() => {
    setRate(currency === base || suggested == null ? "" : toNaturalRate(suggested, currency, base).toFixed(2));
  }, [currency, base, suggested]);

  const submit = () => {
    const cents = parseCents(amount);
    if (cents == null || cents <= 0) {
      toast({ title: "Pon el monto del cargo", variant: "destructive" });
      return;
    }
    let rateToBase: number | null = null;
    if (currency !== base) {
      const natural = Number(rate);
      if (!(natural > 0)) {
        toast({ title: `Falta la tasa (${naturalRateLabel(currency, base)})`, variant: "destructive" });
        return;
      }
      rateToBase = fromNaturalRate(natural, currency, base);
    }
    add.mutate(
      { id: shipment.id, data: { concept, amountCents: cents, currency, rateToBase, orderId: orderId === "all" ? null : Number(orderId) } },
      {
        onSuccess: () => {
          void refresh();
          setAmount("");
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se agregó el cargo"), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select value={concept} onValueChange={setConcept}>
        <SelectTrigger className="h-8 w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONCEPTS.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto" className="h-8 w-24 text-xs" data-testid="input-charge-amount" />
      <Select value={currency} onValueChange={setCurrency}>
        <SelectTrigger className="h-8 w-20 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[...new Set([base, "DOP", "USD"])].map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {currency !== base && (
        <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder={naturalRateLabel(currency, base)} title={naturalRateLabel(currency, base)} className="h-8 w-28 text-xs" />
      )}
      <Select value={orderId} onValueChange={setOrderId}>
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Repartir entre todos</SelectItem>
          {shipment.stops.map((s) => (
            <SelectItem key={s.orderId} value={String(s.orderId)}>
              Solo {s.orderCode}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" className="h-8 gap-1" onClick={submit} disabled={add.isPending} data-testid="button-add-charge">
        <Plus className="w-3.5 h-3.5" /> Cargo
      </Button>
    </div>
  );
}

export default function ShipmentDetailDialog({ shipmentId, onClose }: { shipmentId: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const { locale } = useClient();
  const [, setLocation] = useLocation();
  const refresh = useRefresh();
  const { data: shipment } = useGetShipment(shipmentId ?? 0, { query: { enabled: shipmentId != null, queryKey: getGetShipmentQueryKey(shipmentId ?? 0) } });
  const { data: carriers } = useListCarriers();
  const updateShipment = useUpdateShipment();
  const removeOrder = useRemoveShipmentOrder();
  const delivered = useMarkShipmentStopDelivered();
  const failed = useMarkShipmentStopFailed();
  const deleteCharge = useDeleteShipmentCharge();
  const cancel = useCancelShipment();
  const [adding, setAdding] = useState(false);
  const [dispatchTarget, setDispatchTarget] = useState<DispatchTarget | null>(null);
  const [uspsTarget, setUspsTarget] = useState<UspsLabelTarget | null>(null);
  const [shopifyTarget, setShopifyTarget] = useState<ShopifyLabelTarget | null>(null);

  const fail = (err: unknown, fallback: string) => toast({ title: apiErrorMessage(err, fallback), variant: "destructive" });
  const planning = shipment?.status === "planning";
  const currency = shipment?.costCurrency ?? locale.currency;

  return (
    <Dialog open={shipmentId != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        {!shipment ? (
          <>
            <DialogTitle className="sr-only">Despacho</DialogTitle>
            <div className="h-40 rounded-lg bg-muted/40 animate-pulse" />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Truck className="w-5 h-5" /> {shipment.code} · {shipment.kind === "trip" ? "Viaje" : "Courier"}
                <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", SHIPMENT_STATUS_STYLES[shipment.status])}>{SHIPMENT_STATUS_LABELS[shipment.status]}</span>
              </DialogTitle>
              <DialogDescription>
                {shipment.warehouseName} · {shipment.stops.length} {shipment.stops.length === 1 ? "pedido" : "pedidos"}
                {shipment.dispatchedAt ? ` · salió ${formatDateTime(shipment.dispatchedAt)}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <div className="grid gap-2 sm:grid-cols-4">
                <Select
                  value={shipment.carrierId != null ? String(shipment.carrierId) : "none"}
                  onValueChange={(v) => updateShipment.mutate({ id: shipment.id, data: { carrierId: v === "none" ? null : Number(v) } }, { onSuccess: () => void refresh() })}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{shipment.kind === "trip" ? "Reparto propio" : "Sin courier"}</SelectItem>
                    {(carriers ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  defaultValue={shipment.driverName ?? ""}
                  placeholder="Chofer"
                  className="h-9 text-sm"
                  onBlur={(e) => e.target.value !== (shipment.driverName ?? "") && updateShipment.mutate({ id: shipment.id, data: { driverName: e.target.value } }, { onSuccess: () => void refresh() })}
                />
                <Input
                  defaultValue={shipment.vehicle ?? ""}
                  placeholder="Vehículo"
                  className="h-9 text-sm"
                  onBlur={(e) => e.target.value !== (shipment.vehicle ?? "") && updateShipment.mutate({ id: shipment.id, data: { vehicle: e.target.value } }, { onSuccess: () => void refresh() })}
                />
                <Input
                  type="date"
                  defaultValue={shipment.plannedDate ?? ""}
                  className="h-9 text-sm"
                  onBlur={(e) => e.target.value !== (shipment.plannedDate ?? "") && updateShipment.mutate({ id: shipment.id, data: { plannedDate: e.target.value || null } }, { onSuccess: () => void refresh() })}
                />
              </div>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{shipment.kind === "trip" ? "Paradas" : "Paquetes"}</h3>
                  {planning && !adding && (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setAdding(true)}>
                      <Plus className="w-3.5 h-3.5" /> Agregar pedidos
                    </Button>
                  )}
                </div>
                {adding && <AddOrdersPanel shipment={shipment} onDone={() => setAdding(false)} />}
                <div className="border border-card-border rounded-lg overflow-x-auto">
                  <table className="w-full text-sm min-w-[760px]">
                    <tbody>
                      {shipment.stops.map((s) => (
                        <tr key={s.id} className="border-b border-card-border/60 last:border-0 align-top">
                          <td className="px-3 py-2 text-xs text-muted-foreground w-8">{s.sequence}</td>
                          <td className="px-3 py-2">
                            <button type="button" onClick={() => setLocation(`/orders?order=${s.orderId}`)} className="font-medium text-primary hover:underline">
                              {s.orderCode}
                            </button>
                            {s.externalName && <span className="text-xs text-muted-foreground"> · {s.externalName}</span>}
                            <div className="text-xs text-muted-foreground">{s.product ?? "—"}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div>{s.contactName ?? "Sin nombre"}</div>
                            <div className="text-xs text-muted-foreground">{s.contactPhone ?? ""}</div>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground max-w-[220px]">{s.address ?? "Sin dirección"}</td>
                          <td className="px-3 py-2">
                            {shipment.status !== "cancelled" && <TrackingInput shipment={shipment} stopOrderId={s.orderId} value={s.trackingNumber ?? null} />}
                            {s.trackingUrl && (
                              <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-1">
                                <ExternalLink className="w-3 h-3" /> Rastrear
                              </a>
                            )}
                            <StopLabelActions shipment={shipment} stop={s} onUsps={setUspsTarget} onShopify={setShopifyTarget} />
                          </td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground whitespace-nowrap">{formatCents(s.allocatedCostCents, currency)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {planning ? (
                              <button
                                type="button"
                                onClick={() => removeOrder.mutate({ id: shipment.id, orderId: s.orderId }, { onSuccess: () => void refresh(), onError: (e) => fail(e, "No se pudo quitar") })}
                                className="text-muted-foreground hover:text-destructive"
                                aria-label="Quitar del despacho"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : s.deliveryStatus === "pending" && shipment.status === "dispatched" ? (
                              <div className="flex gap-1 justify-end">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1 text-xs"
                                  onClick={() => delivered.mutate({ id: shipment.id, orderId: s.orderId }, { onSuccess: () => void refresh(), onError: (e) => fail(e, "No se pudo marcar") })}
                                  data-testid={`button-stop-delivered-${s.orderId}`}
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Entregado
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1 text-xs"
                                  onClick={() => {
                                    const reason = window.prompt("¿Por qué no se entregó? (vuelve al almacén)") ?? null;
                                    if (reason === null) return;
                                    failed.mutate({ id: shipment.id, orderId: s.orderId, data: { reason } }, { onSuccess: () => void refresh(), onError: (e) => fail(e, "No se pudo marcar") });
                                  }}
                                  data-testid={`button-stop-failed-${s.orderId}`}
                                >
                                  <XCircle className="w-3.5 h-3.5" /> No entregado
                                </Button>
                              </div>
                            ) : (
                              <span
                                className={cn(
                                  "text-xs font-medium",
                                  s.deliveryStatus === "delivered" ? "text-emerald-600 dark:text-emerald-400" : s.deliveryStatus === "failed" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                                )}
                                title={s.failureReason ?? undefined}
                              >
                                {s.deliveryStatus === "delivered" ? `Entregado ${formatDateTime(s.deliveredAt)}` : s.deliveryStatus === "failed" ? "No entregado" : "Pendiente"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {shipment.stops.length === 0 && (
                        <tr>
                          <td className="px-3 py-6 text-center text-sm text-muted-foreground">Sin pedidos todavía.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Cargos del envío</h3>
                  <span className="text-sm tabular-nums">
                    Total: <span className="font-semibold">{formatCents(shipment.totalCostCents, currency)}</span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Lo que costó sacar este despacho. Se reparte entre sus pedidos y va al margen de cada uno.</p>
                {shipment.charges.length > 0 && (
                  <div className="border border-card-border rounded-lg divide-y divide-card-border">
                    {shipment.charges.map((c) => (
                      <div key={c.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                        <span>
                          {c.concept}
                          {c.orderCode ? <span className="text-xs text-muted-foreground"> · solo {c.orderCode}</span> : null}
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="tabular-nums text-muted-foreground">
                            {formatCents(c.amountCents, c.currency)}
                            {c.currency !== currency ? ` = ${formatCents(c.baseAmountCents, currency)}` : ""}
                          </span>
                          {shipment.status !== "cancelled" && (
                            <button
                              type="button"
                              onClick={() => deleteCharge.mutate({ id: shipment.id, chargeId: c.id }, { onSuccess: () => void refresh() })}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label="Quitar cargo"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {shipment.status !== "cancelled" && <ChargeForm shipment={shipment} />}
              </section>

              {planning && (
                <div className="flex flex-wrap gap-2 justify-end border-t border-card-border pt-4">
                  <Button
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      if (!window.confirm(`¿Cancelar el despacho ${shipment.code}? Sus pedidos vuelven a "Por despachar".`)) return;
                      cancel.mutate({ id: shipment.id }, { onSuccess: () => void refresh(), onError: (e) => fail(e, "No se pudo cancelar") });
                    }}
                  >
                    <Ban className="w-4 h-4" /> Cancelar despacho
                  </Button>
                  <Button className="gap-1.5" disabled={shipment.stops.length === 0} onClick={() => setDispatchTarget({ kind: "shipment", shipmentId: shipment.id, code: shipment.code })} data-testid="button-dispatch-shipment">
                    <PackageCheck className="w-4 h-4" /> Registrar despacho
                  </Button>
                </div>
              )}
            </div>
            <DispatchDialog target={dispatchTarget} onClose={() => setDispatchTarget(null)} />
            <UspsLabelDialog target={uspsTarget} onClose={() => setUspsTarget(null)} />
            <ShopifyLabelDialog
              target={shopifyTarget}
              onClose={() => setShopifyTarget(null)}
              onUseUsps={(t) => {
                setShopifyTarget(null);
                setUspsTarget(t);
              }}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
