import { useEffect, useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import * as Notifications from "expo-notifications";
import { Ionicons } from "@expo/vector-icons";
import { useSendTestPush } from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Badge, Button, Card, ErrorNote, SectionHeader } from "../src/components/ui";
import { requestPushToken } from "../src/lib/push";
import { errorMessage } from "../src/lib/format";
import { colors, spacing } from "../src/theme";

type State =
  | { kind: "checking" }
  | { kind: "granted"; token: string; platform: "ios" | "android" }
  | { kind: "denied" }
  | { kind: "unsupported"; reason: string };

export default function NotificationsScreen() {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sendTest = useSendTestPush();

  const check = async () => {
    setState({ kind: "checking" });
    setError(null);
    const registration = await requestPushToken();
    if (registration.status === "granted") {
      setState({ kind: "granted", token: registration.token, platform: registration.platform });
    } else if (registration.status === "denied") {
      setState({ kind: "denied" });
    } else {
      setState({ kind: "unsupported", reason: registration.reason });
    }
  };

  useEffect(() => {
    check();
  }, []);

  const test = async () => {
    setError(null);
    setResult(null);
    try {
      const response = await sendTest.mutateAsync();
      if (response.ok) {
        setResult(
          `Enviada a ${response.devices} dispositivo${response.devices === 1 ? "" : "s"}. Debe llegar en unos segundos.`,
        );
      } else {
        // The server says which gateway is missing its credentials, which is the
        // only thing that actually helps while setting this up.
        setError(response.detail ?? "El servidor no pudo entregarla.");
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Screen>
      <Card style={{ gap: spacing.md }}>
        <SectionHeader
          title="Estado en este teléfono"
          action={
            state.kind === "granted" ? (
              <Badge label="Activas" bg={colors.successSoft} fg={colors.success} icon="checkmark-circle" />
            ) : state.kind === "denied" ? (
              <Badge label="Bloqueadas" bg={colors.destructiveSoft} fg={colors.destructive} icon="close-circle" />
            ) : state.kind === "checking" ? (
              <Badge label="Comprobando…" />
            ) : (
              <Badge label="No disponibles" bg={colors.warningSoft} fg={colors.warning} icon="alert-circle" />
            )
          }
        />

        {state.kind === "granted" ? (
          <>
            <Text style={styles.body}>
              Recibirás un aviso cuando un cliente escriba en un chat que atiendes y cuando te asignen
              una conversación.
            </Text>
            <Text style={styles.tokenLabel}>
              Token {state.platform === "ios" ? "APNs" : "FCM"} de este dispositivo
            </Text>
            <Text style={styles.token} numberOfLines={1}>
              {state.token}
            </Text>
          </>
        ) : state.kind === "denied" ? (
          <>
            <Text style={styles.body}>
              Diste permiso denegado. Actívalas desde los ajustes del sistema para enterarte de los
              mensajes nuevos sin abrir la app.
            </Text>
            <Button label="Abrir ajustes del sistema" variant="secondary" icon="settings" onPress={() => Linking.openSettings()} />
          </>
        ) : state.kind === "unsupported" ? (
          <ErrorNote message={state.reason} />
        ) : (
          <Text style={styles.body}>Comprobando permisos…</Text>
        )}

        <Button label="Volver a comprobar" variant="secondary" icon="refresh" onPress={check} />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="Probar" />
        <Text style={styles.body}>
          Envía una notificación de prueba a todos los dispositivos donde tengas la sesión abierta.
        </Text>
        <Button
          label={sendTest.isPending ? "Enviando…" : "Enviar notificación de prueba"}
          icon="notifications"
          onPress={test}
          loading={sendTest.isPending}
          disabled={state.kind !== "granted"}
        />
        {result ? <Text style={styles.result}>{result}</Text> : null}
        {error ? <ErrorNote message={error} /> : null}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionHeader title="Cómo funciona" />
        <Bullet text="Un cliente escribe en un chat que tienes asignado → te llega a ti." />
        <Bullet text="Un chat sin dueño o en cola recibe un mensaje → les llega a los administradores." />
        <Bullet text="Te asignan, escalan o derivan una conversación → te llega el aviso de asignación." />
        <Bullet text="Al tocar la notificación se abre directamente esa conversación." />
        {Platform.OS === "android" ? (
          <Bullet text="El canal “Mensajes y asignaciones” controla el sonido en los ajustes de Android." />
        ) : null}
      </Card>

      <Button
        label="Ver permisos actuales"
        variant="ghost"
        onPress={async () => {
          const permissions = await Notifications.getPermissionsAsync();
          setResult(`status: ${permissions.status} · canAskAgain: ${permissions.canAskAgain}`);
        }}
      />
    </Screen>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bullet}>
      <Ionicons name="ellipse" size={6} color={colors.primary} style={{ marginTop: 6 }} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 13, color: colors.mutedForeground, lineHeight: 19 },
  tokenLabel: { fontSize: 11, fontWeight: "600", color: colors.foreground },
  token: { fontSize: 10, color: colors.mutedForeground, backgroundColor: colors.muted, padding: spacing.sm, borderRadius: 8 },
  result: { fontSize: 12, color: colors.foreground },
  bullet: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  bulletText: { flex: 1, fontSize: 12, color: colors.mutedForeground, lineHeight: 18 },
});
