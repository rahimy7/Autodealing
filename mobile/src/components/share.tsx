// Sharing a vehicle. WhatsApp gets the message and the link (/?v=<id>), whose preview shows the
// photo, title and price (server/share.js). The share sheet can also send a card: the first photo
// with the title, miles, price, logo and phone drawn on it, like the one the public page makes.
import React, { useRef, useState } from "react";
import { Linking, Share, Text, View } from "react-native";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";
import { LinearGradient } from "expo-linear-gradient";
import { asset, publicUrl } from "@/lib/api";
import { useAuth, type Dealer } from "@/lib/auth";
import { hasPhone, localized, num, priceText, title, waUrl, type Vehicle } from "@/lib/format";
import { Button, Field, Gradient, Sheet, T, useNotify } from "@/components/ui";
import { colors, font } from "@/theme";

export const vehicleLink = (v: Pick<Vehicle, "id">) => publicUrl(`/?v=${v.id}`);

export function shareText(v: Vehicle, d: Dealer) {
  const facts = [v.miles ? `${num(v.miles)} millas` : "", v.drive, localized(v.ext)].filter(Boolean);
  return [`*${title(v)}*`, `Precio: ${priceText(v)}`, facts.join(" · "), [d.name || "Premier Line Motors", d.phone].filter(Boolean).join(" · "), vehicleLink(v)].filter(Boolean).join("\n");
}

const CARD = 360; // dp; captured at the screen's pixel ratio, about 1080 px on a phone
function Card({ v, d, cardRef }: { v: Vehicle; d: Dealer; cardRef: React.RefObject<React.ComponentRef<typeof View> | null> }) {
  const photo = typeof v.photos[0] === "string" ? v.photos[0] : v.photos[0]?.url;
  return (
    <View ref={cardRef} collapsable={false} style={{ position: "absolute", left: -2000, top: 0, width: CARD, height: CARD, backgroundColor: colors.bg }}>
      {photo ? <Image source={asset(photo)} style={{ width: CARD, height: 253 }} contentFit="cover" /> : <View style={{ width: CARD, height: 253, backgroundColor: colors.bg3 }} />}
      <Gradient style={{ height: 2 }} />
      <LinearGradient colors={["rgba(124,92,255,0.25)", "rgba(124,92,255,0)"]} start={{ x: 1, y: 1 }} end={{ x: 0, y: 0 }} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 108 }} />
      <View style={{ flex: 1, padding: 18, flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, justifyContent: "space-between" }}>
          <View>
            <Text style={{ fontFamily: font.black, fontSize: 17, color: colors.text }} numberOfLines={1}>{[v.year, v.make, v.model].filter(Boolean).join(" ")}</Text>
            <Text style={{ fontFamily: font.semi, fontSize: 11.5, color: colors.muted }} numberOfLines={1}>{[v.trim, v.miles ? `${num(v.miles)} millas` : ""].filter(Boolean).join(" · ")}</Text>
          </View>
          <Text style={{ fontFamily: font.display, fontSize: 26, color: colors.accent, letterSpacing: -0.8 }} numberOfLines={1} adjustsFontSizeToFit>{priceText(v)}</Text>
        </View>
        <View style={{ width: 100, justifyContent: "space-between", alignItems: "flex-end" }}>
          <Image source={require("../../assets/logo.png")} style={{ width: 100, height: 38 }} contentFit="contain" />
          <Text style={{ fontFamily: font.black, fontSize: 11, color: colors.text }}>{d.phone}</Text>
        </View>
      </View>
    </View>
  );
}

export function ShareSheet({ v, visible, onClose, phone = "" }: { v: Vehicle | null; visible: boolean; onClose: () => void; phone?: string }) {
  const { dealer } = useAuth();
  const notify = useNotify();
  const cardRef = useRef<React.ComponentRef<typeof View>>(null);
  const [to, setTo] = useState(phone);
  if (!v) return null;
  const text = shareText(v, dealer);
  const link = vehicleLink(v);
  const hasPhoto = v.photos.length > 0;

  const sendCard = async () => {
    try {
      const uri = await captureRef(cardRef, { format: "jpg", quality: 0.9, result: "tmpfile" });
      await Clipboard.setStringAsync(text);
      notify("Texto copiado: pégalo como mensaje junto a la foto.");
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "image/jpeg", dialogTitle: title(v) });
    } catch (e: any) {
      notify("No se pudo preparar la foto: " + e.message, true);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Compartir vehículo">
      <T v="small">{title(v)} · {priceText(v)}. El enlace abre la ficha en la página, con sus fotos.</T>
      <View style={{ gap: 12, marginTop: 14 }}>
        <Button variant="wa" icon="logo-whatsapp" title="Enviar por WhatsApp" onPress={() => Linking.openURL(waUrl("", text))} full />
        {hasPhoto ? <Button variant="secondary" icon="image-outline" title="Enviar foto con precio" onPress={sendCard} full /> : null}
        <Field
          label="A un número de cliente"
          value={to}
          onChangeText={setTo}
          keyboardType="phone-pad"
          placeholder="(201) 555-0100"
          right={<Button title="Enviar" variant="secondary" onPress={() => (hasPhone(to) ? Linking.openURL(waUrl(to, text)) : notify("Escribe el número con código de área.", true))} />}
        />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" icon="share-social-outline" title="Más opciones" onPress={() => void Share.share({ message: text })} full />
          </View>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" icon="link-outline" title="Copiar enlace" onPress={async () => (await Clipboard.setStringAsync(link), notify("Enlace copiado."))} full />
          </View>
        </View>
      </View>
      {visible && hasPhoto ? <Card v={v} d={dealer} cardRef={cardRef} /> : null}
    </Sheet>
  );
}

