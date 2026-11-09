import { serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { channelEnum } from "./conversations";

// A Facebook Page post or Instagram media item that we've observed via a webhook
// comment. We upsert it lazily on the first inbound comment; there is no
// separate poll or import job. This lets the Feed UI group comment threads by
// the original publication.
export const feedPostsTable = pgTable(
  "feed_posts",
  {
    id: serial("id").primaryKey(),
    channel: channelEnum("channel").notNull(),
    // Meta's post/media id, scoped by channel. Facebook feed events give us a
    // full "{page_id}_{post_id}" or just the numeric post id; Instagram gives
    // the media id. We store exactly what Meta reports.
    externalPostId: text("external_post_id").notNull(),
    permalink: text("permalink"),
    // Cached message/caption of the publication. Best-effort — filled the first
    // time we can hit the Graph API for it, otherwise left null.
    caption: text("caption"),
    // Cached thumbnail/full media url for the UI preview.
    mediaUrl: text("media_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    channelPostUnique: uniqueIndex("feed_posts_channel_post_unique").on(
      t.channel,
      t.externalPostId,
    ),
  }),
);

export const insertFeedPostSchema = createInsertSchema(feedPostsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFeedPost = z.infer<typeof insertFeedPostSchema>;
export type FeedPost = typeof feedPostsTable.$inferSelect;
