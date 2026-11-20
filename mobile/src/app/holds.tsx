import { useCallback, useState } from "react";
import { View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import { forgetCatalog } from "@/lib/data";
import { shortDate, until, usd } from "@/lib/format";
import { HOLD_STATUS, HOLD_TONE } from "@/lib/labels";
import { ContactButtons } from "@/components/rows";
import { Button, Empty, Field, Loading, Photo, Pill, Screen, Segmented, Select, Sheet, T, useNotify } from "@/components/ui";
import { colors, radius } from "@/theme";

export default function Holds() {
  const { user, team } = useAuth();
  const router = useRouter();
  const notify = useNotify();
  const [tab, setTab] = useState<"active" | "history">("active");
  const [seller, setSeller] = useState("");
  const [list, setList] = useState<any[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [extend, setExtend] = useState<any>(null);
  const [days, setDays] = useState("2");
  const [release, setRelease] = useState<any>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const q = isAdmin(user) && seller ? `&seller=${seller}` : "";
    setList(await api<any[]>(`/api/admin/reservations?status=${tab === "active" ? "active" : "all"}${q}`).catch((e) => (notify(e.message, true), [])));
  }, [tab, seller, user, notify]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const shown = tab === "active" ? list ?? [] : (list ?? []).filter((r) => r.status !== "active");
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); forgetCatalog(); notify(ok); await load(); } catch (e: any) { notify(e.message, true); }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <Stack.Screen options={{ title: "Reservas" }} />
      <View style={{ gap: 12 }}>
        <Segmented value={tab} options={[["active", "Activas"], ["history", "Historial"]]} onChange={(t) => (setList(null), setTab(t))} />
        {isAdmin(user) ? <Select value={seller} options={[["", "Todo el equipo"], ...team.filter((u) => u.role !== "service").map((u) => [u.id, u.name] as [string, string])]} onChange={(v) => (setList(null), setSeller(v))} /> : null}
        {list === null ? <Loading /> : shown.length ? (
          shown.map((r) => {
            const active = r.status === "active";
            return (
              <View key={r.id} style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                <View>
                  <Photo path={r.photo} style={{ width: "100%", aspectRatio: 16 / 9 }} />
                  <View style={{ position: "absolute", top: 10, left: 10, backgroundColor: "rgba(5,6,10,0.65)", borderRadius: 999 }}><Pill tone={HOLD_TONE[r.status]}>{HOLD_STATUS[r.status]}</Pill></View>
                </View>
                <View style={{ padding: 14, gap: 4 }}>
                  <T v="h3">{`${r.year} ${r.make} ${r.model}`}</T>
                  <T v="small">Stock {r.stock} · {r.price_on_request || !Number(r.price) ? "Consultar precio" : usd(r.price)}{isAdmin(user) ? " · " + r.seller_name : ""}</T>
                  <T style={{ fontFamily: "Manrope_700Bold" }}>{r.customer_name}</T>
                  <T v="small">{active ? until(r.expires_at) : "Cerrada " + (r.closed_at ? shortDate(r.closed_at) : "")}{Number(r.deposit) ? " · depósito " + usd(r.deposit) : ""}</T>
                  {r.notes ? <T v="small">{r.notes}</T> : null}
                  <ContactButtons phone={r.customer_phone} email={r.customer_email} />
                  {active ? (
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <Button size="sm" title="Registrar venta" onPress={() => router.push({ pathname: "/sale", params: { reservationId: r.id } })} />
                      <Button size="sm" variant="secondary" title="Extender" onPress={() => (setDays("2"), setExtend(r))} />
                      <Button size="sm" variant="danger" title="Liberar" onPress={() => (setReason(""), setRelease(r))} />
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })
        ) : <Empty title={tab === "active" ? "No tienes reservas activas." : "Sin historial todavía."} body="Reserva un vehículo desde el catálogo, una cotización o un chat." />}
      </View>
      <Sheet visible={!!extend} onClose={() => setExtend(null)} title="Extender reserva" footer={<Button title="Extender" onPress={async () => { const r = extend; setExtend(null); await run(() => api(`/api/admin/reservations/${r.id}/extend`, { method: "POST", body: { days: Number(days) } }), "Reserva extendida."); }} full />}>
        {extend ? <T v="small" style={{ marginBottom: 12 }}>{extend.customer_name} · {`${extend.year} ${extend.make} ${extend.model}`} · {until(extend.expires_at)}.</T> : null}
        <Select label="Agregar" value={days} options={["1", "2", "3", "7", "14"].map((d) => [d, `${d} ${d === "1" ? "día" : "días"}`] as [string, string])} onChange={setDays} />
      </Sheet>
      <Sheet visible={!!release} onClose={() => setRelease(null)} title="Liberar reserva" footer={<Button title="Liberar vehículo" variant="danger" onPress={async () => { const r = release; setRelease(null); await run(() => api(`/api/admin/reservations/${r.id}/release`, { method: "POST", body: { reason } }), "Reserva liberada; el vehículo vuelve a estar disponible."); }} full />}>
        <T v="small" style={{ marginBottom: 12 }}>El vehículo vuelve a estar disponible en la página.</T>
        <Field label="Motivo (opcional)" value={reason} onChangeText={setReason} maxLength={500} placeholder="El cliente desistió, no consiguió financiamiento…" />
      </Sheet>
    </Screen>
  );
}
