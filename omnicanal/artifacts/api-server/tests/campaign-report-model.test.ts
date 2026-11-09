import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignReportRow, campaignReportSummary, parseCampaignReceipts, type ReportSource } from "../src/lib/campaign-report-model";

const base: ReportSource = { id: 1, status: "sent", recipientExternalId: "18095550123", error: null,
  sentAt: new Date("2026-10-23T20:00:00Z"), providerMessageId: "wamid.test", providerSentAt: null,
  deliveredAt: null, readAt: null, deliveryFailedAt: null, repliedAt: null };
test("read confirmation implies delivery without inventing its timestamp", () => {
  const row = campaignReportRow({ ...base, readAt: new Date(), deliveryFailedAt: new Date(), error: "late failure" });
  assert.equal(row.state, "read"); assert.equal(row.deliveredAt, null); assert.equal(row.error, null);
  const summary = campaignReportSummary([row]);
  assert.equal(summary.read, 1); assert.equal(summary.delivered, 1); assert.equal(summary.sent, 1); assert.equal(summary.failed, 0);
});
test("accepted request, confirmed failure and legacy send remain distinct", () => {
  const rows = [campaignReportRow(base), campaignReportRow({ ...base, id: 2, deliveryFailedAt: new Date(), error: "blocked" }),
    campaignReportRow({ ...base, id: 3, providerMessageId: null }),
    campaignReportRow({ ...base, id: 4, status: "pending", sentAt: null, providerMessageId: null })];
  assert.deepEqual(rows.map(r => r.state), ["accepted", "failed", "untracked", "pending"]);
  const summary = campaignReportSummary(rows);
  assert.equal(summary.accepted, 3); assert.equal(summary.delivered, 0); assert.equal(summary.read, 0);
  assert.equal(summary.failed, 1); assert.equal(summary.untracked, 1); assert.equal(summary.pending, 1);
});
test("reply totals count contacts once regardless of number of replies", () => {
  const row = campaignReportRow({ ...base, repliedAt: new Date() });
  assert.equal(campaignReportSummary([row]).replied, 1);
});
test("parse batched status callbacks including useful failure details", () => {
  const body = { object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "our-number" }, statuses: [
    { id: "wamid.1", status: "read", timestamp: "1792785600" },
    { id: "wamid.2", status: "failed", timestamp: "1792785601", errors: [{ code: 131026, title: "Undeliverable", error_data: { details: "Cannot deliver" } }] },
  ] } }] }] };
  const receipts = parseCampaignReceipts(body);
  assert.equal(receipts.length, 2); assert.equal(receipts[0].numberId, "our-number");
  assert.equal(receipts[0].at.toISOString(), "2026-10-23T20:00:00.000Z");
  assert.match(receipts[1].error!, /131026.*Cannot deliver/);
});
test("ignore malformed, foreign-channel and undated receipts", () => {
  for (const body of [null, {}, { object: "instagram" }, { object: "whatsapp_business_account", entry: [null, { changes: [null] }] }]) assert.deepEqual(parseCampaignReceipts(body), []);
  assert.deepEqual(parseCampaignReceipts({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "n" }, statuses: [
    { id: "m", status: "read", timestamp: "oops" }, { id: "m", status: "unknown", timestamp: "1" }, { status: "read", timestamp: "1" },
  ] } }] }] }), []);
});
