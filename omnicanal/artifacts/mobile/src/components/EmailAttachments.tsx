import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import {
  discardEmailAttachment,
  formatBytes,
  MAX_EMAIL_ATTACHMENT_BYTES,
  uploadEmailAttachment,
} from "../lib/email-media";
import type { PickedFile } from "../lib/media";

type Pending = {
  key: string;
  filename: string;
  size: number;
  state: "uploading" | "done" | "error";
  id?: number;
  error?: string;
};

// Se sube en cuanto se elige el archivo, no al enviar: la respuesta o el
// borrador solo referencian ids ya subidos.
export function useEmailAttachmentStaging(token: string | null) {
  const [items, setItems] = useState<Pending[]>([]);

  const addFile = useCallback(
    (file: PickedFile) => {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (file.size != null && file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
        setItems((prev) => [
          ...prev,
          { key, filename: file.name, size: file.size ?? 0, state: "error", error: `Supera ${formatBytes(MAX_EMAIL_ATTACHMENT_BYTES)}.` },
        ]);
        return;
      }
      setItems((prev) => [...prev, { key, filename: file.name, size: file.size ?? 0, state: "uploading" }]);
      uploadEmailAttachment(file, token).then(
        (attachment) =>
          setItems((prev) => prev.map((it) => (it.key === key ? { ...it, state: "done", id: attachment.id, size: attachment.size } : it))),
        (err) =>
          setItems((prev) =>
            prev.map((it) => (it.key === key ? { ...it, state: "error", error: err instanceof Error ? err.message : "No se pudo subir." } : it)),
          ),
      );
    },
    [token],
  );

  const remove = useCallback((key: string) => {
    setItems((prev) => {
      const found = prev.find((it) => it.key === key);
      if (found?.id != null) void discardEmailAttachment(found.id).catch(() => {});
      return prev.filter((it) => it.key !== key);
    });
  }, []);

  const reset = useCallback(() => setItems([]), []);
  const discardAll = useCallback(() => {
    setItems((prev) => {
      for (const it of prev) if (it.id != null) void discardEmailAttachment(it.id).catch(() => {});
      return [];
    });
  }, []);

  return {
    items,
    addFile,
    remove,
    reset,
    discardAll,
    isUploading: items.some((it) => it.state === "uploading"),
    attachmentIds: items.filter((it) => it.state === "done" && it.id != null).map((it) => it.id!),
  };
}

export type EmailAttachmentStaging = ReturnType<typeof useEmailAttachmentStaging>;

/** Fila de chips con lo que se adjuntó (o se está subiendo) a la respuesta o el borrador en curso. */
export function EmailAttachmentChips({ staging }: { staging: EmailAttachmentStaging }) {
  if (staging.items.length === 0) return null;
  return (
    <View style={styles.row}>
      {staging.items.map((it) => (
        <View key={it.key} style={[styles.chip, it.state === "error" && styles.chipError]}>
          <Ionicons
            name={it.state === "uploading" ? "cloud-upload-outline" : it.state === "error" ? "alert-circle" : "attach"}
            size={12}
            color={it.state === "error" ? colors.destructive : colors.mutedForeground}
          />
          <Text style={[styles.chipText, it.state === "error" && { color: colors.destructive }]} numberOfLines={1}>
            {it.filename}
          </Text>
          <Pressable onPress={() => staging.remove(it.key)} hitSlop={8}>
            <Ionicons name="close" size={12} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.muted,
    maxWidth: 200,
  },
  chipError: { backgroundColor: colors.destructiveSoft },
  chipText: { fontSize: 11, color: colors.foreground, flexShrink: 1 },
});
