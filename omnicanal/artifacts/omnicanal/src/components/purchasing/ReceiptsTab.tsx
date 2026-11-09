import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListPurchaseReceipts, useCreatePurchaseReceipt, useListWarehouses } from "@workspace/api-client-react";
import { PackagePlus, Plus, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useClient } from "@/lib/platform";
import { apiErrorMessage, formatCents, formatDateTime, formatDay, invalidateApi, parseCents } from "@/lib/money";
import { ProductPicker, WarehouseSelect, isKit } from "@/components/inventory/pickers";
import { RateInput, SupplierSelect } from "./shared";

type Line = { key: string; productId: number | null; quantity: string; unitCost: string; lotNumber: string; expiryDate: string };
const emptyLine = (): Line => ({ key: String(Math.random()), productId: null, quantity: "", unitCost: "", lotNumber: "", expiryDate: "" });

/** Lo que llega sin orden de compra: una compra directa, una muestra, lo que vino de más. */
function DirectReceiptDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const { locale } = useClient();
  const queryClient = useQueryClient();
  const { data: warehouses } = useListWarehouses();
  const create = useCreatePurchaseReceipt();
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [currency, setCurrency] = useState(locale.currency);
  const [rate, setRate] = useState<number | null>(null);
  const [invoice, setInvoice] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const effectiveWarehouse = warehouseId ?? warehouses?.find((w) => w.isDefault)?.id ?? warehouses?.[0]?.id ?? null;
  const patch = (key: string, change: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...change } : l)));

  const submit = () => {
    const payload = [];
    for (const l of lines) {
      const quantity = Number(l.quantity);
      const unitCostCents = parseCents(l.unitCost);
      if (l.productId == null || !Number.isInteger(quantity) || quantity <= 0 || unitCostCents == null) {
        toast({ title: "Cada línea necesita producto, cantidad y costo", variant: "destructive" });
        return;
      }
      payload.push({ productId: l.productId, quantity, unitCostCents, lotNumber: l.lotNumber.trim() || null, expiryDate: l.expiryDate || null });
    }
    create.mutate(
      { data: { supplierId, warehouseId: effectiveWarehouse, currency, rateToBase: currency === locale.currency ? 1 : rate, supplierInvoice: invoice.trim() || null, lines: payload } },
      {
        onSuccess: (r) => {
          void invalidateApi(queryClient, "/api/purchasing", "/api/inventory");
          toast({ title: `Recepción ${r.code} registrada` });
          setLines([emptyLine()]);
          onOpenChange(false);
        },
        onError: (e) => toast({ title: apiErrorMessage(e, "No se pudo recibir"), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recepción sin orden de compra</DialogTitle>
          <DialogDescription>Cada línea entra como un lote con su costo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <SupplierSelect value={supplierId} onChange={setSupplierId} allowNone />
            <WarehouseSelect value={effectiveWarehouse} onChange={setWarehouseId} />
            <Select value={currency} onValueChange={(v) => { setCurrency(v); setRate(null); }}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([locale.currency, "USD", "DOP"])].map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Factura" className="h-9 text-sm" />
          </div>
          <RateInput currency={currency} base={locale.currency} value={rate} onChange={setRate} className="max-w-xs" />
          {lines.map((l, index) => (
            <div key={l.key} className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[200px]">
                <ProductPicker value={l.productId} onChange={(p) => patch(l.key, { productId: p.id })} filter={(p) => !isKit(p)} testId={`picker-direct-receipt-${index}`} />
              </div>
              <Input type="number" min={1} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} placeholder="Cant." className="h-9 w-20" />
              <Input value={l.unitCost} onChange={(e) => patch(l.key, { unitCost: e.target.value })} placeholder={`Costo (${currency})`} className="h-9 w-28" />
              <Input value={l.lotNumber} onChange={(e) => patch(l.key, { lotNumber: e.target.value })} placeholder="Lote" className="h-9 w-28" />
              <Input type="date" value={l.expiryDate} onChange={(e) => patch(l.key, { expiryDate: e.target.value })} className="h-9 w-36 text-xs" aria-label="Vence" />
              {lines.length > 1 && (
                <button type="button" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} className="text-muted-foreground hover:text-destructive" aria-label="Quitar">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
            <Plus className="w-3.5 h-3.5" /> Producto
          </Button>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button className="flex-1 gap-1.5" onClick={submit} disabled={create.isPending}>
              <PackagePlus className="w-4 h-4" /> Recibir
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ReceiptsTab() {
  const { locale } = useClient();
  const { data: receipts, isLoading } = useListPurchaseReceipts();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)} data-testid="button-direct-receipt">
        <PackagePlus className="w-4 h-4" /> Recepción sin orden
      </Button>
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/40 animate-pulse" />)}</div>
        ) : (receipts ?? []).length === 0 ? (
          <div className="p-10 text-center">
            <Truck className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Sin recepciones. Se registran desde una orden de compra (Recibir mercancía) o aquí, sin orden.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-3">Recepción</th>
                  <th className="text-left font-medium px-3 py-3">Proveedor</th>
                  <th className="text-left font-medium px-3 py-3">Lotes</th>
                  <th className="text-right font-medium px-3 py-3">Total</th>
                  <th className="text-right font-medium px-4 py-3">Costo en {locale.currency}</th>
                </tr>
              </thead>
              <tbody>
                {(receipts ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-card-border/60 align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.code}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatDateTime(r.receivedAt)} · {r.warehouseName}
                        {r.purchaseOrderCode ? ` · ${r.purchaseOrderCode}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.supplierName ?? "—"}
                      {r.supplierInvoice && <div className="text-[11px] text-muted-foreground">Factura {r.supplierInvoice}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.items.map((i) => (
                        <div key={i.id}>
                          {i.productName} x{i.quantity} · lote {i.lotLabel ?? "—"}
                          {i.expiryDate ? ` · vence ${formatDay(i.expiryDate)}` : ""}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCents(r.totalCents, r.currency)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatCents(r.totalBaseCents, locale.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <DirectReceiptDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
