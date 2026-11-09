import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetOrderDetail, getGetOrderDetailQueryKey, useNotifyOrderCustomer, type OrderEmailStage } from "@workspace/api-client-react";
import {
  CircleDot,
  CreditCard,
  Mail,
  MailX,
  PackageCheck,
  Truck,
  Ban,
  RotateCcw,
  ReceiptText,
  ListOrdered,
  Tag,
  StickyNote,
  ShoppingBag,
  ExternalLink,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiErrorMessage, formatCents, formatDateTime, invalidateApi } from "@/lib/money";
import { MOVEMENT_LABELS } from "@/components/inventory/KardexTab";

const EVENT_ICONS: Record<string, typeof CircleDot> = {
  created: ShoppingBag,
  payment_confirmed: CreditCard,
  status: CircleDot,
  items: ListOrdered,
  pricing: Tag,
  shipment_assigned: Truck,
  shipment_removed: Truck,
  dispatched: Truck,
  delivered: PackageCheck,
  delivery_failed: RotateCcw,
  cancelled: Ban,
  return: RotateCcw,
  credit_note: ReceiptText,
  notified: Mail,
  notification_skipped: MailX,
  shopify: ShoppingBag,
  usps_label: Truck,
  shopify_label: Truck,
  note: StickyNote,
};

const EVENT_TONES: Record<string, string> = {
  notification_skipped: "text-amber-600 dark:text-amber-400",
  delivery_failed: "text-red-600 dark:text-red-400",
  cancelled: "text-red-600 dark:text-red-400",
  delivered: "text-emerald-600 dark:text-emerald-400",
  notified: "text-blue-600 dark:text-blue-400",
};

const STAGE_LABELS: Record<OrderEmailStage, string> = {
  confirmed: "Pago confirmado",
  dispatched: "Despachado",
  delivered: "Entregado",
  cancelled: "Cancelado",
  refund: "Devolución / nota de crédito",
};

/** El expediente del pedido: cada etapa, cada aviso al cliente, sus despachos y lo que salió de qué lote. */
export function OrderTimeline({ orderId }: { orderId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: detail, isLoading } = useGetOrderDetail(orderId, { query: { queryKey: getGetOrderDetailQueryKey(orderId) } });
  const notify = useNotifyOrderCustomer();
  const [stage, setStage] = useState<OrderEmailStage>("dispatched");

  if (isLoading || !detail) return <div className="h-40 rounded-lg bg-muted/40 animate-pulse" />;

  const sendNotice = () =>
    notify.mutate(
      { id: orderId, data: { stage } },
      {
        onSuccess: (r) => {
          void invalidateApi(queryClient, "/api/orders");
          toast(r.sent ? { title: "Aviso enviado por correo" } : { title: "No se envió", description: r.reason ?? undefined, variant: "destructive" });
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo enviar"), variant: "destructive" }),
      },
    );

  return (
    <div className="space-y-5">
      <ol className="relative border-l border-card-border ml-2 space-y-3">
        {detail.events.map((e) => {
          const Icon = EVENT_ICONS[e.kind] ?? CircleDot;
          return (
            <li key={e.id} className="ml-4">
              <span className={cn("absolute -left-[9px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-background border border-card-border", EVENT_TONES[e.kind])}>
                <Icon className="w-3 h-3" />
              </span>
              <div className={cn("text-sm", EVENT_TONES[e.kind])}>{e.detail}</div>
              <div className="text-[11px] text-muted-foreground">
                {formatDateTime(e.createdAt)}
                {e.actorLabel ? ` · ${e.actorLabel}` : ""}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2 border-t border-card-border pt-4">
        <span className="text-xs text-muted-foreground">Avisar al cliente por correo:</span>
        <Select value={stage} onValueChange={(v) => setStage(v as OrderEmailStage)}>
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STAGE_LABELS) as OrderEmailStage[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STAGE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={sendNotice} disabled={notify.isPending} data-testid="button-notify-customer">
          <Send className="w-3.5 h-3.5" /> Enviar
        </Button>
      </div>

      {detail.shipments.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-xs font-semibold">Despachos</h4>
          {detail.shipments.map((s) => (
            <div key={`${s.shipmentId}`} className="flex flex-wrap items-center justify-between gap-2 text-sm border border-card-border rounded-lg px-3 py-2">
              <button type="button" onClick={() => setLocation(`/shipments?tab=shipments&shipment=${s.shipmentId}`)} className="font-medium text-primary hover:underline">
                {s.code}
              </button>
              <span className="text-xs text-muted-foreground">
                {s.kind === "trip" ? "Viaje" : "Courier"}
                {s.carrierName ? ` · ${s.carrierName}` : ""}
                {s.trackingNumber ? ` · guía ${s.trackingNumber}` : ""}
              </span>
              {s.trackingUrl && (
                <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <ExternalLink className="w-3 h-3" /> Rastrear
                </a>
              )}
              <span className={cn("text-xs font-medium", s.deliveryStatus === "delivered" ? "text-emerald-600" : s.deliveryStatus === "failed" ? "text-red-600" : "text-muted-foreground")}>
                {s.deliveryStatus === "delivered" ? "Entregado" : s.deliveryStatus === "failed" ? "No entregado" : "En camino / por salir"}
              </span>
            </div>
          ))}
        </section>
      )}

      {detail.movements.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-xs font-semibold">Lotes que salieron</h4>
          <div className="border border-card-border rounded-lg divide-y divide-card-border">
            {detail.movements.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                <span>
                  {MOVEMENT_LABELS[m.type]} · {m.productName} · lote <span className="font-medium">{m.lotLabel}</span>
                  {m.expiryDate ? ` (vence ${m.expiryDate})` : ""}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {m.quantity > 0 ? `+${m.quantity}` : m.quantity} · {formatCents(m.valueCents, detail.margin.currency)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Lo que dejó el pedido, en la moneda del inventario. */
export function OrderMarginCard({ orderId }: { orderId: number }) {
  const { data: detail } = useGetOrderDetail(orderId, { query: { queryKey: getGetOrderDetailQueryKey(orderId) } });
  if (!detail) return <div className="h-32 rounded-lg bg-muted/40 animate-pulse" />;
  const m = detail.margin;
  const rows: Array<[string, number, string?]> = [
    ["Ingreso (total del pedido)", m.revenueCents],
    ["Costo de lo despachado (PEPS)", -m.costOfGoodsCents, "Por lote, neto de lo que volvió"],
    ["Costo del envío", -m.shippingCostCents, "Su parte de los cargos de los despachos"],
    ["Notas de crédito", -m.creditNotesCents],
  ];
  return (
    <div className="space-y-3">
      <div className="border border-card-border rounded-lg divide-y divide-card-border">
        {rows.map(([label, value, hint]) => (
          <div key={label} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>
              {label}
              {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
            </span>
            <span className="tabular-nums">{formatCents(value, m.currency)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold bg-muted/30">
          <span>Margen</span>
          <span className={cn("tabular-nums", m.marginCents < 0 && "text-red-600 dark:text-red-400")}>{formatCents(m.marginCents, m.currency)}</span>
        </div>
      </div>
      {m.rateMissing && <p className="text-xs text-amber-600">El pedido está en otra moneda y no tiene tasa: el ingreso se tomó 1 a 1.</p>}
      {m.costOfGoodsCents === 0 && <p className="text-xs text-muted-foreground">Todavía no sale nada del almacén: el costo aparece al despachar.</p>}
    </div>
  );
}
