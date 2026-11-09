// Los días del negocio viajan como texto ("2026-09-20"), no como fecha: leerlos
// con `new Date(key)` los toma como medianoche UTC, que en el Caribe todavía es
// el día anterior, y el panel acabaría enseñando el día de ayer. Estas dos
// funciones son el único sitio donde se convierten.

/**
 * Pinta un día "YYYY-MM-DD" tal cual. Acepta también el día serializado como
 * fecha completa ("2026-09-20T00:00:00.000Z"), que es como llegan `periodFrom` y
 * `periodTo` de los reportes.
 */
export function formatDayKey(dayKey: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
  // Acepta que no venga: el panel puede quedar servido contra una versión del
  // API que todavía no manda el día, y eso no puede dejar la pantalla en blanco.
  if (!dayKey) return "";
  const date = new Date(`${dayKey.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return new Intl.DateTimeFormat("es-DO", { ...options, timeZone: "UTC" }).format(date);
}

/** El día de hoy en la zona del negocio, con la forma "YYYY-MM-DD". */
export function todayInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Suma (o resta) días de calendario a un día "YYYY-MM-DD". */
export function shiftDay(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
