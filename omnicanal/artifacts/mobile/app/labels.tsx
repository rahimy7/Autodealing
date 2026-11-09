import { useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Switch, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLabels,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
  getListLabelsQueryKey,
  type Label,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet, SheetAction } from "../src/components/Sheet";
import { Badge, Button, EmptyState, Field, ListRow, Loading } from "../src/components/ui";
import { errorMessage } from "../src/lib/format";
import { colors, spacing } from "../src/theme";

export default function LabelsScreen() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Label | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  const { data, isLoading, isFetching, refetch } = useListLabels();
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();

  const labels = data ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListLabelsQueryKey() });

  const remove = (label: Label) => {
    Alert.alert("Eliminar etiqueta", `"${label.name}" dejará de usarse para clasificar conversaciones.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () =>
          deleteLabel.mutate(
            { id: label.id },
            {
              onSuccess: () => {
                setSelected(null);
                invalidate();
              },
              onError: (err) => Alert.alert("No se pudo eliminar", errorMessage(err)),
            },
          ),
      },
    ]);
  };

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          La IA clasifica cada conversación con una de estas intenciones y los flujos deciden a quién
          la mandan.
        </Text>
        <Button label="Nueva etiqueta" icon="add" size="sm" onPress={() => setCreateOpen(true)} />
      </View>

      {isLoading && labels.length === 0 ? (
        <Loading label="Cargando etiquetas…" />
      ) : (
        <FlatList
          data={labels}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={labels.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={<EmptyState icon="pricetags-outline" title="Sin etiquetas" />}
          renderItem={({ item }) => (
            <ListRow
              title={item.name}
              subtitle={item.description ?? item.slug}
              onPress={() => setSelected(item)}
              left={<View style={[styles.swatch, { backgroundColor: item.color || colors.primary }]} />}
              right={
                <Switch
                  value={item.isActive}
                  onValueChange={(value) =>
                    updateLabel.mutate(
                      { id: item.id, data: { isActive: value } },
                      { onSuccess: invalidate, onError: (err) => Alert.alert("No se pudo actualizar", errorMessage(err)) },
                    )
                  }
                  trackColor={{ true: colors.primary, false: colors.border }}
                />
              }
              meta={
                <View style={styles.metaRow}>
                  {item.isSafeForAutoReply ? (
                    <Badge label="Auto-respuesta" bg={colors.successSoft} fg={colors.success} icon="sparkles" />
                  ) : null}
                  {item.autoMigrateToDm ? <Badge label="Pasa a DM" bg={colors.infoSoft} fg={colors.info} /> : null}
                </View>
              }
            />
          )}
        />
      )}

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? ""} description={selected?.description ?? undefined}>
        {selected ? (
          <>
            <SheetAction
              icon="sparkles"
              label="Respuesta automática en comentarios"
              description={selected.isSafeForAutoReply ? "Activada" : "Desactivada"}
              selected={selected.isSafeForAutoReply}
              onPress={() =>
                updateLabel.mutate(
                  { id: selected.id, data: { isSafeForAutoReply: !selected.isSafeForAutoReply } },
                  {
                    onSuccess: () => {
                      setSelected(null);
                      invalidate();
                    },
                    onError: (err) => Alert.alert("No se pudo actualizar", errorMessage(err)),
                  },
                )
              }
            />
            <SheetAction
              icon="mail"
              label="Migrar automáticamente a DM"
              description={selected.autoMigrateToDm ? "Activada" : "Desactivada"}
              selected={selected.autoMigrateToDm}
              onPress={() =>
                updateLabel.mutate(
                  { id: selected.id, data: { autoMigrateToDm: !selected.autoMigrateToDm } },
                  {
                    onSuccess: () => {
                      setSelected(null);
                      invalidate();
                    },
                    onError: (err) => Alert.alert("No se pudo actualizar", errorMessage(err)),
                  },
                )
              }
            />
            <SheetAction icon="trash" label="Eliminar etiqueta" tint={colors.destructive} onPress={() => remove(selected)} />
          </>
        ) : null}
      </Sheet>

      <Sheet visible={createOpen} onClose={() => setCreateOpen(false)} title="Nueva etiqueta">
        <View style={styles.form}>
          <Field label="Nombre" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
          <Field
            label="Descripción"
            hint="Le dice a la IA cuándo aplicar esta intención."
            value={form.description}
            onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
            multiline
          />
          <Button
            label="Crear etiqueta"
            loading={createLabel.isPending}
            onPress={() => {
              if (!form.name.trim()) {
                Alert.alert("Falta el nombre", "Escribe cómo se llama la intención.");
                return;
              }
              createLabel.mutate(
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
  swatch: { width: 14, height: 32, borderRadius: 4 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  form: { padding: spacing.lg, gap: spacing.md },
});
