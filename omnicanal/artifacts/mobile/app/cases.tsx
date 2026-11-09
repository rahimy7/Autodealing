import { useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCases,
  useGetCase,
  useUpdateCase,
  useAddCaseEvent,
  useResolveCase,
  getListCasesQueryKey,
  getGetCaseQueryKey,
  type Case,
  type CaseStatus,
  type CaseResolutionKind,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet, SheetAction } from "../src/components/Sheet";
import { Badge, Button, EmptyState, Field, ListRow, Loading, SearchInput, Chips } from "../src/components/ui";
import { errorMessage, formatDateTime } from "../src/lib/format";
import { colors, spacing } from "../src/theme";

// Casos: peticiones que hay que gestionar y que no pueden quedarse en un chat.
// Se entra por "Pendientes", que no es un estado sino todo lo que sigue siendo
// trabajo — igual que en el panel web.

const FILTERS = ["pending", "open", "in_progress", "waiting_customer", "resolved", "all"] as const;

const FILTER_LABELS: Record<string, string> = {
  pending: "Pendientes",
  open: "Abiertos",
  in_progress: "En gestión",
  waiting_customer: "Esperando",
  resolved: "Resueltos",
  all: "Todos",
};

const STATUS_LABELS: Record<CaseStatus, string> = {
  open: "Abierto",
  in_progress: "En gestión",
  waiting_customer: "Esperando al cliente",
  resolved: "Resuelto",
  cancelled: "Cancelado",
};

const STATUS_TINT: Record<CaseStatus, { bg: string; fg: string }> = {
  open: { bg: colors.warningSoft, fg: colors.warning },
  in_progress: { bg: colors.infoSoft, fg: colors.info },
  waiting_customer: { bg: colors.botSoft, fg: colors.bot },
  resolved: { bg: colors.successSoft, fg: colors.success },
  cancelled: { bg: colors.muted, fg: colors.mutedForeground },
};

