import express, { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  integrationSettingsTable,
  emailThreadsTable,
  emailMessagesTable,
  contactsTable,
  agentsTable,
  labelsTable,
  type EmailThread,
  type IntegrationSettings,
} from "@workspace/db";
import {
  GetGmailSettingsResponse,
  UpdateGmailSettingsBody,
  UpdateGmailSettingsResponse,
  ConnectGmailBody,
  DisconnectGmailResponse,
  SyncGmailNowResponse,
  ImportGmailInboxResponse,
  ListEmailThreadsQueryParams,
  GetEmailThreadParams,
  MarkEmailThreadReadParams,
  ReplyEmailThreadParams,
  ReplyEmailThreadBody,
  GenerateEmailDraftParams,
  ResolveEmailThreadParams,
  ReopenEmailThreadParams,
  ListEmailContactCandidatesQueryParams,
  LinkEmailThreadContactParams,
  LinkEmailThreadContactBody,
  SendEmailDraftParams,
  SendEmailDraftBody,
  DeleteEmailDraftParams,
  ComposeEmailBody,
} from "@workspace/api-zod";
import { signPayload } from "../lib/auth";
import { stripQuotedReply } from "../lib/email-format";
import * as gmail from "../lib/gmail";
import {
  composeNewEmail,
  contactCandidatesForThread,
  createAiDraft,
  discardStagedAttachment,
  fetchEmailAttachment,
  importFullInbox,
  isImportingInbox,
  linkThreadToContact,
  loadGmailSettings,
  markEmailThreadRead,
  MAX_EMAIL_ATTACHMENT_BYTES,
  sendEmailReply,
  stageEmailAttachment,
  syncGmail,
} from "../lib/email";
import { GMAIL_OAUTH_PURPOSE, GMAIL_OAUTH_CALLBACK_PATH } from "./gmail-oauth";
import { caseCode, openCasesByEmailThreadIds } from "../lib/cases";
import type { Case } from "@workspace/db";
import { isModuleEnabled } from "../lib/client-config";

const router: IRouter = Router();

// ── Ajustes de Gmail ──────────────────────────────────────────────────────────

async function getOrCreateSettings(): Promise<IntegrationSettings> {
  const existing = await loadGmailSettings();
  if (existing) return existing;
  const [created] = await db.insert(integrationSettingsTable).values({}).returning();
  return created;
}

function maskPreview(value: string | null): string | null {
  if (!value) return null;
  const tail = value.slice(-4);
  return `${tail.length === 4 ? `••••${tail}` : "••••"} · ${value.length} car.`;
}

function serializeGmail(row: IntegrationSettings) {
  return {
    enabled: row.gmailEnabled,
    clientId: row.gmailClientId,
    clientSecretSet: Boolean(row.gmailClientSecret),
    clientSecretPreview: maskPreview(row.gmailClientSecret),
    connected: Boolean(row.gmailRefreshToken),
    emailAddress: row.gmailEmailAddress,
    fromName: row.gmailFromName,
    signature: row.gmailSignature,
    autoReply: row.gmailAutoReply,
    initialImportDone: Boolean(row.gmailHistoryId),
    lastSyncAt: row.gmailLastSyncAt,
    lastError: row.gmailLastError,
    importingInbox: isImportingInbox(),
  };
}

router.get("/settings/gmail", async (_req, res): Promise<void> => {
  res.json(GetGmailSettingsResponse.parse(serializeGmail(await getOrCreateSettings())));
});

