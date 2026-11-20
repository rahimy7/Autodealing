import { useEffect } from "react";
import { AppState, Image, Pressable, Text, View } from "react-native";
import { Tabs, useRouter, useSegments } from "expo-router";
import { CreateButton } from "@/components/create";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { setUnread, useUnread } from "@/lib/unread";
import { initials } from "@/lib/format";
import { colors, font } from "@/theme";

const tabIcon = (name: React.ComponentProps<typeof Ionicons>["name"]) => ({ color, size }: { color: unknown; size: number }) => <Ionicons name={name} size={size} color={color as string} />;

export default function TabsLayout() {
  const { user, crm } = useAuth();
  const router = useRouter();
  const unread = useUnread();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const tab = segments[segments.length - 1];
  const linked = Boolean(crm?.connected && crm.me?.agentId);

  // The Chats badge: unread messages in the person's own chats, checked while the app is open.
  useEffect(() => {
    if (!linked) return setUnread(0);
    const tick = async () => {
      if (AppState.currentState !== "active") return;
      try {
        const { conversations } = await api<{ conversations: { unreadCount: number }[] }>("/api/admin/crm/conversations?scope=mine");
        setUnread(conversations.reduce((n, c) => n + c.unreadCount, 0));
      } catch {}
    };
    tick();
    const id = setInterval(tick, 45_000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && tick());
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [linked]);


  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerTitleAlign: "left",
        headerTitleStyle: { fontFamily: font.display, fontSize: 19 },
        // Long titles (a name, a profile) truncate before the logo and the avatar on either side.
        headerTitleContainerStyle: { maxWidth: "52%" },
        headerLeft: () => <Image source={require("../../../assets/logo.png")} style={{ width: 70, height: 26, marginLeft: 16 }} resizeMode="contain" />,
        headerRight: () => (
          <Pressable onPress={() => router.push("/account")} accessibilityLabel="Mi cuenta" style={{ marginRight: 14 }}>
            <View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: colors.accent2, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: font.black, fontSize: 13, color: colors.text }}>{initials(user?.name)}</Text>
            </View>
          </Pressable>
        ),
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: "rgba(5,6,10,0.97)", borderTopColor: colors.line, height: 62 + insets.bottom, paddingTop: 6, paddingBottom: 6 + insets.bottom },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: font.bold, fontSize: 10.5 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Hoy", headerTitle: `Hola, ${user?.name.split(" ")[0] ?? ""}`, tabBarIcon: tabIcon("home-outline") }} />
      <Tabs.Screen name="catalog" options={{ title: "Catálogo", tabBarIcon: tabIcon("car-sport-outline") }} />
      <Tabs.Screen name="agenda" options={{ title: "Agenda", tabBarIcon: tabIcon("calendar-outline") }} />
      <Tabs.Screen
        name="chats"
        options={{ title: "Chats", tabBarBadge: unread || undefined, tabBarBadgeStyle: { backgroundColor: colors.accent3, color: "#fff", fontFamily: font.black, fontSize: 10 }, tabBarIcon: tabIcon("chatbubbles-outline") }}
      />
      <Tabs.Screen name="more" options={{ title: "Más", headerTitle: "Más", tabBarIcon: tabIcon("ellipsis-horizontal") }} />
    </Tabs>
    {tab === "chats" ? null : <CreateButton />}
    </View>
  );
}
