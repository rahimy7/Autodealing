import { defineClient } from "../schema";

// Instancia de Premier Line Motors (Paterson, NJ). Esta copia de Omnicanal vive
// dentro del proyecto del sitio web del concesionario y solo sirve a Premier.
// Lo que no se declara aquí lo pone el core por defecto. Nunca credenciales: eso
// va en las variables de la instancia o en Configuración.
export const premier = defineClient({
  id: "premier",
  name: "Premier Line Motors",
  // Pendiente: el dominio de la instancia cuando esté asignado.
  domain: null,

  branding: {
    productName: "Premier Chat",
    tagline: "Premier Line Motors",
    logoUrl: "/clients/premier/logo.png",
    // Los mismos colores que el sitio web (css/styles.css del proyecto).
    primaryColor: "#C8102E",
    secondaryColor: "#0B2A4A",
  },

  locale: {
    timezone: "America/New_York",
    currency: "USD",
  },

  business: {
    displayName: "Premier Line Motors",
    // Entra literal en los prompts del agente virtual. Es la descripción que el
    // propio sitio del concesionario usa en su título.
    descriptor: "concesionario de vehículos nuevos, certificados y eléctricos en Paterson, Nueva Jersey",
    country: "Estados Unidos",
    supportEmail: "info@premierlinemotors.com",
    supportPhone: "(201) 625-0077",
  },

  modules: {
    // El inventario de vehículos vive en el sitio web y llega a la IA como base
    // de conocimiento sincronizada; el catálogo de productos lo duplicaría.
    catalog: false,
    // Pedidos con comprobante, existencias por almacén, compras y casos son de
    // comercio y servicio postventa por paquete: un concesionario vende por
    // reserva y cita, y eso lo lleva el sitio.
    orders: false,
    inventory: false,
    purchasing: false,
    cases: false,
    // Lo que la integración con el sitio usa y no se debe apagar por descuido:
    // contactos, agenda, bases de conocimiento y reportes.
    crm: true,
    appointments: true,
    knowledgeBases: true,
    analytics: true,
  },

  features: {},
  extensions: [],
});
