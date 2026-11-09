import crypto from "node:crypto";
import type { integrationSettingsTable, CampaignPayload } from "@workspace/db";

export type MetaSettings = typeof integrationSettingsTable.$inferSelect;
export type Channel = "whatsapp" | "facebook" | "instagram";

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

// Instagram se conecta de dos maneras y cada una habla con un host distinto. Con
// "inicio de sesión con Facebook" el token es el de la página y va a
// graph.facebook.com. Con "inicio de sesión con Instagram" Meta entrega un token de
// usuario de Instagram (empieza con "IG") que solo entiende graph.instagram.com:
// mandado a graph.facebook.com responde "Cannot parse access token".
const INSTAGRAM_GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

export function isInstagramLoginToken(token: string | null | undefined): boolean {
  return !!token && token.startsWith("IG");
}

export function graphBaseForToken(token: string | null | undefined): string {
  return isInstagramLoginToken(token) ? INSTAGRAM_GRAPH_BASE : GRAPH_BASE;
}

// ── Webhook signature verification (X-Hub-Signature-256) ──────────────────────
// Returns true when verification passes OR when no app secret is configured
// (dev/testing mode). Returns false only on an explicit signature mismatch.
//
// Acepta varios secretos: una instancia puede recibir webhooks firmados por la app
// de Meta (WhatsApp, Messenger, Instagram con inicio de sesión con Facebook) y por
// la app de Instagram (Instagram con inicio de sesión con Instagram), y cada una
// firma con su propia clave. Basta con que cuadre una de las configuradas.
export function verifyWebhookSignature(
  appSecrets: string | null | ReadonlyArray<string | null | undefined>,
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
): boolean {
  const secrets = (Array.isArray(appSecrets) ? appSecrets : [appSecrets]).filter((s): s is string => !!s);
  if (secrets.length === 0) return true; // not configured → skip (dev/testing)
  if (!rawBody || !signatureHeader) return false;
  const received = Buffer.from(signatureHeader);
  return secrets.some((secret) => {
    const expected = Buffer.from("sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex"));
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  });
}

// WhatsApp puede seguir conectado a una app distinta (por ejemplo, para
// conservar llamadas con ElevenLabs). Su clave solo sirve para eventos de
// WhatsApp; nunca amplía el acceso a webhooks de Facebook o Instagram.
export function webhookSecretsForObject(
  object: unknown,
  settings: { metaAppSecret?: string | null; instagramAppSecret?: string | null },
  whatsappAppSecret: string | undefined,
): Array<string | null | undefined> {
  const secrets = [settings.metaAppSecret, settings.instagramAppSecret];
  if (object === "whatsapp_business_account" && whatsappAppSecret?.trim()) {
    secrets.push(whatsappAppSecret.trim());
  }
  return secrets;
}

// A mismatch here means the stored App Secret is not the one belonging to the
// Meta app that signed the payload, and the log needs to say that without
// printing the secret. The fingerprint identifies which secret is loaded (two
// deploys can be compared, and it changes the moment the value is re-pasted),
// and the truncated signatures show whether the header even has the expected
// shape. None of it is reversible into the secret.
export function describeSignatureMismatch(
  appSecret: string | null,
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
): Record<string, unknown> {
  if (!appSecret || !rawBody) return {};
  const expected =
    "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return {
    secretLength: appSecret.length,
    secretFingerprint: crypto.createHash("sha256").update(appSecret).digest("hex").slice(0, 8),
    rawBodyBytes: rawBody.length,
    signatureReceived: signatureHeader ? signatureHeader.slice(0, 20) + "…" : null,
    signatureExpected: expected.slice(0, 20) + "…",
  };
}

// ── Inbound webhook parsing ───────────────────────────────────────────────────
// Voice notes / audio arrive either as a WhatsApp media id (needs an authenticated
// Graph download) or as a direct CDN url (Messenger/Instagram attachments).
export type InboundAudio = {
  mediaId: string | null;
  url: string | null;
  mimeType: string | null;
};

// Fotos, videos y documentos. Como el audio, llegan por id de WhatsApp (descarga
// autenticada) o por URL de la CDN de Messenger/Instagram. El nombre del archivo
// solo lo manda WhatsApp, y solo en documentos.
export type InboundMedia = {
  kind: "image" | "video" | "document";
  mediaId: string | null;
  url: string | null;
  mimeType: string | null;
  filename: string | null;
  caption: string | null;
};

// Adjuntos de Messenger/Instagram que se guardan como archivo. "audio" va aparte
// (nota de voz) y el resto —"share", "story_mention", "fallback"— no son archivos.
const MESSENGER_ATTACHMENT_KIND: Record<string, InboundMedia["kind"]> = {
  image: "image",
  video: "video",
  file: "document",
};

export type InboundEvent = {
  channel: Channel;
  senderId: string;
  senderName: string | null;
  text: string | null;
  audio: InboundAudio | null;
  media?: InboundMedia | null;
  externalMessageId: string | null;
  // A cuál de NUESTROS números llegó el mensaje: el Phone Number ID que Meta pone
  // en `value.metadata.phone_number_id`. Con varios números dados de alta es lo
  // único que distingue "escribió a Ventas" de "escribió a Soporte", y por tanto
  // lo que decide por dónde sale la respuesta.
  //
  // Null en Messenger e Instagram, que tienen una sola cuenta por instancia.
  recipientNumberId?: string | null;
  // WhatsApp: el BSUID del cliente (`from_user_id`). Cuando llega sin teléfono es
  // también el senderId.
  senderUserId?: string | null;
  // Id en el canal del mensaje que el cliente citó al responder: `context.id` en
  // WhatsApp, `reply_to.mid` en Messenger/Instagram.
  replyToExternalId?: string | null;
  // Set when the customer tapped an interactive button / quick reply instead of
  // typing. `text` still carries the visible label so the rest of the pipeline
  // treats it as an ordinary turn.
  buttonId?: string | null;
};

