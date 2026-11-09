import { useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAgent,
  useUpdateAgent,
  useListConversations,
  getGetAgentQueryKey,
  getListAgentsQueryKey,
  getListConversationsQueryKey,
} from "@workspace/api-client-react";
import { Screen } from "../../src/components/Screen";
import { ConversationRow } from "../../src/components/ConversationRow";
import { Sheet, SheetAction } from "../../src/components/Sheet";
import { Avatar, Badge, Button, Card, Divider, EmptyState, Field, Loading, SectionHeader } from "../../src/components/ui";
import { errorMessage, initials } from "../../src/lib/format";
import { channelColors, channelIcons, channelLabels, colors, radius, spacing } from "../../src/theme";

const STATUSES = ["online", "busy", "offline"] as const;
const STATUS_LABELS: Record<string, string> = { online: "En línea", busy: "Ocupado", offline: "Desconectado" };
const CHANNELS = ["whatsapp", "instagram", "facebook"] as const;

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const agentId = Number(id);
  const router = useRouter();
  const queryClient = useQueryClient();

  const [statusOpen, setStatusOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");

  const valid = Number.isInteger(agentId) && agentId > 0;
  const { data: agent, isLoading, isFetching, refetch } = useGetAgent(agentId, {
    query: { queryKey: getGetAgentQueryKey(agentId), enabled: valid },
  });
  const { data: conversations } = useListConversations(
    { agentId },
    { query: { queryKey: getListConversationsQueryKey({ agentId }), enabled: valid } },
  );
  const updateAgent = useUpdateAgent();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
    queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
  };

  const patch = (data: Parameters<typeof updateAgent.mutate>[0]["data"], failure: string) => {
    updateAgent.mutate(
      { id: agentId, data },
      { onSuccess: invalidate, onError: (err) => Alert.alert(failure, errorMessage(err)) },
    );
  };

  if (!valid) return <EmptyState icon="alert-circle-outline" title="Agente no válido" />;
  if (isLoading && !agent) return <Loading label="Cargando agente…" />;
  if (!agent) return <EmptyState icon="alert-circle-outline" title="No encontramos este agente" />;

  const isVirtual = agent.type === "virtual";
  const active = conversations ?? [];

  return (
    <Screen refreshing={isFetching} onRefresh={refetch}>
      <Card style={{ gap: spacing.lg }}>
        <View style={styles.identity}>
          <Avatar
            label={initials(agent.name)}
            uri={agent.avatar}
            size={56}
            background={isVirtual ? colors.botSoft : colors.muted}
            color={isVirtual ? colors.bot : colors.foreground}
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.name}>{agent.name}</Text>
            <Text style={styles.muted}>{isVirtual ? (agent.profileType ?? "Agente virtual") : agent.email}</Text>
            <View style={styles.badgeRow}>
              <Badge label={STATUS_LABELS[agent.status] ?? agent.status} bg={colors.primarySoft} fg={colors.primary} />
              {isVirtual ? <Badge label="Virtual" bg={colors.botSoft} fg={colors.bot} icon="sparkles" /> : null}
              {!isVirtual ? <Badge label={agent.role === "admin" ? "Administrador" : "Agente"} /> : null}
              <Badge label={`${agent.activeChats} chats`} icon="chatbubbles" />
            </View>
          </View>
        </View>

        <Divider />

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Activo</Text>
            <Text style={styles.muted}>
              {isVirtual ? "Un agente inactivo deja de contestar." : "Un agente inactivo no puede iniciar sesión."}
            </Text>
          </View>
          <Switch
            value={agent.isActive}
            onValueChange={(value) => patch({ isActive: value }, "No se pudo actualizar")}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>

        {!isVirtual ? (
          <Button
            label={`Estado: ${STATUS_LABELS[agent.status] ?? agent.status}`}
            variant="secondary"
            icon="ellipse"
            onPress={() => setStatusOpen(true)}
          />
        ) : null}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="Canales" />
        <View style={styles.channelRow}>
          {CHANNELS.map((channel) => {
            const on = (agent.channels ?? []).includes(channel);
            return (
              <Button
                key={channel}
                label={channelLabels[channel]}
                size="sm"
                variant={on ? "primary" : "secondary"}
                icon={channelIcons[channel]}
                style={{ flexGrow: 1 }}
                onPress={() => {
                  const next = on
                    ? (agent.channels ?? []).filter((c) => c !== channel)
                    : [...(agent.channels ?? []), channel];
                  patch({ channels: next }, "No se pudo cambiar los canales");
                }}
              />
            );
          })}
        </View>
        <Text style={styles.muted}>
          Un agente solo recibe conversaciones de los canales que tenga marcados.
        </Text>
      </Card>

      {isVirtual ? (
        <>
          {agent.systemPrompt ? (
            <Card style={{ gap: spacing.sm }}>
              <SectionHeader title="Instrucciones" />
              <Text style={styles.mono}>{agent.systemPrompt}</Text>
              <Text style={styles.muted}>Modelo: {agent.model ?? "por defecto"}</Text>
            </Card>
          ) : null}

          {(agent.capabilities ?? []).length > 0 ? (
            <Card style={{ gap: spacing.md }}>
              <SectionHeader title="Capacidades" />
              {(agent.capabilities ?? []).map((capability) => (
                <View key={capability.id} style={{ gap: 3 }}>
                  <Text style={styles.capabilityName}>{capability.name}</Text>
                  {capability.description ? <Text style={styles.muted}>{capability.description}</Text> : null}
                  <View style={styles.badgeRow}>
                    {capability.knowledgeBaseName ? (
                      <Badge label={capability.knowledgeBaseName} icon="library" bg={colors.infoSoft} fg={colors.info} />
                    ) : null}
                    {(capability.keywords ?? []).slice(0, 4).map((keyword) => (
                      <Badge key={keyword} label={keyword} />
                    ))}
                  </View>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      ) : (
        <Card style={{ gap: spacing.md }}>
          <SectionHeader title="Acceso" />
          <Button label="Asignar nueva contraseña" icon="key" variant="secondary" onPress={() => setPasswordOpen(true)} />
          <Text style={styles.muted}>
            La contraseña se guarda cifrada; el agente podrá cambiarla desde su perfil.
          </Text>
        </Card>
      )}

      <Card padded={false} style={{ overflow: "hidden" }}>
        <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
          <SectionHeader title={`Conversaciones asignadas (${active.length})`} />
        </View>
        {active.length === 0 ? (
          <EmptyState icon="chatbubbles-outline" title="Sin conversaciones asignadas" />
        ) : (
          active
            .slice(0, 10)
            .map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                showOwner={false}
                onPress={() => router.push(`/chat/${conversation.id}`)}
              />
            ))
        )}
      </Card>

      <Sheet visible={statusOpen} onClose={() => setStatusOpen(false)} title="Estado del agente">
        {STATUSES.map((status) => (
          <SheetAction
            key={status}
            icon="ellipse"
            label={STATUS_LABELS[status]}
            selected={agent.status === status}
            onPress={() => {
              setStatusOpen(false);
              patch({ status }, "No se pudo cambiar el estado");
            }}
          />
        ))}
      </Sheet>

      <Sheet
        visible={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        title="Nueva contraseña"
        description="Mínimo 8 caracteres. Sustituye la anterior de inmediato."
      >
        <View style={styles.form}>
          <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry />
          <Button
            label="Guardar contraseña"
            loading={updateAgent.isPending}
            onPress={() => {
              if (password.length < 8) {
                Alert.alert("Contraseña muy corta", "Usa al menos 8 caracteres.");
                return;
              }
              updateAgent.mutate(
                { id: agentId, data: { password } },
                {
                  onSuccess: () => {
                    setPassword("");
                    setPasswordOpen(false);
                    invalidate();
                  },
                  onError: (err) => Alert.alert("No se pudo guardar", errorMessage(err)),
                },
              );
            }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  name: { fontSize: 18, fontWeight: "800", color: colors.foreground },
  muted: { fontSize: 12, color: colors.mutedForeground, lineHeight: 17 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  switchLabel: { fontSize: 14, fontWeight: "600", color: colors.foreground },
  channelRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  mono: {
    fontSize: 12,
    color: colors.foreground,
    lineHeight: 18,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  capabilityName: { fontSize: 13, fontWeight: "700", color: colors.foreground },
  form: { padding: spacing.lg, gap: spacing.md },
});
