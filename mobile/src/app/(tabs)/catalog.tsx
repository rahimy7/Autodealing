import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { canSell, useAuth } from "@/lib/auth";
import { cachedCatalog, loadCatalog } from "@/lib/data";
import { hasPrice, localized, num, usd, type Vehicle } from "@/lib/format";
import { BODIES, CONDITIONS, FUELS } from "@/lib/labels";
import { VehicleCard } from "@/components/rows";
import { Button, Chip, ChipRow, Empty, Field, FormRow, IconButton, Loading, SearchBar, Select, Sheet, T } from "@/components/ui";
import { colors } from "@/theme";

const SORTS: [string, string][] = [
  ["recent", "Más recientes"],
  ["price-asc", "Precio: menor a mayor"],
  ["price-desc", "Precio: mayor a menor"],
  ["miles", "Menos millas"],
  ["year", "Año más nuevo"],
];
const blank = { status: "", make: "", yearMin: "", yearMax: "", priceMin: "", priceMax: "", milesMax: "", condition: "", fuel: "" };
type Filters = typeof blank;

const sorters: Record<string, (a: Vehicle, b: Vehicle) => number> = {
  recent: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  "price-asc": (a, b) => (hasPrice(a) ? a.price : Infinity) - (hasPrice(b) ? b.price : Infinity),
  "price-desc": (a, b) => (hasPrice(b) ? b.price : -1) - (hasPrice(a) ? a.price : -1),
  miles: (a, b) => a.miles - b.miles,
  year: (a, b) => b.year - a.year,
};

export default function Catalog() {
  const { user } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<Vehicle[]>(cachedCatalog());
  const [loading, setLoading] = useState(!list.length);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [body, setBody] = useState("");
  const [sort, setSort] = useState("recent");
  const [f, setF] = useState<Filters>(blank);
  const [open, setOpen] = useState(false);

  const load = useCallback(async (force = true) => {
    try {
      setList(await loadCatalog(force));
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  const bodies = BODIES.filter(([k]) => list.some((v) => (v.cats || []).includes(k)));
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((v) => {
        const price = hasPrice(v) ? Number(v.price) : null;
        if (body && !(v.cats || []).includes(body)) return false;
        if (f.status === "available" && v.status !== "available") return false;
        if (f.status === "reserved" && v.status !== "reserved") return false;
        if (f.status === "mine" && !v.reservation?.mine) return false;
        if (f.make && v.make !== f.make) return false;
        if (f.yearMin && v.year < Number(f.yearMin)) return false;
        if (f.yearMax && v.year > Number(f.yearMax)) return false;
        if (f.priceMin && (price === null || price < Number(f.priceMin))) return false;
        if (f.priceMax && (price === null || price > Number(f.priceMax))) return false;
        if (f.milesMax && v.miles > Number(f.milesMax)) return false;
        if (f.condition && v.condition !== f.condition) return false;
        if (f.fuel && v.fuel !== f.fuel) return false;
        return !q || `${v.stock} ${v.vin} ${v.year} ${v.make} ${v.model} ${v.trim || ""} ${localized(v.ext)}`.toLowerCase().includes(q);
      })
      .sort(sorters[sort]);
  }, [list, query, body, f, sort]);

  const active: [keyof Filters | "year" | "price", string][] = [];
  if (f.status) active.push(["status", { available: "Disponibles", reserved: "Reservados", mine: "Mis reservas" }[f.status]!]);
  if (f.make) active.push(["make", f.make]);
  if (f.yearMin || f.yearMax) active.push(["year", `Año ${f.yearMin || "…"}–${f.yearMax || "…"}`]);
  if (f.priceMin || f.priceMax) active.push(["price", `${f.priceMin ? usd(f.priceMin) : "$0"} – ${f.priceMax ? usd(f.priceMax) : "∞"}`]);
  if (f.milesMax) active.push(["milesMax", `Hasta ${num(f.milesMax)} mi`]);
  if (f.condition) active.push(["condition", CONDITIONS.find(([k]) => k === f.condition)![1]]);
  if (f.fuel) active.push(["fuel", FUELS.find(([k]) => k === f.fuel)![1]]);
  const clear = (k: string) => setF((p) => (k === "year" ? { ...p, yearMin: "", yearMax: "" } : k === "price" ? { ...p, priceMin: "", priceMax: "" } : { ...p, [k]: "" }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={shown}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 14 }}
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await load(true);
          setRefreshing(false);
        }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              <SearchBar value={query} onChangeText={setQuery} placeholder="Buscar marca, modelo o VIN" />
              <IconButton name="options-outline" label="Filtros" onPress={() => setOpen(true)} badge={active.length || undefined} />
            </View>
            <ChipRow>
              <Chip label="Todos" active={!body} onPress={() => setBody("")} />
              {bodies.map(([k, l]) => (
                <Chip key={k} label={l} active={body === k} onPress={() => setBody(k)} />
              ))}
            </ChipRow>
            {active.length ? (
              <ChipRow wrap>
                {active.map(([k, l]) => (
                  <Chip key={k} label={l} onClear={() => clear(k)} />
                ))}
              </ChipRow>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <T v="small">
                {shown.length} {shown.length === 1 ? "vehículo" : "vehículos"}
              </T>
              <View style={{ width: 210 }}>
                <Select value={sort} options={SORTS} onChange={setSort} />
              </View>
            </View>
          </View>
        }
        renderItem={({ item }) => <VehicleCard v={item} />}
        ListEmptyComponent={
          loading ? (
            <Loading />
          ) : error ? (
            <Empty title="No se pudo cargar" body={error} action={<Button title="Reintentar" variant="secondary" onPress={() => load(true)} />} />
          ) : (
            <Empty title="Sin resultados" body="Prueba con otra búsqueda o quita algún filtro." action={active.length ? <Button title="Quitar filtros" variant="secondary" onPress={() => setF(blank)} /> : undefined} />
          )
        }
      />
      <FilterSheet open={open} onClose={() => setOpen(false)} value={f} onApply={setF} makes={[...new Set(list.map((v) => v.make).filter(Boolean))].sort()} mine={canSell(user)} />
    </View>
  );
}

