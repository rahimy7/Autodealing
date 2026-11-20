// The app's building blocks, in the site's look (README: Premier App). Every screen is made of these.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { asset } from "@/lib/api";
import { initials } from "@/lib/format";
import type { Tone } from "@/lib/labels";
import { useKeyboardHeight } from "@/lib/keyboard";
import { colors, font, gradient, radius } from "@/theme";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];
export const Icon = ({ name, size = 20, color = colors.accent }: { name: IconName; size?: number; color?: string }) => (
  <Ionicons name={name} size={size} color={color} />
);

// ── Text ──────────────────────────────────────────────────────────────────────────────────
type Variant = "body" | "small" | "muted" | "eyebrow" | "h1" | "h2" | "h3" | "display" | "price" | "label";
const variants: Record<Variant, TextStyle> = {
  body: { fontFamily: font.regular, fontSize: 15, color: colors.text, lineHeight: 21 },
  small: { fontFamily: font.regular, fontSize: 13, color: colors.muted, lineHeight: 18 },
  muted: { fontFamily: font.regular, fontSize: 14, color: colors.muted, lineHeight: 20 },
  label: { fontFamily: font.bold, fontSize: 13, color: colors.text2 },
  eyebrow: { fontFamily: font.black, fontSize: 10.5, letterSpacing: 2.2, color: colors.accent, textTransform: "uppercase" },
  h1: { fontFamily: font.display, fontSize: 26, color: colors.text, letterSpacing: -0.8 },
  h2: { fontFamily: font.black, fontSize: 16, color: colors.text, letterSpacing: -0.2 },
  h3: { fontFamily: font.black, fontSize: 15.5, color: colors.text },
  display: { fontFamily: font.display, fontSize: 30, color: colors.text, letterSpacing: -1 },
  price: { fontFamily: font.display, fontSize: 18, color: colors.text, letterSpacing: -0.5 },
};
export function T({ v = "body", style, ...props }: React.ComponentProps<typeof Text> & { v?: Variant }) {
  return <Text {...props} style={[variants[v], style]} />;
}
export const Gradient = ({ style, children, horizontal = true }: { style?: StyleProp<ViewStyle>; children?: React.ReactNode; horizontal?: boolean }) => (
  <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 }} style={style}>
    {children}
  </LinearGradient>
);

// ── Screen ────────────────────────────────────────────────────────────────────────────────
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  padded = true,
  footer,
  error,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  // A form's error: shown above the footer button, where it can't be scrolled out of sight.
  error?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  footer?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const bottom = kb ? 0 : insets.bottom;
  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ padding: padded ? 16 : 0, paddingBottom: (padded ? 28 : 0) + (footer || error ? 0 : bottom) }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.solid} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, padding: padded ? 16 : 0 }, contentStyle]}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingBottom: kb }}>
      <LinearGradient colors={["rgba(124,92,255,0.16)", "rgba(5,6,10,0)"]} style={styles.glow} pointerEvents="none" />
      {body}
      {footer || error ? (
        <View style={[styles.footer, { paddingBottom: 12 + bottom, gap: 10 }]}>
          {error ? <Text style={{ fontFamily: font.semi, fontSize: 13.5, lineHeight: 19, color: "#ff8d98" }}>{error}</Text> : null}
          {footer}
        </View>
      ) : null}
    </View>
  );
}

// ── Surfaces ──────────────────────────────────────────────────────────────────────────────
export const Card = ({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[styles.card, style]}>{children}</View>
);
// A card whose children are separated by hairlines.
export function CardList({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.card, { overflow: "hidden" }, style]}>
      {items.map((c, i) => (
        <View key={i} style={i ? styles.sep : undefined}>
          {c}
        </View>
      ))}
    </View>
  );
}
export const Section = ({ title, action, onAction, children, style }: { title?: string; action?: string; onAction?: () => void; children?: React.ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[{ marginTop: 24 }, style]}>
    {title ? (
      <View style={styles.sectionHead}>
        <T v="h2">{title}</T>
        {action ? (
          <Pressable onPress={onAction} hitSlop={10}>
            <T v="label" style={{ color: colors.accent }}>
              {action}
            </T>
          </Pressable>
        ) : null}
      </View>
    ) : null}
    {children}
  </View>
);
export const Gap = ({ h = 12 }: { h?: number }) => <View style={{ height: h }} />;
export const Row = ({ children, style, gap = 8 }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) => (
  <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>
);

