import { metaProfilePatch } from "./meta-contact-profile";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  feedPostsTable,
  feedThreadsTable,
  feedCommentsTable,
  contactsTable,
  labelsTable,
  agentsTable,
  capabilitiesTable,
  knowledgeBasesTable,
  contactFactsTable,
  conversationsTable,
  messagesTable,
  integrationSettingsTable,
  processedEventsTable,
  type FeedThread,
  type FeedComment,
  type Label,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  postPublicComment,
  sendPrivateReply,
  fetchPostMetadata,
  type InboundCommentEvent,
} from "./meta";
import {
  getOpenAIClient,
  buildSystemPrompt,
  classifyIntent,
  PHOTO_DIRECTIVE,
  IMAGE_DIRECTIVE,
  OPTIONS_DIRECTIVE,
  APPOINTMENT_DIRECTIVE,
} from "./openai-client";
import type { Log } from "./messaging";

async function loadSettings() {
  const [row] = await db
    .select()
    .from(integrationSettingsTable)
    .orderBy(integrationSettingsTable.id)
    .limit(1);
  return row ?? null;
}

// Same claim-then-process pattern as inbound DMs: Meta retries feed webhooks
// and the backend runs several instances. The comment id is unique per channel,
// so it makes a good idempotency key.
async function claimCommentEvent(id: string): Promise<boolean> {
  const inserted = await db
    .insert(processedEventsTable)
    .values({ eventId: `feed:${id}` })
    .onConflictDoNothing({ target: processedEventsTable.eventId })
    .returning({ id: processedEventsTable.id });
  return inserted.length > 0;
}

async function pickVirtualAgentForChannel(channel: string) {
  const candidates = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.type, "virtual"), eq(agentsTable.isActive, true)))
    .orderBy(agentsTable.id);
  return (
    candidates.find((a) => (a.channels ?? []).length === 0 || (a.channels ?? []).includes(channel)) ??
    null
  );
}

// Upserts the post row for a comment. Metadata (caption, permalink, thumbnail)
// is fetched from the Graph API only the first time we see a post — subsequent
// comments reuse the cached row.
async function upsertFeedPost(
  channel: "facebook" | "instagram",
  externalPostId: string,
  log: Log,
): Promise<number> {
  const [existing] = await db
    .select()
    .from(feedPostsTable)
    .where(and(eq(feedPostsTable.channel, channel), eq(feedPostsTable.externalPostId, externalPostId)));
  if (existing) return existing.id;

  const settings = await loadSettings();
  const meta = settings ? await fetchPostMetadata(settings, channel, externalPostId) : null;
  const [row] = await db
    .insert(feedPostsTable)
    .values({
      channel,
      externalPostId,
      caption: meta?.caption ?? null,
      permalink: meta?.permalink ?? null,
      mediaUrl: meta?.mediaUrl ?? null,
    })
    .returning();
  log.info({ postId: row.id, channel, externalPostId }, "feed post cached");
  return row.id;
}

// Contacts from feed comments are keyed by the customer's ASID (FB) / IG user id.
// That id is DIFFERENT from the PSID/IGSID used for DMs, so we keep the two
// contact records separate — the migrate-to-DM flow creates or reuses a
// DM-scoped contact when the Private Reply resolves to a real recipient id.
async function upsertFeedContact(
  channel: "facebook" | "instagram",
  authorExternalId: string,
  authorName: string | null,
): Promise<number> {
  const [existing] = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.externalId, authorExternalId));
  const identity = metaProfilePatch(existing ?? null, channel, {
    name: channel === "facebook" ? authorName : null,
    username: channel === "instagram" ? authorName : null,
    pictureUrl: null,
  });
  if (existing) {
    if (Object.keys(identity).length) await db.update(contactsTable).set(identity)
      .where(and(eq(contactsTable.id, existing.id), eq(contactsTable.name, existing.name)));
    return existing.id;
  }
  const [row] = await db
    .insert(contactsTable)
    .values({
      ...identity,
      name: identity.name ?? authorName ?? `Comentario ${authorExternalId.slice(-4)}`,
      externalId: authorExternalId,
      channels: [channel],
    })
    .returning();
  return row.id;
}

