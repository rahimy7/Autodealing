import { z } from "zod";
import { MODULE_KEYS, type ModuleKey } from "./modules";

// ⚠️ Esta configuración viaja al navegador (la sirve GET /api/config) y va
// dentro de la imagen de Docker. Es identidad y forma del producto, nunca
// secretos: tokens de Meta, claves de OpenAI, contraseñas y DATABASE_URL viven
// en variables de entorno o en la base de datos de cada instancia.

const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Usa un color hexadecimal de 6 dígitos, por ejemplo #E11D48");

/** Un color de marca opcional: `null` significa "usa el tema del core". */
const BrandColor = HexColor.nullable().default(null);

export const BrandingSchema = z
  .object({
    /** Nombre del producto tal como lo ve el usuario del cliente. */
    productName: z.string().min(1).default("OmniAI"),
    /** Bajada corta debajo del nombre, en el menú lateral. */
    tagline: z.string().default("Plataforma Omnicanal"),
    /** Ruta o URL del logo. `null` usa el isotipo por defecto del core. */
    logoUrl: z.string().nullable().default(null),
    /** Ruta o URL del favicon. `null` deja el del core. */
    faviconUrl: z.string().nullable().default(null),
    /** Color principal (botones, estado activo del menú, foco). */
    primaryColor: BrandColor,
    /** Color secundario, reservado a cabeceras y piezas de marca. */
    secondaryColor: BrandColor,
    /** Color de acento para gráficos y realces. */
    accentColor: BrandColor,
    /** Fondo de las pantallas; bordes y fondos apagados se derivan de él. */
    backgroundColor: BrandColor,
    /** Color del texto sobre ese fondo; el texto secundario se deriva de él. */
    textColor: BrandColor,
  })
  .default({});

export const LocaleSchema = z
  .object({
    /** Zona horaria con la que la IA razona sobre "hoy" y las horas. */
    timezone: z.string().default("America/Santo_Domingo"),
    /** Idioma de la interfaz (hoy el core solo trae español). */
    language: z.string().default("es"),
    /** Moneda para precios y reportes. */
    currency: z.string().default("DOP"),
  })
  .default({});

export const BusinessSchema = z
  .object({
    /** Cómo se presenta el negocio ante el cliente final. Alimenta los prompts. */
    displayName: z.string().min(1).default("la empresa"),
    /** A qué se dedica, en una frase. Se inserta entre paréntesis en los prompts. */
    descriptor: z.string().default(""),
    /** País donde opera, para el contexto de la IA. */
    country: z.string().default(""),
    website: z.string().nullable().default(null),
    supportEmail: z.string().nullable().default(null),
    supportPhone: z.string().nullable().default(null),
    /**
     * Número de WhatsApp (formato Meta, solo dígitos con código de país, sin
     * "+") al que se avisa cada pedido nuevo: comprobante, producto, cantidad,
     * dirección y datos del cliente. `null` no manda ningún aviso — el pedido
     * sigue creándose igual, solo que nadie se entera fuera del panel.
     */
    orderNotificationPhone: z.string().nullable().default(null),
    /**
     * Las etapas del pedido que se le avisan al CLIENTE por correo (decisión del
     * 2026-10-04: los avisos van por correo, nunca por WhatsApp, para no romper
     * la regla de que el bot no escribe dos veces ni manda plantillas solo).
     * `confirmed` = pago confirmado, en preparación; `dispatched` = salió (con el
     * courier y la guía); `delivered`; `cancelled`; `refund` = devolución
     * recibida o nota de crédito emitida. Un pedido sin correo no se avisa: queda
     * la nota para el equipo. Lista vacía apaga los avisos.
     */
    orderEmails: z
      .object({
        stages: z
          .array(z.enum(["confirmed", "dispatched", "delivered", "cancelled", "refund"]))
          .default(["confirmed", "dispatched", "delivered", "cancelled", "refund"]),
      })
      .default({}),
    /**
     * Persona por perfil (`sales`, `support`, `reservations`, `qualifier`,
     * `general`) para reemplazar la del core. El core trae una redacción neutra
     * que sirve a cualquier rubro; un cliente con vocabulario propio —quien
     * vende pintura pregunta por la superficie y el tipo de soporte— pone aquí
     * su versión y sustituye la del core para ese perfil.
     *
     * Es el prompt de rol, no las reglas de conducta: la escalación a humano y
     * el resto del comportamiento común siguen viniendo del core.
     */
    aiPrompts: z.record(z.string()).default({}),
    /**
     * Lo que se le dice al cliente cuando su conversación pasa a una persona, por
     * motivo. `null` usa el aviso neutro del core ("un asesor te atenderá en
     * breve"). Ver handoffNotice en api-server/src/lib/branches.ts.
     */
    handoffNotices: z
      .object({
        /** Escala un agente que vende (perfiles sales, winback, qualifier). */
        sales: z.string().nullable().default(null),
        /** Escala cualquier otro agente: atención, post-venta, general, agenda. */
        service: z.string().nullable().default(null),
        /** El cliente cerró un pedido y dice haber pagado (PEDIDO_CONFIRMADO). */
        order: z.string().nullable().default(null),
        /**
         * Sustituye a `sales` y `service` cuando el traspaso cae en sábado o
         * domingo (regla del 2026-09-20): un negocio que atiende de lunes a
         * viernes no puede prometer "en breve" un fin de semana. `null` —lo
         * normal en un negocio que atiende todos los días— deja el aviso de
         * siempre. No aplica a `order`, que no promete atención sino que
         * confirma el pedido.
         */
        weekend: z.string().nullable().default(null),
      })
      .default({}),
    /**
     * Imágenes fijas del negocio que los agentes virtuales pueden enviar por chat
     * cuando hacen falta: las cuentas para transferir, una lista de precios, un
     * mapa. La clave es lo que el agente escribe en la marca `[[IMAGEN:clave]]`.
     *
     * `url` es absoluta o una ruta del panel (`/clients/<id>/archivo.jpg`, en
     * `artifacts/omnicanal/public`); una ruta se completa con PUBLIC_BASE_URL o el
     * dominio público de Railway, porque Meta descarga la imagen desde su URL.
     */
    agentImages: z
      .record(
        z.string().regex(/^[a-z0-9-]+$/, "La clave de la imagen va en minúsculas, números y guiones, por ejemplo 'cuentas'"),
        z.object({
          url: z.string().min(1),
          /** Cuándo enviarla, dicho para el agente ("las cuentas de BanReservas…"). */
          description: z.string().min(1),
          /** Pie de la imagen. Conviene repetir ahí lo que el cliente tenga que copiar. */
          caption: z.string().nullable().default(null),
          /**
           * Dónde va respecto del texto del agente. `after` (lo de siempre): el texto y
           * luego la imagen, para mensajes que terminan señalándola ("te dejo la
           * cuenta"). `before`: la imagen primero; en WhatsApp viaja con el texto como
           * pie, en una sola burbuja, y en Instagram/Messenger va delante del texto.
           */
          placement: z.enum(["before", "after"]).default("after"),
        }),
      )
      .default({}),
    /**
     * Si el agente virtual se presenta con su nombre ("Hola, soy Sofía"). Donde la
     * conversación pasa de un agente a otro según la intención de cada mensaje, el
     * cliente ve un nombre distinto en cada traspaso: con `false` ninguno se
     * presenta y para el cliente hay un solo chat del negocio.
     */
    agentsIntroduceByName: z.boolean().default(true),
    /**
     * Cuántas fotos de producto ([[FOTO:…]]) puede llevar una respuesta del agente
     * virtual. 1 (lo de siempre) evita ráfagas en un catálogo de cientos de
     * productos; un concesionario, que vende con la foto de cada unidad, enseña
     * dos o tres opciones a la vez cuando le preguntan qué tiene.
     */
    photosPerReply: z.number().int().min(1).max(5).default(1),
  })
  .default({});

