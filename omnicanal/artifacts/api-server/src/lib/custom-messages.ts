import { and, eq } from "drizzle-orm";
import { db, customMessagesTable, conversationsTable, messagesTable } from "@workspace/db";
import { deliverInteractiveMessage, deliverMediaMessage, deliverMessage, settleAfterAttachment, type Channel } from "./meta";
import { signMediaUrl } from "./supabase";
import type { Log } from "./messaging";

type Conversation = typeof conversationsTable.$inferSelect;

// Meta fetches the image while handling the send, so a short-lived signed URL is
// enough — the bucket stays private.
const IMAGE_URL_TTL_SECONDS = 600;

export async function getActiveWelcomeMessage(channel: string) {
  const [message] = await db
    .select()
    .from(customMessagesTable)
    .where(and(eq(customMessagesTable.kind, "welcome"), eq(customMessagesTable.isActive, true)))
    .limit(1);

  if (!message) return null;
  // Empty `channels` means every channel.
  if (message.channels.length > 0 && !message.channels.includes(channel)) return null;
  return message;
}

// Sends the active welcome message on a conversation that just started. Returns
// false when there is nothing to send, so the caller falls back to the virtual
// agent instead of leaving the customer unanswered.
export async function maybeSendWelcomeMessage(
  conv: Pick<Conversation, "id" | "channel" | "externalId">,
  settings: Parameters<typeof deliverMessage>[0] | null,
  log: Log,
): Promise<boolean> {
  const message = await getActiveWelcomeMessage(conv.channel);
  if (!message) return false;

  // Persist first: the operator must see what the customer was sent even if the
  // Meta call then fails.
  const imageUrl = message.imagePath ? await signMediaUrl(message.imagePath, IMAGE_URL_TTL_SECONDS) : null;

  if (message.imagePath) {
    await db.insert(messagesTable).values({
      conversationId: conv.id,
      sender: "bot",
      content: `/api/media/${message.imagePath}`,
      type: "image",
      isAiSuggestion: false,
    });
  }

  // The button labels are appended to the stored copy so the inbox transcript
  // shows what the customer could choose; the channel renders them as buttons.
  const transcript = message.buttons.length
    ? `${message.body}\n\n${message.buttons.map((b) => `• ${b.label}`).join("\n")}`
    : message.body;

  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: "bot",
    content: transcript,
    type: "text",
    isAiSuggestion: false,
  });

  await db
    .update(conversationsTable)
    .set({ lastMessage: message.body, updatedAt: new Date() })
    .where(eq(conversationsTable.id, conv.id));

  if (!conv.externalId || !settings) return true; // internal/demo conversation

  const channel = conv.channel as Channel;
  const result = message.buttons.length
    ? await deliverInteractiveMessage(settings, channel, conv.externalId, {
        text: message.body,
        imageUrl,
        buttons: message.buttons,
      })
    : await deliverPlainWelcome(settings, channel, conv.externalId, message.body, imageUrl);

  if (!result.ok && !result.skipped) {
    log.error(
      { conversationId: conv.id, channel: conv.channel, messageId: message.id, error: result.error },
      "welcome message delivery failed",
    );
  }
  return true;
}

// Bienvenida sin botones. El interactivo es el único envío que lleva la imagen de
// cabecera, así que sin botones hay que mandarla por su cuenta: en WhatsApp como
// imagen con pie —una sola burbuja— y en Messenger/Instagram, que no admiten pie
// en un adjunto, como imagen seguida del texto. Antes esta rama mandaba solo el
// texto: la imagen quedaba guardada en la bandeja y al cliente nunca le llegaba.
async function deliverPlainWelcome(
  settings: Parameters<typeof deliverMessage>[0],
  channel: Channel,
  recipientId: string,
  body: string,
  imageUrl: string | null,
) {
  if (!imageUrl) return deliverMessage(settings, channel, recipientId, body);

  const image = await deliverMediaMessage(settings, channel, recipientId, {
    type: "image",
    url: imageUrl,
    caption: channel === "whatsapp" ? body : null,
  });
  if (channel === "whatsapp" || !image.ok) return image;
  // Sin la pausa, el texto le llegaba al cliente antes que la imagen.
  await settleAfterAttachment();
  return deliverMessage(settings, channel, recipientId, body);
}
