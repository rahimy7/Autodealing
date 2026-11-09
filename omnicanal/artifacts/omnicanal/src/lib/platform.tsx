import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ClientConfigSchema,
  defineClient,
  CHANNEL_MODULE_KEYS,
  type ClientConfig,
  type ChannelModuleKey,
  type ModuleKey,
} from "@workspace/platform-config";
import { withBase } from "@/lib/base-path";

// La marca y los módulos llegan del servidor en tiempo de ejecución (GET
// /api/config), no del bundle. Por eso una sola compilación sirve a los 50
// clientes: cambiar de cliente es cambiar variables de entorno de la instancia,
// no volver a construir el frontend.

export interface CoreInfo {
  version: string;
  environment: string;
  commit: string | null;
}

export interface Platform {
  client: ClientConfig;
  core: CoreInfo;
  /** Canales de Meta encendidos, en el orden en que se muestran. */
  channels: ChannelModuleKey[];
  /** `true` cuando no se pudo leer /api/config y se está usando el respaldo. */
  degraded: boolean;
}

// Respaldo para que la aplicación siga en pie si /api/config no contesta: se ve
// sin marca, pero se ve. Un frontend en blanco por un endpoint caído sería peor.
const FALLBACK_CLIENT = defineClient({ id: "desconocido", name: "Omnicanal" });

const FALLBACK_PLATFORM: Platform = {
  client: FALLBACK_CLIENT,
  core: { version: "desconocida", environment: "unknown", commit: null },
  channels: [...CHANNEL_MODULE_KEYS],
  degraded: true,
};

const PlatformContext = createContext<Platform>(FALLBACK_PLATFORM);

