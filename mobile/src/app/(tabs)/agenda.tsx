import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api } from "@/lib/api";
import { isAdmin, isService, useAuth } from "@/lib/auth";
import { loadCatalog } from "@/lib/data";
import { addDays, dayLabel, todayISO, title } from "@/lib/format";
import { KIND } from "@/lib/labels";
import { ApptRow, ContactButtons } from "@/components/rows";
import { Button, CardList, ListRow, Loading, Notice, Pill, Screen, Section, Segmented, Select, Sheet, T, useNotify } from "@/components/ui";
import { colors } from "@/theme";

export default function Agenda() {
  const { user, team, crm } = useAuth();
  const notify = useNotify();
  const [start, setStart] = useState(todayISO());
  const [seller, setSeller] = useState("");
  const [list, setList] = useState<any[] | null>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [omniError, setOmniError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState<any>(null);

  const load = useCallback(async () => {
    const to = addDays(start, 6);
    const q = isAdmin(user) && seller ? `&seller=${seller}` : "";
    try {
      const [rows, omni] = await Promise.all([
        api<any[]>(`/api/admin/appointments?from=${start}&to=${to}${q}`),
        crm?.connected ? api<any[]>("/api/admin/crm/appointments").catch((e) => ({ error: e.message })) : null,
      ]);
      setList(rows);
      setPending(Array.isArray(omni) ? omni : []);
      setOmniError(omni && !Array.isArray(omni) ? (omni as any).error : "");
    } catch (e: any) {
      notify(e.message, true);
      setList((l) => l ?? []);
    }
  }, [start, seller, user, crm, notify]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <Screen
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Segmented
          value="x"
          options={[["prev", "←"], ["today", "Hoy"], ["next", "→"]]}
          onChange={(k) => {
            setList(null);
            setStart(k === "prev" ? addDays(start, -7) : k === "next" ? addDays(start, 7) : todayISO());
          }}
        />
        <T v="label" style={{ flex: 1, textAlign: "right" }} numberOfLines={1}>
          {dayLabel(start, { day: "numeric", month: "short" })} – {dayLabel(addDays(start, 6), { day: "numeric", month: "short" })}
        </T>
      </View>
      {isAdmin(user) ? (
        <View style={{ marginTop: 12 }}>
          <Select value={seller} options={[["", "Todo el equipo"], ...team.map((u) => [u.id, u.name] as [string, string])]} onChange={(v) => (setList(null), setSeller(v))} />
        </View>
      ) : null}

      {pending.length ? (
        <Section title="Por confirmar desde WhatsApp e IA">
          <CardList>
            {pending.map((o) => (
              <ListRow
                key={o.id}
                left={
                  <View style={{ width: 54 }}>
                    <T style={{ fontSize: 14 }}>{o.local.time}</T>
                    <T v="small" style={{ fontSize: 11 }}>{dayLabel(o.local.date, { day: "numeric", month: "short" })}</T>
                  </View>
                }
                title={o.contactName || "Cliente"}
                subtitle={`${o.service}${o.agentName ? " · " + o.agentName : ""} · ${o.source === "ai" ? "agendada por la IA" : "Omnicanal"}`}
                right={<Button size="sm" title="Confirmar" onPress={() => setConfirming(o)} />}
              >
                <ContactButtons phone={o.contactPhone} />
              </ListRow>
            ))}
          </CardList>
        </Section>
      ) : omniError ? (
        <View style={{ marginTop: 16 }}>
          <Notice tone="bad">Omnicanal: {omniError}</Notice>
        </View>
      ) : null}

      {list === null ? (
        <Loading />
      ) : (
        days.map((d) => {
          const items = list.filter((a) => a.local_date === d);
          return (
            <Section
              key={d}
              title={dayLabel(d).replace(/^./, (c) => c.toUpperCase())}
              action={d === todayISO() ? "Hoy" : items.length ? String(items.length) : ""}
            >
              <CardList>{items.length ? items.map((a) => <ApptRow key={a.id} a={a} />) : [<T key="n" v="muted" style={{ padding: 16, fontSize: 13 }}>Sin citas.</T>]}</CardList>
            </Section>
          );
        })
      )}
      <ConfirmSheet o={confirming} onClose={() => setConfirming(null)} onDone={() => (setConfirming(null), load())} isSvc={isService(user)} admin={isAdmin(user)} team={team} meId={user?.id ?? ""} />
    </Screen>
  );
}

function ConfirmSheet({ o, onClose, onDone, isSvc, admin, team, meId }: { o: any; onClose: () => void; onDone: () => void; isSvc: boolean; admin: boolean; team: { id: string; name: string }[]; meId: string }) {
  const notify = useNotify();
  const kinds = Object.entries(KIND).filter(([k]) => admin || (isSvc ? k === "service" || k === "visit" : k !== "service")) as [string, string][];
  const guess = o && /servicio|taller|mantenimiento|aceite|reparaci/i.test(o.service) ? "service" : o && /prueba|manejo|test/i.test(o.service) ? "testdrive" : "visit";
  const [kind, setKind] = useState("visit");
  const [vehicleId, setVehicleId] = useState("");
  const [sellerId, setSellerId] = useState(meId);
  const [vehicles, setVehicles] = useState<[string, string][]>([]);
  const [busy, setBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!o) return;
      setKind(kinds.some(([k]) => k === guess) ? guess : kinds[0][0]);
      setVehicleId("");
      loadCatalog().then((c) => setVehicles(c.map((v) => [v.id, `${v.stock} · ${title(v)}`])));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [o]),
  );
  return (
    <Sheet visible={!!o} onClose={onClose} title="Confirmar cita de Omnicanal">
      {o ? (
        <View style={{ gap: 14 }}>
          <T v="small">
            {o.contactName || "Cliente"} · {dayLabel(o.local.date)} {o.local.time}
            {"\n"}
            {o.service}
            {o.notes ? " · " + o.notes : ""}
          </T>
          <Select label="Tipo" value={kind} options={kinds} onChange={setKind} />
          <Select label="Vehículo" value={vehicleId} options={[["", "Sin vehículo"], ...vehicles]} onChange={setVehicleId} />
          {admin ? <Select label="Asignada a" value={sellerId} options={team.map((u) => [u.id, u.name] as [string, string])} onChange={setSellerId} /> : null}
          <T v="small">Queda en tu agenda y Omnicanal la marca como confirmada y asignada a ti.</T>
          <Button
            title="Confirmar y agendar"
            loading={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await api(`/api/admin/crm/appointments/${o.id}/confirm`, { method: "POST", body: { kind, vehicleId: vehicleId || null, ...(admin ? { sellerId } : {}) } });
                notify("Cita confirmada en tu agenda.");
                onDone();
              } catch (e: any) {
                notify(e.message, true);
              } finally {
                setBusy(false);
              }
            }}
            full
          />
        </View>
      ) : null}
    </Sheet>
  );
}
