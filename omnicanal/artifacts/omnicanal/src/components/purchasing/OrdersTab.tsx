import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPurchaseOrders,
  getListPurchaseOrdersQueryKey,
  useCreatePurchaseOrder,
  useUpdatePurchaseOrder,
  useSendPurchaseOrder,
  useCancelPurchaseOrder,
  useClosePurchaseOrder,
  useCreatePurchaseReceipt,
  useListSuppliers,
  useListWarehouses,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from "@workspace/api-client-react";
import { FileText, Mail, PackagePlus, Plus, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useClient } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { apiErrorMessage, centsToInput, formatCents, formatDay, invalidateApi, parseCents } from "@/lib/money";
import { ProductPicker, WarehouseSelect, isKit } from "@/components/inventory/pickers";
import { PO_STATUS_LABELS, PO_STATUS_STYLES, RateInput, StatusPill, SupplierSelect, printPurchaseOrder } from "./shared";

type LineDraft = { key: string; productId: number | null; quantity: string; unitCost: string };

function linesFrom(po: PurchaseOrder | null): LineDraft[] {
  if (!po) return [{ key: String(Math.random()), productId: null, quantity: "", unitCost: "" }];
  return po.items.map((i) => ({ key: String(i.id), productId: i.productId, quantity: String(i.quantity), unitCost: centsToInput(i.unitCostCents) }));
}

