import type { QueryClient } from "@tanstack/react-query";

// Inventario, compras, despachos y postventa guardan los montos en centavos
// enteros (sufijo `Cents`). Aquí está el ida y vuelta con lo que ve y escribe la
// persona.

const SYMBOLS: Record<string, string> = { USD: "US$", DOP: "RD$", EUR: "€" };

export function currencySymbol(currency: string | null | undefined): string {
  const code = (currency ?? "USD").toUpperCase();
  return SYMBOLS[code] ?? `${code} `;
}

/** 125000 → "US$1,250.00" */
export function formatCents(cents: number | null | undefined, currency?: string | null): string {
  if (cents == null) return "—";
  const value = Math.abs(cents / 100).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? "-" : ""}${currencySymbol(currency)}${value}`;
}

/** Lo que la persona escribe ("1,250.5", "1250") a centavos; null si no es un número. */
export function parseCents(text: string): number | null {
  const clean = text.trim().replace(/,/g, "");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Centavos al texto que se pone en un input ("1250.50"). */
export function centsToInput(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

/** El mensaje que el API puso en `{ error }`, o el de respaldo. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: unknown } } | null)?.data;
  return typeof data?.error === "string" && data.error ? data.error : fallback;
}

/** Vuelve a pedir todo lo que cuelga de estas rutas del API (`/api/inventory`, `/api/orders`…). */
export function invalidateApi(queryClient: QueryClient, ...prefixes: string[]): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === "string" && prefixes.some((p) => key.startsWith(p));
    },
  });
}

/** "2026-10-04" → "4 oct 2026" (las fechas sin hora que guardan lotes y despachos). */
export function formatDay(day: string | null | undefined): string {
  if (!day) return "—";
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("es-DO", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("es-DO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Descarga un CSV armado en el navegador (los datos ya vinieron por el API con la sesión). */
export function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number | null | undefined>>): void {
  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
