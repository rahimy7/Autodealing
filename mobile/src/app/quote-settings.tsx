import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { api } from "@/lib/api";
import type { QuoteSettings } from "@/components/quote";
import { QUOTE_TERMS } from "@/lib/quote-math";
import { Button, Field, FormRow, Loading, Screen, Select, T, useNotify } from "@/components/ui";

export default function QuoteSettingsScreen() {
  const router = useRouter();
  const notify = useNotify();
  const [s, setS] = useState<Record<keyof QuoteSettings, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api<QuoteSettings>("/api/admin/quote-settings").then((v) => setS(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])) as any)).catch((e) => setError(e.message));
  }, []);
  if (!s) return <Screen>{error ? <T v="muted">{error}</T> : <Loading />}</Screen>;
  const set = (k: keyof QuoteSettings) => (t: string) => setS((p) => ({ ...p!, [k]: t }));
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/quote-settings", { method: "PUT", body: { ...s, term: Number(s.term) } });
      notify("Ajustes de cotización guardados.");
      router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen error={error} footer={<Button title="Guardar ajustes" onPress={save} loading={busy} full />}>
      <Stack.Screen options={{ title: "Ajustes de cotización" }} />
      <View style={{ gap: 14 }}>
        <T v="small">Se aplican a todas las cotizaciones nuevas. Los vendedores no los cambian; tú sí, en cada cotización.</T>
        <FormRow>
          <Field label="Impuesto sobre la venta (%)" value={s.taxRate} onChangeText={set("taxRate")} keyboardType="decimal-pad" />
          <Field label="Cargos de documentación (USD)" value={s.docFee} onChangeText={set("docFee")} keyboardType="decimal-pad" />
        </FormRow>
        <FormRow>
          <Field label="Tasa por defecto (APR %)" value={s.apr} onChangeText={set("apr")} keyboardType="decimal-pad" />
          <Select label="Plazo por defecto" value={s.term} options={QUOTE_TERMS.filter(Boolean).map((t) => [String(t), `${t} meses`] as [string, string])} onChange={set("term")} />
        </FormRow>
        <Field label="Vigencia (días)" value={s.validDays} onChangeText={set("validDays")} keyboardType="number-pad" />
        <Field label="Nota al pie de cada cotización" value={s.note} onChangeText={set("note")} multiline maxLength={1000} placeholder="Ej.: Precio no incluye placas." />
        <T v="small">El impuesto se calcula sobre el precio menos el intercambio; los cargos se suman sin impuesto. Con impuesto en 0 la cotización dice que no lo incluye.</T>
      </View>
    </Screen>
  );
}