router.put("/settings/gmail", async (req, res): Promise<void> => {
  const parsed = UpdateGmailSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const row = await getOrCreateSettings();
  const body = parsed.data;
  const update: Partial<typeof integrationSettingsTable.$inferInsert> = { updatedAt: new Date() };
  const text = (v: string | null | undefined) => (v === null || v?.trim() === "" ? null : v?.trim());

  if (body.enabled !== undefined) update.gmailEnabled = body.enabled;
  if (body.autoReply !== undefined) update.gmailAutoReply = body.autoReply;
  if (body.fromName !== undefined) update.gmailFromName = text(body.fromName);
  if (body.signature !== undefined) update.gmailSignature = body.signature?.trim() ? body.signature.trim() : null;
  if (body.clientId !== undefined) {
    update.gmailClientId = text(body.clientId);
    // Otro cliente OAuth invalida el refresh token emitido para el anterior: la
    // cuenta hay que volver a conectarla.
    if (update.gmailClientId !== row.gmailClientId && row.gmailRefreshToken) {
      update.gmailRefreshToken = null;
      update.gmailHistoryId = null;
    }
  }
  // Un secreto vacío significa "deja el que está", igual que con Meta.
  if (typeof body.clientSecret === "string" && body.clientSecret.trim() !== "") {
    update.gmailClientSecret = body.clientSecret.trim();
  }

  const [saved] = await db
    .update(integrationSettingsTable)
    .set(update)
    .where(eq(integrationSettingsTable.id, row.id))
    .returning();
  res.json(UpdateGmailSettingsResponse.parse(serializeGmail(saved)));
});

router.post("/settings/gmail/connect", async (req, res): Promise<void> => {
  const parsed = ConnectGmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const row = await getOrCreateSettings();
  if (!row.gmailClientId || !row.gmailClientSecret) {
    res.status(400).json({ error: "Guarda primero el Client ID y el Client Secret de Google." });
    return;
  }

  let redirect: URL;
  let returnTo: URL;
  try {
    redirect = new URL(parsed.data.redirectUri);
    returnTo = new URL(parsed.data.returnUrl);
  } catch {
    res.status(400).json({ error: "URL inválida." });
    return;
  }
  // La vuelta del navegador solo puede ir al mismo panel: el state está firmado,
  // pero sin esto un enlace preparado serviría de redirección abierta. El panel
  // puede vivir bajo una ruta (el sitio de Premier lo publica en /omnicanal), así
  // que se compara el final de la ruta y el origen.
  if (!redirect.pathname.endsWith(`/api${GMAIL_OAUTH_CALLBACK_PATH}`) || redirect.origin !== returnTo.origin) {
    res.status(400).json({ error: "La URL de retorno no corresponde a este panel." });
    return;
  }

  const state = signPayload(
    GMAIL_OAUTH_PURPOSE,
    { redirectUri: redirect.toString(), returnUrl: returnTo.toString() },
    15 * 60,
  );
  res.json({ url: gmail.buildGoogleAuthUrl({ clientId: row.gmailClientId, redirectUri: redirect.toString(), state }) });
});

router.post("/settings/gmail/disconnect", async (req, res): Promise<void> => {
  const row = await getOrCreateSettings();
  if (row.gmailRefreshToken) {
    gmail.forgetAccessToken(row.gmailRefreshToken);
    await gmail.revokeToken(row.gmailRefreshToken);
  }
  const [saved] = await db
    .update(integrationSettingsTable)
    .set({
      gmailRefreshToken: null,
      gmailEmailAddress: null,
      gmailHistoryId: null,
      gmailLastError: null,
      gmailEnabled: false,
      updatedAt: new Date(),
    })
    .where(eq(integrationSettingsTable.id, row.id))
    .returning();
  req.log.info("gmail disconnected");
  res.json(DisconnectGmailResponse.parse(serializeGmail(saved)));
});

router.post("/settings/gmail/sync", async (req, res): Promise<void> => {
  const row = await getOrCreateSettings();
  if (!row.gmailRefreshToken) {
    res.json(SyncGmailNowResponse.parse({ ok: false, imported: 0, message: "Gmail no está conectado." }));
    return;
  }
  if (!row.gmailEnabled) {
    res.json(SyncGmailNowResponse.parse({ ok: false, imported: 0, message: "La sincronización está pausada." }));
    return;
  }
  const result = await syncGmail(req.log);
  res.json(
    SyncGmailNowResponse.parse({
      ok: result.ok,
      imported: result.imported,
      message: result.error ?? (result.imported > 0 ? `${result.imported} correo(s) nuevo(s).` : "No hay correos nuevos."),
    }),
  );
});

