import { useState } from "react";
import { useListStockMovements, type StockMovementType } from "@workspace/api-client-react";
import { Download, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useClient } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { downloadCsv, formatCents, formatDateTime } from "@/lib/money";
import { ProductPicker, WarehouseSelect, isKit } from "./pickers";

export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  opening: "Inventario inicial",
  receipt: "Recepción de compra",
  adjustment_in: "Ajuste (entra)",
  adjustment_out: "Ajuste (sale)",
  transfer_out: "Transferencia (sale)",
  transfer_in: "Transferencia (entra)",
  dispatch: "Despacho",
  dispatch_reversal: "No entregado (vuelve)",
  return: "Devolución de cliente",
};

export default function KardexTab() {
  const { locale } = useClient();
  const [productId, setProductId] = useState<number | null>(null);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data: movements, isLoading } = useListStockMovements({
    productId: productId ?? undefined,
    warehouseId: warehouseId ?? undefined,
    from: from || undefined,
    to: to || undefined,
    limit: productId ? 2000 : 300,
  });
  const isKardex = productId != null;

  const exportCsv = () => {
    downloadCsv(
      `${isKardex ? "kardex" : "movimientos"}-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Fecha", "Tipo", "Producto", "Almacén", "Lote", "Vence", "Cantidad", `Valor (${locale.currency})`, "Saldo", `Saldo valor (${locale.currency})`, "Referencia", "Cliente", "Quién", "Nota"],
      (movements ?? []).map((m) => [
        new Date(m.createdAt).toISOString(),
        MOVEMENT_LABELS[m.type],
        m.productName,
        m.warehouseName,
        m.lotLabel,
        m.expiryDate ?? "",
        m.quantity,
        (m.valueCents / 100).toFixed(2),
        m.balanceQuantity ?? "",
        m.balanceValueCents != null ? (m.balanceValueCents / 100).toFixed(2) : "",
        m.reference ?? "",
        m.contactName ?? "",
        m.actorLabel ?? "",
        m.note ?? "",
      ]),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-64">
          <ProductPicker value={productId} onChange={(p) => setProductId(p.id)} filter={(p) => !isKit(p)} placeholder="Todos los productos" testId="picker-kardex-product" />
        </div>
        {productId != null && (
          <Button variant="ghost" size="sm" onClick={() => setProductId(null)}>
            Quitar producto
          </Button>
        )}
        <WarehouseSelect value={warehouseId} onChange={setWarehouseId} allowAll className="w-52" />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40 text-sm" aria-label="Desde" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40 text-sm" aria-label="Hasta" />
        <Button variant="outline" size="sm" className="gap-1.5 ml-auto" onClick={exportCsv} disabled={!movements?.length} data-testid="button-export-movements">
          <Download className="w-3.5 h-3.5" /> CSV
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {isKardex
          ? "Kárdex: los movimientos del producto en orden, con el saldo y su valor a costo PEPS después de cada uno."
          : "Los movimientos más recientes. Elige un producto para ver su kárdex con el saldo corrido."}
      </p>
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-9 rounded-lg bg-muted/40 animate-pulse" />)}</div>
        ) : (movements ?? []).length === 0 ? (
          <div className="p-10 text-center">
            <ScrollText className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Sin movimientos en este filtro.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-3">Fecha</th>
                  <th className="text-left font-medium px-3 py-3">Movimiento</th>
                  {!isKardex && <th className="text-left font-medium px-3 py-3">Producto</th>}
                  <th className="text-left font-medium px-3 py-3">Almacén</th>
                  <th className="text-left font-medium px-3 py-3">Lote</th>
                  <th className="text-right font-medium px-3 py-3">Cantidad</th>
                  <th className="text-right font-medium px-3 py-3">Valor</th>
                  {isKardex && <th className="text-right font-medium px-3 py-3">Saldo</th>}
                  {isKardex && <th className="text-right font-medium px-3 py-3">Valor saldo</th>}
                  <th className="text-left font-medium px-4 py-3">Referencia</th>
                </tr>
              </thead>
              <tbody>
                {(movements ?? []).map((m) => (
                  <tr key={m.id} className="border-b border-card-border/60 hover:bg-muted/40">
                    <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                    <td className="px-3 py-2">{MOVEMENT_LABELS[m.type]}</td>
                    {!isKardex && <td className="px-3 py-2">{m.productName}</td>}
                    <td className="px-3 py-2 text-muted-foreground">{m.warehouseName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{m.lotLabel}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", m.quantity < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCents(m.valueCents, locale.currency)}</td>
                    {isKardex && <td className="px-3 py-2 text-right tabular-nums font-medium">{m.balanceQuantity}</td>}
                    {isKardex && <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCents(m.balanceValueCents, locale.currency)}</td>}
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {[m.reference, m.contactName, m.note].filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
