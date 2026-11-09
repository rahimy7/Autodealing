import { useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAgentLessons,
  useUpdateAgentLesson,
  getListAgentLessonsQueryKey,
  type AgentLesson,
  type AgentLessonStatus,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet, SheetAction } from "../src/components/Sheet";
import { Badge, Button, Chips, EmptyState, Field, Loading } from "../src/components/ui";
import { errorMessage, formatDateTime } from "../src/lib/format";
import { colors, radius, spacing } from "../src/theme";

// Aprendizajes: lo que los agentes virtuales sacaron de chats reales donde una
// respuesta frustró al cliente o una persona tuvo que corregirla. Se entra por
// las sugeridas, que son las que esperan una decisión; las activas ya las leen
// todos los agentes.

const FILTERS = ["suggested", "active", "dismissed", "all"] as const;
const FILTER_LABELS: Record<string, string> = {
  suggested: "Sugeridas",
  active: "Activas",
  dismissed: "Descartadas",
  all: "Todas",
};

const STATUS_LABELS: Record<AgentLessonStatus, string> = {
  suggested: "Sugerida",
  active: "Activa",
  dismissed: "Descartada",
};

const STATUS_TINT: Record<AgentLessonStatus, { bg: string; fg: string }> = {
  suggested: { bg: colors.warningSoft, fg: colors.warning },
  active: { bg: colors.successSoft, fg: colors.success },
  dismissed: { bg: colors.muted, fg: colors.mutedForeground },
};

const SIGNAL_LABELS: Record<string, string> = {
  frustration: "El cliente se frustró",
  human_correction: "Una persona lo corrigió",
};

export default function LearningScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("suggested");
  const [selected, setSelected] = useState<AgentLesson | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  const { data, isLoading, isFetching, refetch } = useListAgentLessons(filter === "all" ? {} : { status: filter });
  const update = useUpdateAgentLesson();

  const lessons = data ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAgentLessonsQueryKey() });

  const close = () => {
    setSelected(null);
    setEditing(false);
  };

  const save = (data: { status?: AgentLessonStatus; lesson?: string }) => {
    if (!selected) return;
    update.mutate(
      { id: selected.id, data },
      {
        onSuccess: () => {
          invalidate();
          close();
        },
        onError: (err) => Alert.alert("No se pudo guardar", errorMessage(err)),
      },
    );
  };

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          Una sugerida se activa sola cuando se repite en otra conversación. Las activas las leen todos los agentes.
        </Text>
        <Chips options={FILTERS} value={filter} onChange={setFilter} labels={FILTER_LABELS} />
      </View>

      {isLoading && lessons.length === 0 ? (
        <Loading label="Cargando aprendizajes…" />
      ) : (
        <FlatList
          data={lessons}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={lessons.length === 0 ? { flexGrow: 1 } : { padding: spacing.lg, gap: spacing.md }}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="bulb-outline"
              title={filter === "suggested" ? "Nada esperando revisión" : "Sin aprendizajes aquí"}
              description="Se escriben solos cuando un chat sale mal."
            />
          }
          renderItem={({ item }) => {
            const tint = STATUS_TINT[item.status];
            return (
              <Pressable
                onPress={() => {
                  setSelected(item);
                  setText(item.lesson);
                  setEditing(false);
                }}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
              >
                <View style={styles.cardHeader}>
                  <Badge label={STATUS_LABELS[item.status]} bg={tint.bg} fg={tint.fg} />
                  <Text style={styles.meta}>
                    {item.occurrences} {item.occurrences === 1 ? "conversación" : "conversaciones"} · {formatDateTime(item.lastSeenAt)}
                  </Text>
                </View>
                <Text style={styles.lesson}>{item.lesson}</Text>
                {item.diagnosis ? (
                  <Text style={styles.meta} numberOfLines={2}>
                    Qué pasó: {item.diagnosis}
                  </Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}

      <Sheet
        visible={!!selected}
        onClose={close}
        title="Aprendizaje"
        description={
          selected
            ? `${STATUS_LABELS[selected.status]} · visto en ${selected.occurrences} ${selected.occurrences === 1 ? "conversación" : "conversaciones"}`
            : undefined
        }
      >
        {selected && !editing ? (
          <>
            <View style={styles.detail}>
              <Text style={styles.lesson}>{selected.lesson}</Text>
              {selected.diagnosis ? <Text style={styles.meta}>Qué pasó: {selected.diagnosis}</Text> : null}

              {selected.evidence.slice(0, 3).map((evidence) => (
                <View key={evidence.id} style={styles.evidence}>
                  <Text style={styles.meta}>
                    {SIGNAL_LABELS[evidence.signal] ?? evidence.signal}
                    {evidence.contactName ? ` · ${evidence.contactName}` : ""} · {formatDateTime(evidence.createdAt)}
                  </Text>
                  <Text style={styles.evidenceLabel}>Respondió el agente</Text>
                  <Text style={styles.evidenceBody}>{evidence.aiReply}</Text>
                  <Text style={styles.evidenceLabel}>
                    {evidence.signal === "frustration" ? "Reaccionó el cliente" : "Escribió la persona"}
                  </Text>
                  <Text style={styles.evidenceBody}>{evidence.reaction}</Text>
                  <Text
                    style={styles.link}
                    onPress={() => {
                      const id = evidence.conversationId;
                      close();
                      router.push(`/chat/${id}`);
                    }}
                  >
                    Ver el chat →
                  </Text>
                </View>
              ))}
            </View>

            {selected.status !== "active" ? (
              <SheetAction
                icon="checkmark-circle"
                label="Activar"
                description="Los agentes lo aplican desde ya"
                tint={colors.success}
                disabled={update.isPending}
                onPress={() => save({ status: "active" })}
              />
            ) : null}
            {selected.status !== "dismissed" ? (
              <SheetAction
                icon="close-circle"
                label="Descartar"
                tint={colors.destructive}
                disabled={update.isPending}
                onPress={() => save({ status: "dismissed" })}
              />
            ) : null}
            <SheetAction icon="create" label="Editar el texto" onPress={() => setEditing(true)} />
          </>
        ) : null}

        {selected && editing ? (
          <View style={styles.form}>
            <Field
              label="Cómo lo lee el agente"
              value={text}
              onChangeText={setText}
              multiline
              maxLength={400}
              hint={`${text.length}/400`}
            />
            <View style={styles.formButtons}>
              <Button
                label="Cancelar"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => {
                  setText(selected.lesson);
                  setEditing(false);
                }}
              />
              <Button
                label="Guardar"
                style={{ flex: 1 }}
                loading={update.isPending}
                disabled={!text.trim()}
                onPress={() => save({ lesson: text.trim() })}
              />
            </View>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerText: { fontSize: 12, color: colors.mutedForeground, lineHeight: 17 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: 6,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  lesson: { fontSize: 14, fontWeight: "600", color: colors.foreground, lineHeight: 20 },
  meta: { fontSize: 11, color: colors.mutedForeground },
  detail: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  evidence: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 3,
  },
  evidenceLabel: { fontSize: 10, fontWeight: "700", color: colors.mutedForeground, textTransform: "uppercase", marginTop: 4 },
  evidenceBody: { fontSize: 12, color: colors.foreground, lineHeight: 17 },
  link: { fontSize: 12, fontWeight: "700", color: colors.primary, marginTop: 6 },
  form: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  formButtons: { flexDirection: "row", gap: spacing.md },
});
