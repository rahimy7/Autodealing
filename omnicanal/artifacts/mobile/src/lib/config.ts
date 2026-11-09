import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Where the API lives. Set EXPO_PUBLIC_API_URL for real builds:
 *
 *   EXPO_PUBLIC_API_URL=https://tu-dominio.com
 *
 * Without it the app talks to the machine running the Metro bundler, which is
 * what you want while developing against `pnpm --filter @workspace/api-server dev`.
 */
function devFallbackUrl(): string {
  // `hostUri` looks like "192.168.1.20:8081" — the LAN address of the dev machine.
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? "";
  const host = hostUri.split(":")[0];
  if (host) return `http://${host}:8080`;
  // Android emulators reach the host machine through 10.0.2.2, simulators through localhost.
  return Platform.OS === "android" ? "http://10.0.2.2:8080" : "http://localhost:8080";
}

export const API_URL: string = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, "") || devFallbackUrl();

// Polling cadence, matching the web panel: the list refreshes slowly, an open
// thread quickly.
export const CONVERSATIONS_POLL_MS = 8000;
export const MESSAGES_POLL_MS = 3000;
