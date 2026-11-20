import { metaProfilePatch } from "./meta-contact-profile";
import { eq, ne, and, or, desc, gt, gte, lt, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  conversationsTable,
  contactsTable,
  agentsTable,
  messagesTable,
  integrationSettingsTable,
  capabilitiesTable,
  knowledgeBasesTable,
  contactFactsTable,
  processedEventsTable,
  productsTable,
  agentGroupsTable,
  labelsTable,
  appointmentsTable,
  followupsTable,
  type ExchangeRate,
} from "@workspace/db";
import crypto from "node:crypto";
import {
  getOpenAIClient,
  buildSystemPrompt,
  transcribeAudio,
  audioExtension,
  extractContactInfo,
  extractContextAndProfile,
  PHOTO_DIRECTIVE,
  PHOTO_ENABLED_PROFILES,
  IMAGE_DIRECTIVE,
  ECHOED_TIMESTAMP,
  OPTIONS_DIRECTIVE,
  parseOptionButtons,
  APPOINTMENT_DIRECTIVE,
  APPOINTMENT_ENABLED_PROFILES,
  PROACTIVE_PROFILES,
  parseAppointmentDirective,
  composeFollowupMessage,
  asksToResend,
  showsPurchaseIntent,
  classifyTurnSituation,
  type PendingReplyNeed,
  linksIn,
  removeLinks,
} from "./openai-client";
import {
  FOLLOWUP_KIND_LABELS,
  MARKETING_KINDS,
  isBareGreeting,
  isBareAcknowledgement,
  isMarketingOptOut,
  takeoverInstruction,
  courtesyInstruction,
  quickTurnSituation,
} from "./followup-rules";
import { activeLessonsForPrompt, learnFromCustomerReaction } from "./agent-learning";
import { activeAnswerGuidesForPrompt } from "./answer-training";
import { classifyAndRoute, escalateConversationToGroup, resolveGroupForLabel } from "./workflow-engine";
import {
  matchZone,
  matchZoneChoice,
  handoffNotice,
  handoffKindForProfile,
  type HandoffKind,
  ZONE_QUESTION,
  ZONE_ASKED_NOTE,
  ZONE_CHOICES,
  ZONE_CHOICE_ACTION,
  ZONE_QUESTION_RETRY,
  MAX_ZONE_ASKS,
  defaultBranch,
  hasBranchRouting,
  type BranchMatch,
} from "./branches";
import {
  deliverMessage,
  deliverMediaMessage,
  deliverInteractiveMessage,
  deliverChoiceMessage,
  deliverTemplateMessage,
  downloadWhatsAppMedia,
  downloadMediaUrl,
  uploadWhatsAppMedia,
  fetchSenderProfile,
  settingsForNumber,
  isWhatsAppUserId,
  sentMessageId,
  settleAfterAttachment,
  type Channel,
  type InboundEvent,
  type InteractiveButton,
  type DownloadedMedia,
  type InboundMedia,
  type SenderProfile,
} from "./meta";
import { uploadMedia, signMediaUrl } from "./supabase";
import { needsConversion, toM4a } from "./audio-convert";
import {
  historyContent,
  mediaPreview,
  mediaSummary,
  fileExtension,
  fileNameFromUrl,
  normalizeMime,
  type MediaKind,
} from "./media";
import { resolveInboundNumber, resolveOutboundNumber } from "./whatsapp-numbers";
import { clientConfig, isModuleEnabled } from "./client-config";
import { toPublicUrl } from "./public-url";
import { notifyInboundMessage, notifyChatAssigned } from "./push";
import { ensureActiveSession } from "./conversation-session";
import { maybeSendWelcomeMessage } from "./custom-messages";
import { createOrderFromConversation } from "./orders";
// Mismo ida y vuelta que con orders.ts: cases.ts usa loadSettings de aquí y aquí
// se usa la apertura de casos. El bundler lo resuelve igual que el de pedidos.
import { maybeOpenCase, AFFILIATION_RE } from "./cases";
import { formatShort, humanizeGap, parseLocalDateTime } from "./time";
import { exchangeRatePromptBlock, getTodayRatesForAgent, replacePesosDirectives } from "./exchange-rates";
import { findConflicts } from "./appointments";
import { attachEmailToContact, findUnboundContactByPhone } from "./contact-identity";

export type Log = {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
};

type Conversation = typeof conversationsTable.$inferSelect;

export async function loadSettings() {
  const [row] = await db
    .select()
    .from(integrationSettingsTable)
    .orderBy(integrationSettingsTable.id)
    .limit(1);
  return row ?? null;
}

// Con qué credenciales sale un mensaje de ESTA conversación: las compartidas, con
// el número por el que entró puesta encima. Es el único punto donde se decide por
// dónde se responde — de ahí que las funciones deliver* de abajo la usen todas en
// lugar de loadSettings() a secas.
//
// Fuera de WhatsApp no hay nada que resolver: Instagram y Facebook tienen una sola
// cuenta por instancia.
async function loadSettingsForConversation(
  conv: Pick<Conversation, "channel" | "whatsappNumberId">,
) {
  const settings = await loadSettings();
  if (!settings || conv.channel !== "whatsapp") return settings;
  return settingsForNumber(settings, await resolveOutboundNumber(conv.whatsappNumberId));
}

// Lo que necesita saber una entrega para salir por el número correcto. Sustituye
// al Pick suelto que repetían las cuatro funciones deliver*.
type DeliveryTarget = Pick<Conversation, "id" | "channel" | "externalId" | "whatsappNumberId">;

// Lo que queda de una entrega al canal. `externalMessageId` es el id que le dio
// Meta: se guarda en el mensaje para poder citarlo después (una corrección sale
// como respuesta al original). Null cuando no salió nada.
export type DeliveryOutcome = { ok: boolean; externalMessageId: string | null; error?: string };

// Delivers a customer-facing message to Meta when the conversation is bound to a
// real channel recipient. No-ops silently for internal/demo conversations
// (externalId null) or disabled channels.
export async function deliverConversationMessage(
  conv: DeliveryTarget,
  text: string,
  log: Log,
  opts: { replyTo?: string | null } = {},
): Promise<DeliveryOutcome> {
  if (!conv.externalId) return { ok: true, externalMessageId: null };
  const settings = await loadSettingsForConversation(conv);
  if (!settings) return { ok: true, externalMessageId: null };
  const result = await deliverMessage(settings, conv.channel as Channel, conv.externalId, text, opts);
  if (!result.ok && !result.skipped) {
    // El número emisor va en el log a propósito: cuando Meta rechaza un envío, la
    // primera pregunta es siempre "¿salió por el número correcto?", y sin este
    // dato hay que ir a la base a averiguarlo. Un rechazo típico es contestar
    // desde un número al que el cliente nunca escribió: ahí no hay ventana de
    // 24 h abierta y Meta lo rechaza aunque las credenciales sean válidas.
    log.error(
      {
        conversationId: conv.id,
        channel: conv.channel,
        whatsappNumberId: conv.whatsappNumberId,
        desdeNumero: settings.whatsappPhoneNumberId,
        error: result.error,
      },
      "meta delivery failed",
    );
    return { ok: false, externalMessageId: null, error: result.error };
  }
  // `skipped` existe para que una conversación interna o de demo no intente
  // salir por Meta. Pero cuando el canal está apagado en Configuración con las
  // credenciales puestas, ESTE camino se traga todas las respuestas del agente
  // sin dejar rastro: el mensaje se guarda, el panel lo muestra contestado y al
  // cliente no le llega nada. Diagnosticarlo desde los logs era imposible
  // porque no había logs. Ahora lo dice.
  if (result.skipped) {
    log.warn(
      { conversationId: conv.id, channel: conv.channel, reason: result.error },
      "respuesta NO enviada: el canal está apagado en Configuración → Conexión con Meta",
    );
    return { ok: true, externalMessageId: null };
  }
  return { ok: true, externalMessageId: sentMessageId(result) };
}

// Entrega un archivo que el equipo adjuntó en el chat. En WhatsApp se sube antes a
// Meta y sale por su id: así no depende de que nuestra URL sea pública. Si esa
// subida falla, sale por enlace firmado. Messenger e Instagram solo aceptan
// adjuntos por URL y sin texto, así que ahí va el enlace y el pie detrás, aparte.
//
// Devuelve el error del canal para que quien lo mandó se entere: un archivo que
// Meta rechaza (formato, tamaño, ventana de 24 h cerrada) no puede quedar en el
// hilo como si hubiera llegado.
export async function deliverConversationMedia(
  conv: DeliveryTarget,
  file: { kind: MediaKind; path: string; data: Buffer; mimeType: string; name: string; caption: string | null },
  log: Log,
  opts: { replyTo?: string | null } = {},
): Promise<DeliveryOutcome> {
  if (!conv.externalId) return { ok: true, externalMessageId: null };
  const settings = await loadSettingsForConversation(conv);
  if (!settings) return { ok: true, externalMessageId: null };
  const channel = conv.channel as Channel;

  let ref: { mediaId: string } | { url: string } | null = null;
  if (channel === "whatsapp" && settings.whatsappEnabled) {
    const uploaded = await uploadWhatsAppMedia(settings, file.data, file.mimeType);
    if (uploaded.ok) ref = { mediaId: uploaded.id };
    else log.warn({ conversationId: conv.id, error: uploaded.error }, "whatsapp media upload failed, sending by signed link");
  }
  if (!ref) {
    // Meta descarga el archivo al recibir el envío, no cuando el cliente lo abre:
    // un día de vida sobra.
    const url = await signMediaUrl(file.path, 60 * 60 * 24);
    if (!url) return { ok: false, externalMessageId: null, error: "no se pudo generar el enlace del archivo" };
    ref = { url };
  }

  const result = await deliverMediaMessage(
    settings,
    channel,
    conv.externalId,
    { type: file.kind, ...ref, caption: file.caption, filename: file.name },
    opts,
  );
  if (result.skipped) {
    log.warn(
      { conversationId: conv.id, channel: conv.channel, reason: result.error },
      "adjunto NO enviado: el canal está apagado en Configuración → Conexión con Meta",
    );
    return { ok: true, externalMessageId: null };
  }
  if (!result.ok) {
    log.error(
      {
        conversationId: conv.id,
        channel: conv.channel,
        whatsappNumberId: conv.whatsappNumberId,
        desdeNumero: settings.whatsappPhoneNumberId,
        kind: file.kind,
        mimeType: file.mimeType,
        error: result.error,
      },
      "meta media delivery failed",
    );
    return { ok: false, externalMessageId: null, error: result.error };
  }
  if (channel !== "whatsapp" && file.caption) {
    await deliverConversationMessage(conv, file.caption, log);
  }
  return { ok: true, externalMessageId: sentMessageId(result) };
}

// Envía una plantilla aprobada de WhatsApp para reabrir una conversación cuya
// ventana de 24h ya cerró. A diferencia de deliverConversationMessage, esto
// funciona aunque la ventana esté cerrada — es justo lo que la plantilla existe
// para hacer — así que no hace la comprobación de messagingWindowState.
export async function deliverConversationTemplate(
  conv: DeliveryTarget,
  template: { name: string; language: string; components: Record<string, unknown>[] },
  log: Log,
): Promise<DeliveryOutcome> {
  if (!conv.externalId) return { ok: true, externalMessageId: null };
  const settings = await loadSettingsForConversation(conv);
  if (!settings) return { ok: true, externalMessageId: null };
  const result = await deliverTemplateMessage(settings, conv.externalId, template);
  if (!result.ok && !result.skipped) {
    log.error(
      {
        conversationId: conv.id,
        channel: conv.channel,
        whatsappNumberId: conv.whatsappNumberId,
        desdeNumero: settings.whatsappPhoneNumberId,
        template: template.name,
        error: result.error,
      },
      "meta template delivery failed",
    );
    return { ok: false, externalMessageId: null, error: result.error };
  }
  if (result.skipped) {
    log.warn(
      { conversationId: conv.id, channel: conv.channel, reason: result.error },
      "plantilla NO enviada: el canal está apagado en Configuración → Conexión con Meta",
    );
    return { ok: true, externalMessageId: null };
  }
  return { ok: true, externalMessageId: sentMessageId(result) };
}

// El estado de la ventana de 24h de atención al cliente de Meta: solo dentro de
// ella un canal acepta un mensaje libre; pasado eso hace falta una plantilla
// aprobada (deliverConversationTemplate). Se cuenta desde el último mensaje real
// del cliente, no desde cualquier actividad de la conversación.
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

export function messagingWindowState(
  lastCustomerMessageAt: Date | null,
  now: Date = new Date(),
): { open: boolean; expiresAt: Date | null } {
  if (!lastCustomerMessageAt) return { open: false, expiresAt: null };
  const expiresAt = new Date(lastCustomerMessageAt.getTime() + MESSAGING_WINDOW_MS);
  return { open: expiresAt.getTime() > now.getTime(), expiresAt };
}

