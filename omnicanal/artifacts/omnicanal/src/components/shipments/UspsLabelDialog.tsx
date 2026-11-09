import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetUspsLabelDraftQueryKey,
  useCreateUspsLabel,
  useGetUspsLabelDraft,
  useRefreshUspsLabelTracking,
  useValidateUspsAddress,
  useVoidUspsLabel,
  type UspsAddressCheck,
  type UspsLabel,
  type UspsMailClass,
} from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Loader2, RefreshCw, ShieldCheck, ShoppingCart, Truck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiErrorMessage, formatCents, formatDateTime, invalidateApi } from "@/lib/money";
import { openPdf } from "@/lib/open-pdf";
import { USPS_MAIL_CLASS_LABELS } from "@/components/settings/UspsIntegration";

export type UspsLabelTarget = { shipmentId: number; orderId: number; orderCode: string };

const mailClassLabel = (value: string) => USPS_MAIL_CLASS_LABELS[value as UspsMailClass] ?? value;
const trackingLink = (tracking: string) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tracking)}`;
const num = (text: string): number => Number(text.replace(",", "."));

function EnvBadge({ environment }: { environment: "test" | "production" }) {
  return (
    <span className={cn("text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded", environment === "test" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-blue-500/15 text-blue-700 dark:text-blue-400")}>
      {environment === "test" ? "Pruebas" : "Producción"}
    </span>
  );
}

function LabelCard({ label, onChanged }: { label: UspsLabel; onChanged: () => void }) {
  const { toast } = useToast();
  const refreshTracking = useRefreshUspsLabelTracking();
  const voidLabel = useVoidUspsLabel();
  const [opening, setOpening] = useState(false);
  const test = label.environment === "test";

  const open = async () => {
    setOpening(true);
    try {
      await openPdf(`/api/usps/labels/${label.id}/pdf`, `etiqueta-usps-${label.id}.pdf`);
    } catch (err) {
      toast({ title: apiErrorMessage(err, "No se pudo abrir el PDF"), variant: "destructive" });
    } finally {
      setOpening(false);
    }
  };

  const anular = () => {
    if (!window.confirm(`¿Anular la etiqueta ${label.trackingNumber ?? ""}? USPS devuelve el franqueo solo si el paquete no se ha usado.`)) return;
    voidLabel.mutate(
      { id: label.id },
      {
        onSuccess: () => {
          onChanged();
          toast({ title: "Etiqueta anulada", description: "Se pidió el reembolso del franqueo a USPS." });
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "USPS no anuló la etiqueta"), variant: "destructive" }),
      },
    );
  };

  const track = () =>
    refreshTracking.mutate(
      { id: label.id },
      {
        onSuccess: (l) => {
          onChanged();
          if (!l.trackingStatus) toast({ title: "USPS aún no tiene movimientos de esta guía", description: "Aparecen cuando el paquete se escanea." });
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo consultar el rastreo"), variant: "destructive" }),
      },
    );

  return (
    <div className="space-y-4" data-testid="usps-label-card">
      {label.status === "creating" ? (
        <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
          <Loader2 className="w-4 h-4 mt-0.5 animate-spin shrink-0" /> La etiqueta se está creando. Si esto no termina, revisa tu cuenta de USPS antes de intentar otra vez, para no pagarla dos veces.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" /> Etiqueta creada <EnvBadge environment={label.environment} />
          </div>
          {test && (
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-md p-2">
              Es una etiqueta de PRUEBA: no es un paquete real ni se cobró, y su guía no se escribió en el despacho. Para enviar de verdad, pasa USPS a producción en Configuración y crea la etiqueta de nuevo.
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Guía</dt>
            <dd className="font-mono text-xs break-all">
              {label.trackingNumber}{" "}
              {label.trackingNumber && (
                <a href={trackingLink(label.trackingNumber)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-sans text-primary hover:underline">
                  <ExternalLink className="w-3 h-3" /> Rastrear
                </a>
              )}
            </dd>
            <dt className="text-muted-foreground">Servicio</dt>
            <dd>{mailClassLabel(label.mailClass)}</dd>
            <dt className="text-muted-foreground">Franqueo</dt>
            <dd className="tabular-nums">{formatCents(label.postageCents, label.currency)}</dd>
            {label.commitmentName && (
              <>
                <dt className="text-muted-foreground">Entrega</dt>
                <dd>
                  {label.commitmentName}
                  {label.commitmentDate ? ` · ${label.commitmentDate}` : ""}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Paquete</dt>
            <dd>
              {label.weightOz} oz · {label.lengthIn}×{label.widthIn}×{label.heightIn} in
            </dd>
            <dt className="text-muted-foreground">Para</dt>
            <dd>
              {label.toAddress.firstName} {label.toAddress.lastName}
              <br />
              {label.toAddress.streetAddress}
              {label.toAddress.secondaryAddress ? `, ${label.toAddress.secondaryAddress}` : ""}
              <br />
              {label.toAddress.city}, {label.toAddress.state} {label.toAddress.ZIPCode}
              {label.toAddress.ZIPPlus4 ? `-${label.toAddress.ZIPPlus4}` : ""}
            </dd>
            <dt className="text-muted-foreground">Rastreo</dt>
            <dd>
              {label.trackingStatus ? (
                <>
                  {label.trackingStatus}
                  {label.trackingCheckedAt && <span className="text-xs text-muted-foreground"> · consultado {formatDateTime(label.trackingCheckedAt)}</span>}
                </>
              ) : (
                <span className="text-muted-foreground">Sin movimientos todavía{label.trackingCheckedAt ? ` · consultado ${formatDateTime(label.trackingCheckedAt)}` : ""}</span>
              )}
            </dd>
          </dl>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" className="gap-1.5" onClick={open} disabled={!label.hasPdf || opening} data-testid="button-usps-open-pdf">
              {opening ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Abrir PDF para imprimir
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={track} disabled={refreshTracking.isPending}>
              <RefreshCw className={cn("w-4 h-4", refreshTracking.isPending && "animate-spin")} /> Actualizar rastreo
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={anular} disabled={voidLabel.isPending} data-testid="button-usps-void">
              <XCircle className="w-4 h-4" /> Anular etiqueta
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function UspsLabelDialog({ target, onClose }: { target: UspsLabelTarget | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const params = { shipmentId: target?.shipmentId ?? 0, orderId: target?.orderId ?? 0 };
  const { data: draft, isLoading, error } = useGetUspsLabelDraft(params, { query: { enabled: target != null, queryKey: getGetUspsLabelDraftQueryKey(params) } });
  const validate = useValidateUspsAddress();
  const create = useCreateUspsLabel();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [street, setStreet] = useState("");
  const [street2, setStreet2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [zip4, setZip4] = useState("");
  const [mailClass, setMailClass] = useState<UspsMailClass>("USPS_GROUND_ADVANTAGE");
  const [weightOz, setWeightOz] = useState("");
  const [lengthIn, setLengthIn] = useState("");
  const [widthIn, setWidthIn] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [check, setCheck] = useState<UspsAddressCheck | null>(null);

  useEffect(() => {
    if (!draft) return;
    setFirstName(draft.to.firstName);
    setLastName(draft.to.lastName);
    setStreet(draft.to.streetAddress);
    setStreet2(draft.to.secondaryAddress ?? "");
    setCity(draft.to.city);
    setState(draft.to.state);
    setZip(draft.to.ZIPCode);
    setZip4(draft.to.ZIPPlus4 ?? "");
    setMailClass((draft.package.mailClass as UspsMailClass) ?? "USPS_GROUND_ADVANTAGE");
    setWeightOz(draft.package.weightOz != null ? String(draft.package.weightOz) : "");
    setLengthIn(draft.package.lengthIn != null ? String(draft.package.lengthIn) : "");
    setWidthIn(draft.package.widthIn != null ? String(draft.package.widthIn) : "");
    setHeightIn(draft.package.heightIn != null ? String(draft.package.heightIn) : "");
    setCheck(null);
  }, [draft]);

  const refresh = () => {
    // Los couriers también: la primera etiqueta crea el courier "USPS" del catálogo.
    void invalidateApi(queryClient, "/api/shipments", "/api/usps", "/api/orders", "/api/carriers");
  };
  // Cada cambio de la dirección invalida la validación anterior.
  const edit = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setCheck(null);
  };

  const runValidate = () =>
    validate.mutate(
      { data: { streetAddress: street, secondaryAddress: street2 || null, city, state, ZIPCode: zip || null, ZIPPlus4: zip4 || null } },
      {
        onSuccess: setCheck,
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo validar la dirección"), variant: "destructive" }),
      },
    );

  const useUspsAddress = () => {
    const a = check?.address;
    if (!a) return;
    setStreet(a.streetAddress);
    setStreet2(a.secondaryAddress ?? "");
    setCity(a.city);
    setState(a.state);
    setZip(a.ZIPCode);
    setZip4(a.ZIPPlus4 ?? "");
    setCheck({ ...check, message: "Dirección de USPS aplicada." });
  };

  const buy = () => {
    if (!target || !draft) return;
    const parts = [weightOz, lengthIn, widthIn, heightIn].map(num);
    if (parts.some((n) => !(n > 0))) {
      toast({ title: "Faltan el peso y las medidas del paquete", variant: "destructive" });
      return;
    }
    const real = draft.environment === "production";
    const notValidated = !check?.found;
    const question = real
      ? `Se cobrará el franqueo de tu cuenta de USPS por la etiqueta de ${target.orderCode}.${notValidated ? "\n\nLa dirección no está validada con USPS." : ""}\n\n¿Comprar la etiqueta?`
      : `Etiqueta de PRUEBA para ${target.orderCode}: no se cobra ni es un paquete real. ¿Crearla?`;
    if (!window.confirm(question)) return;
    create.mutate(
      {
        data: {
          shipmentId: target.shipmentId,
          orderId: target.orderId,
          to: { firstName, lastName, streetAddress: street, secondaryAddress: street2 || null, city, state, ZIPCode: zip, ZIPPlus4: zip4 || null },
          package: { mailClass, weightOz: parts[0], lengthIn: parts[1], widthIn: parts[2], heightIn: parts[3] },
        },
      },
      {
        onSuccess: (r) => {
          refresh();
          toast({ title: real ? "Etiqueta comprada" : "Etiqueta de prueba creada", description: r.warnings.length ? r.warnings.join(" ") : undefined, variant: r.warnings.length ? "destructive" : undefined });
        },
        onError: (err) => {
          // Un fallo sin respuesta de USPS pudo haber cobrado: se refresca por si quedó algo.
          refresh();
          toast({ title: "No se creó la etiqueta", description: apiErrorMessage(err, "Error desconocido"), variant: "destructive" });
        },
      },
    );
  };

  const blocked = draft && (!draft.enabled || draft.missing.length > 0);
  const showForm = draft && !draft.label && !blocked;
  const addressWarning = check?.found && check.dpvConfirmation && check.dpvConfirmation !== "Y";

  return (
    <Dialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="w-5 h-5" /> Etiqueta de USPS · {target?.orderCode}
            {draft && <EnvBadge environment={draft.environment} />}
          </DialogTitle>
          <DialogDescription>Crea la etiqueta, imprímela y pégala en el paquete. La guía queda en el despacho y el franqueo entra a su costo.</DialogDescription>
        </DialogHeader>

        {isLoading && <div className="h-40 rounded-lg bg-muted/40 animate-pulse" />}
        {error && <p className="text-sm text-red-600">{apiErrorMessage(error, "No se pudo preparar la etiqueta")}</p>}

        {blocked && (
          <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-md p-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              {!draft.enabled ? "USPS está apagado. " : ""}
              {draft.missing.length > 0 ? `Falta en Configuración → USPS: ${draft.missing.join(", ")}.` : "Enciéndelo en Configuración → USPS."}
            </span>
          </div>
        )}

        {draft?.label && <LabelCard label={draft.label} onChanged={refresh} />}

        {showForm && (
          <div className="space-y-5">
            <section className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold">Dirección de entrega</h3>
              </div>
              {draft.address && (
                <p className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
                  En el pedido: <span className="text-foreground/80">{draft.address}</span>
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Nombre</Label>
                  <Input value={firstName} onChange={(e) => edit(setFirstName)(e.target.value)} data-testid="input-usps-to-first" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Apellido</Label>
                  <Input value={lastName} onChange={(e) => edit(setLastName)(e.target.value)} data-testid="input-usps-to-last" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Calle</Label>
                  <Input value={street} onChange={(e) => edit(setStreet)(e.target.value)} data-testid="input-usps-to-street" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Apto / Suite</Label>
                  <Input value={street2} onChange={(e) => edit(setStreet2)(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ciudad</Label>
                  <Input value={city} onChange={(e) => edit(setCity)(e.target.value)} data-testid="input-usps-to-city" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Estado</Label>
                    <Input value={state} onChange={(e) => edit(setState)(e.target.value.toUpperCase())} maxLength={2} placeholder="FL" data-testid="input-usps-to-state" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">ZIP</Label>
                    <Input value={zip} onChange={(e) => edit(setZip)(e.target.value)} maxLength={5} data-testid="input-usps-to-zip" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">+4</Label>
                    <Input value={zip4} onChange={(e) => edit(setZip4)(e.target.value)} maxLength={4} />
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={runValidate} disabled={validate.isPending || !street.trim() || !city.trim() || !state.trim()} data-testid="button-usps-validate">
                  {validate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Validar con USPS
                </Button>
                {check?.found && check.address && (
                  <Button size="sm" variant="ghost" onClick={useUspsAddress}>
                    Usar la dirección de USPS
                  </Button>
                )}
              </div>
              {check && (
                <div
                  className={cn("text-xs rounded-md p-2", check.found && !addressWarning ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400")}
                  data-testid="usps-address-check"
                >
                  {check.found ? (
                    <>
                      <div className="font-medium">{addressWarning ? "USPS la encontró, pero revisa el apartamento." : "Dirección confirmada por USPS."}</div>
                      {check.address && (
                        <div>
                          {check.address.streetAddress}
                          {check.address.secondaryAddress ? `, ${check.address.secondaryAddress}` : ""}, {check.address.city}, {check.address.state} {check.address.ZIPCode}
                          {check.address.ZIPPlus4 ? `-${check.address.ZIPPlus4}` : ""}
                        </div>
                      )}
                      {check.message && <div>{check.message}</div>}
                    </>
                  ) : (
                    <div className="font-medium">{check.message ?? "USPS no reconoce esta dirección."} Corrígela antes de comprar.</div>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Paquete</h3>
              <div className="grid gap-3 sm:grid-cols-5">
                <div className="space-y-1 sm:col-span-2">
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
                <div className="space-y-1">
                  <Label className="text-xs">Peso (oz)</Label>
                  <Input inputMode="decimal" value={weightOz} onChange={(e) => setWeightOz(e.target.value)} data-testid="input-usps-weight" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Largo × ancho × alto (in)</Label>
                  <div className="flex items-center gap-1.5">
                    <Input inputMode="decimal" value={lengthIn} onChange={(e) => setLengthIn(e.target.value)} />
                    <span className="text-muted-foreground">×</span>
                    <Input inputMode="decimal" value={widthIn} onChange={(e) => setWidthIn(e.target.value)} />
                    <span className="text-muted-foreground">×</span>
                    <Input inputMode="decimal" value={heightIn} onChange={(e) => setHeightIn(e.target.value)} />
                  </div>
                </div>
              </div>
            </section>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-card-border pt-4">
              {!check?.found && <span className="text-xs text-muted-foreground">Valida la dirección antes de comprar.</span>}
              <Button className="gap-1.5" onClick={buy} disabled={create.isPending} data-testid="button-usps-buy">
                {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                {draft.environment === "production" ? "Comprar etiqueta" : "Crear etiqueta de prueba"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
