import { useMemo, useState } from "react";
import { useListProducts, useListWarehouses, type Product } from "@workspace/api-client-react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/money";

const ALL = "all";

/** Almacén: uno concreto, o "Todos" cuando `allowAll`. */
export function WarehouseSelect({
  value,
  onChange,
  allowAll = false,
  allLabel = "Todos los almacenes",
  className,
  testId,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  allowAll?: boolean;
  // Lo que significa "ninguno" donde se usa: "Todos los almacenes" en un filtro,
  // "El de por defecto" en una configuración.
  allLabel?: string;
  className?: string;
  testId?: string;
}) {
  const { data: warehouses } = useListWarehouses();
  const active = (warehouses ?? []).filter((w) => w.active || w.id === value);
  return (
    <Select value={value == null ? ALL : String(value)} onValueChange={(v) => onChange(v === ALL ? null : Number(v))}>
      <SelectTrigger className={cn("h-9 text-sm", className)} data-testid={testId}>
        <SelectValue placeholder="Almacén" />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value={ALL}>{allLabel}</SelectItem>}
        {active.map((w) => (
          <SelectItem key={w.id} value={String(w.id)}>
            {w.name}
            {w.isDefault ? " (por defecto)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Producto del catálogo con búsqueda. `filter` deja fuera lo que no aplica (por
 * ejemplo, los kits al cargar existencias: un kit no tiene existencias propias).
 */
export function ProductPicker({
  value,
  onChange,
  filter,
  placeholder = "Elegir producto…",
  className,
  testId,
}: {
  value: number | null;
  onChange: (product: Product) => void;
  filter?: (product: Product) => boolean;
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: products } = useListProducts();
  const options = useMemo(() => (products ?? []).filter((p) => p.active !== false && (!filter || filter(p))), [products, filter]);
  const selected = (products ?? []).find((p) => p.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm text-left shadow-sm",
            !selected && "text-muted-foreground",
            className,
          )}
          data-testid={testId}
        >
          <span className="truncate">{selected ? selected.name : placeholder}</span>
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-50 flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[320px]" align="start">
        <Command>
          <CommandInput placeholder="Buscar por nombre o SKU…" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {options.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.name} ${p.sku ?? ""} ${p.id}`}
                  onSelect={() => {
                    onChange(p);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("w-3.5 h-3.5", p.id === value ? "opacity-100" : "opacity-0")} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {[p.sku, p.priceCents != null ? formatCents(p.priceCents, p.priceCurrency) : null, p.components?.length ? "kit" : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function isKit(p: Pick<Product, "components">): boolean {
  return (p.components?.length ?? 0) > 0;
}
