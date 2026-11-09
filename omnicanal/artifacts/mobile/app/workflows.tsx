import { useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListWorkflows,
  useGetWorkflow,
  useUpdateWorkflow,
  useListLabels,
  useListAgents,
  useListGroups,
  getGetWorkflowQueryKey,
  getListWorkflowsQueryKey,
  type Workflow,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet } from "../src/components/Sheet";
import { Badge, EmptyState, ListRow, Loading } from "../src/components/ui";
import { errorMessage, formatDate } from "../src/lib/format";
import { channelLabels, colors, radius, spacing } from "../src/theme";

// The visual editor stays on the web panel; on the phone a flow is something you
// inspect and switch on or off.
export default function WorkflowsScreen() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Workflow | null>(null);

  const { data, isLoading, isFetching, refetch } = useListWorkflows();
  const updateWorkflow = useUpdateWorkflow();
  const { data: detail } = useGetWorkflow(selected?.id ?? 0, {
    query: { queryKey: getGetWorkflowQueryKey(selected?.id ?? 0), enabled: !!selected },
  });
  const { data: labels } = useListLabels();
  const { data: agents } = useListAgents();
  const { data: groups } = useListGroups();

  const workflows = data ?? [];

  const toggle = (workflow: Workflow, isActive: boolean) => {
    updateWorkflow.mutate(
      { id: workflow.id, data: { isActive } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() }),
        onError: (err) => Alert.alert("No se pudo actualizar el flujo", errorMessage(err)),
      },
    );
  };

  // The graph stores label → target edges; this renders them as plain sentences.
  const rules = (() => {
    const graph = detail?.graph as { nodes?: unknown[]; edges?: unknown[] } | undefined;
    const nodes = (graph?.nodes ?? []) as Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
    const edges = (graph?.edges ?? []) as Array<{ source: string; target: string }>;
    const byId = new Map(nodes.map((node) => [node.id, node]));

    return edges
      .map((edge) => {
        const from = byId.get(edge.source);
        const to = byId.get(edge.target);
        if (!from || !to) return null;

        const labelId = (from.data?.labelId ?? null) as number | null;
        const label = labelId != null ? labels?.find((l) => l.id === labelId)?.name : null;
        const kind = to.data?.kind as string | undefined;
        const agentId = (to.data?.agentId ?? null) as number | null;
        const groupId = (to.data?.groupId ?? null) as number | null;

        const target =
          kind === "group"
            ? `grupo ${groups?.find((g) => g.id === groupId)?.name ?? groupId ?? "?"}`
            : kind === "escalation"
              ? `escalación${agentId ? ` a ${agents?.find((a) => a.id === agentId)?.name ?? agentId}` : ""}`
              : agentId
                ? (agents?.find((a) => a.id === agentId)?.name ?? `agente ${agentId}`)
                : (to.data?.label as string | undefined) ?? "destino";

        return { key: `${edge.source}-${edge.target}`, from: label ?? (from.data?.label as string) ?? "entrada", to: target };
      })
      .filter((rule): rule is { key: string; from: string; to: string } => rule !== null);
  })();

  return (
    <Screen scroll={false}>
      {isLoading && workflows.length === 0 ? (
        <Loading label="Cargando flujos…" />
      ) : (
        <FlatList
          data={workflows}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={workflows.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState icon="git-branch-outline" title="Sin flujos" description="Créalos en el editor visual del panel web." />
          }
          renderItem={({ item }) => (
            <ListRow
              title={item.name}
              subtitle={
                (item.channels ?? []).length === 0
                  ? "General · todos los canales"
                  : (item.channels ?? []).map((c) => channelLabels[c] ?? c).join(" · ")
              }
              onPress={() => setSelected(item)}
              left={
                <View style={[styles.icon, { backgroundColor: item.isActive ? colors.primarySoft : colors.muted }]}>
                  <Ionicons name="git-branch" size={18} color={item.isActive ? colors.primary : colors.mutedForeground} />
                </View>
              }
              right={
                <Switch
                  value={item.isActive}
                  onValueChange={(value) => toggle(item, value)}
                  trackColor={{ true: colors.primary, false: colors.border }}
                />
              }
              meta={
                <View style={styles.metaRow}>
                  <Badge
                    label={item.isActive ? "Activo" : "Inactivo"}
                    bg={item.isActive ? colors.successSoft : colors.muted}
                    fg={item.isActive ? colors.success : colors.mutedForeground}
                  />
                  <Badge label={`Actualizado ${formatDate(item.updatedAt)}`} />
                </View>
              }
            />
          )}
        />
      )}

      <Sheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        description="Reglas de enrutado por intención"
      >
        <View style={styles.detail}>
          {rules.length === 0 ? (
            <Text style={styles.muted}>
              Este flujo aún no tiene reglas conectadas, o su estructura sólo es legible en el editor
              visual del panel web.
            </Text>
          ) : (
            rules.map((rule) => (
              <View key={rule.key} style={styles.rule}>
                <Badge label={rule.from} bg={colors.accentSoft} fg={colors.accent} />
                <Ionicons name="arrow-forward" size={13} color={colors.mutedForeground} />
                <Badge label={rule.to} bg={colors.primarySoft} fg={colors.primary} />
              </View>
            ))
          )}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  separator: { height: 1, backgroundColor: colors.border },
  icon: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  detail: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  rule: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  muted: { fontSize: 12, color: colors.mutedForeground, lineHeight: 18 },
});
