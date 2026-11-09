// Configuración de plataforma: qué instancia es ésta, cómo se llama, de qué
// color es y qué módulos del core tiene encendidos.
//
// El paquete es puro (no lee archivos ni process.env por su cuenta) para que lo
// puedan usar por igual el servidor, el frontend y los scripts.
export {
  MODULE_KEYS,
  CHANNEL_MODULE_KEYS,
  MODULE_LABELS,
  type ModuleKey,
  type ChannelModuleKey,
} from "./modules";

export {
  VIEW_KEYS,
  VIEW_GROUPS,
  VIEW_GROUP_LABELS,
  VIEWS,
  DEFAULT_VIEWS_BY_ROLE,
  isViewKey,
  defaultViewsForRole,
  homeViewFor,
  type ViewKey,
  type ViewGroup,
  type ViewDefinition,
  type RoleKey,
} from "./views";

export {
  ClientConfigSchema,
  BrandingSchema,
  BusinessSchema,
  LocaleSchema,
  ModulesSchema,
  FeaturesSchema,
  defineClient,
  type ClientConfig,
  type ClientConfigInput,
  type Branding,
  type BusinessProfile,
  type Modules,
} from "./schema";

export { CLIENTS, CLIENT_IDS } from "./clients";

export {
  resolveClientConfig,
  FALLBACK_CLIENT_ID,
  type ResolvedClientConfig,
  type ClientConfigEnv,
} from "./resolve";

export { CORE_VERSION } from "./version";
