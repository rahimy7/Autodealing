import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useHasView } from "../../src/lib/auth";
import { colors } from "../../src/theme";

export default function AdminTabsLayout() {
  const hasView = useHasView();
  // `href: null` esconde la pestaña sin quitar la ruta: quien no tenga la vista no
  // la ve abajo, y "Más" siempre queda para llegar a lo demás.
  const tab = (view: string) => (hasView(view) ? {} : { href: null });
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTitleStyle: { color: colors.primaryForeground, fontSize: 16, fontWeight: "700" },
        headerTintColor: colors.primaryForeground,
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: "Panel",
          ...tab("dashboard"),
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "Bandeja",
          ...tab("inbox"),
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: "Contactos",
          ...tab("contacts"),
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "Más",
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal-circle" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
