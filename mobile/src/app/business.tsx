// Administration's view of the business: sales, margin, stock and the team's results.
import { useCallback, useState } from "react";
import { Linking, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { api, publicUrl } from "@/lib/api";
import { usd } from "@/lib/format";
import { Avatar, Button, Card, CardList, Gradient, ListRow, Loading, Screen, Section, Segmented, Stat, StatGrid, T } from "@/components/ui";
import { colors, font } from "@/theme";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export default function Business() {
  const router = useRouter();
  const [days, setDays] = useState("30");
  const [data, setData] = useState<{ fin: any; perf: any } | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try {
      const [fin, perf] = await Promise.all([api(`/api/admin/finance?days=${days}`), api(`/api/admin/performance?days=${days}`)]);
      setData({ fin, perf });
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [days]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const picker = <Segmented value={days} options={[["7", "7 días"], ["30", "30 días"], ["90", "90 días"], ["365", "1 año"]]} onChange={(d) => (setData(null), setDays(d))} scroll />;
  if (!data) return <Screen><Stack.Screen options={{ title: "Negocio" }} />{picker}{error ? <T v="muted" style={{ marginTop: 16 }}>{error}</T> : <Loading />}</Screen>;
  const { fin, perf } = data;
  const p = fin.period;
  const stock: Record<string, any> = Object.fromEntries(fin.stock.map((s: any) => [s.status, s]));
  const forSale = ["available", "reserved"].reduce((n, k) => n + (stock[k]?.count || 0), 0);
  const listValue = ["available", "reserved"].reduce((n, k) => n + Number(stock[k]?.list_value || 0), 0);
  const aged = ["available", "reserved"].reduce((n, k) => n + (stock[k]?.aged60 || 0), 0);
  const top = Math.max(1, ...fin.months.map((m: any) => Number(m.revenue)));
  const ranked = perf.team.filter((u: any) => Number(u.sales) || Number(u.reservations) || Number(u.appointments));
  return (
    <Screen refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <Stack.Screen options={{ title: "Negocio" }} />
      {picker}
      <View style={{ height: 14 }} />
      <StatGrid>
        <Stat hot label="Ventas" value={p.count} sub={`en ${fin.days} días`} />
        <Stat label="Ingresos" value={usd(p.revenue)} sub="precio de venta" />
        <Stat label="Margen bruto" value={usd(p.margin)} sub="venta − costo y gastos" />
        <Stat label="Días en inventario" value={p.avg_days || "—"} sub="promedio al vender" />
      </StatGrid>
      <Section title="Ingresos de los últimos 12 meses">
        <Card style={{ paddingTop: 16, paddingHorizontal: 12, paddingBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: 130 }}>
            {fin.months.map((m: any) => {
              const h = Math.max(3, Math.round((Number(m.revenue) / top) * 100));
              return (
                <View key={m.month} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 6 }}>
                  {Number(m.revenue) ? <Gradient horizontal={false} style={{ width: "100%", maxWidth: 22, height: `${h * 0.78}%`, borderRadius: 5 }} /> : <View style={{ width: "100%", maxWidth: 22, height: 3, borderRadius: 2, backgroundColor: colors.surface3 }} />}
                  <Text style={{ fontFamily: font.bold, fontSize: 9, color: colors.muted }}>{MONTHS[Number(m.month.slice(5)) - 1]}</Text>
                </View>
              );
            })}
          </View>
        </Card>
      </Section>
      <View style={{ height: 24 }} />
      <StatGrid>
        <Stat label="A la venta" value={forSale} sub={`${usd(listValue)} a precio de lista`} onPress={() => router.navigate("/catalog")} />
        <Stat label="Por completar" value={stock.draft?.count || 0} sub="borradores sin publicar" onPress={() => router.push("/units")} />
        <Stat label="Reservas activas" value={fin.pipeline.count} sub={`${usd(fin.pipeline.deposits)} en depósitos anotados`} onPress={() => router.push("/holds")} />
        <Stat label="Más de 60 días" value={aged} sub="unidades sin vender" />
      </StatGrid>
      <Section title="Equipo" action={`${fin.days} días`}>
        {ranked.length ? (
          <CardList>
            {ranked.map((u: any, i: number) => (
              <ListRow key={u.id} left={<Avatar name={u.name} />} title={`${i + 1}. ${u.name}`} subtitle={`${u.sales} ventas · ${u.reservations} reservas · ${u.appointments} citas${u.omni?.conversations ? ` · ${u.omni.conversations} chats` : ""}`} right={<T style={{ fontFamily: font.bold }}>{usd(u.revenue)}</T>} />
            ))}
          </CardList>
        ) : <T v="muted">Sin actividad en este periodo.</T>}
      </Section>
      {fin.recent.length ? (
        <Section title="Ventas recientes">
          <CardList>
            {fin.recent.slice(0, 8).map((s: any) => (
              <ListRow key={s.id} title={`${s.year} ${s.make} ${s.model}`} subtitle={`${s.buyer_name} · ${s.seller_name || "—"} · ${String(s.sold_at).slice(0, 10)}`} right={<View style={{ alignItems: "flex-end" }}><T style={{ fontFamily: font.bold }}>{usd(s.price)}</T><T v="small" style={{ fontSize: 11 }}>margen {usd(s.margin)}</T></View>} />
            ))}
          </CardList>
        </Section>
      ) : null}
      <View style={{ gap: 8, marginTop: 24 }}>
        <Button variant="secondary" icon="settings-outline" title="Ajustes de cotización" onPress={() => router.push("/quote-settings")} full />
        <Button variant="secondary" icon="open-outline" title="Finanzas en el panel" onPress={() => Linking.openURL(publicUrl("/admin/"))} full />
      </View>
    </Screen>
  );
}
