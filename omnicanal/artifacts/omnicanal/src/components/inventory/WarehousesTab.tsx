import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListWarehouses, useCreateWarehouse, useUpdateWarehouse, type Warehouse } from "@workspace/api-client-react";
import { Plus, Warehouse as WarehouseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, invalidateApi } from "@/lib/money";

function WarehouseDialog({ warehouse, open, onOpenChange }: { warehouse: Warehouse | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateWarehouse();
  const update = useUpdateWarehouse();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [active, setActive] = useState(true);
  const [loaded, setLoaded] = useState<number | "new" | null>(null);
  const id = warehouse?.id ?? "new";
  if (open && loaded !== id) {
    setLoaded(id);
    setCode(warehouse?.code ?? "");
    setName(warehouse?.name ?? "");
    setAddress(warehouse?.address ?? "");
    setIsDefault(warehouse?.isDefault ?? false);
    setActive(warehouse?.active ?? true);
  }
  if (!open && loaded !== null) setLoaded(null);

  const done = (title: string) => {
    void invalidateApi(queryClient, "/api/warehouses", "/api/inventory");
    toast({ title });
    onOpenChange(false);
  };
  const fail = (err: unknown) => toast({ title: apiErrorMessage(err, "No se pudo guardar"), variant: "destructive" });

  const submit = () => {
    if (!code.trim() || !name.trim()) {
      toast({ title: "Pon código y nombre", variant: "destructive" });
      return;
    }
    if (warehouse) {
      update.mutate(
        { id: warehouse.id, data: { code, name, address: address.trim() || null, isDefault, active } },
        { onSuccess: () => done("Almacén actualizado"), onError: fail },
      );
    } else {
      create.mutate({ data: { code, name, address: address.trim() || null, isDefault } }, { onSuccess: () => done("Almacén creado"), onError: fail });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{warehouse ? `Almacén ${warehouse.code}` : "Nuevo almacén"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Código</label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="PRIN" data-testid="input-warehouse-code" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nombre</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Almacén principal" data-testid="input-warehouse-name" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Dirección</label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <label className="flex items-center justify-between text-sm">
            Por defecto (los pedidos nuevos se comprometen aquí)
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </label>
          {warehouse && (
            <label className="flex items-center justify-between text-sm">
              Activo
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          )}
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={submit} disabled={create.isPending || update.isPending} data-testid="button-save-warehouse">
              Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function WarehousesTab() {
  const { data: warehouses } = useListWarehouses();
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <Button
        size="sm"
        className="gap-1.5"
        onClick={() => {
          setEditing(null);
          setOpen(true);
        }}
        data-testid="button-new-warehouse"
      >
        <Plus className="w-4 h-4" /> Nuevo almacén
      </Button>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(warehouses ?? []).map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => {
              setEditing(w);
              setOpen(true);
            }}
            className="text-left bg-card border border-card-border rounded-xl p-4 hover:border-primary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <WarehouseIcon className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold">{w.name}</span>
              <span className="text-xs text-muted-foreground">{w.code}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">{w.address ?? "Sin dirección"}</div>
            <div className="flex gap-1.5 mt-2">
              {w.isDefault && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary">Por defecto</span>}
              {!w.active && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Inactivo</span>}
            </div>
          </button>
        ))}
        {(warehouses ?? []).length === 0 && <p className="text-sm text-muted-foreground">Crea el primer almacén: es donde se comprometen y desde donde salen los pedidos.</p>}
      </div>
      <WarehouseDialog warehouse={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}
