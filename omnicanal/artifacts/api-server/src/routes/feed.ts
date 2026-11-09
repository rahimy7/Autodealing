import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  feedPostsTable,
  feedThreadsTable,
  feedCommentsTable,
  contactsTable,
  agentsTable,
  labelsTable,
} from "@workspace/db";
import { publishFeedComment, migrateThreadToDm, regenerateDraftForThread } from "../lib/feed";
import { requireView } from "../middlewares/auth";

const router: IRouter = Router();

const ListQuery = z.object({
  channel: z.enum(["facebook", "instagram", "all"]).optional(),
  status: z.enum(["open", "resolved", "migrated", "all"]).optional(),
});

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const CommentIdParams = z.object({ commentId: z.coerce.number().int().positive() });

const ReplyBody = z.object({
  content: z.string().trim().min(1).max(2000),
  mode: z.enum(["public_only", "private_only", "both"]).default("both"),
  privateText: z.string().trim().max(2000).optional(),
});

const MigrateBody = z.object({
  message: z.string().trim().min(1).max(2000),
});

async function buildThread(threadRow: typeof feedThreadsTable.$inferSelect) {
  const [post] = await db.select().from(feedPostsTable).where(eq(feedPostsTable.id, threadRow.postId));
  const [contact] = threadRow.contactId
    ? await db.select().from(contactsTable).where(eq(contactsTable.id, threadRow.contactId))
    : [null];
  const [agent] = threadRow.agentId
    ? await db.select().from(agentsTable).where(eq(agentsTable.id, threadRow.agentId))
    : [null];
  const [label] = threadRow.labelId
    ? await db.select().from(labelsTable).where(eq(labelsTable.id, threadRow.labelId))
    : [null];
  return {
    ...threadRow,
    post: post
      ? {
          id: post.id,
          channel: post.channel,
          externalPostId: post.externalPostId,
          caption: post.caption,
          permalink: post.permalink,
          mediaUrl: post.mediaUrl,
        }
      : null,
    contactName: contact?.name ?? null,
    contactAvatar: contact?.avatar ?? null,
    agentName: agent?.name ?? null,
    labelName: label?.name ?? null,
    labelColor: label?.color ?? null,
  };
}

// GET /feed/threads — list threads for the inbox view.
router.get("/feed/threads", requireView("feed"), async (req, res): Promise<void> => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { channel, status } = parsed.data;

  let rows = await db.select().from(feedThreadsTable).orderBy(desc(feedThreadsTable.lastCommentAt));
  if (channel && channel !== "all") rows = rows.filter((r) => r.channel === channel);
  if (status && status !== "all") rows = rows.filter((r) => r.status === status);

  const enriched = await Promise.all(rows.map(buildThread));
  res.json({ threads: enriched });
});

