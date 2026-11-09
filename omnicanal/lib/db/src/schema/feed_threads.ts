import { serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { pgTable, pgEnum } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { channelEnum } from "./conversations";

// A comment "thread" is one root comment on a post plus every reply below it.
// We create one thread per root comment (unique per post + root-comment id) so
// the Feed UI can show a compact, one-row-per-conversation inbox.
export const feedThreadStatusEnum = pgEnum("feed_thread_status", [
  // Waiting for reply / can still receive replies
  "open",
  // Marked as done by a human — no auto-reply, hidden by default from the inbox
  "resolved",
  // A Private Reply was sent and the exchange continues in a DM conversation
  "migrated",
]);

export const feedThreadsTable = pgTable(
  "feed_threads",
  {
    id: serial("id").primaryKey(),
    channel: channelEnum("channel").notNull(),
    postId: integer("post_id").notNull(),
    // The id of the root (top-level) comment. Every child reply threads under it.
    externalRootCommentId: text("external_root_comment_id").notNull(),
    // Contact who opened the thread (author of the root comment). Nullable
    // because Meta occasionally omits the from field on IG (private accounts).
    contactId: integer("contact_id"),
    // Virtual/human agent currently assigned to this thread. Assigned lazily on
    // the first inbound comment, same as DM conversations.
    agentId: integer("agent_id"),
    status: feedThreadStatusEnum("status").notNull().default("open"),
    // If this thread was migrated to a DM, the id of the created conversation.
    migratedConversationId: integer("migrated_conversation_id"),
    // Intent label assigned by the AI classifier on the last inbound comment.
    labelId: integer("label_id"),
    lastCommentAt: timestamp("last_comment_at").notNull().defaultNow(),
    lastComment: text("last_comment"),
    unreadCount: integer("unread_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    postRootUnique: uniqueIndex("feed_threads_post_root_unique").on(
      t.postId,
      t.externalRootCommentId,
    ),
  }),
);

export const insertFeedThreadSchema = createInsertSchema(feedThreadsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFeedThread = z.infer<typeof insertFeedThreadSchema>;
export type FeedThread = typeof feedThreadsTable.$inferSelect;
