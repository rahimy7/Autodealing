// A new appointment (optionally prefilled from a chat, a web inquiry or a quote) or an existing one.
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { isAdmin, isService, useAuth } from "@/lib/auth";
import { loadCatalog } from "@/lib/data";
import { addDays, nowTime, title, todayISO } from "@/lib/format";
import { APPT_STATUS, DURATIONS, KIND } from "@/lib/labels";
import { DateField, TimeField } from "@/components/fields";
import { ContactButtons } from "@/components/rows";
import { Button, Field, FormRow, Loading, Notice, Screen, Select, T, useNotify } from "@/components/ui";

export default function AppointmentScreen() {
  const p = useLocalSearchParams<Record<string, string>>();
  const { user, team, crm } = useAuth();
  const router = useRouter();
  const notify = useNotify();
  const editing = Boolean(p.id);
  const [loaded, setLoaded] = useState(!editing);
  const [existing, setExisting] = useState<any>(null);
  const [vehicles, setVehicles] = useState<[string, string][]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const kinds = Object.entries(KIND).filter(([k]) => isAdmin(user) || (isService(user) ? ["service", "delivery", "call", "followup", "visit"].includes(k) : k !== "service")) as [string, string][];
  const nextHour = String(Math.min(19, Number(nowTime().slice(0, 2)) + 1)).padStart(2, "0") + ":00";
  const [kind, setKind] = useState(kinds.some(([k]) => k === p.kind) ? p.kind! : kinds[0][0]);
  const [duration, setDuration] = useState(kind === "service" ? "120" : "60");
  const [date, setDate] = useState(p.date || todayISO());
  const [time, setTime] = useState(p.time || nextHour);
  const [vehicleId, setVehicleId] = useState(p.vehicleId || "");
  const [name, setName] = useState(p.customerName || "");
  const [phone, setPhone] = useState(p.customerPhone || "");
  const [email, setEmail] = useState(p.customerEmail || "");
  const [sellerId, setSellerId] = useState(p.sellerId || user?.id || "");
  const [notes, setNotes] = useState(p.notes || "");
  const [status, setStatus] = useState("confirmed");

  useEffect(() => {
    loadCatalog().then((c) => setVehicles(c.map((v) => [v.id, `${v.stock} · ${title(v)}`])));
    if (!editing) return;
    api<any[]>(`/api/admin/appointments?from=${addDays(todayISO(), -30)}&to=${addDays(todayISO(), 365)}`)
      .then((rows) => {
        const a = rows.find((x) => x.id === p.id);
        if (a) {
          setExisting(a);
          setStatus(a.status);
          setDate(a.local_date);
          setTime(a.local_time);
          setDuration(String(a.duration_minutes));
          setSellerId(a.seller_id || "");
          setNotes(a.notes || "");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, [editing, p.id]);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (editing) {
        const body: any = { status, date, time, durationMinutes: Number(duration), notes };
        if (isAdmin(user)) body.sellerId = sellerId || null;
        const a = await api<any>(`/api/admin/appointments/${p.id}`, { method: "PUT", body });
        notify(a.sync_error ? `Guardada. Omnicanal: ${a.sync_error}` : "Cita actualizada.", Boolean(a.sync_error));
      } else {
        const body: any = { kind, date, time, durationMinutes: Number(duration), customerName: name, customerPhone: phone, customerEmail: email, notes };
        if (vehicleId) body.vehicleId = vehicleId;
        if (isAdmin(user) && sellerId) body.sellerId = sellerId;
        if (p.leadId) body.leadId = p.leadId;
        if (p.omniConversationId) body.omniConversationId = Number(p.omniConversationId);
        const a = await api<any>("/api/admin/appointments", { method: "POST", body });
        notify(a.sync_error ? `Cita agendada. Omnicanal: ${a.sync_error}` : "Cita agendada.", Boolean(a.sync_error));
      }
      router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Screen><Loading /></Screen>;
  const headline = editing ? `${KIND[existing?.kind] || "Cita"} · ${existing?.customer_name ?? ""}` : p.omniConversationId ? "Agendar para este cliente" : "Nueva cita";
  return (
    <Screen error={error} footer={<Button title={editing ? "Guardar" : "Agendar"} onPress={save} loading={busy} full />}>
      <Stack.Screen options={{ title: editing ? "Cita" : "Nueva cita" }} />
      <View style={{ gap: 14 }}>
        <T v="h2">{headline}</T>
        {editing && existing ? (
          <>
            {existing.make ? <T v="small">{`${existing.year} ${existing.make} ${existing.model} · stock ${existing.stock}`}</T> : null}
            <ContactButtons phone={existing.customer_phone} email={existing.customer_email} />
            <Select label="Estado" value={status} options={Object.entries(APPT_STATUS) as [string, string][]} onChange={setStatus} />
          </>
        ) : (
          <FormRow>
            <Select label="Tipo" value={kind} options={kinds} onChange={(k) => (setKind(k), setDuration(k === "service" ? "120" : "60"))} />
            <Select label="Duración" value={duration} options={DURATIONS} onChange={setDuration} />
          </FormRow>
        )}
        <FormRow>
          <DateField label="Fecha" value={date} onChange={setDate} />
          <TimeField label="Hora" value={time} onChange={setTime} />
        </FormRow>
        {editing ? <Select label="Duración" value={duration} options={DURATIONS} onChange={setDuration} /> : null}
        {!editing ? (
          <>
            <Select label="Vehículo" value={vehicleId} options={[["", "Sin vehículo del inventario"], ...vehicles]} onChange={setVehicleId} />
            <Field label="Cliente *" value={name} onChangeText={setName} maxLength={160} autoCorrect={false} />
            <FormRow>
              <Field label="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={60} />
              <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" maxLength={200} />
            </FormRow>
          </>
        ) : null}
        {isAdmin(user) ? <Select label="Asignada a" value={sellerId} options={[...(editing ? ([["", "Sin asignar"]] as [string, string][]) : []), ...team.map((u) => [u.id, u.name] as [string, string])]} onChange={setSellerId} /> : editing && existing && !existing.seller_id ? <Notice>Cita sin asignar: al guardar queda a tu nombre.</Notice> : null}
        <Field label={`Notas${isService(user) ? " (trabajo a realizar, vehículo del cliente)" : ""}`} value={notes} onChangeText={setNotes} multiline maxLength={2000} />
        {existing?.sync_error ? <Notice tone="bad">Omnicanal: {existing.sync_error}. Se reintenta al guardar.</Notice> : null}
        <T v="small">Hora del concesionario (Nueva York).{crm?.connected ? " También queda en Omnicanal: si el cliente ya escribió por WhatsApp, Instagram o Facebook, recibe allí el recordatorio." : ""}</T>
      </View>
    </Screen>
  );
}
