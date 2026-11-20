import { useState } from "react";
import { View } from "react-native";
import { Stack, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { strongPassword } from "@/lib/password";
import { ROLE_HELP } from "@/lib/labels";
import { Button, Field, Screen, Select, T, useNotify } from "@/components/ui";

export default function NewUser() {
  const { refreshTeam } = useAuth();
  const router = useRouter();
  const notify = useNotify();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("sales");
  const [password, setPassword] = useState(strongPassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/users", { method: "POST", body: { name, username, role, password } });
      await refreshTeam();
      await Clipboard.setStringAsync(password);
      notify(`Usuario «${username.toLowerCase()}» creado. La contraseña quedó copiada: compártela por un canal privado.`);
      router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen error={error} footer={<Button title="Crear usuario" onPress={submit} loading={busy} disabled={!name || username.length < 3 || password.length < 12} full />}>
      <Stack.Screen options={{ title: "Nuevo usuario" }} />
      <View style={{ gap: 14 }}>
        <Field label="Nombre *" value={name} onChangeText={setName} maxLength={100} autoCorrect={false} />
        <Field label="Usuario *" value={username} onChangeText={(t) => setUsername(t.replace(/[^A-Za-z0-9_.@-]/g, ""))} autoCapitalize="none" autoCorrect={false} maxLength={80} placeholder="nombre o email" />
        <Select label="Perfil *" value={role} options={[["sales", "Ventas"], ["service", "Servicio"], ["admin", "Administración"]]} onChange={setRole} />
        <T v="small">{ROLE_HELP[role]}</T>
        <Field label="Contraseña inicial *" value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} maxLength={128} right={<Button title="Otra" variant="secondary" onPress={() => setPassword(strongPassword())} />} hint="Compártela en persona o por un canal privado. Podrá cambiarla en Mi cuenta." />
      </View>
    </Screen>
  );
}