/** Recibir mercancía: lo que llegó de cada línea, con su lote, vencimiento y costo. */
export function ReceiveDialog({ po, onClose }: { po: PurchaseOrder | null; onClose: () => void }) {
  const { toast } = useToast();
  const { locale } = useClient();
  const queryClient = useQueryClient();
  const create = useCreatePurchaseReceipt();
  const [rows, setRows] = useState<Record<number, { quantity: string; lotNumber: string; productionDate: string; expiryDate: string; unitCost: string }>>({});
  const [rate, setRate] = useState<number | null>(null);
  const [invoice, setInvoice] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!po) return;
    setRows(Object.fromEntries(po.items.filter((i) => i.pendingQuantity > 0).map((i) => [i.id, { quantity: String(i.pendingQuantity), lotNumber: "", productionDate: "", expiryDate: "", unitCost: centsToInput(i.unitCostCents) }])));
    setRate(po.rateToBase ?? null);
    setInvoice("");
    setNotes("");
  }, [po]);
  if (!po) return null;

  const submit = () => {
    const lines = [];
    for (const item of po.items) {
      const row = rows[item.id];
      if (!row) continue;
      const quantity = Number(row.quantity);
      if (!quantity) continue;
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > item.pendingQuantity) {
        toast({ title: `${item.productName}: entre 0 y ${item.pendingQuantity}`, variant: "destructive" });
        return;
      }
      lines.push({
        purchaseOrderItemId: item.id,
        productId: item.productId,
        quantity,
        unitCostCents: parseCents(row.unitCost),
        lotNumber: row.lotNumber.trim() || null,
        productionDate: row.productionDate || null,
        expiryDate: row.expiryDate || null,
      });
    }
    if (lines.length === 0) {
      toast({ title: "Pon cuánto llegó", variant: "destructive" });
      return;
    }
    if (po.currency !== locale.currency && !(rate && rate > 0)) {
      toast({ title: "Falta la tasa con que se costea", variant: "destructive" });
      return;
    }
    create.mutate(
      { data: { purchaseOrderId: po.id, rateToBase: rate, supplierInvoice: invoice.trim() || null, notes: notes.trim() || null, lines } },
      {
        onSuccess: (r) => {
          void invalidateApi(queryClient, "/api/purchasing", "/api/inventory");
          toast({ title: `Recepción ${r.code} registrada`, description: `Entró al inventario a ${formatCents(r.totalBaseCents, locale.currency)}.` });
          onClose();
        },
        onError: (e) => toast({ title: apiErrorMessage(e, "No se pudo recibir"), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recibir {po.code}</DialogTitle>
          <DialogDescription>
            {po.supplierName} → {po.warehouseName}. Cada línea entra como un lote con su costo; el lote de producción y el vencimiento son los del envase.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {po.items
            .filter((i) => i.pendingQuantity > 0)
            .map((item) => {
              const row = rows[item.id];
              if (!row) return null;
              const set = (change: Partial<typeof row>) => setRows((prev) => ({ ...prev, [item.id]: { ...prev[item.id], ...change } }));
              return (
                <div key={item.id} className="border border-card-border rounded-lg p-3 space-y-2" data-testid={`receive-line-${item.id}`}>
                  <div className="text-sm font-medium">
                    {item.productName} <span className="text-xs text-muted-foreground font-normal">· faltan {item.pendingQuantity} de {item.quantity}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-5">
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">Llegaron</label>
                      <Input type="number" min={0} max={item.pendingQuantity} value={row.quantity} onChange={(e) => set({ quantity: e.target.value })} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">Lote</label>
                      <Input value={row.lotNumber} onChange={(e) => set({ lotNumber: e.target.value })} placeholder="Del envase" className="h-8 text-sm" data-testid={`input-receive-lot-${item.id}`} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">Producción</label>
                      <Input type="date" value={row.productionDate} onChange={(e) => set({ productionDate: e.target.value })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">Vence</label>
                      <Input type="date" value={row.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} className="h-8 text-xs" data-testid={`input-receive-expiry-${item.id}`} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">Costo ({po.currency})</label>
                      <Input value={row.unitCost} onChange={(e) => set({ unitCost: e.target.value })} className="h-8 text-sm" />
                    </div>
                  </div>
                </div>
              );
            })}
          <div className="grid gap-2 sm:grid-cols-3">
            <RateInput currency={po.currency} base={locale.currency} value={rate} onChange={setRate} />
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Factura del proveedor</label>
              <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="NCF o número" className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Notas</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancelar
            </Button>
            <Button className="flex-1 gap-1.5" onClick={submit} disabled={create.isPending} data-testid="button-confirm-receive">
              <PackagePlus className="w-4 h-4" /> Recibir al inventario
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseOrderDialog({ po, open, onOpenChange, onReceive }: { po: PurchaseOrder | null; open: boolean; onOpenChange: (o: boolean) => void; onReceive: (po: PurchaseOrder) => void }) {
  const { toast } = useToast();
  const { locale, business } = useClient();
  const queryClient = useQueryClient();
  const { data: suppliers } = useListSuppliers();
  const { data: warehouses } = useListWarehouses();
  const create = useCreatePurchaseOrder();
  const update = useUpdatePurchaseOrder();
  const send = useSendPurchaseOrder();
  const cancel = useCancelPurchaseOrder();
  const close = useClosePurchaseOrder();
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [currency, setCurrency] = useState(locale.currency);
  const [rate, setRate] = useState<number | null>(null);
  const [expectedDate, setExpectedDate] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(linesFrom(null));
  const [emailTo, setEmailTo] = useState("");
  useEffect(() => {
    if (!open) return;
    setSupplierId(po?.supplierId ?? null);
    setWarehouseId(po?.warehouseId ?? null);
    setCurrency(po?.currency ?? locale.currency);
    setRate(po?.rateToBase ?? null);
    setExpectedDate(po?.expectedDate ?? "");
    setReference(po?.supplierReference ?? "");
    setNotes(po?.notes ?? "");
    setLines(linesFrom(po));
    setEmailTo(po?.supplierEmail ?? "");
  }, [open, po, locale.currency]);
  const editable = !po || po.status === "draft" || po.status === "sent";
  const effectiveWarehouse = warehouseId ?? warehouses?.find((w) => w.isDefault)?.id ?? warehouses?.[0]?.id ?? null;
  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (parseCents(l.unitCost) ?? 0), 0);
  const patchLine = (key: string, change: Partial<LineDraft>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...change } : l)));
  const refresh = () => invalidateApi(queryClient, "/api/purchasing", "/api/inventory");
  const fail = (e: unknown, fallback: string) => toast({ title: apiErrorMessage(e, fallback), variant: "destructive" });

  const items = () => {
    const out = [];
    for (const l of lines) {
      if (l.productId == null) continue;
      const quantity = Number(l.quantity);
      const unitCostCents = parseCents(l.unitCost) ?? 0;
      if (!Number.isInteger(quantity) || quantity <= 0) return null;
      out.push({ productId: l.productId, quantity, unitCostCents });
    }
    return out;
  };

  const save = () => {
    const payload = items();
    if (supplierId == null || effectiveWarehouse == null || payload == null || payload.length === 0) {
      toast({ title: "Elige proveedor, almacén y al menos un producto con cantidad", variant: "destructive" });
      return;
    }
    const data = {
      supplierId,
      warehouseId: effectiveWarehouse,
      currency,
      rateToBase: currency === locale.currency ? 1 : rate,
      expectedDate: expectedDate || null,
      supplierReference: reference.trim() || null,
      notes: notes.trim() || null,
      items: payload,
    };
    if (po) {
      update.mutate({ id: po.id, data: { ...data, rateToBase: data.rateToBase ?? undefined } }, { onSuccess: () => { void refresh(); toast({ title: "Orden guardada" }); }, onError: (e) => fail(e, "No se pudo guardar") });
    } else {
      create.mutate({ data }, { onSuccess: (o) => { void refresh(); toast({ title: `Orden ${o.code} creada` }); onOpenChange(false); }, onError: (e) => fail(e, "No se pudo crear") });
    }
  };

  const supplier = (suppliers ?? []).find((s) => s.id === supplierId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {po ? `Orden de compra ${po.code}` : "Nueva orden de compra"}
            {po && <StatusPill className={PO_STATUS_STYLES[po.status]}>{PO_STATUS_LABELS[po.status]}</StatusPill>}
          </DialogTitle>
          <DialogDescription>El compromiso con el proveedor. Lo que llegue se recibe contra ella, por lote.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className={cn("grid gap-2 sm:grid-cols-3", !editable && "pointer-events-none opacity-70")}>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Proveedor</label>
              <SupplierSelect
                value={supplierId}
                onChange={(id) => {
                  setSupplierId(id);
                  const s = (suppliers ?? []).find((x) => x.id === id);
                  if (s?.currency && !po) setCurrency(s.currency);
                  if (s?.email) setEmailTo(s.email);
                }}
                testId="select-po-supplier"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Llega a</label>
              <WarehouseSelect value={effectiveWarehouse} onChange={setWarehouseId} />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Moneda</label>
              <Select value={currency} onValueChange={(v) => { setCurrency(v); setRate(null); }} disabled={!editable}>
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
            </div>
          </div>
          <div className={cn("grid gap-2 sm:grid-cols-3", !editable && "pointer-events-none opacity-70")}>
            <RateInput currency={currency} base={locale.currency} value={rate} onChange={setRate} />
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Fecha esperada</label>
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Referencia del proveedor</label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Su cotización o pedido" className="h-9 text-sm" />
            </div>
          </div>

          <div className="space-y-2">
            {lines.map((l, index) => {
              const item = po?.items.find((i) => String(i.id) === l.key);
              return (
                <div key={l.key} className="flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-[200px]">
                    {editable ? (
                      <ProductPicker value={l.productId} onChange={(p) => patchLine(l.key, { productId: p.id })} filter={(p) => !isKit(p)} testId={`picker-po-product-${index}`} />
                    ) : (
                      <span className="text-sm">{item?.productName}</span>
                    )}
                  </div>
                  <Input type="number" min={1} value={l.quantity} onChange={(e) => patchLine(l.key, { quantity: e.target.value })} disabled={!editable} placeholder="Cant." className="h-9 w-24" data-testid={`input-po-qty-${index}`} />
                  <Input value={l.unitCost} onChange={(e) => patchLine(l.key, { unitCost: e.target.value })} disabled={!editable} placeholder={`Costo (${currency})`} className="h-9 w-32" data-testid={`input-po-cost-${index}`} />
                  <span className="text-xs tabular-nums w-28 text-right">{formatCents((Number(l.quantity) || 0) * (parseCents(l.unitCost) ?? 0), currency)}</span>
                  {item && <span className="text-[11px] text-muted-foreground w-28">recibido {item.receivedQuantity}</span>}
                  {editable && (
                    <button type="button" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} className="text-muted-foreground hover:text-destructive" aria-label="Quitar">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
            {editable && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setLines((prev) => [...prev, { key: String(Math.random()), productId: null, quantity: "", unitCost: "" }])}>
                <Plus className="w-3.5 h-3.5" /> Producto
              </Button>
            )}
            <div className="text-right text-sm font-semibold tabular-nums">Total {formatCents(total, currency)}</div>
          </div>

          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notas para el proveedor" className="text-sm resize-none" disabled={!editable} />

          {po && po.receipts.length > 0 && (
            <div className="text-xs text-muted-foreground">Recepciones: {po.receipts.map((r) => r.code).join(", ")}</div>
          )}

          {po && editable && (
            <div className="flex flex-wrap items-end gap-2 border-t border-card-border pt-3">
              <div className="flex-1 min-w-[220px] space-y-1">
                <label className="text-[11px] text-muted-foreground">Enviar por correo a</label>
                <Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder={supplier?.email ?? "correo del proveedor"} className="h-9 text-sm" />
              </div>
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => send.mutate({ id: po.id, data: { byEmail: true, to: emailTo.trim() || null } }, { onSuccess: () => { void refresh(); toast({ title: "Orden enviada por correo" }); }, onError: (e) => fail(e, "No se pudo enviar") })}
                disabled={send.isPending}
                data-testid="button-send-po-email"
              >
                <Mail className="w-4 h-4" /> Enviar
              </Button>
              {po.status === "draft" && (
                <Button variant="ghost" onClick={() => send.mutate({ id: po.id, data: { byEmail: false } }, { onSuccess: () => void refresh(), onError: (e) => fail(e, "No se pudo marcar") })}>
                  Marcar enviada
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 justify-end">
            {po && (
              <Button variant="outline" className="gap-1.5" onClick={() => printPurchaseOrder(po, business.displayName)}>
                <Printer className="w-4 h-4" /> Imprimir
              </Button>
            )}
            {po && (po.status === "draft" || po.status === "sent") && (
              <Button variant="ghost" onClick={() => cancel.mutate({ id: po.id }, { onSuccess: () => { void refresh(); onOpenChange(false); }, onError: (e) => fail(e, "No se pudo cancelar") })}>
                Cancelar orden
              </Button>
            )}
            {po && (po.status === "partial" || po.status === "sent") && po.items.some((i) => i.receivedQuantity > 0) && (
              <Button variant="ghost" onClick={() => close.mutate({ id: po.id }, { onSuccess: () => { void refresh(); onOpenChange(false); }, onError: (e) => fail(e, "No se pudo cerrar") })}>
                Cerrar con faltante
              </Button>
            )}
            {editable && (
              <Button variant="outline" onClick={save} disabled={create.isPending || update.isPending} data-testid="button-save-po">
                {po ? "Guardar" : "Crear orden"}
              </Button>
            )}
            {po && (po.status === "sent" || po.status === "partial" || po.status === "draft") && (
              <Button className="gap-1.5" onClick={() => onReceive(po)} data-testid="button-open-receive">
                <PackagePlus className="w-4 h-4" /> Recibir mercancía
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PurchaseOrdersTab() {
  const [status, setStatus] = useState<PurchaseOrderStatus | "open" | "all">("open");
  const params = { status: status === "all" || status === "open" ? undefined : status };
  const { data: orders, isLoading } = useListPurchaseOrders(params, { query: { queryKey: getListPurchaseOrdersQueryKey(params) } });
  const rows = (orders ?? []).filter((o) => status !== "open" || o.status === "draft" || o.status === "sent" || o.status === "partial");
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [open, setOpen] = useState(false);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-card border border-card-border rounded-lg p-1 flex-wrap">
          {(["open", "received", "closed", "cancelled", "all"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} className={cn("text-xs font-medium px-3 py-1.5 rounded-md transition-colors", status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted")}>
              {s === "open" ? "Por recibir" : s === "all" ? "Todas" : PO_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <Button size="sm" className="gap-1.5 ml-auto" onClick={() => { setEditing(null); setOpen(true); }} data-testid="button-new-po">
          <Plus className="w-4 h-4" /> Orden de compra
        </Button>
      </div>
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/40 animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Sin órdenes de compra en este estado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-3">Orden</th>
                  <th className="text-left font-medium px-3 py-3">Proveedor</th>
                  <th className="text-left font-medium px-3 py-3">Productos</th>
                  <th className="text-left font-medium px-3 py-3">Esperada</th>
                  <th className="text-right font-medium px-3 py-3">Total</th>
                  <th className="text-left font-medium px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-b border-card-border/60 hover:bg-muted/40 cursor-pointer" onClick={() => { setEditing(o); setOpen(true); }} data-testid={`po-row-${o.id}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-primary">{o.code}</div>
                      <div className="text-[11px] text-muted-foreground">{o.warehouseName}</div>
                    </td>
                    <td className="px-3 py-2.5">{o.supplierName}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {o.items.map((i) => (
                        <div key={i.id}>
                          {i.productName} {i.receivedQuantity}/{i.quantity}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{formatDay(o.expectedDate)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCents(o.totalCents, o.currency)}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill className={PO_STATUS_STYLES[o.status]}>{PO_STATUS_LABELS[o.status]}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <PurchaseOrderDialog
        po={editing}
        open={open}
        onOpenChange={setOpen}
        onReceive={(po) => {
          setOpen(false);
          setReceiving(po);
        }}
      />
      <ReceiveDialog po={receiving} onClose={() => setReceiving(null)} />
    </div>
  );
}