async function findOrCreateThread(
  channel: "facebook" | "instagram",
  postId: number,
  rootExternalCommentId: string,
  contactId: number | null,
  log: Log,
): Promise<FeedThread> {
  const [existing] = await db
    .select()
    .from(feedThreadsTable)
    .where(
      and(
        eq(feedThreadsTable.postId, postId),
        eq(feedThreadsTable.externalRootCommentId, rootExternalCommentId),
      ),
    );
  if (existing) return existing;

  const agent = await pickVirtualAgentForChannel(channel);
  const [row] = await db
    .insert(feedThreadsTable)
    .values({
      channel,
      postId,
      externalRootCommentId: rootExternalCommentId,
      contactId,
      agentId: agent?.id ?? null,
      status: "open",
    })
    .returning();
  log.info({ threadId: row.id, postId, rootExternalCommentId }, "feed thread opened");
  return row;
}

// ── Reply generation ──────────────────────────────────────────────────────────

export async function collectAgentContext(agentId: number) {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) return null;
  const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.agentId, agentId));
  const kbIds = [...new Set(caps.map((c) => c.knowledgeBaseId).filter((x): x is number => x != null))];
  const kbs = kbIds.length
    ? await db.select().from(knowledgeBasesTable).where(inArray(knowledgeBasesTable.id, kbIds))
    : [];
  return { agent, caps, kbs };
}

// Builds a compact "conversation" for the AI from the comment thread: the
// customer's public comment + any prior replies in this same thread. Comments
// don't have the same session lifecycle as DMs — the whole thread is a single
// exchange, so we send it all.
async function buildThreadHistoryText(threadId: number): Promise<string> {
  const rows = await db
    .select()
    .from(feedCommentsTable)
    .where(eq(feedCommentsTable.threadId, threadId))
    .orderBy(feedCommentsTable.createdAt);
  return rows
    .filter((r) => !r.isInternal)
    .map((r) => `${r.direction === "in" ? "Cliente" : "Agente"}: ${r.content}`)
    .join("\n");
}

// Produces an AI-generated reply for the given thread. Returns null when the
// thread has no assigned agent or the AI is unavailable. Callers decide whether
// to auto-publish or store as a draft.
async function generateReplyText(thread: FeedThread, log: Log): Promise<string | null> {
  if (!thread.agentId) return null;
  const client = getOpenAIClient();
  if (!client) {
    log.info({ threadId: thread.id }, "feed reply skipped: OpenAI not configured");
    return null;
  }
  const ctx = await collectAgentContext(thread.agentId);
  if (!ctx) return null;
  const { agent, caps, kbs } = ctx;

  const contact = thread.contactId
    ? (await db.select().from(contactsTable).where(eq(contactsTable.id, thread.contactId)))[0] ?? null
    : null;
  const facts = contact
    ? await db.select().from(contactFactsTable).where(eq(contactFactsTable.contactId, contact.id))
    : [];

  const systemPrompt = buildSystemPrompt({
    agentName: agent.name,
    profileType: agent.profileType,
    customPrompt: agent.systemPrompt,
    capabilities: caps.map((c) => ({
      name: c.name,
      description: c.description,
      category: c.category,
      examples: c.examples,
      level: c.level,
    })),
    knowledge: kbs.filter((k) => k.content?.trim()).map((k) => ({ name: k.name, content: k.content })),
    contactContext: contact ? `Comentario en publicación de ${thread.channel}.` : null,
  });

  const commentContext =
    "IMPORTANTE: este mensaje llega como comentario PÚBLICO en una publicación de " +
    (thread.channel === "instagram" ? "Instagram" : "Facebook") +
    ". Cualquier respuesta será visible por todos. Responde en 1-2 oraciones cordiales, sin datos personales del cliente, y sin promesas específicas que no puedas cumplir. Si el cliente pide soporte o algo delicado, invítale a continuar por mensaje privado.";

  const history = await buildThreadHistoryText(thread.id);

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 512,
      messages: [
        { role: "system", content: `${systemPrompt}\n\n${commentContext}` },
        { role: "user", content: history },
      ],
    });
    // Un comentario público no adjunta fotos, imágenes, botones ni citas: las marcas
    // que el prompt común le enseña al agente se quitan antes de que alguien las lea.
    const raw = completion.choices[0]?.message?.content
      ?.replace(PHOTO_DIRECTIVE, "")
      .replace(IMAGE_DIRECTIVE, "")
      .replace(OPTIONS_DIRECTIVE, "")
      .replace(APPOINTMENT_DIRECTIVE, "")
      .trim();
    return raw && raw.length > 0 ? raw : null;
  } catch (err) {
    log.error({ err, threadId: thread.id }, "feed reply generation failed");
    return null;
  }
}

// ── Classification ────────────────────────────────────────────────────────────

