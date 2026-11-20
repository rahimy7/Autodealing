import { useCallback, useState } from "react";
import { Linking, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";
import { api } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import { forgetCatalog, loadCatalog } from "@/lib/data";
import { dayLabel, hasPhone, shortDate, usd, waUrl } from "@/lib/format";
import { Headline, figureRows } from "@/components/quote";
import { Button, Lines, Loading, Notice, Photo, Pill, Screen, T, useNotify } from "@/components/ui";
import { colors } from "@/theme";

export function quoteMessage(q: any) {
  const f = q.figures;
  const pay = f.termMonths > 0 ? `Pago estimado: ${usd(f.monthly)}/mes · ${f.termMonths} meses` : `Total de contado: ${usd(f.balance)}`;
  const valid = dayLabel(q.validUntil, { day: "numeric", month: "long" });
  return [`Hola ${q.customerName.split(" ")[0]}, aquí está tu cotización ${q.code}:`, `*${q.vehicle.title}${q.vehicle.trim ? " " + q.vehicle.trim : ""}*`, `Precio: ${usd(f.price)}`, pay, `Válida hasta el ${valid}.`, q.link].join("\n");
}

export default function QuoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const notify = useNotify();
  const [q, setQ] = useState<any>(null);
  const [error, setError] = useState("");
  useFocusEffect(
    useCallback(() => {
      api(`/api/admin/quotes/${id}`).then(setQ).catch((e) => setError(e.message));
    }, [id]),
  );
  if (error) return <Screen><Notice tone="bad">{error}</Notice></Screen>;
  if (!q) return <Screen><Loading /></Screen>;
  const f = q.figures;
  const text = quoteMessage(q);
  const first = q.customerName.split(" ")[0];
  const customer = { customerName: q.customerName, customerPhone: q.customerPhone || "", customerEmail: q.customerEmail || "", ...(q.omniConversationId ? { omniConversationId: String(q.omniConversationId) } : {}) };
  return (
    <Screen>
      <Stack.Screen options={{ title: `Cotización ${q.code}` }} />
      <View style={{ gap: 14 }}>
        {q.photo ? <Photo path={q.photo} style={{ width: "100%", aspectRatio: 16 / 10, borderRadius: 16 }} /> : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <T v="h3">{q.vehicle.title} {q.vehicle.trim}</T>
            <T v="small">Para {q.customerName}</T>
          </View>
          {q.expired ? <Pill tone="bad">Vencida</Pill> : <Pill tone="ok">Vigente</Pill>}
        </View>
        <T v="small">{q.expired ? "Venció" : "Válida hasta"} el {dayLabel(q.validUntil, { day: "numeric", month: "long" })}</T>
        <View style={{ borderRadius: 20, borderWidth: 1, borderColor: "rgba(56,225,255,0.28)", backgroundColor: "rgba(56,225,255,0.05)", padding: 16, gap: 8 }}>
          <Headline f={f} />
          <Lines rows={figureRows(f)} />
        </View>
        {q.notes ? <T v="muted">{q.notes}</T> : null}
        <View style={{ gap: 8 }}>
          <Button variant="wa" icon="logo-whatsapp" title={hasPhone(q.customerPhone) ? `Enviar a ${first} por WhatsApp` : "Enviar por WhatsApp"} onPress={() => Linking.openURL(waUrl(hasPhone(q.customerPhone) ? q.customerPhone : "", text))} full />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Button variant="secondary" icon="share-social-outline" title="Compartir" onPress={() => void Share.share({ message: text })} full /></View>
            <View style={{ flex: 1 }}><Button variant="secondary" icon="link-outline" title="Copiar enlace" onPress={async () => (await Clipboard.setStringAsync(q.link), notify("Enlace copiado."))} full /></View>
          </View>
          <Button variant="secondary" icon="open-outline" title="Ver / PDF" onPress={() => Linking.openURL(q.link)} full />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Button variant="secondary" icon="calendar-outline" title="Agendar" onPress={() => router.push({ pathname: "/appointment", params: { kind: "testdrive", vehicleId: q.vehicleId, ...customer } })} full /></View>
            {q.vehicleStatus === "available" ? (
              <View style={{ flex: 1 }}>
                <Button variant="secondary" icon="bookmark-outline" title="Reservar" onPress={async () => { await loadCatalog(true); forgetCatalog(); router.push({ pathname: "/reserve", params: { vehicleId: q.vehicleId, ...customer, notes: `Cotización ${q.code}` } }); }} full />
              </View>
            ) : null}
          </View>
        </View>
        <T v="small" style={{ color: colors.muted }}>{isAdmin(user) ? `Hecha por ${q.sellerName} · ` : ""}{shortDate(q.createdAt)}</T>
      </View>
    </Screen>
  );
}
