import { useEffect, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import {
  useListErrorLogs,
  useClearErrorLogs,
  getListErrorLogsQueryKey,
  type ErrorLog,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Badge, Button, Chips, EmptyState, Loading, SearchInput } from "../src/components/ui";
import { errorMessage } from "../src/lib/format";
import { colors, radius, spacing } from "../src/theme";

// Lo que falló en el servidor, sin tener que entrar al hosting. Se guardan 14
// días. La lista se consulta sola mientras la pantalla está abierta: quien la
// mira suele estar esperando a ver si algo vuelve a fallar.
const POLL_MS = 15_000;

const LEVELS = ["all", "error", "fatal"] as const;
const LEVEL_LABELS: Record<string, string> = { all: "Todos", error: "Errores", fatal: "Fatales" };

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-DO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// El detalle se guarda como JSON en una sola línea; leerlo así no hay quien pueda.
function prettyDetail(detail: string): string {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}

function LogRow({ log }: { log: ErrorLog }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((v) => !v)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.muted }]}>
      <View style={styles.rowHeader}>
        <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={14} color={colors.mutedForeground} />
        <Badge
          label={log.level}
          bg={log.level === "fatal" ? colors.destructiveSoft : colors.warningSoft}
          fg={log.level === "fatal" ? colors.destructive : colors.warning}
        />
        <Text style={styles.message}>{log.message}</Text>
      </View>
      <Text style={styles.meta}>
        {formatWhen(log.createdAt)}
        {log.url ? ` · ${log.method ?? ""} ${log.url}` : ""}
        {log.requestId ? ` · #${log.requestId}` : ""}
      </Text>
      {open ? (
        <Text style={styles.detail} selectable>
          {log.detail ? prettyDetail(log.detail) : "Sin detalle."}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function LogsScreen() {
  const queryClient = useQueryClient();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = { level, search: debounced || undefined };
  const { data, isLoading, isFetching, refetch } = useListErrorLogs(params, {
    query: { queryKey: getListErrorLogsQueryKey(params), refetchInterval: POLL_MS, staleTime: 0 },
  });
  const clearLogs = useClearErrorLogs();

  const logs = data ?? [];

  const confirmClear = () =>
    Alert.alert("Vaciar el registro", "Se borran todos los errores guardados. Los que ocurran después se seguirán registrando.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Vaciar",
        style: "destructive",
        onPress: () =>
          clearLogs.mutate(undefined, {
            onSuccess: (result) => {
              queryClient.invalidateQueries({ queryKey: getListErrorLogsQueryKey() });
              Alert.alert("Registro vaciado", `Se borraron ${result.deleted} registros.`);
            },
            onError: (err) => Alert.alert("No se pudieron borrar", errorMessage(err)),
          }),
      },
    ]);

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <SearchInput value={search} onChangeText={setSearch} placeholder="Mensaje, detalle o ruta…" />
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Chips options={LEVELS} value={level} onChange={setLevel} labels={LEVEL_LABELS} />
          </View>
          <Button
            label="Vaciar"
            icon="trash"
            variant="secondary"
            size="sm"
            loading={clearLogs.isPending}
            onPress={confirmClear}
          />
        </View>
      </View>

      {isLoading && logs.length === 0 ? (
        <Loading label="Cargando errores…" />
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={logs.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="shield-checkmark-outline"
              title={search || level !== "all" ? "Nada que coincida" : "Ningún error registrado"}
              description="Se guardan 14 días."
            />
          }
          renderItem={({ item }) => <LogRow log={item} />}
        />
      )}
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
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  separator: { height: 1, backgroundColor: colors.border },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 4, backgroundColor: colors.card },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  message: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.foreground },
  meta: { fontSize: 11, color: colors.mutedForeground, marginLeft: 22 },
  detail: {
    marginLeft: 22,
    marginTop: 4,
    padding: spacing.md,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    fontSize: 11,
    color: colors.foreground,
    fontFamily: "monospace",
  },
});
