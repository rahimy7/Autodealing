import { useCallback, useState } from "react";
import { View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import type { Vehicle } from "@/lib/format";
import { VEHICLE_STATUS } from "@/lib/labels";
import { UnitCard } from "@/components/rows";
import { Button, Chip, ChipRow, Empty, Loading, Screen, SearchBar, Segmented, T } from "@/components/ui";

// Salespeople and service see the units they loaded, whatever became of them. Administration sees
// the drafts waiting for their details and price, and the whole inventory.
export default function Units() {
  const { user } = useAuth();
  const router = useRouter();
  const admin = isAdmin(user);
  const [tab, setTab] = useState<"review" | "all">("review");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<Vehicle[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => setList(await api<Vehicle[]>(admin && tab === "all" ? "/api/admin/vehicles" : "/api/admin/intake").catch(() => [])), [admin, tab]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const q = query.toLowerCase();
  const all = admin && tab === "all";
  const shown = (list ?? []).filter((v) => !all || ((!status || v.status === status) && `${v.stock} ${v.vin} ${v.year} ${v.make} ${v.model}`.toLowerCase().includes(q)));
  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <Stack.Screen options={{ title: admin ? "Inventario" : "Mis unidades", headerRight: () => <Button size="sm" variant="secondary" icon="camera-outline" title="Cargar" onPress={() => router.push("/units/new")} /> }} />
      <View style={{ gap: 12 }}>
        {admin ? <Segmented value={tab} options={[["review", "Por completar"], ["all", "Inventario"]]} onChange={(t) => (setList(null), setTab(t))} /> : <T v="small">Las unidades que cargaste. «En revisión» espera a que administración complete la ficha y el precio.</T>}
        {all ? (
          <>
            <SearchBar value={query} onChangeText={setQuery} placeholder="Stock, VIN, marca o modelo" />
            <ChipRow>
              {["", "draft", "available", "reserved", "sold", "archived"].map((s) => (
                <Chip key={s} label={s ? VEHICLE_STATUS[s] : "Todas"} active={status === s} count={s ? (list ?? []).filter((v) => v.status === s).length : (list ?? []).length} onPress={() => setStatus(s)} />
              ))}
            </ChipRow>
          </>
        ) : null}
        {list === null ? <Loading /> : shown.length ? (
          shown.map((v) => <UnitCard key={v.id} v={v} showLoader={admin} onPress={() => router.push({ pathname: "/units/[id]", params: { id: v.id } })} />)
        ) : tab === "review" && admin ? (
          <Empty title="Nada por completar." body="Las unidades que el equipo cargue desde el lote aparecerán aquí para que completes la ficha y el precio." />
        ) : (
          <Empty title={admin ? "Sin unidades." : "Aún no has cargado unidades."} body="Toca «Cargar» para registrar un vehículo con fotos desde el lote." action={<Button title="Cargar vehículo" onPress={() => router.push("/units/new")} />} />
        )}
      </View>
    </Screen>
  );
}
