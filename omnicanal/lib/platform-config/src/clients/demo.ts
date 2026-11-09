import { defineClient } from "../schema";

// Cliente neutro para desarrollo local y demostraciones: sin marca de nadie y
// con algunos módulos apagados, para ver el efecto del gating sin tocar la
// configuración de un cliente real. Es también la plantilla que copia
// `pnpm clients:new`.
export const demo = defineClient({
  id: "demo",
  name: "Cliente Demo",
  domain: "demo.rvromnicanal.com",

  branding: {
    productName: "Omnicanal",
    tagline: "Plataforma Omnicanal",
    primaryColor: "#2563EB",
  },

  locale: {
    timezone: "America/Santo_Domingo",
    currency: "DOP",
  },

  business: {
    displayName: "Cliente Demo",
    descriptor: "empresa de ejemplo para probar la plataforma",
    country: "República Dominicana",
  },

  modules: {
    // Solo WhatsApp: las rutas de Instagram y Facebook no se montan y sus
    // secciones desaparecen del menú.
    instagram: false,
    facebook: false,
    feed: false,
    marketing: false,
  },

  features: {},
  extensions: [],
});
