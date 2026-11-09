import { Router, type IRouter, type Request } from "express";
import { db, integrationSettingsTable } from "@workspace/db";
import {
  verifyWebhookSignature,
  webhookSecretsForObject,
  describeSignatureMismatch,
  describeWebhookOrigin,
  parseInboundEvents,
  parseInboundCommentEvents,
  summarizeDeliveryReceipt,
} from "../lib/meta";
import { ingestInboundMessage } from "../lib/messaging";
import { ingestInboundComment } from "../lib/feed";
import { isModuleEnabled } from "../lib/client-config";
import { trackCampaignWebhook } from "../lib/campaign-reporting";

const router: IRouter = Router();

async function loadSettings() {
  const [row] = await db
    .select()
    .from(integrationSettingsTable)
    .orderBy(integrationSettingsTable.id)
    .limit(1);
  return row ?? null;
}

function rawBodyOf(req: Request): Buffer | undefined {
  return (req as unknown as { rawBody?: Buffer }).rawBody;
}

// Meta webhook verification handshake (GET). Meta calls this when you subscribe
// the callback URL; it echoes hub.challenge when the verify token matches.
router.get("/webhooks/meta", async (req, res): Promise<void> => {
  const settings = await loadSettings();
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    typeof token === "string" &&
    settings?.webhookVerifyToken &&
    token === settings.webhookVerifyToken
  ) {
    req.log.info("webhook handshake ok");
    res.status(200).send(typeof challenge === "string" ? challenge : "");
    return;
  }
  req.log.error(
    { mode, tokenReceived: typeof token === "string", tokenConfigured: !!settings?.webhookVerifyToken },
    "webhook handshake rejected",
  );
  res.sendStatus(403);
});

// Inbound events (POST). Verifies the payload signature, acks fast, then ingests.
router.post("/webhooks/meta", async (req, res): Promise<void> => {
  const settings = await loadSettings();
  const signature = req.header("x-hub-signature-256");

  const body = req.body as { object?: unknown; entry?: unknown };
  req.log.info(
    {
      object: body?.object,
      entries: Array.isArray(body?.entry) ? body.entry.length : 0,
      signed: !!signature,
    },
    "webhook received",
  );

  const rawBody = rawBodyOf(req);
  const secrets = webhookSecretsForObject(
    body?.object,
    settings ?? {},
    process.env.WHATSAPP_META_APP_SECRET,
  );
  if (!verifyWebhookSignature(secrets, rawBody, signature)) {
    const origin = describeWebhookOrigin(req.body);
    req.log.error(
      {
        hasAppSecret: !!settings?.metaAppSecret,
        hasInstagramAppSecret: !!settings?.instagramAppSecret,
        hasWhatsAppAppSecret: !!process.env.WHATSAPP_META_APP_SECRET?.trim(),
        // El caso que más se repite: Instagram con inicio de sesión con Instagram
        // firma con la clave de la app de Instagram, y sin ella nada de Instagram entra.
        hint:
          origin.object === "instagram" && !settings?.instagramAppSecret
            ? "Falta el App Secret de Instagram en Configuración → Conexión Meta → Instagram"
            : undefined,
        hasRawBody: !!rawBody,
        hasSignatureHeader: !!signature,
        metaAppId: settings?.metaAppId ?? null,
        // Una firma que no cuadra no es de nuestra app. Sin saber de quién viene
        // no hay manera de distinguir a otra app de Meta apuntada a esta URL del
        // ruido de internet, así que se anota el remitente, no el contenido.
        userAgent: req.header("user-agent") ?? null,
        ip: req.ip,
        origin,
        ...describeSignatureMismatch(settings?.metaAppSecret ?? null, rawBody, signature),
      },
      "webhook signature verification failed",
    );
    res.sendStatus(403);
    return;
  }

  // Un canal apagado para esta instancia se descarta aquí: la app de Meta puede
  // estar suscrita a más de lo que el cliente contrató, y sin este filtro un
  // evento de Instagram abriría conversaciones en una instancia que no vende
  // Instagram. Igual con los comentarios, que son el módulo de feed.
  const events = parseInboundEvents(req.body).filter((ev) => {
    if (isModuleEnabled(ev.channel)) return true;
    req.log.info({ channel: ev.channel }, "evento descartado: canal apagado para esta instancia");
    return false;
  });
  const commentEvents = isModuleEnabled("feed")
    ? parseInboundCommentEvents(req.body, {
        pageId: settings?.facebookPageId ?? null,
        instagramAccountId: settings?.instagramBusinessAccountId ?? null,
      }).filter((ev) => isModuleEnabled(ev.channel))
    : [];
  // Sin eventos hay dos casos distintos y merecen registros distintos: un acuse
  // de entrega, que es rutina y sale resumido, y una forma que no reconocemos,
  // que se vuelca entera porque es la única manera de poder añadirla después.
  if (events.length === 0 && commentEvents.length === 0) {
    const receipt = summarizeDeliveryReceipt(req.body);
    if (receipt) {
      req.log.info(receipt, "webhook: acuse de entrega de WhatsApp");
    } else {
      req.log.info({ body: req.body }, "webhook produced no inbound events");
    }
  } else {
    req.log.info(
      {
        count: events.length,
        commentCount: commentEvents.length,
        channels: events.map((e) => e.channel),
        // Para poder encontrar en el log a un cliente que dice haber escrito.
        senders: events.map((e) => e.senderId),
      },
      "webhook inbound events parsed",
    );
  }
  // Ack immediately (Meta expects a fast 200); process asynchronously.
  res.sendStatus(200);

  if (isModuleEnabled("whatsapp")) {
    trackCampaignWebhook(req.body, events).catch((err) => req.log.error({ err }, "campaign receipt tracking failed"));
  }

  for (const ev of events) {
    ingestInboundMessage(ev, req.log).catch((err) => req.log.error({ err }, "inbound ingest failed"));
  }
  for (const ev of commentEvents) {
    ingestInboundComment(ev, req.log).catch((err) => req.log.error({ err }, "inbound comment ingest failed"));
  }
});

export default router;

