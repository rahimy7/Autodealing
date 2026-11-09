// Cliente de la API BPDConsultaTasa del Banco Popular Dominicano (publicada en
// IBM API Connect): devuelve la compra y la venta del dólar y el euro frente al
// peso. Autentica con OAuth2 client_credentials y el token dura una hora, así que
// se guarda en memoria y se renueva poco antes de vencer.
//
// Sin base de datos: lo que se hace con las tasas vive en lib/exchange-rates.ts.
//
// Las credenciales son de la instancia, no del cliente de la plataforma, y van en
// variables de entorno con los mismos nombres que usa masqsalud para poder
// copiarlas tal cual (se sacan de apiportal.popularenlinea.com):
//   PopularApi__ClientId          "Clave" de la aplicación
//   PopularApi__ClientSecret      "Secreto" de la aplicación
//   PopularApi__TokenUrl          endpoint OAuth2 del token
//   PopularApi__BaseUrl           base de la API (sandbox o producción)
//   PopularApi__ConsultaTasaPath  ruta de la consulta (por defecto /consultatasa/consultaTasa)
//   PopularApi__Scope             scope OAuth2 (por defecto scope_1)

export const POPULAR_SOURCE = "popular";
export const POPULAR_PROVIDER_NAME = "Banco Popular Dominicano";

const DEFAULT_CONSULTA_PATH = "/consultatasa/consultaTasa";
const DEFAULT_SCOPE = "scope_1";
const REQUEST_TIMEOUT_MS = 15_000;
// El token se da por vencido un minuto antes, para no mandarlo justo cuando caduca.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export type PopularConfig = {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  baseUrl: string;
  consultaTasaPath: string;
  scope: string;
};

export type ParsedRate = {
  currency: "USD" | "EUR";
  buy: number;
  sell: number;
};

/** Error que el endpoint devuelve tal cual: el mensaje ya es para el administrador. */
export class ExchangeRateError extends Error {
  constructor(
    message: string,
    readonly status: 502 | 503,
  ) {
    super(message);
    this.name = "ExchangeRateError";
  }
}

/** Las credenciales de la instancia, o null si falta alguna imprescindible. */
export function readPopularConfig(env: NodeJS.ProcessEnv = process.env): PopularConfig | null {
  const read = (key: string) => env[`PopularApi__${key}`]?.trim() ?? "";
  const config: PopularConfig = {
    clientId: read("ClientId"),
    clientSecret: read("ClientSecret"),
    tokenUrl: read("TokenUrl"),
    baseUrl: read("BaseUrl"),
    consultaTasaPath: read("ConsultaTasaPath") || DEFAULT_CONSULTA_PATH,
    scope: read("Scope") || DEFAULT_SCOPE,
  };
  if (!config.clientId || !config.clientSecret || !config.tokenUrl || !config.baseUrl) return null;
  return config;
}

// ── Lectura de la respuesta ───────────────────────────────────────────────────
// La del banco (sandbox y producción):
//   { "monedas": { "moneda": [ { "descripcion": "USD", "compra": 58.55, "venta": 60.35 }, … ],
//                  "fechaConsulta": "2026-9-14 - 4:19:14" } }
// Con una sola moneda, "moneda" llega como objeto y no como lista. Se aceptan
// también las variantes que masqsalud tuvo que tolerar (lista en "tasa", lista en
// la raíz, códigos en "codigoMoneda" y montos como texto).

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCurrency(raw: unknown): ParsedRate["currency"] | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (s === "USD" || s.includes("DOLAR") || s.includes("DOLLAR")) return "USD";
  if (s === "EUR" || s.includes("EURO")) return "EUR";
  return null;
}

