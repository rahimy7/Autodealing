import { DEFAULT_VIEWS_BY_ROLE, type ViewKey } from "@workspace/platform-config";

// Qué vistas abren cada grupo de endpoints (2026-10-06). Es la contraparte en el
// servidor de la tabla `view_access`: sin ella, ocultar una pantalla en el menú
// sería solo cosmético y bastaría escribir la URL de la API.
//
// Cada entrada es un prefijo de ruta y las vistas que lo necesitan, y alcanza con
// tener UNA de ellas: un endpoint que sirve a varias pantallas (los contactos los
// consultan Pedidos, Casos, Agenda…) lo abre cualquiera de ellas. Gana el prefijo
// más largo, así `/settings/whatsapp` (que también usan la Bandeja y Marketing)
// puede ser más permisivo que `/settings`, que lleva las credenciales.
//
// Lo que no está aquí lo puede usar cualquier usuario con sesión: es lo que el
// agente de servicio ya usaba para atender (conversaciones, mensajes, catálogo en
// lectura, pedidos del chat…). Una vista nueva con endpoints propios agrega aquí su
// prefijo; si no, quedaría abierta a todo el que tenga sesión.
export const VIEW_GATES: ReadonlyArray<readonly [prefix: string, views: readonly ViewKey[]]> = [
  ["/contacts", ["contacts", "inbox", "orders", "cases", "appointments", "campaigns", "email"]],
  ["/contact-facts", ["contacts"]],
  ["/campaigns", ["campaigns"]],
  ["/labels", ["inbox", "workflow"]],
  ["/workflows", ["workflow"]],
  ["/knowledge-bases", ["agents", "admin"]],
  ["/groups", ["agents", "admin"]],
  ["/capabilities", ["agents", "admin"]],
  ["/plan", ["dashboard", "settings"]],
  ["/analytics", ["dashboard", "reports"]],
  ["/settings", ["settings"]],
  // Los números de WhatsApp y la cuenta de Gmail los eligen también la Bandeja,
  // Marketing y Correo, que no tocan las demás credenciales de Configuración.
  ["/settings/whatsapp", ["settings", "inbox", "campaigns"]],
  ["/settings/gmail", ["settings", "email"]],
  ["/feed", ["feed"]],
  ["/email", ["email", "contacts"]],
  ["/custom-messages", ["custom-messages"]],
  ["/logs", ["logs"]],
  ["/agent-lessons", ["learning"]],
  ["/answer-training", ["answer-training"]],
  // Inventario, despachos, compras y postventa: costos y existencias.
  ["/warehouses", ["inventory", "shipments", "purchasing"]],
  ["/inventory", ["inventory", "orders", "shipments", "purchasing"]],
  ["/shipments", ["shipments", "orders", "inventory"]],
  ["/carriers", ["shipments", "orders"]],
  // Etiquetas y franqueo de USPS: se compran desde un despacho.
  ["/usps", ["shipments", "orders"]],
  // Etiquetas de un pedido de Shopify, compradas con Shopify Shipping.
  ["/shopify-labels", ["shipments", "orders"]],
  ["/products/manage", ["products", "inventory"]],
  ["/suppliers", ["purchasing", "inventory"]],
  ["/purchasing", ["purchasing"]],
  ["/returns", ["orders"]],
  ["/credit-notes", ["orders"]],
  // Los suscriptores de Shopify, con sus correos y teléfonos.
  ["/subscriptions", ["subscriptions"]],
  // Quién ve qué se decide desde Administración.
  ["/view-access", ["admin"]],
];

// El prefijo más largo primero, para que `find` devuelva la regla más específica.
const SORTED_GATES = [...VIEW_GATES].sort((a, b) => b[0].length - a[0].length);

/**
 * Las vistas que abren `path`, o `null` si el endpoint no está reservado a ninguna
 * (lo puede usar cualquier usuario con sesión). El prefijo tiene que coincidir
 * entero: `/contactsX` no es `/contacts`.
 */
export function viewsForPath(path: string): readonly ViewKey[] | null {
  const gate = SORTED_GATES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return gate ? gate[1] : null;
}

/**
 * Lo que ve el administrador de entorno, que no tiene fila de agente ni, por eso,
 * filas en view_access: todo el panel. Las vistas de atención (Mis Chats, Chat
 * General, Mi Perfil) no, porque necesitan un agente detrás y no tendría qué mostrar.
 */
export const ENV_ADMIN_VIEWS: ReadonlySet<ViewKey> = new Set(DEFAULT_VIEWS_BY_ROLE.admin);

export function hasAnyView(owned: ReadonlySet<string> | undefined, needed: readonly ViewKey[]): boolean {
  return !!owned && needed.some((view) => owned.has(view));
}
