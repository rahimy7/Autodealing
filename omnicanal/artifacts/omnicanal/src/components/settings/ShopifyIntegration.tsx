import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetShopifySettings,
  useUpdateShopifySettings,
  useTestShopifyConnection,
  useSyncShopifyNow,
  getGetShopifySettingsQueryKey,
} from "@workspace/api-client-react";
import { SiShopify } from "react-icons/si";
import { CheckCircle2, Loader2, RefreshCw, Save, XCircle, PlugZap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useModules } from "@/lib/platform";
import { apiErrorMessage, invalidateApi } from "@/lib/money";
import { WarehouseSelect } from "@/components/inventory/pickers";

function fmt(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

/**
 * Shopify (2026-10-04): se traen TODOS los pedidos de la tienda —web y
 * suscripciones— para que el inventario los comprometa. Llegan Pendientes y el
 * equipo confirma el pago; el estado de pago de Shopify queda a la vista.
 */
export default function ShopifyIntegration() {
  const { toast } = useToast();
  const modules = useModules();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetShopifySettings();
  const update = useUpdateShopifySettings();
  const test = useTestShopifyConnection();
  const sync = useSyncShopifyNow();
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [syncFrom, setSyncFrom] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!settings) return;
    setShopDomain(settings.shopDomain ?? "");
    setClientId(settings.clientId ?? "");
    setWarehouseId(settings.warehouseId ?? null);
    setSyncFrom(settings.syncFrom ? settings.syncFrom.slice(0, 10) : "");
  }, [settings]);

  const refresh = () => invalidateApi(queryClient, "/api/settings/shopify", "/api/orders");

  const save = (enabled?: boolean) =>
    update.mutate(
      {
        data: {
          shopDomain: shopDomain.trim() || null,
          ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
          clientId: clientId.trim() || null,
          ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
          warehouseId,
          ...(syncFrom ? { syncFrom: new Date(`${syncFrom}T00:00:00`).toISOString() } : {}),
          ...(enabled !== undefined ? { enabled } : {}),
        },
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetShopifySettingsQueryKey() });
          setAccessToken("");
          setClientSecret("");
          toast({ title: enabled === undefined ? "Shopify guardado" : enabled ? "Sincronización encendida" : "Sincronización apagada" });
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo guardar"), variant: "destructive" }),
      },
    );

  // El token guardado gana sobre el Client ID/Secret, y escribir vacío no lo
  // borra: sin esto, un token viejo deja la conexión en 401 para siempre.
  const clearToken = () =>
    update.mutate(
      { data: { accessToken: null } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetShopifySettingsQueryKey() });
          setAccessToken("");
          setTestResult(null);
          toast({ title: "Token quitado: se usarán el Client ID y el Client Secret" });
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo quitar el token"), variant: "destructive" }),
      },
    );

  const saveLabels = (enabled: boolean) => {
    if (enabled && !window.confirm("Con esto encendido, el botón «Etiqueta Shopify» del despacho COMPRA la etiqueta y Shopify la cobra a tu cuenta. ¿Encenderlo?")) return;
    update.mutate(
      { data: { labelsEnabled: enabled } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetShopifySettingsQueryKey() });
          toast({ title: enabled ? "Compra de etiquetas encendida" : "Compra de etiquetas apagada" });
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo guardar"), variant: "destructive" }),
      },
    );
  };

  const runTest = () =>
    test.mutate(undefined, {
      onSuccess: (r) => setTestResult(r.ok ? { ok: true, text: `Conectado con ${r.shopName} (${r.currency}).` } : { ok: false, text: r.error ?? "No se pudo conectar." }),
      onError: (err) => setTestResult({ ok: false, text: apiErrorMessage(err, "No se pudo conectar.") }),
    });

  const runSync = () =>
    sync.mutate(undefined, {
      onSuccess: (r) => {
        void refresh();
        if (r.error) toast({ title: "No se sincronizó", description: r.error, variant: "destructive" });
        else toast({ title: `Shopify: ${r.imported} nuevos, ${r.updated} actualizados, ${r.cancelled} cancelados` });
      },
      onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo sincronizar"), variant: "destructive" }),
    });

  if (isLoading || !settings) return <div className="h-48 rounded-xl bg-muted/40 animate-pulse" />;

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <SiShopify className="w-7 h-7 text-[#95BF47]" />
          <div>
            <h2 className="text-base font-semibold">Shopify</h2>
            <p className="text-xs text-muted-foreground">
              Trae todos los pedidos de la tienda —web y suscripciones— para que comprometan inventario. Llegan Pendientes: el pago lo confirma el equipo.
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          {settings.enabled ? "Encendido" : "Apagado"}
          <Switch checked={settings.enabled} onCheckedChange={(v) => save(v)} data-testid="switch-shopify-enabled" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Tienda</Label>
          <Input value={shopDomain} onChange={(e) => setShopDomain(e.target.value)} placeholder="mitienda.myshopify.com" data-testid="input-shopify-domain" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Token de la app (apps personalizadas creadas antes de 2026)</Label>
          <div className="flex gap-2">
            <Input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={settings.hasAccessToken ? `Guardado: ${settings.accessTokenPreview} — escribe uno nuevo para cambiarlo` : "shpat_…"}
            />
            {settings.hasAccessToken && (
              <Button variant="outline" onClick={clearToken} disabled={update.isPending} data-testid="button-shopify-clear-token">
                Quitar
              </Button>
            )}
          </div>
          {settings.hasAccessToken && (
            <p className="text-[11px] text-muted-foreground">
              Con un token guardado no se usan el Client ID ni el Client Secret. Si tu app es del Dev Dashboard, quítalo.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Client ID (app del Dev Dashboard)</Label>
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Client Secret</Label>
          <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={settings.hasClientSecret ? "Guardado — escribe uno nuevo para cambiarlo" : ""} />
        </div>
        {modules.inventory && (
          <div className="space-y-1.5">
            <Label className="text-xs">Almacén de los pedidos de Shopify</Label>
            <WarehouseSelect value={warehouseId} onChange={setWarehouseId} allowAll allLabel="El almacén por defecto" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">Traer pedidos creados desde</Label>
          <Input type="date" value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        La app necesita los permisos read_orders, read_customers y read_products, y acceso a los datos protegidos del cliente (nombre, correo, teléfono, dirección). Los pedidos de antes de la fecha de inicio no se traen. Con la tienda conectada, se sincroniza sola cada 15 minutos.
      </p>

      <section className="space-y-2 rounded-lg border border-card-border p-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Comprar etiquetas desde el despacho</h3>
            <p className="text-xs text-muted-foreground">
              Para los pedidos de Shopify, la etiqueta (la que ya usa Shopify Shipping) se compra desde la parada del despacho y su PDF y su guía quedan aquí. Las guías de lo que ya etiquetaste en Shopify se leen solas, sin esto.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm shrink-0">
            {settings.labelsEnabled ? "Encendido" : "Apagado"}
            <Switch checked={settings.labelsEnabled} onCheckedChange={(v) => saveLabels(v)} data-testid="switch-shopify-labels" />
          </label>
        </div>
        <ul className="list-disc pl-4 text-[11px] text-muted-foreground space-y-0.5">
          <li>La app necesita los permisos write_orders y write_merchant_managed_fulfillment_orders (agrégalos en el Dev Dashboard, publica la versión y vuelve a instalarla) y la tienda, haber aceptado los términos de Shopify Shipping.</li>
          <li>Shopify elige la tarifa y la cobra a tu cuenta de Shopify: no muestra el precio antes de comprar, no informa el costo (se anota a mano en los cargos del despacho) y no deja anular la etiqueta por API (se anula en el admin de Shopify).</li>
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => save()} disabled={update.isPending} className="gap-1.5" data-testid="button-save-shopify">
          {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
        </Button>
        <Button variant="outline" onClick={runTest} disabled={test.isPending} className="gap-1.5">
          {test.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />} Probar conexión
        </Button>
        <Button variant="outline" onClick={runSync} disabled={sync.isPending || !settings.enabled} className="gap-1.5" data-testid="button-shopify-sync">
          <RefreshCw className={sync.isPending ? "w-4 h-4 animate-spin" : "w-4 h-4"} /> Sincronizar ahora
        </Button>
      </div>
      {testResult && (
        <div className={testResult.ok ? "flex items-center gap-2 text-sm text-emerald-600" : "flex items-center gap-2 text-sm text-red-600"}>
          {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />} {testResult.text}
        </div>
      )}
      <div className="text-xs text-muted-foreground space-y-0.5 border-t border-card-border pt-3">
        <div>Última sincronización: {fmt(settings.lastSyncAt)}</div>
        {settings.lastError && <div className="text-red-600">Último error: {settings.lastError}</div>}
        <div>API de Shopify {settings.apiVersion}</div>
      </div>
    </div>
  );
}
