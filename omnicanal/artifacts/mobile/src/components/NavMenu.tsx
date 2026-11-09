import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Sheet } from "./Sheet";
import { useHasView } from "../lib/auth";
import { visibleSections } from "../lib/nav";
import { colors, radius, spacing } from "../theme";

/**
 * El mapa de la aplicación, colgado del inicio. El panel web tiene su menú
 * lateral siempre a la vista; en el teléfono solo caben cuatro pestañas abajo,
 * así que el resto de las vistas se abren desde aquí sin tener que pasar por
 * "Más".
 */
export function NavMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const hasView = useHasView();

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel="Abrir el menú de vistas"
      >
        <Ionicons name="apps" size={14} color={colors.primary} />
        <Text style={styles.triggerText}>Menú</Text>
        <Ionicons name="chevron-down" size={13} color={colors.primary} />
      </Pressable>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Todas las vistas"
        description="Lo mismo que el panel web, desde el teléfono."
      >
        {visibleSections(hasView).map((section) => (
          <View key={section.title}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.items.map((item) => (
              <Pressable
                key={item.href}
                onPress={() => go(item.href)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.muted }]}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name={item.icon} size={17} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{item.label}</Text>
                  <Text style={styles.rowDescription} numberOfLines={1}>
                    {item.description}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        ))}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  triggerText: { fontSize: 12, fontWeight: "700", color: colors.primary },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  rowLabel: { fontSize: 14, fontWeight: "600", color: colors.foreground },
  rowDescription: { fontSize: 11, color: colors.mutedForeground, marginTop: 1 },
});
