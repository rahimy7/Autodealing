// The API client. The app talks to the same server and endpoints as the panel and the web
// version of the app. The session is the `premier_sid` cookie the login sets; it is read from
// the response and sent by hand on every request (and with the photos), so it doesn't depend on
// how each platform keeps cookies, and it is kept in the phone's secure storage.
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const SERVER_KEY = "premier.server";
const SESSION_KEY = "premier.session";

export const DEFAULT_SERVER: string = String(process.env.EXPO_PUBLIC_API_URL || (Constants.expoConfig?.extra as any)?.apiUrl || "").trim();
export const session = { base: "", token: "", csrf: "" };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

// "premierlinemotors.com" → https://…; a LAN address or localhost → http://…
export function normalizeServer(input: string): string {
  let u = input.trim().replace(/\/+$/, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u) ? "http://" : "https://") + u;
  try {
    const parsed = new URL(u);
    return parsed.origin;
  } catch {
    return "";
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function loadStored() {
  const [server, token] = await Promise.all([
    AsyncStorage.getItem(SERVER_KEY).catch(() => null),
    SecureStore.getItemAsync(SESSION_KEY).catch(() => null),
  ]);
  session.base = normalizeServer(server || DEFAULT_SERVER);
  session.token = token || "";
  return { server: session.base };
}
export async function saveServer(server: string) {
  session.base = server;
  await AsyncStorage.setItem(SERVER_KEY, server).catch(() => {});
}
export async function saveSession(token: string) {
  session.token = token;
  if (token) await SecureStore.setItemAsync(SESSION_KEY, token).catch(() => {});
  else await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
}
export function clearSession() {
  session.csrf = "";
  return saveSession("");
}

type Options = { method?: string; body?: unknown; form?: FormData; timeout?: number; quiet401?: boolean };

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  if (!session.base) throw new ApiError("Escribe la dirección del servidor.");
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (session.token) headers.Cookie = `premier_sid=${session.token}`;
  if (session.csrf) headers["X-CSRF-Token"] = session.csrf;
  let body: any;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? 25_000);
  let res: Response;
  try {
    res = await fetch(session.base + path, { method, headers, body, signal: controller.signal, credentials: session.token ? "omit" : "include" });
  } catch {
    throw new ApiError("No se pudo conectar con el servidor. Comprueba tu conexión.");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) throw new ApiError("Respuesta inesperada del servidor.", res.status);
  }
  if (!res.ok) {
    if (res.status === 401 && !opts.quiet401 && path !== "/api/auth/login") onUnauthorized();
    throw new ApiError(data?.error || "No se pudo completar la operación.", res.status);
  }
  // The login answers with the session cookie.
  const cookie = res.headers.get("set-cookie") || "";
  const m = /premier_sid=([0-9a-f]{64})/.exec(cookie);
  if (m && m[1] !== session.token) await saveSession(m[1]);
  return data as T;
}

// An image or file behind the session (photos, chat attachments).
export const asset = (path: string) => ({
  uri: /^https?:/i.test(path) ? path : session.base + path,
  headers: session.token ? { Cookie: `premier_sid=${session.token}` } : undefined,
});
export const publicUrl = (path: string) => session.base + path;