// La columna last_customer_message_at llegó después que las conversaciones: sin
// esto, todo chat anterior se vería con la ventana cerrada aunque el cliente
// hubiera escrito hace un minuto. Solo toca las que siguen en null, así que
// después del primer arranque no cambia nada.
export async function backfillLastCustomerMessageAt(log: Log): Promise<void> {
  const result = await db.execute(sql`
    UPDATE ${conversationsTable} AS c
    SET last_customer_message_at = m.last_at
    FROM (
      SELECT conversation_id, max(created_at) AS last_at
      FROM ${messagesTable}
      WHERE sender = 'contact'
      GROUP BY conversation_id
    ) AS m
    WHERE m.conversation_id = c.id AND c.last_customer_message_at IS NULL
  `);
  if (result.rowCount) log.info({ updated: result.rowCount }, "backfilled last_customer_message_at");
}

// Entrega una pregunta del agente con sus opciones como botones del canal
// (interactivos en WhatsApp, quick replies en Messenger/IG). Si el canal rechaza
// el interactivo, reintenta en texto plano con las opciones listadas: el cliente
// pierde el toque, pero no se queda sin la pregunta.
async function deliverConversationButtons(
  conv: DeliveryTarget,
  text: string,
  buttons: InteractiveButton[],
  log: Log,
): Promise<void> {
  if (!conv.externalId) return;
  const settings = await loadSettingsForConversation(conv);
  if (!settings) return;

  const result = await deliverInteractiveMessage(settings, conv.channel as Channel, conv.externalId, {
    text,
    buttons,
  });
  if (result.ok || result.skipped) return;

  log.error(
    { conversationId: conv.id, channel: conv.channel, error: result.error },
    "interactive options delivery failed, falling back to plain text",
  );
  await deliverMessage(settings, conv.channel as Channel, conv.externalId, withOptionsAsText(text, buttons));
}

// Las opciones escritas bajo el texto. Es lo que se guarda en el historial (para
// que el panel muestre qué pudo elegir el cliente) y el respaldo cuando no hay
// botones disponibles.
function withOptionsAsText(text: string, buttons: InteractiveButton[]): string {
  return `${text}\n\n${buttons.map((b) => `• ${b.label}`).join("\n")}`;
}

// Las tiendas, para que el cliente elija la suya de un toque en vez de teclear su
// sector. Si el canal rechaza el interactivo, la pregunta sale igual en texto con
// las tiendas listadas: escribir "Santiago" lleva al mismo sitio que tocarlo.
async function deliverZoneChoices(
  conv: DeliveryTarget,
  question: string,
  log: Log,
): Promise<void> {
  if (!conv.externalId) return;
  const settings = await loadSettingsForConversation(conv);
  if (!settings) return;

  const result = await deliverChoiceMessage(settings, conv.channel as Channel, conv.externalId, {
    text: question,
    actionLabel: ZONE_CHOICE_ACTION,
    options: ZONE_CHOICES,
  });
  if (result.ok || result.skipped) return;

  log.error(
    { conversationId: conv.id, channel: conv.channel, error: result.error },
    "zone choices delivery failed, falling back to plain text",
  );
  await deliverMessage(
    settings,
    conv.channel as Channel,
    conv.externalId,
    withOptionsAsText(question, ZONE_CHOICES.map((c) => ({ id: c.id, label: c.label }))),
  );
}

// Sends the catalog photo of a product the agent asked for with [[FOTO:slug]].
// The slug is resolved against the products table (see runVirtualAgentReply)
// rather than trusting a URL from the model, so a hallucinated identifier sends
// nothing instead of a broken link.
async function deliverProductPhoto(
  conv: DeliveryTarget,
  product: { slug: string; name: string; url: string; imageUrl: string },
  log: Log,
): Promise<void> {
  if (!conv.externalId) return;

  const settings = await loadSettingsForConversation(conv);
  if (!settings) return;

  // Solo WhatsApp lleva pie: en Instagram y Messenger el enlace se queda en el
  // texto del agente (ver runVirtualAgentReply).
  const caption = mediaHasCaption(conv.channel) ? `${product.name}\n${product.url}` : null;
  const result = await deliverMediaMessage(settings, conv.channel as Channel, conv.externalId, {
    type: "image",
    url: product.imageUrl,
    caption,
  });
  if (!result.ok && !result.skipped) {
    log.error({ conversationId: conv.id, slug: product.slug, error: result.error }, "product photo delivery failed");
    return;
  }

  // Se guarda con su pie, como un adjunto cualquiera: así el panel muestra la
  // ficha que recibió el cliente y el agente, al leer el historial, sabe que la
  // foto y el enlace ya salieron.
  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: "bot",
    content: caption ?? mediaSummary("image", null),
    mediaUrl: product.imageUrl,
    type: "image",
    isAiSuggestion: false,
  });
}

// WhatsApp admite pie en las imágenes; los adjuntos de Instagram y Messenger no.
function mediaHasCaption(channel: string): boolean {
  return channel === "whatsapp";
}

// WhatsApp corta el pie de una imagen a 1024 caracteres.
const WHATSAPP_CAPTION_LIMIT = 1024;

/** Si la imagen fija va delante del texto del agente (business.agentImages[clave].placement). */
export function agentImageLeads(key: string): boolean {
  return clientConfig.business.agentImages[key]?.placement === "before";
}

// Sends a fixed business image the agent asked for with [[IMAGEN:clave]] (the
// transfer accounts, a price list…), declared in business.agentImages.
//
// `leadingText` es el texto del agente cuando la imagen va primero (placement
// "before"). En WhatsApp viaja como pie de la imagen —una sola burbuja, imagen
// arriba y texto abajo, como la bienvenida— y se devuelve `carriedText: true` para
// que no se mande otra vez. Donde no cabe como pie (Instagram y Messenger no lo
// admiten; en WhatsApp, más de 1024 caracteres) la imagen sale sola y el texto lo
// manda quien llama, después de la pausa que evita que se le adelante.
async function deliverAgentImage(
  conv: DeliveryTarget,
  key: string,
  log: Log,
  opts: { leadingText?: string } = {},
): Promise<{ carriedText: boolean }> {
  const notCarried = { carriedText: false };
  if (!conv.externalId) return notCarried;
  const image = clientConfig.business.agentImages[key];
  if (!image) {
    log.info({ conversationId: conv.id, key }, "agent image skipped: no image declared with that key");
    return notCarried;
  }
  const url = toPublicUrl(image.url);
  if (!url) {
    log.error(
      { conversationId: conv.id, key },
      "agent image skipped: la ruta es relativa y no hay PUBLIC_BASE_URL ni RAILWAY_PUBLIC_DOMAIN para completarla",
    );
    return notCarried;
  }

  const settings = await loadSettingsForConversation(conv);
  if (!settings) return notCarried;

  const withText =
    opts.leadingText && mediaHasCaption(conv.channel) ? [opts.leadingText, image.caption].filter(Boolean).join("\n\n") : null;
  const carriedText = withText != null && withText.length <= WHATSAPP_CAPTION_LIMIT;
  const caption = carriedText ? withText : image.caption;

  const result = await deliverMediaMessage(settings, conv.channel as Channel, conv.externalId, {
    type: "image",
    url,
    caption,
  });
  if (!result.ok && !result.skipped) {
    log.error({ conversationId: conv.id, key, error: result.error }, "agent image delivery failed");
    return notCarried;
  }
  // Lo que sigue a la imagen en Instagram y Messenger (su pie como texto, o el
  // texto del agente cuando la imagen va primero) espera a que ella llegue.
  if (result.ok && !mediaHasCaption(conv.channel) && (image.caption || opts.leadingText)) {
    await settleAfterAttachment();
  }
  // Instagram y Messenger descartan el pie, y en él van los datos que el cliente
  // tiene que copiar (los números de cuenta): ahí sale como texto aparte.
  if (image.caption && !mediaHasCaption(conv.channel)) {
    await deliverMessage(settings, conv.channel as Channel, conv.externalId, image.caption);
  }

  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: "bot",
    content: caption ?? mediaSummary("image", null),
    mediaUrl: url,
    type: "image",
    isAiSuggestion: false,
    externalMessageId: sentMessageId(result),
  });
  return { carriedText };
}

// ── Human takeover window ─────────────────────────────────────────────────────
// Una conversación en manos de un humano es suya: el bot no habla por encima.
// Pero si el humano no aparece, el cliente se queda escribiendo solo. Pasada esta
// ventana sin que nadie del equipo escriba, el agente virtual la retoma; el humano
// la recupera en cuanto escriba o la reasigne desde el panel.
//
// 10 horas desde el 2026-09-20. Eran 15 minutos, y era muy poco: a una clienta
// que esperaba el rastreo de su pedido el bot le retomaba el chat cada vez que
// escribía, volvía a escalarlo y volvía a prometerle una persona que ya estaba
// avisada. Lo que se traspasa a una persona se queda con esa persona: el bot no
// vuelve a meterse el mismo día de trabajo.
const DEFAULT_HUMAN_REPLY_GRACE_MINUTES = 10 * 60;

export const HUMAN_REPLY_GRACE_MINUTES = (() => {
  const raw = Number(process.env.HUMAN_REPLY_GRACE_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HUMAN_REPLY_GRACE_MINUTES;
})();

const HUMAN_REPLY_GRACE_MS = HUMAN_REPLY_GRACE_MINUTES * 60_000;

// ¿La conversación estaba en manos humanas ANTES de este mensaje? Cuenta tanto la
// asignada a una persona como la que espera en la cola de un grupo.
async function isHumanOwned(conv: Conversation): Promise<boolean> {
  if (conv.status === "pending" && conv.groupId != null) return true;
  if (!conv.agentId) return false;
  const [owner] = await db.select().from(agentsTable).where(eq(agentsTable.id, conv.agentId));
  return owner?.type === "human";
}

// Cuánto lleva la conversación sin que nadie de nuestro lado escriba. La medida es
// el último mensaje del equipo, no el del cliente: lo que importa es cuánto lleva
// sin atención, no cuánto lleva el cliente insistiendo.
async function teamQuietMs(conv: Conversation): Promise<number> {
  const [lastFromTeam] = await db
    .select({ createdAt: messagesTable.createdAt })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conv.id),
        eq(messagesTable.isInternal, false),
        ne(messagesTable.sender, "contact"),
      ),
    )
    .orderBy(desc(messagesTable.createdAt))
    .limit(1);
  const quietSince = lastFromTeam?.createdAt ?? conv.sessionStartedAt;
  return Date.now() - quietSince.getTime();
}

// ¿El traspaso a una persona sigue vigente? Lo está mientras la conversación esté
// en manos del equipo y no haya pasado la ventana de gracia desde su último
// mensaje. Lo consulta también el barrido de "sin respuesta" (lib/followups.ts):
// sin esto, el seguimiento le pasaba el chat al agente virtual a las 2 horas y se
// saltaba la ventana entera.
export async function humanHandoffStillFresh(conv: Conversation): Promise<boolean> {
  if (!(await isHumanOwned(conv))) return false;
  return (await teamQuietMs(conv)) < HUMAN_REPLY_GRACE_MS;
}

// Libera una conversación que el equipo humano dejó sin atender para que el agente
// virtual conteste. Devuelve false (y no toca nada) mientras el humano siga dentro
// de su ventana de gracia.
async function releaseAbandonedHumanChat(conv: Conversation, log: Log): Promise<boolean> {
  // Soltarla solo tiene sentido si hay quien la recoja. Con el módulo de IA apagado
  // —o sin ningún agente virtual activo en ese canal— liberarla dejaría el chat sin
  // dueño y al cliente sin nadie: la persona que lo atiende se queda con él.
  if (!isModuleEnabled("aiAgents")) return false;
  if (!(await pickVirtualAgentForChannel(conv.channel))) return false;

  const quietMs = await teamQuietMs(conv);
  if (quietMs < HUMAN_REPLY_GRACE_MS) return false;

  await db
    .update(conversationsTable)
    .set({ agentId: null, groupId: null, status: "open", updatedAt: new Date() })
    .where(eq(conversationsTable.id, conv.id));

  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: "bot",
    content: `🤖 El agente virtual retomó la conversación: ${humanizeGap(quietMs)} sin respuesta del equipo.`,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });

  log.info(
    { conversationId: conv.id, quietMinutes: Math.round(quietMs / 60_000) },
    "abandoned human chat released to the virtual agent",
  );
  return true;
}

// ── Virtual agent auto-reply ──────────────────────────────────────────────────
const inFlightReplies = new Set<number>();

