// The Omnicanal inbox: WhatsApp, Instagram and Facebook as the person's own agent.
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import { ago } from "@/lib/format";
import { CHANNEL } from "@/lib/labels";
import { setUnread } from "@/lib/unread";
import { Avatar, Button, Empty, ListRow, Loading, Notice, Pill, SearchBar, Segmented, T } from "@/components/ui";
import { colors } from "@/theme";

export function ConvoRow({ c, mineId, onPress }: { c: any; mineId?: number | null; onPress: () => void }) {
  const [label, tone] = CHANNEL[c.channel] || [c.channel, "neutral" as const];
  const owner = c.agentId && c.agentId === mineId ? "Tuyo" : c.agentName ? c.agentName : "Sin asignar";
  return (
    <ListRow
      onPress={onPress}
      left={<Avatar name={c.contactName || c.contactPhone} />}
      title={
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <T v="h3" style={{ flex: 1, fontSize: 14.5 }} numberOfLines={1}>{c.contactName || c.contactPhone || "Cliente"}</T>
          <T v="small" style={{ fontSize: 11 }}>{ago(c.updatedAt)}</T>
        </View>
      }
      subtitle={c.lastMessage || "—"}
    >
      <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
        <Pill tone={tone}>{label}</Pill>
        {c.status === "bot" ? <Pill tone="violet">IA</Pill> : null}
        <Pill>{owner}</Pill>
        {c.unreadCount ? <Pill tone="info">{String(c.unreadCount)} nuevos</Pill> : null}
      </View>
    </ListRow>
  );
}

export default function Chats() {
  const { user, crm, refreshCrm } = useAuth();
  const router = useRouter();
  const linked = Boolean(crm?.me?.agentId);
  const [scope, setScope] = useState<"mine" | "general" | "resolved">(linked ? "mine" : "general");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<any[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "unconfigured" | "down" | "unlinked">("loading");
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const load = useCallback(async () => {
    const c = await refreshCrm(!crm?.connected);
    if (!c?.configured) return setStatus("unconfigured");
    if (!c.connected) return (setError(c.error || ""), setStatus("down"));
    const isLinked = Boolean(c.me?.agentId);
    if (!isLinked && !isAdmin(user)) return (setError(c.me?.error || ""), setStatus("unlinked"));
    const useScope = !isLinked && scope === "mine" ? "general" : scope;
    try {
      const q = search ? `&search=${encodeURIComponent(search)}` : "";
      const { conversations } = await api<{ conversations: any[] }>(`/api/admin/crm/conversations?scope=${useScope}${q}`);
      setList(conversations);
      setStatus("ok");
      if (useScope === "mine") setUnread(conversations.reduce((n, x) => n + x.unreadCount, 0));
    } catch (e: any) {
      setError(e.message);
      setStatus("down");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, search, user]);

  useFocusEffect(
    useCallback(() => {
      load();
      timer.current = setInterval(load, 10_000);
      return () => clearInterval(timer.current);
    }, [load]),
  );
  useEffect(() => {
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  if (status === "loading") return <Loading />;
  if (status === "unconfigured") return <Empty title="Omnicanal aún no está conectado." body="Cuando administración conecte Omnicanal, aquí atenderás WhatsApp, Instagram y Facebook como agente." />;
  if (status === "down") return <Empty title="No se pudo conectar con Omnicanal." body={error || "Inténtalo de nuevo en unos minutos."} action={<Button title="Reintentar" variant="secondary" onPress={load} />} />;
  if (status === "unlinked") return <Empty title="Tu usuario no está vinculado a Omnicanal." body={error || "Pide a administración que te vincule a tu agente (Más → Equipo)."} />;
  const scopes: ["mine" | "general" | "resolved", string][] = [["mine", "Mis chats"], ["general", "Por atender"], ["resolved", "Resueltos"]];
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={list ?? []}
      keyExtractor={(c) => String(c.id)}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 12 }}>
          <Segmented value={scope} options={scopes.filter(([k]) => k !== "mine" || linked)} onChange={setScope} />
          <SearchBar value={search} onChangeText={setSearch} placeholder="Buscar cliente o mensaje" />
          {!linked ? <Notice tone="info">Atiendes como administración. Vincula tu usuario a un agente (Más → Equipo) para tener chats propios y tomar conversaciones.</Notice> : null}
        </View>
      }
      renderItem={({ item, index }) => (
        <View style={{ borderWidth: 1, borderColor: colors.line, backgroundColor: "rgba(255,255,255,0.04)", borderTopLeftRadius: index === 0 ? 20 : 0, borderTopRightRadius: index === 0 ? 20 : 0, borderBottomLeftRadius: index === (list?.length ?? 0) - 1 ? 20 : 0, borderBottomRightRadius: index === (list?.length ?? 0) - 1 ? 20 : 0, overflow: "hidden", marginTop: index ? -1 : 0 }}>
          <ConvoRow c={item} mineId={crm?.me?.agentId} onPress={() => router.push({ pathname: "/chat/[id]", params: { id: String(item.id) } })} />
        </View>
      )}
      ListEmptyComponent={<T v="muted" style={{ padding: 16 }}>{scope === "mine" ? "No tienes chats abiertos. Toma uno en «Por atender»." : "No hay conversaciones aquí."}</T>}
    />
  );
}
