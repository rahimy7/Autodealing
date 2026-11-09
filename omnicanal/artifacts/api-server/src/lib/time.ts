import { clientConfig } from "./client-config";

// Local-time rendering for everything the AI reads. The agent reasons about
// "today", "ayer" and time-of-day, so timestamps are always formatted in the
// business's timezone — never UTC, which would put late-evening chats on the
// following day.
//
// La zona horaria es del cliente, así que su sitio natural es la configuración
// de la instancia. APP_TIMEZONE sigue teniendo prioridad para poder corregirla
// desde el panel de la instancia sin publicar una versión del core.
export const APP_TIMEZONE = process.env.APP_TIMEZONE || clientConfig.locale.timezone;

// "lunes, 23 de julio de 2026, 16:55" — used for the absolute "now" reference.
export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("es-DO", {
    timeZone: APP_TIMEZONE,
    dateStyle: "full",
    timeStyle: "short",
  }).format(date);
}

// Locale formatting of a numeric date varies by field combination ("23/7" vs
// "23/07"), so the compact stamps are assembled from parts instead — the AI reads
// them on every message and they must be uniform.
function parts(date: Date): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
}

// "23/07 16:55" — compact per-message stamp inside the chat history.
export function formatShort(date: Date): string {
  const p = parts(date);
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/**
 * La hora del reloj del negocio en ese instante. La usa la ventana de silencio de
 * los seguimientos: el servidor corre en UTC y en Santo Domingo son cuatro horas
 * menos, así que preguntarle la hora al servidor mandaría mensajes de madrugada.
 */
export function localClock(date: Date): { hour: number; minute: number } {
  const p = parts(date);
  return { hour: Number(p.hour), minute: Number(p.minute) };
}

// "23/07" — used to date-stamp the summary of a closed conversation.
export function formatDay(date: Date): string {
  const p = parts(date);
  return `${p.day}/${p.month}`;
}

// Cuánto se adelanta la zona horaria respecto a UTC en ese instante concreto
// (no en general): así el cálculo sigue siendo correcto en una zona con horario
// de verano, donde el desfase cambia dos veces al año.
function zoneOffsetMs(date: Date, timeZone: string = APP_TIMEZONE): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const asIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asIfUtc - date.getTime();
}

/**
 * Convierte una hora de reloj del negocio ("2026-08-15 15:00") al instante real.
 *
 * El agente virtual razona en la zona del cliente —toda la conversación va
 * fechada así— de modo que cuando acuerda "el sábado a las 3" quiere decir las
 * 3 de la tarde de allí. Interpretarlo como UTC pondría la cita cuatro horas
 * antes. Devuelve `null` si el texto no tiene la forma esperada.
 */
export function parseLocalDateTime(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  // Se parte tratando el reloj como si fuera UTC y se corrige por el desfase de
  // ese instante. Se vuelve a medir sobre el resultado porque en el cambio de
  // horario el desfase de partida y el de llegada no son el mismo.
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const firstPass = new Date(asUtc - zoneOffsetMs(new Date(asUtc)));
  const corrected = new Date(asUtc - zoneOffsetMs(firstPass));

  return Number.isNaN(corrected.getTime()) ? null : corrected;
}

const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * "2026-09-14": el día del negocio al que pertenece ese instante. Los reportes
 * cuentan por este día y no por el de UTC, que en Santo Domingo pasa a ser
 * "mañana" desde las 8 de la noche.
 */
export function localDayKey(date: Date, timeZone: string = APP_TIMEZONE): string {
  let formatter = dayKeyFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayKeyFormatters.set(timeZone, formatter);
  }
  const p = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** La medianoche con la que empieza ese día ("2026-09-14") en la zona del negocio. */
export function startOfLocalDay(dayKey: string, timeZone: string = APP_TIMEZONE): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  const asUtc = Date.UTC(year, month - 1, day);
  const firstPass = new Date(asUtc - zoneOffsetMs(new Date(asUtc), timeZone));
  return new Date(asUtc - zoneOffsetMs(firstPass, timeZone));
}

/**
 * Qué día de la semana es ese instante en el reloj del negocio (0 = domingo).
 * En UTC no sirve: en Santo Domingo, un sábado a las 9 de la noche ya es domingo
 * para el servidor, y el aviso de fin de semana saldría un día de más.
 */
export function localWeekday(date: Date, timeZone: string = APP_TIMEZONE): number {
  return new Date(`${localDayKey(date, timeZone)}T12:00:00Z`).getUTCDay();
}

/**
 * Sábado o domingo en el reloj del negocio. El equipo de Procollagen atiende de
 * lunes a viernes (regla del 2026-09-20), así que lo que se le promete al cliente
 * en fin de semana no es "en breve" sino el próximo día laborable.
 */
export function isWeekend(date: Date, timeZone: string = APP_TIMEZONE): boolean {
  const weekday = localWeekday(date, timeZone);
  return weekday === 0 || weekday === 6;
}

/** Suma (o resta) días de calendario a un día "YYYY-MM-DD". */
export function addDaysToKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// Renders an elapsed span the way a person would say it ("hace 3 días").
export function humanizeGap(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "hace unos segundos";
  if (minutes < 60) return `hace ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.round(hours / 24);
  return `hace ${days} ${days === 1 ? "día" : "días"}`;
}
