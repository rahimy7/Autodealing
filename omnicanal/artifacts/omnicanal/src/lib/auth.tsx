import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import { setAuthTokenGetter, getCurrentUser } from "@workspace/api-client-react";
import { VIEWS, homeViewFor, type ModuleKey } from "@workspace/platform-config";

export type Role = "admin" | "agent";

// El Chat General: donde contesta el agente de servicio, que desde ahí toma y
// responde. Está aquí y no en App.tsx porque el login y los avisos también lo
// necesitan.
export const AGENT_HOME = VIEWS["general-chat"].path;

/**
 * A dónde se va al entrar: la primera vista que el usuario tiene (el dashboard si
 * lo tiene; si no, el Chat General o la primera del menú). `/` cuando no tiene
 * ninguna disponible, que es donde se le explica por qué no ve nada.
 */
export function homePathFor(views: Iterable<string>, moduleOn?: (module: ModuleKey) => boolean): string {
  const home = homeViewFor(views, moduleOn);
  return home ? VIEWS[home].path : "/";
}

/**
 * Dónde se abre un chat al pulsar un aviso: quien atiende desde el Chat General lo
 * abre ahí y un supervisor, en la bandeja del panel. Con las vistas sueltas, el
 * que no tenga una usa la otra.
 */
export function chatInboxPath(role: Role, views: ReadonlySet<string>): string {
  if (role === "agent" && views.has("general-chat")) return AGENT_HOME;
  if (views.has("inbox")) return "/inbox";
  if (views.has("general-chat")) return AGENT_HOME;
  if (views.has("my-chats")) return VIEWS["my-chats"].path;
  return "/";
}

export interface AuthUser {
  role: Role;
  name: string;
  email: string;
  agentId?: number | null;
  avatar?: string;
  /**
   * Vistas del panel que puede abrir, venga del rol que venga. Una sesión guardada
   * antes de que existiera el acceso por vista no la trae: hasta que /auth/me
   * responda no se sabe qué ve, y el panel espera en vez de cerrarle todo.
   */
  views?: string[];
}

interface Session {
  token: string;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  /** Vistas que el usuario puede abrir. Vacío mientras `viewsLoaded` sea falso. */
  views: ReadonlySet<string>;
  /** Falso solo para una sesión vieja que aún no pidió sus vistas al servidor. */
  viewsLoaded: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  /** Vuelve a pedirle al servidor quién es y qué vistas tiene. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "omniai_session";

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

// Module-level token so the fetch layer can read the current value synchronously,
// before React renders. Every API call attaches it as `Authorization: Bearer …`.
let currentToken: string | null = readSession()?.token ?? null;
setAuthTokenGetter(() => currentToken);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readSession());

  useEffect(() => {
    currentToken = session?.token ?? null;
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  }, [session]);

  // Drop a stale/expired token on boot so the user lands on the login page
  // instead of hitting 401s on every query. La misma respuesta trae las vistas
  // vigentes, así que también es lo que completa una sesión guardada antes de que
  // el acceso fuera por vista.
  useEffect(() => {
    if (!session) return;
    getCurrentUser()
      .then(applyFresh)
      .catch(() => setSession(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si un administrador le cambia las vistas a esta persona, las nuevas llegan al
  // volver a la pestaña o a más tardar en un minuto, sin cerrar sesión. Un fallo
  // aquí no cierra nada: una red caída no es una sesión vencida.
  const signedIn = session !== null;
  useEffect(() => {
    if (!signedIn) return;
    const refresh = () => {
      if (document.visibilityState === "visible") getCurrentUser().then(applyFresh).catch(() => {});
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  // Pone al día lo que el servidor sabe del usuario sin tocar la sesión si nada cambió.
  function applyFresh(fresh: AuthUser) {
    setSession((current) => {
      if (!current) return current;
      const { views, name, role } = fresh;
      const same =
        current.user.name === name &&
        current.user.role === role &&
        current.user.views?.join() === views?.join();
      return same ? current : { ...current, user: { ...current.user, name, role, views } };
    });
  }

  const refresh = () =>
    getCurrentUser()
      .then(applyFresh)
      .catch(() => {});

  const views = useMemo<ReadonlySet<string>>(() => new Set(session?.user.views ?? []), [session]);

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        token: session?.token ?? null,
        views,
        viewsLoaded: !session || session.user.views !== undefined,
        refresh,
        // The token is set here, not only in the effect above: a provider's
        // effect runs *after* its children's, so the screens mounted by the
        // post-login redirect would otherwise fire their first requests —
        // including the presence heartbeat — with no Authorization header.
        login: (token, user) => {
          currentToken = token;
          setSession({ token, user });
        },
        logout: () => {
          currentToken = null;
          setSession(null);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
