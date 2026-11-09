// Las vistas son las pantallas del panel a las que se puede dar acceso a una
// persona. Qué vistas ve cada usuario lo decide la tabla `view_access`, no su rol:
// el rol (administrador / agente) solo propone el punto de partida cuando se crea
// el usuario (ver DEFAULT_VIEWS_BY_ROLE).
//
// Una vista tiene que cumplir dos cosas para aparecer: que el usuario la tenga
// asignada y que la instancia tenga encendido su módulo (ver modules.ts). Lo
// segundo es lo que el cliente contrató; lo primero, quién de su equipo la usa.
//
// Agregar una pantalla al panel es agregar su clave aquí. Las claves se guardan
// tal cual en la base: renombrar una deja sin acceso a quien la tenía.
import type { ModuleKey } from "./modules";

export const VIEW_GROUPS = ["service", "operations", "commercial", "system"] as const;
export type ViewGroup = (typeof VIEW_GROUPS)[number];

export const VIEW_GROUP_LABELS: Record<ViewGroup, string> = {
  service: "Atención al cliente",
  operations: "Operación",
  commercial: "Clientes y ventas",
  system: "Sistema",
};

// El orden de esta lista es el orden del menú.
export const VIEW_KEYS = [
  // Atención: lo que ve quien solo contesta chats.
  "my-chats",
  "general-chat",
  "my-profile",
  // Operación
  "dashboard",
  "inbox",
  "feed",
  "email",
  "appointments",
  "orders",
  "subscriptions",
  "shipments",
  "inventory",
  "purchasing",
  "cases",
  "learning",
  "answer-training",
  "monitor",
  "reports",
  // Clientes y ventas
  "contacts",
  "campaigns",
  "products",
  "custom-messages",
  "workflow",
  // Sistema
  "agents",
  "admin",
  "logs",
  "settings",
  "platform",
] as const;

export type ViewKey = (typeof VIEW_KEYS)[number];

export interface ViewDefinition {
  label: string;
  description: string;
  group: ViewGroup;
  /** Ruta de la pantalla en el panel web. */
  path: string;
  /** Módulo que la instancia necesita tener encendido para que la vista exista. */
  module?: ModuleKey;
}

