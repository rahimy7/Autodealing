import { useCallback, useState } from "react";
import { View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import { QuoteRow } from "@/components/rows";
import { Button, CardList, Empty, Loading, Screen, SearchBar, Select } from "@/components/ui";

export default function Quotes() {
  const { user, team } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<any[] | null>(null);
  const [query, setQuery] = useState("");
  const [seller, setSeller] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setList(await api<any[]>(`/api/admin/quotes${isAdmin(user) && seller ? `?seller=${seller}` : ""}`).catch(() => []));
  }, [user, seller]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const q = query.toLowerCase();
  const shown = (list ?? []).filter((x) => `${x.code} ${x.customerName} ${x.customerPhone} ${x.vehicle.title} ${x.vehicle.stock}`.toLowerCase().includes(q));
  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <Stack.Screen options={{ title: "Cotizaciones" }} />
      <View style={{ gap: 12 }}>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Buscar cliente, unidad o número" />
        {isAdmin(user) ? <Select value={seller} options={[["", "Todo el equipo"], ...team.filter((u) => u.role !== "service").map((u) => [u.id, u.name] as [string, string])]} onChange={setSeller} /> : null}
        {list === null ? <Loading /> : shown.length ? <CardList>{shown.map((x) => <QuoteRow key={x.id} q={x} />)}</CardList> : <Empty title="Sin cotizaciones." body="Genera una desde la ficha de un vehículo, un chat o el botón +." action={<Button title="Nueva cotización" onPress={() => router.push("/quote/new")} />} />}
      </View>
    </Screen>
  );
}
