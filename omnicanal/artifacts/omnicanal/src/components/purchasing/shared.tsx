import { useEffect, useState } from "react";
import { useListSuppliers, type PurchaseOrder, type PurchaseOrderStatus, type PurchaseRequestStatus } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fromNaturalRate, naturalRateLabel, toNaturalRate, useSuggestedRate } from "@/lib/rates";
import { formatCents } from "@/lib/money";

export const REQUEST_STATUS_LABELS: Record<PurchaseRequestStatus, string> = {
  open: "Abierto",
  approved: "Aprobado",
  ordered: "Convertido",
  cancelled: "Cancelado",
};

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Borrador",
  sent: "Enviada",
  partial: "Recibida en parte",
  received: "Recibida",
  closed: "Cerrada con faltante",
  cancelled: "Cancelada",
};

export const PO_STATUS_STYLES: Record<PurchaseOrderStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  partial: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  received: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  closed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function StatusPill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap", className)}>{children}</span>;
}

export function SupplierSelect({ value, onChange, allowNone, className, testId }: { value: number | null; onChange: (id: number | null) => void; allowNone?: boolean; className?: string; testId?: string }) {
  const { data: suppliers } = useListSuppliers();
  return (
    <Select value={value == null ? "none" : String(value)} onValueChange={(v) => onChange(v === "none" ? null : Number(v))}>
      <SelectTrigger className={cn("h-9 text-sm", className)} data-testid={testId}>
        <SelectValue placeholder="Proveedor" />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value="none">Sin proveedor</SelectItem>}
        {(suppliers ?? [])
          .filter((s) => s.active || s.id === value)
          .map((s) => (
            <SelectItem key={s.id} value={String(s.id)}>
              {s.name}
              {s.currency ? ` (${s.currency})` : ""}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

/**
 * La tasa de un documento en otra moneda, escrita como la publica el banco
 * ("63.50 DOP por USD"), y devuelta como `rateToBase`. Sugiere la del día.
 */
export function RateInput({
  currency,
  base,
  value,
  onChange,
  className,
}: {
  currency: string;
  base: string;
  value: number | null;
  onChange: (rateToBase: number | null) => void;
  className?: string;
}) {
  const suggested = useSuggestedRate(currency, base);
  const [text, setText] = useState(value != null ? toNaturalRate(value, currency, base).toFixed(4).replace(/\.?0+$/, "") : "");
  useEffect(() => {
    if (value == null && suggested != null) {
      onChange(suggested);
      setText(toNaturalRate(suggested, currency, base).toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested, currency, base]);
  useEffect(() => {
    if (value != null) setText(toNaturalRate(value, currency, base).toFixed(4).replace(/\.?0+$/, ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, base]);
  if (currency.toUpperCase() === base.toUpperCase()) return null;
  return (
    <div className={cn("space-y-1", className)}>
      <label className="text-[11px] text-muted-foreground">Tasa ({naturalRateLabel(currency, base)})</label>
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          onChange(n > 0 ? fromNaturalRate(n, currency, base) : null);
        }}
        placeholder={suggested != null ? toNaturalRate(suggested, currency, base).toFixed(2) : "Tasa"}
        className="h-9 text-sm"
        data-testid="input-rate"
      />
    </div>
  );
}

/** Abre la orden lista para imprimir o guardar como PDF desde el navegador. */
export function printPurchaseOrder(po: PurchaseOrder, businessName: string) {
  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const rows = po.items
    .map(
      (i) =>
        `<tr><td>${escape(i.productName)}${i.sku ? ` <small>(${escape(i.sku)})</small>` : ""}</td><td class="n">${i.quantity}</td><td class="n">${escape(formatCents(i.unitCostCents, po.currency))}</td><td class="n">${escape(formatCents(i.totalCents, po.currency))}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escape(po.code)}</title>
<style>body{font-family:system-ui,sans-serif;margin:40px;color:#222}h1{margin:0 0 4px;font-size:22px}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;font-size:14px}.n{text-align:right}tfoot td{font-weight:700;border-bottom:0}.meta{color:#555;font-size:14px;line-height:1.6}</style></head>
<body><h1>Orden de compra ${escape(po.code)}</h1><div class="meta">${escape(businessName)}</div>
<div class="meta" style="margin-top:16px"><b>Proveedor:</b> ${escape(po.supplierName)}${po.supplierReference ? ` · su referencia ${escape(po.supplierReference)}` : ""}<br>
<b>Entregar en:</b> ${escape(po.warehouseName ?? "")}${po.expectedDate ? ` · fecha esperada ${escape(po.expectedDate)}` : ""}<br>
<b>Fecha:</b> ${escape(po.orderDate ?? "")} · <b>Moneda:</b> ${escape(po.currency)}</div>
<table><thead><tr><th>Producto</th><th class="n">Cantidad</th><th class="n">Costo unit.</th><th class="n">Total</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="3" class="n">Total</td><td class="n">${escape(formatCents(po.totalCents, po.currency))}</td></tr></tfoot></table>
${po.notes ? `<p class="meta">${escape(po.notes)}</p>` : ""}<script>window.onload=()=>window.print()</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
