// Rows and cards that more than one screen shows.
import React from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { api } from "@/lib/api";
import { useAuth, canSell, isAdmin } from "@/lib/auth";
import { ago, hasPhone, hasPrice, initials, num, priceText, telUrl, title, usd, waUrl, type Vehicle } from "@/lib/format";
import { APPT_STATUS, APPT_TONE, KIND, LEAD_DETAILS, LEAD_KIND, VEHICLE_STATUS, VEHICLE_TONE } from "@/lib/labels";
import { Avatar, BtnRow, Button, Icon, ListRow, Photo, Pill, T, useNotify } from "@/components/ui";
import { colors, font, radius } from "@/theme";

export function ContactButtons({ phone, email, extra }: { phone?: string; email?: string; extra?: React.ReactNode }) {
  const buttons = [
    telUrl(phone) ? <Button key="call" size="sm" variant="secondary" icon="call-outline" title="Llamar" onPress={() => Linking.openURL(telUrl(phone))} /> : null,
    hasPhone(phone) ? <Button key="wa" size="sm" variant="secondary" icon="logo-whatsapp" title="WhatsApp" onPress={() => Linking.openURL(waUrl(phone))} /> : null,
    email ? <Button key="mail" size="sm" variant="secondary" icon="mail-outline" title="Email" onPress={() => Linking.openURL(`mailto:${email}`)} /> : null,
  ].filter(Boolean);
  if (!buttons.length && !extra) return null;
  return (
    <View style={{ marginTop: 8 }}>
      <BtnRow>
        {extra}
        {buttons}
      </BtnRow>
    </View>
  );
}

export function VehicleCard({ v, onPress }: { v: Vehicle; onPress?: () => void }) {
  const router = useRouter();
  const r = v.reservation;
  const tone = r || v.status === "reserved" ? "warn" : "ok";
  const label = r ? (r.mine ? "Tu reserva" : "Reservado · " + r.sellerName) : v.status === "reserved" ? "Reservado" : "Disponible";
  const first = typeof v.photos[0] === "string" ? v.photos[0] : v.photos[0]?.url;
  return (
    <Pressable
      onPress={onPress ?? (() => router.push({ pathname: "/vehicle/[id]", params: { id: v.id } }))}
      style={({ pressed }) => ({ borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: "rgba(255,255,255,0.04)", overflow: "hidden", opacity: pressed ? 0.9 : 1 })}
    >
      <View>
        <Photo path={first} style={{ width: "100%", aspectRatio: 16 / 10 }} />
        <View style={{ position: "absolute", top: 10, left: 10, right: 10, flexDirection: "row", justifyContent: "space-between" }}>
          <View style={{ backgroundColor: "rgba(5,6,10,0.65)", borderRadius: 999 }}>
            <Pill tone={tone}>{label}</Pill>
          </View>
          {v.photos.length > 1 ? (
            <View style={{ backgroundColor: "rgba(5,6,10,0.65)", borderRadius: 999 }}>
              <Pill>{v.photos.length} fotos</Pill>
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ padding: 14, gap: 5 }}>
        <T v="h3">{title(v)}</T>
        <T v="small">
          {num(v.miles)} mi · Stock {v.stock}
          {v.demo ? " · Demo" : ""}
        </T>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
          <Text style={hasPrice(v) ? { fontFamily: font.display, fontSize: 18, color: colors.text, letterSpacing: -0.5 } : { fontFamily: font.bold, fontSize: 13.5, color: colors.muted }}>{priceText(v)}</Text>
          {v.featured ? <Pill tone="violet">Destacado</Pill> : null}
        </View>
      </View>
    </Pressable>
  );
}

// A unit someone loaded from the lot (Mis unidades, Inventario, Por completar).
export function UnitCard({ v, onPress, showLoader }: { v: Vehicle; onPress: () => void; showLoader?: boolean }) {
  const first = v.photos[0]?.url;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: "rgba(255,255,255,0.04)", overflow: "hidden", opacity: pressed ? 0.9 : 1 })}>
      <View>
        <Photo path={first} style={{ width: "100%", aspectRatio: 16 / 10 }} />
        <View style={{ position: "absolute", top: 10, left: 10, right: 10, flexDirection: "row", justifyContent: "space-between" }}>
          <View style={{ backgroundColor: "rgba(5,6,10,0.65)", borderRadius: 999 }}>
            <Pill tone={VEHICLE_TONE[v.status]}>{VEHICLE_STATUS[v.status]}</Pill>
          </View>
          {v.photos.length ? (
            <View style={{ backgroundColor: "rgba(5,6,10,0.65)", borderRadius: 999 }}>
              <Pill>{v.photos.length} fotos</Pill>
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ padding: 14, gap: 5 }}>
        <T v="h3">{title(v)}</T>
        <T v="small">
          {num(v.miles)} mi · Stock {v.stock}
          {v.vin ? " · VIN …" + v.vin.slice(-6) : ""}
        </T>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
          <Text style={hasPrice(v) ? { fontFamily: font.display, fontSize: 18, color: colors.text } : { fontFamily: font.bold, fontSize: 13.5, color: colors.muted }}>{hasPrice(v) ? priceText(v) : "Sin precio"}</Text>
          <T v="small">
            {showLoader && v.intakeName ? v.intakeName + " · " : ""}
            {ago(v.createdAt)}
          </T>
        </View>
      </View>
    </Pressable>
  );
}

