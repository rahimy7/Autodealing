import { and, eq } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignRecipientsTable,
  contactsTable,
  integrationSettingsTable,
  type Campaign,
  type CampaignRecipient,
  type CampaignPayload,
} from "@workspace/db";
import {
  deliverMessage,
  deliverTemplateMessage,
  deliverMediaMessage,
  buildTemplateComponents,
  settingsForNumber,
  sentMessageId,
  type Channel,
  type MetaSettings,
} from "./meta";
import { resolveOutboundNumber } from "./whatsapp-numbers";
import { logger } from "./logger";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Guards against a campaign being sent twice at once (e.g. the manual send
// endpoint and the scheduler firing for the same row).
const inFlight = new Set<number>();

export async function loadIntegrationSettings(): Promise<MetaSettings | null> {
  const [row] = await db
    .select()
    .from(integrationSettingsTable)
    .orderBy(integrationSettingsTable.id)
    .limit(1);
  return row ?? null;
}

// Las credenciales con las que sale ESTA campaña: las compartidas, con el número
// que eligió quien la creó. Se resuelve una vez por envío y no por destinatario —
// son los mismos para los cientos de mensajes de la tanda.
//
// Una campaña sin número elegido (las de Instagram/Facebook, y las creadas antes
// de que hubiera varios) sale por el principal, que es como se comportaba antes.
async function loadCampaignSettings(campaign: Campaign): Promise<MetaSettings | null> {
  const settings = await loadIntegrationSettings();
  if (!settings || campaign.channel !== "whatsapp") return settings;
  return settingsForNumber(settings, await resolveOutboundNumber(campaign.whatsappNumberId));
}

async function sendToRecipient(
  settings: MetaSettings | null,
  campaign: Campaign,
  recipient: CampaignRecipient,
  contactName: string | null,
): Promise<{ ok: boolean; error?: string; providerMessageId?: string | null }> {
  if (!settings) return { ok: false, error: "No hay configuración de integraciones." };
  if (!recipient.recipientExternalId)
    return { ok: false, error: "El contacto no tiene identificador para este canal." };

  const channel = campaign.channel as Channel;
  const payload = (campaign.payload ?? null) as CampaignPayload | null;

  // WhatsApp marketing → approved Meta template.
  if (
    campaign.mode === "template" &&
    channel === "whatsapp" &&
    campaign.templateName &&
    campaign.templateLanguage
  ) {
    const components = buildTemplateComponents(payload);
    if (campaign.templateName === "ausentes" && campaign.templateLanguage === "es") {
      const nombre = contactName?.trim();
      if (!nombre || !/\p{L}/u.test(nombre)) {
        return { ok: false, error: "El contacto necesita un nombre para la plantilla ausentes." };
      }
      const bodyIndex = components.findIndex((component) => component.type === "body");
      const body = {
        type: "body",
        parameters: [{ type: "text", parameter_name: "nombre", text: nombre }],
      };
      if (bodyIndex < 0) components.push(body);
      else components[bodyIndex] = body;
    }
    const res = await deliverTemplateMessage(settings, recipient.recipientExternalId, {
      name: campaign.templateName,
      language: campaign.templateLanguage,
      components,
    });
    return res.ok ? { ok: true, providerMessageId: sentMessageId(res) } : { ok: false, error: res.error };
  }

  // Free-form (Instagram / Facebook, and any non-template WhatsApp).
  const text = payload?.bodyText ?? campaign.message ?? "";
  const media = payload?.media;
  if (!media?.url && !text) return { ok: false, error: "La campaña no tiene contenido." };

  let anyOk = false;
  let lastError: string | undefined;

  if (media?.url) {
    const res = await deliverMediaMessage(settings, channel, recipient.recipientExternalId, {
      type: media.type ?? "image",
      url: media.url,
      caption: text || null,
    });
    if (res.ok) anyOk = true;
    else lastError = res.error;
  }

  // WhatsApp media carries its own caption; IG/FB attachments do not, so the text
  // is sent as a separate message there.
  const mediaCarriesText = channel === "whatsapp" && Boolean(media?.url);
  if (text && !mediaCarriesText) {
    const res = await deliverMessage(settings, channel, recipient.recipientExternalId, text);
    if (res.ok) anyOk = true;
    else lastError = res.error ?? lastError;
  }

  return anyOk ? { ok: true } : { ok: false, error: lastError ?? "No se pudo enviar el mensaje." };
}

// Delivers a campaign to all of its pending recipients, updating per-recipient
// status and the aggregate counters. Used by both the manual send endpoint and
// the scheduler. Sequential with a small delay to stay under Meta's rate limits.
export async function runCampaignSend(campaignId: number): Promise<{ ok: boolean; error?: string }> {
  if (inFlight.has(campaignId)) return { ok: false, error: "La campaña ya se está enviando." };
  inFlight.add(campaignId);
  try {
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
    if (!campaign) return { ok: false, error: "Campaña no encontrada." };

    const settings = await loadCampaignSettings(campaign);
    await db.update(campaignsTable).set({ status: "sending" }).where(eq(campaignsTable.id, campaignId));

    const pending = await db
      .select({ recipient: campaignRecipientsTable, contactName: contactsTable.name })
      .from(campaignRecipientsTable)
      .leftJoin(contactsTable, eq(campaignRecipientsTable.contactId, contactsTable.id))
      .where(
        and(
          eq(campaignRecipientsTable.campaignId, campaignId),
          eq(campaignRecipientsTable.status, "pending"),
        ),
      );

    for (const { recipient, contactName } of pending) {
      const result = await sendToRecipient(settings, campaign, recipient, contactName);
      await db
        .update(campaignRecipientsTable)
        .set({
          status: result.ok ? "sent" : "failed",
          error: result.error ?? null,
          sentAt: result.ok ? new Date() : null,
          providerMessageId: result.providerMessageId ?? null,
          providerNumberId: campaign.channel === "whatsapp" ? settings?.whatsappPhoneNumberId ?? null : null,
        })
        .where(eq(campaignRecipientsTable.id, recipient.id));
      await sleep(150);
    }

    const all = await db
      .select()
      .from(campaignRecipientsTable)
      .where(eq(campaignRecipientsTable.campaignId, campaignId));
    const sentCount = all.filter((r) => r.status === "sent").length;
    const failedCount = all.filter((r) => r.status === "failed").length;
    const finalStatus = sentCount > 0 ? "sent" : "failed";

    await db
      .update(campaignsTable)
      .set({ status: finalStatus, sentCount, failedCount, sentAt: new Date() })
      .where(eq(campaignsTable.id, campaignId));

    return { ok: true };
  } catch (err) {
    logger.error({ err, campaignId }, "campaign send failed");
    await db
      .update(campaignsTable)
      .set({ status: "failed" })
      .where(eq(campaignsTable.id, campaignId))
      .catch(() => {});
    return { ok: false, error: "Error al enviar la campaña." };
  } finally {
    inFlight.delete(campaignId);
  }
}

