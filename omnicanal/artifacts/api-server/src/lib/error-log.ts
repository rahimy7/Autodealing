// Copia en base de datos de los errores del servidor, para que el administrador
// los revise desde el panel sin entrar al hosting. Lo que se imprime no cambia:
// esto es un añadido, y si falla, el log sigue saliendo igual.
//
// Todo aquí está pensado para no hacer ruido ni morderse la cola: cuando la base
// de datos no responde se avisa por consola —nunca con el logger, que volvería a
// entrar aquí— y se deja de intentar un rato. Un fallo registrando errores no
// puede tumbar el servidor ni multiplicarse solo.

const MAX_DETAIL_CHARS = 8000;
const MAX_MESSAGE_CHARS = 500;
const QUIET_AFTER_FAILURES = 5;
const QUIET_MS = 60_000;
/** Un registro de errores no es sitio para secretos. */
const SENSITIVE_KEY = /token|secret|password|authorization|apikey|api_key/i;

let failures = 0;
let quietUntil = 0;

export type ErrorLogRow = {
  level: string;
  message: string;
  detail: string | null;
  requestId: string | null;
  method: string | null;
  url: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Un Error no sobrevive a JSON.stringify —sale `{}`— y es justo lo que hace falta
// leer, así que se desarma a mano.
function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

/**
 * Arma la fila a partir de lo que recibió el logger: `(contexto, mensaje)` o
 * `(mensaje)`, más los datos que pino-http cuelga del logger hijo (la petición).
 */
export function buildErrorRow(
  level: string,
  args: readonly unknown[],
  bindings: Record<string, unknown> = {},
): ErrorLogRow {
  const first = asRecord(args[0]);
  const message =
    typeof args[0] === "string" ? args[0] : typeof args[1] === "string" ? args[1] : "(sin mensaje)";

  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(first ?? {})) {
    if (key === "req" || key === "res") continue;
    context[key] = SENSITIVE_KEY.test(key) ? "[oculto]" : serialize(value);
  }

  const req = asRecord(first?.["req"]) ?? asRecord(bindings["req"]);

  let detail: string | null = null;
  if (Object.keys(context).length > 0) {
    try {
      detail = JSON.stringify(context);
    } catch {
      // Referencias circulares: mejor perder el detalle que perder el error.
      detail = null;
    }
    if (detail && detail.length > MAX_DETAIL_CHARS) detail = `${detail.slice(0, MAX_DETAIL_CHARS)}…`;
  }

  return {
    level,
    message: String(message).slice(0, MAX_MESSAGE_CHARS),
    detail,
    requestId: req?.["id"] != null ? String(req["id"]) : null,
    method: typeof req?.["method"] === "string" ? req["method"] : null,
    url: typeof req?.["url"] === "string" ? req["url"] : null,
  };
}

/**
 * Guarda el error sin hacer esperar a quien lo registró. La base de datos se
 * importa aquí dentro a propósito: así el logger no arrastra una conexión al
 * cargarse, y se puede usar en procesos que no tienen base de datos.
 */
export function persistErrorLog(
  level: string,
  args: readonly unknown[],
  bindings: Record<string, unknown> = {},
): void {
  if (Date.now() < quietUntil) return;

  const row = buildErrorRow(level, args, bindings);
  void (async () => {
    try {
      const { db, errorLogsTable } = await import("@workspace/db");
      await db.insert(errorLogsTable).values(row);
      failures = 0;
    } catch (err) {
      failures += 1;
      if (failures >= QUIET_AFTER_FAILURES) {
        quietUntil = Date.now() + QUIET_MS;
        failures = 0;
      }
      console.error("no se pudo guardar el error en la base de datos:", err instanceof Error ? err.message : err);
    }
  })();
}

/** Borra los errores más viejos que `days`. Devuelve cuántos se fueron. */
export async function purgeOldErrorLogs(days = 14): Promise<number> {
  const { db, errorLogsTable } = await import("@workspace/db");
  const { lt } = await import("drizzle-orm");
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const gone = await db
    .delete(errorLogsTable)
    .where(lt(errorLogsTable.createdAt, cutoff))
    .returning({ id: errorLogsTable.id });
  return gone.length;
}
