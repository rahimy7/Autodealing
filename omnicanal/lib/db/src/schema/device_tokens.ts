import { serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const devicePlatformEnum = pgEnum("device_platform", ["ios", "android", "web"]);

// Push targets registered by the mobile app. One row per device: the Expo push
// token is the natural key, so a phone that changes hands simply rebinds to the
// new session instead of accumulating rows.
export const deviceTokensTable = pgTable(
  "device_tokens",
  {
    id: serial("id").primaryKey(),
    // Expo push token ("ExponentPushToken[...]"). Unique across the table.
    token: text("token").notNull(),
    platform: devicePlatformEnum("platform").notNull().default("android"),
    // Who is logged in on this device. `agentId` is null for the environment
    // administrator, whose account has no agent row — the email identifies it.
    agentId: integer("agent_id"),
    userEmail: text("user_email").notNull(),
    role: text("role").notNull().default("agent"), // admin | agent
    deviceName: text("device_name"),
    // Bumped on every app launch; a token untouched for months is stale and can
    // be pruned without waiting for Expo to report it as unregistered.
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("device_tokens_token_key").on(table.token)],
);

export const insertDeviceTokenSchema = createInsertSchema(deviceTokensTable).omit({ id: true, createdAt: true });
export type InsertDeviceToken = z.infer<typeof insertDeviceTokenSchema>;
export type DeviceToken = typeof deviceTokensTable.$inferSelect;
