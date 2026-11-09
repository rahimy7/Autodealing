import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { isStorageConfigured } from "./lib/supabase";
import { backfillLastCustomerMessageAt } from "./lib/messaging";
import { backfillOrderSources } from "./lib/orders";
import { seedViewAccess } from "./lib/view-access";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// HOST limita por dónde se escucha. El sitio de Premier arranca esta instancia dentro de su
// mismo servicio con HOST=127.0.0.1: solo el sitio le habla, y la publica bajo /omnicanal.
// Sin HOST se escucha en todas las interfaces, como un servicio propio.
const host = process.env["HOST"]?.trim() || undefined;

const onListening = (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, host: host ?? "*" }, "Server listening");

  // Sin almacenamiento, las notas de voz llegan transcritas pero sin audio, y las
  // fotos y documentos no se pueden guardar ni mandar. No impide arrancar, pero
  // tiene que verse en el log del despliegue y no al buscar por qué falta un audio.
  if (!isStorageConfigured()) {
    logger.warn(
      "Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: los chats no guardan audios, fotos ni documentos",
    );
  }

  backfillLastCustomerMessageAt(logger).catch((err) =>
    logger.error({ err }, "backfill of last_customer_message_at failed"),
  );
  backfillOrderSources(logger).catch((err) => logger.error({ err }, "backfill of order sources failed"));
  // Cada usuario existente conserva lo que ya veía: se le siembran las vistas de su
  // rol la primera vez (y solo a quien no tenga ninguna).
  seedViewAccess(logger).catch((err) => logger.error({ err }, "seeding of view access failed"));

  // Launch scheduled marketing campaigns once their scheduledAt is due.
  startScheduler();
};

if (host) app.listen(port, host, onListening);
else app.listen(port, onListening);