// Si un agente virtual va a contestar esta conversación: los mismos filtros que
// runVirtualAgentReply pasa antes de llamar al modelo, sin llamarlo.
async function virtualAgentWillAnswer(conversationId: number): Promise<boolean> {
  if (!isModuleEnabled("aiAgents") || !getOpenAIClient()) return false;
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!conv) return false;
  if (!conv.agentId) return !!(await pickVirtualAgentForChannel(conv.channel));
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, conv.agentId));
  if (!agent || agent.type !== "virtual" || !agent.isActive) return false;
  const channels = agent.channels ?? [];
  return channels.length === 0 || channels.includes(conv.channel);
}

// `buttonId` es la opción que el cliente tocó, si tocó alguna. Solo importa para
// la lista de tiendas: elegida a dedo no hay nada que interpretar.
// `takeover`: el agente retoma un chat que el equipo dejó sin contestar (la
// ventana de gracia pasó o el seguimiento "sin respuesta" se lo pasó). No es una
// conversación nueva: tiene que leer dónde quedó y, si el cliente no pedía nada,
// cerrar con cortesía en vez de preguntarle en qué puede ayudar.
export async function maybeRespondWithVirtualAgent(
  conversationId: number,
  log: Log,
  opts: { buttonId?: string | null; takeover?: boolean } = {},
): Promise<void> {
  if (inFlightReplies.has(conversationId)) return;
  inFlightReplies.add(conversationId);
  try {
    await runVirtualAgentReply(conversationId, log, 0, opts.buttonId ?? null, opts.takeover ?? false);
  } finally {
    inFlightReplies.delete(conversationId);
  }
}

// Tope de traspasos encadenados dentro de un mismo turno del cliente. Evita que
// dos agentes que se escalan mutuamente se pasen la conversación en bucle sin
// que nadie conteste.
const MAX_HANDOFF_HOPS = 2;

// Duración de la cita que agenda el agente virtual. No se le pregunta al modelo:
// cuánto dura cada servicio lo sabe el negocio, no la conversación, y una
// duración inventada desplazaría el resto de la agenda. El equipo la ajusta
// desde la pantalla de agenda.
const DEFAULT_APPOINTMENT_MINUTES = 60;

interface BookingOutcome {
  /** Cita creada, si el hueco estaba libre. */
  appointmentId: number | null;
  /**
   * Texto con el que hay que sustituir la respuesta del agente. Se usa cuando el
   * agente ya dio la cita por hecha y resultó que no se podía: su confirmación
   * no puede salir tal cual.
   */
  replacementText: string | null;
}

/**
 * Crea la cita que el agente virtual acordó, si la marca [[CITA: …]] está en su
 * respuesta y el horario está libre.
 *
 * El modelo propone; la disponibilidad la decide la base de datos. Cuando el
 * hueco está tomado no se crea nada y se devuelve un texto de reemplazo, porque
 * a esas alturas el agente ya escribió "listo, te espero el sábado" y ese
 * mensaje no puede llegarle al cliente.
 */
async function bookFromDirective(
  reply: string,
  conv: { id: number; contactId: number },
  agent: { id: number; profileType: string | null },
  log: Log,
): Promise<BookingOutcome | null> {
  if (!isModuleEnabled("appointments")) return null;
  if (!APPOINTMENT_ENABLED_PROFILES.has(agent.profileType ?? "general")) return null;

  const directive = parseAppointmentDirective(reply);
  if (!directive) return null;

  const startsAt = parseLocalDateTime(directive.when);
  if (!startsAt) {
    // La marca vino mal formada. No se agenda ni se corrige el texto: el cliente
    // recibe la confirmación del agente y queda registrada en el log para que el
    // equipo la vea en la conversación.
    log.error(
      { conversationId: conv.id, when: directive.when },
      "cita no creada: la fecha de la marca no tiene el formato AAAA-MM-DD HH:MM",
    );
    return null;
  }

  if (startsAt.getTime() < Date.now()) {
    log.warn(
      { conversationId: conv.id, startsAt },
      "cita no creada: el agente propuso una fecha que ya pasó",
    );
    return {
      appointmentId: null,
      replacementText:
        "Disculpa, se me cruzaron las fechas. ¿Me confirmas el día y la hora que te quedan bien?",
    };
  }

  const conflicts = await findConflicts({ startsAt, durationMinutes: DEFAULT_APPOINTMENT_MINUTES });
  if (conflicts.length > 0) {
    log.info(
      { conversationId: conv.id, startsAt, conflicts: conflicts.length },
      "cita no creada: el horario ya estaba ocupado",
    );
    // No se le dice con qué choca: la agenda es de otros clientes.
    return {
      appointmentId: null,
      replacementText:
        "Esa hora ya está ocupada. ¿Te viene bien otra hora ese mismo día, o prefieres otro día?",
    };
  }

  const [created] = await db
    .insert(appointmentsTable)
    .values({
      contactId: conv.contactId,
      conversationId: conv.id,
      // Sin persona asignada: la agendó el agente virtual y el equipo decide
      // después quién la atiende.
      agentId: null,
      service: directive.service,
      location: directive.location,
      startsAt,
      durationMinutes: DEFAULT_APPOINTMENT_MINUTES,
      // `pending` y no `confirmed`: nadie del equipo la ha mirado todavía.
      status: "pending",
      source: "ai",
    })
    .returning({ id: appointmentsTable.id });

  log.info(
    { conversationId: conv.id, appointmentId: created.id, startsAt, agentId: agent.id },
    "cita creada por el agente virtual",
  );

  return { appointmentId: created.id, replacementText: null };
}

type AgentRow = typeof agentsTable.$inferSelect;
type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

// El prompt con el que habla un agente virtual en una conversación: su rol, sus
// capacidades y bases de conocimiento, quién es el cliente, lo que pasó antes y,
// si el cliente contesta a un seguimiento nuestro, por qué se le escribió. Lo
// comparten la respuesta normal y el mensaje con que un agente retoma un chat.
async function agentConversationPrompt(
  agent: AgentRow,
  conv: Conversation,
  history: Array<typeof messagesTable.$inferSelect>,
  opts: { isNewSession: boolean; previousAt: Date | null; followupId: number | null },
): Promise<{
  messages: ChatTurn[];
  contact: typeof contactsTable.$inferSelect | null;
  // La tasa que vio el agente: con ella se resuelven sus [[PESOS: …]], para que el
  // monto que recibe el cliente salga de la misma cifra que el agente mencionó.
  rates: ExchangeRate[] | null;
}> {
  // Load the agent's capabilities and any linked knowledge bases so the AI answers
  // in line with them.
  const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.agentId, agent.id));
  const kbIds = [...new Set(caps.map((c) => c.knowledgeBaseId).filter((x): x is number => x != null))];
  const kbs = kbIds.length
    ? await db.select().from(knowledgeBasesTable).where(inArray(knowledgeBasesTable.id, kbIds))
    : [];

  // Load the contact's commercial profile + facts + this chat's running summary so
  // the agent responds in line with who it's talking to.
  const [contact] = conv.contactId
    ? await db.select().from(contactsTable).where(eq(contactsTable.id, conv.contactId))
    : [null];
  const facts = contact
    ? await db.select().from(contactFactsTable).where(eq(contactFactsTable.contactId, contact.id))
    : [];

  const [followup] = opts.followupId
    ? await db
        .select({ kind: followupsTable.kind, context: followupsTable.context })
        .from(followupsTable)
        .where(eq(followupsTable.id, opts.followupId))
    : [];

  const rates = await getTodayRatesForAgent();
  const [previousRows, lessons, guides] = await Promise.all([
    previousSessionRows(conv),
    activeLessonsForPrompt(),
    activeAnswerGuidesForPrompt(),
  ]);
  const previousTail = formatPreviousTail(previousRows);

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
    contactContext: buildContactContext(contact ?? null, facts, conv.contextSummary),
    referenceContext: buildReferenceContext(conv.historySummary, opts.previousAt),
    session: {
      now: new Date(),
      startedAt: conv.sessionStartedAt,
      isNew: opts.isNewSession,
    },
    followup: followup ? { purpose: FOLLOWUP_KIND_LABELS[followup.kind], context: followup.context } : null,
    exchangeRate: rates ? exchangeRatePromptBlock(rates) : null,
    channel: conv.channel,
    phone: conv.channel === "whatsapp" ? (contact?.phone ?? null) : null,
    previousTail,
    lessons,
    guides,
  });

  // Cuando el cliente cita un mensaje ("responder" en WhatsApp), el agente tiene
  // que saber a cuál: una clienta contestó citando el formato del pedido
  // "puedo recibir después de las 10:00 am", y sin la cita esa frase suelta no
  // decía a qué respondía.
  const recent = history.slice(-20);
  const quotedIds = [...new Set(recent.map((m) => m.replyToMessageId).filter((id): id is number => id != null))];
  const quoted = quotedIds.length
    ? await db
        .select({ id: messagesTable.id, type: messagesTable.type, content: messagesTable.content, mediaName: messagesTable.mediaName })
        .from(messagesTable)
        .where(inArray(messagesTable.id, quotedIds))
    : [];
  const quotedById = new Map(quoted.map((q) => [q.id, q]));
  const quotePrefix = (m: (typeof history)[number]): string => {
    const q = m.replyToMessageId != null ? quotedById.get(m.replyToMessageId) : undefined;
    return q ? `(respondiendo a «${historyContent(q).replace(/\s+/g, " ").slice(0, 200)}») ` : "";
  };

  // Each turn carries its local timestamp so the model can tell a reply that
  // follows 30 seconds later from one that follows three days later.
  const messages: ChatTurn[] = [
    { role: "system", content: systemPrompt },
    ...recent.map((m) => ({
      role: (m.sender === "contact" ? "user" : "assistant") as "user" | "assistant",
      content: `[${formatShort(m.createdAt)}] ${quotePrefix(m)}${historyContent(m)}`,
    })),
  ];
  return { messages, contact: contact ?? null, rates };
}

// Lo último que se habló antes de que empezara la sesión actual, cuando terminó
// hace poco. El cliente suele contestarle a eso —"Gracias" a la guía que le
// mandaron, "puedo recibir después de las 10" al formato del pedido— y el agente
// solo veía la sesión nueva, con esa frase suelta. Va aparte del historial, como
// referencia: la regla de no retomar temas viejos por su cuenta sigue en pie.
// 72 h, la misma ventana en que una respuesta a un seguimiento se sigue leyendo
// como respuesta: un «Ay lástima, gracias» llegó 22 h después del «no enviamos a
// España» que agradecía.
const PREVIOUS_TAIL_MESSAGES = 6;
const PREVIOUS_TAIL_WINDOW_MS = 72 * 60 * 60 * 1000;

type MessageRow = typeof messagesTable.$inferSelect;

async function previousSessionRows(conv: Conversation): Promise<MessageRow[]> {
  const rows = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conv.id),
        lt(messagesTable.createdAt, conv.sessionStartedAt),
        eq(messagesTable.isInternal, false),
      ),
    )
    .orderBy(desc(messagesTable.createdAt))
    .limit(PREVIOUS_TAIL_MESSAGES);
  if (!rows.length) return [];
  if (conv.sessionStartedAt.getTime() - rows[0].createdAt.getTime() > PREVIOUS_TAIL_WINDOW_MS) return [];
  return rows.reverse();
}

function formatPreviousTail(rows: MessageRow[]): string | null {
  if (!rows.length) return null;
  return rows
    .map((m) => {
      const who = m.sender === "contact" ? "Cliente" : m.sender === "bot" ? "Asistente" : "Persona del equipo";
      return `[${formatShort(m.createdAt)}] ${who}: ${historyContent(m)}`;
    })
    .join("\n");
}

// Redacta, con la voz y el conocimiento del agente, el mensaje con que retoma una
// conversación ya cerrada. No lo envía: lo decide lib/followups.ts, que cae a una
// plantilla si esto devuelve null.
export async function composeAgentFollowup(
  conv: Conversation,
  agent: AgentRow,
  instruction: string,
): Promise<string | null> {
  const history = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conv.id),
        gte(messagesTable.createdAt, conv.sessionStartedAt),
        eq(messagesTable.isInternal, false),
      ),
    )
    .orderBy(messagesTable.createdAt);
  const { messages, rates } = await agentConversationPrompt(agent, conv, history, {
    isNewSession: false,
    previousAt: null,
    followupId: null,
  });
  const text = await composeFollowupMessage({ model: agent.model, messages, instruction });
  return text === null ? null : replacePesosDirectives(text, rates);
}

// La nota interna que deja un pedido confirmado. Es también la marca que evita
// confirmarlo dos veces en la misma sesión, así que el texto se comparte en vez
// de repetirse suelto.
const ORDER_CONFIRMED_NOTE =
  "🧾 Pedido confirmado: el cliente dice que ya transfirió. Verifica el pago y, si está bien, marca la venta como cerrada.";

