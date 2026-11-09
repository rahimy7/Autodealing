import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetShopifyLabelDraftQueryKey,
  useCreateShopifyLabel,
  useDiscardShopifyLabel,
  useGetShopifyLabelDraft,
  useRefreshShopifyLabel,
  type ShopifyLabel,
} from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Loader2, RefreshCw, ShoppingCart, Tag, Truck, XCircle } from "lucide-react";
import { SiShopify } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, invalidateApi } from "@/lib/money";
import { openPdf } from "@/lib/open-pdf";

export type ShopifyLabelTarget = { shipmentId: number; orderId: number; orderCode: string };

function LabelCard({ label, onChanged }: { label: ShopifyLabel; onChanged: () => void }) {
  const { toast } = useToast();
  const refresh = useRefreshShopifyLabel();
  const discard = useDiscardShopifyLabel();
  const [opening, setOpening] = useState(false);

  const open = async () => {
    setOpening(true);
    try {
      await openPdf(`/api/shopify-labels/${label.id}/pdf`, `etiqueta-shopify-${label.id}.pdf`);
    } catch (err) {
      toast({ title: apiErrorMessage(err, "No se pudo abrir el PDF"), variant: "destructive" });
    } finally {
      setOpening(false);
    }
  };

  const consult = () =>
    refresh.mutate(
      { id: label.id },
      {
        onSuccess: (r) => {
          onChanged();
          if (r.warnings.length) toast({ title: "Etiqueta consultada", description: r.warnings.join(" ") });
        },
        onError: (err) => {
          onChanged();
          toast({ title: apiErrorMessage(err, "No se pudo consultar a Shopify"), variant: "destructive" });
        },
      },
    );

  const descartar = () => {
    if (!window.confirm("¿Ya anulaste esta etiqueta en el admin de Shopify? Aquí se quita su guía del paquete y la parada queda libre para otra etiqueta.\n\nShopify no deja anularla desde aquí.")) return;
    discard.mutate(
      { id: label.id },
      {
        onSuccess: () => {
          onChanged();
          toast({ title: "Etiqueta descartada" });
        },
        onError: (err) => toast({ title: apiErrorMessage(err, "No se pudo descartar"), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-4" data-testid="shopify-label-card">
      {label.status === "creating" ? (
        <>
          <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
            <Loader2 className="w-4 h-4 mt-0.5 animate-spin shrink-0" /> Shopify aún no confirma la compra. {label.note ?? ""} Pulsa «Consultar»; no compres otra hasta saber cómo terminó, para no pagarla dos veces.
          </p>
          <div className="flex gap-2">
            <Button size="sm" className="gap-1.5" onClick={consult} disabled={refresh.isPending} data-testid="button-shopify-label-refresh">
              <RefreshCw className={refresh.isPending ? "w-4 h-4 animate-spin" : "w-4 h-4"} /> Consultar
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={descartar} disabled={discard.isPending}>
              <XCircle className="w-4 h-4" /> Descartar
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" /> Etiqueta comprada con Shopify
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Guía</dt>
            <dd className="font-mono text-xs break-all">
              {label.trackingNumber ?? "—"} {label.trackingCompany && <span className="font-sans text-muted-foreground">({label.trackingCompany})</span>}{" "}
              {label.trackingUrl && (
                <a href={label.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-sans text-primary hover:underline">
                  <ExternalLink className="w-3 h-3" /> Rastrear
                </a>
              )}
            </dd>
            {label.weightOz != null && (
              <>
                <dt className="text-muted-foreground">Peso</dt>
                <dd>{label.weightOz} oz</dd>
              </>
            )}
            {label.cancellable != null && (
              <>
                <dt className="text-muted-foreground">Anulable</dt>
                <dd>{label.cancellable ? "Sí, desde el admin de Shopify" : "No"}</dd>
              </>
            )}
          </dl>
          {label.note && <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-md p-2">{label.note}</p>}
          <p className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
            Shopify no informa el costo de la etiqueta: anótalo en «Cargos del envío» del despacho cuando lo veas en Shopify, para que entre al margen del pedido.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" className="gap-1.5" onClick={open} disabled={!label.hasPdf || opening} data-testid="button-shopify-open-pdf">
              {opening ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} {label.hasPdf ? "Abrir PDF para imprimir" : "Sin PDF: imprímela en Shopify"}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={consult} disabled={refresh.isPending}>
              <RefreshCw className={refresh.isPending ? "w-4 h-4 animate-spin" : "w-4 h-4"} /> Consultar
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={descartar} disabled={discard.isPending} data-testid="button-shopify-discard">
              <XCircle className="w-4 h-4" /> Ya la anulé en Shopify
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ShopifyLabelDialog({ target, onClose, onUseUsps }: { target: ShopifyLabelTarget | null; onClose: () => void; onUseUsps: (target: ShopifyLabelTarget) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const params = { shipmentId: target?.shipmentId ?? 0, orderId: target?.orderId ?? 0 };
  const { data: draft, isLoading, error } = useGetShopifyLabelDraft(params, { query: { enabled: target != null, queryKey: getGetShopifyLabelDraftQueryKey(params) } });
  const create = useCreateShopifyLabel();
  const [weightOz, setWeightOz] = useState("");

  const refresh = () => {
    // Los couriers también: la primera etiqueta de USPS crea el courier "USPS" del catálogo.
    void invalidateApi(queryClient, "/api/shipments", "/api/shopify-labels", "/api/orders", "/api/carriers");
  };

  const buy = () => {
    if (!target) return;
    const weight = weightOz.trim() ? Number(weightOz.replace(",", ".")) : null;
    if (weight != null && !(weight > 0)) {
      toast({ title: "El peso va mayor que cero", variant: "destructive" });
      return;
    }
    if (
      !window.confirm(
        `Shopify comprará la etiqueta de ${target.orderCode} y la cobrará a tu cuenta de Shopify.\n\nLa tarifa la elige Shopify (la que escogió el cliente, la preferida de la tienda o la recomendada) y su precio no se ve antes de comprar.\n\n¿Comprar la etiqueta?`,
      )
    )
      return;
    create.mutate(
      { data: { shipmentId: target.shipmentId, orderId: target.orderId, weightOz: weight } },
      {
        onSuccess: (r) => {
          refresh();
          toast({ title: "Etiqueta comprada", description: r.warnings.join(" ") || undefined });
        },
        onError: (err) => {
          // Una compra que Shopify aún no confirmó deja la parada reservada: se refresca para verla.
          refresh();
          toast({ title: "No se compró la etiqueta", description: apiErrorMessage(err, "Error desconocido"), variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SiShopify className="w-5 h-5 text-[#95BF47]" /> Etiqueta con Shopify · {target?.orderCode}
            {draft?.orderName && <span className="text-sm font-normal text-muted-foreground">{draft.orderName}</span>}
          </DialogTitle>
          <DialogDescription>La etiqueta la compra Shopify Shipping. La guía queda en el despacho y sale en el correo «va en camino».</DialogDescription>
        </DialogHeader>

        {isLoading && <div className="h-32 rounded-lg bg-muted/40 animate-pulse" />}
        {error && <p className="text-sm text-red-600">{apiErrorMessage(error, "No se pudo preparar la etiqueta")}</p>}

        {draft && draft.externalTracking.length > 0 && !draft.label && (
          <div className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400 space-y-1" data-testid="shopify-existing-tracking">
            <div className="flex items-center gap-1.5 font-medium">
              <Tag className="w-4 h-4" /> Shopify ya tiene la guía de este pedido
            </div>
            {draft.externalTracking.map((t) => (
              <div key={t.number} className="font-mono text-xs">
                {t.number} {t.company ? <span className="font-sans">({t.company})</span> : null}{" "}
                {t.url && (
                  <a href={t.url} target="_blank" rel="noreferrer" className="font-sans text-primary hover:underline">
                    Rastrear
                  </a>
                )}
              </div>
            ))}
            <p className="text-xs">Se usa al registrar el despacho. El PDF se baja desde el admin de Shopify.</p>
          </div>
        )}

        {draft?.label && <LabelCard label={draft.label} onChanged={refresh} />}

        {draft && !draft.label && draft.blocker && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-md p-3" data-testid="shopify-label-blocker">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{draft.blocker}</span>
            </div>
            {draft.uspsFallback && target && (
              <Button variant="outline" className="gap-1.5" onClick={() => onUseUsps(target)} data-testid="button-use-usps-direct">
                <Truck className="w-4 h-4" /> Usar la etiqueta de USPS directo
              </Button>
            )}
          </div>
        )}

        {draft && !draft.label && !draft.blocker && (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-3 space-y-1">
              <p>Shopify elige la tarifa (la que escogió el cliente al pagar, la preferida de la tienda o la recomendada) y la cobra a tu cuenta de Shopify.</p>
              <p>No se ve el precio antes de comprar, no se puede anular desde aquí (se anula en el admin de Shopify) y el costo no llega: se anota a mano en los cargos del despacho.</p>
            </div>
            <div className="space-y-1 max-w-[200px]">
              <Label className="text-xs">Peso total (oz, opcional)</Label>
              <Input inputMode="decimal" value={weightOz} onChange={(e) => setWeightOz(e.target.value)} placeholder="Shopify lo calcula" data-testid="input-shopify-label-weight" />
            </div>
            <div className="flex justify-end border-t border-card-border pt-4">
              <Button className="gap-1.5" onClick={buy} disabled={create.isPending} data-testid="button-shopify-buy">
                {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />} Comprar etiqueta con Shopify
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
