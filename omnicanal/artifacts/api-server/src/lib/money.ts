// Dinero en centavos enteros. Todo lo nuevo de inventario, compras, despachos y
// postventa guarda montos así (sufijo `Cents`): sumar centavos es exacto y
// sumar decimales de punto flotante no — un inventario valorado a PEPS que se
// descuadra por redondeo no se puede explicar.
//
// La moneda base es la del inventario y los reportes de costo: la de la
// instancia (`locale.currency`; USD en Procollagen, DOP por defecto). Cada
// documento en otra moneda guarda `rateToBase` = unidades de la base por 1
// unidad de su moneda, fijada en el momento del documento.
import { clientConfig } from "./client-config";

export const BASE_CURRENCY = clientConfig.locale.currency.toUpperCase();

/** De unidades con decimales (lo que escribe una persona) a centavos. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Lleva un monto en centavos de un documento a la moneda base. */
export function toBaseCents(amountCents: number, rateToBase: number | null | undefined): number {
  const rate = rateToBase == null || !Number.isFinite(rateToBase) || rateToBase <= 0 ? 1 : rateToBase;
  return Math.round(amountCents * rate);
}

/**
 * La tasa con que un documento en `currency` se lleva a la base, a partir de la
 * tasa del banco (pesos por 1 unidad de moneda extranjera, como las guarda
 * `exchange_rates`). Null cuando hace falta una tasa y no la hay: entonces la
 * escribe una persona.
 */
export function rateToBaseFrom(
  currency: string,
  dopPerForeign: Record<string, number>,
  base: string = BASE_CURRENCY,
): number | null {
  const doc = currency.toUpperCase();
  const b = base.toUpperCase();
  if (doc === b) return 1;
  if (b === "DOP") return dopPerForeign[doc] ?? null; // USD → DOP: 1 USD = 63.5 DOP
  if (doc === "DOP") {
    const rate = dopPerForeign[b];
    return rate ? 1 / rate : null; // DOP → USD: 1 DOP = 1/63.5 USD
  }
  // Dos monedas extranjeras: se cruza por el peso.
  const docRate = dopPerForeign[doc];
  const baseRate = dopPerForeign[b];
  return docRate && baseRate ? docRate / baseRate : null;
}

const SYMBOLS: Record<string, string> = { USD: "US$", DOP: "RD$", EUR: "€" };

/** "US$1,250.00" — para los correos al cliente y las notas internas. */
export function formatMoney(cents: number, currency: string = BASE_CURRENCY): string {
  const symbol = SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
  const value = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? "-" : ""}${symbol}${value.replace(/^-/, "")}`;
}
