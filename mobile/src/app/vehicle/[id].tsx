import { useCallback, useState } from "react";
import { Dimensions, FlatList, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { canSell, isAdmin, isService, useAuth } from "@/lib/auth";
import { forgetCatalog, loadCatalog } from "@/lib/data";
import { hasPrice, localized, num, priceText, title, until, type Vehicle } from "@/lib/format";
import { AddPhotosSheet } from "@/components/photos";
import { ShareSheet } from "@/components/share";
import { Avatar, Button, Empty, ListRow, Loading, Notice, Photo, Screen, Sheet, T, useNotify } from "@/components/ui";
import { colors, font } from "@/theme";

const W = Dimensions.get("window").width;
const COND: Record<string, string> = { used: "Usado", new: "Nuevo", certified: "Certificado" };
const FUEL: Record<string, string> = { gas: "Gasolina", diesel: "Diésel", hybrid: "Híbrido", electric: "Eléctrico" };

export default function VehicleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, crm } = useAuth();
  const router = useRouter();
  const notify = useNotify();
  const [v, setV] = useState<Vehicle | null>(null);
  const [missing, setMissing] = useState(false);
  const [page, setPage] = useState(0);
  const [share, setShare] = useState(false);
  const [photos, setPhotos] = useState(false);
  const [chats, setChats] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    const list = await loadCatalog(true);
    const found = list.find((x) => x.id === id);
    setV(found ?? null);
    setMissing(!found);
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => notify(e.message, true));
    }, [load, notify]),
  );

  if (missing) return <Screen><Empty title="Esta unidad ya no está en el catálogo" body="Se vendió, se archivó o aún no se publica." /></Screen>;
  if (!v) return <Screen><Loading /></Screen>;
  const r = v.reservation;
  const sellable = !v.demo;
  const reservable = canSell(user) && v.status === "available" && sellable;
  const closable = canSell(user) && r && (r.mine || isAdmin(user));
  const quotable = canSell(user) && sellable && hasPrice(v);
  const urls = v.photos.map((p: any) => (typeof p === "string" ? p : p.url));
  const spec = (label: string, value?: string | number | null) => (value ? { label, value: String(value) } : null);
  const specs = [
    spec("Millaje", `${num(v.miles)} mi`), spec("Condición", COND[v.condition || ""]), spec("Motor", v.engine), spec("Transmisión", localized(v.trans)),
    spec("Tracción", v.drive), spec("Combustible", FUEL[v.fuel || ""]), spec("Exterior", localized(v.ext)), spec("Interior", localized(v.int)), spec("VIN", v.vin),
  ].filter(Boolean) as { label: string; value: string }[];
  const go = (pathname: string, params: Record<string, string> = {}) => router.push({ pathname, params: { vehicleId: v.id, ...params } } as any);

  const openChats = async () => {
    try {
      const { conversations } = await api<{ conversations: any[] }>(`/api/admin/crm/conversations?scope=${crm?.me?.agentId ? "mine" : "general"}`);
      setChats(conversations.slice(0, 40));
    } catch (e: any) {
      notify(e.message, true);
    }
  };
  const sendToChat = async (cid: number) => {
    try {
      await api(`/api/admin/crm/conversations/${cid}/vehicle`, { method: "POST", body: { vehicleId: v.id } });
      setChats(null);
      notify("Vehículo enviado al chat.");
    } catch (e: any) {
      notify(e.message, true);
    }
  };

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: title(v) }} />
      {urls.length ? (
        <View>
          <FlatList
            data={urls}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(u) => u}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / W))}
            renderItem={({ item }) => <Photo path={item} style={{ width: W, aspectRatio: 16 / 10 }} />}
          />
          {urls.length > 1 ? (
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 5, marginTop: 10 }}>
              {urls.map((u, i) => (
                <View key={u} style={{ width: i === page ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === page ? colors.accent : colors.line2 }} />
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <View style={{ padding: 16 }}><Notice>Esta unidad aún no tiene fotos.</Notice></View>
      )}
      <View style={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T style={{ fontFamily: hasPrice(v) ? font.display : font.bold, fontSize: hasPrice(v) ? 26 : 16, letterSpacing: -0.8, color: hasPrice(v) ? colors.text : colors.muted }}>{priceText(v)}</T>
          <T v="small">Stock {v.stock}</T>
        </View>
        {r ? <Notice>{r.mine ? "Reservado por ti" : "Reservado por " + r.sellerName}{r.customerName ? " para " + r.customerName : ""} · {until(r.expiresAt)}.</Notice> : null}
        {v.demo ? <Notice>Unidad de demostración: no se reserva, cotiza ni vende.</Notice> : null}
        {canSell(user) && !hasPrice(v) && sellable ? <Notice tone="info">Administración aún no cargó el precio: no se puede cotizar.</Notice> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 14 }}>
          {specs.map((s) => (
            <View key={s.label} style={{ width: "50%", paddingRight: 10 }}>
              <T v="eyebrow" style={{ color: colors.muted, letterSpacing: 1.4 }}>{s.label}</T>
              <T style={{ fontFamily: font.bold, fontSize: 14 }}>{s.value}</T>
            </View>
          ))}
        </View>
        {localized(v.desc) ? <T v="muted">{localized(v.desc)}</T> : null}
        <View style={{ gap: 8, marginTop: 6 }}>
          {quotable ? <Button title="Generar cotización" icon="document-text-outline" onPress={() => go("/quote/new")} full /> : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {reservable ? <View style={{ flex: 1 }}><Button title="Reservar" variant={quotable ? "secondary" : "primary"} icon="bookmark-outline" onPress={() => go("/reserve")} full /></View> : null}
            {closable ? <View style={{ flex: 1 }}><Button title="Registrar venta" onPress={() => go("/sale", r ? { reservationId: r.id } : {})} full /></View> : null}
            <View style={{ flex: 1 }}>
              <Button title={isService(user) ? "Agendar servicio" : "Prueba de manejo"} variant="secondary" icon="calendar-outline" onPress={() => go("/appointment", { kind: isService(user) ? "service" : "testdrive" })} full />
            </View>
          </View>
          <Button title="Compartir por WhatsApp" variant="wa" icon="logo-whatsapp" onPress={() => setShare(true)} full />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {crm?.connected && crm.me?.agentId ? <View style={{ flex: 1 }}><Button title="Enviar a un chat" variant="secondary" icon="chatbubbles-outline" onPress={openChats} full /></View> : null}
            <View style={{ flex: 1 }}><Button title="Agregar fotos" variant="secondary" icon="camera-outline" onPress={() => setPhotos(true)} full /></View>
          </View>
          {isAdmin(user) ? <Button title="Editar ficha y precio" variant="secondary" icon="create-outline" onPress={() => router.push({ pathname: "/units/[id]", params: { id: v.id } })} full /> : null}
        </View>
      </View>
      <ShareSheet v={v} visible={share} onClose={() => setShare(false)} />
      <AddPhotosSheet visible={photos} vehicleId={v.id} label={title(v)} onClose={() => setPhotos(false)} onDone={() => (forgetCatalog(), load())} />
      <Sheet visible={!!chats} onClose={() => setChats(null)} title="Enviar a un chat">
        {chats?.length ? (
          <>
            <T v="small" style={{ marginBottom: 8 }}>Se envía {title(v)} con su precio y el enlace a sus fotos.</T>
            {chats.map((c) => (
              <ListRow key={c.id} onPress={() => sendToChat(c.id)} left={<Avatar name={c.contactName} />} title={c.contactName || c.contactPhone} subtitle={c.lastMessage} />
            ))}
          </>
        ) : (
          <Empty title="No tienes chats abiertos." body="Toma una conversación en Chats → Por atender." />
        )}
      </Sheet>
    </Screen>
  );
}

