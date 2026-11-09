import { and, eq, sql } from "drizzle-orm";
import { db, campaignRecipientsTable } from "@workspace/db";
import type { InboundEvent } from "./meta";
import { parseCampaignReceipts } from "./campaign-report-model";

// Run only after webhook signature verification. Match the provider's message id
// AND our phone id; never infer delivery or readership from a successful POST.
export async function trackCampaignWebhook(body: unknown, events: InboundEvent[]) {
  for (const receipt of parseCampaignReceipts(body)) {
    const field = receipt.status === "read" ? "readAt" : receipt.status === "delivered" ? "deliveredAt" :
      receipt.status === "failed" ? "deliveryFailedAt" : "providerSentAt";
    const column = campaignRecipientsTable[field];
    await db.update(campaignRecipientsTable).set({
      [field]: sql`coalesce(least(${column}, ${receipt.at}), ${receipt.at})`,
      ...(receipt.status === "failed" ? { error: receipt.error ?? "Meta informó un fallo de entrega." } : {}),
    }).where(and(
      eq(campaignRecipientsTable.channel, "whatsapp"),
      eq(campaignRecipientsTable.providerMessageId, receipt.messageId),
      eq(campaignRecipientsTable.providerNumberId, receipt.numberId),
    ));
  }
  // Count contacts who explicitly reply to the campaign message. An unrelated
  // incoming chat is not evidence that a particular campaign caused a response.
  for (const event of events) {
    if (event.channel !== "whatsapp" || !event.replyToExternalId || !event.recipientNumberId) continue;
    const matches = await db.select().from(campaignRecipientsTable).where(and(
      eq(campaignRecipientsTable.channel, "whatsapp"),
      eq(campaignRecipientsTable.providerMessageId, event.replyToExternalId),
      eq(campaignRecipientsTable.providerNumberId, event.recipientNumberId),
    ));
    const normalize = (value: string) => /^[A-Z]{2}\./.test(value) ? value : value.replace(/\D/g, "");
    for (const row of matches) {
      if (!row.recipientExternalId || normalize(row.recipientExternalId) !== normalize(event.senderId)) continue;
      await db.update(campaignRecipientsTable).set({ repliedAt: sql`coalesce(${campaignRecipientsTable.repliedAt}, now())` })
        .where(eq(campaignRecipientsTable.id, row.id));
    }
  }
}
