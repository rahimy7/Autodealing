import { serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campaignStatusEnum = pgEnum("campaign_status", ["draft", "scheduled", "sending", "sent", "failed"]);
export const campaignTypeEnum = pgEnum("campaign_type", ["marketing", "utility", "authentication"]);

// ── Composed message config stored per campaign ───────────────────────────────
// WhatsApp campaigns are sent as approved Meta templates; the header media/location
// and body variables the admin supplies at send time live here. Instagram/Facebook
// campaigns are free-form (bodyText + optional media attachment).
export type CampaignHeaderMedia = {
  type: "image" | "video" | "document";
  mediaId?: string | null; // WhatsApp media id (preferred — no public URL needed)
  url?: string | null; // link fallback
  filename?: string | null;
};
export type CampaignHeaderLocation = {
  type: "location";
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
};
export type CampaignPayload = {
  bodyText?: string | null; // free-form IG/FB text (also mirrors template body preview)
  variables?: string[]; // template body variable values ({{1}}, {{2}}, …)
  header?: CampaignHeaderMedia | CampaignHeaderLocation | null; // WhatsApp template header
  media?: { type: "image" | "video"; url?: string | null } | null; // IG/FB free-form attachment
};

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  channel: text("channel").notNull(),
  // Desde qué número de WhatsApp sale la campaña (FK a whatsapp_numbers.id). Null
  // en campañas de Instagram/Facebook y en las creadas antes de que hubiera
  // varios números: esas salen por el principal.
  whatsappNumberId: integer("whatsapp_number_id"),
  status: campaignStatusEnum("status").notNull().default("draft"),
  type: campaignTypeEnum("type").notNull(),
  // "template" (WhatsApp, Meta-approved template) | "freeform" (Instagram/Facebook).
  mode: text("mode").notNull().default("freeform"),
  message: text("message"),
  templateName: text("template_name"),
  templateLanguage: text("template_language"),
  payload: jsonb("payload").$type<CampaignPayload>(),
  recipientCount: integer("recipient_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  openedCount: integer("opened_count").notNull().default(0),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;
