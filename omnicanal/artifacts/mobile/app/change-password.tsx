import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useChangePassword } from "@workspace/api-client-react";
import { Screen } from "../src/components/Screen";
import { Button, Card, ErrorNote, Field } from "../src/components/ui";
import { colors, spacing } from "../src/theme";

const MIN_PASSWORD_LENGTH = 8;

export default function ChangePasswordScreen() {
  const router = useRouter();
  const changePassword = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    setDone(false);

    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (next !== confirm) {
      setError("La confirmación no coincide con la nueva contraseña.");
      return;
    }

    try {
      await changePassword.mutateAsync({ data: { currentPassword: current, newPassword: next } });
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      const apiMessage = (err as { data?: { error?: string } }).data?.error;
      setError(apiMessage ?? "No se pudo cambiar la contraseña. Intenta de nuevo.");
    }
  };

  return (
    <Screen>
      <Card style={{ gap: spacing.lg }}>
        <View style={styles.header}>
          <View style={styles.icon}>
            <Ionicons name="key" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Cambiar contraseña</Text>
            <Text style={styles.subtitle}>
              Usa al menos {MIN_PASSWORD_LENGTH} caracteres. Tu sesión actual seguirá activa.
            </Text>
          </View>
        </View>

        <Field
          label="Contraseña actual"
          value={current}
          onChangeText={(value) => {
            setCurrent(value);
            setError(null);
            setDone(false);
          }}
          secureTextEntry
        />
        <Field
          label="Nueva contraseña"
          value={next}
          onChangeText={(value) => {
            setNext(value);
            setError(null);
            setDone(false);
          }}
          secureTextEntry
        />
        <Field
          label="Confirmar nueva contraseña"
          value={confirm}
          onChangeText={(value) => {
            setConfirm(value);
            setError(null);
            setDone(false);
          }}
          secureTextEntry
        />

        {error ? <ErrorNote message={error} /> : null}
        {done ? (
          <View style={styles.success}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <Text style={styles.successText}>Contraseña actualizada.</Text>
          </View>
        ) : null}

        <Button
          label={changePassword.isPending ? "Guardando…" : "Guardar contraseña"}
          onPress={submit}
          loading={changePassword.isPending}
        />
        <Button label="Volver" variant="secondary" onPress={() => router.back()} />
      </Card>

      <Text style={styles.note}>
        La cuenta de administrador definida por variables de entorno no puede cambiar su contraseña
        desde aquí.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 16, fontWeight: "700", color: colors.foreground },
  subtitle: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
  success: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.successSoft,
    borderRadius: 12,
    padding: spacing.md,
  },
  successText: { fontSize: 12, color: colors.success, fontWeight: "600" },
  note: { fontSize: 11, color: colors.mutedForeground, textAlign: "center" },
});
