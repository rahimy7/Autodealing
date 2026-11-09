/**
 * Consola de clientes de la plataforma.
 *
 *   pnpm clients:list            inventario de instancias y sus módulos
 *   pnpm clients:show <id>       la configuración completa de una instancia
 *   pnpm clients:new <id>        da de alta un cliente y deja su plantilla lista
 *   pnpm clients:env <id>        variables de entorno que hay que cargar al desplegar
 *
 * Es la primera pieza del "centro de control": todavía se opera desde la
 * terminal, pero ya lee la misma fuente única de verdad que usarán el servidor y
 * una consola web más adelante.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLIENTS,
  CLIENT_IDS,
  CORE_VERSION,
  MODULE_KEYS,
  MODULE_LABELS,
  type ClientConfig,
  type ModuleKey,
} from "@workspace/platform-config";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIENTS_DIR = path.join(ROOT, "lib", "platform-config", "src", "clients");
const REGISTRY_FILE = path.join(CLIENTS_DIR, "index.ts");

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function moduleSummary(config: ClientConfig): { on: ModuleKey[]; off: ModuleKey[] } {
  const on: ModuleKey[] = [];
  const off: ModuleKey[] = [];
  for (const key of MODULE_KEYS) {
    (config.modules[key] ? on : off).push(key);
  }
  return { on, off };
}

function list(): void {
  console.log(`\n  Core ${CORE_VERSION} · ${CLIENT_IDS.length} cliente(s)\n`);

  for (const id of CLIENT_IDS) {
    const config = CLIENTS[id];
    const { off } = moduleSummary(config);
    console.log(`  ${id.padEnd(16)} ${config.name}`);
    console.log(`  ${"".padEnd(16)} dominio: ${config.domain ?? "—"}`);
    console.log(
      `  ${"".padEnd(16)} módulos: ${off.length === 0 ? "todos" : `todos menos ${off.join(", ")}`}`,
    );
    if (config.extensions.length > 0) {
      console.log(`  ${"".padEnd(16)} extensiones: ${config.extensions.join(", ")}`);
    }
    console.log();
  }
}

function show(id: string): void {
  const config = CLIENTS[id];
  if (!config) fail(`No existe el cliente "${id}". Disponibles: ${CLIENT_IDS.join(", ")}`);

  console.log(`\n  ${config.name} (${config.id}) · core ${CORE_VERSION}\n`);
  console.log(`  Dominio      ${config.domain ?? "—"}`);
  console.log(`  Producto     ${config.branding.productName} — ${config.branding.tagline}`);
  console.log(`  Colores      principal ${config.branding.primaryColor ?? "tema del core"}`);
  console.log(`  Zona horaria ${config.locale.timezone}`);
  console.log(`  Negocio      ${config.business.displayName}`);
  console.log();

  for (const key of MODULE_KEYS) {
    console.log(`  ${config.modules[key] ? "🟢" : "⚪️"} ${MODULE_LABELS[key]}`);
  }
  console.log();
}

function envTemplate(config: ClientConfig): string {
  return [
    `# Variables de la instancia de ${config.name}.`,
    "# Se cargan en el panel del proveedor (Railway → Variables), nunca en el repositorio.",
    "",
    `CLIENT_ID=${config.id}`,
    "",
    "# Base de datos exclusiva de este cliente.",
    "DATABASE_URL=",
    "",
    "# Firma las sesiones. Un valor distinto por instancia, largo y aleatorio.",
    "SESSION_SECRET=",
    "",
    "# Administrador inicial de esta instancia.",
    "ADMIN_EMAIL=",
    "ADMIN_PASSWORD=",
    "",
    "# IA (opcional: sin la clave, la instancia funciona sin respuestas automáticas).",
    "AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1",
    "AI_INTEGRATIONS_OPENAI_API_KEY=",
    "",
    "# Opcionales.",
    "LOG_LEVEL=info",
    `APP_TIMEZONE=${config.locale.timezone}`,
    "",
    "# Las credenciales de Meta NO son variables: el administrador las guarda desde",
    "# la página de Configuración y quedan en la base de datos de esta instancia.",
    "",
  ].join("\n");
}

function env(id: string): void {
  const config = CLIENTS[id];
  if (!config) fail(`No existe el cliente "${id}". Disponibles: ${CLIENT_IDS.join(", ")}`);
  console.log(envTemplate(config));
}

function configTemplate(id: string, name: string): string {
  const varName = id.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());

  return `import { defineClient } from "../schema";

// Instancia de ${name}. Lo que no se declara aquí lo pone el core por defecto,
// así que este archivo solo debería contener lo que este cliente tiene de
// particular. Nunca credenciales: eso va en las variables de la instancia.
export const ${varName} = defineClient({
  id: "${id}",
  name: "${name}",
  domain: null,

  branding: {
    productName: "${name}",
    tagline: "Plataforma Omnicanal",
    // logoUrl: "/logos/${id}.png",
    // primaryColor: "#2563EB",
    // secondaryColor: "#111827",
  },

  business: {
    displayName: "${name}",
    descriptor: "",
    country: "República Dominicana",
  },

  // Apaga aquí lo que este cliente no contrató, por ejemplo:
  // modules: { instagram: false, marketing: false },
  modules: {},

  features: {},
  extensions: [],
});
`;
}

/**
 * Agrega el cliente al registro: import, entrada en CLIENTS y re-export.
 *
 * Se ubica cada punto por su forma y no por un texto fijo, para que el comando
 * sirva igual con dos clientes que con cincuenta. Devuelve `null` si el archivo
 * dejó de tener la estructura esperada, y entonces se edita a mano.
 */
