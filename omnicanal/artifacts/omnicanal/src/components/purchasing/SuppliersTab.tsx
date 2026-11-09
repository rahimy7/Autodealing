import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListSuppliers, useCreateSupplier, useUpdateSupplier, type Supplier } from "@workspace/api-client-react";
import { Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, invalidateApi } from "@/lib/money";

function SupplierDialog({ supplier, open, onOpenChange }: { supplier: Supplier | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateSupplier();
  const update = useUpdateSupplier();
  const [form, setForm] = useState({ name: "", contactName: "", email: "", phone: "", country: "", currency: "", paymentTerms: "", leadTimeDays: "", notes: "", active: true });
  useEffect(() => {
    if (!open) return;
    setForm({
      name: supplier?.name ?? "",
      contactName: supplier?.contactName ?? "",
      email: supplier?.email ?? "",
      phone: supplier?.phone ?? "",
      country: supplier?.country ?? "",
      currency: supplier?.currency ?? "",
      paymentTerms: supplier?.paymentTerms ?? "",
      leadTimeDays: supplier?.leadTimeDays != null ? String(supplier.leadTimeDays) : "",
      notes: supplier?.notes ?? "",
      active: supplier?.active ?? true,
    });
  }, [open, supplier]);
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    if (!form.name.trim()) {
      toast({ title: "Pon el nombre", variant: "destructive" });
      return;
    }
    const data = {
      name: form.name,
      contactName: form.contactName || null,
      email: form.email || null,
      phone: form.phone || null,
      country: form.country || null,
      currency: form.currency || null,
      paymentTerms: form.paymentTerms || null,
      leadTimeDays: form.leadTimeDays ? Number(form.leadTimeDays) : null,
      notes: form.notes || null,
      active: form.active,
    };
    const opts = {
      onSuccess: () => {
        void invalidateApi(queryClient, "/api/suppliers");
        onOpenChange(false);
      },
      onError: (e: unknown) => toast({ title: apiErrorMessage(e, "No se pudo guardar"), variant: "destructive" }),
    };
    if (supplier) update.mutate({ id: supplier.id, data }, opts);
    else create.mutate({ data }, opts);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{supplier ? supplier.name : "Nuevo proveedor"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Nombre" data-testid="input-supplier-name" />
          <div className="grid grid-cols-2 gap-2">
            <Input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="Contacto" />
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Teléfono" />
          </div>
          <Input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="Correo (las órdenes se le envían aquí)" />
          <div className="grid grid-cols-3 gap-2">
            <Input value={form.country} onChange={(e) => set("country", e.target.value)} placeholder="País" />
            <Input value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} placeholder="Moneda (USD, DOP)" maxLength={3} />
            <Input type="number" min={0} value={form.leadTimeDays} onChange={(e) => set("leadTimeDays", e.target.value)} placeholder="Días de entrega" />
          </div>
          <Input value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="Condiciones de pago (contado, 30 días…)" />
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Notas" className="text-sm resize-none" />
          {supplier && (
            <label className="flex items-center justify-between text-sm">
              Activo
              <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />
            </label>
          )}
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={submit} disabled={create.isPending || update.isPending} data-testid="button-save-supplier">
              Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SuppliersTab() {
  const { data: suppliers } = useListSuppliers();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <Button size="sm" className="gap-1.5" onClick={() => { setEditing(null); setOpen(true); }} data-testid="button-new-supplier">
        <Plus className="w-4 h-4" /> Proveedor
      </Button>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(suppliers ?? []).map((s) => (
          <button key={s.id} type="button" onClick={() => { setEditing(s); setOpen(true); }} className="text-left bg-card border border-card-border rounded-xl p-4 hover:border-primary/50 transition-colors">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold">{s.name}</span>
              {!s.active && <span className="text-[10px] px-1.5 rounded bg-muted text-muted-foreground">inactivo</span>}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{[s.contactName, s.email, s.phone].filter(Boolean).join(" · ") || "Sin contacto"}</div>
            <div className="text-xs text-muted-foreground">{[s.country, s.currency, s.paymentTerms, s.leadTimeDays != null ? `${s.leadTimeDays} días` : null].filter(Boolean).join(" · ")}</div>
          </button>
        ))}
        {(suppliers ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sin proveedores todavía.</p>}
      </div>
      <SupplierDialog supplier={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}