async function runVirtualAgentReply(
  conversationId: number,
  log: Log,
  hops = 0,
  buttonId: string | null = null,
  takeover = false,
): Promise<void> {
  // Instancia sin módulo de IA: el cliente compró bandeja y equipo humano, no
  // agentes virtuales. Se corta aquí y no en cada paso siguiente, para que
  // ninguna rama posterior conteste por su cuenta.
  if (!isModuleEnabled("aiAgents")) {
    log.info({ conversationId }, "virtual agent skipped: módulo aiAgents apagado para esta instancia");
    return;
  }

  let [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!conv) {
    log.info({ conversationId }, "virtual agent skipped: conversation not found");
    return;
  }
  // An unassigned conversation still gets an answer: claim it for an active virtual
  // agent on its channel, the same way inbound webhooks assign one at creation time.
  // Without this, a conversation that predates the agent (or was never assigned) stays
  // silent no matter how many virtual agents are configured.
  if (!conv.agentId) {
    const picked = await pickVirtualAgentForChannel(conv.channel);
    if (!picked) {
      log.info({ conversationId, channel: conv.channel }, "virtual agent skipped: no active virtual agent for this channel");
      return;
    }
    [conv] = await db
      .update(conversationsTable)
      .set({ agentId: picked.id, updatedAt: new Date() })
      .where(eq(conversationsTable.id, conversationId))
      .returning();
    log.info({ conversationId, agentId: picked.id }, "virtual agent auto-assigned to unassigned conversation");
  }

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, conv.agentId!));
  if (!agent) {
    log.info({ conversationId, agentId: conv.agentId }, "virtual agent skipped: assigned agent not found");
    return;
  }
  if (agent.type !== "virtual" || !agent.isActive) {
    log.info(
      { conversationId, agentId: agent.id, type: agent.type, isActive: agent.isActive },
      "virtual agent skipped: assigned agent is not an active virtual agent",
    );
    return;
  }

  // Only respond if the conversation's channel is one of the agent's assigned channels
  const channels = agent.channels ?? [];
  if (channels.length > 0 && !channels.includes(conv.channel)) {
    log.info({ conversationId, agentId: agent.id, channel: conv.channel }, "virtual agent skipped: channel not assigned");
    return;
  }

  const client = getOpenAIClient();
  if (!client) {
    // Sin esto la línea sale suelta entre cientos de peticiones y no se puede
    // atar al chat que quedó sin respuesta, que es justo lo que se busca al
    // rastrear un silencio del agente.
    log.error(
      { conversationId, agentId: agent.id },
      "virtual agent skipped: falta AI_INTEGRATIONS_OPENAI_API_KEY",
    );
    return;
  }

  // Only the CURRENT session is the conversation being answered. Messages from
  // sessions that already closed stay in the thread for the human panel, but the
  // agent sees them only through the reference summary — otherwise it keeps pulling
  // a topic that ended days ago into a brand-new "Hola".
  const history = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conversationId),
        gte(messagesTable.createdAt, conv.sessionStartedAt),
        eq(messagesTable.isInternal, false),
      ),
    )
    .orderBy(messagesTable.createdAt);

  const [previous] = await db
    .select({ createdAt: messagesTable.createdAt })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conversationId),
        lt(messagesTable.createdAt, conv.sessionStartedAt),
        eq(messagesTable.isInternal, false),
      ),
    )
    .orderBy(desc(messagesTable.createdAt))
    .limit(1);

  // First customer turn of a session that follows an earlier, closed one: the agent
  // must open it as a new conversation, not resume the old thread. Unless the
  // customer is answering a follow-up we sent: then the thread is that message.
  // Situación del chat: si el cliente solo cerró (y ya se le había despedido), no
  // se le contesta; si agradece, confirma o lamenta, un cierre cortés y nada más.
  // No aplica al retomar (ahí manda takeoverInstruction) ni a un botón tocado.
  let courtesy = false;
  if (hops === 0 && !takeover && !buttonId) {
    const situation = await turnSituation(history, await previousSessionRows(conv));
    if (situation === "none") {
      await db.insert(messagesTable).values({
        conversationId,
        sender: "bot",
        content: "🤫 Sin respuesta del agente: el cliente solo cerró la conversación y ya se le había despedido.",
        type: "text",
        isAiSuggestion: false,
        isInternal: true,
      });
      log.info({ conversationId, agentId: agent.id }, "virtual agent stayed silent: the customer only closed the chat");
      return;
    }
    courtesy = situation === "courtesy";
  }

  // Retomar un chat que el equipo dejó sin contestar tampoco es empezar de cero,
  // ni contestarle un "gracias" a lo que se habló ayer.
  const isNewSession =
    !takeover &&
    !courtesy &&
    !conv.followupId &&
    !!previous &&
    history.filter((m) => m.sender === "contact").length <= 1;

  // Si lo único que faltaba para traspasarlo era saber de qué zona escribe y
  // acaba de decirlo, la conversación se va ya a su tienda: no hace falta
  // gastar un turno más del modelo.
  if (
    agent.escalateToGroupId &&
    (await completePendingZoneHandoff(
      conv,
      agent.escalateToGroupId,
      history,
      buttonId,
      handoffKindForProfile(agent.profileType),
      log,
    ))
  ) {
    return;
  }

  const { messages: chatMessages, contact, rates } = await agentConversationPrompt(agent, conv, history, {
    isNewSession,
    previousAt: previous?.createdAt ?? null,
    followupId: conv.followupId,
  });
  if (takeover) chatMessages.push({ role: "system", content: takeoverInstruction() });
  else if (courtesy) chatMessages.push({ role: "system", content: courtesyInstruction() });

  const completion = await client.chat.completions.create({
    model: agent.model || "gpt-5-mini",
    max_completion_tokens: 8192,
    messages: chatMessages,
  });

  const reply = completion.choices[0]?.message?.content?.trim();
  if (!reply) {
    log.error(
      { conversationId, agentId: agent.id, model: agent.model, finishReason: completion.choices[0]?.finish_reason },
      "virtual agent produced an empty reply",
    );
    return;
  }

  // Pedido cerrado y pagado: la conversación también pasa a una persona —alguien
  // tiene que verificar la transferencia y despacharlo—, pero el cliente no espera
  // una respuesta que el bot no supo dar, sino saber que su pedido va. Por eso
  // nunca es un traspaso silencioso y el aviso es el de pedido.
  const orderConfirmed = /PEDIDO_CONFIRMADO/i.test(reply);
  // Afiliarse o desafiliarse de la compra recurrente siempre pasa a una
  // persona: nadie puede inscribir ni dar de baja al cliente desde el chat, así
  // que aunque el agente no lo reconozca como fuera de su alcance, esto escala
  // igual — es lo que garantiza que quede como caso sin importar el canal.
  const lastCustomerMessage = [...history].reverse().find((m) => m.sender === "contact")?.content ?? "";
  const isAffiliationRequest = AFFILIATION_RE.test(lastCustomerMessage);
  const shouldEscalate = orderConfirmed || /ESCALAR_A_HUMANO/i.test(reply) || isAffiliationRequest;
  const handoffKind: HandoffKind = orderConfirmed ? "order" : handoffKindForProfile(agent.profileType);

  // Product photos the agent asked for. Only honoured for the profiles that have
  // it enabled, so a stray directive in a hand-written prompt can't turn the
  // agenda or qualifier bots into image senders. At most business.photosPerReply
  // photos per reply (1 unless the client sells by showing several units) — the base
  // conduct asks for that, and this enforces it regardless of what the model does.
  const photoSlugs = PHOTO_ENABLED_PROFILES.has(agent.profileType ?? "general")
    ? [...new Set([...reply.matchAll(PHOTO_DIRECTIVE)].map((m) => m[1].toLowerCase()))].slice(
        0,
        clientConfig.business.photosPerReply,
      )
    : [];
  // Las imágenes fijas del negocio siguen la misma regla: mismos perfiles, una por
  // respuesta.
  const imageKeys = PHOTO_ENABLED_PROFILES.has(agent.profileType ?? "general")
    ? [...reply.matchAll(IMAGE_DIRECTIVE)].map((m) => m[1].toLowerCase()).slice(0, 1)
    : [];

  // Lo que el cliente ya recibió en esta sesión no se le vuelve a mandar: la foto
  // del producto, las cuentas, un enlace. El modelo los repetía en cada paso del
  // pedido aunque el prompt se lo prohíba. Si el cliente los pide otra vez, sí van.
  const lastFromCustomer = [...history].reverse().find((m) => m.sender === "contact")?.content ?? "";
  const resendAsked = asksToResend(lastFromCustomer);
  const fromUs = history.filter((m) => m.sender !== "contact");
  // Las fotos guardadas antes de llevar pie tienen la URL de la imagen en `content`.
  const sentImages = new Set(fromUs.filter((m) => m.type === "image").map((m) => m.mediaUrl ?? m.content));

  const photoProducts = photoSlugs.length
    ? await db
        .select()
        .from(productsTable)
        // A product the source withdrew (a vehicle that sold) keeps its row but no longer has a photo to send.
        .where(and(inArray(productsTable.slug, photoSlugs), eq(productsTable.active, true)))
    : [];
  const photosToSend: Array<{ slug: string; name: string; url: string; imageUrl: string }> = [];
  // In the order the agent named them, which is the order the customer reads them in.
  photoProducts.sort((a, b) => photoSlugs.indexOf(a.slug) - photoSlugs.indexOf(b.slug));
  for (const product of photoProducts) {
    if (!product.imageUrl) {
      log.info({ conversationId, slug: product.slug }, "product photo skipped: no image");
    } else if (sentImages.has(product.imageUrl) && !resendAsked) {
      log.info({ conversationId, slug: product.slug }, "product photo skipped: already sent in this session");
    } else {
      photosToSend.push({ slug: product.slug, name: product.name, url: product.url, imageUrl: product.imageUrl });
    }
  }
  if (photoProducts.length < photoSlugs.length) {
    log.info({ conversationId, slugs: photoSlugs }, "product photo skipped: unknown slug");
  }
  const imagesToSend = imageKeys.filter((key) => {
    const image = clientConfig.business.agentImages[key];
    const url = image ? toPublicUrl(image.url) : null;
    if (url && sentImages.has(url) && !resendAsked) {
      log.info({ conversationId, key }, "agent image skipped: already sent in this session");
      return false;
    }
    return true;
  });

  // Enlaces que sobran en el texto: el del producto cuya foto sale ahora con su pie
  // (solo WhatsApp lo lleva) y los que el cliente ya recibió, en un texto o al pie
  // de una foto.
  const repeatedLinks = mediaHasCaption(conv.channel) ? photosToSend.map((p) => p.url) : [];
  if (!resendAsked) {
    // A quien pregunta cómo comprar o dice que lo quiere, el enlace de la tienda
    // en línea le va otra vez aunque ya le hubiera llegado con la bienvenida: ahí
    // es una vía para comprar, no información repetida.
    const keepStore = showsPurchaseIntent(lastFromCustomer);
    repeatedLinks.push(
      ...fromUs
        .filter((m) => m.type === "text" || m.type === "image")
        .flatMap((m) => linksIn(m.content))
        .filter((link) => !(keepStore && isStoreLink(link))),
    );
  }

  // Opciones que el agente pidió mostrar como botones. Al escalar no se ponen:
  // quien recibe la conversación no tiene por qué continuar por donde el bot iba.
  const optionButtons = shouldEscalate ? [] : parseOptionButtons(reply);

  const strippedReply = removeLinks(
    replacePesosDirectives(reply, rates)
      .replace(PHOTO_DIRECTIVE, "")
      .replace(IMAGE_DIRECTIVE, "")
      .replace(ECHOED_TIMESTAMP, "")
      .replace(OPTIONS_DIRECTIVE, "")
      .replace(APPOINTMENT_DIRECTIVE, "")
      .replace(/ESCALAR_A_HUMANO/gi, "")
      .replace(/PEDIDO_CONFIRMADO/gi, "")
      // Spaces at the end of a line mean nothing in a chat, and the model pads the blank lines
      // of a list with them; without this the gaps between lines come out uneven.
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    repeatedLinks,
  );

  // La cita se crea aquí y no en el modelo porque hay un dato que el modelo no
  // puede conocer: si el hueco está libre. Cuando no lo está, la reserva no se
  // hace y el texto de confirmación que el agente ya había escrito se sustituye
  // por una propuesta de otra hora — dejar pasar ese "listo, te espero el
  // sábado" sería confirmarle al cliente una cita que no existe.
  const booking = await bookFromDirective(reply, conv, agent, log);
  // Lo que el agente escriba junto a la confirmación del pedido sobra: el aviso de
  // pedido ya lo dice, y dos confirmaciones seguidas con distinto texto confunden.
  const cleanReply = orderConfirmed ? "" : (booking?.replacementText ?? strippedReply);

  // Traspaso silencioso: el agente contestó solo con la palabra clave, es decir,
  // el tema no le toca. No sale nada hacia el cliente — un "te transfiero con un
  // humano" delataría el cambio de interlocutor y lo dejaría esperando. La
  // conversación cambia de manos y quien la recibe responde la pregunta pendiente.
  const silentHandoff = shouldEscalate && !orderConfirmed && !cleanReply;

  if (!silentHandoff && !orderConfirmed) {
    const outbound = cleanReply || "Un momento, ya te ayudo.";
    // El historial guarda las opciones escritas: el panel humano tiene que ver
    // qué se le ofreció, aunque en el teléfono fueran botones.
    const transcript = optionButtons.length ? withOptionsAsText(outbound, optionButtons) : outbound;

    // La imagen que va delante del texto (placement "before", como la de cómo
    // comprar) sale primero y se guarda primero, para que el panel la muestre en el
    // mismo orden que el cliente. En WhatsApp lleva el texto como pie, y entonces el
    // texto ya no se manda ni se guarda aparte. Con botones no: ahí las imágenes ya
    // van delante de la pregunta.
    const leadingImage = optionButtons.length ? undefined : imagesToSend.find(agentImageLeads);
    const trailingImages = imagesToSend.filter((key) => key !== leadingImage);
    const led = leadingImage
      ? await deliverAgentImage(conv, leadingImage, log, { leadingText: outbound })
      : { carriedText: false };

    const [botMessage] = led.carriedText
      ? [null]
      : await db
          .insert(messagesTable)
          .values({
            conversationId,
            sender: "bot",
            content: transcript,
            type: "text",
            isAiSuggestion: false,
          })
          .returning({ id: messagesTable.id });

    await db
      .update(conversationsTable)
      .set({ lastMessage: outbound, updatedAt: new Date() })
      .where(eq(conversationsTable.id, conversationId));

    // Deliver the AI reply to the customer over their real channel. Con botones,
    // la foto va delante: así la pregunta queda como último mensaje del chat y el
    // cliente tiene los botones a mano en vez de tener que subir a buscarlos.
    if (optionButtons.length) {
      for (const product of photosToSend) {
        await deliverProductPhoto(conv, product, log);
      }
      for (const key of imagesToSend) {
        await deliverAgentImage(conv, key, log);
      }
      await deliverConversationButtons(conv, outbound, optionButtons, log);
    } else {
      if (botMessage) {
        const delivery = await deliverConversationMessage(conv, outbound, log);
        if (delivery.externalMessageId) {
          await db
            .update(messagesTable)
            .set({ externalMessageId: delivery.externalMessageId })
            .where(eq(messagesTable.id, botMessage.id));
        }
      }
      for (const product of photosToSend) {
        await deliverProductPhoto(conv, product, log);
      }
      for (const key of trailingImages) {
        await deliverAgentImage(conv, key, log);
      }
    }
  }

  if (!shouldEscalate) return;

  // El agente acaba de admitir que esto no lo resuelve él. Si lo que pide el
  // cliente es una gestión (un reembolso, un paquete que no llegó, un descuento
  // por volumen), queda como caso: la conversación pasa a una persona igual que
  // antes, pero la petición ya no depende de que esa persona se acuerde.
  if (!orderConfirmed && isModuleEnabled("cases") && conv.contactId) {
    if (lastCustomerMessage) {
      void maybeOpenCase(
        { contactId: conv.contactId, channel: conv.channel, text: lastCustomerMessage, conversationId: conv.id },
        log,
      );
    }
  }

  if (orderConfirmed) {
    // Un pedido por sesión. El prompt del cliente ya se lo prohíbe al modelo ("si
    // en la conversación ya se le dijo que su pedido está siendo procesado, no
    // vuelvas a escribir PEDIDO_CONFIRMADO"), pero el 2026-09-20 lo escribió
    // cuatro veces seguidas mientras una clienta insistía, y quedaron cuatro
    // pedidos Pendiente de una sola compra. La regla del prompt se queda; esto es
    // el cierre que no depende de que el modelo la respete.
    const [alreadyConfirmed] = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.conversationId, conversationId),
          gte(messagesTable.createdAt, conv.sessionStartedAt),
          eq(messagesTable.isInternal, true),
          eq(messagesTable.content, ORDER_CONFIRMED_NOTE),
        ),
      )
      .limit(1);
    if (alreadyConfirmed) {
      log.info({ conversationId, agentId: agent.id }, "order confirmation skipped: already confirmed in this session");
    } else {
      await db.insert(messagesTable).values({
        conversationId,
        sender: "bot",
        content: ORDER_CONFIRMED_NOTE,
        type: "text",
        isAiSuggestion: false,
        isInternal: true,
      });
      log.info({ conversationId, agentId: agent.id }, "order confirmed by the customer — handing off to verify the payment");
      // El pedido queda listo en Pendiente, con lo que se pueda leer del chat — no
      // bloquea el traspaso de abajo si falla o tarda. `history` ya trae el mensaje
      // del cliente que disparó esta respuesta: se cargó antes de llamar al modelo.
      void createOrderFromConversation({ id: conv.id, contactId: conv.contactId }, history, log);
    }
  }

  // A quien atiende es la gente de una tienda, así que el traspaso no ocurre hasta
  // saber cuál: la del cliente, por su zona, o la que él mismo elija de la lista.
  // Si no lo sabemos, se le pregunta y el traspaso espera a su respuesta. Esto solo
  // aplica cuando el destino es un grupo humano: una escalación entre agentes
  // virtuales no depende de la geografía.
  let escalationGroupId = agent.escalateToGroupId;
  let branchLabel: string | null = null;
  // Solo se pregunta la zona donde hay varias tiendas que atienden. Con un local
  // único la pregunta no decide nada y le añade un turno al cliente antes de que
  // le conteste una persona.
  if (agent.escalateToGroupId && hasBranchRouting()) {
    const target = await resolveBranchTarget(conv, contact, history, log);
    if (target.kind === "ask") {
      await askForZone(conv, target.attempt, log);
      return;
    }
    escalationGroupId = target.groupId;
    // Sin nombre de tienda cuando la sucursal es la de reserva: el cliente nunca
    // dijo dónde está, y anunciarle "tu tienda de X" sería inventárselo.
    branchLabel = target.assumed ? null : target.label;
    log.info(
      { conversationId, groupId: target.groupId, branch: target.label, assumed: target.assumed },
      target.assumed ? "zone unknown — handing off to the default branch" : "handing off to nearest branch",
    );
  }

  if (escalationGroupId) {
    // Prefer escalating to a whole human group (distribution rules pick the member).
    const handed = await escalateConversationToGroup(conversationId, escalationGroupId, log);
    if (!handed) {
      log.error({ conversationId, escalateGroupId: escalationGroupId }, "group escalation did not hand off");
      if (silentHandoff || orderConfirmed) {
        await parkForHumans(conversationId, agent.id, "el grupo de escalación no recibió la conversación", handoffKind, log);
      }
      return;
    }
    await notifyHumanHandoff(conv, branchLabel, handoffKind, log);
  } else if (agent.escalateToAgentId) {
    const [target] = await db.select().from(agentsTable).where(eq(agentsTable.id, agent.escalateToAgentId));
    if (!target) {
      log.error({ conversationId, escalateTargetId: agent.escalateToAgentId }, "escalation target not found");
      if (silentHandoff || orderConfirmed) {
        await parkForHumans(conversationId, agent.id, "el agente de escalación configurado ya no existe", handoffKind, log);
      }
      return;
    }
    await db
      .update(conversationsTable)
      .set({
        agentId: target.id,
        status: target.type === "human" ? "pending" : "open",
        // Quien la recibe ya no está contestando a nuestro seguimiento: la lleva él.
        followupId: null,
        updatedAt: new Date(),
      })
      .where(eq(conversationsTable.id, conversationId));

    await db.insert(messagesTable).values({
      conversationId,
      sender: "bot",
      content: `🔁 Conversación escalada automáticamente a ${target.name}.`,
      type: "text",
      isAiSuggestion: false,
      isInternal: true,
    });

    // Solo se avisa cuando quien recibe es una persona: entre agentes virtuales
    // el cliente no cambia de interlocutor, sigue hablando con "el chat". Un
    // pedido confirmado sí se avisa siempre: es la única respuesta que recibe.
    if (target.type === "human" || orderConfirmed) await notifyHumanHandoff(conv, null, handoffKind, log);
  } else {
    // Sin destino configurado no hay a quién pasarle la conversación: en un
    // traspaso silencioso el cliente se quedaría sin respuesta, así que al menos
    // queda visible para el equipo humano.
    if (silentHandoff || orderConfirmed) {
      await parkForHumans(conversationId, agent.id, "no tiene destino de escalación configurado", handoffKind, log);
    }
    return;
  }

  // Tras un traspaso silencioso el cliente sigue esperando su respuesta: si quien
  // recibe la conversación es otro agente virtual, contesta ya. Si es humano, la
  // conversación queda en "pending" y la toma el panel.
  if (silentHandoff) {
    await continueAfterSilentHandoff(conversationId, agent.id, log, hops, takeover);
  }
}

