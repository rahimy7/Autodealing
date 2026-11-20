// A unit from the loader's point of view (its data, status and photos), and for administration
// the editor: details, price, publication and photos. A draft waits here until administration
// sets its price and taps «Publicar».
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import { forgetCatalog } from "@/lib/data";
import { hasPrice, localized, num, priceText, shortDate, title, type Vehicle } from "@/lib/format";
import { BODIES, CONDITIONS, FUELS, VEHICLE_STATUS, VEHICLE_TONE } from "@/lib/labels";
import { AddPhotosSheet, PhotoManager } from "@/components/photos";
import { Button, Check, Field, FormRow, Loading, Notice, Pill, Screen, Segmented, Select, T, useNotify } from "@/components/ui";
import { colors } from "@/theme";

export default function UnitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const admin = isAdmin(user);
  const [v, setV] = useState<Vehicle | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const list = await api<Vehicle[]>(admin ? "/api/admin/vehicles" : "/api/admin/intake");
      const found = list.find((x) => x.id === id);
      setV(found ?? null);
      setError(found ? "" : "No se encontró la unidad.");
    } catch (e: any) {
      setError(e.message);
    }
  }, [id, admin]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (error) return <Screen><Notice tone="bad">{error}</Notice></Screen>;
  if (!v) return <Screen><Loading /></Screen>;
  return admin ? <AdminEditor v={v} reload={load} setV={setV} /> : <LoaderView v={v} reload={load} setV={setV} />;
}

function LoaderView({ v, reload, setV }: { v: Vehicle; reload: () => void; setV: (v: Vehicle) => void }) {
  const router = useRouter();
  const notify = useNotify();
  const [add, setAdd] = useState(false);
  const draft = v.status === "draft";
  const discard = () =>
    Alert.alert("¿Descartar esta unidad?", "Queda archivada con sus fotos; administración puede recuperarla.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Descartar", style: "destructive", onPress: async () => { try { await api(`/api/admin/intake/${v.id}/discard`, { method: "POST", body: {} }); notify("Unidad descartada."); router.back(); } catch (e: any) { notify(e.message, true); } } },
    ]);
  const facts = [["VIN", v.vin], ["Millaje", `${num(v.miles)} mi`], ["Color", localized(v.ext)], ["Motor", v.engine], ["Tracción", v.drive]].filter(([, x]) => x);
  return (
    <Screen>
      <Stack.Screen options={{ title: title(v) }} />
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Pill tone={VEHICLE_TONE[v.status]}>{VEHICLE_STATUS[v.status]}</Pill>
          <T v="small">Stock {v.stock} · cargada {shortDate(v.createdAt)}</T>
        </View>
        <T v="muted">{draft ? "Administración aún no la publica: completa la ficha y el precio. Mientras tanto puedes corregir los datos y ordenar las fotos." : v.status === "archived" ? "Archivada: no se publica." : "Publicada en la página" + (hasPrice(v) ? ` a ${priceText(v)}.` : ".")}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 12 }}>
          {facts.map(([k, x]) => (
            <View key={k} style={{ width: "50%", paddingRight: 8 }}>
              <T v="eyebrow" style={{ color: colors.muted, letterSpacing: 1.4 }}>{k}</T>
              <T style={{ fontFamily: "Manrope_700Bold", fontSize: 14 }}>{x}</T>
            </View>
          ))}
        </View>
        {v.intakeNotes ? <T v="small">Notas: {v.intakeNotes}</T> : null}
        <T v="h2">Fotos ({v.photos.length})</T>
        {draft ? <PhotoManager vehicleId={v.id} photos={v.photos} onChange={(photos) => setV({ ...v, photos })} /> : v.photos.length ? <PhotoManager vehicleId={v.id} photos={v.photos} onChange={(photos) => setV({ ...v, photos })} readOnly /> : <T v="muted">Sin fotos todavía.</T>}
        <Button title="Agregar fotos" icon="camera-outline" onPress={() => setAdd(true)} full />
        {draft ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Button title="Corregir datos" variant="secondary" icon="create-outline" onPress={() => router.push({ pathname: "/units/new", params: { id: v.id } })} full /></View>
            <View style={{ flex: 1 }}><Button title="Descartar" variant="danger" onPress={discard} full /></View>
          </View>
        ) : null}
      </View>
      <AddPhotosSheet visible={add} vehicleId={v.id} label={title(v)} onClose={() => setAdd(false)} onDone={reload} />
    </Screen>
  );
}

