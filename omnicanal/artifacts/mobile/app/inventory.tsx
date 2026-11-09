import { useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useListStock, useListLots, getListLotsQueryKey, type StockRow } from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet } from "../src/components/Sheet";
import { Badge, Chips, EmptyState, ListRow, Loading, SearchInput } from "../src/components/ui";
import { colors, spacing } from "../src/theme";

// Inventario desde el teléfono: consultar, no mover. Lo que hay en mano, lo que
// ya está vendido (comprometido), lo que queda disponible y lo que vence pronto.
// Ajustes, transferencias y recepciones se hacen en el panel web (2026-10-04).

const FILTERS = ["all", "low"] as const;
const FILTER_LABELS: Record<string, string> = { all: "Todo", low: "Bajo mínimo" };

function day(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("es-DO", { day: "numeric", month: "short", year: "numeric" });
}

function LotsOf({ row }: { row: StockRow }) {
  const params = { productId: row.productId, warehouseId: row.warehouseId, withStock: true };
  const { data: lots } = useListLots(params, { query: { queryKey: getListLotsQueryKey(params) } });
  if (!lots) return <Loading />;
  if (lots.length === 0) return <Text style={styles.meta}>Sin lotes con existencia.</Text>;
  return (
    <View style={{ gap: 6 }}>
      {lots.map((lot) => (
        <View key={lot.id} style={styles.lot}>
          <Text style={styles.lotTitle}>Lote {lot.label}</Text>
          <Text style={styles.meta}>
            {lot.balances.find((b) => b.warehouseId === row.warehouseId)?.quantity ?? lot.quantity} en almacén · vence {day(lot.expiryDate)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function InventoryScreen() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<StockRow | null>(null);
  const { data, isLoading, isFetching, refetch } = useListStock({ status: filter === "low" ? "low" : undefined });
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter((r) => !term || r.productName.toLowerCase().includes(term) || (r.sku ?? "").toLowerCase().includes(term));
  }, [data, search]);

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <SearchInput value={search} onChangeText={setSearch} placeholder="Producto o SKU…" />
        <Chips options={FILTERS} value={filter} onChange={setFilter} labels={FILTER_LABELS} />
      </View>
      {isLoading && rows.length === 0 ? (
        <Loading label="Cargando existencias…" />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => `${r.productId}:${r.warehouseId}`}
          contentContainerStyle={rows.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={<EmptyState icon="cube-outline" title={filter === "low" ? "Nada bajo el mínimo" : "Sin existencias"} description="Las existencias se cargan en el panel web (Inventario → Ajustes)." />}
          renderItem={({ item }) => {
            const tint =
              item.status === "negative"
                ? { bg: colors.destructiveSoft, fg: colors.destructive }
                : item.status === "low"
                  ? { bg: colors.warningSoft, fg: colors.warning }
                  : { bg: colors.successSoft, fg: colors.success };
            return (
              <ListRow
                title={item.productName}
                subtitle={item.warehouseName}
                onPress={() => setSelected(item)}
                meta={
                  <View style={styles.metaRow}>
                    <Badge label={`Disponible ${item.available}`} bg={tint.bg} fg={tint.fg} />
                    <Badge label={`En mano ${item.onHand}`} />
                    {item.committed ? <Badge label={`Vendido ${item.committed}`} bg={colors.infoSoft} fg={colors.info} /> : null}
                    {item.nextExpiry ? <Badge label={`Vence ${day(item.nextExpiry)}`} icon="time" /> : null}
                  </View>
                }
              />
            );
          }}
        />
      )}
      <Sheet visible={!!selected} onClose={() => setSelected(null)} title={selected?.productName ?? ""} description={selected ? `${selected.warehouseName}${selected.sku ? ` · ${selected.sku}` : ""}` : undefined}>
        {selected ? (
          <View style={styles.detail}>
            <Text style={styles.meta}>En mano: {selected.onHand}</Text>
            <Text style={styles.meta}>Vendido sin despachar: {selected.committed}</Text>
            <Text style={styles.meta}>Disponible: {selected.available}</Text>
            {selected.onOrder || selected.requested ? <Text style={styles.meta}>Por recibir: {selected.onOrder + selected.requested}</Text> : null}
            {selected.minQuantity != null ? (
              <Text style={styles.meta}>
                Punto de reorden: {selected.minQuantity} → {selected.targetQuantity}
                {selected.need ? ` · pedir ${selected.need}` : ""}
              </Text>
            ) : null}
            <Text style={styles.section}>Lotes (sale primero el que vence antes)</Text>
            <LotsOf row={selected} />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  separator: { height: 1, backgroundColor: colors.border },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  detail: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 4 },
  meta: { fontSize: 12, color: colors.mutedForeground },
  section: { fontSize: 11, fontWeight: "700", color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5, paddingTop: spacing.md },
  lot: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8 },
  lotTitle: { fontSize: 13, fontWeight: "600", color: colors.foreground },
});