// GET /feed/threads/:id — thread detail with its comments.
router.get("/feed/threads/:id", requireView("feed"), async (req, res): Promise<void> => {
  const parsed = IdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.select().from(feedThreadsTable).where(eq(feedThreadsTable.id, parsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Hilo no encontrado" });
    return;
  }
  const comments = await db
    .select()
    .from(feedCommentsTable)
    .where(eq(feedCommentsTable.threadId, row.id))
    .orderBy(feedCommentsTable.createdAt);
  const agentIds = [
    ...new Set(comments.map((c) => c.authorAgentId).filter((x): x is number => x != null)),
  ];
  const agents = agentIds.length
    ? await db.select().from(agentsTable).where(inArray(agentsTable.id, agentIds))
    : [];
  const agentById = new Map(agents.map((a) => [a.id, a] as const));

  res.json({
    thread: await buildThread(row),
    comments: comments.map((c) => ({
      ...c,
      authorAgentName: c.authorAgentId ? agentById.get(c.authorAgentId)?.name ?? null : null,
    })),
  });
});

// POST /feed/threads/:id/read — clear unread badge.
router.post("/feed/threads/:id/read", requireView("feed"), async (req, res): Promise<void> => {
  const parsed = IdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db
    .update(feedThreadsTable)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(eq(feedThreadsTable.id, parsed.data.id));
  res.json({ ok: true });
});

// POST /feed/threads/:id/reply — human-written or AI-approved reply.
// Publishes immediately (skips the draft state); use PATCH .../comments/:cid/publish
// to approve a pre-existing draft instead.
router.post("/feed/threads/:id/reply", requireView("feed"), async (req, res): Promise<void> => {
  const idParsed = IdParams.safeParse(req.params);
  const bodyParsed = ReplyBody.safeParse(req.body);
  if (!idParsed.success || !bodyParsed.success) {
    res.status(400).json({ error: (idParsed.error ?? bodyParsed.error)?.message });
    return;
  }
  const [thread] = await db.select().from(feedThreadsTable).where(eq(feedThreadsTable.id, idParsed.data.id));
  if (!thread) {
    res.status(404).json({ error: "Hilo no encontrado" });
    return;
  }
  const { content, mode, privateText } = bodyParsed.data;

  // Insert the comment first (as a non-draft), then publish it. The insert
  // captures the author's message in the DB even if Meta rejects the send.
  const [row] = await db
    .insert(feedCommentsTable)
    .values({
      threadId: thread.id,
      direction: "out",
      delivery: "none",
      authorAgentId: thread.agentId ?? null,
      content,
      isDraft: false,
      isAiSuggestion: false,
    })
    .returning();

  if (mode === "private_only") {
    // Skip the public reply path; treat as a migrated exchange kept in-place.
    const result = await migrateThreadToDm(thread.id, { message: content }, req.log);
    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.json({ ok: true, mode, migratedConversationId: result.conversationId });
    return;
  }

  const alsoPrivate = mode === "both";
  const result = await publishFeedComment(
    row.id,
    { alsoPrivate, privateText: privateText ?? content },
    req.log,
  );
  if (!result.ok) {
    res.status(502).json({ error: result.error });
    return;
  }
  res.json({ ok: true, mode, commentId: row.id, privateRecipient: result.privateReplyRecipient });
});

// POST /feed/comments/:commentId/publish — approve an AI-generated draft.
router.post("/feed/comments/:commentId/publish", requireView("feed"), async (req, res): Promise<void> => {
  const parsed = CommentIdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const bodyParsed = z
    .object({
      alsoPrivate: z.boolean().optional().default(true),
      privateText: z.string().trim().max(2000).optional(),
    })
    .safeParse(req.body ?? {});
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  const result = await publishFeedComment(
    parsed.data.commentId,
    { alsoPrivate: bodyParsed.data.alsoPrivate, privateText: bodyParsed.data.privateText ?? null },
    req.log,
  );
  if (!result.ok) {
    res.status(502).json({ error: result.error });
    return;
  }
  res.json({ ok: true, privateRecipient: result.privateReplyRecipient });
});

// POST /feed/comments/:commentId/regenerate — replace the draft's content with
// a freshly generated AI suggestion. Kept as a separate POST to keep the flow
// idempotent from the client's perspective.
router.post("/feed/comments/:commentId/regenerate", requireView("feed"), async (req, res): Promise<void> => {
  const parsed = CommentIdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(feedCommentsTable)
    .where(eq(feedCommentsTable.id, parsed.data.commentId));
  if (!existing) {
    res.status(404).json({ error: "Borrador no encontrado" });
    return;
  }
  if (!existing.isDraft) {
    res.status(409).json({ error: "Solo los borradores pueden regenerarse" });
    return;
  }
  const fresh = await regenerateDraftForThread(existing.threadId, req.log);
  if (!fresh) {
    res.status(502).json({ error: "La IA no pudo generar una respuesta." });
    return;
  }
  // Discard the old draft to keep the panel clean.
  await db.delete(feedCommentsTable).where(eq(feedCommentsTable.id, existing.id));
  res.json({ ok: true, comment: fresh });
});

// DELETE /feed/comments/:commentId — discard a draft that a human decided not
// to send. Non-drafts cannot be deleted (they are the historical trail).
router.delete("/feed/comments/:commentId", requireView("feed"), async (req, res): Promise<void> => {
  const parsed = CommentIdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.select().from(feedCommentsTable).where(eq(feedCommentsTable.id, parsed.data.commentId));
  if (!row) {
    res.status(404).json({ error: "Borrador no encontrado" });
    return;
  }
  if (!row.isDraft) {
    res.status(409).json({ error: "Solo pueden eliminarse borradores." });
    return;
  }
  await db.delete(feedCommentsTable).where(eq(feedCommentsTable.id, row.id));
  res.json({ ok: true });
});

// POST /feed/threads/:id/migrate — send the Private Reply and open a DM.
router.post("/feed/threads/:id/migrate", requireView("feed"), async (req, res): Promise<void> => {
  const idParsed = IdParams.safeParse(req.params);
  const bodyParsed = MigrateBody.safeParse(req.body);
  if (!idParsed.success || !bodyParsed.success) {
    res.status(400).json({ error: (idParsed.error ?? bodyParsed.error)?.message });
    return;
  }
  const result = await migrateThreadToDm(
    idParsed.data.id,
    { message: bodyParsed.data.message },
    req.log,
  );
  if (!result.ok) {
    res.status(502).json({ error: result.error });
    return;
  }
  res.json({ ok: true, conversationId: result.conversationId });
});

// POST /feed/threads/:id/resolve — mark a thread as done. Follow-up comments
// still get ingested but the auto-reply flow skips them.
router.post("/feed/threads/:id/resolve", requireView("feed"), async (req, res): Promise<void> => {
  const parsed = IdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(feedThreadsTable)
    .set({ status: "resolved", unreadCount: 0, updatedAt: new Date() })
    .where(and(eq(feedThreadsTable.id, parsed.data.id), eq(feedThreadsTable.status, "open")))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Hilo no encontrado o ya cerrado" });
    return;
  }
  res.json({ ok: true, thread: row });
});

// POST /feed/threads/:id/reopen — reopen a resolved thread.
router.post("/feed/threads/:id/reopen", requireView("feed"), async (req, res): Promise<void> => {
  const parsed = IdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(feedThreadsTable)
    .set({ status: "open", updatedAt: new Date() })
    .where(and(eq(feedThreadsTable.id, parsed.data.id), eq(feedThreadsTable.status, "resolved")))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Hilo no encontrado o ya está abierto" });
    return;
  }
  res.json({ ok: true, thread: row });
});

export default router;
