import { serial, text, doublePrecision, timestamp, index } from "drizzle-orm/pg-core";
import { pgTable } from "./pg-schema";

// Tasas de cambio de una moneda extranjera a pesos dominicanos, tal como las
// publica el banco. Es un historial: cada consulta agrega filas y nunca se
// actualiza una anterior, así que la tasa vigente de cada moneda es su fila más
// reciente y lo de días pasados queda para consultar.
export const exchangeRatesTable = pgTable(
  "exchange_rates",
  {
    id: serial("id").primaryKey(),
    // Código ISO de la moneda extranjera (USD, EUR). La otra es siempre DOP.
    currency: text("currency").notNull(),
    // Lo que paga el banco por cada unidad de la moneda extranjera.
    buy: doublePrecision("buy").notNull(),
    // Lo que cobra el banco por cada unidad: la que aplica al cliente que paga en
    // pesos el equivalente de un precio en dólares.
    sell: doublePrecision("sell").notNull(),
    // De dónde salió la tasa. Hoy solo "popular" (API BPDConsultaTasa).
    source: text("source").notNull(),
    // Quién pidió la consulta. Null es la actualización automática diaria.
    fetchedBy: text("fetched_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("exchange_rates_currency_created_idx").on(t.currency, t.createdAt)],
);

export type ExchangeRate = typeof exchangeRatesTable.$inferSelect;
export type InsertExchangeRate = typeof exchangeRatesTable.$inferInsert;
