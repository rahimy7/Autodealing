import { useEffect, useState } from "react";
import { Alert, FlatList, Linking, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useListShopifySubscribers, type ShopifySubscriber, type ShopifySubscriberStatus } from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet, SheetAction } from "../src/components/Sheet";
import { Badge, EmptyState, ListRow, Loading, SearchInput, Chips } from "../src/components/ui";
import { errorMessage, formatDate, formatDateTime, timeAgo } from "../src/lib/format";
import { colors, spacing } from "../src/theme";

// Suscripciones: la misma lista del panel web (los clientes con suscripción en
// Shopify y su estado), para mirarla desde el teléfono. Releer la tienda a pedido
// se hace desde el panel; aquí se ve lo último que se leyó (cada 6 horas).

const FILTERS = ["ACTIVE", "PAUSED", "FAILED", "CANCELLED", "EXPIRED", "all"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABELS: Record<Filter, string> = {
  ACTIVE: "Activas",
  PAUSED: "Pausadas",
  FAILED: "Pago fallido",
  CANCELLED: "Canceladas",
  EXPIRED: "Vencidas",
  all: "Todas",
};

const STATUS_LABELS: Record<ShopifySubscriberStatus, string> = {
  ACTIVE: "Activa",
  PAUSED: "Pausada",
  FAILED: "Pago fallido",
  CANCELLED: "Cancelada",
  EXPIRED: "Vencida",
};

const STATUS_TINT: Record<ShopifySubscriberStatus, { bg: string; fg: string }> = {
  ACTIVE: { bg: colors.successSoft, fg: colors.success },
  PAUSED: { bg: colors.warningSoft, fg: colors.warning },
  FAILED: { bg: colors.destructiveSoft, fg: colors.destructive },
  CANCELLED: { bg: colors.muted, fg: colors.mutedForeground },
  EXPIRED: { bg: colors.muted, fg: colors.mutedForeground },
};

function spent(valueCents: number, currency: string | null | undefined): string {
  return `${currency === "DOP" ? "RD$" : "US$"}${(valueCents / 100).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function SubscriptionsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("ACTIVE");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<ShopifySubscriber | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isFetching, refetch } = useListShopifySubscribers({
    status: filter === "all" ? undefined : filter,
    search: debounced || undefined,
  });

  const rows = data?.items ?? [];
  // Cada chip con su cuenta, como las pestañas del panel.
  const labels = Object.fromEntries(
    FILTERS.map((f) => [f, data ? `${FILTER_LABELS[f]} ${f === "all" ? data.total : data.counts[f]}` : FILTER_LABELS[f]]),
  ) as Record<Filter, string>;

  const openShopify = (url: string) => Linking.openURL(url).catch((err) => Alert.alert("No se pudo abrir Shopify", errorMessage(err)));

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <SearchInput value={search} onChangeText={setSearch} placeholder="Nombre, correo o teléfono…" />
        <Chips options={FILTERS} value={filter} onChange={setFilter} labels={labels} />
        {data ? (
          <Text style={[styles.meta, data.error ? { color: colors.destructive } : null]}>
            {!data.connected
              ? "Shopify no está conectado (Configuración → Shopify, en el panel)."
              : data.error
                ? `No se pudo leer Shopify: ${data.error}`
                : data.refreshing
                  ? "Leyendo los clientes de la tienda…"
                  : `Actualizado: ${data.syncedAt ? formatDateTime(data.syncedAt) : "nunca"} · cada 6 horas`}
          </Text>
        ) : null}
      </View>

      {isLoading && rows.length === 0 ? (
        <Loading label="Cargando suscripciones…" />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={rows.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="repeat"
              title="Sin suscripciones"
              description={filter === "all" ? "Aparecen cuando se lee la tienda de Shopify." : `Nada en "${FILTER_LABELS[filter]}".`}
            />
          }
          renderItem={({ item }) => {
            const tint = STATUS_TINT[item.status];
            return (
              <ListRow
                title={item.name ?? "Sin nombre"}
                subtitle={item.lastOrderProducts ?? item.email ?? item.phone ?? null}
                onPress={() => setSelected(item)}
                meta={
                  <View style={styles.metaRow}>
                    <Badge label={STATUS_LABELS[item.status]} bg={tint.bg} fg={tint.fg} />
                    {item.lastOrderAt ? <Badge label={`Último pedido ${timeAgo(item.lastOrderAt)}`} icon="bag-handle" /> : null}
                    {item.statusChangedAt ? <Badge label={`Cambió ${formatDate(item.statusChangedAt)}`} icon="swap-horizontal" /> : null}
                  </View>
                }
              />
            );
          }}
        />
      )}

      <Sheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? "Sin nombre"}
        description={selected ? STATUS_LABELS[selected.status] : undefined}
      >
        {selected ? (
          <View style={styles.detail}>
            {selected.email ? <Text style={styles.meta}>Correo: {selected.email}</Text> : null}
            {selected.phone ? <Text style={styles.meta}>Teléfono: {selected.phone}</Text> : null}
            {selected.lastOrderProducts ? <Text style={styles.meta}>Suscripción: {selected.lastOrderProducts}</Text> : null}
            {selected.sellingPlan ? <Text style={styles.meta}>Plan: {selected.sellingPlan}</Text> : null}
            {selected.lastOrderAt ? (
              <Text style={styles.meta}>
                Último pedido: {selected.lastOrderName ?? "—"} · {formatDate(selected.lastOrderAt)}
              </Text>
            ) : null}
            {selected.statusChangedAt ? (
              <Text style={styles.meta}>
                Cambio de estado visto el {formatDate(selected.statusChangedAt)}
                {selected.previousStatus && selected.previousStatus in STATUS_LABELS
                  ? ` (antes ${STATUS_LABELS[selected.previousStatus as ShopifySubscriberStatus].toLowerCase()})`
                  : ""}
              </Text>
            ) : null}
            <Text style={styles.meta}>
              {selected.ordersCount} pedidos · {spent(selected.amountSpentCents, selected.currency)} gastado
            </Text>
            {selected.customerSince ? <Text style={styles.meta}>Cliente desde {formatDate(selected.customerSince)}</Text> : null}
          </View>
        ) : null}
        {selected?.shopifyAdminUrl ? (
          <SheetAction icon="open-outline" label="Ver en Shopify" tint={colors.primary} onPress={() => openShopify(selected.shopifyAdminUrl!)} />
        ) : null}
        {selected?.contactId != null ? (
          <SheetAction
            icon="person"
            label="Ver contacto"
            onPress={() => {
              const id = selected.contactId;
              setSelected(null);
              router.push(`/contact/${id}`);
            }}
          />
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
  detail: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 3 },
  meta: { fontSize: 12, color: colors.mutedForeground },
});