const PRIORITY_LABELS: Record<string, string> = { low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente" };

const TYPE_LABELS: Record<string, string> = {
  volume_discount: "Descuento por volumen",
  partnership: "Afiliados, distribución o alianza",
  subscription: "Afiliación o desafiliación",
  order_status: "Estado del pedido",
  order_error: "Error en el pedido",
  theft_report: "Robo o fraude",
  payment_issue: "Problema de pago",
  refund: "Devolución de dinero",
  cancellation: "Cancelación",
  address_change: "Cambio de datos de envío",
  product_quality: "Calidad del producto",
  product_question: "Consulta sobre el producto",
  other: "Otra petición",
};

const RESOLUTION_KINDS: Array<{ kind: CaseResolutionKind; label: string; icon: "chatbubble-ellipses" | "hammer" | "ban" }> = [
  { kind: "answered", label: "Se resolvió respondiendo", icon: "chatbubble-ellipses" },
  { kind: "actioned", label: "Se resolvió accionando", icon: "hammer" },
  { kind: "rejected", label: "Atendido, no procede", icon: "ban" },
];

type Mode = "detail" | "note" | "resolve";

export default function CasesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("pending");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("detail");
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [kind, setKind] = useState<CaseResolutionKind>("answered");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isFetching, refetch } = useListCases({
    status: filter === "all" ? undefined : filter,
    search: debounced || undefined,
  });
  const detail = useGetCase(selectedId ?? 0, {
    query: { queryKey: getGetCaseQueryKey(selectedId ?? 0), enabled: selectedId != null },
  });
  const updateCase = useUpdateCase();
  const addEvent = useAddCaseEvent();
  const resolveCase = useResolveCase();

  const cases = data ?? [];
  const current = detail.data?.case ?? null;
  const events = detail.data?.events ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
    if (selectedId != null) queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(selectedId) });
  };

  const close = () => {
    setSelectedId(null);
    setMode("detail");
    setNote("");
    setResolution("");
  };

  const openCase = (row: Case) => {
    setSelectedId(row.id);
    setMode("detail");
  };

  const changeStatus = (status: CaseStatus) => {
    if (selectedId == null) return;
    updateCase.mutate(
      { id: selectedId, data: { status } },
      { onSuccess: invalidate, onError: (err) => Alert.alert("No se pudo cambiar", errorMessage(err)) },
    );
  };

  const submitNote = () => {
    if (selectedId == null || !note.trim()) return;
    addEvent.mutate(
      { id: selectedId, data: { kind: "note", body: note.trim() } },
      {
        onSuccess: () => {
          setNote("");
          setMode("detail");
          invalidate();
        },
        onError: (err) => Alert.alert("No se pudo guardar la nota", errorMessage(err)),
      },
    );
  };

  const submitResolution = () => {
    if (selectedId == null || !resolution.trim()) {
      Alert.alert("Falta decir qué se hizo", "Un caso cerrado sin cuenta de lo que se hizo es justo lo que esta vista evita.");
      return;
    }
    resolveCase.mutate(
      { id: selectedId, data: { kind, resolution: resolution.trim() } },
      {
        onSuccess: () => {
          invalidate();
          close();
        },
        onError: (err) => Alert.alert("No se pudo resolver", errorMessage(err)),
      },
    );
  };

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <SearchInput value={search} onChangeText={setSearch} placeholder="Código, asunto o cliente…" />
        <Chips options={FILTERS} value={filter} onChange={setFilter} labels={FILTER_LABELS} />
      </View>

      {isLoading && cases.length === 0 ? (
        <Loading label="Cargando casos…" />
      ) : (
        <FlatList
          data={cases}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={cases.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="folder-open-outline"
              title="Sin casos aquí"
              description="Los abre la IA desde el correo y el chat cuando el cliente pide algo que hay que gestionar."
            />
          }
          renderItem={({ item }) => {
            const tint = STATUS_TINT[item.status];
            return (
              <ListRow
                title={item.subject}
                subtitle={`${item.code} · ${item.contactName ?? "Sin nombre"}`}
                onPress={() => openCase(item)}
                meta={
                  <View style={styles.metaRow}>
                    <Badge label={STATUS_LABELS[item.status]} bg={tint.bg} fg={tint.fg} />
                    {item.priority === "urgent" || item.priority === "high" ? (
                      <Badge
                        label={PRIORITY_LABELS[item.priority]}
                        bg={colors.destructiveSoft}
                        fg={colors.destructive}
                        icon="alert-circle"
                      />
                    ) : null}
                    <Badge label={TYPE_LABELS[item.type] ?? item.type} />
                    {item.openedByAi ? <Badge label="Abierto por IA" bg={colors.botSoft} fg={colors.bot} icon="sparkles" /> : null}
                  </View>
                }
              />
            );
          }}
        />
      )}

      <Sheet
        visible={selectedId != null}
        onClose={close}
        title={current ? current.subject : "Caso"}
        description={current ? `${current.code} · ${STATUS_LABELS[current.status]} · ${TYPE_LABELS[current.type] ?? current.type}` : undefined}
      >
        {detail.isLoading ? <Loading /> : null}

        {current && mode === "detail" ? (
          <>
            <View style={styles.detail}>
              <Text style={styles.meta}>
                Cliente: {current.contactName ?? "Sin nombre"}
                {current.contactEmail ? ` · ${current.contactEmail}` : current.contactPhone ? ` · ${current.contactPhone}` : ""}
              </Text>
              {current.requestedAction ? <Text style={styles.body}>Pide: {current.requestedAction}</Text> : null}
              {current.description ? <Text style={styles.body}>{current.description}</Text> : null}
              {current.resolution ? <Text style={styles.body}>Se resolvió así: {current.resolution}</Text> : null}
              <Text style={styles.meta}>
                Entró por {current.channel} · {formatDateTime(current.createdAt)}
                {current.assignedAgentName ? ` · ${current.assignedAgentName}` : ""}
              </Text>

              {events.length > 0 ? (
                <View style={{ gap: 4, marginTop: spacing.sm }}>
                  <Text style={styles.sectionTitleInline}>Lo que se ha hecho</Text>
                  {events.slice(-6).map((event) => (
                    <Text key={event.id} style={styles.event}>
                      • {event.body}
                      <Text style={styles.meta}>
                        {"  "}
                        {event.agentName ?? "IA"} · {formatDateTime(event.createdAt)}
                      </Text>
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>

            {current.status !== "resolved" ? (
              <>
                <SheetAction
                  icon="checkmark-done"
                  label="Resolver el caso"
                  description="Hay que decir qué se hizo"
                  tint={colors.success}
                  onPress={() => setMode("resolve")}
                />
                <SheetAction icon="create" label="Agregar una nota" onPress={() => setMode("note")} />
                {current.status !== "in_progress" ? (
                  <SheetAction
                    icon="construct"
                    label="Marcar en gestión"
                    disabled={updateCase.isPending}
                    onPress={() => changeStatus("in_progress")}
                  />
                ) : null}
                {current.status !== "waiting_customer" ? (
                  <SheetAction
                    icon="hourglass"
                    label="Esperando al cliente"
                    disabled={updateCase.isPending}
                    onPress={() => changeStatus("waiting_customer")}
                  />
                ) : null}
              </>
            ) : null}

            {current.conversationId ? (
              <SheetAction
                icon="chatbubbles"
                label="Abrir la conversación"
                onPress={() => {
                  const id = current.conversationId;
                  close();
                  router.push(`/chat/${id}`);
                }}
              />
            ) : null}
            {current.emailThreadId ? (
              <SheetAction
                icon="mail"
                label="Abrir el correo"
                onPress={() => {
                  const id = current.emailThreadId;
                  close();
                  router.push(`/email/${id}`);
                }}
              />
            ) : null}
          </>
        ) : null}

        {current && mode === "note" ? (
          <View style={styles.form}>
            <Field
              label="Nota"
              value={note}
              onChangeText={setNote}
              multiline
              placeholder="Lo que se averiguó o se habló"
            />
            <View style={styles.formButtons}>
              <Button label="Cancelar" variant="secondary" style={{ flex: 1 }} onPress={() => setMode("detail")} />
              <Button
                label="Guardar"
                style={{ flex: 1 }}
                loading={addEvent.isPending}
                disabled={!note.trim()}
                onPress={submitNote}
              />
            </View>
          </View>
        ) : null}

        {current && mode === "resolve" ? (
          <View style={styles.form}>
            <Text style={styles.sectionTitleInline}>Cómo se resolvió</Text>
            {RESOLUTION_KINDS.map((option) => (
              <SheetAction
                key={option.kind}
                icon={option.icon}
                label={option.label}
                selected={kind === option.kind}
                onPress={() => setKind(option.kind)}
              />
            ))}
            <Field
              label="Qué se le dijo o qué se hizo"
              value={resolution}
              onChangeText={setResolution}
              multiline
              placeholder="Queda escrito en el caso"
            />
            <View style={styles.formButtons}>
              <Button label="Cancelar" variant="secondary" style={{ flex: 1 }} onPress={() => setMode("detail")} />
              <Button
                label="Resolver"
                style={{ flex: 1 }}
                loading={resolveCase.isPending}
                disabled={!resolution.trim()}
                onPress={submitResolution}
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
  separator: { height: 1, backgroundColor: colors.border },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  detail: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 4 },
  body: { fontSize: 13, color: colors.foreground, lineHeight: 19 },
  meta: { fontSize: 11, color: colors.mutedForeground },
  event: { fontSize: 12, color: colors.foreground, lineHeight: 18 },
  sectionTitleInline: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  form: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  formButtons: { flexDirection: "row", gap: spacing.md },
});