const toneStyle: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surface2, fg: colors.text2 },
  ok: { bg: "rgba(61,220,151,0.14)", fg: colors.good },
  warn: { bg: "rgba(255,200,87,0.14)", fg: colors.warn },
  bad: { bg: "rgba(255,93,108,0.15)", fg: "#ff8d98" },
  info: { bg: "rgba(56,225,255,0.12)", fg: colors.accent },
  violet: { bg: "rgba(124,92,255,0.2)", fg: "#b6a6ff" },
  wa: { bg: "rgba(37,211,102,0.14)", fg: colors.wa },
  ig: { bg: "rgba(255,79,216,0.14)", fg: colors.ig },
  fb: { bg: "rgba(109,141,255,0.16)", fg: colors.fb },
};
export const Pill = ({ tone = "neutral", children, style }: { tone?: Tone; children: React.ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[styles.pill, { backgroundColor: toneStyle[tone].bg }, style]}>
    <Text style={{ fontFamily: font.black, fontSize: 11, color: toneStyle[tone].fg }} numberOfLines={1}>
      {children}
    </Text>
  </View>
);
export const Notice = ({ tone = "warn", children }: { tone?: "warn" | "info" | "bad"; children: React.ReactNode }) => {
  const c = tone === "bad" ? { bg: "rgba(255,93,108,0.1)", bd: "rgba(255,93,108,0.35)", fg: "#ff9aa4" } : tone === "info" ? { bg: "rgba(56,225,255,0.07)", bd: "rgba(56,225,255,0.28)", fg: "#a9efff" } : { bg: "rgba(255,200,87,0.08)", bd: "rgba(255,200,87,0.28)", fg: "#ffd98a" };
  return (
    <View style={{ backgroundColor: c.bg, borderColor: c.bd, borderWidth: 1, borderRadius: radius.sm, padding: 12 }}>
      <Text style={{ fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: c.fg }}>{children}</Text>
    </View>
  );
};
export const Avatar = ({ name, uri, size = 42 }: { name?: string; uri?: string | null; size?: number }) => (
  <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
    {uri ? <Image source={asset(uri)} style={{ width: size, height: size }} contentFit="cover" /> : <Text style={{ fontFamily: font.black, fontSize: size / 3, color: colors.text }}>{initials(name)}</Text>}
  </View>
);
export const Photo = ({ path, style, fit = "cover" }: { path?: string | null; style?: StyleProp<ViewStyle>; fit?: "cover" | "contain" }) =>
  path ? (
    <Image source={asset(path)} style={[{ backgroundColor: colors.bg3 }, style as any]} contentFit={fit} transition={150} recyclingKey={path} />
  ) : (
    <View style={[{ backgroundColor: colors.bg3, alignItems: "center", justifyContent: "center" }, style]}>
      <Icon name="image-outline" size={26} color={colors.muted} />
    </View>
  );

