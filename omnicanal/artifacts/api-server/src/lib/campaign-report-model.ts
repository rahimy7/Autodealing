// Pure reporting rules: callbacks may be duplicated or arrive out of order.
type DateValue = Date | string | null;
export type ReportSource = {
  id: number; status: string; recipientExternalId: string | null; error: string | null;
  sentAt: DateValue; providerMessageId: string | null; providerSentAt: DateValue;
  deliveredAt: DateValue; readAt: DateValue; deliveryFailedAt: DateValue; repliedAt: DateValue;
};

export function campaignReportRow(row: ReportSource) {
  const state = row.readAt ? "read" : row.deliveredAt ? "delivered" :
    row.deliveryFailedAt || row.status === "failed" ? "failed" :
    row.providerSentAt ? "sent" : row.sentAt ? (row.providerMessageId ? "accepted" : "untracked") : "pending";
  return { id: row.id, recipientExternalId: row.recipientExternalId, state,
    sentAt: row.sentAt, providerSentAt: row.providerSentAt, deliveredAt: row.deliveredAt,
    readAt: row.readAt, failedAt: row.deliveryFailedAt, repliedAt: row.repliedAt,
    tracked: !!row.providerMessageId, error: state === "failed" ? row.error : null };
}

export function campaignReportSummary(rows: ReturnType<typeof campaignReportRow>[]) {
  return {
    total: rows.length,
    accepted: rows.filter(r => !!r.sentAt).length,
    sent: rows.filter(r => !!r.providerSentAt || !!r.deliveredAt || !!r.readAt).length,
    delivered: rows.filter(r => !!r.deliveredAt || !!r.readAt).length,
    read: rows.filter(r => !!r.readAt).length,
    failed: rows.filter(r => r.state === "failed").length,
    pending: rows.filter(r => r.state === "pending").length,
    untracked: rows.filter(r => r.state === "untracked").length,
    replied: rows.filter(r => !!r.repliedAt).length,
  };
}

export type CampaignReceipt = { messageId: string; numberId: string; status: "sent" | "delivered" | "read" | "failed"; at: Date; error: string | null };
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function parseCampaignReceipts(body: unknown): CampaignReceipt[] {
  const root = object(body);
  if (root.object !== "whatsapp_business_account") return [];
  const receipts: CampaignReceipt[] = [];
  for (const entry of array(root.entry)) for (const change of array(object(entry).changes)) {
    const value = object(object(change).value);
    const numberId = object(value.metadata).phone_number_id;
    if (typeof numberId !== "string" || !numberId) continue;
    for (const raw of array(value.statuses)) {
      const receipt = object(raw);
      if (typeof receipt.id !== "string" || !receipt.id || !["sent", "delivered", "read", "failed"].includes(receipt.status)) continue;
      const millis = Number(receipt.timestamp) * 1000;
      if (!receipt.timestamp || !Number.isFinite(millis) || millis <= 0 || Number.isNaN(new Date(millis).getTime())) continue;
      const firstError = object(array(receipt.errors)[0]);
      const detail = object(firstError.error_data).details;
      const error = [firstError.code, firstError.title, typeof detail === "string" ? detail : firstError.message]
        .filter(v => typeof v === "string" || typeof v === "number").join(" · ").slice(0, 2000) || null;
      receipts.push({ messageId: receipt.id, numberId, status: receipt.status, at: new Date(millis), error });
    }
  }
  return receipts;
}