// A public comment left on a Facebook page post or Instagram media item. Kept
// separate from InboundEvent because comments live in a different graph
// hierarchy (post → root comment → replies) and are answered via a different
// set of Graph endpoints (/{comment_id}/comments or /{comment_id}/replies, plus
// Private Replies via /me/messages with recipient.comment_id).
export type InboundCommentEvent = {
  channel: "facebook" | "instagram";
  // Meta's post / media id the comment belongs to.
  externalPostId: string;
  // Meta's comment id.
  externalCommentId: string;
  // Parent comment id if this is a reply INSIDE the thread; null when this is
  // the root comment.
  parentExternalCommentId: string | null;
  // Root comment id of the whole thread. When the event is itself the root,
  // this equals externalCommentId.
  rootExternalCommentId: string;
  // Public commenter (customer). For FB feed events Meta gives us an ASID (not
  // a PSID). For IG we get the IG user id (not the IGSID used for DMs). Neither
  // can be used directly with the DM Send API — see sendPrivateReply for how we
  // resolve the PSID/IGSID for migration.
  authorExternalId: string;
  authorName: string | null;
  text: string;
  permalink: string | null;
  createdAt: Date | null;
};

type AnyObj = Record<string, unknown>;
const asArray = (v: unknown): AnyObj[] => (Array.isArray(v) ? (v as AnyObj[]) : []);
const asObj = (v: unknown): AnyObj => (v && typeof v === "object" ? (v as AnyObj) : {});
const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Resume un webhook que no trae mensajes entrantes, cuando es una forma que ya
 * sabemos que no se procesa.
 *
 * Que un webhook no produzca eventos son dos cosas muy distintas: una forma que
 * no reconocemos —y entonces hay que verla entera para poder añadirla— o un
 * aviso rutinario. Los acuses de WhatsApp son lo segundo y llegan TRES por cada
 * mensaje que sale (sent, delivered, read), así que volcar el cuerpo entero
 * llena el log de párrafos idénticos y esconde lo que sí hay que ver.
 *
 * Devuelve null cuando la forma no es reconocible, para que quien depura siga
 * teniendo el volcado completo.
 */
export function summarizeDeliveryReceipt(body: unknown): Record<string, unknown> | null {
  const root = asObj(body);
  if (asStr(root.object) !== "whatsapp_business_account") return null;

  const statuses: string[] = [];
  const recipients = new Set<string>();
  for (const entry of asArray(root.entry)) {
    for (const change of asArray(entry.changes)) {
      const value = asObj(asObj(change).value);
      // Con mensajes dentro no es un acuse: que se vea entero.
      if (asArray(value.messages).length > 0) return null;
      for (const st of asArray(value.statuses)) {
        const status = asStr(st.status);
        if (status) statuses.push(status);
        const recipient = asStr(st.recipient_id) ?? asStr(st.recipient_user_id);
        if (recipient) recipients.add(recipient);
      }
    }
  }

  if (statuses.length === 0) return null;
  return { statuses, recipients: [...recipients] };
}

// De quién viene un webhook, sin mirar lo que dice: el objeto, las cuentas que lo
// mandan, los campos y el número. Es lo que hace falta para reconocer a una app
// ajena apuntada a nuestra URL cuando la firma no cuadra. El cuerpo entero no se
// vuelca a propósito: sería contenido de clientes de otro negocio.
export function describeWebhookOrigin(body: unknown): Record<string, unknown> {
  const root = asObj(body);
  const accounts = new Set<string>();
  const fields = new Set<string>();
  const numbers = new Set<string>();
  for (const entry of asArray(root.entry)) {
    const id = asStr(entry.id);
    if (id) accounts.add(id);
    for (const change of asArray(entry.changes)) {
      const field = asStr(asObj(change).field);
      if (field) fields.add(field);
      const number = asStr(asObj(asObj(asObj(change).value).metadata).display_phone_number);
      if (number) numbers.add(number);
    }
  }
  return {
    object: asStr(root.object),
    accounts: [...accounts],
    fields: [...fields],
    numbers: [...numbers],
  };
}