async function classifyThread(thread: FeedThread, text: string): Promise<Label | null> {
  const labels = await db.select().from(labelsTable).where(eq(labelsTable.isActive, true));
  if (labels.length === 0) return null;
  const picked = await classifyIntent({
    message: text,
    labels: labels.map((l) => ({ id: l.id, name: l.name, description: l.description })),
  });
  if (!picked) return null;
  return labels.find((l) => l.id === picked) ?? null;
}

// ── Publication ───────────────────────────────────────────────────────────────

// Publishes an outbound comment row that was created as a draft (or freshly
// generated by auto-reply). Sends the public reply and, when `alsoPrivate` is
// true, also queues a Private Reply that opens a DM with the commenter. Both
// legs are recorded in the comments table so the panel shows the full trail.
export async function publishFeedComment(
  commentDbId: number,
  opts: { alsoPrivate?: boolean; privateText?: string | null },
  log: Log,
): Promise<{ ok: boolean; error?: string; publishedCommentId?: number; privateReplyRecipient?: string }> {
  const [row] = await db.select().from(feedCommentsTable).where(eq(feedCommentsTable.id, commentDbId));
  if (!row) return { ok: false, error: "Comentario no encontrado." };
  if (!row.isDraft && row.delivery !== "none") {
    return { ok: false, error: "Este comentario ya fue publicado." };
  }
  const [thread] = await db.select().from(feedThreadsTable).where(eq(feedThreadsTable.id, row.threadId));
  if (!thread) return { ok: false, error: "Hilo no encontrado." };
  const settings = await loadSettings();
  if (!settings) return { ok: false, error: "Faltan credenciales de Meta." };

  // Public reply targets the LAST inbound comment of the thread so the reply
  // appears next to what the customer wrote. Meta's reply hierarchy is flat
  // (all replies live at depth 1), so this only affects the notification.
  const [lastInbound] = await db
    .select()
    .from(feedCommentsTable)
    .where(and(eq(feedCommentsTable.threadId, thread.id), eq(feedCommentsTable.direction, "in")))
    .orderBy(desc(feedCommentsTable.createdAt))
    .limit(1);
  const targetCommentId = lastInbound?.externalCommentId ?? thread.externalRootCommentId;

  const publicRes = await postPublicComment(
    settings,
    thread.channel as "facebook" | "instagram",
    targetCommentId,
    row.content,
  );
  if (!publicRes.ok) {
    log.error({ commentDbId, error: publicRes.error }, "feed public reply failed");
    return { ok: false, error: publicRes.error ?? "Meta rechazó la respuesta pública." };
  }

  const publishedId = typeof publicRes.data?.id === "string" ? (publicRes.data.id as string) : null;
  await db
    .update(feedCommentsTable)
    .set({
      isDraft: false,
      delivery: "public_reply",
      externalCommentId: publishedId,
      parentExternalCommentId: targetCommentId,
      publishedAt: new Date(),
    })
    .where(eq(feedCommentsTable.id, commentDbId));

  await db
    .update(feedThreadsTable)
    .set({ lastCommentAt: new Date(), lastComment: row.content, updatedAt: new Date() })
    .where(eq(feedThreadsTable.id, thread.id));

  let privateRecipient: string | undefined;
  if (opts.alsoPrivate) {
    const privateText = opts.privateText?.trim() || row.content;
    const priv = await sendPrivateReply(
      settings,
      thread.channel as "facebook" | "instagram",
      targetCommentId,
      privateText,
    );
    if (priv.ok) {
      privateRecipient = typeof priv.data?.recipient_id === "string" ? (priv.data.recipient_id as string) : undefined;
      await db.insert(feedCommentsTable).values({
        threadId: thread.id,
        direction: "out",
        delivery: "private_reply",
        authorName: row.authorName,
        authorAgentId: row.authorAgentId,
        content: privateText,
        isDraft: false,
        isAiSuggestion: row.isAiSuggestion,
        publishedAt: new Date(),
      });
    } else {
      log.error({ commentDbId, error: priv.error }, "private reply after public failed");
    }
  }

  return {
    ok: true,
    publishedCommentId: commentDbId,
    privateReplyRecipient: privateRecipient,
  };
}

// ── Migration to DM ───────────────────────────────────────────────────────────

