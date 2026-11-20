// Taking and uploading a unit's photos. The phone's pictures are large, so each is resized to
// at most 2048 px on its longer side and saved as a JPEG before it is sent; the server then
// optimises it again. A photo that fails doesn't stop the others and can be retried.
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { api } from "@/lib/api";
import { Button, Icon, Photo, Sheet, T, useNotify } from "@/components/ui";
import { colors, font } from "@/theme";

const MAX_SIDE = 2048;
export interface Picked {
  key: string;
  uri: string;
  width: number;
  height: number;
  state?: "uploading" | "done" | "failed";
  error?: string;
}

async function prepare(p: Picked) {
  const longer = Math.max(p.width, p.height);
  const actions = longer > MAX_SIDE ? [{ resize: p.width >= p.height ? { width: MAX_SIDE } : { height: MAX_SIDE } }] : [];
  const out = await manipulateAsync(p.uri, actions, { compress: 0.86, format: SaveFormat.JPEG });
  return out.uri;
}

export async function uploadPhotos(vehicleId: string, items: Picked[], update: (key: string, patch: Partial<Picked>) => void) {
  let sent = 0,
    failed = 0,
    error = "";
  for (const it of items.filter((i) => i.state !== "done")) {
    update(it.key, { state: "uploading", error: undefined });
    try {
      const uri = await prepare(it);
      const form = new FormData();
      form.append("photo", { uri, name: "foto.jpg", type: "image/jpeg" } as any);
      await api(`/api/admin/vehicles/${vehicleId}/photos`, { method: "POST", form, timeout: 120_000 });
      update(it.key, { state: "done" });
      sent++;
    } catch (e: any) {
      update(it.key, { state: "failed", error: e.message });
      failed++;
      error = e.message;
    }
  }
  return { sent, failed, error };
}

export function usePicked() {
  const [items, setItems] = useState<Picked[]>([]);
  const add = (assets: ImagePicker.ImagePickerAsset[]) =>
    setItems((prev) => [...prev, ...assets.map((a) => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, uri: a.uri, width: a.width, height: a.height }))]);
  const update = (key: string, patch: Partial<Picked>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const remove = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));
  return { items, add, update, remove, pending: items.filter((i) => i.state !== "done").length };
}

