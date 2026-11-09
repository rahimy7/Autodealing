import express, { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignRecipientsTable,
  contactsTable,
  type CampaignPayload,
} from "@workspace/db";
import {
  CreateCampaignBody,
  UpdateCampaignBody,
  UpdateCampaignParams,
  GetCampaignParams,
  DeleteCampaignParams,
  SendCampaignParams,
  ListCampaignsResponse,
  GetCampaignResponse,
  UpdateCampaignResponse,
  SendCampaignResponse,
  ListCampaignTemplatesQueryParams,
  ListCampaignTemplatesResponse,
  ListCampaignRecipientsParams,
  ListCampaignRecipientsResponse,
} from "@workspace/api-zod";
import { fetchWhatsAppTemplates, uploadWhatsAppMedia } from "../lib/meta";
import { uploadMedia, signMediaUrl } from "../lib/supabase";
import { runCampaignSend, loadIntegrationSettings } from "../lib/campaign-sender";
import { campaignReportRow, campaignReportSummary } from "../lib/campaign-report-model";

const router: IRouter = Router();

router.get("/campaigns", async (_req, res): Promise<void> => {
  const campaigns = await db.select().from(campaignsTable).orderBy(campaignsTable.createdAt);
  res.json(ListCampaignsResponse.parse(campaigns));
});

router.post("/campaigns", async (req, res): Promise<void> => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { channel, recipientContactIds } = parsed.data;
  const mode = parsed.data.mode ?? (channel === "whatsapp" ? "template" : "freeform");
  const scheduledAt = parsed.data.scheduledAt ?? null;
  const status = scheduledAt && scheduledAt.getTime() > Date.now() ? "scheduled" : "draft";

  const contactIds = recipientContactIds ?? [];
  const contacts = contactIds.length
    ? await db.select().from(contactsTable).where(inArray(contactsTable.id, contactIds))
    : [];

  const [campaign] = await db
    .insert(campaignsTable)
    .values({
      name: parsed.data.name,
      channel,
      // Solo tiene sentido en WhatsApp; en los otros canales hay una sola cuenta
      // y guardar un número ahí sería ruido.
      whatsappNumberId: channel === "whatsapp" ? parsed.data.whatsappNumberId ?? null : null,
      type: parsed.data.type,
      mode,
      message: parsed.data.message ?? null,
      templateName: parsed.data.templateName ?? null,
      templateLanguage: parsed.data.templateLanguage ?? null,
      payload: (parsed.data.payload ?? null) as CampaignPayload | null,
      status,
      recipientCount: contacts.length,
      sentCount: 0,
      failedCount: 0,
      openedCount: 0,
      scheduledAt,
    })
    .returning();

  if (contacts.length) {
    await db.insert(campaignRecipientsTable).values(
      contacts.map((c) => ({
        campaignId: campaign.id,
        contactId: c.id,
        channel,
        // externalId is the channel-scoped delivery id; WhatsApp can also use the phone.
        recipientExternalId: c.externalId ?? (channel === "whatsapp" ? c.phone : null),
        status: "pending" as const,
      })),
    );
  }

  res.status(201).json(GetCampaignResponse.parse(campaign));
});

// Live proxy to Meta's WhatsApp message templates. Registered before
// /campaigns/:id so "templates" isn't captured as an :id.
router.get("/campaigns/templates", async (req, res): Promise<void> => {
  const query = ListCampaignTemplatesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  // Only WhatsApp has a downloadable template catalog; IG/FB compose free-form.
  if (query.data.channel !== "whatsapp") {
    res.json(ListCampaignTemplatesResponse.parse([]));
    return;
  }

  const settings = await loadIntegrationSettings();
  if (!settings) {
    res.status(400).json({ error: "No hay configuración de integraciones." });
    return;
  }

  const result = await fetchWhatsAppTemplates(settings);
  if (!result.ok) {
    res.status(502).json({ error: result.error });
    return;
  }
  res.json(ListCampaignTemplatesResponse.parse(result.templates));
});

// Uploads an image/video for a broadcast. Raw binary (like the media download
// route, this stays outside the JSON contract). Stores in Supabase and, for
// WhatsApp, also uploads to Meta so the template header can reference it by id.
const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "application/pdf": ".pdf",
};

