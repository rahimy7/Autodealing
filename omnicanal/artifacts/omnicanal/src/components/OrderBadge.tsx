import { useLocation } from "wouter";
import { Package } from "lucide-react";
import type { ActiveOrderSummary, OrderStatus } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

// El mismo pedido puede estar Pendiente, En proceso o Enviado — Entregado y
// Cancelado ya no cuentan como "activo" (activeOrdersByConversationIds, en el
// servidor, ni los manda). Exportados: los usan también la fila de la bandeja
// y la vista de Pedidos, para no repetir el mapa en cada archivo.
export const ORDER_STATUS_STYLES: Record<OrderStatus, string> = {
  pending: "bg-amber-500/12 text-amber-600",
  processing: "bg-sky-500/12 text-sky-600",
  shipped: "bg-purple-500/12 text-purple-600",
  delivered: "bg-emerald-500/12 text-emerald-600",
  cancelled: "bg-muted text-muted-foreground",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pendiente",
  processing: "En proceso",
  shipped: "Enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

// El estado del pago según Shopify (displayFinancialStatus), en palabras del
// equipo. Solo informa: el pedido de Shopify entra Pendiente igual y el pago lo
// confirma el equipo aquí.
const SHOPIFY_PAYMENT: Record<string, { label: string; style: string }> = {
  PAID: { label: "pagado", style: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" },
  PARTIALLY_PAID: { label: "pago parcial", style: "bg-amber-500/12 text-amber-700 dark:text-amber-400" },
  PENDING: { label: "pago pendiente", style: "bg-amber-500/12 text-amber-700 dark:text-amber-400" },
  AUTHORIZED: { label: "pago autorizado", style: "bg-amber-500/12 text-amber-700 dark:text-amber-400" },
  PARTIALLY_REFUNDED: { label: "reembolso parcial", style: "bg-purple-500/12 text-purple-700 dark:text-purple-400" },
  REFUNDED: { label: "reembolsado", style: "bg-red-500/12 text-red-600 dark:text-red-400" },
  VOIDED: { label: "pago anulado", style: "bg-red-500/12 text-red-600 dark:text-red-400" },
  EXPIRED: { label: "pago vencido", style: "bg-red-500/12 text-red-600 dark:text-red-400" },
};

export function shopifyPayment(status: string | null | undefined): { label: string; style: string } | null {
  if (!status) return null;
  return SHOPIFY_PAYMENT[status.toUpperCase()] ?? { label: status.toLowerCase().replace(/_/g, " "), style: "bg-muted text-muted-foreground" };
}

/** "pagado", "pago pendiente"… según Shopify, como etiqueta chica para la fila y el detalle del pedido. */
export function ShopifyPaymentBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const payment = shopifyPayment(status);
  if (!payment) return null;
  return (
    <span className={cn("inline-flex items-center px-1.5 rounded text-[11px] font-medium", payment.style, className)} title="El estado del pago en Shopify">
      {payment.label}
    </span>
  );
}

/**
 * El pedido pendiente o en proceso de esta conversación, si tiene uno. Va junto
 * a SaleTrackingButton en el header del chat, y lleva directo a su fila en
 * Pedidos.
 */
export function OrderBadge({ order, className }: { order: ActiveOrderSummary | null | undefined; className?: string }) {
  const [, setLocation] = useLocation();
  if (!order) return null;

  return (
    <button
      type="button"
      onClick={() => setLocation(`/orders?order=${order.id}`)}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors hover:opacity-80",
        ORDER_STATUS_STYLES[order.status],
        className,
      )}
      title={`${order.code}${order.product ? ` · ${order.product}` : ""} — ver en Pedidos`}
      data-testid={`order-badge-${order.id}`}
    >
      <Package className="w-3 h-3 flex-shrink-0" />
      {order.code} · {ORDER_STATUS_LABELS[order.status]}
    </button>
  );
}
