// Smoke test for the feed comment pipeline. Ingests a synthetic Facebook feed
// webhook payload against the REAL database and asserts every side effect,
// then cleans up so the run leaves no rows behind. Run with:
//
//   DATABASE_URL="$(grep DATABASE_URL .env | cut -d= -f2- | tr -d '"')" \
//     AI_INTEGRATIONS_OPENAI_API_KEY="" \
//     pnpm --filter api-server exec tsx scripts/smoke-feed.ts
//
// AI_INTEGRATIONS_OPENAI_API_KEY is intentionally emptied so the pipeline
// skips classification and reply generation — that path is unit-tested via
// the OpenAI mocked flow and would otherwise require live API traffic.

import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  feedPostsTable,
  feedThreadsTable,
  feedCommentsTable,
  contactsTable,
  processedEventsTable,
} from "@workspace/db";
import { parseInboundCommentEvents } from "../src/lib/meta.js";
import { ingestInboundComment } from "../src/lib/feed.js";

const log = {
  info: () => {},
  warn: (...a: unknown[]) => console.warn("[log.warn]", ...a),
  error: (...a: unknown[]) => console.error("[log.error]", ...a),
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
}

function unique(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanup(ids: {
  externalPostId: string;
  externalCommentIds: string[];
  authorExternalId: string;
}) {
  // Remove processed_events dedupe rows
  for (const cid of ids.externalCommentIds) {
    await db.delete(processedEventsTable).where(eq(processedEventsTable.eventId, `feed:${cid}`));
  }
  // Delete comments → threads → posts (FK-free schema so any order works, but
  // this is what a cascade would look like).
  const [post] = await db
    .select()
    .from(feedPostsTable)
    .where(eq(feedPostsTable.externalPostId, ids.externalPostId));
  if (post) {
    const threads = await db.select().from(feedThreadsTable).where(eq(feedThreadsTable.postId, post.id));
    for (const t of threads) {
      await db.delete(feedCommentsTable).where(eq(feedCommentsTable.threadId, t.id));
    }
    await db.delete(feedThreadsTable).where(eq(feedThreadsTable.postId, post.id));
    await db.delete(feedPostsTable).where(eq(feedPostsTable.id, post.id));
  }
  await db.delete(contactsTable).where(eq(contactsTable.externalId, ids.authorExternalId));
}

async function main() {
  const externalPostId = unique("PAGE_POST");
  const rootCommentId = unique("COMMENT_ROOT");
  const replyCommentId = unique("COMMENT_REPLY");
  const authorExternalId = unique("USER_ASID");

  console.log("Smoke test — synthetic payload:");
  console.log("  post:", externalPostId);
  console.log("  root comment:", rootCommentId);
  console.log("  reply comment:", replyCommentId);
  console.log("  author:", authorExternalId);

  try {
    // ── Step 1: parse a Facebook feed webhook payload ─────────────────────────
    const payload = {
      object: "page",
      entry: [
        {
          id: "PAGE_ID_FAKE",
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: rootCommentId,
                post_id: externalPostId,
                parent_id: externalPostId,
                message: "¿Cuál es la dirección de la tienda?",
                from: { id: authorExternalId, name: "Ana Smoke" },
                created_time: Math.floor(Date.now() / 1000),
              },
            },
          ],
        },
      ],
    };

    const events = parseInboundCommentEvents(payload, { pageId: "PAGE_ID_FAKE" });
    assert(events.length === 1, `parser should emit 1 event, got ${events.length}`);
    assert(events[0].externalCommentId === rootCommentId, "parser should extract comment id");
    assert(events[0].externalPostId === externalPostId, "parser should extract post id");
    assert(events[0].parentExternalCommentId === null, "root comment should have no parent");
    console.log("✓ Step 1: parser extracts a root comment event");

    // ── Step 2: ingest the event ──────────────────────────────────────────────
    await ingestInboundComment(events[0], log);

    // ── Step 3: assert the post row was upserted ──────────────────────────────
    const [post] = await db
      .select()
      .from(feedPostsTable)
      .where(and(eq(feedPostsTable.channel, "facebook"), eq(feedPostsTable.externalPostId, externalPostId)));
    assert(post, "feed_posts row should exist");
    assert(post.channel === "facebook", "post.channel should be facebook");
    console.log(`✓ Step 2: feed_posts row created (id=${post.id})`);

    // ── Step 4: assert the contact row was upserted ───────────────────────────
    const [contact] = await db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.externalId, authorExternalId));
    assert(contact, "contact row should exist");
    assert(contact.name === "Ana Smoke", `contact.name should be "Ana Smoke", got "${contact.name}"`);
    assert(contact.channels?.includes("facebook"), "contact.channels should include facebook");
    console.log(`✓ Step 3: contact upserted (id=${contact.id})`);

    // ── Step 5: assert the thread row was created ─────────────────────────────
    const [thread] = await db
      .select()
      .from(feedThreadsTable)
      .where(
        and(
          eq(feedThreadsTable.postId, post.id),
          eq(feedThreadsTable.externalRootCommentId, rootCommentId),
        ),
      );
    assert(thread, "feed_threads row should exist");
    assert(thread.status === "open", "thread should be open");
    assert(thread.contactId === contact.id, "thread.contactId should point at the contact");
    assert(thread.channel === "facebook", "thread.channel should be facebook");
    assert(thread.unreadCount === 1, `thread.unreadCount should be 1, got ${thread.unreadCount}`);
    console.log(`✓ Step 4: feed_threads row created (id=${thread.id}, unread=${thread.unreadCount})`);

    // ── Step 6: assert the inbound comment row was inserted ───────────────────
    const comments = await db
      .select()
      .from(feedCommentsTable)
      .where(eq(feedCommentsTable.threadId, thread.id));
    assert(comments.length === 1, `should have 1 comment row, got ${comments.length}`);
    assert(comments[0].direction === "in", "comment.direction should be 'in'");
    assert(comments[0].externalCommentId === rootCommentId, "comment.externalCommentId should match");
    assert(comments[0].content.includes("dirección"), "comment.content should include the message text");
    console.log(`✓ Step 5: inbound feed_comments row inserted`);

    // ── Step 7: idempotency — ingest the SAME event again ─────────────────────
    await ingestInboundComment(events[0], log);
    const commentsAfterRetry = await db
      .select()
      .from(feedCommentsTable)
      .where(eq(feedCommentsTable.threadId, thread.id));
    assert(
      commentsAfterRetry.length === 1,
      `duplicate ingestion should be a no-op, but got ${commentsAfterRetry.length} rows`,
    );
    console.log("✓ Step 6: duplicate webhook is deduped (processed_events)");

    // ── Step 8: reply in the same thread reuses the thread row ────────────────
    const replyEvents = parseInboundCommentEvents({
      object: "page",
      entry: [
        {
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: replyCommentId,
                post_id: externalPostId,
                parent_id: rootCommentId, // → threads under the same root
                message: "gracias!",
                from: { id: authorExternalId, name: "Ana Smoke" },
              },
            },
          ],
        },
      ],
    });
    assert(replyEvents[0].rootExternalCommentId === rootCommentId, "reply should map to same root");
    await ingestInboundComment(replyEvents[0], log);

    const threadsAfterReply = await db.select().from(feedThreadsTable).where(eq(feedThreadsTable.id, thread.id));
    assert(threadsAfterReply.length === 1, "no new thread should be created for a reply under the same root");
    const commentsAfterReply = await db
      .select()
      .from(feedCommentsTable)
      .where(eq(feedCommentsTable.threadId, thread.id));
    assert(commentsAfterReply.length === 2, `should have 2 comments now, got ${commentsAfterReply.length}`);
    assert(
      threadsAfterReply[0].unreadCount === 2,
      `unreadCount should be 2 after reply, got ${threadsAfterReply[0].unreadCount}`,
    );
    console.log("✓ Step 7: reply reuses the same thread and bumps the counter");

    console.log("\n🎉 All feed ingestion checks passed.");
  } finally {
    await cleanup({
      externalPostId,
      externalCommentIds: [rootCommentId, replyCommentId],
      authorExternalId,
    });
    console.log("Cleanup: removed smoke test rows.");
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\n❌ Smoke test failed:", err);
  process.exitCode = 1;
  void pool.end();
});
