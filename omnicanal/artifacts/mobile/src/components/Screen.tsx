import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../theme";

/**
 * Page shell. `scroll` is the common case (a form or a dashboard); lists that
 * bring their own FlatList pass `scroll={false}` so there is never a scroll view
 * inside another one.
 */
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  padded = true,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, spacing.lg);

  if (!scroll) {
    // La rama con lista propia también necesita el hueco de abajo: sin él, el
    // último elemento queda debajo del indicador de inicio en iOS y de la barra
    // de gestos en Android, que con edgeToEdgeEnabled dibuja sobre el contenido.
    // Cuando hay pie, el hueco es suyo — es lo último que se ve.
    return (
      <View style={[styles.root, !footer && { paddingBottom: bottomPad }]}>
        <View style={{ flex: 1 }}>{children}</View>
        {footer ? <View style={{ paddingBottom: bottomPad }}>{footer}</View> : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          padded && { padding: spacing.lg },
          { paddingBottom: bottomPad + spacing.xl, gap: spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
