import { useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOrders,
  useUpdateOrder,
  getListOrdersQueryKey,
  type Order,
  type OrderStatus,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet, SheetAction } from "../src/components/Sheet";
import { Badge, EmptyState, ListRow, Loading, SearchInput, Chips } from "../src/components/ui";
import { errorMessage, formatDateTime } from "../src/lib/format";
import { openMedia } from "../src/lib/media";
import { colors, spacing } from "../src/theme";

// Pedidos: lo mismo que la vista del panel web, desde el teléfono. Lo que se
// hace aquí de verdad es mover el estado —el pedido entra solo cuando el cliente
// dice que pagó— y mirar el comprobante; darlo de alta a mano sigue siendo cosa
// del panel, que es donde se busca al cliente con calma.

const FILTERS = ["all", "pending", "processing", "shipped", "delivered", "cancelled"] as const;
const STATUSES: OrderStatus[] = ["pending", "processing", "shipped", "delivered", "cancelled"];

const STATUS_LABELS: Record<string, string> = {
  all: "Todos",
  pending: "Pendiente",
  processing: "En proceso",
  shipped: "Enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

const STATUS_TINT: Record<string, { bg: string; fg: string }> = {
  pending: { bg: colors.warningSoft, fg: colors.warning },
  processing: { bg: colors.infoSoft, fg: colors.info },
  shipped: { bg: colors.botSoft, fg: colors.bot },
  delivered: { bg: colors.successSoft, fg: colors.success },
  cancelled: { bg: colors.muted, fg: colors.mutedForeground },
};

const STATUS_ICON: Record<OrderStatus, "hourglass" | "construct" | "airplane" | "checkmark-done" | "close-circle"> = {
  pending: "hourglass",
  processing: "construct",
  shipped: "airplane",
  delivered: "checkmark-done",
  cancelled: "close-circle",
};

// El pago según Shopify, en palabras del equipo (como en el panel web).
const SHOPIFY_PAYMENT_LABELS: Record<string, string> = {
  PAID: "pagado",
  PARTIALLY_PAID: "pago parcial",
  PENDING: "pago pendiente",
  AUTHORIZED: "pago autorizado",
  PARTIALLY_REFUNDED: "reembolso parcial",
  REFUNDED: "reembolsado",
  VOIDED: "pago anulado",
  EXPIRED: "pago vencido",
};

function shopifyPaymentLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return SHOPIFY_PAYMENT_LABELS[status.toUpperCase()] ?? status.toLowerCase().replace(/_/g, " ");
}

function money(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return "—";
  return `${currency === "DOP" ? "RD$" : "US$"}${amount.toLocaleString("es-DO")}`;
}

