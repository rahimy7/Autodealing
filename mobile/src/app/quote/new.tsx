// A quote: cash or an estimated monthly payment for a published unit, at the price administration
// set. The preview uses the same function the server stores the figures with (quote-math.js).
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import { loadCatalog } from "@/lib/data";
import { hasPrice, priceText, title, type Vehicle } from "@/lib/format";
import { QUOTE_TERMS, quoteFigures } from "@/lib/quote-math";
import { Headline, figureRows, type QuoteSettings } from "@/components/quote";
import { Button, Field, FormRow, Lines, Loading, Notice, Screen, Select, T, useNotify } from "@/components/ui";
import { colors, font } from "@/theme";

export default function NewQuote() {
  const p = useLocalSearchParams<Record<string, string>>();
  const { user } = useAuth();
  const router = useRouter();
  const notify = useNotify();
  const [st, setSt] = useState<QuoteSettings | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState(p.vehicleId || "");
  const [name, setName] = useState(p.customerName || "");
  const [phone, setPhone] = useState(p.customerPhone || "");
  const [email, setEmail] = useState("");
  const [term, setTerm] = useState(0);
  const [down, setDown] = useState("");
  const [trade, setTrade] = useState("");
  const [apr, setApr] = useState("");
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState("");
  const [tax, setTax] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api<QuoteSettings>("/api/admin/quote-settings"), loadCatalog()]).then(([s, c]) => {
      setSt(s);
      setTerm(s.term);
      setApr(String(s.apr));
      setFees(String(s.docFee));
      setTax(String(s.taxRate));
      const list = c.filter((v) => !v.demo && hasPrice(v));
      setVehicles(list);
      const first = list.find((v) => v.id === p.vehicleId) ?? list[0];
      if (first) (setVehicleId(first.id), setPrice(String(first.price)));
    }).catch((e) => setError(e.message));
  }, [p.vehicleId]);

  const v = vehicles.find((x) => x.id === vehicleId);
  const admin = isAdmin(user);
  const f = useMemo(
    () =>
      v && st
        ? quoteFigures({
            price: admin && Number(price) > 0 ? Number(price) : Number(v.price),
            fees: admin && fees !== "" ? Number(fees) : st.docFee,
            taxRate: admin && tax !== "" ? Number(tax) : st.taxRate,
            down: Number(down) || 0,
            tradeIn: Number(trade) || 0,
            apr: Number(apr) || 0,
            termMonths: term,
          })
        : null,
    [v, st, admin, price, fees, tax, down, trade, apr, term],
  );
  if (!st) return <Screen>{error ? <Notice tone="bad">{error}</Notice> : <Loading />}</Screen>;
  if (!v || !f) return <Screen><Notice>No hay unidades con precio para cotizar. Administración debe cargar el precio primero.</Notice></Screen>;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const body: any = { vehicleId, customerName: name, customerPhone: phone, customerEmail: email, down: down || 0, tradeIn: trade || 0, apr: apr || 0, termMonths: term, notes };
      if (admin) Object.assign(body, { price, fees, taxRate: tax });
      if (p.omniConversationId) body.omniConversationId = Number(p.omniConversationId);
      const q = await api<any>("/api/admin/quotes", { method: "POST", body });
      notify(`Cotización ${q.code} lista.`);
      router.replace({ pathname: "/quote/[id]", params: { id: q.id } });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen error={error} footer={<Button title="Generar cotización" icon="document-text-outline" onPress={submit} loading={busy} disabled={!name} full />}>
      <Stack.Screen options={{ title: "Nueva cotización" }} />
      <View style={{ gap: 14 }}>
        {p.vehicleId ? <T v="h3">{`${v.stock} · ${title(v)} · ${priceText(v)}`}</T> : <Select label="Vehículo" value={vehicleId} options={vehicles.map((x) => [x.id, `${x.stock} · ${title(x)} · ${priceText(x)}`] as [string, string])} onChange={(id) => (setVehicleId(id), setPrice(String(vehicles.find((x) => x.id === id)?.price ?? "")))} />}
        <Field label="Cliente *" value={name} onChangeText={setName} maxLength={160} autoCorrect={false} />
        <FormRow>
          <Field label="Teléfono (WhatsApp)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={60} />
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" maxLength={200} />
        </FormRow>
        <T v="eyebrow" style={{ color: colors.muted, marginTop: 6 }}>Pago</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {QUOTE_TERMS.map((t) => (
            <Pressable key={t} onPress={() => setTerm(t)} style={{ minHeight: 38, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: t === term ? colors.accent : colors.line, backgroundColor: t === term ? colors.accent : colors.surface, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: font.black, fontSize: 13, color: t === term ? colors.accentInk : colors.text2 }}>{t ? `${t} m` : "Contado"}</Text>
            </Pressable>
          ))}
        </View>
        <FormRow>
          <Field label="Pago inicial" value={down} onChangeText={setDown} keyboardType="decimal-pad" placeholder="0" />
          <Field label="Valor de intercambio" value={trade} onChangeText={setTrade} keyboardType="decimal-pad" placeholder="0" />
        </FormRow>
        {term ? <Field label="Tasa anual estimada (APR %)" value={apr} onChangeText={setApr} keyboardType="decimal-pad" /> : null}
        {admin ? (
          <View style={{ gap: 8 }}>
            <T v="small">Administración: precio, cargos e impuesto de esta cotización</T>
            <FormRow>
              <Field label="Precio" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
              <Field label="Cargos" value={fees} onChangeText={setFees} keyboardType="decimal-pad" />
              <Field label="Impuesto %" value={tax} onChangeText={setTax} keyboardType="decimal-pad" />
            </FormRow>
          </View>
        ) : null}
        <View style={{ borderRadius: 20, borderWidth: 1, borderColor: "rgba(56,225,255,0.28)", backgroundColor: "rgba(56,225,255,0.05)", padding: 16, gap: 8 }}>
          <Headline f={f} />
          <Lines rows={figureRows(f)} />
        </View>
        <Field label="Notas para el cliente" value={notes} onChangeText={setNotes} multiline maxLength={2000} placeholder="Incluye garantía, mantenimiento, accesorios…" />
        <T v="small">Estimación sin valor contractual; la tasa depende del crédito del cliente. Vigencia: {st.validDays} {st.validDays === 1 ? "día" : "días"}.{st.taxRate > 0 ? "" : " Sin impuesto configurado: la cotización indica que no lo incluye."}</T>
      </View>
    </Screen>
  );
}
