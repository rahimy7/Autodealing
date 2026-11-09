import type { Ionicons } from "@expo/vector-icons";

type IconName = keyof typeof Ionicons.glyphMap;

export type NavItem = {
  icon: IconName;
  label: string;
  description: string;
  href: string;
  /**
   * La vista del panel que la abre (tabla view_access): quien no la tenga asignada
   * no la ve aquí. Sin vista, la ve todo el mundo (lo de la cuenta propia).
   */
  view?: string;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

/**
 * Todo lo que el panel web ofrece y no es una pestaña de abajo (Panel, Bandeja y
 * Contactos ya están ahí). Una sola lista para los dos sitios desde donde se
 * entra: el desplegable del inicio y la pestaña "Más". Tener dos listas era
 * garantía de que una se quedara sin la vista nueva.
 */
export const ADMIN_SECTIONS: NavSection[] = [
  {
    title: "Operación",
    items: [
      { icon: "clipboard", label: "Pedidos", description: "Desde que dice que pagó hasta que le llega", href: "/orders", view: "orders" },
      { icon: "repeat", label: "Suscripciones", description: "Clientes con suscripción en Shopify y su estado", href: "/subscriptions", view: "subscriptions" },
      { icon: "car", label: "Despachos", description: "Paradas del viaje: entregado o no entregado", href: "/shipments", view: "shipments" },
      { icon: "cube-outline", label: "Inventario", description: "Disponible, vendido sin despachar y lotes", href: "/inventory", view: "inventory" },
      { icon: "folder-open", label: "Casos", description: "Lo que piden los clientes y hay que gestionar", href: "/cases", view: "cases" },
      { icon: "calendar", label: "Agenda", description: "Citas acordadas por la IA y por el equipo", href: "/appointments", view: "appointments" },
      { icon: "mail", label: "Correo", description: "Correos de Gmail, con borradores de la IA", href: "/email", view: "email" },
      { icon: "chatbox-ellipses", label: "Comentarios", description: "Hilos públicos de Facebook e Instagram", href: "/feed", view: "feed" },
      { icon: "megaphone", label: "Campañas", description: "Envíos masivos por WhatsApp, IG y Facebook", href: "/campaigns", view: "campaigns" },
      { icon: "pulse", label: "Monitor", description: "Conversaciones en vivo y salud del sistema", href: "/monitor", view: "monitor" },
      { icon: "bar-chart", label: "Reportes", description: "Métricas por agente, canal y etiqueta", href: "/reports", view: "reports" },
    ],
  },
  {
    title: "Configuración",
    items: [
      { icon: "people-circle", label: "Agentes", description: "Equipo humano y agentes virtuales", href: "/agents", view: "agents" },
      { icon: "bulb", label: "Aprendizajes", description: "Lo que la IA aprendió de chats reales", href: "/learning", view: "learning" },
      { icon: "git-branch", label: "Flujos", description: "Enrutado por intención y escalaciones", href: "/workflows", view: "workflow" },
      { icon: "pricetags", label: "Etiquetas", description: "Intenciones que clasifica la IA", href: "/labels", view: "workflow" },
      { icon: "people", label: "Grupos", description: "Reparto de chats entre agentes", href: "/groups", view: "agents" },
      { icon: "chatbubble-ellipses", label: "Mensajes personalizados", description: "Bienvenidas y respuestas con botones", href: "/custom-messages", view: "custom-messages" },
      { icon: "cube", label: "Productos", description: "Catálogo consultado por la IA y el equipo", href: "/products", view: "products" },
      { icon: "shield-checkmark", label: "Administración", description: "Usuarios del sistema y su acceso", href: "/admin", view: "admin" },
      { icon: "warning", label: "Errores del sistema", description: "Lo que falló en el servidor, sin entrar al hosting", href: "/logs", view: "logs" },
      { icon: "settings", label: "Ajustes", description: "Integración con Meta y plan contratado", href: "/settings", view: "settings" },
    ],
  },
  {
    title: "Mi cuenta",
    items: [
      { icon: "notifications", label: "Notificaciones", description: "Permisos y prueba de envío", href: "/notifications" },
      { icon: "key", label: "Cambiar contraseña", description: "Solo para cuentas con agente asociado", href: "/change-password" },
    ],
  },
];

/** Las secciones del menú sin lo que el usuario no tiene asignado, y sin las que se quedan vacías. */
export function visibleSections(hasView: (view: string) => boolean): NavSection[] {
  return ADMIN_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.view || hasView(item.view)),
  })).filter((section) => section.items.length > 0);
}
