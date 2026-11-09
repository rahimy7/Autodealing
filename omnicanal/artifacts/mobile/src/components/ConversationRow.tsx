import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Conversation } from "@workspace/api-client-react";
import { Avatar, Badge } from "./ui";
import { channelColors, channelIcons, colors, radius, spacing, statusColors, statusLabels } from "../theme";
import { initials, timeAgo } from "../lib/format";

export function ChannelDot({ channel, size = 16 }: { channel: string; size?: number }) {
  return (
    <View
      style={[
        styles.channelDot,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Ionicons
        name={channelIcons[channel] ?? "chatbubble"}
        size={size * 0.62}
        color={channelColors[channel] ?? colors.mutedForeground}
      />
    </View>
  );
}

export function ConversationRow({
  conversation,
  onPress,
  /** Marks the row as belonging to the signed-in agent. */
  mine,
  showOwner = true,
}: {
  conversation: Conversation;
  onPress: () => void;
  mine?: boolean;
  showOwner?: boolean;
}) {
  const status = statusColors[conversation.status] ?? { bg: colors.muted, fg: colors.mutedForeground };
  const unread = conversation.unreadCount ?? 0;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.muted }]}>
      <Avatar
        label={initials(conversation.contactName)}
        uri={conversation.contactAvatar}
        size={44}
        badge={<ChannelDot channel={conversation.channel} />}
      />

      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.headerLine}>
          <Text style={styles.name} numberOfLines={1}>
            {conversation.contactName ?? "Contacto"}
          </Text>
          <Text style={styles.time}>{timeAgo(conversation.updatedAt)}</Text>
        </View>

        <Text style={[styles.preview, unread > 0 && styles.previewUnread]} numberOfLines={1}>
          {conversation.lastMessage ?? "Sin mensajes"}
        </Text>

        <View style={styles.badgeLine}>
          <Badge label={statusLabels[conversation.status] ?? conversation.status} bg={status.bg} fg={status.fg} />
          {showOwner ? (
            mine ? (
              <Badge label="Mío" bg={colors.primarySoft} fg={colors.primary} />
            ) : conversation.agentName ? (
              <Badge label={conversation.agentName} />
            ) : (
              <Badge label="Sin asignar" bg={colors.warningSoft} fg={colors.warning} />
            )
          ) : null}
          {conversation.labelName ? (
            <Badge label={conversation.labelName} bg={colors.accentSoft} fg={colors.accent} />
          ) : null}
        </View>
      </View>

      {unread > 0 ? (
        <View style={styles.unread}>
          <Text style={styles.unreadText}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  channelDot: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  name: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.foreground },
  time: { fontSize: 11, color: colors.mutedForeground },
  preview: { fontSize: 12, color: colors.mutedForeground },
  previewUnread: { color: colors.foreground, fontWeight: "600" },
  badgeLine: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 },
  unread: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: { color: colors.primaryForeground, fontSize: 11, fontWeight: "800" },
});
