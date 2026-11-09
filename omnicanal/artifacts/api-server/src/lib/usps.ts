// Cliente mínimo de las API de USPS (developers.usps.com, la plataforma nueva que
// reemplazó a Web Tools en 2026) para los envíos a Estados Unidos: validar la
// dirección, comprar la etiqueta, anularla (reembolso de una sin usar) y rastrear.
//
//   - OAuth 2.0 client credentials con el Consumer Key/Secret de la app. El token
//     dura 8 h y se guarda en memoria.
//   - Las etiquetas piden además un token de AUTORIZACIÓN DE PAGO (también 8 h):
//     dice contra qué cuenta de pago (EPS) y con qué CRID/MID se cobra el franqueo.
//   - Dos ambientes con las mismas rutas: producción (apis.usps.com, cobra de
//     verdad) y pruebas TEM (apis-tem.usps.com, espejo sin cobro real).
//
// Las rutas y los campos salen de los ejemplos oficiales de USPS
// (github.com/USPS/api-examples) y de su guía de alta. No se ha probado contra
// USPS con credenciales reales: lo primero al conectar es "Probar conexión" y una
// etiqueta en el ambiente de pruebas.

export type UspsEnvironment = "test" | "production";

export type UspsCredentials = {
  environment: UspsEnvironment;
  clientId: string;
  clientSecret: string;
  crid?: string | null;
  mid?: string | null;
  manifestMid?: string | null;
  accountNumber?: string | null;
};

export class UspsError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    /** false cuando USPS pudo haber ejecutado la orden aunque no lo sepamos (sin respuesta). */
    readonly definitive = true,
  ) {
    super(message);
    this.name = "UspsError";
  }
}

export const USPS_MAIL_CLASSES = ["USPS_GROUND_ADVANTAGE", "PRIORITY_MAIL", "PRIORITY_MAIL_EXPRESS"] as const;
export type UspsMailClass = (typeof USPS_MAIL_CLASSES)[number];

export function uspsBaseUrl(env: UspsEnvironment): string {
  return env === "production" ? "https://apis.usps.com" : "https://apis-tem.usps.com";
}

const REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_MARGIN_MS = 10 * 60 * 1000;
const DEFAULT_TOKEN_LIFETIME_MS = 8 * 60 * 60 * 1000;

let oauthCache: { key: string; token: string; expiresAt: number } | null = null;
let paymentCache: { key: string; token: string; expiresAt: number } | null = null;

/** Olvida los tokens guardados (al cambiar credenciales o ambiente). */
export function forgetUspsTokens(): void {
  oauthCache = null;
  paymentCache = null;
}

const oauthKey = (c: UspsCredentials) => `${c.environment}:${c.clientId}`;
const paymentKey = (c: UspsCredentials) => `${oauthKey(c)}:${c.crid}:${c.mid}:${c.manifestMid ?? c.mid}:${c.accountNumber}`;

