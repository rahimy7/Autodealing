import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListStockAdjustments,
  useListStockTransfers,
  useCreateStockAdjustment,
  useCreateStockTransfer,
  useListLots,
  useListWarehouses,
  getListLotsQueryKey,
  type StockAdjustmentReason,
} from "@workspace/api-client-react";
import { ArrowRightLeft, ClipboardCheck, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useClient } from "@/lib/platform";
import { apiErrorMessage, formatCents, formatDateTime, formatDay, invalidateApi, parseCents } from "@/lib/money";
import { ProductPicker, WarehouseSelect, isKit } from "./pickers";

export const ADJUSTMENT_REASON_LABELS: Record<StockAdjustmentReason, string> = {
  opening: "Inventario inicial",
  count: "Conteo físico",
  damage: "Daño",
  expiry: "Vencido",
  loss: "Pérdida",
  other: "Otro",
};

type LineDraft = {
  key: number;
  productId: number | null;
  direction: "in" | "out";
  quantity: string;
  lotId: number | null;
  lotNumber: string;
  productionDate: string;
  expiryDate: string;
  unitCost: string;
};

const NEW_LOT = "new";
const FEFO = "fefo";

function emptyLine(direction: "in" | "out"): LineDraft {
  return { key: Math.random(), productId: null, direction, quantity: "", lotId: null, lotNumber: "", productionDate: "", expiryDate: "", unitCost: "" };
}

