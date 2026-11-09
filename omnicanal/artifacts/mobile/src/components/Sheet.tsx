import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";

type IconName = keyof typeof Ionicons.glyphMap;

/** Bottom sheet used for every secondary action and picker in the app. */
export function Sheet({
  visible,
  onClose,
  title,
  description,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Algunas hojas llevan campos (plantillas, venta cerrada): en iOS el
          teclado las taparía. En Android se deja al ajuste de la ventana, igual
          que en la pantalla del chat. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              {description ? <Text style={styles.description}>{description}</Text> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            <View style={{ paddingBottom: spacing.sm }}>{children}</View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SheetAction({
  icon,
  label,
  description,
  onPress,
  tint = colors.foreground,
  disabled,
  selected,
}: {
  icon: IconName;
  label: string;
  description?: string;
  onPress: () => void;
  tint?: string;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.muted }, disabled && { opacity: 0.4 }]}
    >
      <Ionicons name={icon} size={20} color={tint} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionLabel, { color: tint }]}>{label}</Text>
        {description ? <Text style={styles.actionDescription}>{description}</Text> : null}
      </View>
      {selected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { fontSize: 16, fontWeight: "700", color: colors.foreground },
  description: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionLabel: { fontSize: 14, fontWeight: "600" },
  actionDescription: { fontSize: 11, color: colors.mutedForeground, marginTop: 1 },
});
