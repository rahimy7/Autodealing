import { useState } from "react";
import { Alert, FlatList, Linking, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListShipments,
  getListShipmentsQueryKey,
  useMarkShipmentStopDelivered,
  useMarkShipmentStopFailed,
  type Shipment,
  type ShipmentStatus,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet } from "../src/components/Sheet";
import { Badge, Button, Chips, EmptyState, ListRow, Loading } from "../src/components/ui";
import { errorMessage, formatDateTime } from "../src/lib/format";
import { colors, spacing } from "../src/theme";

// Despachos en el teléfono, sobre todo para quien reparte: ver las paradas del
// viaje, llamar al cliente, abrir la dirección en el mapa y marcar cada una
// entregada o no entregada (lo que no se entrega vuelve al almacén, al mismo
// lote). Armar el despacho y registrar la salida se hace en el panel web.

const FILTERS = ["dispatched", "planning", "completed"] as const;
const FILTER_LABELS: Record<string, string> = { dispatched: "En ruta", planning: "Armando", completed: "Cerrados" };

export default function ShipmentsScreen() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("dispatched");
  const params = { status: filter as ShipmentStatus };
  const { data, isLoading, isFetching, refetch } = useListShipments(params, { query: { queryKey: getListShipmentsQueryKey(params) } });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [failing, setFailing] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const delivered = useMarkShipmentStopDelivered();
  const failed = useMarkShipmentStopFailed();
  const shipments = data ?? [];
  const selected: Shipment | undefined = shipments.find((s) => s.id === selectedId);

  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/shipments") });

  const markDelivered = (shipment: Shipment, orderId: number) =>
    delivered.mutate({ id: shipment.id, orderId }, { onSuccess: () => void refresh(), onError: (err) => Alert.alert("No se pudo marcar", errorMessage(err)) });

  const markFailed = (shipment: Shipment, orderId: number) =>
    failed.mutate(
      { id: shipment.id, orderId, data: { reason: reason.trim() || null } },
      {
        onSuccess: () => {
          setFailing(null);
          setReason("");
          void refresh();
        },
        onError: (err) => Alert.alert("No se pudo marcar", errorMessage(err)),
      },
    );

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Chips options={FILTERS} value={filter} onChange={setFilter} labels={FILTER_LABELS} />
      </View>
      {isLoading && shipments.length === 0 ? (
        <Loading label="Cargando despachos…" />
      ) : (
        <FlatList
          data={shipments}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={shipments.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={<EmptyState icon="car-outline" title="Sin despachos" description={`Nada en "${FILTER_LABELS[filter]}".`} />}
          renderItem={({ item }) => {
            const done = item.stops.filter((s) => s.deliveryStatus !== "pending").length;
            return (
              <ListRow
                title={`${item.code} · ${item.kind === "trip" ? "Viaje" : "Courier"}`}
                subtitle={[item.carrierName, item.driverName, item.vehicle].filter(Boolean).join(" · ") || item.warehouseName}
                onPress={() => setSelectedId(item.id)}
                meta={
                  <View style={styles.metaRow}>
                    <Badge label={`${done}/${item.stops.length} paradas`} bg={colors.infoSoft} fg={colors.info} />
                    {item.dispatchedAt ? <Badge label={`Salió ${formatDateTime(item.dispatchedAt)}`} icon="time" /> : null}
                  </View>
                }
              />
            );
          }}
        />
      )}
      <Sheet visible={!!selected} onClose={() => { setSelectedId(null); setFailing(null); }} title={selected?.code ?? ""} description={selected ? `${selected.stops.length} paradas` : undefined}>
        {selected?.stops.map((stop) => (
          <View key={stop.id} style={styles.stop}>
            <Text style={styles.stopTitle}>
              {stop.sequence}. {stop.orderCode} · {stop.contactName ?? "Sin nombre"}
            </Text>
            {stop.product ? <Text style={styles.meta}>{stop.product}</Text> : null}
            {stop.address ? <Text style={styles.meta}>{stop.address}</Text> : null}
            {stop.trackingNumber ? <Text style={styles.meta}>Guía {stop.trackingNumber}</Text> : null}
            <View style={styles.actions}>
              {stop.contactPhone ? <Button size="sm" variant="secondary" icon="call" label="Llamar" onPress={() => Linking.openURL(`tel:${stop.contactPhone}`)} /> : null}
              {stop.address ? <Button size="sm" variant="secondary" icon="map" label="Mapa" onPress={() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(stop.address ?? "")}`)} /> : null}
            </View>
            {selected.status === "dispatched" && stop.deliveryStatus === "pending" ? (
              failing === stop.orderId ? (
                <View style={{ gap: 6 }}>
                  <TextInput value={reason} onChangeText={setReason} placeholder="¿Por qué no se entregó?" style={styles.input} placeholderTextColor={colors.mutedForeground} />
                  <View style={styles.actions}>
                    <Button size="sm" variant="ghost" label="Cancelar" onPress={() => setFailing(null)} />
                    <Button size="sm" variant="danger" label="Vuelve al almacén" loading={failed.isPending} onPress={() => markFailed(selected, stop.orderId)} />
                  </View>
                </View>
              ) : (
                <View style={styles.actions}>
                  <Button size="sm" icon="checkmark-done" label="Entregado" loading={delivered.isPending} onPress={() => markDelivered(selected, stop.orderId)} />
                  <Button size="sm" variant="secondary" icon="close-circle" label="No entregado" onPress={() => { setFailing(stop.orderId); setReason(""); }} />
                </View>
              )
            ) : (
              <Text style={[styles.meta, stop.deliveryStatus === "delivered" ? { color: colors.success } : stop.deliveryStatus === "failed" ? { color: colors.destructive } : null]}>
                {stop.deliveryStatus === "delivered" ? `Entregado ${formatDateTime(stop.deliveredAt)}` : stop.deliveryStatus === "failed" ? `No entregado${stop.failureReason ? `: ${stop.failureReason}` : ""}` : "Por salir"}
              </Text>
            )}
          </View>
        ))}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  separator: { height: 1, backgroundColor: colors.border },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  stop: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  stopTitle: { fontSize: 14, fontWeight: "600", color: colors.foreground },
  meta: { fontSize: 12, color: colors.mutedForeground },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: colors.foreground },
});
