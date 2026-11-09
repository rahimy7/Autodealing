import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useMarkConversationSale,
  useListConversationFollowups,
  useCancelConversationFollowup,
  useListProducts,
  getListConversationFollowupsQueryKey,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
  getListProductsQueryKey,
  getListMessagesQueryKey,
  type Conversation,
  type Followup,
} from "@workspace/api-client-react";
import { Sheet } from "./Sheet";
import { Button } from "./ui";
import { errorMessage } from "../lib/format";
import { colors, radius, spacing } from "../theme";

// "Venta cerrada" y los seguimientos de la conversación. Marcarla le dice al
// sistema que no hay venta que recuperar y que toca el post-venta; la IA también
// la detecta al cerrarse el chat, pero lo que marca una persona manda. Mismo
// comportamiento que el panel (omnicanal/src/components/SaleTracking.tsx).

const KIND_LABELS: Record<Followup["kind"], string> = {
  winback: "Recuperar venta",
  delivery_check: "Confirmar entrega",
  satisfaction: "Encuesta de satisfacción",
  repurchase: "Recordatorio de recompra",
  unanswered: "Respuesta pendiente",
};

const STATUS_LABELS: Record<Followup["status"], { label: string; bg: string; fg: string }> = {
  scheduled: { label: "Programado", bg: colors.infoSoft, fg: "#1D4ED8" },
  sent: { label: "Enviado", bg: colors.successSoft, fg: "#15803D" },
  replied: { label: "Respondió", bg: colors.botSoft, fg: "#6D28D9" },
  skipped: { label: "Omitido", bg: colors.muted, fg: colors.mutedForeground },
  cancelled: { label: "Cancelado", bg: colors.muted, fg: colors.mutedForeground },
  failed: { label: "Falló", bg: colors.destructiveSoft, fg: colors.destructive },
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("es-DO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function saleThisSession(conv: Conversation): boolean {
  if (!conv.saleClosedAt) return false;
  return new Date(conv.saleClosedAt).getTime() >= new Date(conv.sessionStartedAt).getTime();
}

export function SaleSheet({
  conversation,
  visible,
  onClose,
}: {
  conversation: Conversation;
  visible: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [product, setProduct] = useState("");

  const marked = saleThisSession(conversation);
  const markSale = useMarkConversationSale();
  const cancelFollowup = useCancelConversationFollowup();
  const { data: followups, isLoading } = useListConversationFollowups(conversation.id, {
    query: { enabled: visible, queryKey: getListConversationFollowupsQueryKey(conversation.id) },
  });
  // El catálogo solo sugiere nombres: el producto se puede escribir libre.
  const { data: products } = useListProducts(undefined, {
    query: { enabled: visible && !marked, retry: false, queryKey: getListProductsQueryKey() },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversation.id) });
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversation.id) });
    queryClient.invalidateQueries({ queryKey: getListConversationFollowupsQueryKey(conversation.id) });
  };

  const submit = (closed: boolean) =>
    markSale.mutate(
      { id: conversation.id, data: { closed, product: closed ? product.trim() || null : null } },
      {
        onSuccess: () => {
          refresh();
          setProduct("");
          Alert.alert(
            closed ? "Venta marcada como cerrada" : "Venta desmarcada",
            closed
              ? "Se programó el seguimiento post-venta si hay un flujo activo para ello."
              : "Se cancelaron los seguimientos post-venta pendientes.",
          );
        },
        onError: (err) => Alert.alert("No se pudo actualizar la venta", errorMessage(err)),
      },
    );

  const list = followups ?? [];
  const pending = list.filter((f) => f.status === "scheduled").length;
  const query = product.trim().toLowerCase();
  const suggestions = (products ?? [])
    .filter((p) => !query || p.name.toLowerCase().includes(query))
    .filter((p) => p.name.toLowerCase() !== query)
    .slice(0, 8);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={marked ? "Venta cerrada" : "¿Cerraste la venta?"}
      description={
        marked
          ? `${conversation.saleProduct ?? "Sin producto indicado"} · ${conversation.saleSource === "ai" ? "detectada por la IA" : "marcada por el equipo"}`
          : "Arranca el seguimiento post-venta (entrega, satisfacción y recompra) y cancela el intento de recuperación."
      }
    >
      <View style={styles.section}>
        {marked ? (
          <Button
            label="No hubo venta: desmarcar"
            variant="secondary"
            onPress={() => submit(false)}
            loading={markSale.isPending}
          />
        ) : (
          <>
            <TextInput
              value={product}
              onChangeText={setProduct}
              placeholder="Producto vendido (opcional)"
              placeholderTextColor={colors.mutedForeground}
              style={styles.input}
            />
            {suggestions.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={styles.suggestions}>
                  {suggestions.map((p) => (
                    <Pressable key={p.id} onPress={() => setProduct(p.name)} style={styles.suggestion}>
                      <Text style={styles.suggestionText} numberOfLines={1}>
                        {p.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            ) : null}
            <Button
              label="Marcar venta cerrada"
              icon="bag-check"
              onPress={() => submit(true)}
              loading={markSale.isPending}
              style={{ backgroundColor: colors.success, borderColor: colors.success }}
            />
          </>
        )}
      </View>

      <View style={[styles.section, styles.followups]}>
        <View style={styles.followupsHeader}>
          <Ionicons name="calendar" size={14} color={colors.foreground} />
          <Text style={styles.followupsTitle}>
            Seguimientos{pending ? ` · ${pending} pendiente${pending === 1 ? "" : "s"}` : ""}
          </Text>
        </View>
        {isLoading ? <Text style={styles.muted}>Cargando…</Text> : null}
        {!isLoading && list.length === 0 ? <Text style={styles.muted}>Ninguno todavía.</Text> : null}
        {list.map((f) => {
          const status = STATUS_LABELS[f.status];
          return (
            <View key={f.id} style={styles.followup}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.followupTop}>
                  <Text style={styles.followupKind} numberOfLines={1}>
                    {KIND_LABELS[f.kind]}
                  </Text>
                  <View style={[styles.pill, { backgroundColor: status.bg }]}>
                    <Text style={[styles.pillText, { color: status.fg }]}>{status.label}</Text>
                  </View>
                </View>
                <Text style={styles.muted}>
                  {f.status === "scheduled" ? `Sale el ${when(f.dueAt)}` : f.sentAt ? `Enviado el ${when(f.sentAt)}` : when(f.dueAt)}
                  {f.agentName ? ` · ${f.agentName}` : ""}
                </Text>
                {f.detail && f.status !== "sent" ? <Text style={styles.muted}>{f.detail}</Text> : null}
              </View>
              {f.status === "scheduled" ? (
                <Pressable
                  hitSlop={10}
                  disabled={cancelFollowup.isPending}
                  onPress={() =>
                    cancelFollowup.mutate(
                      { id: conversation.id, followupId: f.id },
                      {
                        onSuccess: refresh,
                        onError: (err) => Alert.alert("No se pudo cancelar", errorMessage(err)),
                      },
                    )
                  }
                >
                  <Ionicons name="close-circle" size={22} color={colors.mutedForeground} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.foreground,
    backgroundColor: colors.card,
  },
  suggestions: { flexDirection: "row", gap: spacing.xs },
  suggestion: {
    maxWidth: 200,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.muted,
  },
  suggestionText: { fontSize: 12, fontWeight: "600", color: colors.foreground },
  followups: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  followupsHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  followupsTitle: { fontSize: 13, fontWeight: "700", color: colors.foreground },
  followup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  followupTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  followupKind: { flexShrink: 1, fontSize: 12, fontWeight: "600", color: colors.foreground },
  pill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
  pillText: { fontSize: 10, fontWeight: "700" },
  muted: { fontSize: 11, color: colors.mutedForeground },
});
