import { useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListContacts,
  useCreateContact,
  getListContactsQueryKey,
} from "@workspace/api-client-react";
import { Screen } from "../../src/components/Screen";
import { Sheet } from "../../src/components/Sheet";
import { ChannelDot } from "../../src/components/ConversationRow";
import { Avatar, Badge, Button, Chips, EmptyState, Field, ListRow, Loading, SearchInput } from "../../src/components/ui";
import { errorMessage, initials } from "../../src/lib/format";
import { colors, spacing } from "../../src/theme";

const TAGS = ["all", "lead", "vip", "in_process", "support"] as const;
const TAG_LABELS: Record<string, string> = {
  all: "Todos",
  lead: "Lead",
  vip: "VIP",
  in_process: "En proceso",
  support: "Soporte",
};
const TAG_TINT: Record<string, { bg: string; fg: string }> = {
  lead: { bg: colors.infoSoft, fg: colors.info },
  vip: { bg: colors.accentSoft, fg: colors.accent },
  in_process: { bg: colors.warningSoft, fg: colors.warning },
  support: { bg: colors.botSoft, fg: colors.bot },
};

export default function AdminContactsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<(typeof TAGS)[number]>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", company: "" });

  const params = { search: search.trim() || undefined, tag: tag !== "all" ? tag : undefined };
  const { data, isLoading, isFetching, refetch } = useListContacts(params, {
    query: { queryKey: getListContactsQueryKey(params) },
  });
  const createContact = useCreateContact();

  const contacts = data ?? [];

  const submit = () => {
    if (!form.name.trim()) {
      Alert.alert("Falta el nombre", "Escribe al menos el nombre del contacto.");
      return;
    }
    createContact.mutate(
      {
        data: {
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          company: form.company.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setForm({ name: "", phone: "", email: "", company: "" });
          queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        },
        onError: (err) => Alert.alert("No se pudo crear el contacto", errorMessage(err)),
      },
    );
  };

  return (
    <Screen scroll={false}>
      <View style={styles.filters}>
        <SearchInput value={search} onChangeText={setSearch} placeholder="Buscar por nombre, teléfono o correo..." />
        <Chips options={TAGS} value={tag} onChange={setTag} labels={TAG_LABELS} />
        <Button label="Nuevo contacto" icon="person-add" size="sm" onPress={() => setCreateOpen(true)} />
      </View>

      {isLoading && contacts.length === 0 ? (
        <Loading label="Cargando contactos…" />
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={contacts.length === 0 ? { flexGrow: 1 } : undefined}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={<EmptyState icon="people-outline" title="Sin contactos" description="Prueba con otra búsqueda." />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => {
            const tint = item.tag ? TAG_TINT[item.tag] : undefined;
            return (
              <ListRow
                title={item.name}
                subtitle={item.phone ?? item.email ?? item.company ?? "Sin datos de contacto"}
                onPress={() => router.push(`/contact/${item.id}`)}
                left={<Avatar label={initials(item.name)} uri={item.avatar} size={40} />}
                meta={
                  <View style={styles.metaRow}>
                    {tint ? <Badge label={TAG_LABELS[item.tag!] ?? item.tag!} bg={tint.bg} fg={tint.fg} /> : null}
                    {(item.channels ?? []).map((channel) => (
                      <ChannelDot key={channel} channel={channel} size={16} />
                    ))}
                  </View>
                }
              />
            );
          }}
        />
      )}

      <Sheet visible={createOpen} onClose={() => setCreateOpen(false)} title="Nuevo contacto">
        <View style={styles.form}>
          <Field label="Nombre" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
          <Field
            label="Teléfono"
            value={form.phone}
            onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
            keyboardType="phone-pad"
          />
          <Field
            label="Correo"
            value={form.email}
            onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Field label="Empresa" value={form.company} onChangeText={(v) => setForm((f) => ({ ...f, company: v }))} />
          <Button label="Crear contacto" onPress={submit} loading={createContact.isPending} />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  separator: { height: 1, backgroundColor: colors.border },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  form: { padding: spacing.lg, gap: spacing.md },
});