// Los totales de las líneas vienen en centavos (2026-10-04).
function cents(value: number, currency: string | null | undefined): string {
  return `${currency === "DOP" ? "RD$" : "US$"}${(value / 100).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function OrdersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isFetching, refetch } = useListOrders({
    status: filter === "all" ? undefined : filter,
    search: debounced || undefined,
  });
  const updateOrder = useUpdateOrder();

  const orders = data ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });

  const changeStatus = (order: Order, status: OrderStatus) =>
    updateOrder.mutate(
      { id: order.id, data: { status } },
      {
        onSuccess: (updated) => {
          setSelected(updated);
          invalidate();
        },
        onError: (err) => Alert.alert("No se pudo cambiar el estado", errorMessage(err)),
      },
    );

  const open = (url: string | null | undefined, what: string) => {
    if (!url) return;
    openMedia(url).catch((err) => Alert.alert(`No se pudo abrir ${what}`, errorMessage(err)));
  };

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <SearchInput value={search} onChangeText={setSearch} placeholder="Código, cliente o teléfono…" />
        <Chips options={FILTERS} value={filter} onChange={setFilter} labels={STATUS_LABELS} />
      </View>

      {isLoading && orders.length === 0 ? (
        <Loading label="Cargando pedidos…" />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={orders.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="clipboard-outline"
              title="Sin pedidos"
              description={filter === "all" ? "Se abren solos cuando el cliente confirma que pagó." : `Nada en "${STATUS_LABELS[filter]}".`}
            />
          }
          renderItem={({ item }) => {
            const tint = STATUS_TINT[item.status] ?? STATUS_TINT.pending;
            return (
              <ListRow
                title={`${item.code} · ${item.contactName ?? "Sin nombre"}`}
                subtitle={item.product ? `${item.product}${item.quantity > 1 ? ` x${item.quantity}` : ""}` : "Sin producto"}
                onPress={() => setSelected(item)}
                meta={
                  <View style={styles.metaRow}>
                    <Badge label={STATUS_LABELS[item.status] ?? item.status} bg={tint.bg} fg={tint.fg} />
                    {item.items.length > 0 ? (
                      <Badge label={cents(item.totalCents, item.priceCurrency)} icon="cash" />
                    ) : item.amount != null ? (
                      <Badge label={money(item.amount, item.currency)} icon="cash" />
                    ) : null}
                    {item.externalName ? (
                      <Badge
                        label={`Shopify ${item.externalName}${shopifyPaymentLabel(item.externalFinancialStatus) ? ` · ${shopifyPaymentLabel(item.externalFinancialStatus)}` : ""}`}
                        icon="bag-handle"
                      />
                    ) : null}
                    {item.isSubscription ? <Badge label="Suscripción" icon="repeat" bg={colors.botSoft} fg={colors.bot} /> : null}
                    {item.paymentProofUrl ? (
                      <Badge label="Comprobante" icon="receipt" bg={colors.primarySoft} fg={colors.primary} />
                    ) : null}
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
        title={selected?.code ?? ""}
        description={selected ? `${selected.contactName ?? "Sin nombre"} · ${STATUS_LABELS[selected.status]}` : undefined}
      >
        {selected ? (
          <View style={styles.detail}>
            {selected.contactPhone ? <Text style={styles.meta}>Teléfono: {selected.contactPhone}</Text> : null}
            {selected.email ? <Text style={styles.meta}>Correo: {selected.email}</Text> : null}
            <Text style={styles.meta}>
              Producto: {selected.product ?? "—"}
              {selected.quantity > 1 ? ` x${selected.quantity}` : ""}
            </Text>
            {selected.items.length > 0 ? (
              <Text style={styles.meta}>
                Total: {cents(selected.totalCents, selected.priceCurrency)}
                {selected.discountCents ? ` (descuento ${cents(selected.discountCents, selected.priceCurrency)})` : ""}
              </Text>
            ) : null}
            <Text style={styles.meta}>Transferido: {money(selected.amount, selected.currency)}</Text>
            {selected.externalName ? (
              <Text style={styles.meta}>
                Shopify: {selected.externalName}
                {shopifyPaymentLabel(selected.externalFinancialStatus) ? ` · ${shopifyPaymentLabel(selected.externalFinancialStatus)}` : ""}
              </Text>
            ) : null}
            {selected.externalNote ? <Text style={styles.meta}>Comentario (Shopify): {selected.externalNote}</Text> : null}
            {selected.address ? <Text style={styles.meta}>Dirección: {selected.address}</Text> : null}
            {selected.notes ? <Text style={styles.meta}>Notas: {selected.notes}</Text> : null}
            <Text style={styles.meta}>
              Abierto: {formatDateTime(selected.createdAt)}
              {selected.createdByAgentName ? ` · a mano por ${selected.createdByAgentName}` : " · por el bot"}
            </Text>
          </View>
        ) : null}

        {selected?.paymentProofUrl ? (
          <SheetAction
            icon="receipt"
            label="Ver comprobante de pago"
            tint={colors.primary}
            onPress={() => open(selected.paymentProofUrl, "el comprobante")}
          />
        ) : null}
        {selected?.shippingLabelUrl ? (
          <SheetAction
            icon="document-attach"
            label="Ver guía de envío"
            tint={colors.primary}
            onPress={() => open(selected.shippingLabelUrl, "la guía")}
          />
        ) : null}
        {selected?.conversationId ? (
          <SheetAction
            icon="chatbubbles"
            label="Abrir la conversación"
            onPress={() => {
              const id = selected.conversationId;
              setSelected(null);
              router.push(`/chat/${id}`);
            }}
          />
        ) : null}

        {selected ? (
          <>
            <Text style={styles.sectionTitle}>Cambiar el estado</Text>
            {STATUSES.filter((s) => s !== selected.status).map((status) => (
              <SheetAction
                key={status}
                icon={STATUS_ICON[status]}
                label={STATUS_LABELS[status]}
                tint={status === "cancelled" ? colors.destructive : colors.foreground}
                disabled={updateOrder.isPending}
                onPress={() => changeStatus(selected, status)}
              />
            ))}
          </>
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
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 2,
  },
});
