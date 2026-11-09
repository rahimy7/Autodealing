import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ConversationList } from "../../src/components/ConversationList";
import { useAuth } from "../../src/lib/auth";
import { colors, radius, spacing } from "../../src/theme";

// Deliberately unfiltered: this is the whole operation, so anyone can pick up a
// chat that is going unanswered. Se contesta desde el chat mismo, sin tomarlo
// antes: solo el que atiende otra persona queda en solo lectura.
export default function AgentGeneralPanelScreen() {
  const { user } = useAuth();

  return (
    <ConversationList
      myAgentId={user?.agentId ?? null}
      emptyTitle="No hay conversaciones con estos filtros"
      header={
        <View style={styles.note}>
          <Ionicons name="eye" size={14} color={colors.mutedForeground} />
          <Text style={styles.noteText}>
            Todas las conversaciones del equipo. Ábrelas y contéstalas: al responder pasan a tu nombre.
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noteText: { flex: 1, fontSize: 11, color: colors.mutedForeground },
});