// Normalizes WhatsApp / Messenger / Instagram webhook payloads into a flat list
// of inbound text messages. Non-text events (statuses, reactions, echoes) are skipped.
export function parseInboundEvents(body: unknown): InboundEvent[] {
  const root = asObj(body);
  const object = asStr(root.object);
  const out: InboundEvent[] = [];

  for (const entry of asArray(root.entry)) {
    // WhatsApp Cloud API
    if (object === "whatsapp_business_account") {
      for (const change of asArray(entry.changes)) {
        const value = asObj(asObj(change).value);
        const profiles = asArray(value.contacts);
        const nameById = new Map<string, string>();
        for (const c of profiles) {
          const profile = asObj(c.profile);
          const name = asStr(profile.name) ?? asStr(profile.username);
          if (!name) continue;
          for (const id of [asStr(c.wa_id), asStr(c.user_id)]) if (id) nameById.set(id, name);
        }
        // El número de la instancia al que llegó el mensaje. Meta lo manda una
        // vez por `change`, no por mensaje, así que se lee aquí y viaja en cada
        // evento del lote.
        const recipientNumberId = asStr(asObj(value.metadata).phone_number_id);
        for (const msg of asArray(value.messages)) {
          // Quien usa nombre de usuario puede llegar sin `from`, solo con su BSUID.
          // Descartarlo era perder el mensaje sin rastro: ni chat, ni su número en
          // el log. Con los dos manda el teléfono, que es como están guardados los
          // contactos de siempre.
          const userId = asStr(msg.from_user_id);
          const from = asStr(msg.from) ?? userId;
          if (!from) continue;
          const msgType = asStr(msg.type);
          const base = {
            channel: "whatsapp" as const,
            senderId: from,
            senderUserId: userId,
            senderName: nameById.get(from) ?? null,
            externalMessageId: asStr(msg.id),
            recipientNumberId,
            replyToExternalId: asStr(asObj(msg.context).id),
          };
          if (msgType === "text") {
            const text = asStr(asObj(msg.text).body);
            if (text) out.push({ ...base, text, audio: null });
          } else if (msgType === "interactive") {
            // Tap on an interactive reply button (see deliverInteractiveMessage).
            // The visible title is what the customer "said", so it flows through
            // the pipeline as an ordinary text turn; buttonId carries the routing.
            const interactive = asObj(msg.interactive);
            const reply = asObj(interactive.button_reply ?? interactive.list_reply);
            const title = asStr(reply.title);
            const id = asStr(reply.id);
            if (title || id) {
              out.push({ ...base, text: title ?? id ?? "", audio: null, buttonId: id });
            }
          } else if (msgType === "button") {
            // Reply to a template quick-reply button.
            const button = asObj(msg.button);
            const title = asStr(button.text);
            const payload = asStr(button.payload);
            if (title || payload) {
              out.push({ ...base, text: title ?? payload ?? "", audio: null, buttonId: payload });
            }
          } else if (msgType === "audio") {
            const audio = asObj(msg.audio);
            const mediaId = asStr(audio.id);
            if (mediaId) {
              out.push({ ...base, text: null, audio: { mediaId, url: null, mimeType: asStr(audio.mime_type) } });
            }
          } else if (msgType === "image" || msgType === "video" || msgType === "document" || msgType === "sticker") {
            // El sticker es una imagen WebP: se guarda y se muestra como foto.
            const payload = asObj(msg[msgType]);
            const mediaId = asStr(payload.id);
            if (mediaId) {
              out.push({
                ...base,
                text: null,
                audio: null,
                media: {
                  kind: msgType === "sticker" ? "image" : msgType,
                  mediaId,
                  url: null,
                  mimeType: asStr(payload.mime_type),
                  filename: asStr(payload.filename),
                  caption: asStr(payload.caption),
                },
              });
            }
          }
        }
      }
      continue;
    }

    // Messenger (page) & Instagram share the `messaging` array shape
    if (object === "page" || object === "instagram") {
      const channel: Channel = object === "instagram" ? "instagram" : "facebook";
      for (const ev of asArray(entry.messaging)) {
        const message = asObj(ev.message);
        if (message.is_echo === true) continue; // outbound echo
        const senderId = asStr(asObj(ev.sender).id);
        if (!senderId) continue;
        const base = {
          channel,
          senderId,
          senderName: null,
          externalMessageId: asStr(message.mid),
          replyToExternalId: asStr(asObj(message.reply_to).mid),
        };
        const text = asStr(message.text);
        // Quick-reply tap: Messenger/Instagram deliver the visible title in
        // `text` plus the payload we set, so only the id needs picking up.
        const quickReplyPayload = asStr(asObj(message.quick_reply).payload);
        const attachments = asArray(message.attachments).map(asObj);
        const audioAttachment = attachments.find((a) => asStr(a.type) === "audio");
        if (text) {
          out.push({ ...base, text, audio: null, ...(quickReplyPayload ? { buttonId: quickReplyPayload } : {}) });
        } else if (audioAttachment) {
          const url = asStr(asObj(audioAttachment.payload).url);
          if (url) out.push({ ...base, text: null, audio: { mediaId: null, url, mimeType: null } });
        }
        // Fotos, videos y archivos. Messenger manda varias fotos juntas como un solo
        // mensaje con un adjunto por foto; cada una se guarda como mensaje propio,
        // igual que las ve el cliente. El id de Meta es uno para todo el mensaje, así
        // que lleva el índice detrás: sin él, el deduplicado se quedaría solo con la
        // primera.
        let index = 0;
        for (const attachment of attachments) {
          const kind = MESSENGER_ATTACHMENT_KIND[asStr(attachment.type) ?? ""];
          const url = asStr(asObj(attachment.payload).url);
          if (!kind || !url) continue;
          const alone = index === 0 && !text && !audioAttachment;
          out.push({
            ...base,
            externalMessageId:
              alone || !base.externalMessageId ? base.externalMessageId : `${base.externalMessageId}#${index}`,
            text: null,
            audio: null,
            media: { kind, mediaId: null, url, mimeType: null, filename: null, caption: null },
          });
          index += 1;
        }
      }
    }
  }

  return out;
}

// Normalizes FB Page `feed` and IG `comments` webhook payloads into inbound
// comment events. Ignores non-comment feed events (likes, status updates) and
// echoes authored by the Page/IG business itself.
export function parseInboundCommentEvents(
  body: unknown,
  opts: { pageId?: string | null; instagramAccountId?: string | null } = {},
): InboundCommentEvent[] {
  const root = asObj(body);
  const object = asStr(root.object);
  const out: InboundCommentEvent[] = [];
  const pageId = opts.pageId ?? null;
  const igAccountId = opts.instagramAccountId ?? null;

  for (const entry of asArray(root.entry)) {
    for (const change of asArray(entry.changes)) {
      const c = asObj(change);
      const field = asStr(c.field);
      const value = asObj(c.value);

      // ── Facebook Page feed comments ─────────────────────────────────────
      // Meta wraps every feed-level action in `field: "feed"`. We only care
      // about newly added comments; edits, deletes, hides and reactions are
      // out of scope for the auto-reply flow.
      if (object === "page" && field === "feed") {
        const item = asStr(value.item);
        const verb = asStr(value.verb);
        if (item !== "comment" || verb !== "add") continue;
        const commentId = asStr(value.comment_id);
        const postId = asStr(value.post_id);
        const message = asStr(value.message);
        if (!commentId || !postId || !message) continue;
        const from = asObj(value.from);
        const authorId = asStr(from.id);
        if (!authorId) continue;
        // Echoes: the Page comments on its own post through the API. We store
        // those as outbound comments ourselves; ignore the webhook copy.
        if (pageId && authorId === pageId) continue;
        const parentId = asStr(value.parent_id);
        // FB gives parent_id equal to post_id for root comments; treat that
        // as "no parent comment" so the thread key is the comment itself.
        const parentCommentId = parentId && parentId !== postId ? parentId : null;
        const created = typeof value.created_time === "number" ? new Date(value.created_time * 1000) : null;
        out.push({
          channel: "facebook",
          externalPostId: postId,
          externalCommentId: commentId,
          parentExternalCommentId: parentCommentId,
          // Root of the thread: if we know a parent comment, use it; otherwise
          // this comment IS the root. FB does not expose the whole ancestor
          // chain in one payload, so a deep reply's rootId falls back to its
          // immediate parent — good enough to group under the same thread.
          rootExternalCommentId: parentCommentId ?? commentId,
          authorExternalId: authorId,
          authorName: asStr(from.name),
          text: message,
          permalink: asStr(value.permalink_url),
          createdAt: created,
        });
        continue;
      }

      // ── Instagram media comments ────────────────────────────────────────
      if (object === "instagram" && field === "comments") {
        const commentId = asStr(value.id);
        const text = asStr(value.text);
        if (!commentId || !text) continue;
        const media = asObj(value.media);
        const postId = asStr(media.id);
        if (!postId) continue;
        const from = asObj(value.from);
        const authorId = asStr(from.id);
        if (!authorId) continue;
        // Ignore echoes from our own IG business account.
        if (igAccountId && authorId === igAccountId) continue;
        const parentCommentId = asStr(asObj(value.parent_id).id) ?? asStr(value.parent_id);
        out.push({
          channel: "instagram",
          externalPostId: postId,
          externalCommentId: commentId,
          parentExternalCommentId: parentCommentId,
          rootExternalCommentId: parentCommentId ?? commentId,
          authorExternalId: authorId,
          authorName: asStr(from.username) ?? asStr(from.name),
          text,
          permalink: null,
          createdAt: null,
        });
      }
    }
  }

  return out;
}
// ── Inbound media download ────────────────────────────────────────────────────
export type DownloadedMedia = { data: Buffer; mimeType: string };

