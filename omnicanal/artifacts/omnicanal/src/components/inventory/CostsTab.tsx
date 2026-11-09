import { useState } from "react";
import { useLocation } from "wouter";
import { useGetInventoryValuation, useListOrderMargins } from "@workspace/api-client-react";
import { CheckCircle2, Download, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { downloadCsv, formatCents, formatDateTime } from "@/lib/money";

function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-semibold tabular-nums mt-1", tone === "warn" && "text-amber-600 dark:text-amber-400")}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

/**
 * Contabilidad de costo del inventario. No es la "venta" del Dashboard ni de
 * Reportes (la venta cerrada en el chat): aquí manda lo que salió del almacén y
 * su costo PEPS.
 */
export default function CostsTab() {
  const [, setLocation] = useLocation();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const { data: valuation } = useGetInventoryValuation({ from, to });
  const { data: margins } = useListOrderMargins({ from, to });
  const currency = valuation?.currency ?? "USD";
  const totals = (margins ?? []).reduce(
    (acc, m) => ({
      revenue: acc.revenue + m.revenueCents,
      cogs: acc.cogs + m.costOfGoodsCents,
      shipping: acc.shipping + m.shippingCostCents,
      credit: acc.credit + m.creditNotesCents,
      margin: acc.margin + m.marginCents,
    }),
    { revenue: 0, cogs: 0, shipping: 0, credit: 0, margin: 0 },
  );
  const balanced = valuation ? valuation.totalValueCents === valuation.ledgerValueCents : true;

  const exportCsv = () =>
    downloadCsv(
      `margenes-${from}-${to}.csv`,
      ["Pedido", "Shopify", "Cliente", "Despachado", `Ingreso (${currency})`, `Costo PEPS (${currency})`, `Envío (${currency})`, `Notas de crédito (${currency})`, `Margen (${currency})`],
      (margins ?? []).map((m) => [
        m.orderCode,
        m.externalName ?? "",
        m.contactName ?? "",
        m.dispatchedAt ? new Date(m.dispatchedAt).toISOString() : "",
        (m.revenueCents / 100).toFixed(2),
        (m.costOfGoodsCents / 100).toFixed(2),
        (m.shippingCostCents / 100).toFixed(2),
        (m.creditNotesCents / 100).toFixed(2),
        (m.marginCents / 100).toFixed(2),
      ]),
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40 text-sm" aria-label="Desde" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40 text-sm" aria-label="Hasta" />
        <span className="text-xs text-muted-foreground">Todo en {currency}, a costo PEPS por lote.</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Valor del inventario hoy"
          value={formatCents(valuation?.totalValueCents ?? 0, currency)}
          hint={valuation?.byWarehouse.map((w) => `${w.warehouseName}: ${formatCents(w.valueCents, currency)}`).join(" · ")}
        />
        <Stat label="Costo de lo vendido (despachado)" value={formatCents(valuation?.costOfSalesCents ?? 0, currency)} hint="Neto de lo que volvió sin entregarse" />
        <Stat label="Compras recibidas" value={formatCents(valuation?.receiptsCents ?? 0, currency)} />
        <Stat
          label="Ajustes (mermas en negativo)"
          value={formatCents(valuation?.adjustmentsCents ?? 0, currency)}
          hint={`Devoluciones que volvieron a existencias: ${formatCents(valuation?.returnsCents ?? 0, currency)}`}
          tone={(valuation?.adjustmentsCents ?? 0) < 0 ? "warn" : undefined}
        />
      </div>

      <div className={cn("flex items-center gap-2 text-xs", balanced ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
        {balanced ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
        {balanced
          ? "Los saldos cuadran con el libro de movimientos."
          : `Los saldos (${formatCents(valuation?.totalValueCents ?? 0, currency)}) no cuadran con el libro (${formatCents(valuation?.ledgerValueCents ?? 0, currency)}). Avísale a soporte.`}
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Margen por pedido despachado</h3>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv} disabled={!margins?.length}>
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
        </div>
        <div className="bg-card border border-card-border rounded-xl overflow-x-auto">
          {(margins ?? []).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">Ningún pedido despachado en estas fechas.</p>
          ) : (
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-2.5">Pedido</th>
                  <th className="text-left font-medium px-3 py-2.5">Cliente</th>
                  <th className="text-left font-medium px-3 py-2.5">Despachado</th>
                  <th className="text-right font-medium px-3 py-2.5">Ingreso</th>
                  <th className="text-right font-medium px-3 py-2.5">Costo</th>
                  <th className="text-right font-medium px-3 py-2.5">Envío</th>
                  <th className="text-right font-medium px-3 py-2.5">NC</th>
                  <th className="text-right font-medium px-4 py-2.5">Margen</th>
                </tr>
              </thead>
              <tbody>
                {(margins ?? []).map((m) => (
                  <tr key={m.orderId} className="border-b border-card-border/60 hover:bg-muted/40 cursor-pointer" onClick={() => setLocation(`/orders?order=${m.orderId}`)}>
                    <td className="px-4 py-2 font-medium text-primary">
                      {m.orderCode}
                      {m.externalName && <span className="text-xs text-muted-foreground font-normal"> · {m.externalName}</span>}
                    </td>
                    <td className="px-3 py-2">{m.contactName ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatDateTime(m.dispatchedAt)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCents(m.revenueCents, currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCents(m.costOfGoodsCents, currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCents(m.shippingCostCents, currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCents(m.creditNotesCents, currency)}</td>
                    <td className={cn("px-4 py-2 text-right tabular-nums font-semibold", m.marginCents < 0 && "text-red-600 dark:text-red-400")}>{formatCents(m.marginCents, currency)}</td>
                  </tr>
                ))}
                <tr className="bg-muted/30 font-semibold">
                  <td className="px-4 py-2" colSpan={3}>
                    Total ({margins?.length} pedidos)
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(totals.revenue, currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(totals.cogs, currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(totals.shipping, currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(totals.credit, currency)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCents(totals.margin, currency)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