// Trae lo que YA está en la bandeja (no solo lo nuevo desde que se conectó).
// Puede tardar minutos con un buzón grande, así que corre en segundo plano: la
// respuesta llega de inmediato y el avance se ve en la bandeja de Correo, que
// se va llenando mientras la importación sigue.
router.post("/settings/gmail/import-inbox", async (req, res): Promise<void> => {
  const row = await getOrCreateSettings();
  if (!row.gmailRefreshToken) {
    res.json(ImportGmailInboxResponse.parse({ ok: false, message: "Gmail no está conectado." }));
    return;
  }
  if (isImportingInbox()) {
    res.json(ImportGmailInboxResponse.parse({ ok: false, message: "Ya hay una importación en curso." }));
    return;
  }
  void importFullInbox(req.log).catch((err) => req.log.error({ err }, "gmail full inbox import crashed"));
  res.json(
    ImportGmailInboxResponse.parse({
      ok: true,
      message: "Importación iniciada. Los correos irán apareciendo en la bandeja de Correo.",
    }),
  );
});

// ── Hilos ─────────────────────────────────────────────────────────────────────

async function enrichThreads(rows: EmailThread[]) {
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((x): x is number => x != null))];
  const agentIds = [...new Set(rows.map((r) => r.agentId).filter((x): x is number => x != null))];
  const labelIds = [...new Set(rows.map((r) => r.labelId).filter((x): x is number => x != null))];
  const threadIds = rows.map((r) => r.id);

  const [contacts, agents, labels, drafts] = await Promise.all([
    contactIds.length ? db.select().from(contactsTable).where(inArray(contactsTable.id, contactIds)) : [],
    agentIds.length ? db.select().from(agentsTable).where(inArray(agentsTable.id, agentIds)) : [],
    labelIds.length ? db.select().from(labelsTable).where(inArray(labelsTable.id, labelIds)) : [],
    threadIds.length
      ? db
          .select({ threadId: emailMessagesTable.threadId })
          .from(emailMessagesTable)
          .where(and(inArray(emailMessagesTable.threadId, threadIds), eq(emailMessagesTable.isDraft, true)))
      : [],
  ]);
  const contactById = new Map(contacts.map((c) => [c.id, c] as const));
  const agentById = new Map(agents.map((a) => [a.id, a] as const));
  const labelById = new Map(labels.map((l) => [l.id, l] as const));
  const withDraft = new Set(drafts.map((d) => d.threadId));
  // Lo que el cliente pidió en este hilo y sigue sin resolverse. Se ve en el
  // hilo, que es donde está mirando quien lo va a contestar.
  const casesByThread: Map<number, Case[]> = isModuleEnabled("cases")
    ? await openCasesByEmailThreadIds(threadIds)
    : new Map();

  return rows.map((r) => {
    const contact = r.contactId ? contactById.get(r.contactId) : undefined;
    const label = r.labelId ? labelById.get(r.labelId) : undefined;
    return {
      ...r,
      contactName: contact?.name ?? null,
      contactAvatar: contact?.avatar ?? null,
      contactPhone: contact?.phone ?? null,
      contactChannels: contact?.channels ?? [],
      agentName: r.agentId ? (agentById.get(r.agentId)?.name ?? null) : null,
      labelName: label?.name ?? null,
      labelColor: label?.color ?? null,
      hasDraft: withDraft.has(r.id),
      openCases: (casesByThread.get(r.id) ?? []).map((c) => ({
        id: c.id,
        code: caseCode(c.id),
        status: c.status,
        priority: c.priority,
        type: c.type,
        subject: c.subject,
      })),
    };
  });
}

router.get("/email/threads", async (req, res): Promise<void> => {
  const parsed = ListEmailThreadsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status, search, contactId } = parsed.data;
  const conditions = [];
  if (status && status !== "all") conditions.push(eq(emailThreadsTable.status, status));
  if (contactId) conditions.push(eq(emailThreadsTable.contactId, contactId));
  const term = search?.trim();
  if (term) {
    const like = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
    conditions.push(
      or(
        sql`${emailThreadsTable.subject} ilike ${like}`,
        sql`${emailThreadsTable.customerEmail} ilike ${like}`,
        sql`${emailThreadsTable.lastMessagePreview} ilike ${like}`,
        sql`exists (select 1 from ${contactsTable} where ${contactsTable.id} = ${emailThreadsTable.contactId} and ${contactsTable.name} ilike ${like})`,
      )!,
    );
  }
  const rows = await db
    .select()
    .from(emailThreadsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(emailThreadsTable.lastMessageAt))
    .limit(300);
  res.json({ threads: await enrichThreads(rows) });
});

