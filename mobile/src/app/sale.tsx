import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import { forgetCatalog, loadCatalog } from "@/lib/data";
import { title, todayISO } from "@/lib/format";
import { DateField } from "@/components/fields";
import { Button, Field, FormRow, Loading, Notice, Screen, Select, T, useNotify } from "@/components/ui";

// A sale, from a unit's page (a reserved one by whoever holds it) or from a reservation.
export default function Sale() {
  const p = useLocalSearchParams<{ vehicleId?: string; reservationId?: string }>();
  const { user, team } = useAuth();
  const router = useRouter();
  const notify = useNotify();
  const [ready, setReady] = useState(false);
  const [vehicle, setVehicle] = useState<{ id: string; label: string; price: number } | null>(null);
  const [price, setPrice] = useState("");
  const [soldAt, setSoldAt] = useState(todayISO());
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [sellerId, setSellerId] = useState(user?.id ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      let res: any = null;
      if (p.reservationId) {
        const list = await api<any[]>("/api/admin/reservations?status=active");
        res = list.find((r) => r.id === p.reservationId);
        if (res) {
          setVehicle({ id: res.vehicle_id, label: `${res.stock} · ${res.year} ${res.make} ${res.model}`, price: Number(res.price) || 0 });
          setPrice(String(Number(res.price) || ""));
          setName(res.customer_name);
          setPhone(res.customer_phone);
          setEmail(res.customer_email);
          setSellerId(res.seller_id);
        }
      } else if (p.vehicleId) {
        const v = (await loadCatalog()).find((x) => x.id === p.vehicleId);
        if (v) {
          setVehicle({ id: v.id, label: `${v.stock} · ${title(v)}`, price: Number(v.price) || 0 });
          setPrice(String(Number(v.price) || ""));
          if (v.reservation) setSellerId(v.reservation.sellerId);
        }
      }
      setReady(true);
    })().catch((e) => (setError(e.message), setReady(true)));
  }, [p.vehicleId, p.reservationId]);

  if (!ready) return <Screen><Loading /></Screen>;
  if (!vehicle) return <Screen><Notice tone="bad">{error || "No se encontró la unidad."}</Notice></Screen>;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const body: any = { vehicleId: vehicle.id, price: Number(price), soldAt, buyerName: name, buyerPhone: phone, buyerEmail: email, notes };
      if (isAdmin(user)) body.sellerId = sellerId;
      await api("/api/admin/sales", { method: "POST", body });
      forgetCatalog();
      notify("Venta registrada. ¡Felicidades!");
      router.dismissAll?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen error={error} footer={<Button title="Confirmar venta" onPress={submit} loading={busy} disabled={!price || !name} full />}>
      <Stack.Screen options={{ title: "Registrar venta" }} />
      <View style={{ gap: 14 }}>
        <Notice>{vehicle.label}. Al guardar, la unidad se marca como vendida y sale de la página.</Notice>
        <FormRow>
          <Field label="Precio final (USD) *" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
          <DateField label="Fecha de venta *" value={soldAt} onChange={setSoldAt} />
        </FormRow>
        <Field label="Nombre del comprador *" value={name} onChangeText={setName} maxLength={160} autoCorrect={false} />
        <FormRow>
          <Field label="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={60} />
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" maxLength={200} />
        </FormRow>
        {isAdmin(user) ? <Select label="Vendedor que cierra" value={sellerId} options={team.filter((u) => u.role !== "service").map((u) => [u.id, u.name] as [string, string])} onChange={setSellerId} /> : null}
        <Field label="Notas internas" value={notes} onChangeText={setNotes} multiline maxLength={4000} />
        <T v="small">Registro comercial interno: no genera contratos ni ejecuta cobros.</T>
      </View>
    </Screen>
  );
}
