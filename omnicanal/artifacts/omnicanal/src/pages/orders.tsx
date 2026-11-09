import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOrders,
  useCreateOrder,
  useUpdateOrder,
  useListContacts,
  getListContactsQueryKey,
  getListOrdersQueryKey,
  type Order,
  type OrderStatus,
} from "@workspace/api-client-react";
import { Plus, Search, Package, ExternalLink, Upload, FileText, Loader2, X, AlertTriangle, Repeat, MessageSquareText } from "lucide-react";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useClient, useModules } from "@/lib/platform";
import { ORDER_STATUS_LABELS, ORDER_STATUS_STYLES, ShopifyPaymentBadge } from "@/components/OrderBadge";
import { uploadPaymentProof, uploadShippingLabel, ORDER_ATTACHMENT_ACCEPT, MAX_ORDER_ATTACHMENT_BYTES } from "@/lib/orders-media";
import { apiErrorMessage, centsToInput, formatCents, invalidateApi, parseCents } from "@/lib/money";
import OrderItemsEditor, { draftFromItem, emptyItem, itemsPayload, lineTotal, type ItemDraft } from "@/components/orders/OrderItemsEditor";
import { OrderTimeline, OrderMarginCard } from "@/components/orders/OrderTimeline";
import { WarehouseSelect } from "@/components/inventory/pickers";
import { useInventoryReady } from "@/lib/inventory-ready";
import DispatchDialog, { type DispatchTarget } from "@/components/shipments/DispatchDialog";
import ReturnsView from "@/components/orders/ReturnsView";
import CreditNotesView from "@/components/orders/CreditNotesView";

const STATUS_TABS: Array<OrderStatus | "all"> = ["all", "pending", "processing", "shipped", "delivered", "cancelled"];
const STATUSES: OrderStatus[] = ["pending", "processing", "shipped", "delivered", "cancelled"];

const SOURCE_FILTERS = [
  { key: "all", label: "Todos los orígenes" },
  { key: "chat", label: "Chat" },
  { key: "manual", label: "A mano" },
  { key: "shopify", label: "Shopify" },
  { key: "subscription", label: "Suscripciones" },
  { key: "replacement", label: "Reposiciones" },
] as const;
type SourceFilter = (typeof SOURCE_FILTERS)[number]["key"];

const SOURCE_LABELS: Record<string, string> = { chat: "Chat", manual: "A mano", shopify: "Shopify", replacement: "Reposición" };

// Una imagen se enseña directo; cualquier otra cosa (un PDF, sobre todo) se deja
// como enlace — el navegador no puede pintar un PDF dentro de una miniatura.
function AttachmentPreview({ url, label }: { url: string | null | undefined; label: string }) {
  const [failed, setFailed] = useState(false);
  if (!url) return <span className="text-xs text-muted-foreground">Sin {label.toLowerCase()}</span>;
  if (failed) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
        <FileText className="w-3.5 h-3.5" /> Ver {label.toLowerCase()}
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" title={`Ver ${label.toLowerCase()}`}>
      <img src={url} onError={() => setFailed(true)} className="w-16 h-16 rounded-lg object-cover border border-card-border hover:opacity-80 transition-opacity" />
    </a>
  );
}

