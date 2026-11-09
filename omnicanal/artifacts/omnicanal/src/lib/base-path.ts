import { setBaseUrl } from "@workspace/api-client-react";

// Dónde está montado el panel. Como servicio propio es la raíz ("/"); el sitio de
// Premier lo publica bajo /omnicanal/ en su mismo dominio (BASE_PATH al compilar).
// Sin barra final: "" en la raíz, "/omnicanal" bajo el sitio.
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, "");

/**
 * Una ruta absoluta del servidor ("/api/…", "/clients/…") con el prefijo del
 * panel. Las URL completas (https://…, blob:, data:) y las relativas quedan igual.
 */
export function withBase(url: string): string;
export function withBase(url: string | null | undefined): string | null | undefined;
export function withBase(url: string | null | undefined) {
  if (!url || !url.startsWith("/") || url.startsWith("//")) return url;
  return `${BASE_PATH}${url}`;
}

// Las llamadas del cliente generado y de customFetch van a "/api/…": con esto
// salen con el prefijo del panel. En la raíz no cambia nada.
setBaseUrl(BASE_PATH || null);
