import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useListConversationTemplates,
  useSendMessageTemplate,
  getListConversationTemplatesQueryKey,
  type Conversation,
  type MarketingTemplate,
} from "@workspace/api-client-react";
import { Sheet, SheetAction } from "./Sheet";
import { Button, EmptyState, Loading } from "./ui";
import { errorMessage } from "../lib/format";
import { colors, radius, spacing } from "../theme";

// La ventana de 24h de Meta: pasadas 24h desde el último mensaje del cliente, el
// canal rechaza un mensaje libre. En WhatsApp una plantilla aprobada la reabre;
// en Instagram/Facebook no hay plantillas, así que solo queda esperar a que el
// cliente vuelva a escribir. Mismas reglas que el panel
// (omnicanal/src/components/MessagingWindow.tsx).

function bodyText(t: MarketingTemplate): string {
  return t.components?.find((c) => (c.type ?? "").toUpperCase() === "BODY")?.text ?? "";
}

function countBodyVars(text: string): number {
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g);
  if (!matches) return 0;
  return Math.max(...matches.map((m) => parseInt(m.replace(/\D/g, ""), 10)));
}

// Encabezados con imagen/video/documento/ubicación necesitan subir un archivo,
// que esta hoja no ofrece (eso vive en Marketing). Se muestran sin poder elegirse,
// en vez de desaparecer sin explicación.
function needsMediaHeader(t: MarketingTemplate): boolean {
  const header = t.components?.find((c) => (c.type ?? "").toUpperCase() === "HEADER");
  return ["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes((header?.format ?? "").toUpperCase());
}

export function WindowClosedNotice({
  channel,
  onOpenTemplates,
}: {
  channel: Conversation["channel"];
  onOpenTemplates: () => void;
}) {
  const whatsapp = channel === "whatsapp";
  return (
    <View style={styles.notice}>
      <Ionicons name="warning" size={16} color={colors.warning} />
      <Text style={styles.noticeText}>
        Pasaron más de 24h desde el último mensaje del cliente.{" "}
        {whatsapp
          ? "Solo puedes reabrir la conversación con una plantilla aprobada."
          : "Debes esperar a que vuelva a escribir para responderle."}
      </Text>
      {whatsapp ? (
        <Pressable
          onPress={onOpenTemplates}
          style={({ pressed }) => [styles.noticeButton, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.noticeButtonText}>Plantilla</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function TemplateSheet({
  conversationId,
  visible,
  onClose,
  onSent,
}: {
  conversationId: number;
  visible: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [selected, setSelected] = useState<MarketingTemplate | null>(null);
  const [variables, setVariables] = useState<string[]>([]);

  const { data: templates, isLoading, error } = useListConversationTemplates(conversationId, {
    query: { enabled: visible, queryKey: getListConversationTemplatesQueryKey(conversationId) },
  });
  const sendTemplate = useSendMessageTemplate();

  const close = () => {
    setSelected(null);
    setVariables([]);
    onClose();
  };

  const pick = (t: MarketingTemplate) => {
    setSelected(t);
    setVariables(Array.from({ length: countBodyVars(bodyText(t)) }, () => ""));
  };

  const send = () => {
    if (!selected) return;
    sendTemplate.mutate(
      { conversationId, data: { name: selected.name, language: selected.language, variables } },
      {
        onSuccess: () => {
          onSent();
          close();
        },
        onError: (err) => Alert.alert("No se pudo enviar la plantilla", errorMessage(err)),
      },
    );
  };

  const list = templates ?? [];

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="Enviar plantilla aprobada"
      description="Reabre la conversación de WhatsApp pasadas las 24h."
    >
      {selected ? (
        <View style={styles.form}>
          <Text style={styles.templateName}>
            {selected.name} · {selected.language}
          </Text>
          <Text style={styles.body}>{bodyText(selected)}</Text>
          {variables.map((value, i) => (
            <TextInput
              key={i}
              value={value}
              onChangeText={(next) => setVariables((prev) => prev.map((p, idx) => (idx === i ? next : p)))}
              placeholder={`Variable {{${i + 1}}}`}
              placeholderTextColor={colors.mutedForeground}
              style={styles.input}
            />
          ))}
          <View style={styles.formButtons}>
            <Button
              label="Otra"
              variant="secondary"
              icon="arrow-back"
              onPress={() => setSelected(null)}
              disabled={sendTemplate.isPending}
              style={{ flex: 1 }}
            />
            <Button
              label="Enviar"
              icon="send"
              onPress={send}
              loading={sendTemplate.isPending}
              disabled={variables.some((v) => !v.trim())}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : isLoading ? (
        <Loading label="Cargando plantillas…" />
      ) : error ? (
        <EmptyState
          icon="alert-circle-outline"
          title="No se pudieron cargar las plantillas"
          description="Revisa las credenciales de WhatsApp en Configuración."
        />
      ) : list.length === 0 ? (
        <EmptyState icon="document-text-outline" title="No hay plantillas aprobadas disponibles" />
      ) : (
        list.map((t) => {
          const blocked = needsMediaHeader(t);
          return (
            <SheetAction
              key={`${t.name}-${t.language}`}
              icon="document-text"
              label={`${t.name} · ${t.language}`}
              description={blocked ? "Lleva encabezado con archivo: envíala desde Marketing" : bodyText(t).slice(0, 90)}
              disabled={blocked}
              onPress={() => pick(t)}
            />
          );
        })
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#FCD34D",
    backgroundColor: colors.warningSoft,
  },
  noticeText: { flex: 1, fontSize: 11, lineHeight: 15, color: "#92400E" },
  noticeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "#F59E0B",
    backgroundColor: colors.card,
  },
  noticeButtonText: { fontSize: 12, fontWeight: "700", color: "#92400E" },
  form: { gap: spacing.md, paddingHorizontal: spacing.lg },
  templateName: { fontSize: 12, fontWeight: "700", color: colors.mutedForeground },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.foreground,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.muted,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.foreground,
    backgroundColor: colors.card,
  },
  formButtons: { flexDirection: "row", gap: spacing.sm },
});
