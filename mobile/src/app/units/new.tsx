// Loading a unit from the lot: VIN, year, make, model, miles, body and color, with its photos.
// It is saved as a draft without a price; administration completes it and publishes it
// (server/intake.js). With ?id=<unit> it corrects what the person recorded while it is a draft.
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/lib/api";
import { forgetCatalog } from "@/lib/data";
import { localized, type Vehicle } from "@/lib/format";
import { BODIES, CONDITIONS, FUELS } from "@/lib/labels";
import { PhotoPicker, uploadPhotos, usePicked } from "@/components/photos";
import { Button, Chip, ChipRow, Field, FormRow, Loading, Screen, Select, T, useNotify } from "@/components/ui";
import { colors } from "@/theme";

export default function NewUnit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const notify = useNotify();
  const picked = usePicked();
  const editing = Boolean(id);
  const [ready, setReady] = useState(!editing);
  const [vin, setVin] = useState("");
  const [vinHelp, setVinHelp] = useState("Con el VIN se llenan solos año, marca, modelo, versión y carrocería.");
  const [decoding, setDecoding] = useState(false);
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [miles, setMiles] = useState("");
  const [body, setBody] = useState("");
  const [ext, setExt] = useState("");
  const [condition, setCondition] = useState("used");
  const [engine, setEngine] = useState("");
  const [drive, setDrive] = useState("");
  const [trans, setTrans] = useState("");
  const [fuel, setFuel] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    api<Vehicle[]>("/api/admin/intake")
      .then((list) => {
        const v = list.find((x) => x.id === id);
        if (!v) return setError("No se encontró la unidad.");
        setVin(v.vin);
        setYear(String(v.year));
        setMake(v.make);
        setModel(v.model);
        setTrim(v.trim || "");
        setMiles(String(v.miles ?? ""));
        setBody((v.cats || []).find((c) => c !== "electric") || v.cats?.[0] || "");
        setExt(localized(v.ext));
        setCondition(v.condition || "used");
        setEngine(v.engine || "");
        setDrive(v.drive || "");
        setTrans(localized(v.trans));
        setFuel(v.fuel || "");
        setNotes(v.intakeNotes || "");
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, [id]);

  const decode = async () => {
    const code = vin.trim().toUpperCase();
    setVin(code);
    if (code.length !== 17) return setVinHelp("El VIN tiene 17 caracteres. Revisa que no falte ninguno.");
    setDecoding(true);
    setVinHelp("Buscando el VIN…");
    try {
      const d = await api<any>(`/api/admin/intake/vin/${encodeURIComponent(code)}`);
      if (d.year) setYear(String(d.year));
      if (d.make) setMake(d.make);
      if (d.model) setModel(d.model);
      if (d.trim) setTrim(d.trim);
      if (d.engine) setEngine(d.engine);
      if (d.drive) setDrive(d.drive);
      if (d.trans) setTrans(d.trans);
      if (d.fuel) setFuel(d.fuel);
      if (d.body) setBody(d.body);
      setVinHelp(`Encontrado: ${[d.year, d.make, d.model, d.trim].filter(Boolean).join(" ")}. Revisa los datos.`);
    } catch (e: any) {
      setVinHelp(e.message);
    } finally {
      setDecoding(false);
    }
  };

  const submit = async () => {
    setError("");
    if (!body) return setError("Elige la carrocería.");
    setBusy(true);
    try {
      const data = { vin, year, make, model, trim, miles, body, ext, condition, engine, drive, trans, fuel, notes };
      if (editing) {
        await api(`/api/admin/intake/${id}`, { method: "PUT", body: data });
        notify("Datos actualizados.");
        return router.back();
      }
      const { id: newId } = await api<{ id: string }>("/api/admin/intake", { method: "POST", body: data });
      forgetCatalog();
      let message = "Unidad cargada. Administración completará la ficha y el precio.";
      let bad = false;
      if (picked.pending) {
        const { failed, error: err } = await uploadPhotos(newId, picked.items, picked.update);
        if (failed) {
          bad = true;
          message = `Unidad cargada, pero ${failed} ${failed === 1 ? "foto no se subió" : "fotos no se subieron"} (${err}). Agrégalas desde Mis unidades.`;
        }
      }
      notify(message, bad);
      router.replace("/units");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <Screen><Loading /></Screen>;
  return (
    <Screen error={error} footer={<Button title={editing ? "Guardar cambios" : "Cargar unidad"} icon={editing ? undefined : "camera-outline"} onPress={submit} loading={busy} disabled={!year || !make || !model || miles === ""} full />}>
      <Stack.Screen options={{ title: editing ? "Corregir datos" : "Cargar vehículo" }} />
      <View style={{ gap: 14 }}>
        {!editing ? <T v="small">Toma las fotos y anota lo que ves. Administración completa la ficha y el precio antes de publicarla.</T> : null}
        <Field label="VIN" value={vin} onChangeText={(t) => setVin(t.toUpperCase())} maxLength={17} autoCapitalize="characters" autoCorrect={false} placeholder="17 caracteres (puerta o parabrisas)" hint={vinHelp} right={<Button title="Buscar" variant="secondary" loading={decoding} onPress={decode} />} />
        <FormRow>
          <Field label="Año *" value={year} onChangeText={(t) => setYear(t.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={4} />
          <Field label="Marca *" value={make} onChangeText={setMake} maxLength={80} />
        </FormRow>
        <FormRow>
          <Field label="Modelo *" value={model} onChangeText={setModel} maxLength={100} />
          <Field label="Versión / trim" value={trim} onChangeText={setTrim} maxLength={100} />
        </FormRow>
        <FormRow>
          <Field label="Millaje *" value={miles} onChangeText={(t) => setMiles(t.replace(/\D/g, ""))} keyboardType="number-pad" />
          <Field label="Color exterior" value={ext} onChangeText={setExt} maxLength={100} />
        </FormRow>
        <T v="label">Carrocería *</T>
        <ChipRow wrap>{BODIES.map(([k, l]) => <Chip key={k} label={l} active={body === k} onPress={() => setBody(k)} />)}</ChipRow>
        <Select label="Condición" value={condition} options={CONDITIONS} onChange={setCondition} />
        <T v="eyebrow" style={{ color: colors.muted, marginTop: 6 }}>Datos técnicos (opcional)</T>
        <FormRow>
          <Field label="Motor" value={engine} onChangeText={setEngine} maxLength={150} />
          <Field label="Tracción" value={drive} onChangeText={setDrive} maxLength={30} placeholder="AWD, FWD…" />
        </FormRow>
        <FormRow>
          <Field label="Transmisión" value={trans} onChangeText={setTrans} maxLength={100} />
          <Select label="Combustible" value={fuel} options={[["", "—"], ...FUELS]} onChange={setFuel} />
        </FormRow>
        {!editing ? (
          <>
            <T v="eyebrow" style={{ color: colors.muted, marginTop: 6 }}>Fotos</T>
            <PhotoPicker picked={picked} />
          </>
        ) : null}
        <Field label="Notas para administración" value={notes} onChangeText={setNotes} multiline maxLength={2000} placeholder="Detalles, golpes, llantas, llaves, documentos…" />
      </View>
    </Screen>
  );
}
