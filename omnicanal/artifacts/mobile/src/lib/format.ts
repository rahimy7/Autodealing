// Same wording as the panel so the two apps never disagree about what "hace 3 h"
// means.
export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (Number.isNaN(diff)) return "";
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatDate(date)} · ${formatTime(date)}`;
}

// Day separators inside a thread ("Hoy", "Ayer", or the date).
export function dayLabel(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400_000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Hoy";
  if (sameDay(date, yesterday)) return "Ayer";
  return date.toLocaleDateString("es-DO", { day: "2-digit", month: "long" });
}

/**
 * Pinta un día del negocio ("2026-09-20") tal cual. Leerlo con `new Date(key)`
 * lo toma como medianoche UTC, que en el Caribe todavía es el día anterior: el
 * panel acabaría diciendo "viernes" un sábado. Mismo criterio que el panel web
 * (omnicanal/src/lib/day.ts).
 */
export function formatDayKey(dayKey: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
  // Acepta que no venga: un teléfono con la versión nueva puede estar hablando
  // con un servidor que todavía no manda el día, y eso no puede tumbar la
  // pantalla de inicio — que aquí es una pantalla roja.
  if (!dayKey) return "";
  const date = new Date(`${dayKey.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return new Intl.DateTimeFormat("es-DO", { ...options, timeZone: "UTC" }).format(date);
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function currency(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP", maximumFractionDigits: 2 }).format(n);
}

// Agents never see a customer's full phone number, in any view — only the last 4 digits.
export function maskPhone(phone: string | null | undefined): string | null | undefined {
  if (!phone) return phone;
  return `•••• ${phone.slice(-4)}`;
}

export function errorMessage(err: unknown, fallback = "Algo salió mal. Inténtalo de nuevo."): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}
