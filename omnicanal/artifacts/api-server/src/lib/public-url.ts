// La dirección pública de la instancia, para lo que Meta tiene que descargar por
// su cuenta: una imagen que se manda por enlace se pide desde los servidores de
// Meta, así que una ruta relativa del panel no le sirve.
//
// PUBLIC_BASE_URL manda (un dominio propio del cliente); sin ella se usa el
// dominio público que Railway inyecta en cada servicio con dominio generado.

export function publicBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const railway = env.RAILWAY_PUBLIC_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return railway ? `https://${railway}` : null;
}

/** La URL absoluta de una ruta del panel, o la misma URL si ya lo es. Null sin dominio público. */
export function toPublicUrl(pathOrUrl: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = publicBaseUrl(env);
  if (!base) return null;
  return `${base}/${pathOrUrl.replace(/^\/+/, "")}`;
}

/**
 * A welcome picture is either an object in the media bucket ("custom-oferta-1a2b.jpeg") or a
 * picture the site itself serves: a path such as "/img/welcome.jpg" or a full https:// URL. The
 * second kind needs no storage account, only the public address above.
 */
export const isSiteImage = (path: string): boolean => path.startsWith("/") || /^https?:\/\//i.test(path);