function LotChoice({ line, warehouseId, onChange }: { line: LineDraft; warehouseId: number | null; onChange: (lotId: number | null) => void }) {
  const params = { productId: line.productId ?? undefined, warehouseId: warehouseId ?? undefined, withStock: line.direction === "out" };
  const { data: lots } = useListLots(params, { query: { enabled: line.productId != null, queryKey: getListLotsQueryKey(params) } });
  const options = (lots ?? []).filter((l) => line.direction === "in" || l.quantity > 0);
  return (
    <Select value={line.lotId == null ? (line.direction === "in" ? NEW_LOT : FEFO) : String(line.lotId)} onValueChange={(v) => onChange(v === NEW_LOT || v === FEFO ? null : Number(v))}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {line.direction === "in" ? <SelectItem value={NEW_LOT}>Lote nuevo</SelectItem> : <SelectItem value={FEFO}>Automático (vence primero)</SelectItem>}
        {options.map((l) => (
          <SelectItem key={l.id} value={String(l.id)}>
            {l.label} · vence {formatDay(l.expiryDate)}
            {line.direction === "out" ? ` · ${l.balances.find((b) => b.warehouseId === warehouseId)?.quantity ?? l.quantity} disp.` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AdjustmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const { locale } = useClient();
  const queryClient = useQueryClient();
  const { data: warehouses } = useListWarehouses();
  const create = useCreateStockAdjustment();
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [reason, setReason] = useState<StockAdjustmentReason>("opening");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine("in")]);
  const effectiveWarehouse = warehouseId ?? warehouses?.find((w) => w.isDefault)?.id ?? warehouses?.[0]?.id ?? null;

  const reset = () => {
    setWarehouseId(null);
    setReason("opening");
    setNotes("");
    setLines([emptyLine("in")]);
  };
  const patch = (key: number, change: Partial<LineDraft>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...change } : l)));

  const submit = () => {
    if (effectiveWarehouse == null) {
      toast({ title: "Crea primero un almacén", variant: "destructive" });
      return;
    }
    const payload = [];
    for (const l of lines) {
      const qty = Number(l.quantity);
      if (l.productId == null || !Number.isInteger(qty) || qty <= 0) {
        toast({ title: "Cada línea necesita producto y una cantidad entera mayor que cero", variant: "destructive" });
        return;
      }
      const unitCostCents = l.direction === "in" && l.lotId == null ? parseCents(l.unitCost) : null;
      if (l.direction === "in" && l.lotId == null && (unitCostCents == null || unitCostCents < 0)) {
        toast({ title: "Un lote nuevo necesita su costo unitario", variant: "destructive" });
        return;
      }
      payload.push({
        productId: l.productId,
        quantity: l.direction === "in" ? qty : -qty,
        lotId: l.lotId,
        lotNumber: l.lotNumber.trim() || null,
        productionDate: l.productionDate || null,
        expiryDate: l.expiryDate || null,
        unitCostCents,
      });
    }
    create.mutate(
      { data: { warehouseId: effectiveWarehouse, reason, notes: notes.trim() || null, lines: payload } },
      {
        onSuccess: (adj) => {
          void invalidateApi(queryClient, "/api/inventory");
          toast({ title: `Ajuste ${adj.code} registrado`, description: `Valor: ${formatCents(adj.valueCents, locale.currency)}` });
          reset();
          onOpenChange(false);
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo registrar el ajuste"), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajuste de inventario</DialogTitle>
          <DialogDescription>
            El inventario inicial y lo que entra en un lote nuevo llevan su costo unitario ({locale.currency}); lo que sale toma el costo del lote del que sale.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Almacén</label>
              <WarehouseSelect value={effectiveWarehouse} onChange={setWarehouseId} testId="select-adjustment-warehouse" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Motivo</label>
              <Select
                value={reason}
                onValueChange={(v) => {
                  const next = v as StockAdjustmentReason;
                  setReason(next);
                  if (next === "opening") setLines((prev) => prev.map((l) => ({ ...l, direction: "in" })));
                  if (next === "damage" || next === "expiry" || next === "loss") setLines((prev) => prev.map((l) => ({ ...l, direction: "out", lotId: null })));
                }}
              >
                <SelectTrigger className="h-9 text-sm" data-testid="select-adjustment-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ADJUSTMENT_REASON_LABELS) as StockAdjustmentReason[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ADJUSTMENT_REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            {lines.map((l, index) => (
              <div key={l.key} className="border border-card-border rounded-lg p-3 space-y-2" data-testid={`adjustment-line-${index}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-[220px]">
                    <ProductPicker value={l.productId} onChange={(p) => patch(l.key, { productId: p.id, lotId: null })} filter={(p) => !isKit(p)} testId={`picker-adjustment-product-${index}`} />
                  </div>
                  {reason !== "opening" && (
                    <Select value={l.direction} onValueChange={(v) => patch(l.key, { direction: v as "in" | "out", lotId: null })}>
                      <SelectTrigger className="h-9 w-28 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in">Entra</SelectItem>
                        <SelectItem value="out">Sale</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Input type="number" min={1} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} placeholder="Cant." className="h-9 w-24 text-sm" data-testid={`input-adjustment-qty-${index}`} />
                  {lines.length > 1 && (
                    <button type="button" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} className="text-muted-foreground hover:text-destructive" aria-label="Quitar línea">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {l.productId != null && (
                  <div className="grid gap-2 sm:grid-cols-5 items-end">
                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-[11px] text-muted-foreground">Lote</label>
                      <LotChoice line={l} warehouseId={effectiveWarehouse} onChange={(lotId) => patch(l.key, { lotId })} />
                    </div>
                    {l.direction === "in" && l.lotId == null && (
                      <>
                        <div className="space-y-1">
                          <label className="text-[11px] text-muted-foreground">Número de lote</label>
                          <Input value={l.lotNumber} onChange={(e) => patch(l.key, { lotNumber: e.target.value })} placeholder="Opcional" className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-muted-foreground">Vence</label>
                          <Input type="date" value={l.expiryDate} onChange={(e) => patch(l.key, { expiryDate: e.target.value })} className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-muted-foreground">Costo unit. ({locale.currency})</label>
                          <Input value={l.unitCost} onChange={(e) => patch(l.key, { unitCost: e.target.value })} placeholder="0.00" className="h-8 text-xs" data-testid={`input-adjustment-cost-${index}`} />
                        </div>
                        <div className="space-y-1 sm:col-start-3">
                          <label className="text-[11px] text-muted-foreground">Producción</label>
                          <Input type="date" value={l.productionDate} onChange={(e) => patch(l.key, { productionDate: e.target.value })} className="h-8 text-xs" />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setLines((prev) => [...prev, emptyLine(reason === "damage" || reason === "expiry" || reason === "loss" ? "out" : "in")])}>
              <Plus className="w-3.5 h-3.5" /> Línea
            </Button>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Notas</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm resize-none" />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={submit} disabled={create.isPending} data-testid="button-submit-adjustment">
              Registrar ajuste
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateStockTransfer();
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine("out")]);
  const patch = (key: number, change: Partial<LineDraft>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...change } : l)));

  const submit = () => {
    if (fromId == null || toId == null) {
      toast({ title: "Elige el almacén de origen y el de destino", variant: "destructive" });
      return;
    }
    const payload = [];
    for (const l of lines) {
      const qty = Number(l.quantity);
      if (l.productId == null || !Number.isInteger(qty) || qty <= 0) {
        toast({ title: "Cada línea necesita producto y cantidad", variant: "destructive" });
        return;
      }
      payload.push({ productId: l.productId, quantity: qty, lotId: l.lotId });
    }
    create.mutate(
      { data: { fromWarehouseId: fromId, toWarehouseId: toId, notes: notes.trim() || null, lines: payload } },
      {
        onSuccess: (t) => {
          void invalidateApi(queryClient, "/api/inventory");
          toast({ title: `Transferencia ${t.code} registrada`, description: `${t.units} unidades` });
          setLines([emptyLine("out")]);
          setNotes("");
          onOpenChange(false);
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo transferir"), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transferencia entre almacenes</DialogTitle>
          <DialogDescription>Cada unidad viaja con su lote y su costo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Sale de</label>
              <WarehouseSelect value={fromId} onChange={setFromId} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Llega a</label>
              <WarehouseSelect value={toId} onChange={setToId} />
            </div>
          </div>
          {lines.map((l, index) => (
            <div key={l.key} className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[200px]">
                <ProductPicker value={l.productId} onChange={(p) => patch(l.key, { productId: p.id, lotId: null })} filter={(p) => !isKit(p)} testId={`picker-transfer-product-${index}`} />
              </div>
              {l.productId != null && (
                <div className="w-56">
                  <LotChoice line={l} warehouseId={fromId} onChange={(lotId) => patch(l.key, { lotId })} />
                </div>
              )}
              <Input type="number" min={1} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} placeholder="Cant." className="h-9 w-24 text-sm" />
              {lines.length > 1 && (
                <button type="button" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} className="text-muted-foreground hover:text-destructive" aria-label="Quitar línea">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setLines((prev) => [...prev, emptyLine("out")])}>
            <Plus className="w-3.5 h-3.5" /> Línea
          </Button>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notas" className="text-sm resize-none" />
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={submit} disabled={create.isPending}>
              Transferir
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdjustmentsTab() {
  const { locale } = useClient();
  const { data: adjustments } = useListStockAdjustments();
  const { data: transfers } = useListStockTransfers();
  const [adjusting, setAdjusting] = useState(false);
  const [transferring, setTransferring] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="gap-1.5" onClick={() => setAdjusting(true)} data-testid="button-new-adjustment">
          <ClipboardCheck className="w-4 h-4" /> Ajuste o inventario inicial
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setTransferring(true)} data-testid="button-new-transfer">
          <ArrowRightLeft className="w-4 h-4" /> Transferencia
        </Button>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Ajustes</h3>
        <div className="bg-card border border-card-border rounded-xl overflow-x-auto">
          {(adjustments ?? []).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">Sin ajustes. Para empezar a llevar existencias, registra el inventario inicial con el conteo físico.</p>
          ) : (
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-2.5">Código</th>
                  <th className="text-left font-medium px-3 py-2.5">Fecha</th>
                  <th className="text-left font-medium px-3 py-2.5">Almacén</th>
                  <th className="text-left font-medium px-3 py-2.5">Motivo</th>
                  <th className="text-right font-medium px-3 py-2.5">Líneas</th>
                  <th className="text-right font-medium px-3 py-2.5">Valor</th>
                  <th className="text-left font-medium px-4 py-2.5">Quién</th>
                </tr>
              </thead>
              <tbody>
                {(adjustments ?? []).map((a) => (
                  <tr key={a.id} className="border-b border-card-border/60" title={a.notes ?? undefined}>
                    <td className="px-4 py-2 font-medium">{a.code}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</td>
                    <td className="px-3 py-2">{a.warehouseName}</td>
                    <td className="px-3 py-2">{ADJUSTMENT_REASON_LABELS[a.reason]}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.lineCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCents(a.valueCents, locale.currency)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{a.actorLabel ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Transferencias</h3>
        <div className="bg-card border border-card-border rounded-xl overflow-x-auto">
          {(transfers ?? []).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">Sin transferencias.</p>
          ) : (
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-2.5">Código</th>
                  <th className="text-left font-medium px-3 py-2.5">Fecha</th>
                  <th className="text-left font-medium px-3 py-2.5">De → a</th>
                  <th className="text-right font-medium px-3 py-2.5">Unidades</th>
                  <th className="text-left font-medium px-4 py-2.5">Quién</th>
                </tr>
              </thead>
              <tbody>
                {(transfers ?? []).map((t) => (
                  <tr key={t.id} className="border-b border-card-border/60" title={t.notes ?? undefined}>
                    <td className="px-4 py-2 font-medium">{t.code}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatDateTime(t.createdAt)}</td>
                    <td className="px-3 py-2">
                      {t.fromWarehouseName} → {t.toWarehouseName}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.units}</td>
                    <td className="px-4 py-2 text-muted-foreground">{t.actorLabel ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <AdjustmentDialog open={adjusting} onOpenChange={setAdjusting} />
      <TransferDialog open={transferring} onOpenChange={setTransferring} />
    </div>
  );
}
