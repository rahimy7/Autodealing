import { useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetIntegrationSettings,
  useUpdateIntegrationSettings,
  useTestIntegration,
  useGetPlan,
  useUpdatePlan,
  getGetIntegrationSettingsQueryKey,
  getGetPlanQueryKey,
  type IntegrationTestResult,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet } from "../src/components/Sheet";
import { Badge, BarRow, Button, Card, Divider, Field, Loading, SectionHeader } from "../src/components/ui";
import { errorMessage, formatDateTime } from "../src/lib/format";
import { channelColors, channelIcons, channelLabels, colors, radius, spacing } from "../src/theme";

type Channel = "whatsapp" | "facebook" | "instagram";

export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<IntegrationTestResult | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planForm, setPlanForm] = useState({ planName: "", monthlyPrice: "", messagesLimit: "", agentsLimit: "" });

  const { data: settings, isLoading, isFetching, refetch } = useGetIntegrationSettings();
  const { data: plan } = useGetPlan();
  const updateSettings = useUpdateIntegrationSettings();
  const updatePlan = useUpdatePlan();
  const testIntegration = useTestIntegration();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetIntegrationSettingsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPlanQueryKey() });
  };

  if (isLoading && !settings) return <Loading label="Cargando ajustes…" />;

  const channels: Array<{
    key: Channel;
    enabled: boolean;
    tokenSet: boolean;
    tokenPreview?: string | null;
    identifier?: string | null;
    identifierLabel: string;
  }> = [
    {
      key: "whatsapp",
      enabled: settings?.whatsappEnabled ?? false,
      tokenSet: settings?.whatsappAccessTokenSet ?? false,
      tokenPreview: settings?.whatsappAccessTokenPreview,
      identifier: settings?.whatsappDisplayNumber ?? settings?.whatsappPhoneNumberId,
      identifierLabel: "Número",
    },
    {
      key: "facebook",
      enabled: settings?.facebookEnabled ?? false,
      tokenSet: settings?.facebookPageAccessTokenSet ?? false,
      tokenPreview: settings?.facebookPageAccessTokenPreview,
      identifier: settings?.facebookPageId,
      identifierLabel: "Página",
    },
    {
      key: "instagram",
      enabled: settings?.instagramEnabled ?? false,
      tokenSet: settings?.instagramAccessTokenSet ?? false,
      tokenPreview: settings?.instagramAccessTokenPreview,
      identifier: settings?.instagramBusinessAccountId,
      identifierLabel: "Cuenta",
    },
  ];

  const toggleChannel = (channel: Channel, enabled: boolean) => {
    const key = channel === "whatsapp" ? "whatsappEnabled" : channel === "facebook" ? "facebookEnabled" : "instagramEnabled";
    updateSettings.mutate(
      { data: { [key]: enabled } },
      { onSuccess: invalidate, onError: (err) => Alert.alert("No se pudo actualizar", errorMessage(err)) },
    );
  };

  const test = (channel: Channel) => {
    setTestResult(null);
    testIntegration.mutate(
      { data: { channel } },
      {
        onSuccess: (result) => setTestResult(result),
        onError: (err) => Alert.alert("La prueba falló", errorMessage(err)),
      },
    );
  };

  return (
    <Screen refreshing={isFetching} onRefresh={refetch}>
      {plan ? (
        <Card style={{ gap: spacing.md }}>
          <SectionHeader
            title="Plan"
            action={
              <Text
                style={styles.link}
                onPress={() => {
                  setPlanForm({
                    planName: plan.planName,
                    monthlyPrice: String(plan.monthlyPrice),
                    messagesLimit: String(plan.messagesLimit),
                    agentsLimit: String(plan.agentsLimit),
                  });
                  setPlanOpen(true);
                }}
              >
                Editar →
              </Text>
            }
          />
          <View style={styles.planHeader}>
            <Text style={styles.planName}>{plan.planName}</Text>
            <Badge label={`US$${plan.monthlyPrice}/mes`} bg={colors.primarySoft} fg={colors.primary} />
          </View>
          <BarRow label="Mensajes este mes" value={plan.messagesUsed} total={plan.messagesLimit} />
          <BarRow label="Agentes" value={plan.agentsUsed} total={plan.agentsLimit} color={colors.accent} />
        </Card>
      ) : null}

      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="Aplicación de Meta" />
        <InfoRow label="App ID" value={settings?.metaAppId} />
        <InfoRow
          label="App Secret"
          value={settings?.metaAppSecretSet ? (settings.metaAppSecretPreview ?? "configurado") : "sin configurar"}
          ok={settings?.metaAppSecretSet}
        />
        <InfoRow label="Verify token" value={settings?.webhookVerifyToken} />
        {settings?.updatedAt ? (
          <Text style={styles.muted}>Actualizado {formatDateTime(settings.updatedAt)}</Text>
        ) : null}
        <Text style={styles.muted}>
          Las credenciales se editan desde el panel web; aquí puedes revisarlas, activar canales y
          probar la conexión.
        </Text>
      </Card>

      {channels.map((channel) => (
        <Card key={channel.key} style={{ gap: spacing.md }}>
          <View style={styles.channelHeader}>
            <View style={[styles.channelIcon, { backgroundColor: `${channelColors[channel.key]}1A` }]}>
              <Ionicons name={channelIcons[channel.key]} size={18} color={channelColors[channel.key]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.channelName}>{channelLabels[channel.key]}</Text>
              <Text style={styles.muted}>
                {channel.identifierLabel}: {channel.identifier || "sin configurar"}
              </Text>
            </View>
            <Switch
              value={channel.enabled}
              onValueChange={(value) => toggleChannel(channel.key, value)}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>

          <Divider />

          <InfoRow
            label="Token"
            value={channel.tokenSet ? (channel.tokenPreview ?? "configurado") : "sin configurar"}
            ok={channel.tokenSet}
          />

          <Button
            label="Probar conexión"
            variant="secondary"
            size="sm"
            icon="pulse"
            loading={testIntegration.isPending}
            onPress={() => test(channel.key)}
          />

          {testResult && testResult.channel === channel.key ? (
            <View
              style={[
                styles.testResult,
                { backgroundColor: testResult.ok ? colors.successSoft : colors.destructiveSoft },
              ]}
            >
              <Ionicons
                name={testResult.ok ? "checkmark-circle" : "close-circle"}
                size={16}
                color={testResult.ok ? colors.success : colors.destructive}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.testText, { color: testResult.ok ? colors.success : colors.destructive }]}>
                  {testResult.message}
                </Text>
                {testResult.details ? <Text style={styles.muted}>{testResult.details}</Text> : null}
              </View>
            </View>
          ) : null}
        </Card>
      ))}

      <Sheet visible={planOpen} onClose={() => setPlanOpen(false)} title="Editar plan">
        <View style={styles.form}>
          <Field label="Nombre" value={planForm.planName} onChangeText={(v) => setPlanForm((f) => ({ ...f, planName: v }))} />
          <Field
            label="Precio mensual (USD)"
            value={planForm.monthlyPrice}
            onChangeText={(v) => setPlanForm((f) => ({ ...f, monthlyPrice: v }))}
            keyboardType="numeric"
          />
          <Field
            label="Límite de mensajes"
            value={planForm.messagesLimit}
            onChangeText={(v) => setPlanForm((f) => ({ ...f, messagesLimit: v }))}
            keyboardType="numeric"
          />
          <Field
            label="Límite de agentes"
            value={planForm.agentsLimit}
            onChangeText={(v) => setPlanForm((f) => ({ ...f, agentsLimit: v }))}
            keyboardType="numeric"
          />
          <Button
            label="Guardar plan"
            loading={updatePlan.isPending}
            onPress={() =>
              updatePlan.mutate(
                {
                  data: {
                    planName: planForm.planName.trim(),
                    monthlyPrice: Number(planForm.monthlyPrice) || 0,
                    messagesLimit: Number(planForm.messagesLimit) || 0,
                    agentsLimit: Number(planForm.agentsLimit) || 0,
                  },
                },
                {
                  onSuccess: () => {
                    setPlanOpen(false);
                    invalidate();
                  },
                  onError: (err) => Alert.alert("No se pudo guardar", errorMessage(err)),
                },
              )
            }
          />
        </View>
      </Sheet>
    </Screen>
  );
}

function InfoRow({ label, value, ok }: { label: string; value?: string | null; ok?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text
        style={[styles.infoValue, ok === false ? { color: colors.destructive } : ok ? { color: colors.success } : null]}
        numberOfLines={1}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  link: { fontSize: 12, fontWeight: "700", color: colors.primary },
  planHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  planName: { fontSize: 16, fontWeight: "800", color: colors.foreground },
  muted: { fontSize: 11, color: colors.mutedForeground, lineHeight: 16 },
  channelHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  channelIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  channelName: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  infoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  infoLabel: { width: 96, fontSize: 12, color: colors.mutedForeground },
  infoValue: { flex: 1, fontSize: 12, color: colors.foreground, textAlign: "right" },
  testResult: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  testText: { fontSize: 12, fontWeight: "600" },
  form: { padding: spacing.lg, gap: spacing.md },
});
