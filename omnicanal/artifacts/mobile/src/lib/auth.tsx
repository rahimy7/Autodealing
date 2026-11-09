import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { setAuthTokenGetter, setBaseUrl, getCurrentUser, logout as logoutRequest } from "@workspace/api-client-react";
import { API_URL } from "./config";

export type Role = "admin" | "agent";

export interface AuthUser {
  role: Role;
  name: string;
  email: string;
  agentId?: number | null;
  /**
   * Vistas del panel que el usuario puede abrir (las asigna un administrador, sea
   * cual sea su rol). Una sesión guardada antes de que existiera no la trae: hasta
   * que el servidor conteste se muestra todo y es él quien corta lo que no toque.
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
  /** False until the stored session has been read back from the keychain. */
  ready: boolean;
  signIn: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
}

const STORAGE_KEY = "omniai_session";

// The fetch layer reads the token synchronously, before React renders anything,
// so it lives at module scope exactly like the web app's copy does.
let currentToken: string | null = null;
setBaseUrl(API_URL);
setAuthTokenGetter(() => currentToken);

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function readSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  // Set by the push layer so signing out can drop this device from the registry
  // before the token stops being valid.
  const cleanupRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await readSession();
      if (cancelled) return;
      currentToken = stored?.token ?? null;
      setSession(stored);
      setReady(true);

      // Tokens last 12 hours: drop a stale one on boot so the user lands on the
      // login screen instead of watching every screen fail with a 401.
      if (stored) {
        try {
          const fresh = await getCurrentUser();
          if (cancelled) return;
          // Las vistas vigentes: si le cambiaron el acceso desde la última vez, se
          // enteran aquí sin cerrar sesión.
          if (fresh.views.join() !== stored.user.views?.join()) {
            const next = { ...stored, user: { ...stored.user, views: fresh.views } };
            await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
            setSession(next);
          }
        } catch {
          if (cancelled) return;
          currentToken = null;
          await SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => {});
          setSession(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (next: Session) => {
    currentToken = next.token;
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const signOut = useCallback(async () => {
    // Unregister the device while the token still authenticates the call.
    if (cleanupRef.current) {
      await cleanupRef.current().catch(() => {});
    }
    // Same window: drop the presence heartbeat so the roster stops showing this
    // agent as connected instead of waiting for it to go stale.
    await logoutRequest().catch(() => {});
    currentToken = null;
    await SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => {});
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      token: session?.token ?? null,
      ready,
      signIn,
      signOut,
    }),
    [session, ready, signIn, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      <SignOutCleanupContext.Provider value={cleanupRef}>{children}</SignOutCleanupContext.Provider>
    </AuthContext.Provider>
  );
}

const SignOutCleanupContext = createContext<{ current: (() => Promise<void>) | null } | null>(null);

/** Lets the push layer hook a teardown step into `signOut`. */
export function useSignOutCleanup() {
  return useContext(SignOutCleanupContext);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}

/**
 * La pantalla a la que se entra: para el administrador, la primera pestaña que
 * tenga asignada y, si no tiene ninguna, "Más", que lleva a lo demás.
 */
export function homeRoute(user: AuthUser): string {
  if (user.role !== "admin") return "/home";
  const has = (view: string) => !user.views || user.views.includes(view);
  if (has("dashboard")) return "/dashboard";
  if (has("inbox")) return "/inbox";
  if (has("contacts")) return "/contacts";
  return "/more";
}

/** Si el usuario tiene asignada esa vista del panel. Sin lista todavía, sí: ver AuthUser.views. */
export function useHasView() {
  const { user } = useAuth();
  const views = user?.views;
  return useCallback((view: string) => !views || views.includes(view), [views]);
}
