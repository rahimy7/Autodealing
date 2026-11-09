import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db, agentsTable, viewAccessTable } from "@workspace/db";
import { VIEW_KEYS, defaultViewsForRole, isViewKey, type RoleKey, type ViewKey } from "@workspace/platform-config";
import type { AuthUser } from "./auth";
import { ENV_ADMIN_VIEWS } from "./view-gates";

type Log = { info: (obj: object, msg: string) => void };

// Las vistas de un usuario se consultan en CADA petición (el servidor las usa para
// dejar pasar o cortar), así que se guardan unos segundos en memoria. Cambiarlas
// desde Administración limpia la entrada al instante en este proceso; con varias
// instancias, la otra tarda hasta TTL_MS en enterarse.
const TTL_MS = 15_000;
const cache = new Map<number, { views: ReadonlySet<ViewKey>; at: number }>();

export function clearViewCache(agentId?: number): void {
  if (agentId === undefined) cache.clear();
  else cache.delete(agentId);
}

const toKeys = (rows: Array<{ viewKey: string }>): ViewKey[] =>
  // Una clave que ya no exista en el catálogo se ignora: quitar una pantalla del
  // panel no debe impedir el inicio de sesión de quien la tenía.
  rows.map((r) => r.viewKey).filter(isViewKey);

/** El orden del menú, no el de inserción; sin repetidas. */
export const sortViews = (views: Iterable<ViewKey>): ViewKey[] => {
  const owned = new Set(views);
  return VIEW_KEYS.filter((key) => owned.has(key));
};

/**
 * Las vistas de un usuario humano. Si no tiene ninguna fila —alguien creado por un
 * script o a mano en la base, que nunca pasó por Administración— se le siembran
 * las de su rol en ese momento, para que no entre a un panel vacío. Guardar cero
 * vistas no es posible desde Administración, así que "ninguna fila" siempre
 * significa "nunca configurado".
 */
export async function loadViews(agentId: number): Promise<ReadonlySet<ViewKey>> {
  const hit = cache.get(agentId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.views;

  let owned = toKeys(
    await db.select({ viewKey: viewAccessTable.viewKey }).from(viewAccessTable).where(eq(viewAccessTable.agentId, agentId)),
  );

  if (owned.length === 0) {
    const [agent] = await db
      .select({ role: agentsTable.role, type: agentsTable.type })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));
    // Un agente virtual no inicia sesión; y una fila borrada ya no tiene acceso.
    if (agent && agent.type === "human") {
      owned = defaultViewsForRole(agent.role);
      await db
        .insert(viewAccessTable)
        .values(owned.map((viewKey) => ({ agentId, viewKey })))
        .onConflictDoNothing();
    }
  }

  const views: ReadonlySet<ViewKey> = new Set(owned);
  cache.set(agentId, { views, at: Date.now() });
  return views;
}

/** Las vistas de quien tiene sesión: el administrador de entorno ve todas, sin fila. */
export async function viewsForUser(user: Pick<AuthUser, "agentId" | "role">): Promise<ReadonlySet<ViewKey>> {
  if (user.agentId === null) return user.role === "admin" ? ENV_ADMIN_VIEWS : new Set();
  return loadViews(user.agentId);
}

/** Deja EXACTAMENTE estas vistas al usuario: agrega las que faltan y quita las demás. */
export async function setViews(agentId: number, views: readonly ViewKey[]): Promise<ViewKey[]> {
  const next = sortViews(views);
  // Sin vistas el usuario entraría a una pantalla vacía y nadie podría ver por qué.
  if (next.length === 0) throw new Error("setViews needs at least one view");
  await db.transaction(async (tx) => {
    await tx
      .delete(viewAccessTable)
      .where(and(eq(viewAccessTable.agentId, agentId), notInArray(viewAccessTable.viewKey, next)));
    await tx
      .insert(viewAccessTable)
      .values(next.map((viewKey) => ({ agentId, viewKey })))
      .onConflictDoNothing();
  });
  clearViewCache(agentId);
  return next;
}

/** Las vistas de varios usuarios de una vez, para la pantalla de Administración. */
export async function listViewAccess(agentIds: number[]): Promise<Map<number, ViewKey[]>> {
  const out = new Map<number, ViewKey[]>(agentIds.map((id) => [id, []]));
  if (agentIds.length === 0) return out;
  const rows = await db
    .select({ agentId: viewAccessTable.agentId, viewKey: viewAccessTable.viewKey })
    .from(viewAccessTable)
    .where(inArray(viewAccessTable.agentId, agentIds));
  for (const row of rows) if (isViewKey(row.viewKey)) out.get(row.agentId)?.push(row.viewKey);
  for (const [id, keys] of out) out.set(id, sortViews(keys));
  return out;
}

/** Le da a un usuario recién creado las vistas de su rol. */
export async function grantDefaultViews(agentId: number, role: RoleKey): Promise<void> {
  await db
    .insert(viewAccessTable)
    .values(defaultViewsForRole(role).map((viewKey) => ({ agentId, viewKey })))
    .onConflictDoNothing();
  clearViewCache(agentId);
}

/**
 * Siembra, una vez, el acceso que ya tenía cada usuario humano: el administrador
 * con todo el panel y el agente con los tres chats. Solo toca a quien no tiene
 * ninguna fila, así que repetirlo (cada arranque) no pisa lo que se haya ajustado
 * desde Administración.
 */
export async function seedViewAccess(log: Log): Promise<void> {
  const humans = await db
    .select({ id: agentsTable.id, role: agentsTable.role })
    .from(agentsTable)
    .where(eq(agentsTable.type, "human"));
  if (humans.length === 0) return;

  const configured = new Set(
    (
      await db
        .select({ agentId: viewAccessTable.agentId })
        .from(viewAccessTable)
        .where(
          inArray(
            viewAccessTable.agentId,
            humans.map((h) => h.id),
          ),
        )
    ).map((r) => r.agentId),
  );

  const pending = humans.filter((h) => !configured.has(h.id));
  if (pending.length === 0) return;

  const rows = pending.flatMap((h) => defaultViewsForRole(h.role).map((viewKey) => ({ agentId: h.id, viewKey })));
  await db.insert(viewAccessTable).values(rows).onConflictDoNothing();
  clearViewCache();
  log.info({ users: pending.length, rows: rows.length }, "seeded view access from roles");
}
