import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListStock, useUpsertReorderRule, useDeleteReorderRule, type StockRow } from "@workspace/api-client-react";
import { AlertTriangle, Boxes, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiErrorMessage, formatCents, formatDay, invalidateApi } from "@/lib/money";
import { useClient } from "@/lib/platform";
import { WarehouseSelect } from "./pickers";

const STATUS_STYLES: Record<StockRow["status"], string> = {
  ok: "text-foreground",
  low: "text-amber-600 dark:text-amber-400 font-semibold",
  negative: "text-red-600 dark:text-red-400 font-semibold",
};

function ReorderDialog({ row, onClose }: { row: StockRow | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const upsert = useUpsertReorderRule();
  const remove = useDeleteReorderRule();
  const [min, setMin] = useState("");
  const [target, setTarget] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = row ? `${row.productId}:${row.warehouseId}` : null;
  if (row && key !== loadedFor) {
    setLoadedFor(key);
    setMin(row.minQuantity != null ? String(row.minQuantity) : "");
    setTarget(row.targetQuantity != null ? String(row.targetQuantity) : "");
  }

  const save = () => {
    if (!row) return;
    const minQuantity = Number(min);
    const targetQuantity = Number(target);
    if (!Number.isInteger(minQuantity) || !Number.isInteger(targetQuantity) || minQuantity < 0 || targetQuantity <= minQuantity) {
      toast({ title: "Revisa los números", description: "El stock objetivo tiene que ser mayor que el punto de reorden.", variant: "destructive" });
      return;
    }
    upsert.mutate(
      { data: { productId: row.productId, warehouseId: row.warehouseId, minQuantity, targetQuantity } },
      {
        onSuccess: () => {
          void invalidateApi(queryClient, "/api/inventory");
          toast({ title: "Punto de reorden guardado" });
          onClose();
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo guardar"), variant: "destructive" }),
      },
    );
  };

  const clear = () => {
    if (!row?.reorderRuleId) return;
    remove.mutate(
      { id: row.reorderRuleId },
      {
        onSuccess: () => {
          void invalidateApi(queryClient, "/api/inventory");
          toast({ title: "Punto de reorden quitado" });
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={row != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Punto de reorden</DialogTitle>
          <DialogDescription>
            {row?.productName} · {row?.warehouseName}. Cuando lo disponible más lo que viene baje al punto de reorden, se pide hasta el stock objetivo.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Punto de reorden</label>
            <Input type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} data-testid="input-reorder-min" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Stock objetivo</label>
            <Input type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} data-testid="input-reorder-target" />
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          {row?.reorderRuleId != null && (
            <Button variant="outline" onClick={clear} disabled={remove.isPending}>
              Quitar
            </Button>
          )}
          <Button className="flex-1" onClick={save} disabled={upsert.isPending} data-testid="button-save-reorder">
            Guardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function StockTab() {
  const { locale } = useClient();
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<StockRow | null>(null);
  const { data, isLoading } = useListStock({ warehouseId: warehouseId ?? undefined, status: onlyAlerts ? "low" : undefined });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter((r) => !term || r.productName.toLowerCase().includes(term) || (r.sku ?? "").toLowerCase().includes(term));
  }, [data, search]);
  const totalValue = rows.reduce((sum, r) => sum + r.valueCents, 0);
  const alerts = (data ?? []).filter((r) => r.status !== "ok").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <WarehouseSelect value={warehouseId} onChange={setWarehouseId} allowAll className="w-56" testId="select-stock-warehouse" />
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto o SKU…" className="pl-8 h-9 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={onlyAlerts} onCheckedChange={setOnlyAlerts} data-testid="switch-stock-alerts" />
          Solo alertas
        </label>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>
          Valor a costo PEPS: <span className="font-semibold text-foreground tabular-nums">{formatCents(totalValue, locale.currency)}</span>
        </span>
        {alerts > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" /> {alerts} {alerts === 1 ? "producto bajo el mínimo o vendido de más" : "productos bajo el mínimo o vendidos de más"}
          </span>
        )}
      </div>

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/40 animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <Boxes className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {onlyAlerts ? "Nada bajo el mínimo." : "Ningún producto controla inventario todavía. Actívalo en el Catálogo o carga el inventario inicial en Ajustes."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-3">Producto</th>
                  <th className="text-left font-medium px-3 py-3">Almacén</th>
                  <th className="text-right font-medium px-3 py-3" title="Unidades físicamente en el almacén">En mano</th>
                  <th className="text-right font-medium px-3 py-3" title="Vendido y todavía sin despachar">Comprometido</th>
                  <th className="text-right font-medium px-3 py-3" title="En mano − comprometido">Disponible</th>
                  <th className="text-right font-medium px-3 py-3" title="Lo que viene en órdenes de compra + lo ya pedido">Por recibir</th>
                  <th className="text-right font-medium px-3 py-3">Reorden</th>
                  <th className="text-right font-medium px-3 py-3">Pedir</th>
                  <th className="text-left font-medium px-3 py-3">Vence</th>
                  <th className="text-right font-medium px-4 py-3">Valor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.productId}:${r.warehouseId}`} className="border-b border-card-border/60 hover:bg-muted/40" data-testid={`stock-row-${r.productId}-${r.warehouseId}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground">{r.productName}</div>
                      {r.sku && <div className="text-xs text-muted-foreground">{r.sku}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.warehouseName}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.onHand}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{r.committed}</td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", STATUS_STYLES[r.status])}>{r.available}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{r.onOrder + r.requested || "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button type="button" onClick={() => setEditing(r)} className="text-xs text-primary hover:underline tabular-nums" data-testid={`button-reorder-${r.productId}-${r.warehouseId}`}>
                        {r.minQuantity != null ? `${r.minQuantity} → ${r.targetQuantity}` : "Fijar"}
                      </button>
                    </td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", r.need > 0 ? "font-semibold text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{r.need || "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">{formatDay(r.nextExpiry)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{formatCents(r.valueCents, locale.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ReorderDialog row={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
