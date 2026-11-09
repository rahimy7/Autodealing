import { and, eq, lte, isNotNull } from "drizzle-orm";
import { db, campaignsTable } from "@workspace/db";
import { runCampaignSend } from "./campaign-sender";
import { sweepIdleConversations } from "./conversation-session";
import { planFollowupsAfterClose, sweepFollowups, sweepUnansweredConversations } from "./followups";
import { sweepAppointmentReminders } from "./appointment-reminders";
import { purgeOldErrorLogs } from "./error-log";
import { purgeOldStagedEmailAttachments, syncGmail } from "./email";
import { sweepExchangeRates } from "./exchange-rates";
import { sweepReorderPoints } from "./purchasing";
import { sweepShopifyOrders } from "./shopify-sync";
import { sweepShopifySubscribers } from "./shopify-subscribers";
import { isModuleEnabled } from "./client-config";
import { logger } from "./logger";
import { APP_TIMEZONE } from "./time";
import { parseSchedulerWindow, schedulerSlot, type SchedulerWindow } from "./scheduler-window";

let started = false;
let lastErrorPurge = 0;
let lastAttachmentPurge = 0;
const ERROR_PURGE_EVERY_MS = 60 * 60 * 1000;
const ATTACHMENT_PURGE_EVERY_MS = 60 * 60 * 1000;

