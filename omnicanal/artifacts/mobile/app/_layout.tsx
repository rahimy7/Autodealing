import { useEffect } from "react";
import { View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, homeRoute, useAuth } from "../src/lib/auth";
import { usePushNotifications } from "../src/lib/push";
import { usePresenceHeartbeat } from "../src/lib/presence";
import { colors } from "../src/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      // Coming back to the app should show the current state of the operation,
      // not whatever was on screen when it was backgrounded.
      refetchOnMount: true,
    },
  },
});

const HEADER = {
  headerStyle: { backgroundColor: colors.primary },
  headerTitleStyle: { color: colors.primaryForeground, fontSize: 16, fontWeight: "700" as const },
  headerTintColor: colors.primaryForeground,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.background },
};

function RootNavigator() {
  const { user, ready } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  usePushNotifications();
  usePresenceHeartbeat();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Single gate for the whole app: nobody reaches a screen their role does not
  // own, and a signed-out session always lands on the login form.
  useEffect(() => {
    if (!ready) return;
    const first = segments[0] as string | undefined;
    const onLogin = first === "login";

    if (!user) {
      if (!onLogin) router.replace("/login");
      return;
    }
    if (onLogin || first === undefined) {
      router.replace(homeRoute(user));
      return;
    }
    // A stale deep link into the other role's tabs bounces back home.
    if (user.role === "agent" && first === "(admin)") router.replace("/home");
    if (user.role === "admin" && first === "(agent)") router.replace("/dashboard");
  }, [user, ready, segments, router]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  return (
    <Stack screenOptions={HEADER}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(admin)" options={{ headerShown: false }} />
      <Stack.Screen name="(agent)" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[id]" options={{ title: "Conversación" }} />
      <Stack.Screen name="contact/[id]" options={{ title: "Contacto" }} />
      <Stack.Screen name="campaigns" options={{ title: "Campañas" }} />
      <Stack.Screen name="products" options={{ title: "Productos" }} />
      <Stack.Screen name="agents/index" options={{ title: "Agentes" }} />
      <Stack.Screen name="agents/[id]" options={{ title: "Agente" }} />
      <Stack.Screen name="workflows" options={{ title: "Flujos" }} />
      <Stack.Screen name="custom-messages" options={{ title: "Mensajes personalizados" }} />
      <Stack.Screen name="feed" options={{ title: "Comentarios" }} />
      <Stack.Screen name="email/index" options={{ title: "Correo" }} />
      <Stack.Screen name="email/[id]" options={{ title: "Correo" }} />
      <Stack.Screen name="email/compose" options={{ title: "Redactar correo" }} />
      <Stack.Screen name="orders" options={{ title: "Pedidos" }} />
      <Stack.Screen name="subscriptions" options={{ title: "Suscripciones" }} />
      <Stack.Screen name="shipments" options={{ title: "Despachos" }} />
      <Stack.Screen name="inventory" options={{ title: "Inventario" }} />
      <Stack.Screen name="cases" options={{ title: "Casos" }} />
      <Stack.Screen name="appointments" options={{ title: "Agenda" }} />
      <Stack.Screen name="learning" options={{ title: "Aprendizajes" }} />
      <Stack.Screen name="admin" options={{ title: "Administración" }} />
      <Stack.Screen name="logs" options={{ title: "Errores del sistema" }} />
      <Stack.Screen name="monitor" options={{ title: "Monitor" }} />
      <Stack.Screen name="reports" options={{ title: "Reportes" }} />
      <Stack.Screen name="settings" options={{ title: "Ajustes" }} />
      <Stack.Screen name="labels" options={{ title: "Etiquetas" }} />
      <Stack.Screen name="groups" options={{ title: "Grupos" }} />
      <Stack.Screen name="notifications" options={{ title: "Notificaciones" }} />
      <Stack.Screen name="change-password" options={{ title: "Cambiar contraseña" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