/** El mensaje que USPS trae en sus errores: `{ error: { message, errors: [{ detail }] } }`. */
export function uspsErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  const source = err && typeof err === "object" ? (err as { message?: unknown; errors?: unknown }) : (body as { message?: unknown; errors?: unknown });
  const parts: string[] = [];
  if (typeof source.message === "string" && source.message.trim()) parts.push(source.message.trim());
  if (Array.isArray(source.errors)) {
    for (const e of source.errors) {
      const detail = e && typeof e === "object" ? ((e as { detail?: unknown; title?: unknown }).detail ?? (e as { title?: unknown }).title) : null;
      if (typeof detail === "string" && detail.trim() && !parts.includes(detail.trim())) parts.push(detail.trim());
    }
  }
  const description = (body as { error_description?: unknown }).error_description;
  if (!parts.length && typeof description === "string" && description.trim()) parts.push(description.trim());
  return parts.length ? parts.join(" — ") : null;
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    // Sin respuesta: no sabemos si USPS llegó a ejecutar la orden.
    const reason = err instanceof Error ? err.message : String(err);
    throw new UspsError(`No hubo respuesta de USPS (${reason}).`, 502, false);
  }
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/** El token OAuth para llamar a cualquier API de USPS. */
export async function uspsAccessToken(creds: UspsCredentials, forceRefresh = false): Promise<string> {
  if (!creds.clientId?.trim() || !creds.clientSecret?.trim()) {
    throw new UspsError("Faltan el Consumer Key y el Consumer Secret de la app de USPS.", 400);
  }
  const key = oauthKey(creds);
  if (!forceRefresh && oauthCache && oauthCache.key === key && oauthCache.expiresAt > Date.now() + TOKEN_MARGIN_MS) return oauthCache.token;
  const res = await send(`${uspsBaseUrl(creds.environment)}/oauth2/v3/token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: creds.clientId.trim(), client_secret: creds.clientSecret.trim() }),
  });
  const body = (await readJson(res)) as { access_token?: string; expires_in?: number | string } | null;
  if (!res.ok || !body?.access_token) {
    const detail = uspsErrorMessage(body);
    throw new UspsError(
      `USPS no entregó el token (${res.status})${detail ? `: ${detail}` : ": revisa el Consumer Key y el Consumer Secret, y que la app esté aprobada"}${creds.environment === "test" ? " [ambiente de pruebas]" : ""}.`,
      res.status === 401 || res.status === 400 ? 400 : 502,
    );
  }
  const lifetime = Number(body.expires_in);
  oauthCache = { key, token: body.access_token, expiresAt: Date.now() + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime * 1000 : DEFAULT_TOKEN_LIFETIME_MS) };
  return body.access_token;
}

/**
 * La autorización para cobrar el franqueo de la cuenta de pago (EPS): la misma
 * cuenta como pagador y como dueño de la etiqueta. Pedirla no cuesta nada.
 */
export async function uspsPaymentToken(creds: UspsCredentials, forceRefresh = false): Promise<string> {
  const missing = [
    !creds.crid?.trim() && "CRID",
    !creds.mid?.trim() && "MID",
    !creds.accountNumber?.trim() && "número de cuenta EPS",
  ].filter(Boolean);
  if (missing.length) throw new UspsError(`Faltan datos de la cuenta de pago de USPS: ${missing.join(", ")}.`, 400);
  const key = paymentKey(creds);
  if (!forceRefresh && paymentCache && paymentCache.key === key && paymentCache.expiresAt > Date.now() + TOKEN_MARGIN_MS) return paymentCache.token;

  const role = (roleName: "PAYER" | "LABEL_OWNER") => ({
    roleName,
    CRID: creds.crid!.trim(),
    MID: creds.mid!.trim(),
    manifestMID: (creds.manifestMid?.trim() || creds.mid!.trim()),
    accountType: "EPS",
    accountNumber: creds.accountNumber!.trim(),
  });
  const token = await uspsAccessToken(creds);
  const res = await send(`${uspsBaseUrl(creds.environment)}/payments/v3/payment-authorization`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ roles: [role("PAYER"), role("LABEL_OWNER")] }),
  });
  const body = (await readJson(res)) as { paymentAuthorizationToken?: string } | null;
  if (!res.ok || !body?.paymentAuthorizationToken) {
    const detail = uspsErrorMessage(body);
    throw new UspsError(
      `USPS no autorizó la cuenta de pago (${res.status})${detail ? `: ${detail}` : ": revisa el CRID, el MID y el número de cuenta EPS, que la cuenta esté verificada y que la app tenga acceso a Labels"}.`,
      res.status === 401 || res.status === 403 || res.status === 400 ? 400 : 502,
    );
  }
  paymentCache = { key, token: body.paymentAuthorizationToken, expiresAt: Date.now() + DEFAULT_TOKEN_LIFETIME_MS };
  return body.paymentAuthorizationToken;
}

type CallOptions = {
  method?: string;
  query?: Record<string, string | null | undefined>;
  json?: unknown;
  payment?: boolean;
  accept?: string;
};

/** Una llamada autenticada; si el token ya no vale, lo renueva y repite una vez. */
async function call(creds: UspsCredentials, path: string, opts: CallOptions = {}): Promise<Response> {
  const query = Object.entries(opts.query ?? {}).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "");
  const url = `${uspsBaseUrl(creds.environment)}${path}${query.length ? `?${new URLSearchParams(query).toString()}` : ""}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await uspsAccessToken(creds, attempt > 0)}`,
      accept: opts.accept ?? "application/json",
    };
    if (opts.json !== undefined) headers["content-type"] = "application/json";
    if (opts.payment) headers["x-payment-authorization-token"] = await uspsPaymentToken(creds, attempt > 0);
    const res = await send(url, { method: opts.method ?? "GET", headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined });
    if (res.status === 401 && attempt === 0) {
      oauthCache = null;
      paymentCache = null;
      continue;
    }
    if (res.status === 429) {
      throw new UspsError("USPS limitó las consultas (cuota por hora de la app). Espera un rato y vuelve a intentar.", 429);
    }
    return res;
  }
  throw new UspsError("USPS rechazó las credenciales (401).", 400);
}

// ── Direcciones ───────────────────────────────────────────────────────────────

export type UspsAddressInput = {
  streetAddress: string;
  secondaryAddress?: string | null;
  city: string;
  state: string;
  ZIPCode: string;
  ZIPPlus4?: string | null;
};

export type UspsAddressCheck = {
  found: boolean;
  /** La dirección como USPS la escribe (mayúsculas, ZIP+4…). Solo si la encontró. */
  address: Required<Pick<UspsAddressInput, "streetAddress" | "city" | "state" | "ZIPCode">> & { secondaryAddress: string | null; ZIPPlus4: string | null } | null;
  /** DPVConfirmation: Y entregable; S falta/sobra el apartamento; D falta el apartamento; N no confirmada. */
  dpvConfirmation: string | null;
  message: string | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Pregunta a USPS si la dirección existe y cómo la escribe. */
export async function uspsValidateAddress(creds: UspsCredentials, input: UspsAddressInput): Promise<UspsAddressCheck> {
  const res = await call(creds, "/addresses/v3/address", {
    query: {
      streetAddress: input.streetAddress,
      secondaryAddress: input.secondaryAddress,
      city: input.city,
      state: input.state,
      ZIPCode: input.ZIPCode,
      ZIPPlus4: input.ZIPPlus4,
    },
  });
  const body = (await readJson(res)) as {
    address?: Record<string, unknown>;
    additionalInfo?: { DPVConfirmation?: unknown };
    corrections?: Array<{ text?: unknown }>;
    matches?: Array<{ text?: unknown }>;
  } | null;
  if (res.status === 404 || res.status === 400) {
    // USPS contesta 404/400 cuando no reconoce la dirección: no es un fallo de la conexión.
    return { found: false, address: null, dpvConfirmation: null, message: uspsErrorMessage(body) ?? "USPS no reconoce esta dirección." };
  }
  if (!res.ok) throw new UspsError(`USPS no pudo validar la dirección (${res.status})${uspsErrorMessage(body) ? `: ${uspsErrorMessage(body)}` : ""}.`, res.status === 401 || res.status === 403 ? 400 : 502);
  const a = body?.address;
  const street = str(a?.streetAddress);
  if (!a || !street) return { found: false, address: null, dpvConfirmation: null, message: "USPS no devolvió una dirección." };
  const notes = [...(body?.corrections ?? []), ...(body?.matches ?? [])].map((n) => str(n?.text)).filter((t): t is string => t != null);
  return {
    found: true,
    address: {
      streetAddress: street,
      secondaryAddress: str(a.secondaryAddress),
      city: str(a.city) ?? input.city,
      state: str(a.state) ?? input.state,
      ZIPCode: str(a.ZIPCode) ?? input.ZIPCode,
      ZIPPlus4: str(a.ZIPPlus4),
    },
    dpvConfirmation: str(body?.additionalInfo?.DPVConfirmation),
    message: notes.length ? notes.join(" ") : null,
  };
}

// ── Etiquetas ─────────────────────────────────────────────────────────────────

export type UspsLabelRequest = {
  from: { firstName: string; lastName: string; streetAddress: string; secondaryAddress?: string | null; city: string; state: string; ZIPCode: string };
  to: { firstName: string; lastName: string; streetAddress: string; secondaryAddress?: string | null; city: string; state: string; ZIPCode: string; ZIPPlus4?: string | null };
  mailClass: UspsMailClass;
  weightLb: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  /** AAAA-MM-DD */
  mailingDate: string;
  rateIndicator?: string;
  processingCategory?: string;
};

export type UspsCreatedLabel = {
  trackingNumber: string;
  postageCents: number;
  extraCents: number;
  commitmentName: string | null;
  commitmentDate: string | null;
  pdf: Buffer;
};

function cleanAddress<T extends Record<string, string | null | undefined>>(a: T): Record<string, string> {
  return Object.fromEntries(Object.entries(a).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== "").map(([k, v]) => [k, v.trim()]));
}

/** Las partes de una respuesta multipart: nombre → bytes del cuerpo. */
export function parseMultipart(contentType: string, data: Buffer): Map<string, Buffer> {
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (!boundary) throw new UspsError("La respuesta de USPS no trae las partes de la etiqueta.");
  // latin1 conserva cada byte como un carácter: se parte el texto y se vuelve a bytes sin perder el PDF.
  const text = data.toString("latin1");
  const parts = new Map<string, Buffer>();
  for (const chunk of text.split(`--${boundary}`)) {
    const split = chunk.indexOf("\r\n\r\n");
    const split2 = split >= 0 ? split : chunk.indexOf("\n\n");
    if (split2 < 0) continue;
    const headers = chunk.slice(0, split2);
    // `filename="labelImage.pdf"; name="labelImage"`: el campo es el `name`, no el de `filename`.
    const name = /(?:^|[;\s])name="([^"]+)"/i.exec(headers)?.[1];
    if (!name) continue;
    let body = chunk.slice(split2 + (split >= 0 ? 4 : 2));
    body = body.replace(/\r?\n$/, "");
    parts.set(name, Buffer.from(body, "latin1"));
  }
  return parts;
}

/** El PDF viene como bytes o en base64 según el caso: se devuelve siempre en bytes. */
export function pdfFromPart(part: Buffer): Buffer {
  if (part.subarray(0, 4).toString("latin1") === "%PDF") return part;
  const decoded = Buffer.from(part.toString("latin1").replace(/\s+/g, ""), "base64");
  if (decoded.subarray(0, 4).toString("latin1") === "%PDF") return decoded;
  throw new UspsError("USPS devolvió una etiqueta que no es un PDF.");
}

const toCents = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : 0);
const sumPrices = (list: unknown): number => (Array.isArray(list) ? list.reduce((s: number, e) => s + toCents((e as { price?: unknown } | null)?.price), 0) : 0);

/**
 * Compra la etiqueta: USPS cobra el franqueo de la cuenta de pago. En
 * producción es dinero real; en el ambiente de pruebas no.
 */
export async function uspsCreateLabel(creds: UspsCredentials, req: UspsLabelRequest): Promise<UspsCreatedLabel> {
  const res = await call(creds, "/labels/v3/label", {
    method: "POST",
    payment: true,
    // La respuesta es multipart; no se restringe el Accept por si USPS lo rechaza.
    accept: "*/*",
    json: {
      imageInfo: { imageType: "PDF" },
      toAddress: cleanAddress(req.to),
      fromAddress: cleanAddress(req.from),
      packageDescription: {
        mailClass: req.mailClass,
        rateIndicator: req.rateIndicator ?? "SP",
        weightUOM: "lb",
        weight: Math.round(req.weightLb * 1000) / 1000,
        dimensionsUOM: "in",
        length: req.lengthIn,
        width: req.widthIn,
        height: req.heightIn,
        processingCategory: req.processingCategory ?? "MACHINABLE",
        mailingDate: req.mailingDate,
        destinationEntryFacilityType: "NONE",
      },
    },
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    const body = contentType.includes("json") ? await readJson(res) : null;
    const detail = uspsErrorMessage(body);
    throw new UspsError(`USPS no creó la etiqueta (${res.status})${detail ? `: ${detail}` : ""}.`, res.status >= 500 ? 502 : 400, res.status < 500);
  }

  let metadata: Record<string, unknown> | null = null;
  let pdfPart: Buffer | null = null;
  if (contentType.toLowerCase().includes("multipart")) {
    const parts = parseMultipart(contentType, Buffer.from(await res.arrayBuffer()));
    const meta = parts.get("labelMetadata");
    metadata = meta ? (JSON.parse(meta.toString("utf8")) as Record<string, unknown>) : null;
    pdfPart = parts.get("labelImage") ?? null;
  } else {
    // Algunas versiones devuelven un solo JSON con la imagen en base64.
    const body = (await readJson(res)) as { labelMetadata?: Record<string, unknown>; labelImage?: string } | null;
    metadata = body?.labelMetadata ?? (body as Record<string, unknown> | null);
    pdfPart = body?.labelImage ? Buffer.from(body.labelImage, "latin1") : null;
  }
  const trackingNumber = str(metadata?.trackingNumber);
  // Si la compra se hizo pero no se pudo leer, hay que decirlo con todas sus letras: se cobró.
  if (!trackingNumber || !pdfPart) {
    throw new UspsError("USPS respondió que creó la etiqueta pero la respuesta vino incompleta (sin guía o sin PDF). Revisa tu cuenta de USPS: puede haberse cobrado.", 502, false);
  }
  const commitment = metadata?.commitment as { name?: unknown; scheduleDeliveryDate?: unknown } | undefined;
  return {
    trackingNumber,
    postageCents: toCents(metadata?.postage),
    extraCents: sumPrices(metadata?.extraServices) + sumPrices(metadata?.fees),
    commitmentName: str(commitment?.name),
    commitmentDate: /^\d{4}-\d{2}-\d{2}$/.test(str(commitment?.scheduleDeliveryDate) ?? "") ? str(commitment?.scheduleDeliveryDate) : null,
    pdf: pdfFromPart(pdfPart),
  };
}

/** Anula una etiqueta sin usar y pide el reembolso del franqueo. */
export async function uspsCancelLabel(creds: UspsCredentials, trackingNumber: string): Promise<{ message: string | null }> {
  const res = await call(creds, `/labels/v3/label/${encodeURIComponent(trackingNumber)}`, { method: "DELETE" });
  const body = await readJson(res);
  if (!res.ok) {
    const detail = uspsErrorMessage(body);
    throw new UspsError(`USPS no anuló la etiqueta (${res.status})${detail ? `: ${detail}` : ""}.`, res.status >= 500 ? 502 : 400, res.status < 500);
  }
  const message = body && typeof body === "object" ? (str((body as { message?: unknown }).message) ?? str((body as { status?: unknown }).status)) : null;
  return { message };
}

// ── Rastreo ───────────────────────────────────────────────────────────────────

export type UspsTracking = {
  /** Null mientras USPS no ha escaneado el paquete: la etiqueta existe pero aún no hay estado. */
  status: string | null;
  statusCategory: string | null;
  summary: string | null;
  delivered: boolean;
};

export async function uspsTrack(creds: UspsCredentials, trackingNumber: string): Promise<UspsTracking> {
  const res = await call(creds, `/tracking/v3/tracking/${encodeURIComponent(trackingNumber)}`, { query: { expand: "DETAIL" } });
  const body = (await readJson(res)) as { status?: unknown; statusCategory?: unknown; statusSummary?: unknown } | null;
  if (res.status === 404 || res.status === 400) return { status: null, statusCategory: null, summary: null, delivered: false };
  if (!res.ok) throw new UspsError(`USPS no pudo rastrear la guía (${res.status})${uspsErrorMessage(body) ? `: ${uspsErrorMessage(body)}` : ""}.`, res.status === 401 || res.status === 403 ? 400 : 502);
  const category = str(body?.statusCategory);
  return { status: str(body?.status), statusCategory: category, summary: str(body?.statusSummary), delivered: category?.toLowerCase() === "delivered" };
}

/**
 * Prueba la conexión sin gastar nada: el token OAuth y, si están los datos de la
 * cuenta de pago, la autorización de pago.
 */
export async function testUspsConnection(creds: UspsCredentials): Promise<{ payment: boolean }> {
  await uspsAccessToken(creds, true);
  const hasPaymentData = Boolean(creds.crid?.trim() && creds.mid?.trim() && creds.accountNumber?.trim());
  if (!hasPaymentData) return { payment: false };
  await uspsPaymentToken(creds, true);
  return { payment: true };
}
