// When the site's and Omnicanal's background checks run: Monday to Friday, 9:00 to 17:00 dealer
// time, once an hour (9:00, 10:00 … 17:00), the hours the team works. Each check queries the
// database, and Neon only suspends after five quiet minutes, so a check every few minutes kept
// it awake (and billed) around the clock. Customer messages and site visits don't wait for this:
// they are served whenever they arrive.
//
// SCHEDULER_DAYS (1 = Monday … 7 = Sunday, "1-5" or "1,3,5"), SCHEDULER_HOURS ("09:00-17:00", both
// included) and SCHEDULER_INTERVAL_MINUTES change it. The same values go to Omnicanal, which
// applies the same rule (omnicanal/artifacts/api-server/src/lib/scheduler-window.ts; its
// tests/scheduler-window.test.ts checks both agree).
// The dealership's wall clock. admin/admin.js and ventas/ventas.js use the same zone, and
// Omnicanal's client config (premier.ts) too.
export const DEALER_TZ = "America/New_York";

export const DEFAULT_WORK_HOURS = { days: "1-5", hours: "09:00-17:00", everyMinutes: "60" };

function parseDays(raw) {
  const days = new Set();
  for (const part of raw.split(",").map((p) => p.trim())) {
    const m = /^([1-7])(?:-([1-7]))?$/.exec(part);
    if (!m) throw new Error(`SCHEDULER_DAYS inválido: "${raw}" (usa 1-5 o 1,3,5; 1 = lunes)`);
    const from = Number(m[1]),
      to = Number(m[2] ?? m[1]);
    if (to < from) throw new Error(`SCHEDULER_DAYS inválido: "${raw}"`);
    for (let d = from; d <= to; d++) days.add(d);
  }
  return days;
}
function parseClock(raw, whole) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  const minute = m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  if (!m || Number(m[2]) > 59 || minute > 24 * 60)
    throw new Error(`SCHEDULER_HOURS inválido: "${whole}" (usa 09:00-17:00)`);
  return minute;
}

function build(raw, timeZone) {
  const [from, to, extra] = raw.hours.split("-");
  if (!from || !to || extra !== undefined) throw new Error(`SCHEDULER_HOURS inválido: "${raw.hours}" (usa 09:00-17:00)`);
  const fromMinute = parseClock(from, raw.hours),
    toMinute = parseClock(to, raw.hours);
  if (toMinute < fromMinute) throw new Error(`SCHEDULER_HOURS inválido: "${raw.hours}"`);
  const everyMinutes = Number(raw.everyMinutes);
  if (!Number.isInteger(everyMinutes) || everyMinutes < 1 || everyMinutes > 24 * 60)
    throw new Error(`SCHEDULER_INTERVAL_MINUTES inválido: "${raw.everyMinutes}"`);
  return { days: parseDays(raw.days), fromMinute, toMinute, everyMinutes, timeZone, env: raw };
}

// The window from the environment, falling back to the defaults (with a warning) when a value
// is wrong: a typo must not make the checks run around the clock or stop them.
export function workHours(env = process.env, timeZone = DEALER_TZ) {
  const raw = {
    days: String(env.SCHEDULER_DAYS || DEFAULT_WORK_HOURS.days).trim(),
    hours: String(env.SCHEDULER_HOURS || DEFAULT_WORK_HOURS.hours).trim(),
    everyMinutes: String(env.SCHEDULER_INTERVAL_MINUTES || DEFAULT_WORK_HOURS.everyMinutes).trim(),
  };
  try {
    return build(raw, timeZone);
  } catch (error) {
    console.error(`${error.message}. Se usa el horario por defecto.`);
    return build({ ...DEFAULT_WORK_HOURS }, timeZone);
  }
}

const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map();
function localParts(now, timeZone) {
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
  return { date: `${p.year}-${p.month}-${p.day}`, day: WEEKDAY[p.weekday] ?? 0, minute: Number(p.hour) * 60 + Number(p.minute) };
}

// The check due this minute ("2026-11-09 09:00"), or null when none is.
export function workSlot(window, now = new Date()) {
  const { date, day, minute } = localParts(now, window.timeZone);
  if (!window.days.has(day)) return null;
  if (minute < window.fromMinute || minute > window.toMinute) return null;
  if ((minute - window.fromMinute) % window.everyMinutes !== 0) return null;
  return `${date} ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

// Runs `task` once in each slot of the window. The clock is read twice a minute without touching
// the database, so a busy moment doesn't skip a slot and the key keeps it from running twice.
export function everyWorkSlot(window, task) {
  let last = null,
    running = false;
  const timer = setInterval(() => {
    const slot = workSlot(window);
    if (!slot || slot === last || running) return;
    last = slot;
    running = true;
    Promise.resolve()
      .then(task)
      .catch(() => {})
      .finally(() => (running = false));
  }, 30_000);
  timer.unref();
  return timer;
}
