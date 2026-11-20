import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import { useKeyboardHeight } from "@/lib/keyboard";
import { DEFAULT_SERVER } from "@/lib/api";
import { Button, Field, Pill, T } from "@/components/ui";
import { colors, font, radius } from "@/theme";

export default function Login() {
  const { signIn, server } = useAuth();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const [url, setUrl] = useState(server || DEFAULT_SERVER);
  const [showServer, setShowServer] = useState(!(server || DEFAULT_SERVER));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    try {
      await signIn(url, username, password);
    } catch (e: any) {
      setError(e.message || "No se pudo entrar.");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingBottom: kb }}>
      <LinearGradient colors={["rgba(124,92,255,0.32)", "rgba(56,225,255,0.08)", "rgba(5,6,10,0)"]} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 460 }} pointerEvents="none" />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 18, paddingTop: 18 + insets.top, paddingBottom: 18 + (kb ? 0 : insets.bottom) }} keyboardShouldPersistTaps="handled">
        <View style={{ borderRadius: radius.xl, borderWidth: 1, borderColor: colors.line, backgroundColor: "rgba(10,12,18,0.72)", padding: 22, gap: 16 }}>
          <Image source={require("../../assets/logo.png")} style={{ width: 230, height: 86, alignSelf: "center" }} resizeMode="contain" />
          <T v="eyebrow">Premier App · Equipo</T>
          <Text style={{ fontFamily: font.display, fontSize: 26, color: colors.text, letterSpacing: -0.8, lineHeight: 32 }}>
            El concesionario <Text style={{ color: colors.accent }}>en tu mano.</Text>
          </Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Pill tone="info">Ventas</Pill>
            <Pill tone="violet">Servicio</Pill>
            <Pill>Administración</Pill>
          </View>
          <Field label="Usuario" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" maxLength={80} returnKeyType="next" />
          <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" maxLength={128} returnKeyType="go" onSubmitEditing={submit} />
          {showServer ? (
            <Field label="Servidor" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="premierlinemotors.com" hint="La dirección del sitio de Premier. Se guarda en este teléfono." />
          ) : (
            <Pressable onPress={() => setShowServer(true)} hitSlop={8}>
              <T v="small">
                Servidor: <T v="small" style={{ color: colors.text2 }}>{url.replace(/^https?:\/\//, "")}</T> · <T v="small" style={{ color: colors.accent }}>cambiar</T>
              </T>
            </Pressable>
          )}
          {error ? <T v="small" style={{ color: colors.bad, fontSize: 13.5 }}>{error}</T> : null}
          <Button title="Entrar" onPress={submit} full disabled={!username || !password || !url} />
        </View>
      </ScrollView>
    </View>
  );
}