function AttachmentUploadButton({ label, uploading, onSelect }: { label: string; uploading: boolean; onSelect: (file: File) => void }) {
  const inputId = `order-upload-${label.replace(/\s+/g, "-").toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-card-border cursor-pointer hover:bg-muted transition-colors w-fit",
        uploading && "opacity-50 pointer-events-none",
      )}
    >
      {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
      {label}
      <input
        id={inputId}
        type="file"
        accept={ORDER_ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onSelect(file);
        }}
      />
    </label>
  );
}

// Buscador simple de contacto para el pedido a mano: escribe, elige de la
// lista. No hace falta más que eso — el resto del formulario ya identifica el
// pedido por su contactId.
function ContactPicker({ onPick }: { onPick: (contact: { id: number; name: string; phone: string | null }) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const contactParams = { search: debounced || undefined };
  const { data: contacts } = useListContacts(contactParams, {
    query: { enabled: debounced.length > 1, queryKey: getListContactsQueryKey(contactParams) },
  });

  return (
    <div className="space-y-1.5">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cliente por nombre o teléfono…" data-testid="input-order-contact-search" />
      {debounced.length > 1 && (contacts ?? []).length > 0 && (
        <div className="border border-card-border rounded-lg divide-y divide-card-border max-h-40 overflow-y-auto">
          {(contacts ?? []).slice(0, 8).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick({ id: c.id, name: c.name, phone: c.phone ?? null })}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
              data-testid={`option-order-contact-${c.id}`}
            >
              <div className="font-medium text-foreground">{c.name}</div>
              {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderDialog({
  order,
  open,
  onOpenChange,
  onDispatch,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDispatch: (target: DispatchTarget) => void;
}) {
  const isNew = order == null;
  const { toast } = useToast();
  const { locale } = useClient();
  const modules = useModules();
  const inventoryReady = useInventoryReady();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const createOrder = useCreateOrder();
  const updateOrder = useUpdateOrder();
  const [uploading, setUploading] = useState<"proof" | "label" | null>(null);
  const [tab, setTab] = useState("order");

  const [contact, setContact] = useState<{ id: number; name: string; phone: string | null } | null>(null);
  const [status, setStatus] = useState<OrderStatus>("pending");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [legacyProduct, setLegacyProduct] = useState("");
  const [legacyQuantity, setLegacyQuantity] = useState("1");
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [shippingCharge, setShippingCharge] = useState("");
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "DOP">("USD");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [live, setLive] = useState<Order | null>(order);

  useEffect(() => {
    setLive(order);
    setTab("order");
    setContact(order ? { id: order.contactId, name: order.contactName ?? "Cliente", phone: order.contactPhone ?? null } : null);
    setStatus(order?.status ?? "pending");
    setItems(order ? order.items.map(draftFromItem) : [emptyItem()]);
    setLegacyProduct(order?.product ?? "");
    setLegacyQuantity(String(order?.quantity ?? 1));
    setDiscount(order?.discountCents ? centsToInput(order.discountCents) : "");
    setDiscountReason(order?.discountReason ?? "");
    setShippingCharge(order?.shippingChargeCents ? centsToInput(order.shippingChargeCents) : "");
    setWarehouseId(order?.warehouseId ?? null);
    setAmount(order?.amount != null ? String(order.amount) : "");
    setCurrency((order?.currency as "USD" | "DOP" | null) ?? "USD");
    setAddress(order?.address ?? "");
    setEmail(order?.email ?? "");
    setNotes(order?.notes ?? "");
  }, [order, open]);

  const priceCurrency = live?.priceCurrency ?? locale.currency;
  // Un pedido de antes del inventario no tiene líneas: se sigue editando como
  // texto hasta que alguien le ponga productos del catálogo.
  const legacy = !isNew && (live?.items.length ?? 0) === 0 && items.every((i) => i.productId == null && !i.description);
  const stockOut = live?.stockOut ?? false;
  const subtotal = items.reduce((sum, i) => sum + lineTotal(i), 0);
  const discountCents = Math.min(parseCents(discount) ?? 0, subtotal);
  const shippingCents = parseCents(shippingCharge) ?? 0;
  const total = subtotal - discountCents + shippingCents;

  const invalidate = () => invalidateApi(queryClient, "/api/orders", "/api/inventory", "/api/shipments");
  const numericAmount = amount.trim() ? Number(amount) : null;

  const submit = () => {
    const payloadItems = legacy ? [] : itemsPayload(items.filter((i) => i.productId != null || i.description.trim()));
    if (payloadItems == null) {
      toast({ title: "Revisa las líneas", description: "Cada una necesita producto (o descripción) y una cantidad entera.", variant: "destructive" });
      return;
    }
    if (isNew) {
      if (!contact) {
        toast({ title: "Elige el cliente primero", variant: "destructive" });
        return;
      }
      createOrder.mutate(
        {
          data: {
            contactId: contact.id,
            items: payloadItems,
            ...(payloadItems.length === 0 ? { product: legacyProduct.trim() || null, quantity: Math.max(1, Number(legacyQuantity) || 1) } : {}),
            discountCents,
            discountReason: discountReason.trim() || null,
            shippingChargeCents: shippingCents,
            ...(warehouseId != null ? { warehouseId } : {}),
            amount: numericAmount,
            currency: currency || null,
            address: address.trim() || null,
            email: email.trim() || null,
            notes: notes.trim() || null,
          },
        },
        {
          onSuccess: (created) => {
            void invalidate();
            setLive(created);
            toast({ title: "Pedido creado", description: created.code });
          },
          onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo crear el pedido"), variant: "destructive" }),
        },
      );
      return;
    }

    // Enviado/Entregado sin haber salido del almacén se registra como despacho.
    const wantsDispatch = inventoryReady && !stockOut && (status === "shipped" || status === "delivered") && status !== order.status;
    updateOrder.mutate(
      {
        id: order.id,
        data: {
          ...(wantsDispatch ? {} : { status }),
          ...(legacy ? { product: legacyProduct.trim() || null, quantity: Math.max(1, Number(legacyQuantity) || 1) } : stockOut ? {} : { items: payloadItems }),
          discountCents,
          discountReason: discountReason.trim() || null,
          shippingChargeCents: shippingCents,
          ...(warehouseId !== (order.warehouseId ?? null) && !stockOut ? { warehouseId } : {}),
          amount: numericAmount,
          currency: currency || null,
          address: address.trim() || null,
          email: email.trim() || null,
          notes: notes.trim() || null,
        },
      },
      {
        onSuccess: (updated) => {
          void invalidate();
          setLive(updated);
          if (wantsDispatch) {
            onDispatch({ kind: "order", orderId: updated.id, code: updated.code, thenDeliver: status === "delivered" });
          } else {
            toast({ title: "Pedido actualizado" });
          }
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo actualizar el pedido"), variant: "destructive" }),
      },
    );
  };

  const upload = async (kind: "proof" | "label", file: File) => {
    if (!live) return;
    if (file.size > MAX_ORDER_ATTACHMENT_BYTES) {
      toast({ title: "El archivo es muy grande", description: "Máximo 15 MB.", variant: "destructive" });
      return;
    }
    setUploading(kind);
    try {
      const updated = kind === "proof" ? await uploadPaymentProof(live.id, file) : await uploadShippingLabel(live.id, file);
      setLive(updated);
      void invalidate();
      toast({ title: kind === "proof" ? "Comprobante subido" : "Guía de envío subida" });
    } catch {
      toast({ title: "No se pudo subir el archivo", variant: "destructive" });
    } finally {
      setUploading(null);
    }
  };

  const orderForm = (
    <div className="space-y-4">
      {isNew ? (
        contact ? (
          <div className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
            <div>
              <div className="text-sm font-medium text-foreground">{contact.name}</div>
              {contact.phone && <div className="text-xs text-muted-foreground">{contact.phone}</div>}
            </div>
            <button type="button" onClick={() => setContact(null)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <ContactPicker onPick={setContact} />
        )
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">{live?.contactName ?? "Cliente"}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {[live?.contactPhone ?? "Sin teléfono", live?.externalName ? `Shopify ${live.externalName}` : null, live?.isSubscription ? "suscripción" : null].filter(Boolean).join(" · ")}
              <ShopifyPaymentBadge status={live?.externalFinancialStatus} />
            </div>
          </div>
          {live?.conversationId != null && (
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setLocation(`/inbox?conv=${live.conversationId}`)} data-testid="button-order-view-conversation">
              <ExternalLink className="w-3.5 h-3.5" /> Ver conversación
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {!isNew && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Estado</label>
            <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus)}>
              <SelectTrigger data-testid="select-order-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {ORDER_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {modules.inventory && (
          <div className={cn("space-y-1.5", isNew && "col-span-2")}>
            <label className="text-xs font-medium text-muted-foreground">Almacén</label>
            <WarehouseSelect value={warehouseId} onChange={setWarehouseId} className={cn(stockOut && "pointer-events-none opacity-60")} />
          </div>
        )}
      </div>

      {legacy ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Producto</label>
            <Input value={legacyProduct} onChange={(e) => setLegacyProduct(e.target.value)} data-testid="input-order-product" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Cantidad</label>
            <Input type="number" min={1} value={legacyQuantity} onChange={(e) => setLegacyQuantity(e.target.value)} data-testid="input-order-quantity" />
          </div>
          <button type="button" className="col-span-3 text-left text-xs text-primary hover:underline" onClick={() => setItems([{ ...emptyItem(), description: legacyProduct, quantity: legacyQuantity }])}>
            Pasar a productos del catálogo (para comprometer inventario)
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Productos</label>
          <OrderItemsEditor items={items} onChange={setItems} currency={priceCurrency} warehouseId={warehouseId} readOnly={stockOut} committedAlready={!isNew && ["pending", "processing"].includes(live?.status ?? "")} />
          {stockOut && <p className="text-[11px] text-muted-foreground">Ya salió del almacén: las líneas no se cambian. Lo que el cliente devuelva va por una devolución.</p>}
        </div>
      )}

      {!legacy && (
        <div className="border border-card-border rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Descuento del pedido</label>
              <Input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" className="h-8 text-sm" data-testid="input-order-discount" />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[11px] text-muted-foreground">Motivo del descuento</label>
              <Input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="Cliente frecuente, volumen…" className="h-8 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 items-end">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Envío que paga el cliente</label>
              <Input value={shippingCharge} onChange={(e) => setShippingCharge(e.target.value)} placeholder="0.00" className="h-8 text-sm" />
            </div>
            <div className="col-span-2 text-right text-sm space-y-0.5">
              <div className="text-xs text-muted-foreground">
                Subtotal {formatCents(subtotal, priceCurrency)}
                {discountCents ? ` − descuento ${formatCents(discountCents, priceCurrency)}` : ""}
                {shippingCents ? ` + envío ${formatCents(shippingCents, priceCurrency)}` : ""}
              </div>
              <div className="font-semibold tabular-nums" data-testid="text-order-total">
                Total {formatCents(total, priceCurrency)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Monto transferido</label>
          <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Contra la transferencia real" data-testid="input-order-amount" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Moneda</label>
          <Select value={currency} onValueChange={(v) => setCurrency(v as "USD" | "DOP")}>
            <SelectTrigger data-testid="select-order-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="DOP">DOP</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Dirección de envío</label>
        <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className="text-sm resize-none" data-testid="input-order-address" />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Correo (para los avisos del pedido)</label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={live?.contactEmail ?? "cliente@correo.com"} data-testid="input-order-email" />
        {!email && live?.contactEmail && <p className="text-[11px] text-muted-foreground">Sin correo en el pedido se usa el del contacto: {live.contactEmail}.</p>}
      </div>

      {live?.externalNote && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Comentario (Shopify)</label>
          <div className="text-sm whitespace-pre-wrap rounded-md border border-card-border bg-muted/40 px-3 py-2" data-testid="text-order-external-note">
            {live.externalNote}
          </div>
          <p className="text-[11px] text-muted-foreground">Lo que dejó el cliente al comprar (o el equipo en Shopify). Se actualiza solo; lo del equipo va en Notas.</p>
        </div>
      )}

      {live && (live.externalTracking ?? []).length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Guía (Shopify)</label>
          <div className="rounded-md border border-card-border bg-muted/40 px-3 py-2 text-sm space-y-0.5" data-testid="text-order-external-tracking">
            {(live.externalTracking ?? []).map((t) => (
              <div key={t.number} className="flex flex-wrap items-center gap-x-2">
                <span className="font-mono text-xs">{t.number}</span>
                {t.company && <span className="text-xs text-muted-foreground">{t.company}</span>}
                {t.url && (
                  <a href={t.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                    Rastrear
                  </a>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">La etiqueta ya está comprada en Shopify. Al registrar el despacho esta guía pasa al paquete y sale en el correo «va en camino».</p>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Notas</label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm resize-none" data-testid="input-order-notes" />
      </div>

      {!isNew && live && (
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-card-border">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Comprobante de pago</label>
            <AttachmentPreview url={live.paymentProofUrl} label="Comprobante" />
            <AttachmentUploadButton label="Subir" uploading={uploading === "proof"} onSelect={(f) => upload("proof", f)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Guía de envío</label>
            <AttachmentPreview url={live.shippingLabelUrl} label="Etiqueta" />
            <AttachmentUploadButton label="Subir" uploading={uploading === "label"} onSelect={(f) => upload("label", f)} />
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-1">
        <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
          Cerrar
        </Button>
        <Button className="flex-1" onClick={submit} disabled={createOrder.isPending || updateOrder.isPending} data-testid="button-submit-order">
          {isNew ? "Crear pedido" : "Guardar"}
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isNew ? "Nuevo pedido" : `Pedido ${live?.code}`}
            {live && <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", ORDER_STATUS_STYLES[live.status])}>{ORDER_STATUS_LABELS[live.status]}</span>}
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto pr-1 -mr-1">
          {isNew || !live ? (
            orderForm
          ) : (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="order">Pedido</TabsTrigger>
                <TabsTrigger value="timeline" data-testid="tab-order-timeline">
                  Expediente
                </TabsTrigger>
                {modules.inventory && <TabsTrigger value="costs">Costos</TabsTrigger>}
              </TabsList>
              <TabsContent value="order" className="pt-3">
                {orderForm}
              </TabsContent>
              <TabsContent value="timeline" className="pt-3">
                <OrderTimeline orderId={live.id} />
              </TabsContent>
              {modules.inventory && (
                <TabsContent value="costs" className="pt-3">
                  <OrderMarginCard orderId={live.id} />
                </TabsContent>
              )}
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OrdersList({ onDispatch }: { onDispatch: (target: DispatchTarget) => void }) {
  const searchString = useSearch();
  const orderFromUrl = Number(new URLSearchParams(searchString).get("order"));
  const [, setLocation] = useLocation();

  const [tab, setTab] = useState<OrderStatus | "all">("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const listParams = {
    status: tab === "all" ? undefined : tab,
    search: debouncedSearch || undefined,
    source: source === "all" ? undefined : source,
  };
  const { data: orders, isLoading } = useListOrders(listParams, { query: { queryKey: getListOrdersQueryKey(listParams) } });
  const updateOrder = useUpdateOrder();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);

  // `?order=<id>` deep link — desde el badge de la conversación, un lote o un despacho.
  useEffect(() => {
    if (!Number.isInteger(orderFromUrl) || orderFromUrl <= 0 || !orders) return;
    const found = orders.find((o) => o.id === orderFromUrl);
    if (found) {
      setEditing(found);
      setDialogOpen(true);
      setLocation("/orders", { replace: true });
    } else if (debouncedSearch !== String(orderFromUrl) && tab === "all") {
      // No está entre los 300 más recientes: se busca por su id.
      setSearch(String(orderFromUrl));
    }
  }, [orderFromUrl, orders, setLocation, debouncedSearch, tab]);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (o: Order) => {
    setEditing(o);
    setDialogOpen(true);
  };

  const inventoryReady = useInventoryReady();
  const quickStatusChange = (o: Order, status: OrderStatus) => {
    // Pasar a Enviado o Entregado algo que no ha salido es despacharlo: se abre
    // el diálogo con los lotes, el courier y la guía. Sin inventario, el estado
    // es solo una etiqueta y cambia directo.
    if (inventoryReady && !o.stockOut && (status === "shipped" || status === "delivered")) {
      onDispatch({ kind: "order", orderId: o.id, code: o.code, thenDeliver: status === "delivered" });
      return;
    }
    updateOrder.mutate(
      { id: o.id, data: { status } },
      {
        onSuccess: () => {
          void invalidateApi(queryClient, "/api/orders", "/api/inventory", "/api/shipments");
          toast({ title: `Pedido ${o.code} → ${ORDER_STATUS_LABELS[status]}` });
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo cambiar el estado"), variant: "destructive" }),
      },
    );
  };

  const rows = useMemo(() => orders ?? [], [orders]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-card border border-card-border rounded-lg p-1 flex-wrap">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setTab(s)}
              data-testid={`tab-order-status-${s}`}
              className={cn("text-xs font-medium px-3 py-1.5 rounded-md transition-colors", tab === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted")}
            >
              {s === "all" ? "Todos" : ORDER_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <Select value={source} onValueChange={(v) => setSource(v as SourceFilter)}>
          <SelectTrigger className="h-9 w-44 text-sm" data-testid="select-order-source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_FILTERS.map((f) => (
              <SelectItem key={f.key} value={f.key}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por código, #Shopify, cliente o teléfono…" className="pl-8 h-9 text-sm" data-testid="input-order-search" />
        </div>
        <Button size="sm" onClick={openNew} className="gap-2" data-testid="button-new-order">
          <Plus className="w-4 h-4" /> Nuevo pedido
        </Button>
      </div>

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-lg bg-muted/40 animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <Package className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No hay pedidos{tab !== "all" ? ` en "${ORDER_STATUS_LABELS[tab]}"` : ""}.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-3">Código</th>
                  <th className="text-left font-medium px-3 py-3">Cliente</th>
                  <th className="text-left font-medium px-3 py-3">Producto</th>
                  <th className="text-left font-medium px-3 py-3">Dirección</th>
                  <th className="text-left font-medium px-3 py-3">Comprobante</th>
                  <th className="text-right font-medium px-3 py-3">Total</th>
                  <th className="text-left font-medium px-4 py-3 w-40">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-b border-card-border/60 hover:bg-muted/40 transition-colors" data-testid={`order-row-${o.id}`}>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => openEdit(o)} className="font-medium text-primary hover:underline" data-testid={`button-order-open-${o.id}`}>
                        {o.code}
                      </button>
                      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        {o.source === "shopify" ? `Shopify ${o.externalName ?? ""}`.trim() : (SOURCE_LABELS[o.source] ?? o.source)}
                        <ShopifyPaymentBadge status={o.externalFinancialStatus} />
                        {o.externalNote && (
                          <span className="inline-flex text-sky-600 dark:text-sky-400" title={`Comentario: ${o.externalNote}`} data-testid={`order-note-${o.id}`}>
                            <MessageSquareText className="w-3 h-3" />
                          </span>
                        )}
                        {o.isSubscription && (
                          <span className="inline-flex items-center gap-0.5 text-purple-600" title="Pedido de suscripción">
                            <Repeat className="w-3 h-3" /> suscripción
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-foreground">{o.contactName ?? "Sin nombre"}</div>
                      <div className="text-xs text-muted-foreground">{o.contactPhone ?? "—"}</div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground max-w-[220px]">
                      <span className="line-clamp-2">
                        {o.product ?? "—"}
                        {o.items.length === 0 && o.quantity > 1 ? ` x${o.quantity}` : ""}
                      </span>
                      {o.hasUnlinkedItems && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400" title="Hay líneas sin vincular al catálogo: no comprometen inventario">
                          <AlertTriangle className="w-3 h-3" /> sin vincular
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground max-w-[200px] truncate" title={o.address ?? undefined}>
                      {o.address ?? "—"}
                    </td>
                    <td className="px-3 py-3">
                      {o.paymentProofUrl ? (
                        <a href={o.paymentProofUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs">
                          Ver
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">
                      {o.items.length ? formatCents(o.totalCents, o.priceCurrency) : o.amount != null ? `${o.currency === "DOP" ? "RD$" : "US$"}${o.amount.toLocaleString("es-DO")}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Select value={o.status} onValueChange={(v) => quickStatusChange(o, v as OrderStatus)}>
                        <SelectTrigger className={cn("h-7 text-xs border-none", ORDER_STATUS_STYLES[o.status])} data-testid={`select-order-row-status-${o.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {ORDER_STATUS_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <OrderDialog order={editing} open={dialogOpen} onOpenChange={setDialogOpen} onDispatch={onDispatch} />
    </div>
  );
}

const VIEWS = [
  { key: "orders", label: "Pedidos" },
  { key: "returns", label: "Devoluciones" },
  { key: "credit-notes", label: "Notas de crédito" },
] as const;

export default function OrdersPage() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const viewFromUrl = new URLSearchParams(searchString).get("view");
  const view = VIEWS.some((v) => v.key === viewFromUrl) ? (viewFromUrl as (typeof VIEWS)[number]["key"]) : "orders";
  const [dispatchTarget, setDispatchTarget] = useState<DispatchTarget | null>(null);
  const modules = useModules();

  return (
    <Layout>
      <div className="p-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-foreground">Pedidos</h1>
          <p className="text-sm text-muted-foreground">Desde que el cliente dice que pagó hasta que le llega — y lo que devuelve.</p>
        </div>
        <Tabs value={view} onValueChange={(v) => setLocation(v === "orders" ? "/orders" : `/orders?view=${v}`, { replace: true })}>
          <TabsList>
            {VIEWS.map((v) => (
              <TabsTrigger key={v.key} value={v.key} data-testid={`tab-orders-view-${v.key}`}>
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="orders" className="pt-4">
            <OrdersList onDispatch={setDispatchTarget} />
          </TabsContent>
          <TabsContent value="returns" className="pt-4">
            <ReturnsView />
          </TabsContent>
          <TabsContent value="credit-notes" className="pt-4">
            <CreditNotesView />
          </TabsContent>
        </Tabs>
      </div>
      {modules.inventory ? (
        <DispatchDialog target={dispatchTarget} onClose={() => setDispatchTarget(null)} />
      ) : null}
    </Layout>
  );
}
