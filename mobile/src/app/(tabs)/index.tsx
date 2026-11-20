import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { canSell, isAdmin, isService, useAuth } from "@/lib/auth";
import { dayLabel, todayISO, usd, ago } from "@/lib/format";
import { useUnread } from "@/lib/unread";
import { ApptRow, LeadRow, QuoteRow } from "@/components/rows";
import { Avatar, Button, CardList, Empty, Icon, ListRow, Loading, Pill, Screen, Section, Stat, StatGrid, T, type IconName } from "@/components/ui";
import { colors } from "@/theme";

export default function Today() {
  const { user } = useAuth();
  const router = useRouter();
  const unread = useUnread();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sum, leads, quotes, review] = await Promise.all([
        api("/api/admin/me/summary"),
        canSell(user) ? api<any[]>("/api/admin/leads") : [],
        canSell(user) ? api<any[]>("/api/admin/quotes").catch(() => []) : [],
        isAdmin(user) ? api<any[]>("/api/admin/intake").catch(() => []) : [],
      ]);
      setData({ sum, leads, quotes, review });
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [user]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!data) return <Screen>{error ? <Empty title="No se pudo cargar" body={error} action={<Button title="Reintentar" variant="secondary" onPress={load} />} /> : <Loading />}</Screen>;
  const { sum, leads, quotes, review } = data;
  const open = leads.filter((l: any) => !l.assigned_to && l.status === "new").slice(0, 5);
  const mine = leads.filter((l: any) => l.assigned_to === user?.id && l.status !== "closed").slice(0, 5);
  const go = (path: string) => () => router.navigate(path as any);

  const stats = isService(user)
    ? [
        <Stat key="a" hot label="Citas hoy" value={sum.today.length} sub={`${sum.upcoming} en los próximos 7 días`} onPress={go("/agenda")} />,
        <Stat key="b" label="Mis unidades" value={sum.units.loaded} sub={`${sum.units.drafts} en revisión`} onPress={go("/units")} />,
        <Stat key="c" label="Publicadas" value={sum.units.published} sub="de las que cargaste" onPress={go("/units")} />,
        <Stat key="d" label="Chats" value={unread} sub="mensajes sin leer" onPress={go("/chats")} />,
      ]
    : [
        <Stat key="a" hot label={isAdmin(user) ? "Mis ventas del mes" : "Ventas del mes"} value={sum.sales.count} sub={usd(sum.sales.revenue)} onPress={go(isAdmin(user) ? "/business" : "/holds")} />,
        <Stat key="b" label="Reservas activas" value={sum.reservations.count} sub={sum.reservations.expiring ? `${sum.reservations.expiring} vencen en 24 h` : "Ninguna por vencer"} onPress={go("/holds")} />,
        <Stat key="c" label="Citas hoy" value={sum.today.length} sub={`${sum.upcoming} en los próximos 7 días`} onPress={go("/agenda")} />,
        isAdmin(user) ? (
          <Stat key="d" hot={sum.units.drafts > 0} label="Por completar" value={sum.units.drafts} sub="unidades sin precio ni publicar" onPress={go("/units")} />
        ) : (
          <Stat key="d" label="Cotizaciones" value={sum.quotes.count} sub="este mes" onPress={go("/quotes")} />
        ),
      ];
  const quick: [IconName, string, () => void][] = isService(user)
    ? [
        ["camera-outline", "Cargar vehículo", () => router.push("/units/new")],
        ["construct-outline", "Cita de servicio", () => router.push({ pathname: "/appointment", params: { kind: "service" } })],
        ["car-sport-outline", "Catálogo", go("/catalog")],
        ["chatbubbles-outline", "Chats", go("/chats")],
      ]
    : [
        ["document-text-outline", "Cotizar", () => router.push("/quote/new")],
        ["bookmark-outline", "Reservar", () => router.push("/reserve")],
        ["calendar-outline", "Nueva cita", () => router.push("/appointment")],
        ["camera-outline", "Cargar vehículo", () => router.push("/units/new")],
      ];

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <T v="muted">{dayLabel(todayISO()).replace(/^./, (c) => c.toUpperCase())}</T>
      <View style={{ height: 14 }} />
      <StatGrid>{stats}</StatGrid>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
        {quick.map(([icon, label, onPress]) => (
          <View key={label} style={{ width: "48.2%" }}>
            <ListRowButton icon={icon} label={label} onPress={onPress} />
          </View>
        ))}
      </View>

      {isAdmin(user) && review.length ? (
        <Section title="Unidades por completar" action="Ver todas" onAction={go("/units")}>
          <CardList>
            {review.slice(0, 4).map((v: any) => (
              <ListRow
                key={v.id}
                onPress={() => router.push({ pathname: "/units/[id]", params: { id: v.id } })}
                left={<Avatar uri={v.photos[0]?.url} name={v.make} />}
                title={[v.year, v.make, v.model].join(" ")}
                subtitle={`${v.intakeName || "Panel"} · ${v.photos.length} fotos · ${ago(v.createdAt)}`}
                right={<Pill tone="violet">Completar</Pill>}
              />
            ))}
          </CardList>
        </Section>
      ) : null}

      <Section title="Tu agenda de hoy" action="Ver agenda" onAction={go("/agenda")}>
        <CardList>{sum.today.length ? sum.today.map((a: any) => <ApptRow key={a.id} a={a} />) : [<T key="n" v="muted" style={{ padding: 16 }}>No tienes citas hoy.</T>]}</CardList>
      </Section>

      {canSell(user) ? (
        <Section title="Consultas web por atender" action="Ver todas" onAction={go("/leads")}>
          <CardList>{open.length ? open.map((l: any) => <LeadRow key={l.id} l={l} onChanged={load} />) : [<T key="n" v="muted" style={{ padding: 16 }}>No hay consultas nuevas sin asignar.</T>]}</CardList>
        </Section>
      ) : null}
      {mine.length ? (
        <Section title="Mis consultas en curso">
          <CardList>{mine.map((l: any) => <LeadRow key={l.id} l={l} take={false} onChanged={load} />)}</CardList>
        </Section>
      ) : null}
      {quotes.length ? (
        <Section title="Cotizaciones recientes" action="Ver todas" onAction={go("/quotes")}>
          <CardList>{quotes.slice(0, 3).map((q: any) => <QuoteRow key={q.id} q={q} />)}</CardList>
        </Section>
      ) : null}
    </Screen>
  );
}

function ListRowButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <View style={{ borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }}>
      <ListRow
        onPress={onPress}
        left={
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" }}>
            <Icon name={icon} size={20} />
          </View>
        }
        title={<T v="h3" style={{ fontSize: 13.5 }} numberOfLines={2}>{label}</T>}
      />
    </View>
  );
}
