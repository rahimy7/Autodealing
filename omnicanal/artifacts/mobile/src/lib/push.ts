import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  registerDevice,
  unregisterDevice,
  getListConversationsQueryKey,
  getListMessagesQueryKey,
} from "@workspace/api-client-react";
import { useAuth, useSignOutCleanup } from "./auth";

export type PushData = {
  type?: "message" | "assignment" | "test";
  conversationId?: number;
  channel?: string;
};

// A notification that lands while the app is open still shows up: an agent
// looking at the contact list has to notice a new chat without switching away.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("messages", {
    name: "Mensajes y asignaciones",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#0FB3AE",
    sound: "default",
  });
}

export type PushRegistration =
  | { status: "granted"; token: string; platform: "ios" | "android" }
  | { status: "denied" }
  | { status: "unsupported"; reason: string };

/**
 * Asks for permission and reads this device's NATIVE push token — the FCM
 * registration token on Android, the hex APNs token on iOS. Nothing is minted
 * through a third party: the token comes straight from the OS and the server
 * talks to Google and Apple directly.
 *
 * Returns a descriptive result instead of throwing, because "no funciona en el
 * simulador" is something the profile screen has to be able to explain.
 */
export async function requestPushToken(): Promise<PushRegistration> {
  await ensureAndroidChannel();

  if (!Device.isDevice) {
    return { status: "unsupported", reason: "Las notificaciones push solo funcionan en un teléfono real." };
  }

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

  if (!granted && existing.canAskAgain !== false) {
    const asked = await Notifications.requestPermissionsAsync();
    granted = asked.granted || asked.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  }
  if (!granted) return { status: "denied" };

  try {
    const { type, data } = await Notifications.getDevicePushTokenAsync();
    if (type !== "ios" && type !== "android") {
      return { status: "unsupported", reason: `Plataforma sin soporte de push: ${type}.` };
    }
    if (typeof data !== "string" || !data) {
      return { status: "unsupported", reason: "El sistema no devolvió un token de notificaciones." };
    }
    return { status: "granted", token: data, platform: type };
  } catch (err) {
    // On Android this is almost always a missing google-services.json in the
    // build; on iOS, a missing push entitlement.
    return {
      status: "unsupported",
      reason: err instanceof Error ? err.message : "No se pudo obtener el token de notificaciones.",
    };
  }
}

function deviceLabel(): string {
  const name = Device.deviceName ?? Device.modelName ?? "Dispositivo";
  return `${name} (${Platform.OS})`;
}

/**
 * Keeps this device registered with the API for as long as someone is logged in,
 * and routes a tapped notification to the conversation it came from.
 *
 * Mounted once, from the root layout.
 */
export function usePushNotifications(): void {
  const { user, token } = useAuth();
  const cleanup = useSignOutCleanup();
  const router = useRouter();
  const queryClient = useQueryClient();
  const registeredToken = useRef<string | null>(null);

  // ── Register / refresh on login ────────────────────────────────────────────
  useEffect(() => {
    if (!user || !token) return;
    let cancelled = false;

    (async () => {
      const result = await requestPushToken();
      if (cancelled || result.status !== "granted") return;

      try {
        await registerDevice({
          token: result.token,
          platform: result.platform,
          deviceName: deviceLabel(),
        });
        registeredToken.current = result.token;
      } catch {
        // A failed registration is not worth blocking the session over; the next
        // launch tries again.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, token]);

  // ── Drop the device on logout ──────────────────────────────────────────────
  useEffect(() => {
    if (!cleanup) return;
    cleanup.current = async () => {
      const value = registeredToken.current;
      registeredToken.current = null;
      if (value) await unregisterDevice({ token: value });
    };
    return () => {
      if (cleanup) cleanup.current = null;
    };
  }, [cleanup]);

  // ── Foreground arrivals: refresh what the notification is about ────────────
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as PushData | undefined;
      queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      if (data?.conversationId) {
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(data.conversationId) });
      }
    });
    return () => sub.remove();
  }, [queryClient]);

  // ── Taps: open the conversation ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const open = (data: PushData | undefined) => {
      if (data?.conversationId) router.push(`/chat/${data.conversationId}`);
    };

    // The tap that launched the app from a cold start is delivered here.
    let cancelled = false;
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled || !response) return;
      open(response.notification.request.content.data as PushData | undefined);
    });

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data as PushData | undefined);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [user, router]);
}