// ── Situación del chat ────────────────────────────────────────────────────────
// Qué pide el último mensaje del cliente, decidido ANTES de que el agente redacte
// (followup-rules.ts explica las tres salidas). Se lee junto con lo último de la
// conversación anterior, porque muchas veces el cliente le contesta a eso.
function endsWithQuestion(text: string): boolean {
  return text.replace(/[\s\p{Extended_Pictographic}\uFE0F\u200D]+$/u, "").endsWith("?");
}

async function turnSituation(history: MessageRow[], previousRows: MessageRow[]): Promise<PendingReplyNeed> {
  const thread = [...previousRows, ...history];
  let lastIndex = thread.length - 1;
  while (lastIndex >= 0 && thread[lastIndex].sender !== "contact") lastIndex -= 1;
  if (lastIndex < 0) return "answer";
  const last = thread[lastIndex];
  let ours = lastIndex - 1;
  while (ours >= 0 && thread[ours].sender === "contact") ours -= 1;
  const quick = quickTurnSituation({
    text: last.content,
    type: last.type,
    weAskedLast: ours >= 0 && endsWithQuestion(historyContent(thread[ours])),
  });
  if (quick) return quick;
  const transcript = thread
    .slice(Math.max(0, lastIndex - 9), lastIndex + 1)
    .map((m) => {
      const who = m.sender === "contact" ? "Cliente" : "Nosotros";
      return `[${formatShort(m.createdAt)}] ${who}: ${historyContent(m)}`;
    })
    .join("\n");
  return (await classifyTurnSituation(transcript)) ?? "answer";
}

// Un enlace de la tienda en línea del negocio (business.website), con o sin ruta.
function isStoreLink(link: string): boolean {
  const website = clientConfig.business.website;
  if (!website) return false;
  try {
    return new URL(link).host.replace(/^www\./, "") === new URL(website).host.replace(/^www\./, "");
  } catch {
    return false;
  }
}

// A qué tienda mandar la conversación. El equipo humano está repartido por
// sucursal, así que el destino depende de dónde esté el cliente:
//   - "group": hay tienda. `assumed` distingue la que le toca por su zona (o la
//     que él eligió) de la de reserva, que es a donde va quien nunca contestó.
//   - "ask": todavía no se le ha preguntado lo suficiente — el traspaso espera.
//
// Nunca devuelve "no sé": una conversación no puede quedarse esperando a un grupo
// genérico sin gente dentro.
type BranchTarget =
  | { kind: "group"; groupId: number; label: string; assumed: boolean }
  | { kind: "ask"; attempt: number };

