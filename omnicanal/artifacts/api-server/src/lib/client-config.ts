import type { IRouter, RequestHandler } from "express";
import {
  resolveClientConfig,
  CHANNEL_MODULE_KEYS,
  CORE_VERSION,
  type ClientConfig,
  type ModuleKey,
} from "@workspace/platform-config";
import { logger } from "./logger";

// Quién es esta instancia. Se resuelve una sola vez al arrancar: si CLIENT_ID
// apunta a un cliente que no existe, el proceso muere aquí con un mensaje claro
// en vez de servir la marca equivocada.
const resolved = resolveClientConfig(process.env);

export const clientConfig: ClientConfig = resolved.config;
export const coreVersion = CORE_VERSION;

if (!resolved.explicit) {
  logger.warn(
    { clientId: resolved.clientId },
    "CLIENT_ID no está definido: se usó el cliente de respaldo. Declara CLIENT_ID en las variables de la instancia.",
  );
}

logger.info(
  {
    clientId: clientConfig.id,
    client: clientConfig.name,
    coreVersion,
    overridden: resolved.overridden,
    modules: enabledModules(),
  },
  "Instancia de plataforma resuelta",
);

/** ¿Este cliente tiene el módulo encendido? */
export function isModuleEnabled(module: ModuleKey): boolean {
  return clientConfig.modules[module];
}

export function enabledModules(): ModuleKey[] {
  return (Object.keys(clientConfig.modules) as ModuleKey[]).filter((key) => clientConfig.modules[key]);
}

/** Canales de Meta encendidos para este cliente. */
export function enabledChannels(): ModuleKey[] {
  return CHANNEL_MODULE_KEYS.filter((key) => clientConfig.modules[key]);
}

/**
 * Monta un router solo si el módulo está encendido. Un módulo apagado deja de
 * existir para la instancia: sus rutas caen en el 404 JSON de /api, sin ninguna
 * ruta a medias que responda datos vacíos.
 */
export function mountModule(target: IRouter, module: ModuleKey, handler: RequestHandler): void {
  if (isModuleEnabled(module)) {
    target.use(handler);
  }
}