// ── Color ────────────────────────────────────────────────────────────────────
// Los tokens del tema son tripletas HSL sin la función `hsl()` (`--primary: 250
// 84% 60%`), así que un color de marca en hexadecimal hay que convertirlo antes
// de escribirlo en la variable.

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): Hsl | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;

  const int = parseInt(match[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function triplet({ h, s, l }: Hsl): string {
  return `${h} ${s}% ${l}%`;
}

function shiftLightness(color: Hsl, amount: number): Hsl {
  return { ...color, l: Math.min(100, Math.max(0, color.l + amount)) };
}

/** Blanco o casi negro, el que se lea sobre el color dado. */
function readableOn(color: Hsl): Hsl {
  return color.l > 58 ? { h: color.h, s: 20, l: 12 } : { h: 0, s: 0, l: 100 };
}

function applyBranding(client: ClientConfig): void {
  const root = document.documentElement;
  const { branding } = client;

  const primary = branding.primaryColor ? hexToHsl(branding.primaryColor) : null;
  if (primary) {
    // El color principal manda en los tokens que marcan "esto es de la marca":
    // botones, estado activo del menú y anillo de foco.
    for (const token of ["--primary", "--sidebar-primary"]) {
      root.style.setProperty(token, triplet(primary));
    }
    for (const token of ["--ring", "--sidebar-ring"]) {
      root.style.setProperty(token, triplet(primary));
    }
    const onPrimary = triplet(readableOn(primary));
    root.style.setProperty("--primary-foreground", onPrimary);
    root.style.setProperty("--sidebar-primary-foreground", onPrimary);
  }

  const secondary = branding.secondaryColor ? hexToHsl(branding.secondaryColor) : null;
  if (secondary) {
    // El color secundario viste el menú lateral entero: fondo, texto legible
    // encima, y las dos variantes cercanas que usan el hover y los bordes. Si se
    // cambiara solo el fondo, el hover quedaría fuera de tono.
    const darkSidebar = secondary.l <= 58;
    root.style.setProperty("--sidebar", triplet(secondary));
    root.style.setProperty("--sidebar-foreground", triplet(readableOn(secondary)));
    root.style.setProperty("--sidebar-accent", triplet(shiftLightness(secondary, darkSidebar ? 8 : -6)));
    root.style.setProperty("--sidebar-border", triplet(shiftLightness(secondary, darkSidebar ? 12 : -10)));

    // El elemento activo del menú va en color primario. Con un menú oscuro y un
    // primario también oscuro (el malva de Procollagen sobre su ciruela) no se
    // leía: ahí el primario se aclara, solo dentro del menú. Los botones del
    // resto del panel lo conservan tal cual.
    if (primary && darkSidebar && primary.l < 60) {
      const onSidebar = shiftLightness(primary, 30);
      root.style.setProperty("--sidebar-primary", triplet(onSidebar));
      root.style.setProperty("--sidebar-primary-foreground", triplet(readableOn(onSidebar)));
      root.style.setProperty("--sidebar-ring", triplet(onSidebar));
    }
  }

  const accent = branding.accentColor ? hexToHsl(branding.accentColor) : null;
  if (accent) {
    root.style.setProperty("--chart-1", triplet(accent));
  }

  // Fondo y texto: el papel y la tinta de la marca. Las superficies neutras
  // (fondos apagados, bordes, campos) se derivan del fondo, para que todo quede
  // en su mismo tono en vez del gris azulado del tema del core. Las tarjetas
  // siguen blancas: sobre un fondo tintado es lo que las separa.
  const background = branding.backgroundColor ? hexToHsl(branding.backgroundColor) : null;
  if (background) {
    root.style.setProperty("--background", triplet(background));
    root.style.setProperty("--muted", triplet(shiftLightness(background, -4)));
    root.style.setProperty("--secondary", triplet(shiftLightness(background, -3)));
    for (const token of ["--border", "--input", "--card-border", "--popover-border"]) {
      root.style.setProperty(token, triplet(shiftLightness(background, -9)));
    }
  }

  const text = branding.textColor ? hexToHsl(branding.textColor) : null;
  if (text) {
    for (const token of ["--foreground", "--card-foreground", "--popover-foreground", "--secondary-foreground"]) {
      root.style.setProperty(token, triplet(text));
    }
    // El texto secundario es la misma tinta, más clara y menos saturada: sigue
    // siendo de la marca y, con el tope de luminosidad, se lee sobre un fondo claro.
    root.style.setProperty(
      "--muted-foreground",
      triplet({ ...text, s: Math.min(text.s, 25), l: Math.min(text.l + 22, 45) }),
    );
  }

  document.title = branding.productName;

  if (branding.faviconUrl) {
    const link =
      document.querySelector<HTMLLinkElement>("link[rel~='icon']") ??
      document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon" }));
    link.href = withBase(branding.faviconUrl);
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

async function fetchPlatform(): Promise<Platform> {
  const response = await fetch(withBase("/api/config"), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GET /api/config respondió ${response.status}`);

  const body = (await response.json()) as { client?: unknown; core?: Partial<CoreInfo> };
  // Se valida en vez de confiar: así un servidor con un core más viejo (sin
  // algún campo nuevo) sigue funcionando con los valores por defecto en lugar de
  // romper la aplicación con un `undefined` a media pantalla.
  const parsed = ClientConfigSchema.safeParse(body.client);
  const client = parsed.success ? parsed.data : FALLBACK_CLIENT;

  return {
    client,
    core: {
      version: body.core?.version ?? "desconocida",
      environment: body.core?.environment ?? "unknown",
      commit: body.core?.commit ?? null,
    },
    channels: CHANNEL_MODULE_KEYS.filter((channel) => client.modules[channel]),
    degraded: !parsed.success,
  };
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatform] = useState<Platform | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchPlatform()
      .then((resolved) => {
        if (cancelled) return;
        applyBranding(resolved.client);
        setPlatform(resolved);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("No se pudo leer la configuración de la instancia:", err);
        setPlatform(FALLBACK_PLATFORM);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Se espera a la configuración antes del primer render para que nadie vea la
  // marca equivocada por un instante. Es una petición al mismo origen.
  if (!platform) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-muted border-t-primary animate-spin" />
      </div>
    );
  }

  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function usePlatform(): Platform {
  return useContext(PlatformContext);
}

export function useClient(): ClientConfig {
  return useContext(PlatformContext).client;
}

/** ¿Esta instancia tiene el módulo? Lo que responde `false` no se muestra ni se enruta. */
export function useModule(module: ModuleKey): boolean {
  return useContext(PlatformContext).client.modules[module];
}

export function useModules(): ClientConfig["modules"] {
  return useContext(PlatformContext).client.modules;
}

/** ¿Está encendida esta bandera de extensión? */
export function useFeature(feature: string): boolean {
  const { features } = useContext(PlatformContext).client;
  return features[feature] === true;
}

/** Oculta su contenido en las instancias que no tienen el módulo. */
export function IfModule({ module, children }: { module: ModuleKey; children: ReactNode }) {
  return useModule(module) ? <>{children}</> : null;
}

/** Los canales encendidos con su etiqueta, para resúmenes de la interfaz. */
export function useChannelSummary(): { channels: ChannelModuleKey[]; count: number } {
  const { channels } = useContext(PlatformContext);
  return useMemo(() => ({ channels, count: channels.length }), [channels]);
}
