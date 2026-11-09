import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLogin } from "@workspace/api-client-react";
import { Button, Card, ErrorNote, Field } from "../src/components/ui";
import { useAuth } from "../src/lib/auth";
import { PrivacyLink } from "../src/components/PrivacyLink";
import { API_URL } from "../src/lib/config";
import { channelColors, colors, radius, spacing } from "../src/theme";

const CHANNELS = [
  { key: "whatsapp", icon: "logo-whatsapp", label: "WhatsApp Business" },
  { key: "instagram", icon: "logo-instagram", label: "Instagram DM" },
  { key: "facebook", icon: "logo-facebook", label: "Facebook Messenger" },
] as const;

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Escribe tu correo y tu contraseña.");
      return;
    }
    try {
      const result = await login.mutateAsync({ data: { email: email.trim(), password } });
      await signIn({ token: result.token, user: result.user });
      // The root layout redirects as soon as the session lands.
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 401
          ? "Correo o contraseña incorrectos."
          : `No se pudo conectar con ${API_URL}. Revisa tu conexión.`,
      );
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Ionicons name="flash" size={26} color={colors.primaryForeground} />
          </View>
          <View>
            <Text style={styles.brandName}>OmniAI</Text>
            <Text style={styles.brandTag}>Plataforma Omnicanal con IA</Text>
          </View>
        </View>

        <Text style={styles.headline}>
          Toda tu atención al cliente, <Text style={{ color: colors.primary }}>en un solo lugar.</Text>
        </Text>

        <View style={{ gap: spacing.sm }}>
          {CHANNELS.map((channel) => (
            <View key={channel.key} style={styles.channel}>
              <Ionicons name={channel.icon} size={18} color={channelColors[channel.key]} />
              <Text style={styles.channelText}>{channel.label}</Text>
            </View>
          ))}
        </View>

        <Card style={{ gap: spacing.lg }}>
          <View style={{ gap: 4 }}>
            <Text style={styles.cardTitle}>Iniciar sesión</Text>
            <Text style={styles.cardSubtitle}>Tu rol se asigna automáticamente.</Text>
          </View>

          <Field
            label="Correo electrónico"
            value={email}
            onChangeText={setEmail}
            placeholder="tucorreo@decolor.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
          />

          <Field
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            textContentType="password"
            onSubmitEditing={submit}
            returnKeyType="go"
          />

          {error ? <ErrorNote message={error} /> : null}

          <Button label={login.isPending ? "Entrando…" : "Entrar"} onPress={submit} loading={login.isPending} icon="arrow-forward" />

          <Text style={styles.footnote}>
            ¿Eres agente y no tienes contraseña? Pídele al administrador que te la asigne.
          </Text>
        </Card>

        <PrivacyLink />
        <Text style={styles.server}>Servidor: {API_URL}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  logo: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: { fontSize: 22, fontWeight: "800", color: colors.foreground },
  brandTag: { fontSize: 11, color: colors.mutedForeground },
  headline: { fontSize: 26, fontWeight: "800", color: colors.foreground, lineHeight: 32 },
  channel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  channelText: { fontSize: 13, color: colors.foreground },
  cardTitle: { fontSize: 20, fontWeight: "800", color: colors.foreground },
  cardSubtitle: { fontSize: 13, color: colors.mutedForeground },
  footnote: { fontSize: 11, color: colors.mutedForeground, textAlign: "center" },
  server: { fontSize: 10, color: colors.mutedForeground, textAlign: "center" },
});