// Converts a comment thread into a DM conversation. Sends a Private Reply that
// carries the first message of the DM; Meta returns the resolved PSID/IGSID we
// need to bind the conversation to. Marks the thread as `migrated` and links
// it to the new DM conversation so the panel can jump between them.
export async function migrateThreadToDm(
  threadId: number,
  opts: { message: string; agentIdForReply?: number | null },
  log: Log,
): Promise<{ ok: boolean; error?: string; conversationId?: number }> {
  const [thread] = await db.select().from(feedThreadsTable).where(eq(feedThreadsTable.id, threadId));
  if (!thread) return { ok: false, error: "Hilo no encontrado." };
  if (thread.status === "migrated" && thread.migratedConversationId) {
    return { ok: true, conversationId: thread.migratedConversationId };
  }
  const settings = await loadSettings();
  if (!settings) return { ok: false, error: "Faltan credenciales de Meta." };

  // Meta only accepts one Private Reply per comment, within 7 days of when it
  // was posted. We target the LAST inbound comment so the migration attaches to
  // the customer's most recent turn.
  const [lastInbound] = await db
    .select()
    .from(feedCommentsTable)
    .where(and(eq(feedCommentsTable.threadId, thread.id), eq(feedCommentsTable.direction, "in")))
    .orderBy(desc(feedCommentsTable.createdAt))
    .limit(1);
  const targetCommentId = lastInbound?.externalCommentId ?? thread.externalRootCommentId;

  const text = opts.message.trim();
  if (!text) return { ok: false, error: "El mensaje inicial del privado no puede estar vacío." };

  const res = await sendPrivateReply(
    settings,
    thread.channel as "facebook" | "instagram",
    targetCommentId,
    text,
  );
  if (!res.ok) {
    log.error({ threadId, error: res.error }, "migrate to DM failed");
    return { ok: false, error: res.error ?? "Meta rechazó la migración a privado." };
  }

  // recipient_id is the PSID (FB) / IGSID (IG) usable with the DM Send API.
  // Without it we still record the migration but the resulting conversation
  // will have no externalId and won't be able to send outbound DMs until the
  // customer answers (which will give us their PSID via the DM webhook).
  const recipientId = typeof res.data?.recipient_id === "string" ? (res.data.recipient_id as string) : null;

  // Reuse or create a DM-scoped contact bound to the resolved PSID/IGSID.
  let dmContactId: number | null = null;
  if (recipientId) {
    const [existing] = await db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.externalId, recipientId));
    if (existing) {
      dmContactId = existing.id;
    } else {
      const [feedContact] = thread.contactId
        ? await db.select().from(contactsTable).where(eq(contactsTable.id, thread.contactId))
        : [null];
      const [inserted] = await db
        .insert(contactsTable)
        .values({
          name: feedContact?.name ?? `Cliente ${recipientId.slice(-4)}`,
          externalId: recipientId,
          channels: [thread.channel],
        })
        .returning();
      dmContactId = inserted.id;
    }
  } else {
    dmContactId = thread.contactId;
  }

  const agent = thread.agentId
    ? (await db.select().from(agentsTable).where(eq(agentsTable.id, thread.agentId)))[0] ?? null
    : null;

  const [conv] = await db
    .insert(conversationsTable)
    .values({
      channel: thread.channel,
      contactId: dmContactId ?? 0,
      agentId: agent?.id ?? null,
      externalId: recipientId,
      status: "open",
      lastMessage: text,
    })
    .returning();

  // First outbound message on the new conversation is the Private Reply we
  // just sent. Store it so the DM view is not empty.
  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: agent?.type === "virtual" ? "bot" : "agent",
    content: text,
    type: "text",
    isAiSuggestion: false,
  });

  await db
    .update(feedThreadsTable)
    .set({
      status: "migrated",
      migratedConversationId: conv.id,
      updatedAt: new Date(),
    })
    .where(eq(feedThreadsTable.id, thread.id));

  await db.insert(feedCommentsTable).values({
    threadId: thread.id,
    direction: "out",
    delivery: "private_reply",
    authorAgentId: opts.agentIdForReply ?? agent?.id ?? null,
    authorName: agent?.name ?? null,
    content: text,
    isDraft: false,
    isAiSuggestion: false,
    publishedAt: new Date(),
  });

  await db.insert(feedCommentsTable).values({
    threadId: thread.id,
    direction: "out",
    delivery: "none",
    content: `🔀 Migrado a chat privado (conversación #${conv.id}).`,
    isInternal: true,
    isDraft: false,
  });

  log.info({ threadId, conversationId: conv.id, hasPsid: !!recipientId }, "feed thread migrated to DM");
  return { ok: true, conversationId: conv.id };
}

// ── Inbound ingestion ─────────────────────────────────────────────────────────

