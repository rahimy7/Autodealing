import { useGetExchangeRates } from "@workspace/api-client-react";

/**
 * Unidades de la moneda base por 1 de `currency`, a partir de la tasa del banco
 * (pesos por 1 unidad de moneda extranjera). La misma cuenta que hace el
 * servidor (lib/money.ts): null cuando no hay tasa y la tiene que escribir una
 * persona.
 */
export function rateToBaseFrom(currency: string, dopPerForeign: Record<string, number>, base: string): number | null {
  const doc = currency.toUpperCase();
  const b = base.toUpperCase();
  if (doc === b) return 1;
  if (b === "DOP") return dopPerForeign[doc] ?? null;
  if (doc === "DOP") return dopPerForeign[b] ? 1 / dopPerForeign[b] : null;
  return dopPerForeign[doc] && dopPerForeign[b] ? dopPerForeign[doc] / dopPerForeign[b] : null;
}

/** La tasa sugerida para un documento en `currency` (la del día del Banco Popular). */
export function useSuggestedRate(currency: string, base: string): number | null {
  const { data } = useGetExchangeRates();
  const table = Object.fromEntries((data?.rates ?? []).map((r) => [r.currency.toUpperCase(), r.sell]));
  return rateToBaseFrom(currency, table, base);
}

/**
 * Cómo se lee una tasa: "63.50 DOP por USD" en vez de "0.015748 USD por DOP".
 * Se muestra siempre en el sentido en que la publica el banco.
 */
export function describeRate(rateToBase: number, currency: string, base: string): string {
  if (rateToBase >= 1) return `${rateToBase.toFixed(4).replace(/\.?0+$/, "")} ${base} por ${currency}`;
  return `${(1 / rateToBase).toFixed(4).replace(/\.?0+$/, "")} ${currency} por ${base}`;
}

// La persona escribe la tasa como la publica el banco: pesos por dólar. Estas
// tres funciones van y vuelven entre eso y `rateToBase`.
export function naturalRateLabel(currency: string, base: string): string {
  const doc = currency.toUpperCase();
  const b = base.toUpperCase();
  if (b === "DOP") return `${b} por ${doc}`;
  if (doc === "DOP") return `${doc} por ${b}`;
  return `${b} por ${doc}`;
}

export function toNaturalRate(rateToBase: number, currency: string, base: string): number {
  return currency.toUpperCase() === "DOP" && base.toUpperCase() !== "DOP" ? 1 / rateToBase : rateToBase;
}

export function fromNaturalRate(natural: number, currency: string, base: string): number {
  return currency.toUpperCase() === "DOP" && base.toUpperCase() !== "DOP" ? 1 / natural : natural;
}
