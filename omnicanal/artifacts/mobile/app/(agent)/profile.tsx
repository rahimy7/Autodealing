import { Alert, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useListAgents, useListConversations, getListConversationsQueryKey } from "@workspace/api-client-react";
import { Screen } from "../../src/components/Screen";
import { PrivacyLink } from "../../src/components/PrivacyLink";
import { Avatar, Badge, Button, Card, Divider, MenuRow, SectionHeader, StatTile } from "../../src/components/ui";
import { useAuth } from "../../src/lib/auth";
import { initials } from "../../src/lib/format";
import { API_URL } from "../../src/lib/config";
import { channelColors, channelIcons, channelLabels, colors, radius, spacing } from "../../src/theme";

const STATUS_TEXT: Record<string, string> = { online: "En línea", busy: "Ocupado", offline: "Desconectado" };
const STATUS_TINT: Record<string, { bg: string; fg: string }> = {
  online: { bg: colors.successSoft, fg: colors.success },
  busy: { bg: colors.warningSoft, fg: colors.warning },
  offline: { bg: colors.muted, fg: colors.mutedForeground },
};

export default function AgentProfileScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const params = { agentId: user?.agentId ?? undefined };
  const { data: conversations, isFetching, refetch } = useListConversations(params, {
    query: { queryKey: getListConversationsQueryKey(params) },
  });
  const { data: agents } = useListAgents();
  const me = agents?.find((a) => a.id === user?.agentId);

  const list = conversations ?? [];
  const resolved = list.filter((c) => c.status === "resolved").length;
  const active = list.filter((c) => c.status === "open" || c.status === "pending").length;
  const status = STATUS_TINT[me?.status ?? "offline"];

  const confirmSignOut = () => {
    Alert.alert("Cerrar sesión", "Dejarás de recibir notificaciones en este teléfono.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Cerrar sesión", style: "destructive", onPress: () => void signOut() },
    ]);
  };

  return (
    <Screen refreshing={isFetching} onRefresh={refetch}>
      <Card style={{ gap: spacing.lg }}>
        <View style={styles.identity}>
          <Avatar
            label={initials(user?.name)}
            uri={me?.avatar}
            size={58}
            background={colors.primary}
            color={colors.primaryForeground}
          />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 2 }}>
              <Badge label={STATUS_TEXT[me?.status ?? "offline"]} bg={status.bg} fg={status.fg} />
              <Badge label={user?.role === "admin" ? "Administrador" : "Agente"} />
            </View>
          </View>
        </View>

        <Divider />

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Canales asignados</Text>
          {(me?.channels ?? []).length === 0 ? (
            <Text style={styles.muted}>Sin canales asignados</Text>
          ) : (
            <View style={styles.channelRow}>
              {(me?.channels ?? []).map((channel) => (
                <View key={channel} style={styles.channelChip}>
                  <Ionicons
                    name={channelIcons[channel] ?? "chatbubble"}
                    size={13}
                    color={channelColors[channel] ?? colors.mutedForeground}
                  />
                  <Text style={styles.channelText}>{channelLabels[channel] ?? channel}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </Card>

      <View style={styles.statGrid}>
        <StatTile label="Chats activos" value={active} icon="chatbubbles" />
        <StatTile label="Resueltos" value={resolved} icon="checkmark-done" tint={colors.success} />
        <StatTile label="Total asignados" value={list.length} icon="albums" tint={colors.bot} />
      </View>

      <Card padded={false} style={{ overflow: "hidden" }}>
        <SectionHeader title="" />
        <MenuRow
          icon="notifications"
          label="Notificaciones"
          description="Permisos, prueba de envío y cómo se reparten los avisos."
          onPress={() => router.push("/notifications")}
        />
        <Divider />
        <MenuRow
          icon="key"
          label="Cambiar contraseña"
          description="Mínimo 8 caracteres."
          onPress={() => router.push("/change-password")}
        />
        <Divider />
        <MenuRow
          icon="pricetags"
          label="Catálogo de productos"
          description="Busca y comparte fichas con el cliente."
          onPress={() => router.push("/catalog")}
        />
      </Card>

      <PrivacyLink />
      <Button label="Cerrar sesión" variant="danger" icon="log-out" onPress={confirmSignOut} />

      <Text style={styles.footer}>
        Servicio operado por RVR Service{"\n"}
        {API_URL}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  name: { fontSize: 18, fontWeight: "800", color: colors.foreground },
  email: { fontSize: 12, color: colors.mutedForeground },
  label: { fontSize: 12, fontWeight: "600", color: colors.foreground },
  muted: { fontSize: 12, color: colors.mutedForeground },
  channelRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  channelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.muted,
  },
  channelText: { fontSize: 11, fontWeight: "600", color: colors.foreground },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  footer: { fontSize: 10, color: colors.mutedForeground, textAlign: "center", lineHeight: 15 },
});
