import { desc } from "drizzle-orm";
import type { Logger } from "pino";
import { db, exchangeRatesTable, type ExchangeRate } from "@workspace/db";
import { APP_TIMEZONE, formatDateTime, parseLocalDateTime } from "./time";
import { logger } from "./logger";
import {
  ExchangeRateError,
  POPULAR_PROVIDER_NAME,
  POPULAR_SOURCE,
  fetchPopularRates,
  readPopularConfig,
} from "./popular-api";

// La tasa de cambio del día, tomada del Banco Popular (lib/popular-api.ts) y
// guardada como historial en exchange_rates. Se actualiza sola una vez al día y
// el administrador puede pedirla a mano desde Configuración.

/** Hora del negocio a partir de la cual se busca la tasa del día. */
export const DAILY_REFRESH_HOUR = 7;
// Si la consulta automática falla, no se reintenta en cada vuelta del scheduler
// (una por minuto): cada fallo queda en Errores del sistema.
const RETRY_AFTER_FAILURE_MS = 60 * 60_000;
// Cuánto espera la respuesta de un agente a que el banco conteste cuando la tasa
// guardada no es de hoy. Si tarda más, la consulta sigue en segundo plano y el
// agente contesta sin tasa (escala si le piden el monto en pesos).
const AGENT_REFRESH_WAIT_MS = 8_000;
// Tras un fallo, las respuestas siguientes no vuelven a esperar al banco: cada
// una se retrasaría hasta AGENT_REFRESH_WAIT_MS.
const AGENT_RETRY_AFTER_FAILURE_MS = 5 * 60_000;

export type ExchangeRatesStatus = {
  configured: boolean;
  provider: string;
  baseCurrency: "DOP";
  refreshHour: number;
  timezone: string;
  rates: ExchangeRate[];
  lastError: string | null;
  lastErrorAt: Date | null;
};

let lastFetchedAt: Date | null = null;
let seeded = false;
let lastFailureAt: Date | null = null;
let lastError: { message: string; at: Date } | null = null;
let inFlight: Promise<ExchangeRate[]> | null = null;

export function isExchangeRateConfigured(): boolean {
  return readPopularConfig() !== null;
}

