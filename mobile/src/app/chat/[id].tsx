import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Linking, Pressable, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { useKeyboardHeight } from "@/lib/keyboard";
import { canSell, useAuth } from "@/lib/auth";
import { loadCatalog } from "@/lib/data";
import { clock, hasPrice, priceText, telUrl, title, type Vehicle } from "@/lib/format";
import { CHANNEL, CONVO_STATUS } from "@/lib/labels";
import { Button, Empty, Icon, ListRow, Loading, Photo, Pill, SearchBar, Sheet, T, useNotify } from "@/components/ui";
import { asset } from "@/lib/api";
import { colors, font } from "@/theme";

type Mode = "send" | "quote" | "reserve";

export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, crm } = useAuth();
  const router = useRouter();
  const notify = useNotify();
  const kb = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState<Mode | null>(null);
  const list = useRef<FlatList>(null);
  const atBottom = useRef(true);

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/admin/crm/conversations/${id}`));
    } catch (e: any) {
      notify(e.message, true);
    }
  }, [id, notify]);
  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, 8000);
      return () => clearInterval(t);
    }, [load]),
  );
  useEffect(() => {
    if (data && atBottom.current) setTimeout(() => list.current?.scrollToEnd({ animated: false }), 50);
  }, [data]);

  if (!data) return <View style={{ flex: 1, backgroundColor: colors.bg }}><Loading /></View>;
  const c = data.conversation;
  const [label, tone] = CHANNEL[c.channel] || [c.channel, "neutral" as const];
  const mine = c.agentId && c.agentId === crm?.me?.agentId;
  const linked = Boolean(crm?.me?.agentId);
  const closed = c.windowExpiresAt && new Date(c.windowExpiresAt) < new Date();
  const customer = { customerName: c.contactName || "", customerPhone: c.contactPhone || "", omniConversationId: String(c.id) };

  const send = async () => {
    const content = text.trim();
    if (!content) return;
    setSending(true);
    try {
      await api(`/api/admin/crm/conversations/${id}/messages`, { method: "POST", body: { content } });
      setText("");
      atBottom.current = true;
      await load();
    } catch (e: any) {
      notify(e.message, true);
    } finally {
      setSending(false);
    }
  };
  const act = (path: string, ok: string, after?: () => void) => async () => {
    try {
      await api(`/api/admin/crm/conversations/${id}/${path}`, { method: "POST" });
      notify(ok);
      after ? after() : await load();
    } catch (e: any) {
      notify(e.message, true);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingBottom: kb }}>
      <Stack.Screen options={{ title: c.contactName || c.contactPhone || "Chat" }} />
      <View style={{ paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <Pill tone={tone}>{label}</Pill>
        <T v="small">{CONVO_STATUS[c.status] || c.status} · {mine ? "tuyo" : c.agentName || "sin asignar"}</T>
      </View>
      <FlatList
        horizontal
        data={[
          ...(linked && !mine ? [{ k: "claim", t: "Tomar", p: true }] : []),
          ...(telUrl(c.contactPhone) ? [{ k: "call", t: "Llamar" }] : []),
          { k: "send", t: "Enviar vehículo" },
          ...(canSell(user) ? [{ k: "quote", t: "Cotizar" }, { k: "reserve", t: "Reservar" }] : []),
          { k: "appt", t: "Agendar" },
          ...(c.status !== "resolved" ? [{ k: "resolve", t: "Resolver", g: true }] : []),
        ]}
        keyExtractor={(i) => i.k}
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line }}
        contentContainerStyle={{ padding: 8, gap: 6 }}
        renderItem={({ item }) => (
          <Button
            size="sm"
            title={item.t}
            variant={item.p ? "primary" : item.g ? "ghost" : "secondary"}
            onPress={() => {
              if (item.k === "claim") return act("claim", "Conversación tomada: ahora está en Mis chats.")();
              if (item.k === "call") return Linking.openURL(telUrl(c.contactPhone));
              if (item.k === "send" || item.k === "quote" || item.k === "reserve") return setPicker(item.k as Mode);
              if (item.k === "appt") return router.push({ pathname: "/appointment", params: { kind: "testdrive", ...customer } });
              if (item.k === "resolve") return act("resolve", "Conversación resuelta.", () => router.back())();
            }}
          />
        )}
      />
      <FlatList
        ref={list}
        data={data.messages}
        keyExtractor={(m: any) => String(m.id)}
        contentContainerStyle={{ padding: 12, gap: 6, flexGrow: 1 }}
        style={{ backgroundColor: colors.bg2 }}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          atBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
        }}
        scrollEventThrottle={100}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<T v="small" style={{ textAlign: "center", marginTop: 20 }}>Sin mensajes todavía.</T>}
        renderItem={({ item: m }) => <Bubble m={m} />}
      />
      {closed ? (
        <View style={{ padding: 10, backgroundColor: "rgba(255,200,87,0.1)" }}>
          <T v="small" style={{ color: colors.warn }}>Pasaron más de 24 h desde el último mensaje del cliente: Meta solo permite plantillas aprobadas. Envíala desde Omnicanal o espera a que el cliente escriba.</T>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, paddingBottom: 10 + (kb ? 0 : insets.bottom), borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: "rgba(9,11,17,0.97)" }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Escribe un mensaje…"
          placeholderTextColor="rgba(138,146,165,0.7)"
          multiline
          maxLength={4000}
          style={{ flex: 1, minHeight: 46, maxHeight: 140, borderRadius: 23, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, color: colors.text, fontFamily: font.medium, fontSize: 16 }}
        />
        <Pressable onPress={send} disabled={sending || !text.trim()} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", opacity: sending || !text.trim() ? 0.5 : 1 }}>
          <Icon name="send" size={20} color={colors.accentInk} />
        </Pressable>
      </View>
      <VehiclePicker
        mode={picker}
        onClose={() => setPicker(null)}
        onPick={async (v) => {
          const mode = picker!;
          setPicker(null);
          if (mode === "send") {
            try {
              await api(`/api/admin/crm/conversations/${id}/vehicle`, { method: "POST", body: { vehicleId: v.id } });
              notify("Vehículo enviado al chat.");
              await load();
            } catch (e: any) {
              notify(e.message, true);
            }
          } else setTimeout(() => router.push({ pathname: mode === "quote" ? "/quote/new" : "/reserve", params: { vehicleId: v.id, ...customer } }), 150);
        }}
      />
    </View>
  );
}

function Bubble({ m }: { m: any }) {
  if (m.internal) return <View style={{ alignSelf: "center", maxWidth: "90%", backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}><T v="small" style={{ textAlign: "center", color: colors.text2 }}>{m.content}</T></View>;
  const own = m.sender !== "contact";
  const bg = m.sender === "bot" ? "rgba(124,92,255,0.2)" : m.sender === "agent" ? "rgba(56,225,255,0.14)" : colors.surface2;
  return (
    <View style={{ alignSelf: own ? "flex-end" : "flex-start", maxWidth: "82%", backgroundColor: bg, borderRadius: 16, borderTopRightRadius: own ? 4 : 16, borderTopLeftRadius: own ? 16 : 4, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, borderWidth: m.failed ? 1 : 0, borderColor: colors.bad }}>
      {m.sender === "bot" || m.sender === "agent" ? <Text style={{ fontFamily: font.black, fontSize: 10, letterSpacing: 0.8, color: colors.text2, marginBottom: 2 }}>{m.sender === "bot" ? "IA" : "EQUIPO"}</Text> : null}
      {m.media && !m.deleted ? (
        m.type === "image" ? (
          <Photo path={m.media} style={{ width: 230, height: 170, borderRadius: 10, marginBottom: 4 }} />
        ) : (
          <T v="small" style={{ color: colors.text2, marginBottom: 4 }}>
            📎 {m.type === "audio" ? "Audio" : m.type === "video" ? "Video" : m.mediaName || "Archivo"} · ábrelo desde el panel
          </T>
        )
      ) : null}
      {m.deleted ? <T style={{ fontStyle: "italic" }}>Mensaje eliminado</T> : m.content ? <T style={{ fontSize: 14.5 }}>{m.content}</T> : null}
      {m.failed ? <T v="small" style={{ color: colors.bad }}>No le llegó al cliente{m.failedReason ? ": " + m.failedReason : ""}</T> : null}
      <T v="small" style={{ fontSize: 10, textAlign: "right", marginTop: 2 }}>{clock(m.createdAt)}</T>
    </View>
  );
}

function VehiclePicker({ mode, onClose, onPick }: { mode: Mode | null; onClose: () => void; onPick: (v: Vehicle) => void }) {
  const [all, setAll] = useState<Vehicle[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (mode) loadCatalog().then(setAll);
  }, [mode]);
  const shown = all
    .filter((v) => mode === "send" || (!v.demo && (mode === "quote" ? hasPrice(v) : v.status === "available")))
    .filter((v) => `${v.stock} ${title(v)}`.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 60);
  return (
    <Sheet visible={!!mode} onClose={onClose} title={mode === "reserve" ? "¿Qué vehículo reserva?" : mode === "quote" ? "¿Qué vehículo cotizas?" : "¿Qué vehículo envías?"}>
      <SearchBar value={q} onChangeText={setQ} placeholder="Buscar" />
      <View style={{ height: 10 }} />
      {shown.length ? (
        shown.map((v) => (
          <ListRow key={v.id} onPress={() => onPick(v)} left={<Photo path={typeof v.photos[0] === "string" ? v.photos[0] : v.photos[0]?.url} style={{ width: 54, height: 40, borderRadius: 8 }} />} title={title(v)} subtitle={`Stock ${v.stock} · ${priceText(v)}${v.reservation ? " · reservado" : ""}`} />
        ))
      ) : (
        <Empty title="Sin vehículos" />
      )}
    </Sheet>
  );
}