// In-process poller that launches scheduled campaigns once their scheduledAt is
// due, and closes conversations that went quiet. The app runs as a single process
// (Railway), so an in-memory interval is enough — no external queue/worker is
// involved. runCampaignSend guards against double-processing via its own in-flight
// set, and closing a session is idempotent.
export function startScheduler(intervalMs = 60_000): void {
  if (started) return;
  started = true;

  const tick = async (): Promise<void> => {
    try {
      const due = await db
        .select({ id: campaignsTable.id })
        .from(campaignsTable)
        .where(
          and(
            eq(campaignsTable.status, "scheduled"),
            isNotNull(campaignsTable.scheduledAt),
            lte(campaignsTable.scheduledAt, new Date()),
          ),
        );
      for (const campaign of due) {
        logger.info({ campaignId: campaign.id }, "scheduler: launching due campaign");
        await runCampaignSend(campaign.id);
      }
    } catch (err) {
      logger.error({ err }, "scheduler tick failed");
    }

    // Los seguimientos son trabajo de agentes virtuales: sin el módulo de IA no se
    // programa ni se envía nada, igual que no contesta ningún agente.
    const followupsEnabled = isModuleEnabled("aiAgents");

    try {
      await sweepIdleConversations(
        logger,
        followupsEnabled ? (conversationId) => planFollowupsAfterClose(conversationId, logger) : undefined,
      );
    } catch (err) {
      logger.error({ err }, "idle conversation sweep failed");
    }

    // Primero se detecta a quien se quedó sin respuesta, luego se envía lo que
    // venció: así lo recién detectado sale en esta misma vuelta.
    if (followupsEnabled) {
      try {
        await sweepUnansweredConversations(logger);
        await sweepFollowups(logger);
      } catch (err) {
        logger.error({ err }, "follow-up sweep failed");
      }
    }

    // En su propio try: si los recordatorios fallan, las campañas y el barrido
    // de conversaciones no tienen por qué caerse con ellos.
    try {
      await sweepAppointmentReminders(logger);
    } catch (err) {
      logger.error({ err }, "appointment reminder sweep failed");
    }

    // Gmail no avisa de los correos nuevos sin montar Pub/Sub en Google Cloud, así
    // que se lee el buzón en cada vuelta. Sin cuenta conectada no hace nada.
    if (isModuleEnabled("email")) {
      try {
        await syncGmail(logger);
      } catch (err) {
        logger.error({ err }, "gmail sync tick failed");
      }
    }

    // La tasa del día del Banco Popular. Sin credenciales en la instancia no hace
    // nada, y con ellas solo consulta al banco una vez al día.
    try {
      await sweepExchangeRates(logger);
    } catch (err) {
      logger.error({ err }, "exchange rate sweep failed");
    }

    // Pedidos de Shopify (web y suscripciones): cada 15 minutos, si la tienda
    // está conectada. Antes del punto de reorden, para que lo comprometa.
    try {
      await sweepShopifyOrders(logger);
    } catch (err) {
      logger.error({ err }, "shopify sweep failed");
    }

    // La lista de suscriptores de Shopify: cada 6 horas y en segundo plano (recorrer
    // los clientes de la tienda puede tardar minutos y no frena este ciclo).
    try {
      sweepShopifySubscribers(logger);
    } catch (err) {
      logger.error({ err }, "shopify subscribers sweep failed");
    }

    // Punto de reorden: una vez al día, por la mañana, completa los pedidos de
    // compra automáticos y avisa al equipo de lo que bajó del mínimo.
    try {
      await sweepReorderPoints(logger);
    } catch (err) {
      logger.error({ err }, "reorder sweep failed");
    }

    // Los errores guardados caducan a los 14 días. Mirarlo una vez por hora basta
    // y evita una consulta de borrado cada minuto para nada.
    try {
      if (Date.now() - lastErrorPurge >= ERROR_PURGE_EVERY_MS) {
        lastErrorPurge = Date.now();
        const deleted = await purgeOldErrorLogs();
        if (deleted > 0) logger.info({ deleted }, "errores antiguos borrados del registro");
      }
    } catch (err) {
      logger.error({ err }, "error log purge failed");
    }

    // Adjuntos de correo subidos para un compositor que se cerró sin enviar.
    try {
      if (Date.now() - lastAttachmentPurge >= ATTACHMENT_PURGE_EVERY_MS) {
        lastAttachmentPurge = Date.now();
        const deleted = await purgeOldStagedEmailAttachments();
        if (deleted > 0) logger.info({ deleted }, "adjuntos de correo huérfanos borrados");
      }
    } catch (err) {
      logger.error({ err }, "staged email attachment purge failed");
    }
  };

  // Con horario (SCHEDULER_DAYS / SCHEDULER_HOURS / SCHEDULER_INTERVAL_MINUTES)
  // solo corre en sus vueltas: fuera de ellas no toca la base y una base que se
  // suspende sola (Neon) puede dormir. Una variable mal escrita no deja la
  // instancia sin recordatorios: se avisa y se vuelve a cada minuto.
  let window: SchedulerWindow | null = null;
  try {
    window = parseSchedulerWindow(process.env, APP_TIMEZONE);
  } catch (err) {
    logger.error({ err }, "horario del programador inválido: se revisa cada minuto");
  }

  if (!window) {
    const timer = setInterval(() => void tick(), intervalMs);
    // Don't keep the event loop alive solely for the scheduler.
    timer.unref?.();
    logger.info({ intervalMs }, "campaign scheduler started");
    return;
  }

  // Se mira el reloj dos veces por minuto (sin tocar la base) para no saltarse una
  // vuelta si el proceso estuvo ocupado; la clave de la vuelta evita repetirla, y
  // una vuelta larga no se encima con la siguiente.
  const active = window;
  let lastSlot: string | null = null;
  let running = false;
  const check = (): void => {
    const slot = schedulerSlot(active);
    if (!slot || slot === lastSlot || running) return;
    lastSlot = slot;
    running = true;
    void tick().finally(() => {
      running = false;
    });
  };
  const timer = setInterval(check, 30_000);
  timer.unref?.();
  logger.info(
    {
      days: [...active.days].join(","),
      from: active.fromMinute,
      to: active.toMinute,
      everyMinutes: active.everyMinutes,
      timeZone: active.timeZone,
    },
    "campaign scheduler started (solo en su horario)",
  );
}
