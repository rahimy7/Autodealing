import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import {
  db,
  integrationSettingsTable,
  emailThreadsTable,
  emailMessagesTable,
  emailStagedAttachmentsTable,
  contactsTable,
  contactFactsTable,
  conversationsTable,
  agentsTable,
  labelsTable,
  type Contact,
  type EmailThread,
  type EmailMessage,
  type EmailStagedAttachment,
  type IntegrationSettings,
  type Label,
} from "@workspace/db";
import * as gmail from "./gmail";
import {
  buildReferences,
  extractPhoneCandidates,
  isEmailAddress,
  normalizeEmail,
  parseGmailMessage,
  phonesMatch,
  previewOf,
  replySubject,
  sanitizeAiEmailReply,
  stripQuotedReply,
  whatsappContact,
  type OutgoingAttachment,
  type ParsedAttachment,
  type ParsedEmail,
} from "./email-format";
import { findContactByEmail, isPlaceholderName, mergeContacts, phoneSuffixCondition } from "./contact-identity";
import { collectAgentContext } from "./feed";
import { getOpenAIClient, buildSystemPrompt, classifyIntent } from "./openai-client";
import { maybeEnrichContactFromMessage, type Log } from "./messaging";
import { formatShort } from "./time";
import { exchangeRatePromptBlock, getTodayRatesForAgent, replacePesosDirectives } from "./exchange-rates";
import { deleteMedia, downloadMedia, isStorageConfigured, uploadMedia } from "./supabase";
import { maybeOpenCase } from "./cases";
import { isModuleEnabled } from "./client-config";
import { primaryNumber } from "./whatsapp-numbers";

// El correo de Gmail como canal de atención. Funciona como el Feed: lo que llega
// se agrupa en hilos, la IA clasifica y deja un borrador, y una persona lo
// aprueba (o sale solo, si la intención es segura y así se configuró).
//
// No hay webhook: Gmail solo avisa por Pub/Sub, que exige montar un tema en
// Google Cloud. En su lugar el scheduler lee el historial del buzón cada minuto,
// que para el volumen de correo de un negocio es de sobra.

// ── Configuración ─────────────────────────────────────────────────────────────

export async function loadGmailSettings(): Promise<IntegrationSettings | null> {
  const [row] = await db.select().from(integrationSettingsTable).orderBy(integrationSettingsTable.id).limit(1);
  return row ?? null;
}

export function gmailCredentials(row: IntegrationSettings | null): gmail.GmailCredentials | null {
  if (!row?.gmailClientId || !row.gmailClientSecret || !row.gmailRefreshToken) return null;
  return { clientId: row.gmailClientId, clientSecret: row.gmailClientSecret, refreshToken: row.gmailRefreshToken };
}

// ── Sincronización ────────────────────────────────────────────────────────────

// Lo que se trae al conectar: el último mes de la bandeja principal. Sirve de
// contexto para lo que llegue después; a esos correos no se les genera borrador,
// porque contestar hoy algo de hace tres semanas lo decide una persona. Lo que
// haya más atrás queda para "Importar buzón completo", que el administrador
// dispara a mano cuando quiere el historial entero.
const INITIAL_IMPORT_QUERY =
  "in:inbox newer_than:30d -category:promotions -category:social -category:forums -category:updates";
const INITIAL_IMPORT_MAX = 300;
// Cuando el punto del historial caducó (el servidor estuvo días apagado).
const RECOVERY_QUERY = "newer_than:3d -in:spam -in:trash -in:drafts";
const RECOVERY_MAX = 100;

// Gmail clasifica solo lo de la bandeja principal como conversación personal.
// Promociones, redes sociales, foros y notificaciones no son clientes escribiendo.
const SKIPPED_CATEGORIES = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS", "CATEGORY_UPDATES"];
const IGNORED_LABELS = ["DRAFT", "SPAM", "TRASH", "CHAT"];

/**
 * `full`: borrador y, si procede, envío automático. `draft`: borrador, nunca
 * envío. `none`: solo se guarda, sin IA.
 */
type AiMode = "full" | "draft" | "none";

export type GmailSyncResult = { ok: boolean; skipped: boolean; imported: number; error: string | null };

let syncInFlight: Promise<GmailSyncResult> | null = null;

/**
 * Lee lo nuevo del buzón. Dos llamadas a la vez (el ciclo automático y el
 * botón) comparten la misma pasada. Si una importación completa está en
 * curso, espera a que termine antes de arrancar: las dos hablan con la misma
 * cuenta, y correrlas a la vez es lo que agota la cuota por minuto de Gmail.
 */
export function syncGmail(log: Log): Promise<GmailSyncResult> {
  if (!syncInFlight) {
    const after = importInFlight ?? Promise.resolve(null);
    syncInFlight = after.then(() => runSync(log)).finally(() => {
      syncInFlight = null;
    });
  }
  return syncInFlight;
}