// Se busca la zona SOLO en lo que escribió el cliente y en su ficha. Los mensajes
// del bot nombran las sucursales al dar direcciones y horarios: leerlos sería
// asignarle una tienda por algo que dijo el propio bot.
async function resolveBranchTarget(
  conv: Pick<Conversation, "id" | "channel" | "sessionStartedAt">,
  contact: { id: number; city: string | null; address: string | null } | null,
  history: Array<{ sender: string; content: string }>,
  log: Log,
): Promise<BranchTarget> {
  const fromCustomer = history.filter((m) => m.sender === "contact").map((m) => m.content);
  const haystack = [contact?.city, contact?.address, ...fromCustomer].filter(Boolean).join(" · ");
  const match = matchZone(haystack);

  if (match) {
    const resolved = await resolveBranchGroup(conv, match, log);
    if (resolved) {
      // La zona queda en la ficha del contacto para no volver a preguntársela en la
      // próxima conversación. Solo si no había nada: lo que puso un humano manda.
      if (contact && !contact.city) {
        await db.update(contactsTable).set({ city: match.zone }).where(eq(contactsTable.id, contact.id));
      }
      return { kind: "group", groupId: resolved.groupId, label: match.branch.label, assumed: false };
    }
    // Sabemos su tienda pero no a quién avisar en ella (grupo sin cablear ni
    // existir). Cae abajo, al mismo camino que quien no dijo dónde está.
  }

  // Cuántas veces se le ha preguntado ya en esta sesión.
  const asks = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conv.id),
        gte(messagesTable.createdAt, conv.sessionStartedAt),
        eq(messagesTable.isInternal, true),
        eq(messagesTable.content, ZONE_ASKED_NOTE),
      ),
    );

  if (asks.length < MAX_ZONE_ASKS) return { kind: "ask", attempt: asks.length + 1 };

  // Se le preguntó y no hubo forma. Igual lo atiende gente de una tienda: la de
  // reserva, que es de verdad y tiene a quién avisar, y desde ahí lo reencaminan
  // si hace falta. Antes esto acababa en un grupo genérico sin nadie dentro.
  const fallback = defaultBranch();
  const resolved = await resolveBranchGroup(conv, { branch: fallback, zone: fallback.label }, log, { record: false });
  if (!resolved) {
    // Ni la sucursal de reserva tiene grupo: es un fallo de configuración, no una
    // duda sobre el cliente. Que lo vea el equipo en vez de tragárselo.
    log.error({ conversationId: conv.id, branch: fallback.label }, "default branch has no group — nobody to hand off to");
    return { kind: "ask", attempt: asks.length + 1 };
  }
  return { kind: "group", groupId: resolved.groupId, label: fallback.label, assumed: true };
}

/**
 * De la sucursal que le toca al cliente a la gente que la atiende. El mapa lo
 * dicta el flujo activo a través de la etiqueta de localidad, que es donde el
 * equipo puede cambiarlo sin tocar código; el nombre del grupo en branches.ts
 * queda de respaldo por si esa etiqueta todavía no está cableada en el flujo.
 *
 * De paso deja la localidad marcada en la conversación: es el dato que explica en
 * el panel por qué la recibió esa tienda y no otra. Con `record: false` no se
 * marca — es lo que se usa con la sucursal de reserva, donde la tienda es una
 * decisión nuestra y no algo que sepamos del cliente.
 */
async function resolveBranchGroup(
  conv: Pick<Conversation, "id" | "channel">,
  match: BranchMatch,
  log: Log,
  { record = true }: { record?: boolean } = {},
): Promise<{ groupId: number } | null> {
  const [label] = await db
    .select()
    .from(labelsTable)
    .where(and(eq(labelsTable.slug, match.branch.localitySlug), eq(labelsTable.isActive, true)))
    .limit(1);

  let groupId = label ? await resolveGroupForLabel(label.id, conv.channel) : null;
  if (!groupId) {
    const [group] = await db
      .select()
      .from(agentGroupsTable)
      .where(eq(agentGroupsTable.name, match.branch.group))
      .limit(1);
    if (!group) {
      log.error(
        { conversationId: conv.id, locality: match.branch.localitySlug, group: match.branch.group },
        "branch has neither a group in the active flow nor a group by name — falling back",
      );
      return null;
    }
    log.warn(
      { conversationId: conv.id, locality: match.branch.localitySlug, groupId: group.id },
      "locality label not wired in the active flow — using the branch group by name",
    );
    groupId = group.id;
  }

  if (label && record) {
    await db
      .update(conversationsTable)
      .set({ localityLabelId: label.id })
      .where(eq(conversationsTable.id, conv.id));
  }
  return { groupId };
}

// ¿Hay un traspaso esperando la zona del cliente? Lo hay mientras la marca de
// "se le preguntó" sea el último apunte interno de la sesión: si después hubo un
// traspaso, esa espera ya se resolvió y no debe reactivarse.
async function isZoneHandoffPending(conversationId: number, sessionStartedAt: Date): Promise<boolean> {
  const [last] = await db
    .select({ content: messagesTable.content })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conversationId),
        gte(messagesTable.createdAt, sessionStartedAt),
        eq(messagesTable.isInternal, true),
      ),
    )
    .orderBy(desc(messagesTable.createdAt))
    .limit(1);
  return last?.content === ZONE_ASKED_NOTE;
}

// El cliente acaba de contestar de qué zona es y había un traspaso esperándolo:
// se completa aquí, sin pasar por el modelo. Dejarlo en manos de que el agente
// virtual vuelva a pedir escalación por su cuenta le costaría al cliente otro
// turno de espera, y a veces no lo pide. Devuelve true si la conversación ya
// cambió de manos.
async function completePendingZoneHandoff(
  conv: typeof conversationsTable.$inferSelect,
  fallbackGroupId: number,
  history: Array<{ sender: string; content: string }>,
  buttonId: string | null,
  kind: HandoffKind,
  log: Log,
): Promise<boolean> {
  if (!(await isZoneHandoffPending(conv.id, conv.sessionStartedAt))) return false;

  const lastInbound = [...history].reverse().find((m) => m.sender === "contact");
  // Tocó una tienda de la lista, o la escribió. Lo primero es inequívoco; lo
  // segundo pasa por el mapa de zonas.
  const match = matchZoneChoice(buttonId) ?? matchZone(lastInbound?.content);
  // Contestó algo que no está en el mapa de zonas: sigue el curso normal y, si el
  // agente vuelve a escalar, resolveBranchTarget lo manda al grupo por defecto.
  if (!match) return false;

  const resolved = await resolveBranchGroup(conv, match, log);
  const groupId = resolved?.groupId ?? fallbackGroupId;

  if (conv.contactId) {
    await db
      .update(contactsTable)
      .set({ city: match.zone })
      .where(and(eq(contactsTable.id, conv.contactId), isNull(contactsTable.city)));
  }

  const handed = await escalateConversationToGroup(conv.id, groupId, log);
  if (handed) {
    await notifyHumanHandoff(conv, resolved ? match.branch.label : null, kind, log);
    log.info({ conversationId: conv.id, groupId, branch: match.branch.label }, "zone answered — handed off to branch");
  }
  return handed;
}

// ¿Este mismo aviso ya salió en la sesión actual y sigue vigente? Vuelve a salir
// solo si una persona del equipo escribió después: ahí el traspaso se completó de
// verdad y el siguiente aviso es información nueva, no una repetición.
export async function noticeAlreadySent(conversationId: number, notice: string): Promise<boolean> {
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!conv) return false;

  const [last] = await db
    .select({ createdAt: messagesTable.createdAt })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conversationId),
        gte(messagesTable.createdAt, conv.sessionStartedAt),
        eq(messagesTable.sender, "bot"),
        eq(messagesTable.isInternal, false),
        eq(messagesTable.content, notice),
      ),
    )
    .orderBy(desc(messagesTable.createdAt))
    .limit(1);
  if (!last) return false;

  const [humanReplied] = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conversationId),
        gt(messagesTable.createdAt, last.createdAt),
        eq(messagesTable.sender, "agent"),
        eq(messagesTable.isInternal, false),
      ),
    )
    .limit(1);
  return !humanReplied;
}

// Le avisa al cliente que a partir de aquí lo atiende una persona, nombrando la
// tienda cuando se sabe cuál es. Va aparte de la respuesta del modelo a propósito:
// el texto lo fija el sistema según el motivo del traspaso (ver handoffNotice) y
// no promete tiempos que nadie garantizó.
//
// Sale una sola vez por sesión. 2026-09-20: a una clienta que llevaba dos días
// esperando su número de rastreo le salió el mismo "en breve te estará
// atendiendo" catorce veces por Instagram y nueve por WhatsApp —una por cada
// mensaje suyo—, porque el aviso lo escribe el sistema en cada escalación y no
// miraba si ya había salido. Uno de ellos cayó encima de la respuesta que una
// persona del equipo acababa de darle.
async function notifyHumanHandoff(
  conv: DeliveryTarget,
  branchLabel: string | null,
  kind: HandoffKind,
  log: Log,
): Promise<void> {
  const notice = handoffNotice(branchLabel, kind);
  if (await noticeAlreadySent(conv.id, notice)) {
    log.info({ conversationId: conv.id, kind }, "handoff notice skipped: already sent in this session");
    return;
  }
  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: "bot",
    content: notice,
    type: "text",
    isAiSuggestion: false,
  });
  await db
    .update(conversationsTable)
    .set({ lastMessage: notice, updatedAt: new Date() })
    .where(eq(conversationsTable.id, conv.id));
  await deliverConversationMessage(conv, notice, log);
}

// Le pregunta al cliente de qué zona escribe y deja constancia interna. El
// traspaso no ocurre en este turno: cuando conteste, su respuesta ya está en el
// historial y resolveBranchTarget la reconoce.
//
// La pregunta va con las tiendas como opciones tocables. Son cinco, más de las
// que caben en botones, así que viaja como lista de WhatsApp / quick replies.
async function askForZone(
  conv: DeliveryTarget,
  attempt: number,
  log: Log,
): Promise<void> {
  // La segunda vez no se repite la misma frase: lo que contestó no cayó en
  // ninguna zona, así que se le pide que elija tienda y ya.
  const question = attempt > 1 ? ZONE_QUESTION_RETRY : ZONE_QUESTION;
  // En el historial queda la pregunta con las opciones escritas: así el panel
  // muestra lo mismo que vio el cliente.
  const transcript = `${question}\n\n${ZONE_CHOICES.map((c) => `• ${c.label}`).join("\n")}`;
  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: "bot",
    content: transcript,
    type: "text",
    isAiSuggestion: false,
  });
  await db
    .update(conversationsTable)
    .set({ lastMessage: question, updatedAt: new Date() })
    .where(eq(conversationsTable.id, conv.id));
  await deliverZoneChoices(conv, question, log);
  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: "bot",
    content: ZONE_ASKED_NOTE,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });
  log.info({ conversationId: conv.id }, "asked customer for their zone before handing off");
}

// Deja la conversación en la bandeja humana sin escribirle nada al cliente. Se usa
// cuando el traspaso silencioso no llegó a ningún agente que pueda contestar: el
// cliente ya está esperando, así que el caso tiene que quedar visible para el equipo.
async function parkForHumans(
  conversationId: number,
  agentId: number,
  reason: string,
  kind: HandoffKind,
  log: Log,
): Promise<void> {
  const [conv] = await db
    .update(conversationsTable)
    .set({ status: "pending", updatedAt: new Date() })
    .where(eq(conversationsTable.id, conversationId))
    .returning();
  await db.insert(messagesTable).values({
    conversationId,
    sender: "bot",
    content: `⚠️ El agente virtual no pudo atender el tema y la conversación quedó sin respuesta: ${reason}.`,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });
  log.error({ conversationId, agentId, reason }, "silent handoff parked as pending");
  // Falló el destino, pero para el cliente el desenlace es el mismo: lo sigue una
  // persona desde el panel. Callarse aquí lo dejaría esperando sin saber qué pasó.
  if (conv) await notifyHumanHandoff(conv, null, kind, log);
}

// Hace responder al agente que acaba de recibir la conversación, solo si es
// virtual y activo. El tope de saltos corta cualquier cadena de escalaciones.
async function continueAfterSilentHandoff(
  conversationId: number,
  previousAgentId: number,
  log: Log,
  hops: number,
  takeover = false,
): Promise<void> {
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!conv?.agentId || conv.agentId === previousAgentId) return;
  const [next] = await db.select().from(agentsTable).where(eq(agentsTable.id, conv.agentId));
  // Humano (o agente inactivo): la conversación ya quedó en su bandeja, ahí para.
  if (!next || next.type !== "virtual" || !next.isActive) return;
  if (hops >= MAX_HANDOFF_HOPS) {
    log.error({ conversationId, hops, agentId: next.id }, "silent handoff chain stopped: hop limit reached");
    await parkForHumans(
      conversationId,
      next.id,
      "los agentes se escalaron entre sí sin resolver",
      handoffKindForProfile(next.profileType),
      log,
    );
    return;
  }
  await runVirtualAgentReply(conversationId, log, hops + 1, null, takeover);
}

// ── Inbound ingestion (from Meta webhooks) ────────────────────────────────────
// Dedupe of Meta webhook retries. Meta re-delivers events and the backend may run
// several instances, so the claim is persisted: only the caller that wins the
// insert (unique event_id) processes the message; retries and other instances see
// it as already claimed. The in-memory set is just a fast path to skip the DB hit
// on the hot retry storm right after a delivery.
const seenMessageIds = new Set<string>();
async function claimEvent(id: string): Promise<boolean> {
  if (seenMessageIds.has(id)) return false;
  const inserted = await db
    .insert(processedEventsTable)
    .values({ eventId: id })
    .onConflictDoNothing({ target: processedEventsTable.eventId })
    .returning({ id: processedEventsTable.id });
  const claimed = inserted.length > 0;
  if (claimed) {
    seenMessageIds.add(id);
    if (seenMessageIds.size > 5000) seenMessageIds.clear();
  }
  return claimed;
}

