import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from "@expo-google-fonts/manrope";
import { Unbounded_500Medium, Unbounded_600SemiBold } from "@expo-google-fonts/unbounded";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ToastProvider } from "@/components/ui";
import { colors, font } from "@/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

// Forms and pickers open over the screen that started them.
const MODALS = ["reserve", "sale", "appointment", "quote/new", "units/new", "team/new", "quote-settings"];

function Gate() {
  const { ready, user } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const onLogin = segments[0] === "login";

  useEffect(() => {
    if (!ready) return;
    if (!user && !onLogin) router.replace("/login");
    else if (user && onLogin) router.replace("/");
  }, [ready, user, onLogin, router]);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: font.display, fontSize: 16 },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {MODALS.map((name) => (
        <Stack.Screen key={name} name={name} options={{ presentation: "modal" }} />
      ))}
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold, Unbounded_500Medium, Unbounded_600SemiBold });
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <ToastProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}
