import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPendingDispatchOrders,
  getListPendingDispatchOrdersQueryKey,
  useListShipments,
  getListShipmentsQueryKey,
  useCreateShipment,
  useListCarriers,
  useCreateCarrier,
  useUpdateCarrier,
  useListWarehouses,
  type Carrier,
  type ShipmentKind,
  type ShipmentStatus,
} from "@workspace/api-client-react";
import { Package, Plus, Truck, Send } from "lucide-react";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiErrorMessage, formatCents, formatDateTime, formatDay, invalidateApi } from "@/lib/money";
import { WarehouseSelect } from "@/components/inventory/pickers";
import ShipmentDetailDialog, { SHIPMENT_STATUS_LABELS, SHIPMENT_STATUS_STYLES } from "@/components/shipments/ShipmentDetailDialog";

function CreateShipmentDialog({
  kind,
  warehouseId,
  orderIds,
  onClose,
  onCreated,
}: {
  kind: ShipmentKind | null;
  warehouseId: number | null;
  orderIds: number[];
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateShipment();
  const { data: carriers } = useListCarriers();
  const [carrierId, setCarrierId] = useState("none");
  const [driver, setDriver] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const submit = () => {
    if (kind == null || warehouseId == null) return;
    create.mutate(
      {
        data: {
          kind,
          warehouseId,
          carrierId: carrierId === "none" ? null : Number(carrierId),
          driverName: driver.trim() || null,
          vehicle: vehicle.trim() || null,
          plannedDate: date || null,
          orderIds,
        },
      },
      {
        onSuccess: (s) => {
          void invalidateApi(queryClient, "/api/shipments", "/api/orders");
          toast({ title: `Despacho ${s.code} armado`, description: `${s.stops.length} pedidos. Revisa guías y cargos y registra la salida.` });
          onCreated(s.id);
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo armar el despacho"), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={kind != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{kind === "trip" ? "Nuevo viaje" : "Envío por courier"}</DialogTitle>
          <DialogDescription>
            {orderIds.length} {orderIds.length === 1 ? "pedido" : "pedidos"}. Hasta registrar la salida no se descuenta nada del inventario.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{kind === "trip" ? "Reparto" : "Courier"}</label>
            <Select value={carrierId} onValueChange={setCarrierId}>
              <SelectTrigger className="h-9 text-sm" data-testid="select-new-shipment-carrier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{kind === "trip" ? "Reparto propio" : "Elegir después"}</SelectItem>
                {(carriers ?? [])
                  .filter((c) => c.active && (kind === "trip" ? c.kind === "own" : true))
                  .map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {kind === "trip" && (
            <div className="grid grid-cols-2 gap-2">
              <Input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="Chofer" />
              <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Vehículo" />
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Fecha de salida</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={submit} disabled={create.isPending} data-testid="button-create-shipment">
              Armar despacho
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PendingTab({ onOpen }: { onOpen: (id: number) => void }) {
  const { data: warehouses } = useListWarehouses();
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [includePending, setIncludePending] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [creating, setCreating] = useState<ShipmentKind | null>(null);
  const effectiveWarehouse = warehouseId ?? warehouses?.find((w) => w.isDefault)?.id ?? warehouses?.[0]?.id ?? null;
  const params = { warehouseId: effectiveWarehouse ?? undefined, includePending };
  const { data: orders, isLoading } = useListPendingDispatchOrders(params, {
    query: { enabled: effectiveWarehouse != null, queryKey: getListPendingDispatchOrdersQueryKey(params) },
  });
  const rows = orders ?? [];
  const allSelected = rows.length > 0 && rows.every((o) => selected.includes(o.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <WarehouseSelect value={effectiveWarehouse} onChange={(id) => { setWarehouseId(id); setSelected([]); }} className="w-56" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={includePending} onCheckedChange={setIncludePending} />
          Incluir pago sin confirmar
        </label>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={selected.length === 0} onClick={() => setCreating("trip")} data-testid="button-new-trip">
            <Truck className="w-4 h-4" /> Viaje ({selected.length})
          </Button>
          <Button size="sm" className="gap-1.5" disabled={selected.length === 0} onClick={() => setCreating("courier")} data-testid="button-new-courier">
            <Send className="w-4 h-4" /> Courier ({selected.length})
          </Button>
        </div>
      </div>
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {effectiveWarehouse == null ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Crea primero un almacén en Inventario → Almacenes.</p>
        ) : isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/40 animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <Package className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nada listo para salir. Un pedido aparece aquí cuando se confirma su pago (En proceso).</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="px-4 py-3 w-8">
                    <Checkbox checked={allSelected} onCheckedChange={(v) => setSelected(v === true ? rows.map((o) => o.id) : [])} aria-label="Elegir todos" />
                  </th>
                  <th className="text-left font-medium px-3 py-3">Pedido</th>
                  <th className="text-left font-medium px-3 py-3">Cliente</th>
                  <th className="text-left font-medium px-3 py-3">Producto</th>
                  <th className="text-left font-medium px-3 py-3">Dirección</th>
                  <th className="text-left font-medium px-4 py-3">Desde</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-b border-card-border/60 hover:bg-muted/40" data-testid={`pending-order-${o.id}`}>
                    <td className="px-4 py-2.5">
                      <Checkbox checked={selected.includes(o.id)} onCheckedChange={(v) => setSelected((prev) => (v === true ? [...prev, o.id] : prev.filter((id) => id !== o.id)))} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{o.code}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {[o.externalName, o.isSubscription ? "suscripción" : null, o.status === "pending" ? "pago sin confirmar" : null].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div>{o.contactName ?? "Sin nombre"}</div>
                      <div className="text-xs text-muted-foreground">{o.contactPhone ?? ""}</div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{o.product ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[240px]">{o.address ?? "Sin dirección"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <CreateShipmentDialog
        kind={creating}
        warehouseId={effectiveWarehouse}
        orderIds={selected}
        onClose={() => setCreating(null)}
        onCreated={(id) => {
          setCreating(null);
          setSelected([]);
          onOpen(id);
        }}
      />
    </div>
  );
}

const STATUS_FILTERS: Array<ShipmentStatus | "all"> = ["planning", "dispatched", "completed", "cancelled", "all"];

function ShipmentsListTab({ onOpen }: { onOpen: (id: number) => void }) {
  const [status, setStatus] = useState<ShipmentStatus | "all">("planning");
  const params = { status: status === "all" ? undefined : status };
  const { data: shipments, isLoading } = useListShipments(params, { query: { queryKey: getListShipmentsQueryKey(params) } });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 bg-card border border-card-border rounded-lg p-1 flex-wrap w-fit">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={cn("text-xs font-medium px-3 py-1.5 rounded-md transition-colors", status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted")}
            data-testid={`tab-shipments-${s}`}
          >
            {s === "all" ? "Todos" : SHIPMENT_STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/40 animate-pulse" />)}</div>
        ) : (shipments ?? []).length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No hay despachos en este estado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-3">Despacho</th>
                  <th className="text-left font-medium px-3 py-3">Courier / chofer</th>
                  <th className="text-left font-medium px-3 py-3">Fecha</th>
                  <th className="text-right font-medium px-3 py-3">Entregados</th>
                  <th className="text-right font-medium px-3 py-3">Costo</th>
                  <th className="text-left font-medium px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {(shipments ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-card-border/60 hover:bg-muted/40 cursor-pointer" onClick={() => onOpen(s.id)} data-testid={`shipment-row-${s.id}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-primary">{s.code}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.kind === "trip" ? "Viaje" : "Courier"} · {s.warehouseName}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{[s.carrierName, s.driverName, s.vehicle].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{s.dispatchedAt ? formatDateTime(s.dispatchedAt) : formatDay(s.plannedDate)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {s.stops.filter((x) => x.deliveryStatus === "delivered").length}/{s.stops.length}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatCents(s.totalCostCents, s.costCurrency)}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", SHIPMENT_STATUS_STYLES[s.status])}>{SHIPMENT_STATUS_LABELS[s.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CarrierDialog({ carrier, open, onOpenChange }: { carrier: Carrier | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateCarrier();
  const update = useUpdateCarrier();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"courier" | "own">("courier");
  const [template, setTemplate] = useState("");
  const [active, setActive] = useState(true);
  const [loaded, setLoaded] = useState<number | "new" | null>(null);
  const id = carrier?.id ?? "new";
  if (open && loaded !== id) {
    setLoaded(id);
    setName(carrier?.name ?? "");
    setKind((carrier?.kind as "courier" | "own") ?? "courier");
    setTemplate(carrier?.trackingUrlTemplate ?? "");
    setActive(carrier?.active ?? true);
  }
  if (!open && loaded !== null) setLoaded(null);

  const submit = () => {
    const data = { name: name.trim(), kind, trackingUrlTemplate: template.trim() || null, active };
    if (!data.name) {
      toast({ title: "Pon el nombre", variant: "destructive" });
      return;
    }
    const opts = {
      onSuccess: () => {
        void invalidateApi(queryClient, "/api/carriers");
        onOpenChange(false);
      },
      onError: (err: unknown) => toast({ title: apiErrorMessage(err, "No se pudo guardar"), variant: "destructive" }),
    };
    if (carrier) update.mutate({ id: carrier.id, data }, opts);
    else create.mutate({ data }, opts);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{carrier ? carrier.name : "Nuevo courier"}</DialogTitle>
          <DialogDescription>El enlace de rastreo sale en el correo de "tu pedido va en camino", con la guía donde dice {"{tracking}"}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vimenpaq, Domex, UPS…" data-testid="input-carrier-name" />
          <Select value={kind} onValueChange={(v) => setKind(v as "courier" | "own")}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="courier">Courier (un tercero, con guía)</SelectItem>
              <SelectItem value="own">Reparto propio</SelectItem>
            </SelectContent>
          </Select>
          <Input value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="https://www.ups.com/track?tracknum={tracking}" />
          <label className="flex items-center justify-between text-sm">
            Activo
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={submit} disabled={create.isPending || update.isPending} data-testid="button-save-carrier">
              Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CarriersTab() {
  const { data: carriers } = useListCarriers();
  const [editing, setEditing] = useState<Carrier | null>(null);
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
        data-testid="button-new-carrier"
      >
        <Plus className="w-4 h-4" /> Nuevo courier
      </Button>
      <div className="bg-card border border-card-border rounded-xl divide-y divide-card-border">
        {(carriers ?? []).length === 0 && <p className="p-6 text-sm text-muted-foreground text-center">Sin couriers. Agrega los que usas (Vimenpaq, Domex, UPS) y tu reparto propio.</p>}
        {(carriers ?? []).map((c) => (
          <button
            key={c.id}
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40"
            onClick={() => {
              setEditing(c);
              setOpen(true);
            }}
          >
            <span>
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground"> · {c.kind === "own" ? "reparto propio" : "courier"}</span>
              {!c.active && <span className="text-xs text-muted-foreground"> · inactivo</span>}
            </span>
            <span className="text-xs text-muted-foreground truncate max-w-[50%]">{c.trackingUrlTemplate ?? "Sin rastreo en línea"}</span>
          </button>
        ))}
      </div>
      <CarrierDialog carrier={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}

const TABS = [
  { key: "pending", label: "Por despachar" },
  { key: "shipments", label: "Despachos" },
  { key: "carriers", label: "Couriers" },
] as const;

export default function ShipmentsPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tabFromUrl = params.get("tab");
  const tab = TABS.some((t) => t.key === tabFromUrl) ? (tabFromUrl as (typeof TABS)[number]["key"]) : "pending";
  const [openId, setOpenId] = useState<number | null>(Number(params.get("shipment")) || null);

  return (
    <Layout>
      <div className="p-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-foreground">Despachos</h1>
          <p className="text-sm text-muted-foreground">Agrupa los pedidos en un viaje o con un courier. Registrar la salida descuenta el inventario; los cargos son el costo del envío.</p>
        </div>
        <Tabs value={tab} onValueChange={(v) => setLocation(`/shipments?tab=${v}`, { replace: true })}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} data-testid={`tab-shipments-page-${t.key}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="pending" className="pt-4">
            <PendingTab onOpen={setOpenId} />
          </TabsContent>
          <TabsContent value="shipments" className="pt-4">
            <ShipmentsListTab onOpen={setOpenId} />
          </TabsContent>
          <TabsContent value="carriers" className="pt-4">
            <CarriersTab />
          </TabsContent>
        </Tabs>
      </div>
      <ShipmentDetailDialog shipmentId={openId} onClose={() => setOpenId(null)} />
    </Layout>
  );
}