const moduleShape = Object.fromEntries(
  MODULE_KEYS.map((key) => [key, z.boolean().default(true)]),
) as Record<ModuleKey, z.ZodDefault<z.ZodBoolean>>;

/** Todos los módulos vienen encendidos: un cliente nuevo recibe el core completo. */
export const ModulesSchema = z.object(moduleShape).default({});

/**
 * Banderas de grano fino que leen los módulos y las extensiones. A diferencia de
 * `modules`, el core no fija la lista: cada extensión documenta las suyas
 * (`quotation.requireApproval`, `abandonedCart.enabled`…). Lo que el core no
 * reconoce simplemente lo ignora.
 */
export const FeaturesSchema = z.record(z.boolean()).default({});

export const ClientConfigSchema = z.object({
  /** Identificador estable. Es el valor de la variable CLIENT_ID de la instancia. */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Usa minúsculas, números y guiones, por ejemplo 'premier-motors'"),
  /** Nombre del cliente para consolas internas y logs. */
  name: z.string().min(1),
  /** Dominio principal de la instancia, solo informativo (inventario y documentación). */
  domain: z.string().nullable().default(null),
  branding: BrandingSchema,
  locale: LocaleSchema,
  business: BusinessSchema,
  modules: ModulesSchema,
  features: FeaturesSchema,
  /** Paquetes de `lib/extensions/*` habilitados para este cliente. */
  extensions: z.array(z.string()).default([]),
});

export type ClientConfig = z.infer<typeof ClientConfigSchema>;
export type ClientConfigInput = z.input<typeof ClientConfigSchema>;
export type Branding = ClientConfig["branding"];
export type BusinessProfile = ClientConfig["business"];
export type Modules = ClientConfig["modules"];

/**
 * Declara la configuración de un cliente. Valida y rellena todo lo que no se
 * especifique, así que un archivo de cliente solo contiene lo que ese cliente
 * tiene de particular.
 */
export function defineClient(input: ClientConfigInput): ClientConfig {
  const parsed = ClientConfigSchema.safeParse(input);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  · ${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Configuración de cliente inválida${input?.id ? ` (${input.id})` : ""}:\n${detail}`,
    );
  }

  return parsed.data;
}