async function runSync(log: Log): Promise<GmailSyncResult> {
  const settings = await loadGmailSettings();
  const creds = gmailCredentials(settings);
  if (!settings?.gmailEnabled || !creds) return { ok: true, skipped: true, imported: 0, error: null };

  const failed = async (error: string, err?: unknown): Promise<GmailSyncResult> => {
    // El ciclo corre cada minuto: el mismo fallo repetido va como aviso, para no
    // llenar el registro de errores con miles de copias de lo mismo.
    if (settings.gmailLastError !== error) log.error({ err, error }, "gmail sync failed");
    else log.warn({ error }, "gmail sync still failing");
    await db
      .update(integrationSettingsTable)
      .set({ gmailLastError: error })
      .where(eq(integrationSettingsTable.id, settings.id));
    return { ok: false, skipped: false, imported: 0, error };
  };

  try {
    let imported = 0;
    let nextHistoryId: string;

    if (!settings.gmailHistoryId) {
      // El perfil se pide ANTES de listar: lo que entre mientras se importa queda
      // después de ese punto del historial y lo recoge la siguiente pasada.
      const profile = await gmail.getProfile(creds);
      if (!profile.ok) return failed(profile.error);
      const ids = await gmail.searchMessageIds(creds, INITIAL_IMPORT_QUERY, INITIAL_IMPORT_MAX);
      if (!ids.ok) return failed(ids.error);
      imported = await ingestMessageIds(settings, creds, [...ids.data].reverse(), "none", log);
      nextHistoryId = profile.data.historyId;
      log.info({ imported }, "gmail initial import done");
    } else {
      const history = await gmail.listHistory(creds, settings.gmailHistoryId);
      if (!history.ok && history.status === 404) {
        const profile = await gmail.getProfile(creds);
        if (!profile.ok) return failed(profile.error);
        const ids = await gmail.searchMessageIds(creds, RECOVERY_QUERY, RECOVERY_MAX);
        if (!ids.ok) return failed(ids.error);
        imported = await ingestMessageIds(settings, creds, [...ids.data].reverse(), "draft", log);
        nextHistoryId = profile.data.historyId;
        log.warn({ imported }, "gmail history point expired; recovered from recent search");
      } else if (!history.ok) {
        return failed(history.error);
      } else {
        imported = await ingestMessageIds(settings, creds, history.data.messageIds, "full", log);
        nextHistoryId = history.data.historyId;
      }
    }

    // Condicionado al mismo token: si desconectaron la cuenta durante la pasada,
    // no se reescribe el punto de una cuenta que ya no está.
    await db
      .update(integrationSettingsTable)
      .set({ gmailHistoryId: nextHistoryId, gmailLastSyncAt: new Date(), gmailLastError: null })
      .where(
        and(
          eq(integrationSettingsTable.id, settings.id),
          eq(integrationSettingsTable.gmailRefreshToken, creds.refreshToken),
        ),
      );
    return { ok: true, skipped: false, imported, error: null };
  } catch (err) {
    return failed("Falló la lectura del buzón de Gmail.", err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gmail limita cuántas llamadas admite por minuto para una misma cuenta. Una
// pausa chica entre mensaje y mensaje mantiene una pasada larga (la
// importación completa, sobre todo) bien por debajo de ese tope; los que ya
// estaban guardados (`seen`) no llaman a la API y no pagan esta pausa.
const GMAIL_REQUEST_GAP_MS = 150;

function isQuotaError(error: string): boolean {
  return /quota|rate limit/i.test(error);
}

// Un tope por minuto no es un fallo real del mensaje: se espera a que se
// libere y se reintenta una vez antes de rendirse con él.
async function getMessageWithBackoff(
  creds: gmail.GmailCredentials,
  id: string,
  log: Log,
): ReturnType<typeof gmail.getMessage> {
  const first = await gmail.getMessage(creds, id);
  if (first.ok || first.status === 404 || !isQuotaError(first.error)) return first;
  log.warn({ gmailMessageId: id }, "gmail quota hit; esperando antes de reintentar");
  await sleep(20_000);
  return gmail.getMessage(creds, id);
}

async function ingestMessageIds(
  settings: IntegrationSettings,
  creds: gmail.GmailCredentials,
  ids: string[],
  ai: AiMode,
  log: Log,
): Promise<number> {
  const known = ids.length
    ? await db
        .select({ id: emailMessagesTable.gmailMessageId })
        .from(emailMessagesTable)
        .where(inArray(emailMessagesTable.gmailMessageId, ids))
    : [];
  const seen = new Set(known.map((k) => k.id));

  let imported = 0;
  for (const id of ids) {
    // También los que entraron en esta misma pasada con el hilo completo de un correo anterior.
    if (seen.has(id)) continue;
    const message = await getMessageWithBackoff(creds, id, log);
    if (!message.ok) {
      // Borrado entre el aviso y la lectura: no hay nada que traer.
      if (message.status === 404) continue;
      // Cualquier otro fallo corta la pasada sin avanzar el punto del historial,
      // para reintentar este mismo mensaje en la siguiente.
      throw new Error(message.error);
    }
    try {
      if (await ingestGmailMessage(settings, parseGmailMessage(message.data), ai, log)) imported++;
    } catch (err) {
      // Un correo malformado no puede bloquear el buzón entero para siempre.
      log.error({ err, gmailMessageId: id }, "gmail message ingest failed");
    }
    await sleep(GMAIL_REQUEST_GAP_MS);
  }
  return imported;
}

// ── Importación completa del buzón ────────────────────────────────────────────

// A diferencia de la importación inicial al conectar (7 días, 30 correos, solo
// contexto), esta es una acción explícita del administrador: trae lo que YA
// está en la bandeja principal, sin límite de fecha. Sigue excluyendo lo que
// nunca fue un cliente escribiendo (promociones, redes, notificaciones,
// remitentes automáticos) y no genera borradores de IA — son correos viejos,
// contestarlos hoy lo decide una persona.
const FULL_IMPORT_QUERY = "in:inbox -category:promotions -category:social -category:forums -category:updates";
// Tope de seguridad: una sola pasada no debe convertirse en una tarea sin fin.
// Con más que esto en la bandeja, un segundo clic recoge el resto — lo ya
// guardado se salta por gmailMessageId, así que repetir no duplica nada.
const FULL_IMPORT_MAX = 1000;

let importInFlight: Promise<GmailSyncResult> | null = null;

/** ¿Hay una importación completa corriendo ahora? Lo consulta el panel para deshabilitar el botón. */
export function isImportingInbox(): boolean {
  return importInFlight !== null;
}

/**
 * Trae todo lo que hay ahora en la bandeja principal (hasta el tope de
 * seguridad), no solo lo nuevo desde que se conectó. Se dispara en segundo
 * plano desde la ruta — con un buzón grande puede tardar varios minutos — y el
 * avance se ve directo en la bandeja de Correo, que se va llenando mientras
 * corre. Dos clics a la vez comparten la misma pasada, igual que syncGmail.
 */
export function importFullInbox(log: Log): Promise<GmailSyncResult> {
  if (!importInFlight) {
    // Simétrico con syncGmail: si el ciclo automático está a mitad de una
    // pasada, se espera a que termine antes de empezar la importación.
    const after = syncInFlight ?? Promise.resolve(null);
    importInFlight = after.then(() => runFullImport(log)).finally(() => {
      importInFlight = null;
    });
  }
  return importInFlight;
}

// La fecha del correo más antiguo que ya está guardado (de cualquier canal de
// entrada: importación inicial, sincronización o una importación completa
// anterior). Es el ancla desde la que continúa la próxima importación
// completa. `null` cuando el buzón todavía no tiene ningún correo.
async function oldestImportedMessageDate(): Promise<Date | null> {
  const [row] = await db
    .select({ sentAt: emailMessagesTable.sentAt })
    .from(emailMessagesTable)
    .where(isNotNull(emailMessagesTable.sentAt))
    .orderBy(asc(emailMessagesTable.sentAt))
    .limit(1);
  return row?.sentAt ?? null;
}

// Formato que entiende el operador `before:` de Gmail (fecha de calendario, no
// hora). Es una frontera por día, así que algún correo del mismo día del corte
// puede volver a pedirse — no pasa nada: `ingestMessageIds` lo salta por
// gmailMessageId, y es un precio pequeño por no arriesgar un hueco.
function gmailSearchDate(date: Date): string {
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

async function runFullImport(log: Log): Promise<GmailSyncResult> {
  const settings = await loadGmailSettings();
  const creds = gmailCredentials(settings);
  if (!settings || !creds) {
    return { ok: false, skipped: false, imported: 0, error: "Gmail no está conectado." };
  }

  const failed = async (error: string, err?: unknown): Promise<GmailSyncResult> => {
    log.error({ err, error }, "gmail full inbox import failed");
    await db
      .update(integrationSettingsTable)
      .set({ gmailLastError: error })
      .where(eq(integrationSettingsTable.id, settings.id));
    return { ok: false, skipped: false, imported: 0, error };
  };

  try {
    const profile = await gmail.getProfile(creds);
    if (!profile.ok) return failed(profile.error);

    // Gmail siempre devuelve los más nuevos primero: sin esto, un segundo clic
    // en un buzón con más de FULL_IMPORT_MAX correos volvería a traer los
    // mismos de la última vez (ya guardados) y nunca llegaría a lo más viejo.
    // Se continúa desde el correo más antiguo que ya se guardó, con el
    // operador `before:` de Gmail — así cada pasada retoma donde quedó la
    // anterior, sin necesidad de recordar un cursor entre una y otra.
    const cutoff = await oldestImportedMessageDate();
    // Un día de margen sobre el corte: `before:` es una frontera de calendario
    // y no vale la pena apostar a si excluye o no el día exacto — de más,
    // vuelve a pedir algo ya guardado (se salta); de menos, deja un hueco.
    const query = cutoff
      ? `${FULL_IMPORT_QUERY} before:${gmailSearchDate(new Date(cutoff.getTime() + 24 * 60 * 60 * 1000))}`
      : FULL_IMPORT_QUERY;

    const ids = await gmail.searchAllMessageIds(creds, query, FULL_IMPORT_MAX);
    if (!ids.ok) return failed(ids.error);
    log.info({ found: ids.data.length }, "gmail full inbox import started");
    const imported = await ingestMessageIds(settings, creds, [...ids.data].reverse(), "none", log);

    // Si todavía no había punto de partida para la sincronización incremental —
    // nunca se había hecho ninguna pasada—, esta importación deja al buzón "al
    // día": se fija aquí para que el ciclo automático siga desde ahora, en vez
    // de repetir por su cuenta la importación inicial de los últimos 7 días.
    const update: Partial<typeof integrationSettingsTable.$inferInsert> = {
      gmailLastSyncAt: new Date(),
      gmailLastError: null,
    };
    if (!settings.gmailHistoryId) update.gmailHistoryId = profile.data.historyId;
    await db
      .update(integrationSettingsTable)
      .set(update)
      .where(
        and(
          eq(integrationSettingsTable.id, settings.id),
          eq(integrationSettingsTable.gmailRefreshToken, creds.refreshToken),
        ),
      );

    log.info({ imported, found: ids.data.length }, "gmail full inbox import done");
    return { ok: true, skipped: false, imported, error: null };
  } catch (err) {
    return failed("Falló la importación del buzón.", err);
  }
}

/** Guarda un correo leído del buzón. Devuelve si entró algo nuevo. */
export async function ingestGmailMessage(
  settings: IntegrationSettings,
  email: ParsedEmail,
  ai: AiMode,
  log: Log,
): Promise<boolean> {
  const labels = new Set(email.labelIds);
  if (IGNORED_LABELS.some((l) => labels.has(l))) return false;

  const ownAddress = settings.gmailEmailAddress?.toLowerCase() ?? null;
  const fromUs = labels.has("SENT") || (!!ownAddress && email.from?.address === ownAddress);
  let [thread] = await db
    .select()
    .from(emailThreadsTable)
    .where(eq(emailThreadsTable.gmailThreadId, email.gmailThreadId));

  if (fromUs) {
    // Lo que se contesta desde el propio Gmail también es parte del hilo. Pero un
    // correo nuestro a alguien que no nos ha escrito no abre una conversación.
    if (!thread) return false;
    const row = await insertEmailMessage(thread.id, email, "out");
    if (!row) return false;
    await db
      .update(emailThreadsTable)
      .set({
        lastMessageAt: laterOf(thread.lastMessageAt, row.sentAt),
        lastMessagePreview: previewOf(stripQuotedReply(row.bodyText)),
        updatedAt: new Date(),
      })
      .where(eq(emailThreadsTable.id, thread.id));
    return true;
  }

  if (!email.from) return false;
  if (!thread) {
    if (!labels.has("INBOX") || SKIPPED_CATEGORIES.some((c) => labels.has(c)) || email.isAutomated) return false;
    thread = await openThread(email, log);
  }

  const row = await insertEmailMessage(thread.id, email, "in");
  if (!row) return false;

  const ownWords = stripQuotedReply(email.text);
  await db
    .update(emailThreadsTable)
    .set({
      lastMessageAt: laterOf(thread.lastMessageAt, row.sentAt),
      lastMessagePreview: previewOf(ownWords || email.subject || ""),
      unreadCount: sql`${emailThreadsTable.unreadCount} + 1`,
      // Un cliente que vuelve a escribir en un hilo resuelto lo reabre: su nuevo
      // correo espera respuesta igual que el primero.
      status: "open",
      updatedAt: new Date(),
    })
    .where(eq(emailThreadsTable.id, thread.id));
  log.info({ threadId: thread.id, gmailMessageId: email.gmailMessageId }, "email ingested");

  // Solo lo que escribe el cliente del hilo describe al cliente. Un compañero en
  // copia tiene su propio nombre y teléfono.
  if (thread.contactId && email.from.address === thread.customerEmail && ownWords) {
    void maybeEnrichContactFromMessage(thread.contactId, ownWords, log);
  }

  if (ai === "none" || email.isAutomated) return true;

  // Lo que el cliente pide queda como caso ANTES de redactar nada: aunque la IA
  // no sepa contestarle, la petición no se pierde — que es justo lo que pasaba
  // con los reclamos que llegaban por correo.
  if (isModuleEnabled("cases") && thread.contactId && ownWords) {
    void maybeOpenCase(
      {
        contactId: thread.contactId,
        channel: "email",
        text: [email.subject ? `Asunto: ${email.subject}` : "", ownWords].filter(Boolean).join("\n"),
        emailThreadId: thread.id,
      },
      log,
    );
  }

  const label = await classifyEmail(email.subject, ownWords);
  if (label) {
    await db.update(emailThreadsTable).set({ labelId: label.id }).where(eq(emailThreadsTable.id, thread.id));
  }

  const draft = await createAiDraft(thread.id, log);
  if (draft.draft && ai === "full" && settings.gmailAutoReply && label?.isSafeForEmailAutoReply) {
    const sent = await sendEmailReply(thread.id, { draftId: draft.draft.id }, log);
    if (sent.ok) log.info({ threadId: thread.id, labelId: label.id }, "email auto-replied (safe intent)");
  }
  return true;
}

function laterOf(current: Date, candidate: Date | null): Date {
  return candidate && candidate > current ? candidate : current;
}

async function openThread(email: ParsedEmail, log: Log): Promise<EmailThread> {
  const from = email.from!;
  const contactId = await resolveContactForEmail(from.address, from.name);
  const agent = await pickVirtualAgentForEmail();
  // Dos pasadas simultáneas pueden ver el mismo hilo nuevo: gana la primera y la
  // segunda usa el hilo que ya quedó.
  await db
    .insert(emailThreadsTable)
    .values({
      gmailThreadId: email.gmailThreadId,
      contactId,
      agentId: agent?.id ?? null,
      subject: email.subject,
      customerEmail: from.address,
      lastMessageAt: email.date ?? new Date(),
      status: "open",
    })
    .onConflictDoNothing({ target: emailThreadsTable.gmailThreadId });
  const [thread] = await db
    .select()
    .from(emailThreadsTable)
    .where(eq(emailThreadsTable.gmailThreadId, email.gmailThreadId));
  log.info({ threadId: thread.id, contactId }, "email thread opened");
  return thread;
}

async function insertEmailMessage(
  threadId: number,
  email: ParsedEmail,
  direction: "in" | "out",
): Promise<EmailMessage | null> {
  const [row] = await db
    .insert(emailMessagesTable)
    .values({
      threadId,
      gmailMessageId: email.gmailMessageId,
      rfcMessageId: email.rfcMessageId,
      references: email.references,
      direction,
      fromAddress: email.from?.address ?? null,
      fromName: email.from?.name ?? null,
      toAddresses: email.to.map((a) => a.address),
      ccAddresses: email.cc.map((a) => a.address),
      replyTo: email.replyTo?.address ?? null,
      subject: email.subject,
      bodyText: email.text,
      bodyHtml: email.html,
      attachments: email.attachments,
      sentAt: email.date ?? new Date(),
    })
    .onConflictDoNothing({ target: emailMessagesTable.gmailMessageId })
    .returning();
  return row ?? null;
}

/**
 * El contacto de quien escribe. La dirección de correo es la llave: si algún
 * contacto la tiene registrada —porque la dio por WhatsApp o la anotaron a mano—
 * el correo cae en esa misma ficha, junto a sus chats.
 */
export async function resolveContactForEmail(address: string, displayName: string | null): Promise<number> {
  const existing = await findContactByEmail(address);
  if (existing) {
    const update: Partial<typeof contactsTable.$inferInsert> = {};
    if (!(existing.channels ?? []).includes("email")) update.channels = [...(existing.channels ?? []), "email"];
    if (displayName && isPlaceholderName(existing.name)) update.name = displayName;
    if (Object.keys(update).length > 0) {
      await db.update(contactsTable).set(update).where(eq(contactsTable.id, existing.id));
    }
    return existing.id;
  }
  const [created] = await db
    .insert(contactsTable)
    .values({
      name: displayName ?? `Cliente ${address.split("@")[0]}`,
      email: address,
      channels: ["email"],
    })
    .returning();
  return created.id;
}

async function pickVirtualAgentForEmail() {
  const candidates = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.type, "virtual"), eq(agentsTable.isActive, true)))
    .orderBy(agentsTable.id);
  return candidates.find((a) => (a.channels ?? []).length === 0 || (a.channels ?? []).includes("email")) ?? null;
}

async function classifyEmail(subject: string | null, text: string): Promise<Label | null> {
  // Las etiquetas de localidad dicen dónde está el cliente, no qué quiere: no
  // entran al clasificador de intención, igual que en el chat.
  const labels = await db
    .select()
    .from(labelsTable)
    .where(and(eq(labelsTable.isActive, true), ne(labelsTable.kind, "locality")));
  if (labels.length === 0) return null;
  const message = [subject ? `Asunto: ${subject}` : "", text].filter(Boolean).join("\n").slice(0, 4000);
  const picked = await classifyIntent({
    message,
    labels: labels.map((l) => ({ id: l.id, name: l.name, description: l.description })),
  });
  return labels.find((l) => l.id === picked) ?? null;
}

// ── Borradores de la IA ───────────────────────────────────────────────────────

const EMAIL_CONDUCT = `IMPORTANTE — CANAL CORREO ELECTRÓNICO:
- Este mensaje llega por correo electrónico, no por chat. Redacta el CUERPO de un correo de respuesta.
- Abre con un saludo (con el nombre del cliente si lo sabes), responde en párrafos cortos y claros, y cierra con una despedida breve.
- Responde en el mismo idioma en el que el cliente escribió su último correo (si escribió en inglés, contesta en inglés); no lo traduzcas al español por defecto.
- No escribas el asunto ni una firma: el sistema los agrega.
- Las marcas [[OPCIONES: …]], [[FOTO: …]] y [[CITA: …]] no funcionan por correo. Si ofreces opciones, enuméralas en el texto; si hablas de un producto, comparte su enlace.
- Responde solo a lo que el cliente escribió en su último correo; lo citado debajo ya fue atendido.
- Contesta SOLO con lo que sepas por tu conocimiento y por el contexto de este cliente. No inventes precios, plazos de entrega, números de rastreo, políticas de devolución ni estados de pedidos.
- Si no tienes con qué contestar —o el tema le toca a una persona— responde ÚNICAMENTE ESCALAR_A_HUMANO, sin una palabra más. No se le manda nada al cliente: el correo queda para el equipo. Nunca escribas que vas a escalar, transferir, consultar, "verificar con el área correspondiente" ni que alguien se pondrá en contacto.
- Cuando SÍ contestes, hazlo completo: el cliente escribió una vez y espera la respuesta en este correo, no una respuesta que lo deje esperando otra.
- Si el correo trae varias preguntas, contéstalas todas; si de tres solo sabes dos, responde ÚNICAMENTE ESCALAR_A_HUMANO — media respuesta por correo obliga al cliente a volver a escribir.
- No es publicidad: nada de ofertas, promociones ni productos que el cliente no haya mencionado.
- Si quien escribe no es un cliente (nos ofrece servicios, SEO, diseño, inversión o una alianza que no pedimos), responde ÚNICAMENTE ESCALAR_A_HUMANO.
- Escribes un correo, no un mensaje de WhatsApp. Tus instrucciones y tu base de conocimiento se escribieron pensando en el chat: donde digan "este chat", "por aquí", "este WhatsApp" o "este número", aquí es este correo. Lo de "una línea, dos como mucho" y terminar con una pregunta como "¿Te lo preparo?" es del chat: aquí escribe un correo completo, claro y cordial, sin estilo de chat.
- Las imágenes ([[IMAGEN: …]]) no llegan por correo. Si tienes que darle las cuentas para pagar o explicarle cómo recibe el envío, escríbelo en el texto con los datos de tu base de conocimiento.
- Por correo no tienes su teléfono: si hace falta para el envío, pídeselo junto con los demás datos, igual que en Instagram o Facebook.
- Por correo también se toman pedidos: si el cliente quiere comprar, tómale el pedido aquí como indican tus instrucciones y, en ese mismo correo, preséntale también la opción de hacerlo por WhatsApp.`;

/**
 * El WhatsApp que el agente de correo ofrece como otra vía. Sale del número
 * principal dado de alta en la instancia, no del prompt: si el negocio cambia de
 * número, el correo lo sigue sin tocar las instrucciones.
 */
async function emailWhatsappLine(): Promise<string> {
  const number = await primaryNumber().catch(() => null);
  const contact = whatsappContact(number?.displayNumber);
  if (!contact) {
    return "- No tienes el número de WhatsApp del negocio: no inventes uno. En lugar de WhatsApp, ofrece la tienda en línea si tu base de conocimiento la tiene.";
  }
  return `- El WhatsApp del negocio es ${contact.display} (${contact.link}). Es el que le das cuando le presentas la opción de WhatsApp; no des otro número.`;
}

async function buildEmailContactContext(contact: Contact | null): Promise<string | null> {
  if (!contact) return null;
  const parts: string[] = [];
  const identity = [contact.name, contact.email ? `<${contact.email}>` : "", contact.phone ? `tel. ${contact.phone}` : ""]
    .filter(Boolean)
    .join(" ");
  parts.push(`Cliente: ${identity}.`);
  const profile: string[] = [];
  if (contact.buyerStatus) profile.push(`estado: ${contact.buyerStatus}`);
  if ((contact.interests ?? []).length) profile.push(`intereses: ${(contact.interests ?? []).join(", ")}`);
  if (contact.purchaseProfile) profile.push(`perfil de compra: ${contact.purchaseProfile}`);
  if (profile.length) parts.push(`Perfil: ${profile.join("; ")}.`);

  const facts = await db.select().from(contactFactsTable).where(eq(contactFactsTable.contactId, contact.id));
  if (facts.length) parts.push(`Datos relevantes: ${facts.map((f) => `${f.label}: ${f.value}`).join("; ")}.`);

  // Es la ventaja de tener una sola ficha: lo que el cliente ya contó por chat
  // no hay que volver a preguntárselo por correo.
  const [chat] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.contactId, contact.id))
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(1);
  const chatSummary = chat?.contextSummary?.trim() || chat?.historySummary?.trim();
  if (chat && chatSummary) {
    parts.push(`También nos escribe por ${chat.channel}. Resumen de lo hablado allí: ${chatSummary}`);
  }
  return parts.join("\n");
}