// ── Buttons ───────────────────────────────────────────────────────────────────────────────
type BtnVariant = "primary" | "secondary" | "danger" | "wa" | "ghost" | "gradient";
export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  loading,
  disabled,
  full,
  style,
}: {
  title: string;
  onPress?: () => void | Promise<void>;
  variant?: BtnVariant;
  size?: "md" | "sm";
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [pending, setPending] = useState(false);
  const busy = loading || pending;
  const palette: Record<BtnVariant, { bg: string; fg: string; bd: string }> = {
    primary: { bg: colors.accent, fg: colors.accentInk, bd: "transparent" },
    gradient: { bg: "transparent", fg: "#fff", bd: "transparent" },
    secondary: { bg: colors.surface2, fg: colors.text, bd: colors.line2 },
    danger: { bg: "rgba(255,93,108,0.12)", fg: "#ff8d98", bd: "rgba(255,93,108,0.35)" },
    wa: { bg: colors.wa, fg: "#04210f", bd: "transparent" },
    ghost: { bg: "transparent", fg: colors.text2, bd: "transparent" },
  };
  const p = palette[variant];
  const run = async () => {
    if (busy || disabled || !onPress) return;
    try {
      const r = onPress();
      if (r && typeof (r as Promise<void>).then === "function") {
        setPending(true);
        await r;
      }
    } finally {
      setPending(false);
    }
  };
  const content = (
    <>
      {busy ? <ActivityIndicator size="small" color={p.fg} /> : icon ? <Ionicons name={icon} size={size === "sm" ? 16 : 19} color={p.fg} /> : null}
      <Text style={{ fontFamily: font.bold, fontSize: size === "sm" ? 13 : 14.5, color: p.fg }} numberOfLines={1}>
        {title}
      </Text>
    </>
  );
  const base: ViewStyle = { minHeight: size === "sm" ? 36 : 48, paddingHorizontal: size === "sm" ? 14 : 20, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 };
  return (
    <Pressable
      onPress={run}
      disabled={disabled}
      style={({ pressed }) => [full && { alignSelf: "stretch" }, { opacity: disabled ? 0.45 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}
    >
      {variant === "gradient" ? (
        <Gradient style={base}>{content}</Gradient>
      ) : (
        <View style={[base, { backgroundColor: p.bg, borderWidth: p.bd === "transparent" ? 0 : 1, borderColor: p.bd }, variant === "primary" && styles.glowBtn]}>{content}</View>
      )}
    </Pressable>
  );
}
export const IconButton = ({ name, onPress, label, badge }: { name: IconName; onPress: () => void; label: string; badge?: number }) => (
  <Pressable onPress={onPress} accessibilityLabel={label} style={styles.iconBtn} hitSlop={6}>
    <Ionicons name={name} size={20} color={colors.text2} />
    {badge ? (
      <View style={styles.badge}>
        <Text style={{ fontFamily: font.black, fontSize: 10, color: colors.accentInk }}>{badge}</Text>
      </View>
    ) : null}
  </Pressable>
);
export const BtnRow = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;

// ── Chips and segmented ───────────────────────────────────────────────────────────────────
export function Chip({ label, active, onPress, count, onClear }: { label: string; active?: boolean; onPress?: () => void; count?: number; onClear?: () => void }) {
  return (
    <Pressable onPress={onClear ?? onPress} style={[styles.chip, active && { backgroundColor: colors.text, borderColor: colors.text }]}>
      <Text style={{ fontFamily: font.bold, fontSize: 13, color: active ? colors.bg : colors.text2 }}>{label}</Text>
      {count !== undefined ? <Text style={{ fontFamily: font.black, fontSize: 11, color: active ? colors.bg : colors.muted, opacity: 0.7 }}>{count}</Text> : null}
      {onClear ? <Ionicons name="close" size={14} color={colors.text2} /> : null}
    </Pressable>
  );
}
export const ChipRow = ({ children, wrap }: { children: React.ReactNode; wrap?: boolean }) =>
  wrap ? (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>
  ) : (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
      {children}
    </ScrollView>
  );
export function Segmented<K extends string>({ options, value, onChange, scroll }: { options: [K, string][]; value: K; onChange: (k: K) => void; scroll?: boolean }) {
  const inner = options.map(([k, l]) => (
    <Pressable key={k} onPress={() => onChange(k)} style={[styles.segBtn, value === k && { backgroundColor: colors.accent }, !scroll && { flex: 1 }]}>
      <Text style={{ fontFamily: font.bold, fontSize: 13, color: value === k ? colors.accentInk : colors.muted }} numberOfLines={1}>
        {l}
      </Text>
    </Pressable>
  ));
  return scroll ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
      <View style={styles.seg}>{inner}</View>
    </ScrollView>
  ) : (
    <View style={styles.seg}>{inner}</View>
  );
}

// ── Forms ─────────────────────────────────────────────────────────────────────────────────
export function Field({ label, error, hint, style, right, ...props }: TextInputProps & { label?: string; error?: string; hint?: string; right?: React.ReactNode }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={[{ gap: 6, flex: props.multiline ? undefined : undefined }, style as StyleProp<ViewStyle>]}>
      {label ? <T v="label">{label}</T> : null}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "stretch" }}>
        <TextInput
          placeholderTextColor="rgba(138,146,165,0.7)"
          selectionColor={colors.accent}
          {...props}
          onFocus={(e) => {
            setFocus(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            props.onBlur?.(e);
          }}
          style={[styles.input, props.multiline && { minHeight: 84, paddingTop: 12, textAlignVertical: "top" }, focus && styles.inputFocus, !!error && { borderColor: colors.bad }, { flex: 1 }]}
        />
        {right}
      </View>
      {error ? <T v="small" style={{ color: colors.bad }}>{error}</T> : hint ? <T v="small">{hint}</T> : null}
    </View>
  );
}
export const FormRow = ({ children }: { children: React.ReactNode }) => (
  <View style={{ flexDirection: "row", gap: 12 }}>
    {React.Children.toArray(children).map((c, i) => (
      <View key={i} style={{ flex: 1 }}>
        {c}
      </View>
    ))}
  </View>
);
export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 }}>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: colors.surface3, true: "rgba(56,225,255,0.5)" }} thumbColor={value ? colors.accent : "#9aa3b5"} />
      <T v="body" style={{ flex: 1, fontFamily: font.semi }}>
        {label}
      </T>
    </Pressable>
  );
}
export function Select<K extends string>({ label, value, options, onChange, placeholder }: { label?: string; value: K; options: [K, string][]; onChange: (k: K) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const current = options.find(([k]) => k === value);
  return (
    <View style={{ gap: 6 }}>
      {label ? <T v="label">{label}</T> : null}
      <Pressable onPress={() => setOpen(true)} style={[styles.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
        <Text style={{ fontFamily: font.medium, fontSize: 16, color: current ? colors.text : colors.muted, flex: 1 }} numberOfLines={1}>
          {current?.[1] ?? placeholder ?? "Elegir"}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label ?? "Elegir"}>
        <View style={{ gap: 2 }}>
          {options.map(([k, l]) => (
            <Pressable
              key={k}
              onPress={() => {
                onChange(k);
                setOpen(false);
              }}
              style={[styles.option, k === value && { backgroundColor: "rgba(56,225,255,0.1)" }]}
            >
              <Text style={{ fontFamily: k === value ? font.bold : font.medium, fontSize: 15.5, color: colors.text, flex: 1 }}>{l}</Text>
              {k === value ? <Ionicons name="checkmark" size={20} color={colors.accent} /> : null}
            </Pressable>
          ))}
        </View>
      </Sheet>
    </View>
  );
}
export const SearchBar = ({ value, onChangeText, placeholder }: { value: string; onChangeText: (t: string) => void; placeholder: string }) => (
  <View style={styles.search}>
    <Ionicons name="search" size={18} color={colors.muted} />
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="rgba(138,146,165,0.7)" style={styles.searchInput} selectionColor={colors.accent} autoCorrect={false} returnKeyType="search" />
    {value ? (
      <Pressable onPress={() => onChangeText("")} hitSlop={10}>
        <Ionicons name="close-circle" size={18} color={colors.muted} />
      </Pressable>
    ) : null}
  </View>
);

// ── Lists, states ─────────────────────────────────────────────────────────────────────────
export function ListRow({ left, title, subtitle, right, onPress, children }: { left?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; onPress?: () => void; children?: React.ReactNode }) {
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === "string" ? (
          <Text style={{ fontFamily: font.bold, fontSize: 14.5, color: colors.text }} numberOfLines={1}>
            {title}
          </Text>
        ) : (
          title
        )}
        {subtitle ? (
          typeof subtitle === "string" ? (
            <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : (
            subtitle
          )
        ) : null}
        {children}
      </View>
      {right}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} android_ripple={{ color: "rgba(255,255,255,0.06)" }} style={({ pressed }) => ({ backgroundColor: pressed ? colors.surface : "transparent" })}>
      {body}
    </Pressable>
  ) : (
    body
  );
}
export const Empty = ({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) => (
  <View style={{ alignItems: "center", paddingVertical: 36, paddingHorizontal: 18, gap: 8 }}>
    <T v="h3">{title}</T>
    {body ? (
      <T v="muted" style={{ textAlign: "center", maxWidth: 340 }}>
        {body}
      </T>
    ) : null}
    {action ? <View style={{ marginTop: 10 }}>{action}</View> : null}
  </View>
);
export const Loading = ({ label }: { label?: string }) => (
  <View style={{ paddingVertical: 48, alignItems: "center", gap: 10 }}>
    <ActivityIndicator color={colors.accent} />
    {label ? <T v="small">{label}</T> : null}
  </View>
);
export const Stat = ({ label, value, sub, hot, onPress }: { label: string; value: React.ReactNode; sub?: string; hot?: boolean; onPress?: () => void }) => (
  <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.stat, pressed && { opacity: 0.85 }]}>
    {hot ? <Gradient style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2 }} /> : null}
    <T v="small" style={{ fontFamily: font.bold }}>
      {label}
    </T>
    <Text style={{ fontFamily: font.display, fontSize: 25, color: colors.text, letterSpacing: -1, marginTop: 8 }} numberOfLines={1} adjustsFontSizeToFit>
      {value}
    </Text>
    {sub ? (
      <T v="small" numberOfLines={2} style={{ marginTop: 2, fontSize: 11.5 }}>
        {sub}
      </T>
    ) : null}
  </Pressable>
);
export const StatGrid = ({ children }: { children: React.ReactNode }) => (
  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
    {React.Children.toArray(children).map((c, i) => (
      <View key={i} style={{ width: "48.2%" }}>
        {c}
      </View>
    ))}
  </View>
);
// Rows of label / value, for a quote's figures.
export const Lines = ({ rows }: { rows: { label: string; value: string; strong?: boolean }[] }) => (
  <View>
    {rows.map((r, i) => (
      <View key={i} style={[{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, gap: 12 }, i ? { borderTopWidth: 1, borderTopColor: colors.line } : null]}>
        <Text style={{ fontFamily: r.strong ? font.bold : font.regular, fontSize: 14, color: r.strong ? colors.text : colors.text2, flex: 1 }}>{r.label}</Text>
        <Text style={{ fontFamily: font.bold, fontSize: 14, color: colors.text }}>{r.value}</Text>
      </View>
    ))}
  </View>
);

