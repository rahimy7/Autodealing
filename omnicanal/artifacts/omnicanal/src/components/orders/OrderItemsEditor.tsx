import { useMemo } from "react";
import { useListProducts, useListStock, getListStockQueryKey } from "@workspace/api-client-react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { centsToInput, formatCents, parseCents } from "@/lib/money";
import { ProductPicker } from "@/components/inventory/pickers";
import { useModules } from "@/lib/platform";

export type ItemDraft = {
  key: string;
  productId: number | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
};

export function draftFromItem(item: {
  id?: number;
  productId?: number | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
}): ItemDraft {
  return {
    key: String(item.id ?? Math.random()),
    productId: item.productId ?? null,
    description: item.description,
    quantity: String(item.quantity),
    unitPrice: centsToInput(item.unitPriceCents),
    discount: item.discountCents ? centsToInput(item.discountCents) : "",
  };
}

export function emptyItem(): ItemDraft {
  return { key: String(Math.random()), productId: null, description: "", quantity: "1", unitPrice: "", discount: "" };
}

/** Lo que viaja al API; null si alguna línea está mal. */
export function itemsPayload(items: ItemDraft[]) {
  const out = [];
  for (const i of items) {
    const quantity = Number(i.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return null;
    if (i.productId == null && !i.description.trim()) return null;
    out.push({
      productId: i.productId,
      description: i.description.trim() || null,
      quantity,
      unitPriceCents: parseCents(i.unitPrice),
      discountCents: parseCents(i.discount) ?? 0,
    });
  }
  return out;
}

export function lineTotal(i: ItemDraft): number {
  const quantity = Number(i.quantity) || 0;
  return Math.max(0, quantity * (parseCents(i.unitPrice) ?? 0) - (parseCents(i.discount) ?? 0));
}

/**
 * Las líneas del pedido contra el catálogo. Cada línea vinculada compromete
 * inventario en el almacén del pedido; una sin vincular (lo que la IA leyó y no
 * está en el catálogo) se marca para que alguien la vincule.
 */
export default function OrderItemsEditor({
  items,
  onChange,
  currency,
  warehouseId,
  readOnly,
  committedAlready = false,
}: {
  items: ItemDraft[];
  onChange: (items: ItemDraft[]) => void;
  currency: string;
  warehouseId: number | null;
  readOnly?: boolean;
  // Un pedido ya guardado ya está restado de lo disponible: ahí la alerta es
  // quedar en negativo, no tener menos que la cantidad de la línea.
  committedAlready?: boolean;
}) {
  const modules = useModules();
  const { data: products } = useListProducts();
  const stockParams = { warehouseId: warehouseId ?? undefined };
  const { data: stock } = useListStock(stockParams, { query: { enabled: modules.inventory, queryKey: getListStockQueryKey(stockParams) } });
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p] as const)), [products]);
  const availableById = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of stock ?? []) map.set(r.productId, (map.get(r.productId) ?? 0) + r.available);
    return map;
  }, [stock]);

  const patch = (key: string, change: Partial<ItemDraft>) => onChange(items.map((i) => (i.key === key ? { ...i, ...change } : i)));

  /** Lo disponible de un producto; en un kit, cuántos kits alcanzan con sus componentes. */
  const available = (productId: number): number | null => {
    const product = productById.get(productId);
    if (!product) return null;
    if (product.components?.length) {
      const per = product.components.map((c) => Math.floor((availableById.get(c.productId) ?? 0) / Math.max(1, c.quantity)));
      return per.length ? Math.min(...per) : null;
    }
    return product.trackInventory ? (availableById.get(productId) ?? 0) : null;
  };

  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const avail = modules.inventory && item.productId != null ? available(item.productId) : null;
        return (
          <div key={item.key} className="border border-card-border rounded-lg p-2.5 space-y-2" data-testid={`order-item-${index}`}>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                {readOnly ? (
                  <div className="text-sm font-medium truncate">{item.productId != null ? (productById.get(item.productId)?.name ?? item.description) : item.description}</div>
                ) : (
                  <ProductPicker
                    value={item.productId}
                    onChange={(p) =>
                      patch(item.key, {
                        productId: p.id,
                        description: p.name,
                        unitPrice: p.priceCents != null && (p.priceCurrency ?? currency) === currency ? centsToInput(p.priceCents) : item.unitPrice,
                      })
                    }
                    placeholder={item.description ? `Vincular "${item.description}"…` : "Elegir producto…"}
                    testId={`picker-order-item-${index}`}
                  />
                )}
              </div>
              {!readOnly && items.length > 0 && (
                <button type="button" onClick={() => onChange(items.filter((i) => i.key !== item.key))} className="text-muted-foreground hover:text-destructive" aria-label="Quitar línea">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            {item.productId == null && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" /> Sin vincular al catálogo{item.description ? `: "${item.description}"` : ""}. No compromete inventario hasta vincularla.
              </div>
            )}
            <div className="grid grid-cols-4 gap-2 items-end">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Cantidad</label>
                <Input type="number" min={1} value={item.quantity} onChange={(e) => patch(item.key, { quantity: e.target.value })} disabled={readOnly} className="h-8 text-sm" data-testid={`input-order-item-qty-${index}`} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Precio ({currency})</label>
                <Input value={item.unitPrice} onChange={(e) => patch(item.key, { unitPrice: e.target.value })} disabled={readOnly} placeholder="0.00" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Descuento</label>
                <Input value={item.discount} onChange={(e) => patch(item.key, { discount: e.target.value })} disabled={readOnly} placeholder="0.00" className="h-8 text-sm" />
              </div>
              <div className="text-right space-y-1">
                <div className="text-[11px] text-muted-foreground">Total</div>
                <div className="text-sm font-medium tabular-nums h-8 flex items-center justify-end">{formatCents(lineTotal(item), currency)}</div>
              </div>
            </div>
            {avail != null && !readOnly && (() => {
              const short = committedAlready ? avail < 0 : avail < (Number(item.quantity) || 0);
              return (
                <div className={cn("text-[11px]", short ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground")}>
                  Disponible en el almacén{committedAlready ? " (ya descontado este pedido)" : ""}: {avail}
                  {short ? " — no alcanza: queda comprometido hasta que llegue mercancía" : ""}
                </div>
              );
            })()}
          </div>
        );
      })}
      {!readOnly && (
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => onChange([...items, emptyItem()])} data-testid="button-add-order-item">
          <Plus className="w-3.5 h-3.5" /> Producto
        </Button>
      )}
    </div>
  );
}
