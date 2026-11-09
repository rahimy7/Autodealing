// Los módulos son las superficies del core que un cliente puede tener o no.
// Encender/apagar uno cambia dos cosas a la vez: las rutas que monta el API y
// lo que aparece en el menú de la aplicación. Un módulo apagado no es "oculto":
// su endpoint deja de existir para esa instancia.
//
// Agregar un módulo es un cambio del core (se edita esta lista), no del cliente.
// Lo que cada cliente decide es cuáles enciende, en su archivo de configuración.
export const MODULE_KEYS = [
  // Canales
  "whatsapp",
  "instagram",
  "facebook",

  // Operación
  "inbox",
  "feed",
  "email",
  "crm",
  "catalog",
  "marketing",
  "customMessages",
  "automation",
  "aiAgents",
  "knowledgeBases",
  "appointments",
  "orders",
  "cases",
  // Existencias por almacén con lotes y costo PEPS, y los despachos (viajes y
  // courier) que las descuentan. Compras (pedidos de compra, órdenes a
  // proveedores y recepciones) va aparte porque hay quien lleva inventario sin
  // comprarle a nadie desde el sistema; sin inventario no tiene dónde recibir.
  "inventory",
  "purchasing",

  // Visibilidad
  "analytics",
  "monitor",

  // Extras
  "mobilePush",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

// Los tres canales de Meta, tratados como grupo en varios sitios (la píldora de
// "canales activos" del menú, el resumen del panel de control).
export const CHANNEL_MODULE_KEYS = ["whatsapp", "instagram", "facebook"] as const satisfies readonly ModuleKey[];

export type ChannelModuleKey = (typeof CHANNEL_MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook / Messenger",
  inbox: "Bandeja unificada",
  feed: "Feed de publicaciones",
  email: "Correo (Gmail)",
  crm: "CRM / Contactos",
  catalog: "Catálogo de productos",
  marketing: "Marketing y campañas",
  customMessages: "Mensajes personalizados",
  automation: "Workflows / Automatizaciones",
  aiAgents: "Agentes de IA",
  knowledgeBases: "Bases de conocimiento",
  appointments: "Agenda de citas",
  orders: "Pedidos",
  cases: "Casos / peticiones",
  inventory: "Inventario y despachos",
  purchasing: "Compras",
  analytics: "Reportes",
  monitor: "Monitor en vivo",
  mobilePush: "Notificaciones móviles",
};