export const VIEWS: Record<ViewKey, ViewDefinition> = {
  "my-chats": { label: "Mis Chats", description: "Los chats asignados a la persona", group: "service", path: "/agent/inbox" },
  "general-chat": { label: "Chat General", description: "Todos los chats de la operación, para tomarlos y contestar", group: "service", path: "/agent/chats" },
  "my-profile": { label: "Mi Perfil", description: "Su perfil y el cambio de contraseña", group: "service", path: "/agent/profile" },

  dashboard: { label: "Dashboard", description: "Las cifras del día: ventas, chats y equipo", group: "operations", path: "/" },
  inbox: { label: "Bandeja Unificada", description: "Todos los chats, con asignación y supervisión", group: "operations", path: "/inbox", module: "inbox" },
  feed: { label: "Feed de Publicaciones", description: "Comentarios públicos de Facebook e Instagram", group: "operations", path: "/feed", module: "feed" },
  email: { label: "Correo", description: "Correos de Gmail con borradores de la IA", group: "operations", path: "/email", module: "email" },
  appointments: { label: "Agenda", description: "Citas acordadas por la IA y por el equipo", group: "operations", path: "/appointments", module: "appointments" },
  orders: { label: "Pedidos", description: "Desde que dice que pagó hasta que le llega, con devoluciones y notas de crédito", group: "operations", path: "/orders", module: "orders" },
  subscriptions: { label: "Suscripciones", description: "Clientes con suscripción en Shopify: activas, pausadas, canceladas", group: "operations", path: "/subscriptions", module: "orders" },
  shipments: { label: "Despachos", description: "Viajes y couriers que descuentan el inventario", group: "operations", path: "/shipments", module: "inventory" },
  inventory: { label: "Inventario", description: "Existencias por almacén, lotes y costos", group: "operations", path: "/inventory", module: "inventory" },
  purchasing: { label: "Compras", description: "Pedidos de compra, órdenes a proveedores y recepciones", group: "operations", path: "/purchasing", module: "purchasing" },
  cases: { label: "Casos", description: "Peticiones de los clientes que hay que gestionar", group: "operations", path: "/cases", module: "cases" },
  learning: { label: "Aprendizajes", description: "Lo que la IA aprendió de chats reales", group: "operations", path: "/learning", module: "aiAgents" },
  "answer-training": { label: "Entrenar respuestas", description: "Las preguntas comunes, cómo responde hoy el agente y las respuestas que aprueba el equipo", group: "operations", path: "/answer-training", module: "aiAgents" },
  monitor: { label: "Monitor", description: "Conversaciones en vivo y salud del sistema", group: "operations", path: "/monitor", module: "monitor" },
  reports: { label: "Reportes", description: "Métricas por agente, canal, etiqueta y día", group: "operations", path: "/reports", module: "analytics" },

  contacts: { label: "Contactos", description: "Clientes, su historial y sus datos", group: "commercial", path: "/contacts", module: "crm" },
  campaigns: { label: "Marketing", description: "Envíos masivos por WhatsApp, Instagram y Facebook", group: "commercial", path: "/campaigns", module: "marketing" },
  products: { label: "Catálogo", description: "Productos, precios y SKU", group: "commercial", path: "/products", module: "catalog" },
  "custom-messages": { label: "Mensajes", description: "Bienvenidas y respuestas con botones", group: "commercial", path: "/custom-messages", module: "customMessages" },
  workflow: { label: "Workflow", description: "Enrutado por intención y escalaciones", group: "commercial", path: "/workflow", module: "automation" },

  agents: { label: "Agentes", description: "Equipo humano y agentes virtuales, con su configuración", group: "system", path: "/agents" },
  admin: { label: "Administración", description: "Usuarios del sistema y las vistas que cada uno ve", group: "system", path: "/admin" },
  logs: { label: "Errores del sistema", description: "Lo que falló en el servidor", group: "system", path: "/logs" },
  settings: { label: "Configuración", description: "Integraciones (Meta, Gmail, Shopify), tasas y plan", group: "system", path: "/settings" },
  platform: { label: "Portal Plataforma", description: "Enlace al portal del operador de la plataforma", group: "system", path: "/platform" },
};

export type RoleKey = "admin" | "agent";

// Lo que cada rol veía antes de que el acceso fuera por vista: el administrador,
// todo el panel; el agente de servicio, solo atender. Es el punto de partida de un
// usuario nuevo y lo que se sembró a quienes ya existían (2026-10-06).
export const DEFAULT_VIEWS_BY_ROLE: Record<RoleKey, readonly ViewKey[]> = {
  admin: VIEW_KEYS.filter((key) => VIEWS[key].group !== "service"),
  agent: ["my-chats", "general-chat", "my-profile"],
};

export function isViewKey(value: unknown): value is ViewKey {
  return typeof value === "string" && (VIEW_KEYS as readonly string[]).includes(value);
}

export function defaultViewsForRole(role: RoleKey): ViewKey[] {
  return [...DEFAULT_VIEWS_BY_ROLE[role]];
}

// La primera pantalla que se abre al entrar: el dashboard si lo tiene y, si no, el
// Chat General (donde aterriza un agente de servicio); de ahí en adelante, el
// orden del menú.
const HOME_ORDER: readonly ViewKey[] = ["dashboard", "general-chat", "my-chats", ...VIEW_KEYS];

/**
 * La vista donde aterriza alguien al iniciar sesión, o `null` si no tiene ninguna
 * disponible. `moduleOn` deja fuera las vistas cuyo módulo la instancia no tiene.
 */
export function homeViewFor(
  views: Iterable<string>,
  moduleOn: (module: ModuleKey) => boolean = () => true,
): ViewKey | null {
  const owned = new Set(views);
  for (const key of HOME_ORDER) {
    const module = VIEWS[key].module;
    if (owned.has(key) && (!module || moduleOn(module))) return key;
  }
  return null;
}
