import { CLIENTS, CLIENT_IDS } from "./clients";
import { ClientConfigSchema, type ClientConfig, type ClientConfigInput } from "./schema";

/**
 * Cliente que se asume cuando la instancia no declara `CLIENT_ID`. Esta copia
 * existe para Premier Line Motors, así que sin la variable arranca como Premier
 * (y lo avisa por log). Declarar `CLIENT_ID=premier` igual es lo recomendado.
 */
export const FALLBACK_CLIENT_ID = "premier";

export interface ResolvedClientConfig {
  config: ClientConfig;
  /** Identificador con el que se resolvió, venga de `CLIENT_ID` o del respaldo. */
  clientId: string;
  /** `false` cuando la instancia no declaró `CLIENT_ID` y se usó el respaldo. */
  explicit: boolean;
  /** `true` cuando `CLIENT_CONFIG_JSON` modificó la configuración del repositorio. */
  overridden: boolean;
}

export interface ClientConfigEnv {
  CLIENT_ID?: string | undefined;
  CLIENT_CONFIG_JSON?: string | undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Mezcla recursiva de objetos planos. Los arreglos y los valores sueltos se
 * reemplazan enteros: si una instancia declara `extensions`, manda esa lista,
 * no la unión con la del repositorio.
 */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }

  return result;
}

function parseOverrides(raw: string | undefined): Record<string, unknown> | null {
  if (!raw || raw.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `CLIENT_CONFIG_JSON no es JSON válido: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error("CLIENT_CONFIG_JSON debe ser un objeto JSON, por ejemplo {\"branding\":{\"primaryColor\":\"#E11D48\"}}.");
  }

  // El identificador de la instancia lo fija CLIENT_ID; permitir cambiarlo desde
  // el JSON solo lograría que los logs y la consola mientan sobre quién es quién.
  const { id: _ignored, ...rest } = parsed;
  return rest;
}

/**
 * Resuelve qué cliente es esta instancia a partir de su entorno.
 *
 * `CLIENT_ID` elige una configuración del repositorio y `CLIENT_CONFIG_JSON`
 * (opcional) la ajusta encima, para un retoque puntual sin publicar una versión
 * nueva del core. Un `CLIENT_ID` desconocido solo es válido si el JSON trae la
 * configuración completa; en cualquier otro caso se lanza un error al arrancar,
 * que es cuando se ve, y no a mitad de una conversación.
 */
export function resolveClientConfig(env: ClientConfigEnv = {}): ResolvedClientConfig {
  const declared = env.CLIENT_ID?.trim();
  const clientId = declared && declared !== "" ? declared : FALLBACK_CLIENT_ID;
  const overrides = parseOverrides(env.CLIENT_CONFIG_JSON);
  const base = CLIENTS[clientId];

  if (!base && !overrides) {
    throw new Error(
      `CLIENT_ID="${clientId}" no existe. Clientes disponibles: ${CLIENT_IDS.join(", ")}. ` +
        "Crea su configuración con `pnpm clients:new " +
        clientId +
        "` o define la instancia completa en CLIENT_CONFIG_JSON.",
    );
  }

  if (!overrides) {
    return { config: base!, clientId, explicit: Boolean(declared), overridden: false };
  }

  const merged = deepMerge(
    base ? (base as unknown as Record<string, unknown>) : { name: clientId },
    overrides,
  );
  const parsed = ClientConfigSchema.safeParse({ ...merged, id: clientId } as ClientConfigInput);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  · ${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`La configuración de "${clientId}" con CLIENT_CONFIG_JSON aplicado es inválida:\n${detail}`);
  }

  return { config: parsed.data, clientId, explicit: Boolean(declared), overridden: true };
}
