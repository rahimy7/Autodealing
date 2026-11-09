import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, shadow, spacing } from "../theme";

type IconName = keyof typeof Ionicons.glyphMap;

// ── Text ──────────────────────────────────────────────────────────────────────

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Subtitle({ children }: { children: ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function Card({
  children,
  style,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  return <View style={[styles.card, padded && { padding: spacing.lg }, style]}>{children}</View>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.primary} />
      {label ? <Text style={styles.centeredText}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({
  icon = "file-tray-outline",
  title,
  description,
}: {
  icon?: IconName;
  title: string;
  description?: string;
}) {
  return (
    <View style={styles.centered}>
      <Ionicons name={icon} size={40} color={colors.border} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {description ? <Text style={styles.centeredText}>{description}</Text> : null}
    </View>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <View style={styles.errorNote}>
      <Ionicons name="alert-circle" size={16} color={colors.destructive} />
      <Text style={styles.errorNoteText}>{message}</Text>
    </View>
  );
}

// ── Controls ──────────────────────────────────────────────────────────────────

export function Button({
  label,
  onPress,
  icon,
  variant = "primary",
  disabled,
  loading,
  style,
  size = "md",
}: {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  size?: "sm" | "md";
}) {
  const palette = {
    primary: { bg: colors.primary, fg: colors.primaryForeground, border: colors.primary },
    secondary: { bg: colors.card, fg: colors.foreground, border: colors.border },
    ghost: { bg: "transparent", fg: colors.mutedForeground, border: "transparent" },
    danger: { bg: colors.destructive, fg: "#FFFFFF", border: colors.destructive },
  }[variant];

  const isOff = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isOff}
      style={({ pressed }) => [
        styles.button,
        size === "sm" && styles.buttonSm,
        { backgroundColor: palette.bg, borderColor: palette.border },
        isOff && { opacity: 0.45 },
        pressed && !isOff && { opacity: 0.75 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : icon ? (
        <Ionicons name={icon} size={size === "sm" ? 14 : 16} color={palette.fg} />
      ) : null}
      <Text style={[styles.buttonLabel, size === "sm" && styles.buttonLabelSm, { color: palette.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label?: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.mutedForeground}
        {...props}
        style={[styles.input, props.multiline && { minHeight: 96, textAlignVertical: "top" }, props.style]}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function SearchInput({ value, onChangeText, placeholder = "Buscar..." }: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={16} color={colors.mutedForeground} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        style={styles.searchInput}
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
    </View>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
  labels,
  icons,
}: {
  options: readonly T[];
  value: NoInfer<T>;
  // NoInfer keeps a `useState` setter from widening T back to `string`: the chip
  // set is always the source of truth for what the values can be.
  onChange: (next: NoInfer<T>) => void;
  labels: Record<string, string>;
  icons?: Record<string, IconName>;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
      keyboardShouldPersistTaps="handled"
    >
      {options.map((option) => {
        const active = option === value;
        const iconName = icons?.[option];
        const iconColor = active ? colors.primaryForeground : colors.mutedForeground;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            style={[
              styles.chip,
              iconName ? styles.chipWithIcon : null,
              active && { backgroundColor: colors.primary, borderColor: colors.primary },
            ]}
          >
            {iconName ? <Ionicons name={iconName} size={14} color={iconColor} /> : null}
            <Text style={[styles.chipText, active && { color: colors.primaryForeground }]}>
              {labels[option] ?? option}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Badge({
  label,
  bg = colors.muted,
  fg = colors.mutedForeground,
  icon,
}: {
  label: string;
  bg?: string;
  fg?: string;
  icon?: IconName;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={10} color={fg} /> : null}
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Avatar({
  label,
  uri,
  size = 40,
  background = colors.muted,
  color = colors.foreground,
  badge,
}: {
  label: string;
  uri?: string | null;
  size?: number;
  background?: string;
  color?: string;
  badge?: ReactNode;
}) {
  // Las fotos de Instagram, Facebook y WhatsApp vienen de Meta con enlaces
  // firmados que caducan: si ya no carga, vuelven las iniciales en vez de un
  // círculo vacío, como en el panel (ContactAvatar).
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const showPhoto = !!uri && uri !== failedUri;

  return (
    <View style={{ width: size, height: size }}>
      {showPhoto ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.muted }}
          contentFit="cover"
          transition={120}
          onError={() => setFailedUri(uri)}
        />
      ) : (
        <View
          style={[
            styles.avatar,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: background },
          ]}
        >
          <Text style={{ color, fontWeight: "700", fontSize: size * 0.36 }}>{label}</Text>
        </View>
      )}
      {badge ? <View style={styles.avatarBadge}>{badge}</View> : null}
    </View>
  );
}

export function StatTile({
  label,
  value,
  icon,
  tint = colors.primary,
  hint,
}: {
  label: string;
  value: string | number;
  icon: IconName;
  tint?: string;
  hint?: string;
}) {
  return (
    <View style={styles.stat}>
      <View style={[styles.statIcon, { backgroundColor: `${tint}1A` }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

/** Horizontal bar used for every breakdown; no chart library needed. */
export function BarRow({
  label,
  value,
  total,
  color = colors.primary,
  suffix,
}: {
  label: string;
  value: number;
  total: number;
  color?: string;
  suffix?: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.barHeader}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barValue}>
          {value}
          {suffix ?? ""} · {pct}%
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.max(pct, 2)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  meta,
}: {
  title: string;
  subtitle?: string | null;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  meta?: ReactNode;
}) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      style={({ pressed }: { pressed?: boolean }) => [styles.listRow, pressed && { backgroundColor: colors.muted }]}
    >
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.listTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.listSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {meta}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} /> : null)}
    </Wrapper>
  );
}

/** A tappable entry in the "Más" menu. */
export function MenuRow({
  icon,
  label,
  description,
  onPress,
  tint = colors.primary,
}: {
  icon: IconName;
  label: string;
  description?: string;
  onPress: () => void;
  tint?: string;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: colors.muted }]}>
      <View style={[styles.menuIcon, { backgroundColor: `${tint}1A` }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.menuLabel}>{label}</Text>
        {description ? <Text style={styles.menuDescription}>{description}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: "700", color: colors.foreground },
  subtitle: { fontSize: 13, color: colors.mutedForeground },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: colors.foreground, textTransform: "uppercase", letterSpacing: 0.4 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  divider: { height: 1, backgroundColor: colors.border },
  centered: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  centeredText: { fontSize: 13, color: colors.mutedForeground, textAlign: "center" },
  emptyTitle: { fontSize: 14, fontWeight: "600", color: colors.foreground, textAlign: "center" },
  errorNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.destructiveSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorNoteText: { flex: 1, fontSize: 12, color: colors.destructive },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  buttonSm: { paddingVertical: 8, paddingHorizontal: spacing.md },
  buttonLabel: { fontSize: 14, fontWeight: "600" },
  buttonLabelSm: { fontSize: 12 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.foreground },
  fieldHint: { fontSize: 11, color: colors.mutedForeground },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: 14,
    color: colors.foreground,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: colors.foreground },
  chipRow: { gap: spacing.sm, paddingVertical: 2 },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: spacing.sm + 2,
  },
  chipText: { fontSize: 12, fontWeight: "600", color: colors.mutedForeground },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  badgeText: { fontSize: 10, fontWeight: "700" },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarBadge: { position: "absolute", right: -2, bottom: -2 },
  stat: {
    flex: 1,
    minWidth: 140,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
    ...shadow.card,
  },
  statIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 20, fontWeight: "800", color: colors.foreground },
  statLabel: { fontSize: 11, color: colors.mutedForeground },
  statHint: { fontSize: 10, color: colors.primary, fontWeight: "600" },
  barHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  barLabel: { fontSize: 12, color: colors.foreground, fontWeight: "600" },
  barValue: { fontSize: 11, color: colors.mutedForeground },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.muted, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
  },
  listTitle: { fontSize: 14, fontWeight: "600", color: colors.foreground },
  listSubtitle: { fontSize: 12, color: colors.mutedForeground },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
  },
  menuIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  menuLabel: { fontSize: 14, fontWeight: "600", color: colors.foreground },
  menuDescription: { fontSize: 11, color: colors.mutedForeground, marginTop: 1 },
});
