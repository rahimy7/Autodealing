import { useCallback, useState } from "react";
import { View } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LEAD_STATUS } from "@/lib/labels";
import { LeadRow } from "@/components/rows";
import { CardList, Empty, Loading, Screen, Segmented, Select, T, useNotify } from "@/components/ui";

export default function Leads() {
  const { user } = useAuth();
  const notify = useNotify();
  const [filter, setFilter] = useState<"open" | "mine" | "all">("open");
  const [list, setList] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => setList(await api<any[]>("/api/admin/leads").catch(() => [])), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const shown = (list ?? []).filter((l) => (filter === "open" ? !l.assigned_to && l.status !== "closed" : filter === "mine" ? l.assigned_to === user?.id : true));
  const setStatus = async (l: any, status: string) => {
    try {
      await api(`/api/admin/leads/${l.id}`, { method: "PUT", body: { status } });
      setList((cur) => (cur ?? []).map((x) => (x.id === l.id ? { ...x, status } : x)));
      notify("Seguimiento actualizado.");
    } catch (e: any) {
      notify(e.message, true);
    }
  };
  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <Stack.Screen options={{ title: "Consultas web" }} />
      <View style={{ gap: 12 }}>
        <Segmented value={filter} options={[["open", "Sin asignar"], ["mine", "Mías"], ["all", "Todas"]]} onChange={setFilter} />
        {list === null ? <Loading /> : shown.length ? (
          <CardList>
            {shown.map((l) => (
              <View key={l.id}>
                <LeadRow l={l} onChanged={load} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingBottom: 14 }}>
                  <T v="small" style={{ flex: 1 }}>{l.assigned_name ? "Atiende " + l.assigned_name : "Sin asignar"}</T>
                  <View style={{ width: 160 }}><Select value={l.status} options={Object.entries(LEAD_STATUS) as [string, string][]} onChange={(s) => setStatus(l, s)} /></View>
                </View>
              </View>
            ))}
          </CardList>
        ) : <Empty title="Nada por aquí." body="Las solicitudes de la página web aparecen en esta lista." />}
      </View>
    </Screen>
  );
}
