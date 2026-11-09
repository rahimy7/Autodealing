// Cliente mínimo de la Admin API de Shopify (GraphQL), para traer los pedidos de
// la tienda — web y suscripciones — al inventario (decisión del 2026-10-04).
//
// Dos maneras de entrar, según cómo tenga la tienda su app:
//   - Token de una app personalizada antigua ("shpat_…"). Desde el 2026-01-01
//     Shopify ya no deja crear apps así desde el admin, pero las que existían
//     siguen funcionando.
//   - App del Dev Dashboard: Client ID + Client Secret que se canjean por un
//     token (client credentials grant) que caduca a las 24 h. Se guarda solo en
//     memoria y se renueva antes de caducar o al primer 401.
// https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens
//
// Permisos que necesita la app: read_orders, read_customers, read_products (y el
// acceso a datos protegidos de clientes —nombre, correo, teléfono, dirección—
// configurado en la app, o los pedidos llegan sin datos del cliente).

// Versión fija de la API: Shopify publica una por trimestre y soporta cada una un
// año. Al subirla, revisar que los campos de ORDERS_QUERY sigan existiendo.
export const SHOPIFY_API_VERSION = "2026-07";

export type ShopifyCredentials = {
  shopDomain: string;
  accessToken?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
};

export class ShopifyError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "ShopifyError";
  }
}

/** "procollagen" / "https://procollagen.myshopify.com/admin" → "procollagen.myshopify.com". */
export function normalizeShopDomain(input: string | null | undefined): string | null {
  const raw = input?.trim().toLowerCase();
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//, "").split("/")[0];
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)) return host;
  if (/^[a-z0-9][a-z0-9-]*$/.test(host)) return `${host}.myshopify.com`;
  return null;
}

let cached: { key: string; token: string; expiresAt: number } | null = null;

/** El token para hablar con la tienda: el fijo, o uno canjeado con Client ID/Secret. */
async function accessToken(creds: ShopifyCredentials, forceRefresh = false): Promise<string> {
  if (creds.accessToken?.trim()) return creds.accessToken.trim();
  if (!creds.clientId?.trim() || !creds.clientSecret?.trim()) {
    throw new ShopifyError("Faltan las credenciales de Shopify: el token de la app o su Client ID y Client Secret.", 400);
  }
  const key = `${creds.shopDomain}:${creds.clientId}`;
  if (!forceRefresh && cached && cached.key === key && cached.expiresAt > Date.now() + 5 * 60 * 1000) return cached.token;
  const res = await fetch(`https://${creds.shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: creds.clientId.trim(), client_secret: creds.clientSecret.trim(), grant_type: "client_credentials" }),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string; error?: string } | null;
  if (!res.ok || !body?.access_token) {
    throw new ShopifyError(`Shopify no entregó el token (${res.status}): ${body?.error_description ?? body?.error ?? "revisa el Client ID y el Client Secret, y que la app esté instalada en la tienda"}.`, 400);
  }
  cached = { key, token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 86_000) * 1000 };
  return body.access_token;
}

/** El token vigente de la tienda, para pedir un archivo de Shopify que no es de la API (el PDF de una etiqueta). */
export const shopifyAccessToken = accessToken;

/** Olvida el token canjeado (al cambiar las credenciales). */
export function forgetShopifyToken(): void {
  cached = null;
}

type ThrottleStatus = { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: { cost?: { throttleStatus?: ThrottleStatus } };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cuánto esperar antes de la siguiente consulta para no agotar el cupo de la
 * tienda, que Shopify informa en cada respuesta: con menos de un cuarto, se deja
 * recuperar hasta la mitad. Así recorrer todos los clientes (la lista de
 * suscriptores) no acaba en THROTTLED.
 */
export function throttleDelayMs(status: ThrottleStatus | undefined): number {
  if (!status || !(status.restoreRate > 0)) return 0;
  if (status.currentlyAvailable >= status.maximumAvailable / 4) return 0;
  return Math.ceil(((status.maximumAvailable / 2 - status.currentlyAvailable) / status.restoreRate) * 1000);
}

export async function shopifyGraphql<T>(creds: ShopifyCredentials, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const url = `https://${creds.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const fixedToken = Boolean(creds.accessToken?.trim());
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await accessToken(creds, attempt > 0);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-shopify-access-token": token },
      body: JSON.stringify({ query, variables }),
    });
    lastStatus = res.status;
    if (res.status === 401 && fixedToken) {
      // El token guardado gana sobre el Client ID/Secret: si es viejo o no es de
      // la Admin API (p. ej. el de automatización de CI/CD), nunca se llega a
      // canjear con la app del Dev Dashboard. Decirlo, que si no parece culpa de esa app.
      throw new ShopifyError(
        "Shopify rechazó el token guardado (401). Se usa antes que el Client ID y el Client Secret: si la app es del Dev Dashboard, quita el token y prueba de nuevo.",
        400,
      );
    }
    if (res.status === 401) {
      cached = null;
      continue;
    }
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const body = (await res.json().catch(() => null)) as GraphqlResponse<T> | null;
    if (!res.ok) throw new ShopifyError(`Shopify respondió ${res.status}${body?.errors?.[0]?.message ? `: ${body.errors[0].message}` : ""}.`, res.status === 401 || res.status === 403 ? 400 : 502);
    const throttle = body?.extensions?.cost?.throttleStatus;
    if (body?.errors?.length) {
      if (body.errors.some((e) => e.extensions?.code === "THROTTLED")) {
        await sleep(Math.max(2000 * (attempt + 1), throttleDelayMs(throttle)));
        continue;
      }
      throw new ShopifyError(`Shopify: ${body.errors.map((e) => e.message).join("; ")}`);
    }
    if (!body?.data) throw new ShopifyError("Shopify no devolvió datos.");
    const wait = throttleDelayMs(throttle);
    if (wait > 0) await sleep(wait);
    return body.data;
  }
  if (lastStatus === 401) {
    throw new ShopifyError(
      "Shopify entregó el token pero lo rechaza (401): revisa que la app esté instalada en esta misma tienda y que el Client ID y el Client Secret sean de esa app.",
      400,
    );
  }
  throw new ShopifyError("Shopify no respondió después de varios intentos.");
}

/** Prueba la conexión: el nombre de la tienda si todo está bien. */
export async function testShopifyConnection(creds: ShopifyCredentials): Promise<{ shopName: string; currency: string }> {
  const data = await shopifyGraphql<{ shop: { name: string; currencyCode: string } }>(creds, "query { shop { name currencyCode } }");
  return { shopName: data.shop.name, currency: data.shop.currencyCode };
}

export const ORDERS_QUERY = `
query Orders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      updatedAt
      cancelledAt
      displayFinancialStatus
      email
      phone
      customerLocale
      note
      customAttributes { key value }
      sourceName
      currencyCode
      totalShippingPriceSet { shopMoney { amount } }
      customer { firstName lastName email phone }
      shippingAddress { name address1 address2 city province zip country phone }
      fulfillments(first: 10) {
        id
        status
        deliveredAt
        trackingInfo { company number url }
      }
      lineItems(first: 50) {
        nodes {
          id
          title
          quantity
          sku
          variant { sku product { handle } }
          originalUnitPriceSet { shopMoney { amount } }
          totalDiscountSet { shopMoney { amount } }
          sellingPlan { name }
        }
      }
    }
  }
}`;