router.get("/email/threads/:id", async (req, res): Promise<void> => {
  const parsed = GetEmailThreadParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [thread] = await db.select().from(emailThreadsTable).where(eq(emailThreadsTable.id, parsed.data.id));
  if (!thread) {
    res.status(404).json({ error: "Hilo no encontrado" });
    return;
  }
  const messages = await db.select().from(emailMessagesTable).where(eq(emailMessagesTable.threadId, thread.id));
  // En orden de lectura: la fecha del correo cuando la tiene; borradores y notas,
  // por cuándo se crearon. El borrador pendiente siempre al final.
  const at = (m: (typeof messages)[number]) => (m.sentAt ?? m.createdAt).getTime();
  messages.sort((a, b) => Number(a.isDraft) - Number(b.isDraft) || at(a) - at(b) || a.id - b.id);

  const authorIds = [...new Set(messages.map((m) => m.authorAgentId).filter((x): x is number => x != null))];
  const authors = authorIds.length ? await db.select().from(agentsTable).where(inArray(agentsTable.id, authorIds)) : [];
  const authorById = new Map(authors.map((a) => [a.id, a.name] as const));

  const [enriched] = await enrichThreads([thread]);
  res.json({
    thread: enriched,
    messages: messages.map((m) => ({
      ...m,
      bodyOwnText: m.isDraft || m.isInternal ? m.bodyText : stripQuotedReply(m.bodyText),
      authorAgentName: m.authorAgentId ? (authorById.get(m.authorAgentId) ?? null) : null,
    })),
  });
});

router.post("/email/threads/:id/read", async (req, res): Promise<void> => {
  const parsed = MarkEmailThreadReadParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await markEmailThreadRead(parsed.data.id, req.log);
  res.json({ ok: true });
});

router.post("/email/threads/:id/reply", async (req, res): Promise<void> => {
  const params = ReplyEmailThreadParams.safeParse(req.params);
  const body = ReplyEmailThreadBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const result = await sendEmailReply(
    params.data.id,
    {
      content: body.data.content,
      cc: body.data.cc,
      attachmentIds: body.data.attachmentIds,
      authorAgentId: req.user?.agentId ?? null,
    },
    req.log,
  );
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  // Una respuesta escrita a mano deja sin sentido el borrador pendiente.
  await db
    .delete(emailMessagesTable)
    .where(and(eq(emailMessagesTable.threadId, params.data.id), eq(emailMessagesTable.isDraft, true)));
  res.json({ ok: true, message: result.message });
});

router.post("/email/threads/:id/draft", async (req, res): Promise<void> => {
  const parsed = GenerateEmailDraftParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const outcome = await createAiDraft(parsed.data.id, req.log);
  res.json({ ok: Boolean(outcome.draft), draft: outcome.draft, note: outcome.note });
});