function addToRegistry(registry: string, id: string, varName: string): string | null {
  const lines = registry.split("\n");

  // 1. El import, después del último import de un cliente.
  const lastClientImport = lines.reduce(
    (found, line, index) => (/^import \{ \w+ \} from "\.\/[a-z0-9-]+";$/.test(line) ? index : found),
    -1,
  );
  if (lastClientImport === -1) return null;
  lines.splice(lastClientImport + 1, 0, `import { ${varName} } from "./${id}";`);

  // 2. La entrada, antes del cierre del objeto CLIENTS.
  const clientsStart = lines.findIndex((line) => line.startsWith("export const CLIENTS"));
  if (clientsStart === -1) return null;
  const clientsEnd = lines.findIndex((line, index) => index > clientsStart && line === "};");
  if (clientsEnd === -1) return null;
  lines.splice(clientsEnd, 0, `  [${varName}.id]: ${varName},`);

  // 3. El re-export, al final de la lista que ya está.
  const reExport = lines.findIndex((line) => /^export \{ .+ \};$/.test(line));
  if (reExport === -1) return null;
  lines[reExport] = lines[reExport].replace(/ \};$/, `, ${varName} };`);

  return lines.join("\n");
}

async function create(id: string, nameArg?: string): Promise<void> {
  if (!ID_PATTERN.test(id)) {
    fail(`"${id}" no sirve como identificador. Usa minúsculas, números y guiones (premier-motors).`);
  }
  if (CLIENTS[id]) fail(`El cliente "${id}" ya existe: lib/platform-config/src/clients/${id}.ts`);

  const name = nameArg?.trim() || id;
  const target = path.join(CLIENTS_DIR, `${id}.ts`);
  if (existsSync(target)) fail(`Ya hay un archivo en ${path.relative(ROOT, target)}.`);

  const varName = id.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());

  const registry = await readFile(REGISTRY_FILE, "utf8");
  const updated = addToRegistry(registry, id, varName);

  if (updated === null) {
    fail(
      "No se pudo editar lib/platform-config/src/clients/index.ts automáticamente " +
        "(cambió su forma). Agrega el cliente a mano: import, entrada en CLIENTS y re-export.",
    );
  }

  await writeFile(target, configTemplate(id, name), "utf8");
  await writeFile(REGISTRY_FILE, updated, "utf8");

  console.log(`\n✓ Cliente "${id}" dado de alta.\n`);
  console.log(`  Configuración   ${path.relative(ROOT, target)}`);
  console.log(`  Registro        ${path.relative(ROOT, REGISTRY_FILE)}\n`);
  console.log("  Siguientes pasos:");
  console.log(`   1. Ajusta marca y módulos en ${path.relative(ROOT, target)}`);
  console.log("   2. pnpm typecheck");
  console.log("   3. Crea el servicio y su base de datos en Railway (ver PLATFORM.md)");
  console.log(`   4. Carga las variables: pnpm clients:env ${id}`);
  console.log();
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "list":
    case undefined:
      list();
      return;
    case "show":
      if (!args[0]) fail("Falta el identificador: pnpm clients:show <id>");
      show(args[0]);
      return;
    case "env":
      if (!args[0]) fail("Falta el identificador: pnpm clients:env <id>");
      env(args[0]);
      return;
    case "new":
      if (!args[0]) fail("Falta el identificador: pnpm clients:new <id> [\"Nombre del cliente\"]");
      await create(args[0], args[1]);
      return;
    default:
      fail(`Comando desconocido "${command}". Usa: list | show <id> | env <id> | new <id>`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