export function PhotoPicker({ picked }: { picked: ReturnType<typeof usePicked> }) {
  const notify = useNotify();
  const camera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("Cámara sin permiso", "Activa el permiso de la cámara para Premier en los ajustes del teléfono.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (!r.canceled) picked.add(r.assets);
  };
  const gallery = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 20, quality: 0.9 });
      if (!r.canceled) picked.add(r.assets);
    } catch (e: any) {
      notify(e.message, true);
    }
  };
  const first = picked.items[0];
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable onPress={camera} style={({ pressed }) => [boxStyle, { borderColor: colors.accent2, borderWidth: 1.5, opacity: pressed ? 0.85 : 1 }]}>
          <Icon name="camera-outline" size={22} />
          <Text style={labelStyle}>Tomar foto</Text>
        </Pressable>
        <Pressable onPress={gallery} style={({ pressed }) => [boxStyle, { borderStyle: "dashed", borderColor: colors.line2, borderWidth: 1, opacity: pressed ? 0.85 : 1 }]}>
          <Icon name="image-outline" size={22} />
          <Text style={labelStyle}>Galería</Text>
        </Pressable>
      </View>
      {picked.items.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {picked.items.map((it, i) => (
            <View key={it.key} style={{ width: "31.5%", aspectRatio: 4 / 3, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: it.state === "failed" ? colors.bad : colors.line, backgroundColor: colors.bg3 }}>
              <Image source={{ uri: it.uri }} style={{ flex: 1, opacity: it.state === "uploading" ? 0.45 : 1 }} contentFit="cover" />
              {i === 0 ? (
                <View style={{ position: "absolute", left: 6, top: 6, backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                  <Text style={{ fontFamily: font.black, fontSize: 9.5, color: colors.accentInk, letterSpacing: 1 }}>PORTADA</Text>
                </View>
              ) : null}
              {it.state === "uploading" || it.state === "done" || it.state === "failed" ? (
                <View style={{ position: "absolute", left: 6, right: 6, bottom: 6, backgroundColor: "rgba(5,6,10,0.78)", borderRadius: 6, paddingVertical: 3 }}>
                  <Text style={{ fontFamily: font.black, fontSize: 10.5, color: colors.text, textAlign: "center" }}>{it.state === "uploading" ? "Subiendo…" : it.state === "done" ? "✓ Subida" : "No se subió"}</Text>
                </View>
              ) : (
                <Pressable onPress={() => picked.remove(it.key)} hitSlop={8} style={{ position: "absolute", right: 5, top: 5, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(5,6,10,0.75)", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="close" size={17} color="#fff" />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      ) : null}
      <T v="small">
        {picked.items.length ? `${picked.items.length} ${picked.items.length === 1 ? "foto" : "fotos"}. La primera es la portada. ` : ""}Toma de frente, ¾, lateral, trasera, interior, tablero y millaje. Puedes agregar más después.
      </T>
      {first ? null : null}
    </View>
  );
}
const boxStyle = { flex: 1, minHeight: 66, borderRadius: 18, backgroundColor: colors.surface, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 10 };
const labelStyle = { fontFamily: font.black, fontSize: 14, color: colors.text };

// Adds photos to any unit (the whole team may add; arranging them is administration's).
export function AddPhotosSheet({ visible, vehicleId, label, onClose, onDone }: { visible: boolean; vehicleId: string; label: string; onClose: () => void; onDone: () => void }) {
  const notify = useNotify();
  const picked = usePicked();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    if (!picked.pending) return notify("Toma o elige al menos una foto.", true);
    setBusy(true);
    setError("");
    const { sent, failed, error: err } = await uploadPhotos(vehicleId, picked.items, picked.update);
    setBusy(false);
    if (failed) setError(`${failed} no se subieron: ${err}. Toca «Subir fotos» para reintentar.`);
    else {
      notify(`${sent} ${sent === 1 ? "foto subida" : "fotos subidas"}.`);
      for (const i of picked.items) picked.remove(i.key);
      onClose();
      onDone();
    }
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Agregar fotos"
      footer={
        <View style={{ gap: 10 }}>
          {error ? <T v="small" style={{ color: colors.bad, fontSize: 13 }}>{error}</T> : null}
          <Button title="Subir fotos" loading={busy} onPress={send} full />
        </View>
      }
    >
      <T v="small" style={{ marginBottom: 10 }}>{label}</T>
      <PhotoPicker picked={picked} />
    </Sheet>
  );
}


// The photos a unit already has: cover first; move, make cover or remove.
export function PhotoManager({ vehicleId, photos, onChange, readOnly }: { vehicleId: string; photos: { id: string; url: string }[]; onChange: (photos: { id: string; url: string }[]) => void; readOnly?: boolean }) {
  const notify = useNotify();
  const reorder = async (ids: string[]) => {
    try {
      await api(`/api/admin/vehicles/${vehicleId}/photos/order`, { method: "PUT", body: { ids } });
      onChange(ids.map((id) => photos.find((p) => p.id === id)!));
    } catch (e: any) {
      notify(e.message, true);
    }
  };
  const remove = (id: string) =>
    Alert.alert("¿Quitar esta foto?", undefined, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Quitar",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/api/admin/vehicles/${vehicleId}/photos/${id}`, { method: "DELETE" });
            onChange(photos.filter((p) => p.id !== id));
          } catch (e: any) {
            notify(e.message, true);
          }
        },
      },
    ]);
  if (!photos.length) return <T v="muted">Sin fotos todavía.</T>;
  const ids = photos.map((p) => p.id);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {photos.map((p, i) => (
        <View key={p.id} style={{ width: "31.5%", aspectRatio: 4 / 3, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg3 }}>
          <Photo path={p.url} style={{ flex: 1 }} />
          {i === 0 ? (
            <View style={{ position: "absolute", left: 6, top: 6, backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ fontFamily: font.black, fontSize: 9.5, color: colors.accentInk, letterSpacing: 1 }}>PORTADA</Text>
            </View>
          ) : null}
          {readOnly ? null : (
          <Pressable onPress={() => remove(p.id)} hitSlop={8} style={{ position: "absolute", right: 5, top: 5, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(5,6,10,0.75)", alignItems: "center", justifyContent: "center" }}>
            <Icon name="close" size={17} color="#fff" />
          </Pressable>
          )}
          {readOnly ? null : <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", justifyContent: "space-between", padding: 4, gap: 4, backgroundColor: "rgba(5,6,10,0.7)" }}>
            <Pressable disabled={i === 0} onPress={() => { const n = [...ids]; [n[i], n[i - 1]] = [n[i - 1], n[i]]; reorder(n); }} style={{ opacity: i === 0 ? 0.3 : 1, paddingHorizontal: 8 }}><Icon name="chevron-back" size={18} color="#fff" /></Pressable>
            {i ? <Pressable onPress={() => { const n = [...ids]; n.unshift(...n.splice(i, 1)); reorder(n); }}><Text style={{ fontFamily: font.black, fontSize: 11, color: "#fff" }}>Portada</Text></Pressable> : null}
            <Pressable disabled={i === photos.length - 1} onPress={() => { const n = [...ids]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; reorder(n); }} style={{ opacity: i === photos.length - 1 ? 0.3 : 1, paddingHorizontal: 8 }}><Icon name="chevron-forward" size={18} color="#fff" /></Pressable>
          </View>}
        </View>
      ))}
    </View>
  );
}