// El agente virtual de primera línea de un canal. Los de perfil proactivo (ventas
// de recuperación, post-venta) no cuentan: solo escriben desde un disparador y
// solo atienden la respuesta a su propio mensaje.
async function pickVirtualAgentForChannel(channel: string) {
  const candidates = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.type, "virtual"), eq(agentsTable.isActive, true)))
    .orderBy(agentsTable.id);
  return (
    candidates.find(
      (a) =>
        !PROACTIVE_PROFILES.has(a.profileType ?? "") &&
        ((a.channels ?? []).length === 0 || (a.channels ?? []).includes(channel)),
    ) ?? null
  );
}

// "No más promociones": se registra la baja, se cancela lo de marketing que
// estuviera programado y se le confirma. No pasa por el flujo ni por el agente:
// es una orden, no una conversación, y cualquier otra respuesta sonaría a que no
// se le hizo caso.
async function handleMarketingOptOut(conv: Conversation, contactId: number, log: Log): Promise<void> {
  await db.update(contactsTable).set({ marketingOptOutAt: new Date() }).where(eq(contactsTable.id, contactId));
  const cancelled = await db
    .update(followupsTable)
    .set({ status: "cancelled", detail: "el cliente pidió no recibir más promociones", updatedAt: new Date() })
    .where(
      and(
        eq(followupsTable.contactId, contactId),
        eq(followupsTable.status, "scheduled"),
        inArray(followupsTable.kind, MARKETING_KINDS),
      ),
    )
    .returning({ id: followupsTable.id });

  const text = "Listo 💜 No te enviaremos más promociones. Si necesitas algo, escríbenos por aquí cuando quieras.";
  const [message] = await db
    .insert(messagesTable)
    .values({ conversationId: conv.id, sender: "bot", content: text, type: "text", isAiSuggestion: false })
    .returning({ id: messagesTable.id });
  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: "bot",
    content: `🔕 El cliente pidió no recibir más promociones.${cancelled.length ? ` Se cancelaron ${cancelled.length} seguimiento(s) de marketing.` : ""}`,
    type: "text",
    isAiSuggestion: false,
    isInternal: true,
  });
  await db
    .update(conversationsTable)
    .set({ lastMessage: text, followupId: null, updatedAt: new Date() })
    .where(eq(conversationsTable.id, conv.id));
  const delivery = await deliverConversationMessage(conv, text, log);
  if (delivery.externalMessageId) {
    await db
      .update(messagesTable)
      .set({ externalMessageId: delivery.externalMessageId })
      .where(eq(messagesTable.id, message.id));
  }
  log.info({ conversationId: conv.id, contactId, cancelled: cancelled.length }, "marketing opt-out recorded");
}

// Fetches a voice note from Meta, persists it in the storage bucket and returns
// what the message row needs: display content (transcript), type and media url.
async function processInboundAudio(
  ev: InboundEvent,
  conversationId: number,
  log: Log,
): Promise<{ content: string; mediaUrl: string | null }> {
  let media: DownloadedMedia | null = null;
  if (ev.audio?.mediaId) {
    const settings = await loadSettings();
    media = settings ? await downloadWhatsAppMedia(settings, ev.audio.mediaId) : null;
  } else if (ev.audio?.url) {
    media = await downloadMediaUrl(ev.audio.url);
  }

  if (!media) {
    log.error({ conversationId, audio: ev.audio }, "voice note download failed");
    return { content: "🎤 Nota de voz (no se pudo descargar el audio)", mediaUrl: null };
  }

  const mimeType = ev.audio?.mimeType ?? media.mimeType;

  // Lo que se guarda es lo que se va a escuchar: en M4A cuando el original no suena
  // en todas partes (el OGG de WhatsApp no suena en el iPhone), y si la conversión
  // falla, el original. La transcripción sale siempre del original, en paralelo,
  // para no sumarle la conversión a la espera del cliente.
  const [playable, transcript] = await Promise.all([
    needsConversion(mimeType) ? toM4a(media.data) : Promise.resolve(null),
    transcribeAudio(media.data, mimeType),
  ]);
  if (!transcript) log.error({ conversationId }, "voice note transcription failed");

  const audio = playable
    ? { data: playable, mimeType: "audio/mp4", ext: "m4a" }
    : { data: media.data, mimeType, ext: audioExtension(mimeType) };
  const file = `voice-${conversationId}-${crypto.randomUUID()}.${audio.ext}`;
  const stored = await uploadMedia(file, audio.data, audio.mimeType);
  if (!stored) log.error({ conversationId, file }, "voice note upload to storage failed");

  return {
    content: transcript ?? "🎤 Nota de voz (transcripción no disponible)",
    mediaUrl: stored ? `/api/media/${file}` : null,
  };
}

// Descarga la foto, el video o el documento que mandó el cliente y lo deja en el
// almacenamiento, igual que las notas de voz. Si la descarga falla, el mensaje se
// guarda igual —el cliente sí lo mandó— y el panel lo muestra como no disponible.
async function processInboundMedia(
  media: InboundMedia,
  conversationId: number,
  log: Log,
): Promise<{ type: MediaKind; content: string; mediaUrl: string | null; mediaName: string | null }> {
  let downloaded: DownloadedMedia | null = null;
  if (media.mediaId) {
    const settings = await loadSettings();
    downloaded = settings ? await downloadWhatsAppMedia(settings, media.mediaId) : null;
  } else if (media.url) {
    downloaded = await downloadMediaUrl(media.url);
  }

  const name = media.filename ?? fileNameFromUrl(media.url);
  const content = media.caption?.trim() || mediaSummary(media.kind, name);
  if (!downloaded) {
    log.error({ conversationId, kind: media.kind, mediaId: media.mediaId }, "inbound media download failed");
    return { type: media.kind, content, mediaUrl: null, mediaName: name };
  }

  const mimeType = normalizeMime(media.mimeType ?? downloaded.mimeType);
  const file = `chat-${conversationId}-${crypto.randomUUID()}.${fileExtension(mimeType, name)}`;
  const stored = await uploadMedia(file, downloaded.data, mimeType);
  if (!stored) log.error({ conversationId, file }, "inbound media upload to storage failed");

  return { type: media.kind, content, mediaUrl: stored ? `/api/media/${file}` : null, mediaName: name };
}

// Auto-generated placeholder names look like "Cliente 1234" — those may be
// replaced by a real name the customer gives, but a curated name is never
// overwritten. Other fields are only filled when currently empty.
const PLACEHOLDER_NAME = /^Cliente\s/i;

// Reads contact details a customer states about themselves in a chat message and
// enriches their contact record. Best-effort and safe to call fire-and-forget:
// it never throws and only fills missing fields.
export async function maybeEnrichContactFromMessage(
  contactId: number,
  text: string,
  log: Log,
): Promise<void> {
  try {
    if (!text || !text.trim()) return;
    const info = await extractContactInfo(text);
    if (!info) return;

    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
    if (!contact) return;

    const update: Partial<typeof contactsTable.$inferInsert> = {};
    if (info.name && (!contact.name || PLACEHOLDER_NAME.test(contact.name))) update.name = info.name;
    if (info.phone && !contact.phone) update.phone = info.phone;
    if (info.company && !contact.company) update.company = info.company;
    if (info.address && !contact.address) update.address = info.address;
    if (info.city && !contact.city) update.city = info.city;

    if (Object.keys(update).length > 0) {
      await db.update(contactsTable).set(update).where(eq(contactsTable.id, contactId));
      log.info({ contactId, fields: Object.keys(update) }, "contact enriched from message");
    }

    // El correo va aparte porque puede unir este contacto con el que ya tenía sus
    // emails: es lo que ata el WhatsApp de una persona a su correo.
    if (info.email && !contact.email) await attachEmailToContact(contactId, info.email, log);
  } catch (err) {
    log.error({ err }, "contact enrichment failed");
  }
}

// Formats a contact's profile + facts + the chat summary into a compact context
// block for the agent's system prompt. Returns null when there is nothing yet.
function buildContactContext(
  contact: typeof contactsTable.$inferSelect | null,
  facts: Array<typeof contactFactsTable.$inferSelect>,
  summary: string | null,
): string | null {
  const parts: string[] = [];
  if (contact) {
    const prof: string[] = [];
    if (contact.buyerStatus) prof.push(`estado: ${contact.buyerStatus}`);
    if ((contact.interests ?? []).length) prof.push(`intereses: ${(contact.interests ?? []).join(", ")}`);
    if (contact.purchaseProfile) prof.push(`perfil de compra: ${contact.purchaseProfile}`);
    if (prof.length) parts.push(`Perfil de ${contact.name}: ${prof.join("; ")}.`);
  }
  if (facts.length) parts.push(`Datos relevantes: ${facts.map((f) => `${f.label}: ${f.value}`).join("; ")}.`);
  if (summary?.trim()) parts.push(`Resumen de la conversación actual: ${summary.trim()}`);
  return parts.length ? parts.join("\n") : null;
}

// Formats the trace of previous, already-closed conversations with this contact.
// Kept separate from the live context on purpose: the prompt labels it as history
// so the agent may consult it but never resumes it on its own.
function buildReferenceContext(historySummary: string | null, lastPreviousAt: Date | null): string | null {
  const trace = historySummary?.trim();
  if (!trace) return null;
  const when = lastPreviousAt ? ` Último contacto anterior: ${formatShort(lastPreviousAt)} (${humanizeGap(Date.now() - lastPreviousAt.getTime())}).` : "";
  return `${trace}${when}`;
}

// Best-effort, fire-and-forget: reads the conversation, updates the chat's running
// summary and enriches the contact's commercial profile (buyer status, interests,
// purchase profile, discrete facts) — only when the AI finds something relevant.
export async function maybeUpdateContextAndProfile(contactId: number, conversationId: number, log: Log): Promise<void> {
  try {
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
    if (!conv) return;

    // Summarize the current session only — contextSummary describes the live
    // conversation, and previous ones already folded into historySummary on close.
    const history = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.conversationId, conversationId),
          gte(messagesTable.createdAt, conv.sessionStartedAt),
          eq(messagesTable.isInternal, false),
        ),
      )
      .orderBy(messagesTable.createdAt);
    if (history.length === 0) return;

    const text = history
      .slice(-15)
      .map(
        (m) =>
          `[${formatShort(m.createdAt)}] ${m.sender === "contact" ? "Cliente" : m.sender === "bot" ? "Agente IA" : "Agente"}: ${historyContent(m)}`,
      )
      .join("\n");
    const extract = await extractContextAndProfile(text);
    if (!extract) return;

    if (extract.summary) {
      await db
        .update(conversationsTable)
        .set({ contextSummary: extract.summary })
        .where(eq(conversationsTable.id, conversationId));
    }

    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
    if (!contact) return;

    const update: Partial<typeof contactsTable.$inferInsert> = {};
    if (extract.buyerStatus) update.buyerStatus = extract.buyerStatus;
    if (extract.purchaseProfile) update.purchaseProfile = extract.purchaseProfile;
    if (extract.interests.length) {
      const merged = [...new Set([...(contact.interests ?? []), ...extract.interests])].slice(0, 20);
      if (merged.length !== (contact.interests ?? []).length) update.interests = merged;
    }
    if (Object.keys(update).length > 0) {
      await db.update(contactsTable).set(update).where(eq(contactsTable.id, contactId));
    }

    if (extract.facts.length) {
      const existing = await db.select().from(contactFactsTable).where(eq(contactFactsTable.contactId, contactId));
      for (const f of extract.facts) {
        const match = existing.find((e) => e.label.toLowerCase() === f.label.toLowerCase());
        if (match) {
          if (match.value !== f.value) {
            await db.update(contactFactsTable).set({ value: f.value }).where(eq(contactFactsTable.id, match.id));
          }
        } else if (existing.length < 20) {
          const [ins] = await db
            .insert(contactFactsTable)
            .values({ contactId, label: f.label, value: f.value, source: "ai" })
            .returning();
          existing.push(ins);
        }
      }
    }
    log.info({ contactId, conversationId }, "contact profile/context updated");
  } catch (err) {
    log.error({ err }, "profile/context update failed");
  }
}