async function fetchBinary(url: string, bearer?: string): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: bearer ? { authorization: `Bearer ${bearer}` } : undefined,
    });
    return resp.ok ? resp : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Downloads a WhatsApp Cloud API media object: first resolve the media id to a
// short-lived CDN url, then fetch the binary (both calls need the access token).
export async function downloadWhatsAppMedia(
  settings: MetaSettings,
  mediaId: string,
): Promise<DownloadedMedia | null> {
  const token = settings.whatsappAccessToken;
  if (!token) return null;
  const info = await fetchBinary(`${GRAPH_BASE}/${mediaId}`, token);
  if (!info) return null;
  const meta = asObj(await info.json().catch(() => null));
  const url = asStr(meta.url);
  if (!url) return null;
  const media = await fetchBinary(url, token);
  if (!media) return null;
  return {
    data: Buffer.from(await media.arrayBuffer()),
    mimeType: asStr(meta.mime_type) ?? media.headers.get("content-type") ?? "audio/ogg",
  };
}

// Downloads media from a public CDN url (Messenger / Instagram attachments).
export async function downloadMediaUrl(url: string): Promise<DownloadedMedia | null> {
  const resp = await fetchBinary(url);
  if (!resp) return null;
  return {
    data: Buffer.from(await resp.arrayBuffer()),
    mimeType: resp.headers.get("content-type")?.split(";")[0].trim() ?? "audio/ogg",
  };
}

// ── Sender profile lookup ─────────────────────────────────────────────────────
// WhatsApp puts the customer's name straight in the webhook payload, but
// Messenger and Instagram only send an opaque PSID/IGSID — which is why a new
// FB/IG contact would otherwise be stored as "Cliente 1234". Both platforms
// expose the profile of anyone who has messaged the business, using the same
// page access token already configured for messaging: no extra permission and no
// App Review needed.
export type SenderProfile = {
  name: string | null;
  // Instagram only: the @handle, more recognisable than the display name.
  username: string | null;
  pictureUrl: string | null;
};