async function buildEmailHistoryText(threadId: number): Promise<string> {
  const rows = await db
    .select()
    .from(emailMessagesTable)
    .where(
      and(
        eq(emailMessagesTable.threadId, threadId),
        eq(emailMessagesTable.isDraft, false),
        eq(emailMessagesTable.isInternal, false),
      ),
    )
    .orderBy(desc(emailMessagesTable.sentAt))
    .limit(8);
  return rows
    .reverse()
    .map((m) => {
      const who = m.direction === "in" ? "Cliente" : "Nosotros";
      const when = m.sentAt ? `[${formatShort(m.sentAt)}] ` : "";
      return `${when}${who}: ${stripQuotedReply(m.bodyText).slice(0, 3000)}`;
    })
    .join("\n\n");
}

export type DraftOutcome = { draft: EmailMessage | null; note: string | null };

/**
 * Pide a la IA la respuesta al último correo del hilo y la deja como borrador
 * (reemplazando al anterior, que respondía a algo ya superado). Cuando no puede
 * —sin agente, sin IA, o el tema es para una persona— devuelve el porqué.
 */
export async function createAiDraft(threadId: number, log: Log): Promise<DraftOutcome> {
  const [thread] = await db.select().from(emailThreadsTable).where(eq(emailThreadsTable.id, threadId));
  if (!thread) return { draft: null, note: "Hilo no encontrado." };

  let agentId = thread.agentId;
  if (!agentId) {
    // Los hilos abiertos antes de que un agente atendiera el correo lo toman ahora.
    const agent = await pickVirtualAgentForEmail();
    if (agent) {
      agentId = agent.id;
      await db.update(emailThreadsTable).set({ agentId }).where(eq(emailThreadsTable.id, thread.id));
    }
  }
  if (!agentId) {
    return { draft: null, note: "Ningún agente virtual atiende el canal Correo. Actívalo en Agentes → canales." };
  }
  const client = getOpenAIClient();
  if (!client) return { draft: null, note: "La IA no está configurada en esta instancia." };
  const ctx = await collectAgentContext(agentId);
  if (!ctx) return { draft: null, note: "El agente asignado ya no existe." };
  const { agent, caps, kbs } = ctx;

  const contact = thread.contactId
    ? ((await db.select().from(contactsTable).where(eq(contactsTable.id, thread.contactId)))[0] ?? null)
    : null;

  const rates = await getTodayRatesForAgent(log);

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
    contactContext: await buildEmailContactContext(contact),
    exchangeRate: rates ? exchangeRatePromptBlock(rates) : null,
  });

  const history = await buildEmailHistoryText(thread.id);
  if (!history.trim()) return { draft: null, note: "El hilo no tiene correos que responder." };

  let raw: string | null = null;
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5-mini",
      // Como en el chat: con 4096 el razonamiento a veces se come todo el presupuesto
      // y la IA no devuelve texto.
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: `${systemPrompt}\n\n${EMAIL_CONDUCT}\n${await emailWhatsappLine()}` },
        { role: "user", content: `Asunto del hilo: ${thread.subject ?? "(sin asunto)"}\n\n${history}` },
      ],
    });
    raw = completion.choices[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    log.error({ err, threadId }, "email draft generation failed");
    return { draft: null, note: "La IA no pudo generar la respuesta." };
  }
  if (!raw) return { draft: null, note: "La IA no devolvió texto." };

  const { text, escalate } = sanitizeAiEmailReply(replacePesosDirectives(raw, rates));
  if (escalate || !text) {
    const note = `🙋 La IA considera que este correo necesita atención humana.${text ? ` ${text}` : ""}`;
    await db.insert(emailMessagesTable).values({ threadId, direction: "out", bodyText: note, isInternal: true });
    return { draft: null, note: "El tema requiere a una persona: la IA no redactó respuesta." };
  }

  await db
    .delete(emailMessagesTable)
    .where(and(eq(emailMessagesTable.threadId, threadId), eq(emailMessagesTable.isDraft, true)));
  const [draft] = await db
    .insert(emailMessagesTable)
    .values({
      threadId,
      direction: "out",
      subject: replySubject(thread.subject),
      bodyText: text,
      authorAgentId: agent.id,
      isDraft: true,
      isAiSuggestion: true,
    })
    .returning();
  log.info({ threadId, draftId: draft.id }, "email draft stored");
  return { draft, note: null };
}

