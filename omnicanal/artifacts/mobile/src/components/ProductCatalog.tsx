import { useState } from "react";
import { FlatList, Linking, Pressable, RefreshControl, Share, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useListProducts, useListProductCategories, type Product } from "@workspace/api-client-react";
import { Badge, EmptyState, Loading, SearchInput } from "./ui";
import { Sheet, SheetAction } from "./Sheet";
import { colors, radius, spacing } from "../theme";

/**
 * Read-only catalog. Both roles use it the same way: find a product while
 * chatting and share its public link with the customer.
 */
export function ProductCatalog() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);

  const params = { search: search.trim() || undefined, category: category ?? undefined };
  const { data, isLoading, isFetching, refetch } = useListProducts(params);
  const { data: categories } = useListProductCategories();

  const products = data ?? [];

  return (
    <View style={styles.root}>
      <View style={styles.filters}>
        <SearchInput value={search} onChangeText={setSearch} placeholder="Buscar producto..." />
        <Pressable style={styles.categoryButton} onPress={() => setCategoryOpen(true)}>
          <Ionicons name="funnel" size={14} color={colors.mutedForeground} />
          <Text style={styles.categoryText} numberOfLines={1}>
            {category ?? "Todas las categorías"}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {isLoading && products.length === 0 ? (
        <Loading label="Cargando catálogo…" />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={products.length === 0 ? { flexGrow: 1 } : { paddingBottom: spacing.xl }}
          refreshControl={
            <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState icon="pricetags-outline" title="Sin productos" description="Prueba con otra búsqueda o categoría." />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setSelected(item)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.muted }]}
            >
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={styles.thumb} contentFit="cover" transition={120} />
              ) : (
                <View style={[styles.thumb, styles.thumbFallback]}>
                  <Ionicons name="image-outline" size={20} color={colors.mutedForeground} />
                </View>
              )}
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.name} numberOfLines={2}>
                  {item.name}
                </Text>
                {item.description ? (
                  <Text style={styles.description} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
                {item.categories.length > 0 ? (
                  <View style={styles.badgeRow}>
                    {item.categories.slice(0, 2).map((c) => (
                      <Badge key={c} label={c} />
                    ))}
                  </View>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        />
      )}

      <Sheet
        visible={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        title="Categoría"
        description="Filtra el catálogo por familia de producto."
      >
        <SheetAction
          icon="apps"
          label="Todas las categorías"
          selected={category == null}
          onPress={() => {
            setCategory(null);
            setCategoryOpen(false);
          }}
        />
        {(categories ?? []).map((item) => (
          <SheetAction
            key={item.name}
            icon="pricetag"
            label={item.name}
            description={`${item.count} producto${item.count === 1 ? "" : "s"}`}
            selected={category === item.name}
            onPress={() => {
              setCategory(item.name);
              setCategoryOpen(false);
            }}
          />
        ))}
      </Sheet>

      <Sheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        description={selected?.categories.join(" · ")}
      >
        {selected?.description ? <Text style={styles.sheetText}>{selected.description}</Text> : null}
        {selected?.uses ? (
          <Text style={styles.sheetText}>
            <Text style={styles.sheetLabel}>Usos: </Text>
            {selected.uses}
          </Text>
        ) : null}
        {(selected?.properties ?? []).length > 0 ? (
          <View style={styles.propertyList}>
            {selected!.properties.map((property) => (
              <View key={property} style={styles.propertyRow}>
                <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                <Text style={styles.propertyText}>{property}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <SheetAction
          icon="share-social"
          label="Compartir enlace"
          description="Cópialo o mándalo por cualquier app."
          onPress={() => {
            if (selected) Share.share({ message: `${selected.name}\n${selected.url}` }).catch(() => {});
          }}
        />
        <SheetAction
          icon="open-outline"
          label="Abrir ficha del producto"
          onPress={() => {
            if (selected) Linking.openURL(selected.url).catch(() => {});
          }}
        />
        {selected?.technicalSheetUrl ? (
          <SheetAction
            icon="document-text"
            label="Ficha técnica"
            onPress={() => Linking.openURL(selected.technicalSheetUrl!).catch(() => {})}
          />
        ) : null}
        {selected?.safetySheetUrl ? (
          <SheetAction
            icon="shield-checkmark"
            label="Hoja de seguridad"
            onPress={() => Linking.openURL(selected.safetySheetUrl!).catch(() => {})}
          />
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  filters: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  categoryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  categoryText: { flex: 1, fontSize: 13, color: colors.foreground },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  thumb: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.muted },
  thumbFallback: { alignItems: "center", justifyContent: "center" },
  name: { fontSize: 14, fontWeight: "700", color: colors.foreground },
  description: { fontSize: 12, color: colors.mutedForeground },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  sheetText: { fontSize: 13, color: colors.foreground, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, lineHeight: 19 },
  sheetLabel: { fontWeight: "700" },
  propertyList: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: 4 },
  propertyRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  propertyText: { flex: 1, fontSize: 12, color: colors.mutedForeground },
});