export async function ingestInboundComment(ev: InboundCommentEvent, log: Log): Promise<void> {
  if (!(await claimCommentEvent(ev.externalCommentId))) {
    log.info({ commentId: ev.externalCommentId }, "feed comment deduped");
    return;
  }

  const postDbId = await upsertFeedPost(ev.channel, ev.externalPostId, log);
  const contactId = await upsertFeedContact(ev.channel, ev.authorExternalId, ev.authorName);
  const thread = await findOrCreateThread(ev.channel, postDbId, ev.rootExternalCommentId, contactId, log);

  // Migrated threads stop receiving auto-replies in the Feed view — the
  // conversation continues in the DM. We still record the new comment so the
  // panel shows the full public trail.
  const insertedComment = await db
    .insert(feedCommentsTable)
    .values({
      threadId: thread.id,
      externalCommentId: ev.externalCommentId,
      parentExternalCommentId: ev.parentExternalCommentId,
      direction: "in",
      delivery: "none",
      authorName: ev.authorName,
      content: ev.text,
      isDraft: false,
      isAiSuggestion: false,
    })
    .returning();

  const [commentRow] = insertedComment;
  await db
    .update(feedThreadsTable)
    .set({
      lastCommentAt: commentRow.createdAt,
      lastComment: ev.text,
      unreadCount: (thread.unreadCount ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(feedThreadsTable.id, thread.id));

  if (thread.status !== "open") {
    log.info({ threadId: thread.id, status: thread.status }, "feed comment ingested (thread not open, skipping auto-reply)");
    return;
  }

  // Classify the intent and decide what to do with it.
  const label = await classifyThread(thread, ev.text);
  if (label) {
    await db
      .update(feedThreadsTable)
      .set({ labelId: label.id, updatedAt: new Date() })
      .where(eq(feedThreadsTable.id, thread.id));
  }

  // Auto-migrate to DM when the label is flagged as needing private handling
  // (e.g. "soporte", "reclamo"). The comment stays public but the substantive
  // reply is delivered privately.
  if (label?.autoMigrateToDm) {
    const draft = await generateReplyText(thread, log);
    const publicNote =
      "Te escribimos por mensaje privado para ayudarte con esto. 🙌";
    await publishFeedComment(
      (
        await db
          .insert(feedCommentsTable)
          .values({
            threadId: thread.id,
            direction: "out",
            delivery: "none",
            authorAgentId: thread.agentId ?? null,
            content: publicNote,
            isDraft: true,
            isAiSuggestion: true,
          })
          .returning()
      )[0].id,
      { alsoPrivate: false },
      log,
    );
    await migrateThreadToDm(
      thread.id,
      { message: draft ?? "Hola, seguimos por aquí para ayudarte. ¿Podrías contarnos un poco más?" },
      log,
    );
    return;
  }

  // Generate a suggested reply. If the intent is safe, publish it right away
  // (public + Private Reply carrying the same detail). Otherwise leave it as a
  // draft for a human to approve.
  const draftText = await generateReplyText(thread, log);
  if (!draftText) {
    log.info({ threadId: thread.id }, "feed comment ingested (no reply generated)");
    return;
  }

  const [draftRow] = await db
    .insert(feedCommentsTable)
    .values({
      threadId: thread.id,
      direction: "out",
      delivery: "none",
      authorAgentId: thread.agentId ?? null,
      content: draftText,
      isDraft: true,
      isAiSuggestion: true,
    })
    .returning();

  const isSafe = !!label?.isSafeForAutoReply;
  if (isSafe) {
    // Combined mode per product spec: public brief + private reply with detail.
    await publishFeedComment(draftRow.id, { alsoPrivate: true, privateText: draftText }, log);
    log.info({ threadId: thread.id, labelId: label?.id }, "feed comment auto-replied (safe intent)");
  } else {
    log.info(
      { threadId: thread.id, labelId: label?.id ?? null },
      "feed comment draft stored for human approval",
    );
  }
}

// ── Convenience for routes ────────────────────────────────────────────────────

// Regenerates the AI draft for a thread on demand (used by the panel's
// "regenerar" button). Returns the new draft row without publishing.
export async function regenerateDraftForThread(
  threadId: number,
  log: Log,
): Promise<FeedComment | null> {
  const [thread] = await db.select().from(feedThreadsTable).where(eq(feedThreadsTable.id, threadId));
  if (!thread) return null;
  const text = await generateReplyText(thread, log);
  if (!text) return null;
  const [row] = await db
    .insert(feedCommentsTable)
    .values({
      threadId,
      direction: "out",
      delivery: "none",
      authorAgentId: thread.agentId ?? null,
      content: text,
      isDraft: true,
      isAiSuggestion: true,
    })
    .returning();
  return row;
}
