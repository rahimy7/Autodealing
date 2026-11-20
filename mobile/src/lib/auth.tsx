// Who is signed in, and what the app needs to know about the dealership right after: the team
// (to assign people), Omnicanal's status (chats) and the dealer's contact details.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, clearSession, loadStored, normalizeServer, saveServer, saveSession, session, setUnauthorizedHandler, ApiError } from "./api";
import { forgetCatalog } from "./data";

export type Role = "admin" | "sales" | "service";
export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
}
export interface TeamMember {
  id: string;
  name: string;
  role: Role;
}
export interface CrmStatus {
  configured: boolean;
  connected: boolean;
  error?: string;
  me?: { agentId: number | null; name?: string; error?: string } | null;
  panelUrl?: string;
}
export interface Dealer {
  name?: string;
  phone?: string;
  phoneNumber?: string;
  email?: string;
  address?: string;
  city?: string;
}

interface AuthValue {
  ready: boolean;
  user: User | null;
  server: string;
  team: TeamMember[];
  crm: CrmStatus | null;
  dealer: Dealer;
  signIn: (server: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshTeam: () => Promise<void>;
  refreshCrm: (force?: boolean) => Promise<CrmStatus | null>;
}
const Ctx = createContext<AuthValue | null>(null);
export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
};
// Reservations, sales, quotes and web inquiries (the server checks the same: server/domain.js).
export const canSell = (u: User | null) => u?.role === "admin" || u?.role === "sales";
export const isAdmin = (u: User | null) => u?.role === "admin";
export const isService = (u: User | null) => u?.role === "service";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [server, setServer] = useState("");
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [crm, setCrm] = useState<CrmStatus | null>(null);
  const [dealer, setDealer] = useState<Dealer>({});

  const applyUser = (u: User & { csrf: string }) => {
    session.csrf = u.csrf;
    const { csrf: _csrf, ...rest } = u;
    setUser(rest);
  };
  const loadBoot = useCallback(async () => {
    const [t, c, d] = await Promise.all([
      api<TeamMember[]>("/api/admin/team").catch(() => []),
      api<CrmStatus>("/api/admin/crm/status").catch(() => null),
      api<Dealer>("/api/site").catch(() => ({})),
    ]);
    setTeam(t);
    setCrm(c);
    setDealer(d);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      forgetCatalog();
      setUser(null);
    });
    (async () => {
      const { server: stored } = await loadStored();
      setServer(stored);
      if (stored && session.token) {
        try {
          const { user: me } = await api<{ user: User & { csrf: string } }>("/api/auth/me", { quiet401: true });
          applyUser(me);
          await loadBoot();
        } catch (e) {
          // An expired session just asks for the password; a server that can't be reached keeps it.
          if (e instanceof ApiError && e.status === 401) await clearSession();
        }
      }
      setReady(true);
    })();
  }, [loadBoot]);

  const signIn = useCallback(
    async (rawServer: string, username: string, password: string) => {
      const base = normalizeServer(rawServer);
      if (!base) throw new ApiError("La dirección del servidor no es válida.");
      await saveServer(base);
      setServer(base);
      await saveSession("");
      let { user: me } = await api<{ user: User & { csrf: string } }>("/api/auth/login", { method: "POST", body: { username: username.trim(), password } });
      // Normally the session cookie is read from the answer. If this phone doesn't expose it, the
      // platform's own cookie storage carries it: ask the server who we are to be sure it did.
      if (!session.token) {
        try {
          ({ user: me } = await api<{ user: User & { csrf: string } }>("/api/auth/me", { quiet401: true }));
        } catch {
          throw new ApiError("No se pudo iniciar la sesión en este teléfono. Inténtalo de nuevo.");
        }
      }
      forgetCatalog();
      applyUser(me);
      await loadBoot();
    },
    [loadBoot],
  );

  const signOut = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST", quiet401: true });
    } catch {}
    await clearSession();
    forgetCatalog();
    setUser(null);
    setTeam([]);
    setCrm(null);
  }, []);

  const refreshTeam = useCallback(async () => setTeam(await api<TeamMember[]>("/api/admin/team").catch(() => [])), []);
  const refreshCrm = useCallback(async (force = false) => {
    const c = await api<CrmStatus>(`/api/admin/crm/status${force ? "?refresh=1" : ""}`).catch(() => null);
    setCrm(c);
    return c;
  }, []);

  const value = useMemo(
    () => ({ ready, user, server, team, crm, dealer, signIn, signOut, refreshTeam, refreshCrm }),
    [ready, user, server, team, crm, dealer, signIn, signOut, refreshTeam, refreshCrm],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