export async function fetchSenderProfile(
  settings: MetaSettings,
  channel: Channel,
  senderId: string,
): Promise<SenderProfile | null> {
  if (channel === "whatsapp") return null; // name already rides on the webhook
  const isInstagram = channel === "instagram";
  const token = isInstagram
    ? settings.instagramAccessToken || settings.facebookPageAccessToken
    : settings.facebookPageAccessToken;
  if (!token) return null;

  const fields = isInstagram
    ? "name,username,profile_pic"
    : "first_name,last_name,profile_pic";
  const url = `${graphBaseForToken(token)}/${encodeURIComponent(senderId)}?fields=${fields}&access_token=${encodeURIComponent(token)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    const body = asObj(await resp.json().catch(() => ({})));
    // Messenger splits the name in two; Instagram returns it whole.
    const first = asStr(body.first_name);
    const last = asStr(body.last_name);
    const joined = [first, last].filter(Boolean).join(" ").trim();
    const name = asStr(body.name) ?? (joined ? joined : null);
    return {
      name,
      username: asStr(body.username),
      pictureUrl: asStr(body.profile_pic),
    };
  } catch {
    // A deleted account, a revoked permission or a timeout must never block the
    // message itself — the contact just keeps its placeholder name.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Outbound delivery via Graph API ───────────────────────────────────────────
export type DeliveryResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  // Parsed JSON body from Meta when the response was successful. Populated for
  // calls that need to read fields like the new comment id or a resolved
  // recipient id from a Private Reply.
  data?: AnyObj;
};

async function graphPost(url: string, body: AnyObj, bearer?: string): Promise<DeliveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (resp.ok) {
      const data = asObj(await resp.json().catch(() => ({})));
      return { ok: true, data };
    }
    let detail = `HTTP ${resp.status}`;
    try {
      const j = (await resp.json()) as AnyObj;
      const err = asObj(j.error);
      detail = asStr(err.message) ?? detail;
    } catch {
      /* ignore */
    }
    return { ok: false, error: detail };
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? "Tiempo de espera agotado al contactar a Meta."
        : "No se pudo contactar a la Graph API de Meta.";
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

// Desde abril de 2026 WhatsApp identifica a quien usa nombre de usuario con un
// BSUID —país, punto y número: "DO.13491208655302741918"— y puede omitir su
// teléfono. A ese id no se le escribe con `to` sino con `recipient`; con un
// teléfono todo sigue como siempre.
export function isWhatsAppUserId(id: string): boolean {
  return /^[A-Z]{2}\./.test(id);
}

export function whatsappRecipient(recipientId: string): { to: string } | { recipient: string } {
  return isWhatsAppUserId(recipientId) ? { recipient: recipientId } : { to: recipientId };
}

// Messenger e Instagram bajan la imagen de su enlace mientras procesan el envío, y
// un texto mandado justo detrás le puede llegar al cliente antes que ella: la
// bienvenida salía con la imagen de último (2026-10-15). Entre una imagen y el
// texto que la sigue se espera un poco. WhatsApp no lo necesita: ahí la imagen y
// su texto van en un solo mensaje, con el texto como pie.
const ATTACHMENT_SETTLE_MS = (() => {
  const raw = Number(process.env.META_ATTACHMENT_SETTLE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 2500;
})();

export function settleAfterAttachment(): Promise<void> {
  return ATTACHMENT_SETTLE_MS > 0 ? new Promise((resolve) => setTimeout(resolve, ATTACHMENT_SETTLE_MS)) : Promise.resolve();
}

// El id con que Meta registró un envío: `messages[0].id` (wamid) en WhatsApp,
// `message_id` (mid) en Messenger e Instagram. Es la única forma de referirse
// después a ese mensaje, por ejemplo para contestarle citándolo.
export function sentMessageId(result: DeliveryResult): string | null {
  if (!result.ok || !result.data) return null;
  const wamid = asStr(asArray(result.data.messages)[0]?.id);
  return wamid ?? asStr(result.data.message_id);
}

// Sends a plain-text message to the given channel recipient. Returns
// { ok:false, skipped:true } when the channel is disabled or credentials are
// missing, so callers can no-op silently for internal/demo conversations.
//
// `replyTo` hace que en WhatsApp salga como respuesta a ese mensaje (el cliente
// lo ve citado encima). Messenger e Instagram lo ignoran y sale como mensaje suelto.
export async function deliverMessage(
  settings: MetaSettings,
  channel: Channel,
  recipientId: string,
  text: string,
  opts: { replyTo?: string | null } = {},
): Promise<DeliveryResult> {
  if (channel === "whatsapp") {
    if (!settings.whatsappEnabled || !settings.whatsappPhoneNumberId || !settings.whatsappAccessToken)
      return { ok: false, skipped: true, error: "WhatsApp no está habilitado o faltan credenciales." };
    return graphPost(
      `${GRAPH_BASE}/${settings.whatsappPhoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...whatsappRecipient(recipientId),
        ...(opts.replyTo ? { context: { message_id: opts.replyTo } } : {}),
        type: "text",
        text: { body: text },
      },
      settings.whatsappAccessToken,
    );
  }

  if (channel === "facebook") {
    if (!settings.facebookEnabled || !settings.facebookPageAccessToken)
      return { ok: false, skipped: true, error: "Facebook no está habilitado o faltan credenciales." };
    return graphPost(
      `${GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(settings.facebookPageAccessToken)}`,
      { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } },
    );
  }

  // instagram
  const igToken = settings.instagramAccessToken || settings.facebookPageAccessToken;
  if (!settings.instagramEnabled || !igToken)
    return { ok: false, skipped: true, error: "Instagram no está habilitado o faltan credenciales." };
  return graphPost(
    `${graphBaseForToken(igToken)}/me/messages?access_token=${encodeURIComponent(igToken)}`,
    { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } },
  );
}

// WhatsApp caps interactive reply buttons at 3, with 20-character titles. The
// same limits are applied to Messenger/Instagram quick replies so a message
// composed once behaves identically on every channel.
export const MAX_INTERACTIVE_BUTTONS = 3;
export const MAX_BUTTON_LABEL = 20;

export type InteractiveButton = { id: string; label: string };