function positiveNumber(item: JsonObject, keys: string[]): number | null {
  for (const key of keys) {
    const raw = item[key];
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/,/g, "")) : NaN;
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function parseItem(item: unknown): ParsedRate | null {
  if (!isObject(item)) return null;
  const currency =
    normalizeCurrency(item.descripcion) ?? normalizeCurrency(item.codigoMoneda) ?? normalizeCurrency(item.moneda);
  if (!currency) return null;

  const single = positiveNumber(item, ["tasa", "rate"]);
  const buy = positiveNumber(item, ["compra", "tasaCompra"]);
  const sell = positiveNumber(item, ["venta", "tasaVenta"]);
  // Si el banco manda solo una de las dos, se usa para ambas antes que perder la
  // moneda: lo que importa al vender es la venta, y la compra queda de referencia.
  const resolvedSell = sell ?? buy ?? single;
  const resolvedBuy = buy ?? sell ?? single;
  if (resolvedSell === null || resolvedBuy === null) return null;
  return { currency, buy: resolvedBuy, sell: resolvedSell };
}

/** Las tasas que trae la respuesta, una por moneda (si se repite, gana la última). */
export function parsePopularRates(body: unknown): ParsedRate[] {
  let items: unknown[];
  if (isObject(body) && isObject(body.monedas) && body.monedas.moneda !== undefined) {
    const moneda = body.monedas.moneda;
    items = Array.isArray(moneda) ? moneda : [moneda];
  } else if (isObject(body) && Array.isArray(body.tasa)) {
    items = body.tasa;
  } else if (Array.isArray(body)) {
    items = body;
  } else {
    items = [body];
  }

  const byCurrency = new Map<ParsedRate["currency"], ParsedRate>();
  for (const item of items) {
    const rate = parseItem(item);
    if (rate) byCurrency.set(rate.currency, rate);
  }
  return [...byCurrency.values()];
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

let cachedToken: { value: string; expiresAt: number; clientId: string } | null = null;

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ExchangeRateError(`No se pudo conectar con la API de ${POPULAR_PROVIDER_NAME}: ${reason}`, 502);
  }
}

async function getAccessToken(config: PopularConfig): Promise<string> {
  if (cachedToken && cachedToken.clientId === config.clientId && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  if (config.scope) form.set("scope", config.scope);

  const res = await request(config.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ExchangeRateError(
      `${POPULAR_PROVIDER_NAME} rechazó las credenciales (${res.status}). Revisa PopularApi__ClientId y PopularApi__ClientSecret.`,
      502,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  const token = isObject(payload) && typeof payload.access_token === "string" ? payload.access_token : null;
  if (!token) {
    throw new ExchangeRateError(`La respuesta del token de ${POPULAR_PROVIDER_NAME} no trae access_token.`, 502);
  }
  const expiresIn = isObject(payload) && typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  cachedToken = {
    value: token,
    clientId: config.clientId,
    expiresAt: Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS,
  };
  return token;
}

async function consultaTasa(config: PopularConfig): Promise<Response> {
  const token = await getAccessToken(config);
  return request(`${config.baseUrl.replace(/\/+$/, "")}${config.consultaTasaPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-IBM-Client-Id": config.clientId,
      Accept: "application/json",
    },
  });
}

/** Consulta las tasas del día al banco. No guarda nada. */
export async function fetchPopularRates(config: PopularConfig): Promise<ParsedRate[]> {
  let res = await consultaTasa(config);
  // Un 401 con un token que aún no había vencido es un token revocado: se pide
  // uno nuevo y se reintenta una sola vez.
  if (res.status === 401) {
    cachedToken = null;
    res = await consultaTasa(config);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new ExchangeRateError(
      `La API de ${POPULAR_PROVIDER_NAME} respondió con error ${res.status}: ${text.slice(0, 300)}`,
      502,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ExchangeRateError(`La API de ${POPULAR_PROVIDER_NAME} no devolvió JSON: ${text.slice(0, 300)}`, 502);
  }

  const rates = parsePopularRates(body);
  if (!rates.some((rate) => rate.currency === "USD")) {
    throw new ExchangeRateError(
      `No se encontró la tasa del dólar en la respuesta de ${POPULAR_PROVIDER_NAME}: ${text.slice(0, 300)}`,
      502,
    );
  }
  return rates;
}
