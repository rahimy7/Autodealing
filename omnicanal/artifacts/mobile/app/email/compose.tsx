import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useComposeEmail } from "@workspace/api-client-react";
import { Screen } from "../../src/components/Screen";
import { Button, Field } from "../../src/components/ui";
import { EmailAttachmentChips, useEmailAttachmentStaging } from "../../src/components/EmailAttachments";
import { pickDocument, pickFromLibrary } from "../../src/lib/media";
import { useAuth } from "../../src/lib/auth";
import { errorMessage } from "../../src/lib/format";
import { colors, spacing } from "../../src/theme";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ComposeEmailScreen() {
  const params = useLocalSearchParams<{ to?: string; contactId?: string; subject?: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const staging = useEmailAttachmentStaging(token);

  const [to, setTo] = useState(params.to ?? "");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(params.subject ?? "");
  const [content, setContent] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);

  const contactId = params.contactId ? Number(params.contactId) : null;
  const compose = useComposeEmail();

  const ccList = cc.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const toValid = EMAIL_RE.test(to.trim());
  const ccInvalid = ccList.some((x) => !EMAIL_RE.test(x));
  const canSend = toValid && subject.trim().length > 0 && content.trim().length > 0 && !ccInvalid && !staging.isUploading;

  const handleSend = () => {
    if (!canSend) return;
    compose.mutate(
      {
        data: {
          to: to.trim(),
          subject: subject.trim(),
          content: content.trim(),
          ...(ccList.length ? { cc: ccList } : {}),
          ...(contactId != null && Number.isInteger(contactId) ? { contactId } : {}),
          ...(staging.attachmentIds.length ? { attachmentIds: staging.attachmentIds } : {}),
        },
      },
      {
        onSuccess: (res) => {
          staging.reset();
          router.replace(`/email/${res.threadId}`);
        },
        onError: (err) => Alert.alert("Gmail no aceptó el envío", errorMessage(err)),
      },
    );
  };

  const choose = async (pick: () => Promise<Awaited<ReturnType<typeof pickFromLibrary>>>) => {
    setAttachOpen(false);
    try {
      const file = await pick();
      if (file) staging.addFile(file);
    } catch (err) {
      Alert.alert("No se pudo adjuntar", errorMessage(err));
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen footer={<View style={styles.footer}><Button label="Enviar" icon="send" onPress={handleSend} disabled={!canSend} loading={compose.isPending} /></View>}>
        <View style={styles.field}>
          <View style={styles.toRow}>
            <View style={{ flex: 1 }}>
              <Field
                label="Para"
                value={to}
                onChangeText={setTo}
                placeholder="cliente@correo.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
            <Pressable onPress={() => setShowCc((v) => !v)} style={styles.ccToggle}>
              <Text style={styles.ccToggleText}>{showCc ? "Quitar CC" : "CC"}</Text>
            </Pressable>
          </View>
          {to.length > 0 && !toValid ? <Text style={styles.errorText}>Correo inválido.</Text> : null}
        </View>

        {showCc ? (
          <Field
            label="CC"
            value={cc}
            onChangeText={setCc}
            placeholder="otro@correo.com, otro-mas@correo.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />
        ) : null}

        <Field label="Asunto" value={subject} onChangeText={setSubject} />
        <Field label="Mensaje" value={content} onChangeText={setContent} multiline style={{ minHeight: 160 }} />

        <View style={styles.attachSection}>
          <Pressable onPress={() => setAttachOpen((v) => !v)} style={styles.attachButton}>
            <Ionicons name="attach" size={16} color={colors.primary} />
            <Text style={styles.attachButtonText}>Adjuntar archivo</Text>
          </Pressable>
          {attachOpen ? (
            <View style={styles.attachOptions}>
              <Pressable onPress={() => choose(pickFromLibrary)} style={styles.attachOption}>
                <Ionicons name="image" size={16} color={colors.foreground} />
                <Text style={styles.attachOptionText}>Foto o video</Text>
              </Pressable>
              <Pressable onPress={() => choose(pickDocument)} style={styles.attachOption}>
                <Ionicons name="document" size={16} color={colors.foreground} />
                <Text style={styles.attachOptionText}>Documento</Text>
              </Pressable>
            </View>
          ) : null}
          <EmailAttachmentChips staging={staging} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  toRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  ccToggle: { paddingBottom: 11 },
  ccToggleText: { fontSize: 12, color: colors.primary, fontWeight: "600" },
  errorText: { fontSize: 11, color: colors.destructive },
  attachSection: { gap: spacing.sm },
  attachButton: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  attachButtonText: { fontSize: 13, color: colors.primary, fontWeight: "600" },
  attachOptions: { flexDirection: "row", gap: spacing.md },
  attachOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.muted,
  },
  attachOptionText: { fontSize: 12, color: colors.foreground, fontWeight: "600" },
  footer: { padding: spacing.lg, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
});
