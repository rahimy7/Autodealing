import { useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCampaigns,
  useSendCampaign,
  useDeleteCampaign,
  useListCampaignRecipients,
  getListCampaignsQueryKey,
  getListCampaignRecipientsQueryKey,
  type Campaign,
} from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Sheet, SheetAction } from "../src/components/Sheet";
import { ChannelDot } from "../src/components/ConversationRow";
import { Badge, BarRow, Chips, EmptyState, ListRow, Loading } from "../src/components/ui";
import { errorMessage, formatDateTime } from "../src/lib/format";
import { channelLabels, colors, spacing } from "../src/theme";

const FILTERS = ["all", "draft", "scheduled", "sending", "sent", "failed"] as const;
const FILTER_LABELS: Record<string, string> = {
  all: "Todas",
  draft: "Borrador",
  scheduled: "Programada",
  sending: "Enviando",
  sent: "Enviada",
  failed: "Fallida",
};
const STATUS_TINT: Record<string, { bg: string; fg: string }> = {
  draft: { bg: colors.muted, fg: colors.mutedForeground },
  scheduled: { bg: colors.infoSoft, fg: colors.info },
  sending: { bg: colors.warningSoft, fg: colors.warning },
  sent: { bg: colors.successSoft, fg: colors.success },
  failed: { bg: colors.destructiveSoft, fg: colors.destructive },
};

export default function CampaignsScreen() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [selected, setSelected] = useState<Campaign | null>(null);

  const { data, isLoading, isFetching, refetch } = useListCampaigns();
  const sendCampaign = useSendCampaign();
  const deleteCampaign = useDeleteCampaign();
  const { data: recipients } = useListCampaignRecipients(selected?.id ?? 0, {
    query: { queryKey: getListCampaignRecipientsQueryKey(selected?.id ?? 0), enabled: !!selected },
  });

  const campaigns = (data ?? []).filter((c) => filter === "all" || c.status === filter);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });

  const send = (campaign: Campaign) => {
    Alert.alert(
      "Enviar campaña",
      `Se enviará "${campaign.name}" a ${campaign.recipientCount} destinatario${campaign.recipientCount === 1 ? "" : "s"}. Esta acción no se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Enviar ahora",
          style: "destructive",
          onPress: () =>
            sendCampaign.mutate(
              { id: campaign.id },
              {
                onSuccess: () => {
                  setSelected(null);
                  invalidate();
                },
                onError: (err) => Alert.alert("No se pudo enviar", errorMessage(err)),
              },
            ),
        },
      ],
    );
  };

  const remove = (campaign: Campaign) => {
    Alert.alert("Eliminar campaña", `"${campaign.name}" se borrará junto con sus destinatarios.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () =>
          deleteCampaign.mutate(
            { id: campaign.id },
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
      <View style={styles.filters}>
        <Chips options={FILTERS} value={filter} onChange={setFilter} labels={FILTER_LABELS} />
      </View>

      {isLoading && campaigns.length === 0 ? (
        <Loading label="Cargando campañas…" />
      ) : (
        <FlatList
          data={campaigns}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={campaigns.length === 0 ? { flexGrow: 1 } : undefined}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState icon="megaphone-outline" title="Sin campañas" description="Créalas desde el panel web y envíalas desde aquí." />
          }
          renderItem={({ item }) => {
            const tint = STATUS_TINT[item.status] ?? STATUS_TINT.draft;
            return (
              <ListRow
                title={item.name}
                subtitle={item.message ?? item.templateName ?? "Sin contenido"}
                onPress={() => setSelected(item)}
                left={<ChannelDot channel={item.channel} size={26} />}
                meta={
                  <View style={styles.metaRow}>
                    <Badge label={FILTER_LABELS[item.status] ?? item.status} bg={tint.bg} fg={tint.fg} />
                    <Badge label={`${item.recipientCount} destinatarios`} icon="people" />
                    {item.sentCount ? <Badge label={`${item.sentCount} enviados`} bg={colors.successSoft} fg={colors.success} /> : null}
                    {item.failedCount ? <Badge label={`${item.failedCount} fallidos`} bg={colors.destructiveSoft} fg={colors.destructive} /> : null}
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
        title={selected?.name ?? ""}
        description={selected ? `${channelLabels[selected.channel] ?? selected.channel} · ${FILTER_LABELS[selected.status] ?? selected.status}` : undefined}
      >
        {selected ? (
          <View style={styles.detail}>
            {selected.message ? <Text style={styles.body}>{selected.message}</Text> : null}
            {selected.templateName ? (
              <Text style={styles.meta}>
                Plantilla: {selected.templateName} ({selected.templateLanguage ?? "es"})
              </Text>
            ) : null}
            <Text style={styles.meta}>Creada: {formatDateTime(selected.createdAt)}</Text>
            {selected.scheduledAt ? <Text style={styles.meta}>Programada: {formatDateTime(selected.scheduledAt)}</Text> : null}
            {selected.sentAt ? <Text style={styles.meta}>Enviada: {formatDateTime(selected.sentAt)}</Text> : null}

            {selected.recipientCount > 0 ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                <BarRow label="Entregados" value={selected.sentCount ?? 0} total={selected.recipientCount} color={colors.success} />
                {selected.failedCount ? (
                  <BarRow label="Fallidos" value={selected.failedCount} total={selected.recipientCount} color={colors.destructive} />
                ) : null}
                {selected.openedCount ? (
                  <BarRow label="Abiertos" value={selected.openedCount} total={selected.recipientCount} color={colors.info} />
                ) : null}
              </View>
            ) : null}

            {(recipients ?? []).length > 0 ? (
              <View style={{ gap: 4, marginTop: spacing.sm }}>
                <Text style={styles.meta}>Últimos destinatarios</Text>
                {(recipients ?? []).slice(0, 6).map((recipient) => (
                  <View key={recipient.id} style={styles.recipientRow}>
                    <Ionicons
                      name={recipient.status === "sent" ? "checkmark-circle" : recipient.status === "failed" ? "close-circle" : "time"}
                      size={13}
                      color={
                        recipient.status === "sent"
                          ? colors.success
                          : recipient.status === "failed"
                            ? colors.destructive
                            : colors.mutedForeground
                      }
                    />
                    <Text style={styles.recipientName} numberOfLines={1}>
                      {recipient.contactName ?? `Contacto ${recipient.contactId}`}
                    </Text>
                    {recipient.error ? (
                      <Text style={styles.recipientError} numberOfLines={1}>
                        {recipient.error}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {selected && (selected.status === "draft" || selected.status === "scheduled") ? (
          <SheetAction
            icon="send"
            label="Enviar ahora"
            description={`${selected.recipientCount} destinatarios`}
            tint={colors.primary}
            disabled={sendCampaign.isPending}
            onPress={() => send(selected)}
          />
        ) : null}

        {selected && selected.status !== "sending" ? (
          <SheetAction
            icon="trash"
            label="Eliminar campaña"
            tint={colors.destructive}
            disabled={deleteCampaign.isPending}
            onPress={() => remove(selected)}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: {
    padding: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  separator: { height: 1, backgroundColor: colors.border },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  detail: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 4 },
  body: { fontSize: 13, color: colors.foreground, lineHeight: 19, marginBottom: 4 },
  meta: { fontSize: 11, color: colors.mutedForeground },
  recipientRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  recipientName: { flex: 1, fontSize: 12, color: colors.foreground },
  recipientError: { flex: 1, fontSize: 10, color: colors.destructive, textAlign: "right" },
});
