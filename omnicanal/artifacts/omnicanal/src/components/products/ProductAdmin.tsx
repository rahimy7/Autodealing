import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateProduct, useCreateProduct, type Product } from "@workspace/api-client-react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useClient, useModules } from "@/lib/platform";
import { apiErrorMessage, centsToInput, invalidateApi, parseCents } from "@/lib/money";
import { ProductPicker, isKit } from "@/components/inventory/pickers";

type ComponentDraft = { key: string; productId: number | null; quantity: string };

function ComponentsEditor({ value, onChange, selfId }: { value: ComponentDraft[]; onChange: (v: ComponentDraft[]) => void; selfId?: number }) {
  return (
    <div className="space-y-2">
      {value.map((c, index) => (
        <div key={c.key} className="flex items-center gap-2">
          <div className="flex-1">
            <ProductPicker
              value={c.productId}
              onChange={(p) => onChange(value.map((x) => (x.key === c.key ? { ...x, productId: p.id } : x)))}
              filter={(p) => p.id !== selfId && !isKit(p)}
              testId={`picker-component-${index}`}
            />
          </div>
          <Input type="number" min={1} value={c.quantity} onChange={(e) => onChange(value.map((x) => (x.key === c.key ? { ...x, quantity: e.target.value } : x)))} className="h-9 w-20" />
          <button type="button" onClick={() => onChange(value.filter((x) => x.key !== c.key))} className="text-muted-foreground hover:text-destructive" aria-label="Quitar componente">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => onChange([...value, { key: String(Math.random()), productId: null, quantity: "1" }])}>
        <Plus className="w-3.5 h-3.5" /> Componente
      </Button>
    </div>
  );
}

function componentsPayload(drafts: ComponentDraft[]) {
  return drafts.filter((c) => c.productId != null && Number(c.quantity) > 0).map((c) => ({ productId: c.productId!, quantity: Math.round(Number(c.quantity)) }));
}

/**
 * Lo que la web no tiene y el negocio sí necesita: precio de venta, SKU, si
 * controla inventario y, para un kit, sus componentes. El importador no pisa
 * nada de esto. El precio es el de los pedidos y márgenes: el agente sigue
 * cotizando lo de su base de conocimiento (decisión del 2026-10-04).
 */
export function ProductAdminSection({ product }: { product: Product }) {
  const { toast } = useToast();
  const { locale } = useClient();
  const modules = useModules();
  const queryClient = useQueryClient();
  const update = useUpdateProduct();
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku ?? "");
  const [price, setPrice] = useState(centsToInput(product.priceCents));
  const [currency, setCurrency] = useState(product.priceCurrency ?? locale.currency);
  const [track, setTrack] = useState(product.trackInventory ?? false);
  const [active, setActive] = useState(product.active ?? true);
  const [components, setComponents] = useState<ComponentDraft[]>([]);
  useEffect(() => {
    setName(product.name);
    setSku(product.sku ?? "");
    setPrice(centsToInput(product.priceCents));
    setCurrency(product.priceCurrency ?? locale.currency);
    setTrack(product.trackInventory ?? false);
    setActive(product.active ?? true);
    setComponents((product.components ?? []).map((c) => ({ key: String(c.productId), productId: c.productId, quantity: String(c.quantity) })));
  }, [product, locale.currency]);
  const kit = components.some((c) => c.productId != null);

  const save = () => {
    const priceCents = price.trim() ? parseCents(price) : null;
    if (price.trim() && priceCents == null) {
      toast({ title: "El precio no es un número", variant: "destructive" });
      return;
    }
    update.mutate(
      {
        id: product.id,
        data: {
          ...(product.source === "manual" ? { name: name.trim() } : {}),
          sku: sku.trim() || null,
          priceCents,
          priceCurrency: currency,
          trackInventory: kit ? false : track,
          active,
          components: componentsPayload(components),
        },
      },
      {
        onSuccess: () => {
          void invalidateApi(queryClient, "/api/products", "/api/inventory");
          toast({ title: "Producto guardado" });
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo guardar"), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="border border-card-border rounded-xl p-4 space-y-3" data-testid="product-admin">
      <div className="text-xs font-semibold text-foreground">Venta e inventario</div>
      {product.source === "manual" && (
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Nombre</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">SKU</label>
          <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Ej: PROC-01" data-testid="input-product-sku" />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Precio de venta</label>
          <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" data-testid="input-product-price" />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Moneda</label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="h-9">
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
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">Es el precio de los pedidos, descuentos y márgenes. Lo que cotiza el agente por chat sigue saliendo de su base de conocimiento.</p>
      {modules.inventory && (
        <label className="flex items-center justify-between text-sm">
          <span>
            Controla inventario
            <span className="block text-[11px] text-muted-foreground">{kit ? "Un kit no tiene existencias propias: las llevan sus componentes." : "Se compromete al vender, sale por lote al despachar y avisa bajo el punto de reorden."}</span>
          </span>
          <Switch checked={kit ? false : track} onCheckedChange={setTrack} disabled={kit} data-testid="switch-product-track" />
        </label>
      )}
      <label className="flex items-center justify-between text-sm">
        <span>
          Activo
          <span className="block text-[11px] text-muted-foreground">Uno inactivo no se ofrece en pedidos nuevos.</span>
        </span>
        <Switch checked={active} onCheckedChange={setActive} />
      </label>
      <div className="space-y-1.5">
        <div className="text-[11px] text-muted-foreground">Componentes (si es un kit)</div>
        <ComponentsEditor value={components} onChange={setComponents} selfId={product.id} />
      </div>
      <Button onClick={save} disabled={update.isPending} className="w-full" data-testid="button-save-product">
        Guardar
      </Button>
    </div>
  );
}

export function NewProductDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const { locale } = useClient();
  const queryClient = useQueryClient();
  const create = useCreateProduct();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [components, setComponents] = useState<ComponentDraft[]>([]);

  const submit = () => {
    if (!name.trim()) {
      toast({ title: "Pon el nombre", variant: "destructive" });
      return;
    }
    create.mutate(
      {
        data: {
          name: name.trim(),
          description: description.trim() || null,
          sku: sku.trim() || null,
          priceCents: price.trim() ? parseCents(price) : null,
          priceCurrency: locale.currency,
          components: componentsPayload(components),
        },
      },
      {
        onSuccess: (p) => {
          void invalidateApi(queryClient, "/api/products", "/api/inventory");
          toast({ title: `${p.name} creado` });
          setName("");
          setDescription("");
          setSku("");
          setPrice("");
          setComponents([]);
          onOpenChange(false);
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo crear"), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo producto</DialogTitle>
          <DialogDescription>Para lo que no está en la web: un kit, una presentación especial. No entra en la base de conocimiento del agente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kit de los 3 productos" data-testid="input-new-product-name" />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Descripción (opcional)" className="text-sm resize-none" />
          <div className="grid grid-cols-2 gap-2">
            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU" />
            <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder={`Precio (${locale.currency})`} data-testid="input-new-product-price" />
          </div>
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">Componentes (si es un kit)</div>
            <ComponentsEditor value={components} onChange={setComponents} />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={submit} disabled={create.isPending} data-testid="button-create-product">
              Crear
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
