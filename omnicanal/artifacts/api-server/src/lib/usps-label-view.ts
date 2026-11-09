import type { UspsLabel } from "@workspace/db";

/** La etiqueta como la ve el panel: sin el PDF (que se descarga aparte) y con el peso en onzas. */
export function serializeUspsLabel(l: UspsLabel) {
  return {
    id: l.id,
    orderId: l.orderId,
    shipmentId: l.shipmentId,
    status: l.status,
    environment: l.environment,
    trackingNumber: l.trackingNumber,
    mailClass: l.mailClass,
    weightOz: Math.round(l.weightLb * 16 * 10) / 10,
    lengthIn: l.lengthIn,
    widthIn: l.widthIn,
    heightIn: l.heightIn,
    toAddress: l.toAddress,
    postageCents: l.postageCents,
    extraCents: l.extraCents,
    currency: l.currency,
    commitmentName: l.commitmentName,
    commitmentDate: l.commitmentDate,
    hasPdf: l.labelPdf != null,
    trackingStatus: l.trackingStatus,
    trackingCategory: l.trackingCategory,
    trackingSummary: l.trackingSummary,
    trackingCheckedAt: l.trackingCheckedAt,
    voidNote: l.voidNote,
    createdAt: l.createdAt,
    voidedAt: l.voidedAt,
  };
}

export type UspsLabelView = ReturnType<typeof serializeUspsLabel>;
