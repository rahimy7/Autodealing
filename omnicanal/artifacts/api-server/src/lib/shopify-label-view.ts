import type { ShopifyLabel } from "@workspace/db";

/** La etiqueta comprada con Shopify como la ve el panel: sin el PDF, que se descarga aparte. */
export function serializeShopifyLabel(l: ShopifyLabel) {
  return {
    id: l.id,
    orderId: l.orderId,
    shipmentId: l.shipmentId,
    status: l.status,
    trackingNumber: l.trackingNumber,
    trackingCompany: l.trackingCompany,
    trackingUrl: l.trackingUrl,
    weightOz: l.weightOz,
    hasPdf: l.labelPdf != null,
    cancellable: l.cancellable,
    note: l.note,
    createdAt: l.createdAt,
    discardedAt: l.discardedAt,
  };
}

export type ShopifyLabelView = ReturnType<typeof serializeShopifyLabel>;