router.post(
  "/campaigns/media",
  express.raw({ type: () => true, limit: "30mb" }),
  async (req, res): Promise<void> => {
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || data.length === 0) {
      res.status(400).json({ error: "Archivo vacío o inválido." });
      return;
    }
    const contentType = (req.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
    const channel = typeof req.query.channel === "string" ? req.query.channel : "";
    const filename = `broadcast-${crypto.randomUUID()}${MIME_EXT[contentType] ?? ""}`;

    const stored = await uploadMedia(filename, data, contentType);
    if (!stored) {
      res.status(502).json({ error: "No se pudo almacenar el archivo (almacenamiento no configurado)." });
      return;
    }

    // 30-day signed URL — used by IG/FB attachment sends (bucket is private).
    const url = await signMediaUrl(filename, 60 * 60 * 24 * 30);

    let whatsappMediaId: string | null = null;
    if (channel === "whatsapp") {
      const settings = await loadIntegrationSettings();
      if (settings) {
        const uploaded = await uploadWhatsAppMedia(settings, data, contentType);
        if (uploaded.ok) whatsappMediaId = uploaded.id;
        else req.log?.warn?.({ error: uploaded.error }, "whatsapp media upload failed");
      }
    }

    res.json({ path: filename, url, whatsappMediaId, contentType });
  },
);

// Same authentication and instance database as the campaign list. Deliberately
// separate from the generated legacy recipient response, which strips new fields.
router.get("/campaigns/:id/report", async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Campaña inválida." }); return; }
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  if (!campaign) { res.status(404).json({ error: "Campaña no encontrada." }); return; }
  const rows = await db.select({
    recipient: campaignRecipientsTable,
    contactName: contactsTable.name,
    phone: contactsTable.phone,
  }).from(campaignRecipientsTable)
    .leftJoin(contactsTable, eq(campaignRecipientsTable.contactId, contactsTable.id))
    .where(eq(campaignRecipientsTable.campaignId, campaign.id))
    .orderBy(campaignRecipientsTable.id);
  const recipients = rows.map(({ recipient, contactName, phone }) => ({
    ...campaignReportRow(recipient), contactName: contactName ?? "Contacto eliminado", phone,
  }));
  res.json({ campaign: { id: campaign.id, name: campaign.name, channel: campaign.channel,
    status: campaign.status, createdAt: campaign.createdAt, scheduledAt: campaign.scheduledAt },
    summary: campaignReportSummary(recipients), recipients, updatedAt: new Date() });
});

router.get("/campaigns/:id", async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  res.json(GetCampaignResponse.parse(campaign));
});

router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const params = UpdateCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Partial<typeof campaignsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.message !== undefined) updateData.message = parsed.data.message;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.scheduledAt !== undefined) updateData.scheduledAt = parsed.data.scheduledAt ?? null;

  const [campaign] = await db.update(campaignsTable).set(updateData).where(eq(campaignsTable.id, params.data.id)).returning();

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  res.json(UpdateCampaignResponse.parse(campaign));
});

router.delete("/campaigns/:id", async (req, res): Promise<void> => {
  const params = DeleteCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [campaign] = await db.delete(campaignsTable).where(eq(campaignsTable.id, params.data.id)).returning();

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/campaigns/:id/recipients", async (req, res): Promise<void> => {
  const params = ListCampaignRecipientsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db
    .select({
      id: campaignRecipientsTable.id,
      campaignId: campaignRecipientsTable.campaignId,
      contactId: campaignRecipientsTable.contactId,
      contactName: contactsTable.name,
      channel: campaignRecipientsTable.channel,
      recipientExternalId: campaignRecipientsTable.recipientExternalId,
      status: campaignRecipientsTable.status,
      error: campaignRecipientsTable.error,
      sentAt: campaignRecipientsTable.sentAt,
    })
    .from(campaignRecipientsTable)
    .leftJoin(contactsTable, eq(campaignRecipientsTable.contactId, contactsTable.id))
    .where(eq(campaignRecipientsTable.campaignId, params.data.id))
    .orderBy(campaignRecipientsTable.id);

  res.json(ListCampaignRecipientsResponse.parse(rows));
});

router.post("/campaigns/:id/send", async (req, res): Promise<void> => {
  const params = SendCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  // Fire-and-forget: the delivery loop runs in the background so large recipient
  // lists don't block the HTTP response. The client refetches to see progress.
  void runCampaignSend(existing.id);

  res.json(SendCampaignResponse.parse({ ...existing, status: "sending" }));
});

export default router;

