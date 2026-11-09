import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useListLots, useGetLotTrace, getGetLotTraceQueryKey, type StockLot } from "@workspace/api-client-react";
import { Layers, Search, Route } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useClient } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { formatCents, formatDateTime, formatDay } from "@/lib/money";
import { MOVEMENT_LABELS } from "./KardexTab";

/** Vence en menos de 90 días: se pinta en ámbar; vencido, en rojo. */
function expiryTone(day: string | null | undefined): string {
  if (!day) return "text-muted-foreground";
  const ms = new Date(`${day}T12:00:00`).getTime() - Date.now();
  if (ms < 0) return "text-red-600 dark:text-red-400 font-semibold";
  if (ms < 90 * 24 * 60 * 60 * 1000) return "text-amber-600 dark:text-amber-400 font-medium";
  return "text-muted-foreground";
}

export function LotTraceDialog({ lotId, onClose }: { lotId: number | null; onClose: () => void }) {
  const { locale } = useClient();
  const [, setLocation] = useLocation();
  const { data: trace, isLoading } = useGetLotTrace(lotId ?? 0, {
    query: { enabled: lotId != null, queryKey: getGetLotTraceQueryKey(lotId ?? 0) },
  });
  return (
    <Dialog open={lotId != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trazabilidad del lote {trace?.label ?? ""}</DialogTitle>
          <DialogDescription>De qué compra vino, dónde queda y a qué clientes se fue.</DialogDescription>
        </DialogHeader>
        {isLoading || !trace ? (
          <div className="h-32 rounded-lg bg-muted/40 animate-pulse" />
        ) : (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground">Origen</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {trace.lots.map((lot) => (
                  <div key={lot.id} className="border border-card-border rounded-lg p-3 text-sm space-y-0.5">
                    <div className="font-medium">{lot.productName}</div>
                    <div className="text-xs text-muted-foreground">
                      {lot.supplierName ? `Proveedor ${lot.supplierName}` : "Sin proveedor (inventario inicial o ajuste)"}
                      {lot.purchaseOrderCode ? ` · ${lot.purchaseOrderCode}` : ""}
                      {lot.receiptCode ? ` · ${lot.receiptCode}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Entraron {lot.initialQuantity} a {formatCents(lot.unitCostCents, locale.currency)} c/u · producción {formatDay(lot.productionDate)} ·{" "}
                      <span className={expiryTone(lot.expiryDate)}>vence {formatDay(lot.expiryDate)}</span>
                    </div>
                    <div className="text-xs">
                      Queda: {lot.quantity}
                      {lot.balances.length > 0 && ` (${lot.balances.map((b) => `${b.warehouseName} ${b.quantity}`).join(", ")})`}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground">Clientes que lo recibieron</h3>
              {trace.customers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no ha salido a ningún cliente.</p>
              ) : (
                <div className="divide-y divide-card-border border border-card-border rounded-lg">
                  {trace.customers.map((c) => (
                    <button
                      key={c.orderId}
                      type="button"
                      onClick={() => setLocation(`/orders?order=${c.orderId}`)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/40 text-left"
                    >
                      <span>
                        <span className="font-medium text-primary">{c.orderCode}</span> · {c.contactName ?? "Sin nombre"}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {c.quantity} u · {formatDateTime(c.date)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground">Movimientos</h3>
              <div className="border border-card-border rounded-lg overflow-x-auto">
                <table className="w-full text-xs min-w-[560px]">
                  <tbody>
                    {trace.movements.map((m) => (
                      <tr key={m.id} className="border-b border-card-border/50 last:border-0">
                        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                        <td className="px-3 py-1.5">{MOVEMENT_LABELS[m.type]}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{m.warehouseName}</td>
                        <td className={cn("px-3 py-1.5 text-right tabular-nums", m.quantity < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{m.reference ?? ""}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{m.contactName ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function LotsTab() {
  const { locale } = useClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [withStock, setWithStock] = useState(true);
  const [tracing, setTracing] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const { data: lots, isLoading } = useListLots({ withStock, search: debounced || undefined });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por número de lote o producto…" className="pl-8 h-9 text-sm" data-testid="input-lot-search" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={withStock} onCheckedChange={setWithStock} />
          Solo con existencia
        </label>
      </div>
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/40 animate-pulse" />)}</div>
        ) : (lots ?? []).length === 0 ? (
          <div className="p-10 text-center">
            <Layers className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No hay lotes{withStock ? " con existencia" : ""}.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-3">Lote</th>
                  <th className="text-left font-medium px-3 py-3">Producto</th>
                  <th className="text-left font-medium px-3 py-3">Vence</th>
                  <th className="text-left font-medium px-3 py-3">Origen</th>
                  <th className="text-left font-medium px-3 py-3">Saldo por almacén</th>
                  <th className="text-right font-medium px-3 py-3">Costo unit.</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {(lots ?? []).map((lot: StockLot) => (
                  <tr key={lot.id} className="border-b border-card-border/60 hover:bg-muted/40" data-testid={`lot-row-${lot.id}`}>
                    <td className="px-4 py-2.5 font-medium">{lot.label}</td>
                    <td className="px-3 py-2.5">{lot.productName}</td>
                    <td className={cn("px-3 py-2.5 text-xs whitespace-nowrap", expiryTone(lot.expiryDate))}>{formatDay(lot.expiryDate)}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {[lot.supplierName, lot.purchaseOrderCode, lot.receiptCode].filter(Boolean).join(" · ") || "Inventario inicial / ajuste"}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {lot.balances.length ? lot.balances.map((b) => `${b.warehouseName}: ${b.quantity}`).join(" · ") : <span className="text-muted-foreground">Agotado</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatCents(lot.unitCostCents, locale.currency)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => setTracing(lot.id)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" data-testid={`button-trace-${lot.id}`}>
                        <Route className="w-3.5 h-3.5" /> Trazabilidad
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <LotTraceDialog lotId={tracing} onClose={() => setTracing(null)} />
    </div>
  );
}
