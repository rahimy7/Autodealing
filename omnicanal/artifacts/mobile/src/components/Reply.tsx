import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { MessageQuote } from "@workspace/api-client-react";
import { chatColors, colors, radius, spacing } from "../theme";

// Responder citando, como en WhatsApp: la cita va encima de la respuesta en el
// hilo y encima de la caja de texto mientras se escribe. Las mismas etiquetas y
// colores que el panel (omnicanal/src/components/Reply.tsx).

const SENDER_LABEL: Record<MessageQuote["sender"], string> = {
  contact: "Cliente",
  agent: "Agente",
  bot: "Bot IA",
};

// El color de la barra distingue de quién es lo citado, igual que WhatsApp pinta
// distinto al otro y a uno mismo.
const SENDER_TONE: Record<MessageQuote["sender"], string> = {
  contact: "#06CF9C",
  agent: "#53BDEB",
  bot: colors.bot,
};

export function QuotedMessage({
  quote,
  onPress,
}: {
  quote: Pick<MessageQuote, "sender" | "content">;
  onPress?: () => void;
}) {
  const tone = SENDER_TONE[quote.sender];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.quote, { borderLeftColor: tone }, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.author, { color: tone }]}>{SENDER_LABEL[quote.sender]}</Text>
      <Text style={styles.body} numberOfLines={2}>
        {quote.content}
      </Text>
    </Pressable>
  );
}

// Lo que se está citando (o editando) encima de la caja de texto, con su X.
export function ComposerChip({
  quote,
  title,
  onCancel,
  disabled,
  children,
}: {
  quote: Pick<MessageQuote, "sender" | "content">;
  title?: string;
  onCancel: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.chip}>
      <View style={{ flex: 1, gap: 4 }}>
        {title ? <Text style={styles.chipTitle}>{title}</Text> : null}
        <QuotedMessage quote={quote} />
        {children}
      </View>
      <Pressable onPress={onCancel} disabled={disabled} hitSlop={10} style={styles.chipClose}>
        <Ionicons name="close-circle" size={22} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  quote: {
    borderLeftWidth: 4,
    borderRadius: 6,
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginBottom: 2,
  },
  author: { fontSize: 12, fontWeight: "700" },
  body: { fontSize: 13, color: chatColors.text, opacity: 0.75 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  chipTitle: { fontSize: 11, fontWeight: "700", color: colors.primary },
  chipClose: { alignSelf: "center" },
});
