import { serial, text, timestamp } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";

// Persistent, cross-instance dedupe of inbound provider events. Meta retries
// webhook deliveries and a horizontally-scaled deployment runs several instances,
// so an in-memory Set is not enough to guarantee a message is handled once. Before
// ingesting an inbound event we "claim" its provider message id here with an
// insert-on-conflict-do-nothing; only the instance that wins the insert processes
// it, everyone else treats it as a duplicate.
export const processedEventsTable = pgTable("processed_events", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ProcessedEvent = typeof processedEventsTable.$inferSelect;