function FilterSheet({ open, onClose, value, onApply, makes, mine }: { open: boolean; onClose: () => void; value: Filters; onApply: (f: Filters) => void; makes: string[]; mine: boolean }) {
  const [d, setD] = useState<Filters>(value);
  useEffect(() => {
    if (open) setD(value);
  }, [open, value]);
  const set = (k: keyof Filters) => (v: string) => setD((p) => ({ ...p, [k]: v }));
  const num = (k: keyof Filters, label: string) => <Field label={label} value={d[k]} onChangeText={(t) => set(k)(t.replace(/[^\d]/g, ""))} keyboardType="number-pad" />;
  return (
    <Sheet
      visible={open}
      onClose={onClose}
      title="Filtros"
      footer={
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Limpiar"
              variant="secondary"
              onPress={() => {
                setD(blank);
                onApply(blank);
                onClose();
              }}
              full
            />
          </View>
          <View style={{ flex: 1.4 }}>
            <Button
              title="Ver resultados"
              onPress={() => {
                onApply(d);
                onClose();
              }}
              full
            />
          </View>
        </View>
      }
    >
      <View style={{ gap: 14 }}>
        <Select label="Estado" value={d.status} options={[["", "Todos"], ["available", "Disponibles"], ["reserved", "Reservados"], ...(mine ? ([["mine", "Mis reservas"]] as [string, string][]) : [])]} onChange={set("status")} />
        <Select label="Marca" value={d.make} options={[["", "Todas"], ...makes.map((m) => [m, m] as [string, string])]} onChange={set("make")} />
        <FormRow>
          {num("yearMin", "Año desde")}
          {num("yearMax", "Año hasta")}
        </FormRow>
        <FormRow>
          {num("priceMin", "Precio mínimo")}
          {num("priceMax", "Precio máximo")}
        </FormRow>
        {num("milesMax", "Millaje máximo")}
        <FormRow>
          <Select label="Condición" value={d.condition} options={[["", "Todas"], ...CONDITIONS]} onChange={set("condition")} />
          <Select label="Combustible" value={d.fuel} options={[["", "Todos"], ...FUELS]} onChange={set("fuel")} />
        </FormRow>
      </View>
    </Sheet>
  );
}