// ── Adjuntos salientes ────────────────────────────────────────────────────────

// Un archivo por mensaje puede pesar más que el resto, pero la suma es lo que
// importa: `messages.send` manda el correo entero en un solo campo JSON en
// base64 (~1.37× el tamaño original), y ese cuerpo tiene un techo. Quedarse
// bien por debajo evita que un envío con dos o tres adjuntos medianos falle por
// el total en vez de por ninguno de ellos en particular.
export const MAX_EMAIL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_EMAIL_ATTACHMENTS_COUNT = 10;

export type StageOutcome =
  | { ok: true; attachment: EmailStagedAttachment }
  | { ok: false; status: number; error: string };

function stagedExtension(mimeType: string, name: string | null): string {
  const fromName = name?.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase();
  return fromName ?? mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ?? "bin";
}

/**
 * Guarda un archivo elegido para un correo que aún no existe (una respuesta, un
 * borrador o uno redactado desde cero). Se sube en cuanto se elige, no al
 * enviar: así la barra de progreso es inmediata y el envío final solo referencia
 * ids ya subidos.
 */
export async function stageEmailAttachment(
  data: Buffer,
  filename: string | null,
  mimeType: string,
  log: Log,
): Promise<StageOutcome> {
  if (data.length === 0) return { ok: false, status: 400, error: "El archivo está vacío." };
  if (data.length > MAX_EMAIL_ATTACHMENT_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `El archivo supera el límite de ${Math.round(MAX_EMAIL_ATTACHMENT_BYTES / (1024 * 1024))} MB.`,
    };
  }
  if (!isStorageConfigured()) {
    return { ok: false, status: 503, error: "El almacenamiento de archivos no está configurado." };
  }
  const name = (filename?.split(/[/\\]/).pop()?.trim() || "adjunto").slice(-150);
  const ext = stagedExtension(mimeType, name);
  const path = `email-staged-${crypto.randomUUID()}.${ext}`;
  if (!(await uploadMedia(path, data, mimeType))) {
    return { ok: false, status: 502, error: "No se pudo guardar el archivo." };
  }
  const [row] = await db
    .insert(emailStagedAttachmentsTable)
    .values({ storagePath: path, filename: name, mimeType, size: data.length })
    .returning();
  log.info({ attachmentId: row.id, size: data.length }, "email attachment staged");
  return { ok: true, attachment: row };
}