function localDateKey(date: Date): string {
  // en-CA formatea como AAAA-MM-DD, que es lo que espera parseLocalDateTime.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * ¿Toca consultar la tasa ahora? Sí cuando nunca se ha consultado, o cuando ya
 * pasó la hora del día del negocio y la última consulta es anterior a ella. Una
 * consulta a mano antes de esa hora no evita la del día: el banco puede publicar
 * la tasa nueva por la mañana.
 */
export function shouldRefreshRates(opts: {
  now: Date;
  lastFetchedAt: Date | null;
  lastFailureAt: Date | null;
}): boolean {
  const { now } = opts;
  if (opts.lastFailureAt && now.getTime() - opts.lastFailureAt.getTime() < RETRY_AFTER_FAILURE_MS) return false;
  if (!opts.lastFetchedAt) return true;

  const hour = String(DAILY_REFRESH_HOUR).padStart(2, "0");
  const refreshAt = parseLocalDateTime(`${localDateKey(now)} ${hour}:00`);
  if (!refreshAt) return false;
  return now >= refreshAt && opts.lastFetchedAt < refreshAt;
}

/** La tasa vigente de cada moneda: su consulta más reciente. */
export async function getCurrentRates(): Promise<ExchangeRate[]> {
  return db
    .selectDistinctOn([exchangeRatesTable.currency])
    .from(exchangeRatesTable)
    .orderBy(exchangeRatesTable.currency, desc(exchangeRatesTable.createdAt));
}

export async function getRateHistory(limit: number): Promise<ExchangeRate[]> {
  return db
    .select()
    .from(exchangeRatesTable)
    .orderBy(desc(exchangeRatesTable.createdAt), exchangeRatesTable.currency)
    .limit(limit);
}

export async function getExchangeRatesStatus(): Promise<ExchangeRatesStatus> {
  return {
    configured: isExchangeRateConfigured(),
    provider: POPULAR_PROVIDER_NAME,
    baseCurrency: "DOP",
    refreshHour: DAILY_REFRESH_HOUR,
    timezone: APP_TIMEZONE,
    rates: await getCurrentRates(),
    lastError: lastError?.message ?? null,
    lastErrorAt: lastError?.at ?? null,
  };
}

async function fetchAndStore(fetchedBy: string | null): Promise<ExchangeRate[]> {
  const config = readPopularConfig();
  if (!config) {
    throw new ExchangeRateError(
      `La API de ${POPULAR_PROVIDER_NAME} no está configurada: faltan las variables PopularApi__ClientId, PopularApi__ClientSecret, PopularApi__TokenUrl o PopularApi__BaseUrl.`,
      503,
    );
  }

  try {
    const parsed = await fetchPopularRates(config);
    const createdAt = new Date();
    const saved = await db
      .insert(exchangeRatesTable)
      .values(parsed.map((rate) => ({ ...rate, source: POPULAR_SOURCE, fetchedBy, createdAt })))
      .returning();
    lastFetchedAt = createdAt;
    lastFailureAt = null;
    lastError = null;
    return saved;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastFailureAt = new Date();
    lastError = { message, at: lastFailureAt };
    throw err;
  }
}

/**
 * Consulta la tasa al banco y la guarda. `fetchedBy` es quien la pidió (null para
 * la automática). Si ya hay una consulta en curso se espera esa en vez de lanzar
 * otra: el clic del administrador y la vuelta del scheduler pueden coincidir.
 */
export async function refreshExchangeRates(fetchedBy: string | null): Promise<ExchangeRate[]> {
  if (!inFlight) {
    inFlight = fetchAndStore(fetchedBy).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

// ── La tasa en la conversación ────────────────────────────────────────────────
// El agente virtual recibe la tasa del día en su prompt, pero la cuenta no la hace
// él: escribe [[PESOS: monto en dólares]] y el backend pone la cifra en pesos. Un
// modelo que multiplica 198 × 60.35 de cabeza se equivoca en los decimales, y en
// un monto que el cliente va a transferir un error no es una imprecisión.

/** Marca con la que el agente pide un monto en pesos: [[PESOS: 198]]. */
export const PESOS_DIRECTIVE = /\[\[\s*PESOS\s*:\s*([^\]]*)\]\]/gi;

const moneyFormat = new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rateFormat = new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** ¿La tasa se consultó hoy, en el calendario del negocio? */
export function isRateFromToday(rate: Pick<ExchangeRate, "createdAt">, now: Date): boolean {
  return localDateKey(rate.createdAt) === localDateKey(now);
}

function dollarsInPesos(dollars: number, rate: Pick<ExchangeRate, "sell">): string {
  return `RD$${moneyFormat.format(Math.round(dollars * rate.sell * 100) / 100)}`;
}

/** Lo que el agente sabe de la tasa y cómo pedir un monto en pesos. Null sin tasa del dólar. */
export function exchangeRatePromptBlock(rates: ExchangeRate[]): string | null {
  const usd = rates.find((rate) => rate.currency === "USD");
  if (!usd) return null;
  return [
    `Tasa de cambio del día (${POPULAR_PROVIDER_NAME}, consultada el ${formatDateTime(usd.createdAt)}): 1 dólar = RD$${rateFormat.format(usd.sell)}, tasa de venta.`,
    `- Para decir en pesos un monto en dólares no hagas la cuenta tú: escribe la marca [[PESOS: monto en dólares]] donde va la cifra y el sistema la cambia por el monto exacto a esta tasa. Por ejemplo, "Serían [[PESOS: 100]] al cambio de hoy" le llega al cliente como "Serían ${dollarsInPesos(100, usd)} al cambio de hoy".`,
    "- Si son varias unidades o varios productos, suma tú los dólares y pon el total en una sola marca.",
    // Ofrecido sin que nadie lo pida, el monto en pesos confunde: el cliente que va
    // a transferir dólares lee dos cifras y no sabe cuál mandar.
    "- No agregues pesos a un precio que nadie te pidió en pesos: da el monto en pesos cuando la persona va a pagar en pesos, pregunta cuánto es en pesos o tu prompt te lo pide al darle cómo pagar. Si ya dijo que paga en dólares, no le menciones pesos.",
    "- Menciona la tasa solo si te la preguntan, y entonces di que es la del Banco Popular de hoy, con la cifra exacta.",
  ].join("\n");
}

/**
 * Cambia cada [[PESOS: …]] por el monto en pesos a la tasa del dólar de `rates`.
 * Sin tasa (el agente no debería haber usado la marca) se deja el monto en
 * dólares, que es el precio real, antes que una cifra en pesos inventada.
 */
export function replacePesosDirectives(text: string, rates: ExchangeRate[] | null): string {
  const usd = rates?.find((rate) => rate.currency === "USD") ?? null;
  return text.replace(PESOS_DIRECTIVE, (_whole, raw: string) => {
    const dollars = Number(raw.replace(/US\$|USD|\$|\s/gi, "").replace(/,/g, ""));
    if (!Number.isFinite(dollars) || dollars <= 0) return "el equivalente en pesos";
    return usd ? dollarsInPesos(dollars, usd) : `US$${moneyFormat.format(dollars)}`;
  });
}

/**
 * La tasa que puede usar un agente al responder: la de hoy. Si la guardada es de
 * otro día (el servidor estuvo apagado a la hora de la consulta automática, o el
 * banco falló), se pide al banco en ese momento. Null cuando no hay tasa de hoy:
 * la instancia no tiene credenciales o el banco no respondió a tiempo.
 */
export async function getTodayRatesForAgent(log: Pick<Logger, "info" | "warn"> = logger): Promise<ExchangeRate[] | null> {
  if (!isExchangeRateConfigured()) return null;

  const now = new Date();
  const current = await getCurrentRates();
  const usd = current.find((rate) => rate.currency === "USD");
  if (usd && isRateFromToday(usd, now)) return current;

  if (lastFailureAt && now.getTime() - lastFailureAt.getTime() < AGENT_RETRY_AFTER_FAILURE_MS) return null;

  const refresh = refreshExchangeRates(null).catch((err: unknown) => {
    log.warn({ err }, `el agente no pudo actualizar la tasa de cambio desde ${POPULAR_PROVIDER_NAME}`);
    return null;
  });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), AGENT_REFRESH_WAIT_MS).unref());
  const refreshed = await Promise.race([refresh, timeout]);
  if (!refreshed) return null;

  log.info(
    { rates: refreshed.map(({ currency, buy, sell }) => ({ currency, buy, sell })) },
    "tasa de cambio actualizada al responder: la guardada no era de hoy",
  );
  return refreshed.some((rate) => rate.currency === "USD") ? refreshed : null;
}

/** Vuelta del scheduler: consulta la tasa del día cuando toca. */
export async function sweepExchangeRates(log: Logger): Promise<void> {
  if (!isExchangeRateConfigured()) return;

  // Tras un reinicio, la última consulta sale de la base de datos: sin esto el
  // servidor volvería a pedir la tasa cada vez que arranca.
  if (!seeded) {
    const [latest] = await db
      .select({ createdAt: exchangeRatesTable.createdAt })
      .from(exchangeRatesTable)
      .orderBy(desc(exchangeRatesTable.createdAt))
      .limit(1);
    lastFetchedAt = latest?.createdAt ?? null;
    seeded = true;
  }

  if (!shouldRefreshRates({ now: new Date(), lastFetchedAt, lastFailureAt })) return;

  try {
    const saved = await refreshExchangeRates(null);
    log.info(
      { rates: saved.map(({ currency, buy, sell }) => ({ currency, buy, sell })) },
      "tasa de cambio del día actualizada",
    );
  } catch (err) {
    log.error({ err }, `no se pudo actualizar la tasa de cambio desde ${POPULAR_PROVIDER_NAME}`);
  }
}