// ── Bottom sheet ──────────────────────────────────────────────────────────────────────────
export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const bottom = kb ? 0 : insets.bottom;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end", paddingBottom: kb }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <View style={{ flex: 1, backgroundColor: "rgba(3,4,7,0.72)" }} />
        </Pressable>
        <View>
          <View style={[styles.sheet, { maxHeight: "100%" }]}>
            <View style={styles.grab} />
            <View style={styles.sheetHead}>
              <T v="h2" style={{ flex: 1, fontSize: 17 }} numberOfLines={1}>
                {title}
              </T>
              <IconButton name="close" label="Cerrar" onPress={onClose} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingBottom: 18 + (footer ? 0 : bottom) }}>
              {children}
            </ScrollView>
            {footer ? <View style={{ padding: 14, paddingBottom: 14 + bottom, borderTopWidth: 1, borderTopColor: colors.line }}>{footer}</View> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────────────────
type Notify = (message: string, bad?: boolean) => void;
const ToastCtx = createContext<Notify>(() => {});
export const useNotify = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ text: string; bad: boolean; id: number } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback<Notify>(
    (text, bad = false) => {
      clearTimeout(timer.current);
      setToast({ text, bad, id: Date.now() });
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(() => Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToast(null)), bad ? 6000 : 3800);
    },
    [opacity],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo(() => notify, [notify]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      {toast ? (
        <Animated.View pointerEvents="none" style={[styles.toast, { opacity, bottom: 24 + insets.bottom, borderColor: toast.bad ? "rgba(255,93,108,0.55)" : "rgba(61,220,151,0.4)" }]}>
          <Text style={{ fontFamily: font.medium, fontSize: 14, color: colors.text, lineHeight: 20 }}>{toast.text}</Text>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}

const styles = StyleSheet.create({
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 280 },
  footer: { paddingTop: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: "rgba(9,11,17,0.96)" },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.04)" },
  sep: { borderTopWidth: 1, borderTopColor: colors.line },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 },
  pill: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  avatar: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -3, right: -3, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  glowBtn: { shadowColor: colors.accent, shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 38, paddingHorizontal: 15, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  seg: { flexDirection: "row", padding: 4, gap: 2, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  segBtn: { minHeight: 34, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  input: { minHeight: 48, paddingHorizontal: 14, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, color: colors.text, fontFamily: font.medium, fontSize: 16, justifyContent: "center" },
  inputFocus: { borderColor: colors.accent, backgroundColor: "rgba(56,225,255,0.05)" },
  option: { flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 12, borderRadius: radius.sm },
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  searchInput: { flex: 1, color: colors.text, fontFamily: font.medium, fontSize: 15.5, paddingVertical: 0 },
  stat: { borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 14, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.045)", minHeight: 108 },
  sheet: { backgroundColor: colors.solid, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  grab: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: colors.line2, marginTop: 8 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  toast: { position: "absolute", left: 16, right: 16, alignSelf: "center", maxWidth: 480, backgroundColor: "rgba(13,16,23,0.97)", borderWidth: 1, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 16, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 20, elevation: 12 },
});
