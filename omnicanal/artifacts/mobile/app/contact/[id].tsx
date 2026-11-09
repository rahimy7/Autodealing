import { useEffect, useState } from "react";
import { Alert, Linking, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetContact,
  useUpdateContact,
  useDeleteContact,
  useListConversations,
  getGetContactQueryKey,
  getListContactsQueryKey,
  getListConversationsQueryKey,
} from "@workspace/api-client-react";
import { Screen } from "../../src/components/Screen";
import { ConversationRow } from "../../src/components/ConversationRow";
import { Sheet, SheetAction } from "../../src/components/Sheet";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  Field,
  Loading,
  SectionHeader,
} from "../../src/components/ui";
import { errorMessage, formatDate, initials } from "../../src/lib/format";
import { colors, spacing } from "../../src/theme";

const TAGS = ["lead", "vip", "in_process", "support"] as const;
const TAG_LABELS: Record<string, string> = {
  lead: "Lead",
  vip: "VIP",
  in_process: "En proceso",
  support: "Soporte",
};

export default function ContactDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const contactId = Number(id);
  const router = useRouter();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", company: "", city: "", address: "", notes: "" });

  const valid = Number.isInteger(contactId) && contactId > 0;
  const { data: contact, isLoading, isFetching, refetch } = useGetContact(contactId, {
    query: { queryKey: getGetContactQueryKey(contactId), enabled: valid },
  });
  const { data: conversations } = useListConversations(
    { contactId },
    { query: { queryKey: getListConversationsQueryKey({ contactId }), enabled: valid } },
  );

  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();

  useEffect(() => {
    if (!contact) return;
    setForm({
      name: contact.name ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      company: contact.company ?? "",
      city: contact.city ?? "",
      address: contact.address ?? "",
      notes: contact.notes ?? "",
    });
  }, [contact?.id]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) });
    queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
  };

  const save = () => {
    updateContact.mutate(
      {
        id: contactId,
        data: {
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          company: form.company.trim() || null,
          city: form.city.trim() || null,
          address: form.address.trim() || null,
          notes: form.notes.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setEditing(false);
          invalidate();
        },
        onError: (err) => Alert.alert("No se pudo guardar", errorMessage(err)),
      },
    );
  };

  const remove = () => {
    Alert.alert("Eliminar contacto", "Se borrará junto con sus datos de perfil. Esta acción no se puede deshacer.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () =>
          deleteContact.mutate(
            { id: contactId },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
                router.back();
              },
              onError: (err) => Alert.alert("No se pudo eliminar", errorMessage(err)),
            },
          ),
      },
    ]);
  };

  if (!valid) return <EmptyState icon="alert-circle-outline" title="Contacto no válido" />;
  if (isLoading && !contact) return <Loading label="Cargando contacto…" />;
  if (!contact) return <EmptyState icon="alert-circle-outline" title="No encontramos este contacto" />;

  return (
    <Screen refreshing={isFetching} onRefresh={refetch}>
      <Card style={{ gap: spacing.lg }}>
        <View style={styles.identity}>
          <Avatar label={initials(contact.name)} uri={contact.avatar} size={58} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.name}>{contact.name}</Text>
            <Text style={styles.muted}>Cliente desde {formatDate(contact.createdAt)}</Text>
            <View style={styles.badgeRow}>
              {contact.tag ? <Badge label={TAG_LABELS[contact.tag] ?? contact.tag} bg={colors.primarySoft} fg={colors.primary} /> : null}
              {contact.buyerStatus ? <Badge label={contact.buyerStatus} /> : null}
              <Badge label={`${contact.totalConversations ?? 0} chats`} icon="chatbubbles" />
            </View>
          </View>
        </View>

        <Divider />

        <View style={{ gap: spacing.sm }}>
          <InfoRow icon="call" label="Teléfono" value={contact.phone} onPress={contact.phone ? () => Linking.openURL(`tel:${contact.phone}`) : undefined} />
          <InfoRow icon="mail" label="Correo" value={contact.email} onPress={contact.email ? () => Linking.openURL(`mailto:${contact.email}`) : undefined} />
          <InfoRow icon="business" label="Empresa" value={contact.company} />
          <InfoRow icon="location" label="Ciudad" value={contact.city} />
          <InfoRow icon="map" label="Dirección" value={contact.address} />
        </View>

        <View style={styles.actionRow}>
          <Button label="Editar" icon="create" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => setEditing(true)} />
          <Button label="Etiqueta" icon="pricetag" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => setTagOpen(true)} />
        </View>
        <Button
          label="Enviar correo"
          icon="mail"
          variant="secondary"
          size="sm"
          onPress={() =>
            router.push({
              pathname: "/email/compose",
              params: { to: contact.email ?? "", contactId: String(contact.id) },
            })
          }
        />
      </Card>

      {contact.interests && contact.interests.length > 0 ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionHeader title="Intereses" />
          <View style={styles.badgeRow}>
            {contact.interests.map((interest) => (
              <Badge key={interest} label={interest} bg={colors.accentSoft} fg={colors.accent} />
            ))}
          </View>
        </Card>
      ) : null}

      {contact.purchaseProfile ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionHeader title="Perfil de compra" />
          <Text style={styles.body}>{contact.purchaseProfile}</Text>
        </Card>
      ) : null}

      {contact.facts && contact.facts.length > 0 ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionHeader title="Datos recogidos" />
          {contact.facts.map((fact) => (
            <View key={fact.id} style={styles.factRow}>
              <Text style={styles.factLabel}>{fact.label}</Text>
              <Text style={styles.factValue}>{fact.value}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {contact.notes ? (
        <Card style={{ gap: spacing.sm }}>
          <SectionHeader title="Notas" />
          <Text style={styles.body}>{contact.notes}</Text>
        </Card>
      ) : null}

      <Card padded={false} style={{ overflow: "hidden" }}>
        <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
          <SectionHeader title="Conversaciones" />
        </View>
        {(conversations ?? []).length === 0 ? (
          <EmptyState icon="chatbubbles-outline" title="Sin conversaciones" />
        ) : (
          (conversations ?? []).map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              onPress={() => router.push(`/chat/${conversation.id}`)}
            />
          ))
        )}
      </Card>

      <Button label="Eliminar contacto" variant="danger" icon="trash" onPress={remove} loading={deleteContact.isPending} />

      {/* ── Edit ─────────────────────────────────────────────────────────────── */}
      <Sheet visible={editing} onClose={() => setEditing(false)} title="Editar contacto">
        <View style={styles.form}>
          <Field label="Nombre" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
          <Field label="Teléfono" value={form.phone} onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))} keyboardType="phone-pad" />
          <Field label="Correo" value={form.email} onChangeText={(v) => setForm((f) => ({ ...f, email: v }))} keyboardType="email-address" autoCapitalize="none" />
          <Field label="Empresa" value={form.company} onChangeText={(v) => setForm((f) => ({ ...f, company: v }))} />
          <Field label="Ciudad" value={form.city} onChangeText={(v) => setForm((f) => ({ ...f, city: v }))} />
          <Field label="Dirección" value={form.address} onChangeText={(v) => setForm((f) => ({ ...f, address: v }))} />
          <Field label="Notas" value={form.notes} onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))} multiline />
          <Button label="Guardar" onPress={save} loading={updateContact.isPending} />
        </View>
      </Sheet>

      {/* ── Tag ──────────────────────────────────────────────────────────────── */}
      <Sheet visible={tagOpen} onClose={() => setTagOpen(false)} title="Etiqueta del contacto">
        {TAGS.map((option) => (
          <SheetAction
            key={option}
            icon="pricetag"
            label={TAG_LABELS[option]}
            selected={contact.tag === option}
            onPress={() => {
              setTagOpen(false);
              updateContact.mutate(
                { id: contactId, data: { tag: option } },
                { onSuccess: invalidate, onError: (err) => Alert.alert("No se pudo etiquetar", errorMessage(err)) },
              );
            }}
          />
        ))}
        <SheetAction
          icon="close-circle"
          label="Sin etiqueta"
          selected={!contact.tag}
          onPress={() => {
            setTagOpen(false);
            updateContact.mutate(
              { id: contactId, data: { tag: null } },
              { onSuccess: invalidate, onError: (err) => Alert.alert("No se pudo quitar", errorMessage(err)) },
            );
          }}
        />
      </Sheet>
    </Screen>
  );
}

function InfoRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string | null;
  onPress?: () => void;
}) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={15} color={colors.mutedForeground} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text
        style={[styles.infoValue, onPress && value ? { color: colors.primary } : null]}
        numberOfLines={1}
        onPress={value ? onPress : undefined}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  name: { fontSize: 18, fontWeight: "800", color: colors.foreground },
  muted: { fontSize: 12, color: colors.mutedForeground },
  body: { fontSize: 13, color: colors.foreground, lineHeight: 19 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  infoLabel: { width: 78, fontSize: 12, color: colors.mutedForeground },
  infoValue: { flex: 1, fontSize: 13, color: colors.foreground, textAlign: "right" },
  actionRow: { flexDirection: "row", gap: spacing.sm },
  factRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  factLabel: { fontSize: 12, color: colors.mutedForeground, flex: 1 },
  factValue: { fontSize: 12, color: colors.foreground, fontWeight: "600", flex: 1, textAlign: "right" },
  form: { padding: spacing.lg, gap: spacing.md },
});