/** Descarta un adjunto que se subió pero no se va a mandar (se quitó de la lista, o se cerró el compositor). */
export async function discardStagedAttachment(id: number): Promise<boolean> {
  const [row] = await db.delete(emailStagedAttachmentsTable).where(eq(emailStagedAttachmentsTable.id, id)).returning();
  if (!row) return false;
  await deleteMedia(row.storagePath);
  return true;
}

// Los que nadie nunca envió ni descartó: un compositor cerrado sin mandar el
// correo. Se limpian a las 24 horas para que ese olvido no acumule archivos en
// el almacenamiento para siempre.
const STAGED_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

export async function purgeOldStagedEmailAttachments(): Promise<number> {
  const cutoff = new Date(Date.now() - STAGED_ATTACHMENT_TTL_MS);
  const rows = await db
    .delete(emailStagedAttachmentsTable)
    .where(lt(emailStagedAttachmentsTable.createdAt, cutoff))
    .returning();
  for (const row of rows) await deleteMedia(row.storagePath);
  return rows.length;
}

type ResolvedAttachments =
  | { ok: true; attachments: OutgoingAttachment[]; staged: EmailStagedAttachment[] }
  | { ok: false; status: number; error: string };

/** Baja del almacenamiento los adjuntos puestos en espera para adjuntarlos al MIME saliente. */
async function resolveStagedAttachments(ids: number[]): Promise<ResolvedAttachments> {
  if (ids.length === 0) return { ok: true, attachments: [], staged: [] };
  if (ids.length > MAX_EMAIL_ATTACHMENTS_COUNT) {
    return { ok: false, status: 400, error: `Como máximo ${MAX_EMAIL_ATTACHMENTS_COUNT} adjuntos por correo.` };
  }
  const uniqueIds = [...new Set(ids)];
  const rows = await db
    .select()
    .from(emailStagedAttachmentsTable)
    .where(inArray(emailStagedAttachmentsTable.id, uniqueIds));
  if (rows.length !== uniqueIds.length) {
    return { ok: false, status: 409, error: "Alguno de los adjuntos ya no existe. Vuelve a agregarlo." };
  }
  const total = rows.reduce((sum, r) => sum + r.size, 0);
  if (total > MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Los adjuntos juntos superan el límite de ${Math.round(MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES / (1024 * 1024))} MB.`,
    };
  }
  const attachments: OutgoingAttachment[] = [];
  for (const row of rows) {
    const stored = await downloadMedia(row.storagePath);
    if (!stored) return { ok: false, status: 502, error: `No se pudo leer el adjunto "${row.filename}".` };
    attachments.push({ filename: row.filename, mimeType: row.mimeType, data: stored.data });
  }
  return { ok: true, attachments, staged: rows };
}

async function discardStaged(rows: EmailStagedAttachment[]): Promise<void> {
  if (rows.length === 0) return;
  await db.delete(emailStagedAttachmentsTable).where(inArray(emailStagedAttachmentsTable.id, rows.map((r) => r.id)));
  for (const row of rows) await deleteMedia(row.storagePath);
}

/**
 * El Message-ID y los adjuntos de un mensaje que acabamos de enviar. Gmail solo
 * los conoce después del envío —asigna el Message-ID y sus propios partId a
 * cada adjunto—, así que hay que releerlo completo para guardar la misma forma
 * que usan los mensajes entrantes.
 */
async function fetchSentMessageMeta(
  creds: gmail.GmailCredentials,
  gmailMessageId: string,
): Promise<{ rfcMessageId: string | null; attachments: ParsedAttachment[] }> {
  const res = await gmail.getMessage(creds, gmailMessageId);
  if (!res.ok) return { rfcMessageId: null, attachments: [] };
  const parsed = parseGmailMessage(res.data);
  return { rfcMessageId: parsed.rfcMessageId, attachments: parsed.attachments };
}

// ── Envío ─────────────────────────────────────────────────────────────────────

export type SendOutcome = { ok: true; message: EmailMessage } | { ok: false; error: string; status: number };

/**
 * Responde en el hilo, por Gmail y como parte del mismo hilo en el buzón del
 * cliente. Con `draftId` envía ese borrador (con `content`, si lo editaron); sin
 * él, envía `content` como respuesta nueva.
 */
export async function sendEmailReply(
  threadId: number,
  opts: { content?: string; draftId?: number; cc?: string[]; attachmentIds?: number[]; authorAgentId?: number | null },
  log: Log,
): Promise<SendOutcome> {
  const settings = await loadGmailSettings();
  const creds = gmailCredentials(settings);
  if (!settings || !creds || !settings.gmailEmailAddress) {
    return { ok: false, status: 409, error: "Gmail no está conectado. Conéctalo en Configuración → Correo." };
  }
  const [thread] = await db.select().from(emailThreadsTable).where(eq(emailThreadsTable.id, threadId));
  if (!thread) return { ok: false, status: 404, error: "Hilo no encontrado." };

  let draft: EmailMessage | null = null;
  if (opts.draftId !== undefined) {
    [draft] = await db
      .select()
      .from(emailMessagesTable)
      .where(
        and(
          eq(emailMessagesTable.id, opts.draftId),
          eq(emailMessagesTable.threadId, threadId),
          eq(emailMessagesTable.isDraft, true),
        ),
      );
    if (!draft) return { ok: false, status: 409, error: "El borrador ya no existe o ya fue enviado." };
  }

  const body = (opts.content ?? draft?.bodyText ?? "").trim();
  if (!body) return { ok: false, status: 400, error: "El correo no puede ir vacío." };
  const cc = [...new Set((opts.cc ?? []).map((a) => a.trim().toLowerCase()).filter(isEmailAddress))];

  const resolved = await resolveStagedAttachments(opts.attachmentIds ?? []);
  if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error };

  const history = await db
    .select()
    .from(emailMessagesTable)
    .where(
      and(
        eq(emailMessagesTable.threadId, threadId),
        eq(emailMessagesTable.isDraft, false),
        eq(emailMessagesTable.isInternal, false),
      ),
    )
    .orderBy(desc(emailMessagesTable.sentAt), desc(emailMessagesTable.id));
  const lastInbound = history.find((m) => m.direction === "in") ?? null;
  const lastWithId = history.find((m) => m.rfcMessageId) ?? null;
  const to = lastInbound?.replyTo ?? lastInbound?.fromAddress ?? thread.customerEmail;

  const signature = settings.gmailSignature?.trim();
  const text = signature ? `${body}\n\n--\n${signature}` : body;
  const references = buildReferences(lastWithId);
  const subject = replySubject(thread.subject);

  const sent = await gmail.sendMessage(
    creds,
    {
      from: { address: settings.gmailEmailAddress, name: settings.gmailFromName?.trim() || null },
      to: [to],
      cc,
      subject,
      text,
      inReplyTo: lastWithId?.rfcMessageId ?? null,
      references,
      attachments: resolved.attachments,
    },
    thread.gmailThreadId,
  );
  if (!sent.ok) {
    log.error({ threadId, error: sent.error }, "gmail send failed");
    return { ok: false, status: 502, error: sent.error };
  }

  // El Message-ID y los partId de los adjuntos los pone Gmail al enviar. Hace
  // falta releerlo para que la siguiente respuesta cite a esta, el hilo no se
  // parta en el buzón del cliente, y los adjuntos queden descargables igual que
  // los de un correo entrante.
  const meta = await fetchSentMessageMeta(creds, sent.data.id);
  const values = {
    gmailMessageId: sent.data.id,
    rfcMessageId: meta.rfcMessageId,
    references,
    direction: "out" as const,
    fromAddress: settings.gmailEmailAddress,
    fromName: settings.gmailFromName?.trim() || null,
    toAddresses: [to],
    ccAddresses: cc,
    subject,
    bodyText: text,
    attachments: meta.attachments,
    isDraft: false,
    sentAt: new Date(),
    authorAgentId: opts.authorAgentId ?? draft?.authorAgentId ?? null,
  };

  const message = await db.transaction(async (tx) => {
    // La sincronización pudo leer el correo enviado antes de que llegáramos aquí.
    // Esa copia sobra: la buena es esta, que sabe quién lo escribió.
    await tx.delete(emailMessagesTable).where(eq(emailMessagesTable.gmailMessageId, sent.data.id));
    if (draft) {
      const [updated] = await tx
        .update(emailMessagesTable)
        .set(values)
        .where(eq(emailMessagesTable.id, draft.id))
        .returning();
      return updated;
    }
    const [inserted] = await tx
      .insert(emailMessagesTable)
      .values({ threadId, ...values })
      .returning();
    return inserted;
  });

  await db
    .update(emailThreadsTable)
    .set({ lastMessageAt: new Date(), lastMessagePreview: previewOf(body), unreadCount: 0, updatedAt: new Date() })
    .where(eq(emailThreadsTable.id, threadId));

  // Ya viajaron dentro del correo: la copia en espera no tiene más uso.
  await discardStaged(resolved.staged);

  log.info({ threadId, gmailMessageId: sent.data.id, attachments: meta.attachments.length }, "email reply sent");
  return { ok: true, message };
}

// ── Redactar correo nuevo ─────────────────────────────────────────────────────

export type ComposeOutcome =
  | { ok: true; threadId: number; message: EmailMessage }
  | { ok: false; status: number; error: string };

/**
 * Abre una conversación por correo desde cero, sin que el cliente haya escrito
 * primero. Gmail decide el hilo al enviar (no se puede pedir uno de antemano),
 * así que el envío ocurre antes de crear la fila local.
 */
export async function composeNewEmail(
  opts: {
    to: string;
    cc?: string[];
    subject: string;
    content: string;
    contactId?: number | null;
    attachmentIds?: number[];
    authorAgentId?: number | null;
  },
  log: Log,
): Promise<ComposeOutcome> {
  const settings = await loadGmailSettings();
  const creds = gmailCredentials(settings);
  if (!settings || !creds || !settings.gmailEmailAddress) {
    return { ok: false, status: 409, error: "Gmail no está conectado. Conéctalo en Configuración → Correo." };
  }
  const to = normalizeEmail(opts.to);
  if (!to) return { ok: false, status: 400, error: "La dirección de destino no es válida." };
  const subject = opts.subject.trim();
  if (!subject) return { ok: false, status: 400, error: "El correo necesita un asunto." };
  const body = opts.content.trim();
  if (!body) return { ok: false, status: 400, error: "El correo no puede ir vacío." };
  const cc = [...new Set((opts.cc ?? []).map((a) => a.trim().toLowerCase()).filter(isEmailAddress))];

  const resolved = await resolveStagedAttachments(opts.attachmentIds ?? []);
  if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error };

  // El contacto elegido a mano manda sobre la búsqueda por correo: es quien el
  // administrador señaló, no una coincidencia de la dirección.
  let contactId: number;
  if (opts.contactId != null) {
    const [existing] = await db.select().from(contactsTable).where(eq(contactsTable.id, opts.contactId));
    if (!existing) return { ok: false, status: 404, error: "Contacto no encontrado." };
    contactId = existing.id;
    const update: Partial<typeof contactsTable.$inferInsert> = {};
    if (!existing.email) update.email = to;
    if (!(existing.channels ?? []).includes("email")) update.channels = [...(existing.channels ?? []), "email"];
    if (Object.keys(update).length > 0) await db.update(contactsTable).set(update).where(eq(contactsTable.id, contactId));
  } else {
    contactId = await resolveContactForEmail(to, null);
  }

  const agent = await pickVirtualAgentForEmail();
  const signature = settings.gmailSignature?.trim();
  const text = signature ? `${body}\n\n--\n${signature}` : body;

  const sent = await gmail.sendMessage(
    creds,
    {
      from: { address: settings.gmailEmailAddress, name: settings.gmailFromName?.trim() || null },
      to: [to],
      cc,
      subject,
      text,
      attachments: resolved.attachments,
    },
    null,
  );
  if (!sent.ok) {
    log.error({ to, error: sent.error }, "gmail compose send failed");
    return { ok: false, status: 502, error: sent.error };
  }

  const meta = await fetchSentMessageMeta(creds, sent.data.id);
  const now = new Date();

  const { thread, message } = await db.transaction(async (tx) => {
    const [insertedThread] = await tx
      .insert(emailThreadsTable)
      .values({
        gmailThreadId: sent.data.threadId,
        contactId,
        agentId: agent?.id ?? null,
        subject,
        customerEmail: to,
        lastMessageAt: now,
        lastMessagePreview: previewOf(body),
        status: "open",
        unreadCount: 0,
      })
      .returning();
    // Lo mismo que en la respuesta: si la sincronización se adelantó a leer este
    // envío, esa copia se descarta a favor de la que sabe quién lo escribió.
    await tx.delete(emailMessagesTable).where(eq(emailMessagesTable.gmailMessageId, sent.data.id));
    const [insertedMessage] = await tx
      .insert(emailMessagesTable)
      .values({
        threadId: insertedThread.id,
        gmailMessageId: sent.data.id,
        rfcMessageId: meta.rfcMessageId,
        direction: "out",
        fromAddress: settings.gmailEmailAddress,
        fromName: settings.gmailFromName?.trim() || null,
        toAddresses: [to],
        ccAddresses: cc,
        subject,
        bodyText: text,
        attachments: meta.attachments,
        isDraft: false,
        sentAt: now,
        authorAgentId: opts.authorAgentId ?? null,
      })
      .returning();
    return { thread: insertedThread, message: insertedMessage };
  });

  await discardStaged(resolved.staged);

  log.info({ threadId: thread.id, gmailMessageId: sent.data.id }, "email composed and sent");
  return { ok: true, threadId: thread.id, message };
}

export async function markEmailThreadRead(threadId: number, log: Log): Promise<void> {
  const [thread] = await db
    .update(emailThreadsTable)
    .set({ unreadCount: 0 })
    .where(eq(emailThreadsTable.id, threadId))
    .returning();
  if (!thread) return;
  const creds = gmailCredentials(await loadGmailSettings());
  if (!creds) return;
  // Lo que se leyó en el panel también queda leído en Gmail, para que quien mire
  // el buzón directamente no lo vea como pendiente.
  try {
    await gmail.markThreadRead(creds, thread.gmailThreadId);
  } catch (err) {
    log.warn({ err, threadId }, "gmail mark-read failed");
  }
}

// ── Adjuntos ──────────────────────────────────────────────────────────────────

export async function fetchEmailAttachment(
  messageId: number,
  partId: string,
): Promise<{ ok: true; data: Buffer; filename: string; mimeType: string } | { ok: false; status: number; error: string }> {
  const [row] = await db.select().from(emailMessagesTable).where(eq(emailMessagesTable.id, messageId));
  const attachment = row?.attachments.find((a) => a.partId === partId);
  if (!row?.gmailMessageId || !attachment) return { ok: false, status: 404, error: "Adjunto no encontrado." };
  const creds = gmailCredentials(await loadGmailSettings());
  if (!creds) return { ok: false, status: 409, error: "Gmail no está conectado." };

  // El attachmentId de Gmail puede cambiar entre lecturas; el partId no. Se relee
  // el mensaje para obtener el vigente.
  const message = await gmail.getMessage(creds, row.gmailMessageId);
  if (!message.ok) return { ok: false, status: message.status === 404 ? 404 : 502, error: message.error };
  const stack = message.data.payload ? [message.data.payload] : [];
  while (stack.length) {
    const part = stack.pop()!;
    if (part.partId === partId) {
      if (part.body?.data) {
        return { ok: true, data: Buffer.from(part.body.data, "base64url"), filename: attachment.filename, mimeType: attachment.mimeType };
      }
      if (part.body?.attachmentId) {
        const data = await gmail.getAttachment(creds, row.gmailMessageId, part.body.attachmentId);
        if (!data.ok) return { ok: false, status: 502, error: data.error };
        return { ok: true, data: data.data, filename: attachment.filename, mimeType: attachment.mimeType };
      }
      break;
    }
    stack.push(...(part.parts ?? []));
  }
  return { ok: false, status: 404, error: "Adjunto no encontrado en Gmail." };
}

// ── Vínculo con contactos ─────────────────────────────────────────────────────

export type ContactCandidate = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  channels: string[];
  reason: string;
};

function toCandidate(c: Contact, reason: string): ContactCandidate {
  return { id: c.id, name: c.name, email: c.email, phone: c.phone, avatar: c.avatar, channels: c.channels ?? [], reason };
}

/**
 * Con quién podría ser la misma persona. Sin búsqueda, sugiere: contactos con un
 * teléfono que aparece en los correos del cliente (su firma) o con el mismo
 * nombre. La unión la confirma siempre una persona: un teléfono en un correo
 * puede ser el de otro.
 */
export async function contactCandidatesForThread(threadId: number, search: string | null): Promise<ContactCandidate[] | null> {
  const [thread] = await db.select().from(emailThreadsTable).where(eq(emailThreadsTable.id, threadId));
  if (!thread) return null;
  const excludeId = thread.contactId ?? -1;

  const term = search?.trim();
  if (term) {
    const like = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
    const rows = await db
      .select()
      .from(contactsTable)
      .where(
        and(
          ne(contactsTable.id, excludeId),
          or(
            sql`${contactsTable.name} ilike ${like}`,
            sql`${contactsTable.email} ilike ${like}`,
            sql`${contactsTable.phone} ilike ${like}`,
          ),
        ),
      )
      .orderBy(desc(contactsTable.createdAt))
      .limit(15);
    return rows.map((c) => toCandidate(c, "Coincide con la búsqueda"));
  }

  const [current] = thread.contactId
    ? await db.select().from(contactsTable).where(eq(contactsTable.id, thread.contactId))
    : [];
  const inbound = await db
    .select({ bodyText: emailMessagesTable.bodyText })
    .from(emailMessagesTable)
    .where(and(eq(emailMessagesTable.threadId, threadId), eq(emailMessagesTable.direction, "in")))
    .orderBy(desc(emailMessagesTable.sentAt))
    .limit(5);
  const phones = [
    ...(current?.phone ? [current.phone] : []),
    ...extractPhoneCandidates(inbound.map((m) => stripQuotedReply(m.bodyText)).join("\n")),
  ];

  const found = new Map<number, ContactCandidate>();
  if (phones.length) {
    const withPhone = await db
      .select()
      .from(contactsTable)
      .where(
        and(
          ne(contactsTable.id, excludeId),
          or(phoneSuffixCondition(contactsTable.phone, phones), phoneSuffixCondition(contactsTable.externalId, phones)),
        ),
      )
      .limit(50);
    for (const c of withPhone) {
      // En WhatsApp el externalId es el número del cliente.
      const numbers = [c.phone, (c.channels ?? []).includes("whatsapp") ? c.externalId : null];
      if (phones.some((p) => numbers.some((n) => phonesMatch(n, p)))) {
        found.set(c.id, toCandidate(c, "Tiene el mismo teléfono que aparece en el correo"));
      }
    }
  }
  if (current && !isPlaceholderName(current.name)) {
    const sameName = await db
      .select()
      .from(contactsTable)
      .where(and(ne(contactsTable.id, excludeId), sql`lower(${contactsTable.name}) = ${current.name.toLowerCase()}`))
      .limit(5);
    for (const c of sameName) if (!found.has(c.id)) found.set(c.id, toCandidate(c, "Tiene el mismo nombre"));
  }
  return [...found.values()].slice(0, 8);
}

/**
 * Declara que quien escribe este hilo es `contactId`. Los dos contactos se unen
 * en uno —el elegido se queda—, así que sus chats, correos y datos quedan juntos.
 */
export async function linkThreadToContact(
  threadId: number,
  contactId: number,
  log: Log,
): Promise<{ ok: true; contactId: number } | { ok: false; status: number; error: string }> {
  const [thread] = await db.select().from(emailThreadsTable).where(eq(emailThreadsTable.id, threadId));
  if (!thread) return { ok: false, status: 404, error: "Hilo no encontrado." };
  const [target] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
  if (!target) return { ok: false, status: 404, error: "Contacto no encontrado." };
  if (thread.contactId === contactId) return { ok: true, contactId };

  if (thread.contactId) {
    const merged = await mergeContacts(contactId, thread.contactId, log);
    if (!merged) return { ok: false, status: 404, error: "Contacto no encontrado." };
  } else {
    await db.update(emailThreadsTable).set({ contactId }).where(eq(emailThreadsTable.id, threadId));
  }

  // El elegido puede no tener correo (un contacto de WhatsApp): se le registra el
  // de este hilo para que los próximos correos lleguen directo a su ficha.
  const [after] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
  if (after) {
    const update: Partial<typeof contactsTable.$inferInsert> = {};
    if (!after.email) update.email = thread.customerEmail;
    if (!(after.channels ?? []).includes("email")) update.channels = [...(after.channels ?? []), "email"];
    if (Object.keys(update).length > 0) await db.update(contactsTable).set(update).where(eq(contactsTable.id, contactId));
  }

  await db.insert(emailMessagesTable).values({
    threadId,
    direction: "out",
    bodyText: `🔗 Vinculado al contacto ${target.name}.`,
    isInternal: true,
  });
  return { ok: true, contactId };
}
