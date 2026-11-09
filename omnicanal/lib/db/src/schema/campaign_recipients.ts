import { serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { campaignsTable } from "./campaigns";
import { contactsTable } from "./contacts";

export const campaignRecipientStatusEnum = pgEnum("campaign_recipient_status", ["pending", "sent", "failed"]);

// One row per (campaign, contact) — lets a marketing send report per-recipient
// delivery status instead of just aggregate counters.
export const campaignRecipientsTable = pgTable("campaign_recipients", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaignsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  channel: text("channel").notNull(),
  // Channel-scoped delivery id (wa_id / PSID / IGSID) resolved from the contact.
  recipientExternalId: text("recipient_external_id"),
  status: campaignRecipientStatusEnum("status").notNull().default("pending"),
  error: text("error"),
  sentAt: timestamp("sent_at"),
  providerMessageId: text("provider_message_id"),
  providerNumberId: text("provider_number_id"),
  providerSentAt: timestamp("provider_sent_at"),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
  deliveryFailedAt: timestamp("delivery_failed_at"),
  repliedAt: timestamp("replied_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("campaign_recipients_provider_message_idx").on(table.providerMessageId)]);

export const insertCampaignRecipientSchema = createInsertSchema(campaignRecipientsTable).omit({ id: true, createdAt: true });
export type InsertCampaignRecipient = z.infer<typeof insertCampaignRecipientSchema>;
export type CampaignRecipient = typeof campaignRecipientsTable.$inferSelect;