// Sends a message with tappable reply buttons, optionally headed by an image.
//
// WhatsApp has a native `interactive`/`button` message. Messenger and Instagram
// have no equivalent, so there the image goes as its own attachment message and
// the buttons ride along as quick replies on the text — both come back through
// the webhook the same way (see parseInboundEvents).
export async function deliverInteractiveMessage(
  settings: MetaSettings,
  channel: Channel,
  recipientId: string,
  content: { text: string; imageUrl?: string | null; buttons: InteractiveButton[] },
): Promise<DeliveryResult> {
  const buttons = content.buttons.slice(0, MAX_INTERACTIVE_BUTTONS).map((b) => ({
    id: b.id,
    // Por puntos de código: una etiqueta con emoji cortada con slice() partiría
    // el par suplente y el canal recibiría un carácter roto.
    label: [...b.label].slice(0, MAX_BUTTON_LABEL).join(""),
  }));

  if (channel === "whatsapp") {
    if (!settings.whatsappEnabled || !settings.whatsappPhoneNumberId || !settings.whatsappAccessToken)
      return { ok: false, skipped: true, error: "WhatsApp no está habilitado o faltan credenciales." };

    return graphPost(
      `${GRAPH_BASE}/${settings.whatsappPhoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...whatsappRecipient(recipientId),
        type: "interactive",
        interactive: {
          type: "button",
          ...(content.imageUrl ? { header: { type: "image", image: { link: content.imageUrl } } } : {}),
          // WhatsApp rejects interactive bodies over 1024 characters.
          body: { text: content.text.slice(0, 1024) },
          action: {
            buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.label } })),
          },
        },
      },
      settings.whatsappAccessToken,
    );
  }

  const token =
    channel === "facebook"
      ? settings.facebookPageAccessToken
      : settings.instagramAccessToken || settings.facebookPageAccessToken;
  const enabled = channel === "facebook" ? settings.facebookEnabled : settings.instagramEnabled;
  if (!enabled || !token)
    return { ok: false, skipped: true, error: `${channel} no está habilitado o faltan credenciales.` };

  const url = `${graphBaseForToken(token)}/me/messages?access_token=${encodeURIComponent(token)}`;

  // Image first, as its own message: quick replies can only ride on a text message.
  if (content.imageUrl) {
    const imageResult = await graphPost(url, {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { attachment: { type: "image", payload: { url: content.imageUrl, is_reusable: true } } },
    });
    if (!imageResult.ok) return imageResult;
    await settleAfterAttachment();
  }

  return graphPost(url, {
    recipient: { id: recipientId },
    messaging_type: "RESPONSE",
    message: {
      text: content.text,
      quick_replies: buttons.map((b) => ({ content_type: "text", title: b.label, payload: b.id })),
    },
  });
}

// Una pregunta con más respuestas de las que caben en botones. WhatsApp resuelve
// esto con el interactivo de tipo `list` (hasta 10 filas detrás de un botón que
// abre el menú); Messenger e Instagram no tienen lista, pero sus quick replies
// admiten hasta 13, así que ahí van como quick replies de toda la vida. La
// respuesta vuelve por el mismo camino que un botón (list_reply en parseInboundEvents).
export const MAX_LIST_ROWS = 10;
export const MAX_QUICK_REPLIES = 13;
// Límites de WhatsApp para la lista: título de fila y texto del botón que la abre.
const MAX_ROW_TITLE = 24;
const MAX_ROW_DESCRIPTION = 72;
const MAX_LIST_ACTION_LABEL = 20;

export type ChoiceOption = { id: string; label: string; description?: string };

const clip = (text: string, max: number) => [...text].slice(0, max).join("");

export async function deliverChoiceMessage(
  settings: MetaSettings,
  channel: Channel,
  recipientId: string,
  content: { text: string; actionLabel: string; options: ChoiceOption[] },
): Promise<DeliveryResult> {
  if (channel === "whatsapp") {
    if (!settings.whatsappEnabled || !settings.whatsappPhoneNumberId || !settings.whatsappAccessToken)
      return { ok: false, skipped: true, error: "WhatsApp no está habilitado o faltan credenciales." };

    const rows = content.options.slice(0, MAX_LIST_ROWS).map((o) => ({
      id: o.id,
      title: clip(o.label, MAX_ROW_TITLE),
      ...(o.description ? { description: clip(o.description, MAX_ROW_DESCRIPTION) } : {}),
    }));

    return graphPost(
      `${GRAPH_BASE}/${settings.whatsappPhoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...whatsappRecipient(recipientId),
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: content.text.slice(0, 1024) },
          action: {
            button: clip(content.actionLabel, MAX_LIST_ACTION_LABEL),
            sections: [{ rows }],
          },
        },
      },
      settings.whatsappAccessToken,
    );
  }

  const token =
    channel === "facebook"
      ? settings.facebookPageAccessToken
      : settings.instagramAccessToken || settings.facebookPageAccessToken;
  const enabled = channel === "facebook" ? settings.facebookEnabled : settings.instagramEnabled;
  if (!enabled || !token)
    return { ok: false, skipped: true, error: `${channel} no está habilitado o faltan credenciales.` };

  return graphPost(`${graphBaseForToken(token)}/me/messages?access_token=${encodeURIComponent(token)}`, {
    recipient: { id: recipientId },
    messaging_type: "RESPONSE",
    message: {
      text: content.text,
      quick_replies: content.options.slice(0, MAX_QUICK_REPLIES).map((o) => ({
        content_type: "text",
        // Aquí la etiqueta es todo lo que el cliente ve: sin descripción donde
        // apoyarse, el nombre de la tienda tiene que bastar por sí solo.
        title: clip(o.label, MAX_BUTTON_LABEL),
        payload: o.id,
      })),
    },
  });
}

// ── Marketing: WhatsApp message templates ─────────────────────────────────────
// The Meta `message_templates` catalog only exists for WhatsApp. Instagram and
// Facebook have no downloadable templates, so the marketing UI composes free-form
// messages for those channels instead.
export type WhatsAppTemplateComponent = {
  type: string; // HEADER | BODY | FOOTER | BUTTONS
  format?: string | null; // HEADER format: TEXT | IMAGE | VIDEO | DOCUMENT | LOCATION
  text?: string | null;
  buttons?: AnyObj[] | null;
  example?: unknown;
};
export type WhatsAppTemplate = {
  name: string;
  language: string;
  status: string;
  category: string;
  components: WhatsAppTemplateComponent[];
};

// Recorre una colección paginada de la Graph API y devuelve todas sus filas.
// Lo comparten el catálogo de plantillas y la lista de números de la WABA, que
// piden lo mismo a dos endpoints distintos.
async function collectGraphPages(
  firstUrl: string,
  token: string,
): Promise<{ ok: true; rows: AnyObj[] } | { ok: false; error: string }> {
  const rows: AnyObj[] = [];
  let url: string | null = firstUrl;
  let guard = 0;
  while (url && guard < 20) {
    guard += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let json: AnyObj;
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { authorization: `Bearer ${token}` },
      });
      json = asObj(await resp.json().catch(() => null));
      if (!resp.ok) {
        const detail = asStr(asObj(json.error).message) ?? `HTTP ${resp.status}`;
        return { ok: false, error: detail };
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "AbortError"
          ? "Tiempo de espera agotado al contactar a Meta."
          : "No se pudo contactar a la Graph API de Meta.";
      return { ok: false, error: msg };
    } finally {
      clearTimeout(timeout);
    }

    rows.push(...asArray(json.data));
    url = asStr(asObj(json.paging).next);
  }
  return { ok: true, rows };
}

// Fetches approved WhatsApp templates from the WABA, following pagination.
export async function fetchWhatsAppTemplates(
  settings: MetaSettings,
): Promise<{ ok: true; templates: WhatsAppTemplate[] } | { ok: false; error: string }> {
  if (!settings.whatsappEnabled) return { ok: false, error: "WhatsApp no está habilitado." };
  const waba = settings.whatsappBusinessAccountId;
  const token = settings.whatsappAccessToken;
  if (!waba || !token)
    return { ok: false, error: "Falta el WhatsApp Business Account ID o el token de acceso." };

  const page = await collectGraphPages(`${GRAPH_BASE}/${waba}/message_templates?limit=100`, token);
  if (!page.ok) return page;

  const templates: WhatsAppTemplate[] = [];
  for (const t of page.rows) {
    const name = asStr(t.name);
    const language = asStr(t.language);
    if (!name || !language) continue;
    templates.push({
      name,
      language,
      status: asStr(t.status) ?? "",
      category: asStr(t.category) ?? "",
      components: asArray(t.components) as WhatsAppTemplateComponent[],
    });
  }
  return { ok: true, templates };
}

