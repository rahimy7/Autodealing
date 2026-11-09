import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUspsSettings,
  useUpdateUspsSettings,
  useTestUspsConnection,
  getGetUspsSettingsQueryKey,
  type UspsEnvironment,
  type UspsMailClass,
  type UspsSettingsInput,
} from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, Loader2, PlugZap, Save, Truck, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/money";

export const USPS_MAIL_CLASS_LABELS: Record<UspsMailClass, string> = {
  USPS_GROUND_ADVANTAGE: "Ground Advantage",
  PRIORITY_MAIL: "Priority Mail",
  PRIORITY_MAIL_EXPRESS: "Priority Mail Express",
};

const num = (text: string): number | null => {
  const n = Number(text.replace(",", "."));
  return text.trim() && Number.isFinite(n) ? n : null;
};

/**
 * USPS (2026-10-20): compra la etiqueta y el franqueo de los envíos a Estados
 * Unidos desde el despacho. Arranca en el ambiente de PRUEBAS, que no cobra: hay
 * que pasarlo a producción a propósito.
 */
export default function UspsIntegration() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetUspsSettings();
  const update = useUpdateUspsSettings();
  const test = useTestUspsConnection();
  const [environment, setEnvironment] = useState<UspsEnvironment>("test");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [crid, setCrid] = useState("");
  const [mid, setMid] = useState("");
  const [manifestMid, setManifestMid] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromStreet, setFromStreet] = useState("");
  const [fromStreet2, setFromStreet2] = useState("");
  const [fromCity, setFromCity] = useState("");
  const [fromState, setFromState] = useState("");
  const [fromZip, setFromZip] = useState("");
  const [mailClass, setMailClass] = useState<UspsMailClass>("USPS_GROUND_ADVANTAGE");
  const [weightOz, setWeightOz] = useState("");
  const [lengthIn, setLengthIn] = useState("");
  const [widthIn, setWidthIn] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!settings) return;
    setEnvironment(settings.environment);
    setClientId(settings.clientId ?? "");
    setCrid(settings.crid ?? "");
    setMid(settings.mid ?? "");
    setManifestMid(settings.manifestMid ?? "");
    setFromName(settings.fromName ?? "");
    setFromStreet(settings.fromStreet ?? "");
    setFromStreet2(settings.fromStreet2 ?? "");
    setFromCity(settings.fromCity ?? "");
    setFromState(settings.fromState ?? "");
    setFromZip(settings.fromZip ?? "");
    setMailClass(settings.defaultMailClass);
    setWeightOz(settings.defaultWeightOz != null ? String(settings.defaultWeightOz) : "");
    setLengthIn(settings.defaultLengthIn != null ? String(settings.defaultLengthIn) : "");
    setWidthIn(settings.defaultWidthIn != null ? String(settings.defaultWidthIn) : "");
    setHeightIn(settings.defaultHeightIn != null ? String(settings.defaultHeightIn) : "");
  }, [settings]);

  const save = (enabled?: boolean) => {
    if (environment === "production" && settings?.environment !== "production") {
      if (!window.confirm("Producción cobra de verdad: cada etiqueta que se compre descuenta el franqueo de tu cuenta de pago de USPS. ¿Pasar a producción?")) return;
    }
    const data: UspsSettingsInput = {
      environment,
      clientId: clientId.trim() || null,
      ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
      crid: crid.trim() || null,
      mid: mid.trim() || null,
      manifestMid: manifestMid.trim() || null,
      ...(accountNumber.trim() ? { accountNumber: accountNumber.trim() } : {}),
      fromName: fromName.trim() || null,
      fromStreet: fromStreet.trim() || null,
      fromStreet2: fromStreet2.trim() || null,
      fromCity: fromCity.trim() || null,
      fromState: fromState.trim() || null,
      fromZip: fromZip.trim() || null,
      defaultMailClass: mailClass,
      defaultWeightOz: num(weightOz),
      defaultLengthIn: num(lengthIn),
      defaultWidthIn: num(widthIn),
      defaultHeightIn: num(heightIn),
      ...(enabled !== undefined ? { enabled } : {}),
    };
    update.mutate(
      { data },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetUspsSettingsQueryKey() });
          setClientSecret("");
          setAccountNumber("");
          setTestResult(null);
          toast({ title: enabled === undefined ? "USPS guardado" : enabled ? "USPS encendido" : "USPS apagado" });
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo guardar"), variant: "destructive" }),
      },
    );
  };

  const runTest = () =>
    test.mutate(undefined, {
      onSuccess: (r) => {
        const where = r.environment === "production" ? "producción" : "pruebas";
        if (!r.ok) setTestResult({ ok: false, text: r.error ?? "No se pudo conectar." });
        else if (r.payment) setTestResult({ ok: true, text: `Conectado a USPS (${where}): la cuenta de pago quedó autorizada para comprar etiquetas.` });
        else setTestResult({ ok: true, text: `Conectado a USPS (${where}): el token funciona. Faltan los datos de la cuenta de pago para probar las etiquetas.` });
      },
      onError: (err) => setTestResult({ ok: false, text: apiErrorMessage(err, "No se pudo conectar.") }),
    });

  if (isLoading || !settings) return <div className="h-48 rounded-xl bg-muted/40 animate-pulse" />;

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Truck className="w-7 h-7 text-[#333366]" />
          <div>
            <h2 className="text-base font-semibold">USPS</h2>
            <p className="text-xs text-muted-foreground">
              Compra la etiqueta y el franqueo de los envíos a Estados Unidos desde el despacho. La guía queda en el paquete y el franqueo entra al costo del envío.
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          {settings.enabled ? "Encendido" : "Apagado"}
          <Switch checked={settings.enabled} onCheckedChange={(v) => save(v)} data-testid="switch-usps-enabled" />
        </label>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Ambiente</Label>
        <Select value={environment} onValueChange={(v) => setEnvironment(v as UspsEnvironment)}>
          <SelectTrigger className="max-w-md" data-testid="select-usps-environment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="test">Pruebas (apis-tem.usps.com) — no cobra nada</SelectItem>
            <SelectItem value="production">Producción (apis.usps.com) — cobra el franqueo de verdad</SelectItem>
          </SelectContent>
        </Select>
        {environment === "test" ? (
          <p className="text-[11px] text-muted-foreground">
            En pruebas la etiqueta se crea y se puede ver su PDF, pero no es un paquete real: no se escribe la guía en el despacho ni se anota ningún cargo.
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> Cada etiqueta comprada descuenta el franqueo de tu cuenta de pago de USPS.
          </p>
        )}
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">App de USPS</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Consumer Key</Label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} data-testid="input-usps-client-id" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Consumer Secret</Label>
            <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={settings.hasClientSecret ? "Guardado — escribe uno nuevo para cambiarlo" : ""} data-testid="input-usps-client-secret" />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Cuenta de pago</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">CRID</Label>
            <Input value={crid} onChange={(e) => setCrid(e.target.value)} data-testid="input-usps-crid" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">MID</Label>
            <Input value={mid} onChange={(e) => setMid(e.target.value)} data-testid="input-usps-mid" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">MID del manifiesto (si es otro)</Label>
            <Input value={manifestMid} onChange={(e) => setManifestMid(e.target.value)} placeholder="Casi siempre es el mismo MID" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Número de cuenta EPS</Label>
            <Input
              type="password"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder={settings.hasAccountNumber ? `Guardada ${settings.accountNumberPreview ?? ""} — escribe otra para cambiarla` : ""}
              data-testid="input-usps-account"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Remitente</h3>
        <p className="text-xs text-muted-foreground -mt-2">La dirección de la que sale el paquete (el almacén de Estados Unidos).</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Nombre o empresa</Label>
            <Input value={fromName} onChange={(e) => setFromName(e.target.value)} data-testid="input-usps-from-name" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Calle</Label>
            <Input value={fromStreet} onChange={(e) => setFromStreet(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Apto / Suite</Label>
            <Input value={fromStreet2} onChange={(e) => setFromStreet2(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ciudad</Label>
            <Input value={fromCity} onChange={(e) => setFromCity(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Estado</Label>
              <Input value={fromState} onChange={(e) => setFromState(e.target.value.toUpperCase())} maxLength={2} placeholder="FL" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ZIP</Label>
              <Input value={fromZip} onChange={(e) => setFromZip(e.target.value)} maxLength={5} placeholder="32801" />
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Paquete de siempre</h3>
        <p className="text-xs text-muted-foreground -mt-2">Lo que se propone al crear cada etiqueta; se puede cambiar en cada una.</p>
        <div className="grid gap-4 sm:grid-cols-5">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Servicio</Label>
            <Select value={mailClass} onValueChange={(v) => setMailClass(v as UspsMailClass)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(USPS_MAIL_CLASS_LABELS) as UspsMailClass[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {USPS_MAIL_CLASS_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Peso (oz)</Label>
            <Input inputMode="decimal" value={weightOz} onChange={(e) => setWeightOz(e.target.value)} data-testid="input-usps-weight" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Largo × ancho × alto (pulgadas)</Label>
            <div className="flex items-center gap-1.5">
              <Input inputMode="decimal" value={lengthIn} onChange={(e) => setLengthIn(e.target.value)} placeholder="9" />
              <span className="text-muted-foreground">×</span>
              <Input inputMode="decimal" value={widthIn} onChange={(e) => setWidthIn(e.target.value)} placeholder="6" />
              <span className="text-muted-foreground">×</span>
              <Input inputMode="decimal" value={heightIn} onChange={(e) => setHeightIn(e.target.value)} placeholder="3" />
            </div>
          </div>
        </div>
      </section>

      <div className="rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground space-y-1">
        <div className="font-medium text-foreground/80">Cómo conseguir los datos</div>
        <ol className="list-decimal pl-4 space-y-0.5">
          <li>Entra a cop.usps.com (Customer Onboarding Portal) con tu cuenta de negocio de USPS. De ahí salen el CRID y el MID.</li>
          <li>Agrega la cuenta de pago (débito ACH). USPS hace dos microdepósitos en 24–48 h: confírmalos en el portal. Ese es tu número de cuenta EPS.</li>
          <li>En My Apps → Developer Apps → Add App crea la app y copia el Consumer Key y el Consumer Secret.</li>
          <li>Pide a USPS API Support el acceso a Labels para tu app (con tu CRID y MID). Hasta que lo aprueben, "Probar conexión" funciona con el token pero no con la cuenta de pago.</li>
        </ol>
      </div>

      {settings.missing.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Para comprar etiquetas falta: {settings.missing.join(", ")}.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => save()} disabled={update.isPending} className="gap-1.5" data-testid="button-save-usps">
          {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
        </Button>
        <Button variant="outline" onClick={runTest} disabled={test.isPending} className="gap-1.5" data-testid="button-test-usps">
          {test.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />} Probar conexión
        </Button>
      </div>
      {testResult && (
        <div className={testResult.ok ? "flex items-start gap-2 text-sm text-emerald-600" : "flex items-start gap-2 text-sm text-red-600"} data-testid="usps-test-result">
          {testResult.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />} {testResult.text}
        </div>
      )}
    </div>
  );
}
