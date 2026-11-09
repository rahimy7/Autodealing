import { serial, text, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Admin-composed messages sent verbatim to the customer (no AI). Today they back
// the seasonal welcome: when one is active it replaces the virtual agent's first
// reply on a brand-new conversation.
//
// Buttons are delivered as real interactive replies — WhatsApp interactive
// buttons, Messenger/Instagram quick replies — so a tap comes back as a normal
// inbound message carrying the button id.
export type CustomMessageButton = {
  // Stable id echoed back by Meta when the customer taps it. Max 256 chars (WA).
  id: string;
  // Visible text. WhatsApp caps button titles at 20 characters.
  label: string;
};

export const customMessageKindEnum = ["welcome"] as const;

export const customMessagesTable = pgTable(
  "custom_messages",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // What the message is for. Only "welcome" today; kept as a column so other
    // kinds (away, post-purchase…) can reuse the same composer.
    kind: text("kind").notNull().default("welcome"),
    body: text("body").notNull(),
    // Supabase storage path of the attached image, served through /api/media.
    imagePath: text("image_path"),
    buttons: jsonb("buttons").$type<CustomMessageButton[]>().notNull().default([]),
    // Channels this message applies to. Empty = all channels.
    channels: text("channels").array().notNull().default([]),
    // Only one active message per kind — enforced by activeKindIdx below.
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Partial unique index: at most one active row per kind. Activating another
    // message must deactivate the current one in the same transaction.
    uniqueIndex("custom_messages_active_kind_idx")
      .on(t.kind)
      .where(sql`${t.isActive}`),
  ],
);

export const insertCustomMessageSchema = createInsertSchema(customMessagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCustomMessage = z.infer<typeof insertCustomMessageSchema>;
export type CustomMessage = typeof customMessagesTable.$inferSelect;
