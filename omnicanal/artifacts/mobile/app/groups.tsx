import { useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListGroups,
  useGetGroup,
  useCreateGroup,
  useUpdateGroup,
  useDeleteGroup,
  useAddGroupMember,
  useRemoveGroupMember,
  useListAgents,
  getListGroupsQueryKey,
  getGetGroupQueryKey,
  type AgentGroup,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet, SheetAction } from "../src/components/Sheet";
import { Badge, Button, EmptyState, Field, ListRow, Loading } from "../src/components/ui";
import { errorMessage } from "../src/lib/format";
import { colors, radius, spacing } from "../src/theme";

const RULES = ["round_robin", "least_busy", "by_capability", "manual"] as const;
const RULE_LABELS: Record<string, string> = {
  round_robin: "Turno rotativo",
  least_busy: "Menos ocupado",
  by_capability: "Por capacidad",
  manual: "Cola manual",
};
const RULE_HELP: Record<string, string> = {
  round_robin: "Reparte por orden, uno tras otro.",
  least_busy: "Se la lleva quien menos chats activos tenga.",
  by_capability: "Busca a quien sepa del tema; si no, al menos ocupado.",
  manual: "Queda en cola hasta que alguien la asigne.",
};

export default function GroupsScreen() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<AgentGroup | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  const { data, isLoading, isFetching, refetch } = useListGroups();
  const { data: detail } = useGetGroup(selected?.id ?? 0, {
    query: { queryKey: getGetGroupQueryKey(selected?.id ?? 0), enabled: !!selected },
  });
  const { data: agents } = useListAgents();

  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const addMember = useAddGroupMember();
  const removeMember = useRemoveGroupMember();

  const groups = data ?? [];
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
    if (selected) queryClient.invalidateQueries({ queryKey: getGetGroupQueryKey(selected.id) });
  };

  const humans = (agents ?? []).filter((a) => a.type === "human" && a.isActive);
  const memberIds = new Set((detail?.members ?? []).map((m) => m.agentId));

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          Un flujo puede derivar a un grupo entero; la regla de reparto decide quién lo atiende.
        </Text>
        <Button label="Nuevo grupo" icon="add" size="sm" onPress={() => setCreateOpen(true)} />
      </View>

      {isLoading && groups.length === 0 ? (
        <Loading label="Cargando grupos…" />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={groups.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={<EmptyState icon="people-outline" title="Sin grupos" />}
          renderItem={({ item }) => (
            <ListRow
              title={item.name}
              subtitle={item.description ?? RULE_HELP[item.distributionRule]}
              onPress={() => setSelected(item)}
              left={
                <View style={styles.icon}>
                  <Ionicons name="people" size={18} color={colors.primary} />
                </View>
              }
              meta={
                <View style={styles.metaRow}>
                  <Badge label={RULE_LABELS[item.distributionRule] ?? item.distributionRule} bg={colors.primarySoft} fg={colors.primary} />
                  <Badge label={`${item.memberCount} miembros`} />
                  {item.queuedConversations ? (
                    <Badge label={`${item.queuedConversations} en cola`} bg={colors.warningSoft} fg={colors.warning} />
                  ) : null}
                </View>
              }
            />
          )}
        />
      )}

      {/* ── Group detail ─────────────────────────────────────────────────────── */}
      <Sheet
        visible={!!selected && !ruleOpen && !addOpen}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        description={selected ? RULE_HELP[selected.distributionRule] : undefined}
      >
        {(detail?.members ?? []).length === 0 ? (
          <Text style={styles.emptyMembers}>Este grupo aún no tiene miembros.</Text>
        ) : (
          (detail?.members ?? []).map((member) => (
            <SheetAction
              key={member.agentId}
              icon="person"
              label={member.name}
              description={`${member.activeConversations} chats activos${member.capabilities?.length ? ` · ${member.capabilities.slice(0, 2).join(", ")}` : ""}`}
              tint={colors.foreground}
              onPress={() =>
                Alert.alert("Quitar del grupo", `${member.name} dejará de recibir chats de este grupo.`, [
                  { text: "Cancelar", style: "cancel" },
                  {
                    text: "Quitar",
                    style: "destructive",
                    onPress: () =>
                      removeMember.mutate(
                        { id: selected!.id, agentId: member.agentId },
                        { onSuccess: invalidate, onError: (err) => Alert.alert("No se pudo quitar", errorMessage(err)) },
                      ),
                  },
                ])
              }
            />
          ))
        )}

        <SheetAction icon="person-add" label="Añadir miembro" onPress={() => setAddOpen(true)} />
        <SheetAction
          icon="shuffle"
          label="Regla de reparto"
          description={selected ? RULE_LABELS[selected.distributionRule] : undefined}
          onPress={() => setRuleOpen(true)}
        />
        <SheetAction
          icon="trash"
          label="Eliminar grupo"
          tint={colors.destructive}
          onPress={() =>
            Alert.alert("Eliminar grupo", `"${selected?.name}" y su reparto dejarán de existir.`, [
              { text: "Cancelar", style: "cancel" },
              {
                text: "Eliminar",
                style: "destructive",
                onPress: () =>
                  deleteGroup.mutate(
                    { id: selected!.id },
                    {
                      onSuccess: () => {
                        setSelected(null);
                        invalidate();
                      },
                      onError: (err) => Alert.alert("No se pudo eliminar", errorMessage(err)),
                    },
                  ),
              },
            ])
          }
        />
      </Sheet>

      {/* ── Distribution rule ────────────────────────────────────────────────── */}
      <Sheet visible={ruleOpen} onClose={() => setRuleOpen(false)} title="Regla de reparto">
        {RULES.map((rule) => (
          <SheetAction
            key={rule}
            icon="shuffle"
            label={RULE_LABELS[rule]}
            description={RULE_HELP[rule]}
            selected={selected?.distributionRule === rule}
            onPress={() => {
              setRuleOpen(false);
              updateGroup.mutate(
                { id: selected!.id, data: { distributionRule: rule } },
                {
                  onSuccess: () => {
                    setSelected((current) => (current ? { ...current, distributionRule: rule } : current));
                    invalidate();
                  },
                  onError: (err) => Alert.alert("No se pudo actualizar", errorMessage(err)),
                },
              );
            }}
          />
        ))}
      </Sheet>

      {/* ── Add member ───────────────────────────────────────────────────────── */}
      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title="Añadir miembro">
        {humans.length === 0 ? (
          <Text style={styles.emptyMembers}>No hay agentes humanos activos.</Text>
        ) : (
          humans.map((agent) => (
            <SheetAction
              key={agent.id}
              icon="person"
              label={agent.name}
              description={agent.email}
              selected={memberIds.has(agent.id)}
              disabled={memberIds.has(agent.id)}
              onPress={() => {
                setAddOpen(false);
                addMember.mutate(
                  { id: selected!.id, data: { agentId: agent.id } },
                  { onSuccess: invalidate, onError: (err) => Alert.alert("No se pudo añadir", errorMessage(err)) },
                );
              }}
            />
          ))
        )}
      </Sheet>

      {/* ── Create ───────────────────────────────────────────────────────────── */}
      <Sheet visible={createOpen} onClose={() => setCreateOpen(false)} title="Nuevo grupo">
        <View style={styles.form}>
          <Field label="Nombre" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
          <Field
            label="Descripción"
            value={form.description}
            onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
            multiline
          />
          <Button
            label="Crear grupo"
            loading={createGroup.isPending}
            onPress={() => {
              if (!form.name.trim()) {
                Alert.alert("Falta el nombre", "Escribe cómo se llama el grupo.");
                return;
              }
              createGroup.mutate(
                { data: { name: form.name.trim(), description: form.description.trim() || null } },
                {
                  onSuccess: () => {
                    setForm({ name: "", description: "" });
                    setCreateOpen(false);
                    invalidate();
                  },
                  onError: (err) => Alert.alert("No se pudo crear", errorMessage(err)),
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
  header: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerText: { fontSize: 11, color: colors.mutedForeground, lineHeight: 16 },
  separator: { height: 1, backgroundColor: colors.border },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  emptyMembers: { fontSize: 12, color: colors.mutedForeground, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  form: { padding: spacing.lg, gap: spacing.md },
});
