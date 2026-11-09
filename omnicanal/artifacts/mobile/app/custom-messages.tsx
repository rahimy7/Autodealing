import { useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCustomMessages,
  useUpdateCustomMessage,
  useActivateCustomMessage,
  useDeleteCustomMessage,
  getListCustomMessagesQueryKey,
  type CustomMessage,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet, SheetAction } from "../src/components/Sheet";
import { Badge, Button, EmptyState, Field, ListRow, Loading } from "../src/components/ui";
import { errorMessage } from "../src/lib/format";
import { channelLabels, colors, radius, spacing } from "../src/theme";

export default function CustomMessagesScreen() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<CustomMessage | null>(null);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");

  const { data, isLoading, isFetching, refetch } = useListCustomMessages();
  const updateMessage = useUpdateCustomMessage();
  const activateMessage = useActivateCustomMessage();
  const deleteMessage = useDeleteCustomMessage();

  const messages = data ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListCustomMessagesQueryKey() });

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          El mensaje activo sustituye la primera respuesta del agente virtual cuando arranca una
          conversación.
        </Text>
      </View>

      {isLoading && messages.length === 0 ? (
        <Loading label="Cargando mensajes…" />
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={messages.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState icon="chatbubble-ellipses-outline" title="Sin mensajes personalizados" description="Créalos desde el panel web." />
          }
          renderItem={({ item }) => (
            <ListRow
              title={item.name}
              subtitle={item.body}
              onPress={() => {
                setSelected(item);
                setBody(item.body);
              }}
              left={
                item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={styles.thumb} contentFit="cover" />
                ) : (
                  <View style={[styles.thumb, styles.thumbFallback]}>
                    <Ionicons name="chatbubble-ellipses" size={18} color={colors.primary} />
                  </View>
                )
              }
              meta={
                <View style={styles.metaRow}>
                  {item.isActive ? <Badge label="Activo" bg={colors.successSoft} fg={colors.success} icon="checkmark-circle" /> : null}
                  <Badge label={item.kind} />
                  {item.channels.length === 0 ? (
                    <Badge label="Todos los canales" />
                  ) : (
                    item.channels.map((channel) => <Badge key={channel} label={channelLabels[channel] ?? channel} />)
                  )}
                  {item.buttons.length > 0 ? <Badge label={`${item.buttons.length} botones`} icon="apps" /> : null}
                </View>
              }
            />
          )}
        />
      )}

      <Sheet
        visible={!!selected && !editing}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        description={selected?.isActive ? "Activo ahora mismo" : "Inactivo"}
      >
        {selected ? (
          <>
            <Text style={styles.body}>{selected.body}</Text>
            {selected.buttons.length > 0 ? (
              <View style={styles.buttonPreview}>
                {selected.buttons.map((button) => (
                  <View key={button.id} style={styles.fakeButton}>
                    <Text style={styles.fakeButtonText}>{button.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {!selected.isActive ? (
              <SheetAction
                icon="checkmark-circle"
                label="Activar este mensaje"
                description="Desactiva cualquier otro del mismo tipo."
                tint={colors.success}
                onPress={() =>
                  activateMessage.mutate(
                    { id: selected.id, data: { isActive: true } },
                    {
                      onSuccess: () => {
                        setSelected(null);
                        invalidate();
                      },
                      onError: (err) => Alert.alert("No se pudo activar", errorMessage(err)),
                    },
                  )
                }
              />
            ) : null}

            <SheetAction icon="create" label="Editar texto" onPress={() => setEditing(true)} />

            <SheetAction
              icon="trash"
              label="Eliminar"
              tint={colors.destructive}
              onPress={() =>
                Alert.alert("Eliminar mensaje", `"${selected.name}" se borrará.`, [
                  { text: "Cancelar", style: "cancel" },
                  {
                    text: "Eliminar",
                    style: "destructive",
                    onPress: () =>
                      deleteMessage.mutate(
                        { id: selected.id },
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
          </>
        ) : null}
      </Sheet>

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Editar texto">
        <View style={styles.form}>
          <Field label="Mensaje" value={body} onChangeText={setBody} multiline />
          <Button
            label="Guardar"
            loading={updateMessage.isPending}
            onPress={() =>
              updateMessage.mutate(
                { id: selected!.id, data: { body } },
                {
                  onSuccess: () => {
                    setEditing(false);
                    setSelected(null);
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

const styles = StyleSheet.create({
  header: { padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerText: { fontSize: 11, color: colors.mutedForeground, lineHeight: 16 },
  separator: { height: 1, backgroundColor: colors.border },
  thumb: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  thumbFallback: { alignItems: "center", justifyContent: "center" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  body: { fontSize: 13, color: colors.foreground, lineHeight: 19, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  buttonPreview: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 6 },
  fakeButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 8,
    alignItems: "center",
  },
  fakeButtonText: { fontSize: 13, fontWeight: "600", color: colors.primary },
  form: { padding: spacing.lg, gap: spacing.md },
});