// ── Varios números por instancia ──────────────────────────────────────────────

// Un número tal como lo conoce Meta. Es lo que devuelve el descubrimiento contra
// la WABA para que el usuario elija cuáles da de alta, sin teclear ids a mano.
export type WhatsAppPhoneNumber = {
  phoneNumberId: string;
  displayNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
};

// Lista los números de la WhatsApp Business Account. Es el equivalente para
// números de fetchWhatsAppTemplates: una sola llamada con el token compartido
// trae todos los que el negocio tiene aprobados.
export async function fetchWhatsAppPhoneNumbers(
  settings: MetaSettings,
): Promise<{ ok: true; numbers: WhatsAppPhoneNumber[] } | { ok: false; error: string }> {
  const waba = settings.whatsappBusinessAccountId;
  const token = settings.whatsappAccessToken;
  if (!waba || !token)
    return { ok: false, error: "Falta el WhatsApp Business Account ID o el token de acceso." };

  const fields = "id,display_phone_number,verified_name,quality_rating";
  const page = await collectGraphPages(
    `${GRAPH_BASE}/${waba}/phone_numbers?limit=100&fields=${fields}`,
    token,
  );
  if (!page.ok) return page;

  const numbers: WhatsAppPhoneNumber[] = [];
  for (const n of page.rows) {
    const phoneNumberId = asStr(n.id);
    if (!phoneNumberId) continue;
    numbers.push({
      phoneNumberId,
      displayNumber: asStr(n.display_phone_number),
      verifiedName: asStr(n.verified_name),
      qualityRating: asStr(n.quality_rating),
    });
  }
  return { ok: true, numbers };
}

// El número por el que sale un envío, en la forma que ya esperan las funciones
// deliver*. En vez de cambiarle la firma a las seis, se les entrega un
// MetaSettings con el número de esta fila puesto encima del compartido.
//
// El token de la fila casi siempre es null —los números de una misma WABA
// comparten el de integration_settings— y entonces se hereda el compartido.
export function settingsForNumber(
  settings: MetaSettings,
  number: { phoneNumberId: string; accessToken: string | null } | null,
): MetaSettings {
  if (!number) return settings;
  return {
    ...settings,
    whatsappPhoneNumberId: number.phoneNumberId,
    whatsappAccessToken: number.accessToken ?? settings.whatsappAccessToken,
  };
}

// Uploads a media asset to WhatsApp and returns its media id, so template
// headers can reference it by id (no public URL required).
export async function uploadWhatsAppMedia(
  settings: MetaSettings,
  data: Buffer,
  mimeType: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const token = settings.whatsappAccessToken;
  const phoneId = settings.whatsappPhoneNumberId;
  if (!token || !phoneId) return { ok: false, error: "Faltan credenciales de WhatsApp." };

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), "upload");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const resp = await fetch(`${GRAPH_BASE}/${phoneId}/media`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    const json = asObj(await resp.json().catch(() => null));
    if (!resp.ok) return { ok: false, error: asStr(asObj(json.error).message) ?? `HTTP ${resp.status}` };
    const id = asStr(json.id);
    if (!id) return { ok: false, error: "Meta no devolvió un id de media." };
    return { ok: true, id };
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? "Tiempo de espera agotado al subir el archivo a Meta."
        : "No se pudo subir el archivo a Meta.";
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

// Translates a stored CampaignPayload into WhatsApp template `components`
// (header media/location + body variables).
export function buildTemplateComponents(payload: CampaignPayload | null | undefined): AnyObj[] {
  const components: AnyObj[] = [];
  const header = payload?.header;
  if (header) {
    if (header.type === "location") {
      components.push({
        type: "header",
        parameters: [
          {
            type: "location",
            location: {
              latitude: String(header.latitude),
              longitude: String(header.longitude),
              name: header.name ?? "",
              address: header.address ?? "",
            },
          },
        ],
      });
    } else {
      const mediaParam = header.mediaId
        ? { id: header.mediaId }
        : header.url
          ? { link: header.url }
          : null;
      if (mediaParam) {
        components.push({
          type: "header",
          parameters: [{ type: header.type, [header.type]: mediaParam }],
        });
      }
    }
  }
  const vars = payload?.variables ?? [];
  if (vars.length > 0) {
    components.push({ type: "body", parameters: vars.map((text) => ({ type: "text", text })) });
  }
  return components;
}

// Sends an approved WhatsApp template to a recipient.
export async function deliverTemplateMessage(
  settings: MetaSettings,
  recipientId: string,
  template: { name: string; language: string; components: AnyObj[] },
): Promise<DeliveryResult> {
  if (!settings.whatsappEnabled || !settings.whatsappPhoneNumberId || !settings.whatsappAccessToken)
    return { ok: false, skipped: true, error: "WhatsApp no está habilitado o faltan credenciales." };
  return graphPost(
    `${GRAPH_BASE}/${settings.whatsappPhoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...whatsappRecipient(recipientId),
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language },
        ...(template.components.length ? { components: template.components } : {}),
      },
    },
    settings.whatsappAccessToken,
  );
}

// Sends a free-form media message: marketing sends and product photos, and any
// file the team attaches in a chat (within the 24h window). WhatsApp takes the
// file by link or by the id of a prior upload to Meta (uploadWhatsAppMedia);
// Instagram/Facebook only by a publicly reachable url, and their attachments
// carry no caption — callers send it as a separate text.
export type OutboundMedia = {
  type: "image" | "video" | "audio" | "document";
  url?: string | null;
  mediaId?: string | null;
  caption?: string | null;
  // Documents only: the name the customer sees on the file.
  filename?: string | null;
};

export async function deliverMediaMessage(
  settings: MetaSettings,
  channel: Channel,
  recipientId: string,
  media: OutboundMedia,
  opts: { replyTo?: string | null } = {},
): Promise<DeliveryResult> {
  if (channel === "whatsapp") {
    if (!settings.whatsappEnabled || !settings.whatsappPhoneNumberId || !settings.whatsappAccessToken)
      return { ok: false, skipped: true, error: "WhatsApp no está habilitado o faltan credenciales." };
    const ref = media.mediaId ? { id: media.mediaId } : media.url ? { link: media.url } : null;
    if (!ref) return { ok: false, error: "El adjunto no trae archivo." };
    return graphPost(
      `${GRAPH_BASE}/${settings.whatsappPhoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...whatsappRecipient(recipientId),
        ...(opts.replyTo ? { context: { message_id: opts.replyTo } } : {}),
        type: media.type,
        [media.type]: {
          ...ref,
          // WhatsApp no admite pie en los audios.
          ...(media.caption && media.type !== "audio" ? { caption: media.caption } : {}),
          ...(media.type === "document" && media.filename ? { filename: media.filename } : {}),
        },
      },
      settings.whatsappAccessToken,
    );
  }

  if (!media.url) return { ok: false, error: "Messenger e Instagram solo aceptan adjuntos por URL." };

  const isInstagram = channel === "instagram";
  const token = isInstagram
    ? settings.instagramAccessToken || settings.facebookPageAccessToken
    : settings.facebookPageAccessToken;
  const enabled = isInstagram ? settings.instagramEnabled : settings.facebookEnabled;
  if (!enabled || !token)
    return {
      ok: false,
      skipped: true,
      error: `${isInstagram ? "Instagram" : "Facebook"} no está habilitado o faltan credenciales.`,
    };
  return graphPost(`${graphBaseForToken(token)}/me/messages?access_token=${encodeURIComponent(token)}`, {
    recipient: { id: recipientId },
    messaging_type: "RESPONSE",
    message: {
      attachment: {
        // Messenger llama "file" a lo que WhatsApp llama documento.
        type: media.type === "document" ? "file" : media.type,
        payload: { url: media.url, is_reusable: true },
      },
    },
  });
}