function AdminEditor({ v, reload, setV }: { v: Vehicle; reload: () => void; setV: (v: Vehicle) => void }) {
  const router = useRouter();
  const notify = useNotify();
  const [tab, setTab] = useState<"details" | "photos">("details");
  const [add, setAdd] = useState(false);
  const f = (x: unknown) => (x === undefined || x === null ? "" : String(x));
  const [s, setS] = useState({
    stock: v.stock, status: v.status as string, vin: v.vin, year: f(v.year), make: v.make, model: v.model, trim: v.trim || "",
    body: (v.cats || []).find((c) => c !== "electric") || v.cats?.[0] || "sedan", condition: v.condition || "used",
    priceOnRequest: !!v.priceOnRequest && !(v.status === "draft" && !(Number(v.price) > 0)), price: f(v.price ?? 0), msrp: f(v.msrp ?? v.price ?? 0), purchaseCost: f(v.purchaseCost ?? 0),
    miles: f(v.miles), engine: v.engine || "", hp: f(v.hp ?? 0), drive: v.drive || "", trans: localized(v.trans), fuel: v.fuel || "gas", seats: f(v.seats),
    ext: localized(v.ext), int: localized(v.int), economy: v.economy || "", featured: !!v.featured, demo: !!v.demo, descEs: v.desc?.es || "", descEn: v.desc?.en || "",
  });
  const set = <K extends keyof typeof s>(k: K) => (val: (typeof s)[K]) => setS((p) => ({ ...p, [k]: val }));
  const text = (k: keyof typeof s, label: string, extra: object = {}) => <Field label={label} value={String(s[k])} onChangeText={(t) => set(k)(t as never)} {...extra} />;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (publish: boolean) => {
    setError("");
    setBusy(true);
    try {
      const data: any = { ...s, cats: [s.body], desc: { es: s.descEs, en: s.descEn }, version: v.version };
      if (s.fuel === "electric" && s.body !== "electric") data.cats.push("electric");
      if (publish) data.status = "available";
      if (data.status !== "draft" && !data.priceOnRequest && !(Number(data.price) > 0)) throw new Error("Pon el precio de venta o marca «Consultar precio» antes de publicar.");
      await api(`/api/admin/vehicles/${v.id}`, { method: "PUT", body: data });
      forgetCatalog();
      notify(publish && v.status === "draft" ? "Unidad publicada en la página." : "Vehículo guardado.");
      router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      error={error}
      footer={
        tab === "details" && v.status !== "sold" ? (
          v.status === "draft" ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><Button title="Guardar borrador" variant="secondary" loading={busy} onPress={() => save(false)} full /></View>
              <View style={{ flex: 1 }}><Button title="Publicar" loading={busy} onPress={() => save(true)} full /></View>
            </View>
          ) : <Button title="Guardar cambios" loading={busy} onPress={() => save(false)} full />
        ) : undefined
      }
    >
      <Stack.Screen options={{ title: `${v.stock} · ${[v.year, v.make, v.model].join(" ")}` }} />
      <View style={{ gap: 14 }}>
        {v.intakeName ? <Notice tone="info">Cargada por {v.intakeName} · {shortDate(v.createdAt)}{v.intakeNotes ? `\n${v.intakeNotes}` : ""}</Notice> : null}
        <Segmented value={tab} options={[["details", "Ficha y precio"], ["photos", `Fotos (${v.photos.length})`]]} onChange={setTab} />
        {tab === "photos" ? (
          <>
            <PhotoManager vehicleId={v.id} photos={v.photos} onChange={(photos) => { setV({ ...v, photos }); forgetCatalog(); }} />
            <Button title="Agregar fotos" icon="camera-outline" onPress={() => setAdd(true)} full />
            <T v="small">La primera es la portada. «Quitar fondo» está en el panel de administración.</T>
          </>
        ) : v.status === "sold" ? (
          <Notice>Esta unidad tiene una venta registrada; su ficha queda bloqueada. Anula la venta desde el panel para editarla.</Notice>
        ) : (
          <>
            {v.status === "draft" ? <T v="small">Completa el precio y los detalles y toca «Publicar» para que aparezca en la página y en el catálogo del equipo.</T> : null}
            <FormRow>
              {text("stock", "Stock *", { maxLength: 40 })}
              <Select label="Estado" value={s.status} options={[["draft", "Borrador"], ["available", "Disponible"], ["reserved", "Reservado"], ["archived", "Archivado"]]} onChange={set("status")} />
            </FormRow>
            {text("vin", "VIN", { maxLength: 17, autoCapitalize: "characters" })}
            <FormRow>
              {text("year", "Año *", { keyboardType: "number-pad", maxLength: 4 })}
              {text("make", "Marca *")}
            </FormRow>
            <FormRow>
              {text("model", "Modelo *")}
              {text("trim", "Versión")}
            </FormRow>
            <Select label="Carrocería" value={s.body} options={BODIES} onChange={set("body")} />
            <T v="eyebrow" style={{ color: colors.muted, marginTop: 6 }}>Precio</T>
            <Check label="Mostrar «Consultar precio»" value={s.priceOnRequest} onChange={set("priceOnRequest")} />
            <FormRow>
              <Field label="Precio de venta (USD) *" value={s.price} onChangeText={(t) => setS((p) => ({ ...p, price: t, priceOnRequest: Number(t) > 0 ? false : p.priceOnRequest }))} keyboardType="decimal-pad" />
              {text("msrp", "Precio de referencia", { keyboardType: "decimal-pad" })}
            </FormRow>
            {text("purchaseCost", "Costo de compra (privado)", { keyboardType: "decimal-pad" })}
            <T v="eyebrow" style={{ color: colors.muted, marginTop: 6 }}>Detalles</T>
            <FormRow>
              {text("miles", "Millaje", { keyboardType: "number-pad" })}
              <Select label="Condición" value={s.condition} options={CONDITIONS} onChange={set("condition")} />
            </FormRow>
            <FormRow>
              {text("engine", "Motor")}
              {text("hp", "Potencia (hp)", { keyboardType: "number-pad" })}
            </FormRow>
            <FormRow>
              {text("drive", "Tracción")}
              {text("trans", "Transmisión")}
            </FormRow>
            <FormRow>
              <Select label="Combustible" value={s.fuel} options={FUELS} onChange={set("fuel")} />
              {text("seats", "Asientos", { keyboardType: "number-pad" })}
            </FormRow>
            <FormRow>
              {text("ext", "Exterior")}
              {text("int", "Interior")}
            </FormRow>
            {text("economy", "Consumo / autonomía")}
            <Check label="Destacar en el catálogo" value={s.featured} onChange={set("featured")} />
            <Check label="Unidad de demostración (no vendible)" value={s.demo} onChange={set("demo")} />
            <T v="eyebrow" style={{ color: colors.muted, marginTop: 6 }}>Descripción pública</T>
            <Field label="Español" value={s.descEs} onChangeText={set("descEs")} multiline maxLength={8000} />
            <Field label="Inglés" value={s.descEn} onChangeText={set("descEn")} multiline maxLength={8000} />
          </>
        )}
      </View>
      <AddPhotosSheet visible={add} vehicleId={v.id} label={title(v)} onClose={() => setAdd(false)} onDone={reload} />
    </Screen>
  );
}
