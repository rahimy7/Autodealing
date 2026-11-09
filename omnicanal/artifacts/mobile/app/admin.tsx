import { useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAgents,
  useUpdateAgent,
  useDeleteAgent,
  getListAgentsQueryKey,
  type Agent,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet, SheetAction } from "../src/components/Sheet";
import { Avatar, Badge, Button, Card, EmptyState, Field, ListRow, Loading, StatTile } from "../src/components/ui";
import { useAuth } from "../src/lib/auth";
import { errorMessage, initials } from "../src/lib/format";
import { colors, spacing } from "../src/theme";

// Administración: quién entra al sistema y con qué acceso. Solo las personas —
// los agentes virtuales se configuran en Agentes, que es otra cosa.

const STATUS_TINT: Record<string, { bg: string; fg: string; label: string }> = {
  online: { bg: colors.successSoft, fg: colors.success, label: "En línea" },
  busy: { bg: colors.warningSoft, fg: colors.warning, label: "Ocupado" },
  offline: { bg: colors.muted, fg: colors.mutedForeground, label: "Desconectado" },
};

export default function AdminScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selected, setSelected] = useState<Agent | null>(null);
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");

  const { data, isLoading, isFetching, refetch } = useListAgents();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();

  const humans = (data ?? []).filter((agent) => agent.type === "human");
  const activeCount = humans.filter((agent) => agent.isActive).length;
  const adminCount = humans.filter((agent) => agent.role === "admin").length;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });

  const close = () => {
    setSelected(null);
    setResetting(false);
    setPassword("");
  };

  const toggleActive = (agent: Agent) =>
    updateAgent.mutate(
      { id: agent.id, data: { isActive: !agent.isActive } },
      {
        onSuccess: () => {
          invalidate();
          close();
        },
        onError: (err) => Alert.alert("No se pudo cambiar", errorMessage(err)),
      },
    );

  const submitReset = () => {
    if (!selected) return;
    if (password.length < 8) {
      Alert.alert("Contraseña muy corta", "Tiene que tener al menos 8 caracteres.");
      return;
    }
    updateAgent.mutate(
      { id: selected.id, data: { password } },
      {
        onSuccess: () => {
          Alert.alert("Contraseña actualizada", `${selected.name} ya puede entrar con la nueva.`);
          close();
        },
        onError: (err) => Alert.alert("No se pudo actualizar", errorMessage(err)),
      },
    );
  };

  const remove = (agent: Agent) =>
    Alert.alert("Eliminar usuario", `${agent.name} dejará de tener acceso al sistema.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () =>
          deleteAgent.mutate(
            { id: agent.id },
            {
              onSuccess: () => {
                invalidate();
                close();
              },
              onError: (err) => Alert.alert("No se pudo eliminar", errorMessage(err)),
            },
          ),
      },
    ]);

  return (
    <Screen scroll={false}>
      {isLoading && humans.length === 0 ? (
        <Loading label="Cargando usuarios…" />
      ) : (
        <FlatList
          data={humans}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingBottom: spacing.lg }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              {/* La cuenta con la que se entró, que no se puede tocar desde aquí. */}
              <Card style={styles.identity}>
                <Avatar
                  label={initials(user?.name)}
                  uri={humans.find((agent) => agent.id === user?.agentId)?.avatar}
                  size={44}
                  background={colors.primary}
                  color={colors.primaryForeground}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{user?.name}</Text>
                  <Text style={styles.meta}>{user?.email}</Text>
                </View>
                <Badge label="Administrador" bg={colors.warningSoft} fg={colors.warning} icon="shield-checkmark" />
              </Card>

              <View style={styles.statRow}>
                <StatTile label="Usuarios" value={humans.length} icon="people" />
                <StatTile label="Activos" value={activeCount} icon="checkmark-circle" tint={colors.success} />
                <StatTile label="Administradores" value={adminCount} icon="shield" tint={colors.warning} />
              </View>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title="Sin más usuarios"
              description="Los nuevos se crean desde el panel web, en Agentes."
            />
          }
          renderItem={({ item }) => {
            const status = STATUS_TINT[item.status] ?? STATUS_TINT.offline;
            return (
              <ListRow
                title={item.name}
                subtitle={item.email}
                onPress={() => setSelected(item)}
                left={<Avatar label={initials(item.name)} uri={item.avatar} size={40} />}
                meta={
                  <View style={styles.metaRow}>
                    <Badge label={status.label} bg={status.bg} fg={status.fg} />
                    <Badge label={item.role === "admin" ? "Administrador" : "Agente"} />
                    {!item.isActive ? <Badge label="Inactivo" bg={colors.destructiveSoft} fg={colors.destructive} /> : null}
                  </View>
                }
              />
            );
          }}
        />
      )}

      <Sheet
        visible={!!selected}
        onClose={close}
        title={selected?.name ?? ""}
        description={selected ? `${selected.email} · ${selected.role === "admin" ? "Administrador" : "Agente"}` : undefined}
      >
        {selected && !resetting ? (
          <>
            <SheetAction
              icon="create"
              label="Editar el agente"
              onPress={() => {
                const id = selected.id;
                close();
                router.push(`/agents/${id}`);
              }}
            />
            <SheetAction icon="key" label="Restablecer la contraseña" onPress={() => setResetting(true)} />
            <SheetAction
              icon={selected.isActive ? "power" : "play-circle"}
              label={selected.isActive ? "Desactivar el acceso" : "Activar el acceso"}
              tint={selected.isActive ? colors.destructive : colors.success}
              disabled={updateAgent.isPending}
              onPress={() => toggleActive(selected)}
            />
            <SheetAction
              icon="trash"
              label="Eliminar el usuario"
              tint={colors.destructive}
              disabled={deleteAgent.isPending || selected.id === user?.agentId}
              description={selected.id === user?.agentId ? "No puedes eliminar tu propia cuenta" : undefined}
              onPress={() => remove(selected)}
            />
          </>
        ) : null}

        {selected && resetting ? (
          <View style={styles.form}>
            <Field
              label="Nueva contraseña"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholder="Mínimo 8 caracteres"
            />
            <View style={styles.formButtons}>
              <Button
                label="Cancelar"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => {
                  setResetting(false);
                  setPassword("");
                }}
              />
              <Button
                label="Guardar"
                style={{ flex: 1 }}
                loading={updateAgent.isPending}
                disabled={password.length < 8}
                onPress={submitReset}
              />
            </View>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerBlock: { padding: spacing.lg, gap: spacing.md },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  separator: { height: 1, backgroundColor: colors.border },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  name: { fontSize: 15, fontWeight: "800", color: colors.foreground },
  meta: { fontSize: 12, color: colors.mutedForeground },
  form: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  formButtons: { flexDirection: "row", gap: spacing.md },
});