// ── Feed comments (Facebook/Instagram public posts) ───────────────────────────

function feedTokenFor(
  channel: "facebook" | "instagram",
  settings: MetaSettings,
): { token: string | null; enabled: boolean; label: string } {
  if (channel === "facebook") {
    return {
      token: settings.facebookPageAccessToken,
      enabled: !!settings.facebookEnabled,
      label: "Facebook",
    };
  }
  return {
    token: settings.instagramAccessToken || settings.facebookPageAccessToken,
    enabled: !!settings.instagramEnabled,
    label: "Instagram",
  };
}

// Publishes a PUBLIC reply under a specific comment. Facebook uses
// /{comment-id}/comments; Instagram uses /{comment-id}/replies. Both require
// the corresponding manage-engagement / manage-comments permission on the
// access token. Returns the new comment id in `data.id` on success.
export async function postPublicComment(
  settings: MetaSettings,
  channel: "facebook" | "instagram",
  commentId: string,
  text: string,
): Promise<DeliveryResult> {
  const { token, enabled, label } = feedTokenFor(channel, settings);
  if (!enabled || !token) {
    return {
      ok: false,
      skipped: true,
      error: `${label} no está habilitado o faltan credenciales para responder comentarios.`,
    };
  }
  const path = channel === "facebook" ? "comments" : "replies";
  return graphPost(
    `${graphBaseForToken(token)}/${encodeURIComponent(commentId)}/${path}?access_token=${encodeURIComponent(token)}`,
    { message: text },
  );
}

// Sends a Private Reply — a DM triggered by a public comment. Facebook/Instagram
// both go through /me/messages with recipient.comment_id. This is the ONLY way
// to open a DM from a comment (the commenter's ASID/IG-user-id can't be used
// with recipient.id). On success Meta returns `recipient_id` = the PSID/IGSID
// we should store on the resulting DM conversation. Only one Private Reply per
// comment is allowed and it must be sent within 7 days of the comment.
export async function sendPrivateReply(
  settings: MetaSettings,
  channel: "facebook" | "instagram",
  commentId: string,
  text: string,
): Promise<DeliveryResult> {
  const { token, enabled, label } = feedTokenFor(channel, settings);
  if (!enabled || !token) {
    return {
      ok: false,
      skipped: true,
      error: `${label} no está habilitado o faltan credenciales para responder por privado.`,
    };
  }
  return graphPost(
    `${graphBaseForToken(token)}/me/messages?access_token=${encodeURIComponent(token)}`,
    { recipient: { comment_id: commentId }, message: { text } },
  );
}

// Best-effort fetch of a post/media's metadata to render a preview in the Feed
// UI. Never throws — a permission error or a deleted post just returns null and
// the thread shows without a preview.
export type FetchedPostMetadata = {
  caption: string | null;
  permalink: string | null;
  mediaUrl: string | null;
};

export async function fetchPostMetadata(
  settings: MetaSettings,
  channel: "facebook" | "instagram",
  postId: string,
): Promise<FetchedPostMetadata | null> {
  const { token, enabled } = feedTokenFor(channel, settings);
  if (!enabled || !token) return null;
  const fields =
    channel === "facebook"
      ? "message,permalink_url,full_picture"
      : "caption,permalink,media_url,thumbnail_url";
  const url = `${graphBaseForToken(token)}/${encodeURIComponent(postId)}?fields=${fields}&access_token=${encodeURIComponent(token)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    const body = asObj(await resp.json().catch(() => ({})));
    if (channel === "facebook") {
      return {
        caption: asStr(body.message),
        permalink: asStr(body.permalink_url),
        mediaUrl: asStr(body.full_picture),
      };
    }
    return {
      caption: asStr(body.caption),
      permalink: asStr(body.permalink),
      mediaUrl: asStr(body.media_url) ?? asStr(body.thumbnail_url),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
