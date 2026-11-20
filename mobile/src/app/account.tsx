import { useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import Constants from "expo-constants";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { Button, Card, Field, Screen, Section, T, useNotify } from "@/components/ui";

export default function Account() {
  const { user, crm, server, signOut } = useAuth();
  const notify = useNotify();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = async () => {
    setError("");
    if (next !== repeat) return setError("Las contraseñas no coinciden.");
    setBusy(true);
    try {
      await api("/api/auth/password", { method: "POST", body: { currentPassword: current, newPassword: next, confirmPassword: repeat } });
      setCurrent(""); setNext(""); setRepeat("");
      notify("Contraseña actualizada.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Stack.Screen options={{ title: "Mi cuenta" }} />
      <Card style={{ padding: 16, gap: 4 }}>
        <T v="h2" style={{ fontSize: 17 }}>{user?.name}</T>
        <T v="small">{ROLE_LABEL[user?.role ?? "sales"]} · {user?.username}{crm?.me?.agentId ? " · agente de Omnicanal: " + crm.me.name : ""}</T>
      </Card>
      <Section title="Cambiar contraseña">
        <View style={{ gap: 12 }}>
          <Field label="Contraseña actual" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
          <Field label="Nueva contraseña" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={128} />
          <Field label="Repetir nueva contraseña" value={repeat} onChangeText={setRepeat} secureTextEntry autoCapitalize="none" autoComplete="new-password" maxLength={128} hint="Al menos 12 caracteres. Al cambiarla se cierran tus otras sesiones." />
          {error ? <T v="small" style={{ color: "#ff5d6c", fontSize: 13.5 }}>{error}</T> : null}
          <Button title="Actualizar contraseña" onPress={change} loading={busy} disabled={!current || next.length < 12} full />
        </View>
      </Section>
      <Section title="Esta app">
        <T v="small">Servidor: {server.replace(/^https?:\/\//, "")}{"\n"}Versión {Constants.expoConfig?.version}</T>
      </Section>
      <View style={{ marginTop: 24 }}><Button variant="danger" icon="log-out-outline" title="Cerrar sesión" onPress={signOut} full /></View>
    </Screen>
  );
}
