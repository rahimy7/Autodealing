// Cuándo corre el programador en segundo plano (campañas, seguimientos,
// recordatorios, cierre de chats inactivos…). Sin estas variables corre cada
// minuto, siempre. Con ellas, solo en el horario de trabajo:
//
//   SCHEDULER_DAYS=1-5              lunes a viernes (1 = lunes … 7 = domingo; también "1,3,5")
//   SCHEDULER_HOURS=09:00-17:00     de 9:00 a 17:00, ambas incluidas
//   SCHEDULER_INTERVAL_MINUTES=60   una vuelta por hora, contando desde el inicio del horario
//
// en la zona horaria del negocio (APP_TIMEZONE). Cada vuelta consulta la base: con
// una base que se suspende sola (Neon), revisar cada minuto la mantiene despierta
// todo el día. Lo que llega por los canales (mensajes, webhooks) no depende de
// esto y se atiende siempre.
//
// El sitio de Premier usa la misma regla para sus propias revisiones
// (server/work-hours.js) y le pasa estas variables; tests/scheduler-window.test.ts
// comprueba que los dos dan las mismas horas.

export type SchedulerWindow = {
  days: ReadonlySet<number>;
  fromMinute: number;
  toMinute: number;
  everyMinutes: number;
  timeZone: string;
};

type Env = Record<string, string | undefined>;

function parseDays(raw: string): Set<number> {
  const days = new Set<number>();
  for (const part of raw.split(",").map((p) => p.trim())) {
    const m = /^([1-7])(?:-([1-7]))?$/.exec(part);
    if (!m) throw new Error(`SCHEDULER_DAYS inválido: "${raw}" (usa 1-5 o 1,3,5; 1 = lunes)`);
    const from = Number(m[1]);
    const to = Number(m[2] ?? m[1]);
    if (to < from) throw new Error(`SCHEDULER_DAYS inválido: "${raw}"`);
    for (let d = from; d <= to; d++) days.add(d);
  }
  return days;
}

function parseClock(raw: string, whole: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  const minute = m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  if (!m || Number(m[2]) > 59 || minute > 24 * 60)
    throw new Error(`SCHEDULER_HOURS inválido: "${whole}" (usa 09:00-17:00)`);
  return minute;
}

/** El horario de las variables, o null si no hay ninguna (corre siempre). Lanza si alguna es inválida. */
export function parseSchedulerWindow(env: Env, timeZone: string): SchedulerWindow | null {
  const days = env.SCHEDULER_DAYS?.trim();
  const hours = env.SCHEDULER_HOURS?.trim();
  const every = env.SCHEDULER_INTERVAL_MINUTES?.trim();
  if (!days && !hours && !every) return null;

  const [from, to, extra] = (hours || "00:00-24:00").split("-");
  if (!from || !to || extra !== undefined) throw new Error(`SCHEDULER_HOURS inválido: "${hours}" (usa 09:00-17:00)`);
  const fromMinute = parseClock(from, hours ?? "");
  const toMinute = parseClock(to, hours ?? "");
  if (toMinute < fromMinute) throw new Error(`SCHEDULER_HOURS inválido: "${hours}"`);

  const everyMinutes = every ? Number(every) : 1;
  if (!Number.isInteger(everyMinutes) || everyMinutes < 1 || everyMinutes > 24 * 60)
    throw new Error(`SCHEDULER_INTERVAL_MINUTES inválido: "${every}"`);

  // Valida la zona: Intl lanza RangeError con una desconocida.
  new Intl.DateTimeFormat("en-US", { timeZone }).format(0);

  return { days: parseDays(days || "1-7"), fromMinute, toMinute, everyMinutes, timeZone };
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(now: Date, timeZone: string): { date: string; day: number; minute: number } {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    day: WEEKDAY[p.weekday as string] ?? 0,
    minute: Number(p.hour) * 60 + Number(p.minute),
  };
}

/**
 * La vuelta que toca en este minuto ("2026-11-09 09:00"), o null si no toca
 * ninguna. Se consulta varias veces por minuto: la clave evita correr dos veces.
 */
export function schedulerSlot(window: SchedulerWindow, now: Date = new Date()): string | null {
  const { date, day, minute } = localParts(now, window.timeZone);
  if (!window.days.has(day)) return null;
  if (minute < window.fromMinute || minute > window.toMinute) return null;
  if ((minute - window.fromMinute) % window.everyMinutes !== 0) return null;
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `${date} ${hh}:${mm}`;
}