export function ApptRow({ a, onPress }: { a: any; onPress?: () => void }) {
  const { user } = useAuth();
  const router = useRouter();
  const vehicle = a.make ? `${a.year} ${a.make} ${a.model}` : "";
  return (
    <ListRow
      onPress={onPress ?? (() => router.push({ pathname: "/appointment", params: { id: a.id } }))}
      left={
        <View style={{ width: 54 }}>
          <Text style={{ fontFamily: font.black, fontSize: 14, color: colors.text }}>{a.local_time}</Text>
          <Text style={{ fontFamily: font.medium, fontSize: 11, color: colors.muted }}>{a.duration_minutes} min</Text>
        </View>
      }
      title={a.customer_name}
      subtitle={`${KIND[a.kind] || a.kind}${vehicle ? " · " + vehicle : ""}${isAdmin(user) && a.seller_name ? " · " + a.seller_name : ""}`}
      right={<Icon name="chevron-forward" size={18} color={colors.muted} />}
    >
      <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <Pill tone={APPT_TONE[a.status]}>{APPT_STATUS[a.status]}</Pill>
        {a.omni_contact_id ? <Pill tone="info">Omnicanal</Pill> : a.sync_error ? <Pill tone="bad">Sin sincronizar</Pill> : null}
      </View>
    </ListRow>
  );
}

export function LeadRow({ l, take = true, onChanged }: { l: any; take?: boolean; onChanged?: () => void }) {
  const router = useRouter();
  const notify = useNotify();
  const vehicle = l.make ? `${l.year || ""} ${l.make} ${l.model}`.trim() : "";
  const when = l.data?.date ? ` · pide ${l.data.date} ${l.data.time || ""}` : "";
  const details = LEAD_DETAILS.filter(([k]) => l.data?.[k]).map(([k, label]) => `${label}: ${l.data[k]}`).join(" · ");
  const schedule = () =>
    router.push({
      pathname: "/appointment",
      params: {
        kind: l.kind === "testdrive" ? "testdrive" : l.kind === "trade" || l.kind === "visit" ? "visit" : "call",
        date: /^\d{4}-\d{2}-\d{2}$/.test(l.data?.date || "") ? l.data.date : "",
        time: /^\d{2}:\d{2}$/.test(l.data?.time || "") ? l.data.time : "",
        vehicleId: l.vehicle_id || "",
        customerName: l.name,
        customerPhone: l.phone || "",
        customerEmail: l.email || "",
        notes: l.data?.msg || "",
        leadId: l.id,
      },
    });
  return (
    <ListRow left={<Avatar name={l.name} />} title={l.name} subtitle={`${LEAD_KIND[l.kind] || l.kind}${vehicle ? " · " + vehicle : ""}${when} · ${ago(l.created_at)}`}>
      {details ? <T v="small">{details}</T> : null}
      {l.data?.msg ? <T v="small">{l.data.msg}</T> : null}
      <ContactButtons
        phone={l.phone}
        email={l.email}
        extra={
          <>
            {take && !l.assigned_to ? (
              <Button
                size="sm"
                title="Tomar"
                onPress={async () => {
                  try {
                    await api(`/api/admin/leads/${l.id}/take`, { method: "POST", body: {} });
                    notify("Consulta asignada a ti.");
                    onChanged?.();
                  } catch (e: any) {
                    notify(e.message, true);
                  }
                }}
              />
            ) : null}
            <Button size="sm" variant="secondary" title="Agendar" onPress={schedule} />
          </>
        }
      />
    </ListRow>
  );
}

export function QuoteRow({ q, onPress }: { q: any; onPress?: () => void }) {
  const { user } = useAuth();
  const router = useRouter();
  const f = q.figures;
  return (
    <ListRow
      onPress={onPress ?? (() => router.push({ pathname: "/quote/[id]", params: { id: q.id } }))}
      left={q.photo ? <Avatar uri={q.photo} /> : <Avatar name={q.customerName} />}
      title={`${q.customerName} · ${q.vehicle.title}`}
      subtitle={`${q.code} · ${f.termMonths ? `${usd(f.monthly)}/mes · ${f.termMonths} m` : `contado ${usd(f.balance)}`}${isAdmin(user) ? " · " + q.sellerName : ""}`}
      right={q.expired ? <Pill tone="bad">Vencida</Pill> : q.vehicleStatus === "sold" ? <Pill tone="info">Vendida</Pill> : <Pill tone="ok">Vigente</Pill>}
    />
  );
}