router.post("/email/threads/:id/resolve", async (req, res): Promise<void> => {
  const parsed = ResolveEmailThreadParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(emailThreadsTable)
    .set({ status: "resolved", unreadCount: 0, updatedAt: new Date() })
    .where(eq(emailThreadsTable.id, parsed.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Hilo no encontrado" });
    return;
  }
  res.json({ ok: true });
});

router.post("/email/threads/:id/reopen", async (req, res): Promise<void> => {
  const parsed = ReopenEmailThreadParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(emailThreadsTable)
    .set({ status: "open", updatedAt: new Date() })
    .where(eq(emailThreadsTable.id, parsed.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Hilo no encontrado" });
    return;
  }
  res.json({ ok: true });
});

router.get("/email/contact-candidates", async (req, res): Promise<void> => {
  const parsed = ListEmailContactCandidatesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const candidates = await contactCandidatesForThread(parsed.data.threadId, parsed.data.search ?? null);
  if (!candidates) {
    res.status(404).json({ error: "Hilo no encontrado" });
    return;
  }
  res.json({ candidates });
});

router.post("/email/threads/:id/link-contact", async (req, res): Promise<void> => {
  const params = LinkEmailThreadContactParams.safeParse(req.params);
  const body = LinkEmailThreadContactBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const result = await linkThreadToContact(params.data.id, body.data.contactId, req.log);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

// ── Redactar correo nuevo ─────────────────────────────────────────────────────

router.post("/email/compose", async (req, res): Promise<void> => {
  const parsed = ComposeEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { to, cc, subject, content, contactId, attachmentIds } = parsed.data;
  const result = await composeNewEmail(
    { to, cc, subject, content, contactId, attachmentIds, authorAgentId: req.user?.agentId ?? null },
    req.log,
  );
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ ok: true, threadId: result.threadId, message: result.message });
});

// ── Adjuntos salientes ────────────────────────────────────────────────────────
// Se suben en cuanto se elige el archivo, antes de que exista el correo que los
// va a llevar (una respuesta, un borrador o uno redactado desde cero). Cuerpo
// binario crudo y query para nombre/tipo, igual que los adjuntos del chat, y por
// eso mismo fuera del contrato de OpenAPI.
router.post(
  "/email/attachments",
  express.raw({ type: () => true, limit: MAX_EMAIL_ATTACHMENT_BYTES }),
  async (req, res): Promise<void> => {
    const data: unknown = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) {
      res.status(400).json({ error: "El archivo está vacío." });
      return;
    }
    const name = typeof req.query.name === "string" ? req.query.name : null;
    const type = typeof req.query.type === "string" ? req.query.type : "application/octet-stream";
    const result = await stageEmailAttachment(data, name, type.split(";")[0].trim().toLowerCase(), req.log);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json({
      id: result.attachment.id,
      filename: result.attachment.filename,
      mimeType: result.attachment.mimeType,
      size: result.attachment.size,
    });
  },
);

router.delete("/email/attachments/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Id inválido." });
    return;
  }
  const removed = await discardStagedAttachment(id);
  if (!removed) {
    res.status(404).json({ error: "Adjunto no encontrado." });
    return;
  }
  res.json({ ok: true });
});

// ── Mensajes ──────────────────────────────────────────────────────────────────

router.post("/email/messages/:messageId/send", async (req, res): Promise<void> => {
  const params = SendEmailDraftParams.safeParse(req.params);
  const body = SendEmailDraftBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const [draft] = await db.select().from(emailMessagesTable).where(eq(emailMessagesTable.id, params.data.messageId));
  if (!draft || !draft.isDraft) {
    res.status(409).json({ error: "El borrador ya no existe o ya fue enviado." });
    return;
  }
  const result = await sendEmailReply(
    draft.threadId,
    {
      draftId: draft.id,
      content: body.data.content,
      cc: body.data.cc,
      attachmentIds: body.data.attachmentIds,
      authorAgentId: req.user?.agentId ?? null,
    },
    req.log,
  );
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ ok: true, message: result.message });
});

router.delete("/email/messages/:messageId", async (req, res): Promise<void> => {
  const parsed = DeleteEmailDraftParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .delete(emailMessagesTable)
    .where(and(eq(emailMessagesTable.id, parsed.data.messageId), eq(emailMessagesTable.isDraft, true)))
    .returning();
  if (!row) {
    res.status(409).json({ error: "Solo pueden descartarse borradores." });
    return;
  }
  res.json({ ok: true });
});

// Fuera del contrato OpenAPI, como las descargas de medios del chat: devuelve el
// archivo, no JSON.
router.get("/email/messages/:messageId/attachments/:partId", async (req, res): Promise<void> => {
  const messageId = Number(req.params.messageId);
  const partId = String(req.params.partId ?? "");
  if (!Number.isInteger(messageId) || messageId <= 0 || !partId) {
    res.status(400).json({ error: "Parámetros inválidos." });
    return;
  }
  const result = await fetchEmailAttachment(messageId, partId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  // El tipo lo declara quien envió el correo: sin nosniff ni sandbox, un "adjunto"
  // HTML abierto directamente correría en el origen del panel.
  res.setHeader("Content-Type", result.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(result.data);
});

export default router;
