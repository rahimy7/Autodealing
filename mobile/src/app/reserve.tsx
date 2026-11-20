import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import { forgetCatalog, loadCatalog } from "@/lib/data";
import { priceText, title, type Vehicle } from "@/lib/format";
import { Button, Field, FormRow, Loading, Screen, Select, T, useNotify } from "@/components/ui";

export default function Reserve() {
  const p = useLocalSearchParams<Record<string, string>>();
  const { user, team } = useAuth();
  const router = useRouter();
  const notify = useNotify();
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState(p.vehicleId || "");
  const [name, setName] = useState(p.customerName || "");
  const [phone, setPhone] = useState(p.customerPhone || "");
  const [email, setEmail] = useState(p.customerEmail || "");
  const [deposit, setDeposit] = useState("");
  const [days, setDays] = useState("3");
  const [sellerId, setSellerId] = useState(user?.id ?? "");
  const [notes, setNotes] = useState(p.notes || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadCatalog().then((c) => {
      const list = c.filter((v) => v.id === p.vehicleId || (v.status === "available" && !v.demo));
      setVehicles(list);
      if (!p.vehicleId && list[0]) setVehicleId(list[0].id);
    });
  }, [p.vehicleId]);

  if (!vehicles) return <Screen><Loading /></Screen>;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const body: any = { vehicleId, customerName: name, customerPhone: phone, customerEmail: email, deposit: Number(deposit) || 0, days: Number(days), notes };
      if (isAdmin(user)) body.sellerId = sellerId;
      if (p.omniConversationId) body.omniConversationId = Number(p.omniConversationId);
      await api("/api/admin/reservations", { method: "POST", body });
      forgetCatalog();
      notify("Reserva creada. El vehículo figura como reservado.");
      router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const current = vehicles.find((v) => v.id === vehicleId);
  return (
    <Screen error={error} footer={<Button title="Confirmar reserva" onPress={submit} loading={busy} disabled={!vehicleId || !name} full />}>
      <Stack.Screen options={{ title: "Reservar para un cliente" }} />
      <View style={{ gap: 14 }}>
        {!vehicles.length ? <T v="muted">No hay vehículos disponibles para reservar.</T> : p.vehicleId && current ? <T v="h3">{`${current.stock} · ${title(current)}`}</T> : <Select label="Vehículo" value={vehicleId} options={vehicles.map((v) => [v.id, `${v.stock} · ${title(v)} · ${priceText(v)}`] as [string, string])} onChange={setVehicleId} />}
        <Field label="Nombre del cliente *" value={name} onChangeText={setName} maxLength={160} autoCorrect={false} />
        <FormRow>
          <Field label="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={60} />
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" maxLength={200} />
        </FormRow>
        <FormRow>
          <Field label="Depósito (USD)" value={deposit} onChangeText={setDeposit} keyboardType="decimal-pad" placeholder="0" />
          <Select label="Plazo" value={days} options={["1", "2", "3", "5", "7", "14", "30"].map((d) => [d, `${d} ${d === "1" ? "día" : "días"}`] as [string, string])} onChange={setDays} />
        </FormRow>
        {isAdmin(user) ? <Select label="Vendedor" value={sellerId} options={team.filter((u) => u.role !== "service").map((u) => [u.id, u.name] as [string, string])} onChange={setSellerId} /> : null}
        <Field label="Notas" value={notes} onChangeText={setNotes} multiline maxLength={2000} />
        <T v="small">La unidad queda como «Reservado» en la página hasta que la vendas, la liberes o venza el plazo. El depósito es solo un registro: la app no cobra.</T>
      </View>
    </Screen>
  );
}