export async function ingestInboundMessage(params: InboundEvent, log: Log): Promise<void> {
  if (params.externalMessageId && !(await claimEvent(params.externalMessageId))) {
    log.info({ id: params.externalMessageId }, "inbound message deduped");
    return;
  }

  // Upsert contact by channel-scoped external id. En WhatsApp se busca también por
  // el BSUID: el cliente que empezó escribiendo sin teléfono llega con los dos en
  // cuanto hay trato, y sin esto se le abriría un segundo contacto con otro chat.
  const senderIds = [params.senderId, params.senderUserId].filter((id): id is string => !!id);
  const matches = await db.select().from(contactsTable).where(inArray(contactsTable.externalId, senderIds));
  let contact = matches.find((c) => c.externalId === params.senderId) ?? matches[0];

  // Un número que nunca había escrito puede ser de alguien que ya conocemos por
  // otra vía: un contacto dado de alta a mano o que llegó por correo, con este
  // teléfono registrado. Se le ata el WhatsApp a esa ficha en vez de abrir otra.
  if (!contact && params.channel === "whatsapp" && !isWhatsAppUserId(params.senderId)) {
    const known = await findUnboundContactByPhone(params.senderId);
    if (known) {
      const [bound] = await db
        .update(contactsTable)
        .set({
          externalId: params.senderId,
          channels: [...new Set([...(known.channels ?? []), "whatsapp"])],
          ...(params.senderName && PLACEHOLDER_NAME.test(known.name) ? { name: params.senderName } : {}),
        })
        .where(and(eq(contactsTable.id, known.id), isNull(contactsTable.externalId)))
        .returning();
      if (bound) {
        contact = bound;
        log.info({ contactId: bound.id }, "whatsapp sender bound to existing contact by phone");
      }
    }
  }

  // Messenger/Instagram webhooks carry no display name, so resolve it from the
  // Graph profile. Done when the contact is first seen, and also to backfill
  // contacts already stored under a "Cliente 1234" placeholder — a curated name
  // is never overwritten.
  const needsProfile =
    params.channel !== "whatsapp" &&
    !params.senderName &&
    (!contact || PLACEHOLDER_NAME.test(contact.name) || !contact.metaProfileName ||
      (params.channel === "instagram" && !contact.instagramUsername));
  let profile: SenderProfile | null = null;
  if (needsProfile) {
    const settings = await loadSettings();
    profile = settings ? await fetchSenderProfile(settings, params.channel, params.senderId) : null;
    if (profile) {
      log.info(
        { channel: params.channel, resolved: !!profile.name, username: profile.username },
        "sender profile resolved",
      );
    }
  }
  const identity = metaProfilePatch(contact ?? null, params.channel, {
    name: params.senderName ?? profile?.name ?? null,
    username: profile?.username ?? null,
    pictureUrl: profile?.pictureUrl ?? null,
  });
  if (!contact) {
    [contact] = await db.insert(contactsTable).values({
      ...identity,
      name: identity.name ?? `Cliente ${params.senderId.slice(-4)}`,
      externalId: params.senderId,
      phone: params.channel === "whatsapp" && !isWhatsAppUserId(params.senderId) ? params.senderId : null,
      channels: [params.channel],
    }).returning();
  } else if (Object.keys(identity).length) {
    // Recheck the name in SQL so an edit made while Graph was loading wins.
    const [updated] = await db.update(contactsTable).set(identity)
      .where(and(eq(contactsTable.id, contact.id), eq(contactsTable.name, contact.name))).returning();
    if (updated) contact = updated;
  }

  // Por cuál de nuestros números entró. En WhatsApp sale del webhook; en los
  // otros canales no aplica y queda en null.
  const inboundNumber =
    params.channel === "whatsapp" ? await resolveInboundNumber(params.recipientNumberId, log) : null;

  // Reuse the latest conversation on this channel for the contact, else create one.
  //
  // En WhatsApp el número forma parte de la identidad de la conversación: si el
  // mismo cliente escribe a Ventas y a Soporte son dos hilos, porque en su
  // teléfono son dos chats distintos y porque mezclarlos volvería ambiguo por
  // dónde responder — que es justo lo que hay que evitar.
  //
  // Las conversaciones anteriores a la tabla de números tienen whatsappNumberId
  // en null. Se reconocen como del número principal en vez de duplicarlas: el
  // isNull() de abajo es lo que evita que a cada cliente antiguo se le abra un
  // hilo nuevo la primera vez que escriba después del despliegue.
  const sameNumber =
    inboundNumber === null
      ? undefined
      : inboundNumber.isPrimary
        ? or(
            eq(conversationsTable.whatsappNumberId, inboundNumber.id),
            isNull(conversationsTable.whatsappNumberId),
          )
        : eq(conversationsTable.whatsappNumberId, inboundNumber.id);

  let [conv] = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.contactId, contact.id),
        eq(conversationsTable.channel, params.channel),
        ...(sameNumber ? [sameNumber] : []),
      ),
    )
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(1);

  const isNewConversation = !conv;
  if (!conv) {
    const agent = await pickVirtualAgentForChannel(params.channel);
    [conv] = await db
      .insert(conversationsTable)
      .values({
        channel: params.channel,
        contactId: contact.id,
        agentId: agent?.id ?? null,
        externalId: params.senderId,
        whatsappNumberId: inboundNumber?.id ?? null,
        status: "open",
        unreadCount: 0,
      })
      .returning();
  } else if (inboundNumber && conv.whatsappNumberId === null) {
    // Conversación heredada: se le graba el número ahora que se sabe cuál es, para
    // que la próxima respuesta no dependa otra vez del respaldo.
    const [updated] = await db
      .update(conversationsTable)
      .set({ whatsappNumberId: inboundNumber.id })
      .where(eq(conversationsTable.id, conv.id))
      .returning();
    if (updated) conv = updated;
  }

  // Resolve the message text (transcribing audio) before the session boundary, so a
  // reopened session can judge whether this message continues the previous matter.
  let startedNewSession = false;
  let resumedFollowup = false;
  let content = params.text ?? "";
  let mediaUrl: string | null = null;
  let mediaName: string | null = null;
  let type: "text" | MediaKind = "text";
  const isAudio = params.audio !== null;
  if (isAudio) {
    type = "audio";
    ({ content, mediaUrl } = await processInboundAudio(params, conv.id, log));
  } else if (params.media) {
    ({ type, content, mediaUrl, mediaName } = await processInboundMedia(params.media, conv.id, log));
  }
  // La línea de la bandeja y del aviso push: la nota de voz lleva el micrófono
  // delante de su transcripción; un adjunto, su descripción o su pie.
  const preview = isAudio ? `🎤 ${content}` : type !== "text" ? mediaPreview(type, mediaName, content) : content;

  if (!isNewConversation) {
    // Close the previous conversation and open a new session when it was resolved
    // or went quiet past the idle window. Does nothing while a chat is live, so a
    // back-and-forth exchange stays a single conversation. A chat a human was
    // handling goes back to that human only if the customer continues that matter.
    ({ conv, startedNew: startedNewSession, resumedFollowup } = await ensureActiveSession(conv.id, content, log));
    if (conv.externalId !== params.senderId) {
      [conv] = await db
        .update(conversationsTable)
        .set({ externalId: params.senderId })
        .where(eq(conversationsTable.id, conv.id))
        .returning();
    }
  }

  // Si el cliente citó un mensaje, se busca por su id de canal. Puede no estar:
  // uno anterior a que se guardaran esos ids, o uno de fuera del panel. Entonces
  // el mensaje entra igual, sin cita.
  const [quoted] = params.replyToExternalId
    ? await db
        .select({ id: messagesTable.id })
        .from(messagesTable)
        .where(eq(messagesTable.externalMessageId, params.replyToExternalId))
        .limit(1)
    : [];

  const [inbound] = await db
    .insert(messagesTable)
    .values({
      conversationId: conv.id,
      sender: "contact",
      content,
      type,
      mediaUrl,
      mediaName,
      isAiSuggestion: false,
      externalMessageId: params.externalMessageId,
      replyToMessageId: quoted?.id ?? null,
    })
    .returning({ id: messagesTable.id });

  await db
    .update(conversationsTable)
    .set({
      lastMessage: preview,
      lastCustomerMessageAt: new Date(),
      unreadCount: (conv.unreadCount ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(conversationsTable.id, conv.id));

  // Church requests are registered after the inbound message is saved, even
  // when Lina can answer without escalating. Pure intent checks avoid opening
  // commerce records or treating service-hour questions as pastoral requests.
  if (clientConfig.id === "linaje-real" && isModuleEnabled("cases") && content.trim()) {
    await maybeOpenCase({ contactId: contact.id, channel: params.channel, text: content, conversationId: conv.id }, log);
  }

  // Enrich the contact from what the customer said (name, phone, company, etc.)
  // and update its commercial profile + this chat's running context. Fire-and-forget
  // so they never delay the virtual agent's reply.
  // Un adjunto sin pie no dice nada del cliente: no hay de dónde sacar datos.
  const saysSomething = type === "text" || type === "audio" || content !== mediaSummary(type, mediaName);
  if (saysSomething) {
    void maybeEnrichContactFromMessage(contact.id, content, log);
  }
  void maybeUpdateContextAndProfile(contact.id, conv.id, log);
  // ¿Le molestó la última respuesta del agente? Si sí, queda como lección
  // (lib/agent-learning.ts). No retrasa la respuesta.
  learnFromCustomerReaction(conv.id, inbound.id, log);

  if (isMarketingOptOut(content)) {
    await handleMarketingOptOut(conv, contact.id, log);
    await notifyForInbound(conv.id, conv.agentId, preview, log);
    return;
  }

  // ¿Venía ya en manos humanas? Se mira antes de clasificar: si el flujo la acaba
  // de derivar a una persona en este mismo mensaje, esa persona merece su ventana
  // de gracia, no que el bot le pise la conversación al instante.
  const wasHumanOwned = await isHumanOwned(conv);
  // Dueño previo al enrutado, para saber después si el chat cambió de manos en
  // este mismo mensaje y avisar al móvil de la asignación en vez del mensaje.
  const ownerBeforeRouting = conv.agentId;

  // Classify the customer's intent and let the active workflow route/escalate.
  // If it hands the conversation to a human, the virtual agent stays quiet.
  let routedToHuman = false;
  try {
    ({ routedToHuman } = await classifyAndRoute(conv.id, log));
  } catch (err) {
    log.error({ err }, "workflow classify/route failed");
  }

  // El cliente no puede quedarse esperando a un humano que no está: si la
  // conversación venía del lado humano y sigue ahí después del flujo, y nadie del
  // equipo ha escrito en la ventana de gracia, el agente virtual la retoma. Se
  // relee el estado porque el flujo pudo devolverla a un agente virtual en este
  // mismo mensaje: esa decisión manda y no hay que pisarla.
  //
  // Un "sí", un "ok" o un "de acuerdo" a secas no lo dejan esperando nada (regla
  // del 2026-09-20): es lo que contesta quien ya sabe que lo van a atender, y
  // tratarlo como pregunta pendiente era lo que hacía que el bot se metiera en un
  // chat que ya era de una persona. El chat se queda con quien lo tiene.
  let releasedFromHuman = false;
  if (wasHumanOwned && !isBareAcknowledgement(content)) {
    const [afterRouting] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conv.id));
    if (afterRouting && (await isHumanOwned(afterRouting)) && (await releaseAbandonedHumanChat(afterRouting, log))) {
      routedToHuman = false;
      releasedFromHuman = true;
    }
  }

  if (!routedToHuman) {
    // An active welcome message replaces the virtual agent's first reply when the
    // conversation (or a reopened session) has just begun. If none is configured,
    // maybeSendWelcomeMessage returns false and the agent answers as usual.
    // Quien contesta a un seguimiento nuestro no recibe la bienvenida: ya está
    // en conversación con el agente que le escribió.
    // Tampoco quien abre preguntando algo y tiene un agente virtual que se lo
    // conteste: a "Buen día. ¿Cuál es el precio del colágeno?" le salía la
    // bienvenida en vez del precio, y la pregunta se quedaba sin respuesta. Sin
    // agente virtual, la bienvenida sigue siendo lo único que recibe.
    const startsSession = isNewConversation || (startedNewSession && !resumedFollowup);
    const agentAnswersQuestion =
      startsSession && saysSomething && !isBareGreeting(content) && (await virtualAgentWillAnswer(conv.id));
    const greeted =
      startsSession && !agentAnswersQuestion && (await maybeSendWelcomeMessage(conv, await loadSettings(), log));
    if (!greeted) {
      await maybeRespondWithVirtualAgent(conv.id, log, {
        buttonId: params.buttonId ?? null,
        takeover: releasedFromHuman,
      });
    }
  }

  // Push to the mobile app. Deliberately the last step and deliberately a single
  // notification: the conversation is re-read because routing may have moved it to
  // someone else in this very turn, and that person is the one whose phone should
  // ring — about the handover if it just happened, about the message otherwise.
  await notifyForInbound(conv.id, ownerBeforeRouting, preview, log);
}

async function notifyForInbound(
  conversationId: number,
  ownerBefore: number | null,
  text: string,
  log: Log,
): Promise<void> {
  const [current] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!current) return;

  if (current.agentId && current.agentId !== ownerBefore) {
    const [owner] = await db.select().from(agentsTable).where(eq(agentsTable.id, current.agentId));
    if (owner?.type === "human") {
      await notifyChatAssigned(current, owner.id, "te derivaron esta conversación", log);
      return;
    }
  }
  await notifyInboundMessage(current, text, log);
}
