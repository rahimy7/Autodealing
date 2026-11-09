import { Alert, Linking, Pressable, StyleSheet, Text } from "react-native";
import { colors, spacing } from "../theme";

export function PrivacyLink() {
  const open = () => {
    Linking.openURL("https://www.rvrservice.com/privacidad-apps").catch(() => {
      Alert.alert("Política de privacidad", "Puedes consultarla en www.rvrservice.com/privacidad-apps o escribir a contacto@rvrservice.com.");
    });
  };
  return (
    <Pressable accessibilityRole="link" accessibilityLabel="Política de privacidad y soporte" onPress={open} style={styles.link}>
      <Text style={styles.label}>Privacidad y soporte</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: 44, alignItems: "center", justifyContent: "center", padding: spacing.sm },
  label: { color: colors.primary, fontSize: 13, textDecorationLine: "underline" },
});
