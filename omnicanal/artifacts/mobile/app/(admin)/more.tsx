import { Alert, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useGetPlan, useListAgents, getGetPlanQueryKey } from "@workspace/api-client-react";
import { Screen } from "../../src/components/Screen";
import { PrivacyLink } from "../../src/components/PrivacyLink";
import { Avatar, BarRow, Button, Card, Divider, MenuRow, SectionHeader } from "../../src/components/ui";
import { useAuth, useHasView } from "../../src/lib/auth";
import { visibleSections } from "../../src/lib/nav";
import { initials } from "../../src/lib/format";
import { API_URL } from "../../src/lib/config";
import { colors, spacing } from "../../src/theme";

export default function AdminMoreScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const hasView = useHasView();
  // El plan es de Dashboard y Ajustes: sin ninguna de las dos el servidor lo niega.
  const canSeePlan = hasView("dashboard") || hasView("settings");
  const { data: plan, isFetching, refetch } = useGetPlan({ query: { queryKey: getGetPlanQueryKey(), enabled: canSeePlan } });
  // La foto vive en la fila de agente; el administrador de entorno no tiene y se
  // queda con sus iniciales.
  const { data: agents } = useListAgents();
  const me = agents?.find((a) => a.id === user?.agentId);

  const confirmSignOut = () => {
    Alert.alert("Cerrar sesión", "Dejarás de recibir notificaciones en este teléfono.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Cerrar sesión", style: "destructive", onPress: () => void signOut() },
    ]);
  };

  return (
    <Screen refreshing={isFetching} onRefresh={refetch}>
      <Card style={{ gap: spacing.md }}>
        <View style={styles.identity}>
          <Avatar label={initials(user?.name)} uri={me?.avatar} size={48} background={colors.primary} color={colors.primaryForeground} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.muted}>{user?.email}</Text>
          </View>
        </View>

        {plan ? (
          <>
            <Divider />
            <SectionHeader title={plan.planName} />
            <BarRow label="Mensajes este mes" value={plan.messagesUsed} total={plan.messagesLimit} />
            <BarRow
              label="Agentes"
              value={plan.agentsUsed}
              total={plan.agentsLimit}
              color={colors.accent}
            />
          </>
        ) : null}
      </Card>

      {visibleSections(hasView).map((section) => (
        <Card key={section.title} padded={false} style={{ overflow: "hidden" }}>
          <View style={styles.sectionTitleWrapper}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
          {section.items.map((item, index) => (
            <View key={item.href}>
              {index > 0 ? <Divider /> : null}
              <MenuRow
                icon={item.icon}
                label={item.label}
                description={item.description}
                onPress={() => router.push(item.href)}
              />
            </View>
          ))}
        </Card>
      ))}

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
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { fontSize: 16, fontWeight: "800", color: colors.foreground },
  muted: { fontSize: 12, color: colors.mutedForeground },
  sectionTitleWrapper: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  footer: { fontSize: 10, color: colors.mutedForeground, textAlign: "center", lineHeight: 15 },
});
