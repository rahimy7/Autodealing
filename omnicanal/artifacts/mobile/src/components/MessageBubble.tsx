import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Message } from "@workspace/api-client-react";
import { AudioBubble } from "./AudioBubble";
import { chatColors, colors, radius, spacing } from "../theme";
import { errorMessage, formatTime } from "../lib/format";
import { useAuth } from "../lib/auth";
import { captionOf, mediaSource, mediaUrlOf, openMedia } from "../lib/media";
import { QuotedMessage } from "./Reply";

export function DayDivider({ label }: { label: string }) {
  return (
    <View style={styles.dividerRow}>
      <View style={styles.dividerPill}>
        <Text style={styles.dividerText}>{label}</Text>
      </View>
    </View>
  );
}

export function MessageBubble({
  message,
  onLongPress,
  onQuotePress,
  highlighted = false,
}: {
  message: Message;
  // Abre las acciones del mensaje (responder, editar, eliminar). Sin él, la
  // burbuja no reacciona: la ficha del contacto es de solo lectura.
  onLongPress?: () => void;
  // Tocar una cita lleva al mensaje citado, como en WhatsApp.
  onQuotePress?: (messageId: number) => void;
  highlighted?: boolean;
}) {
  // Panel-only audit notes (routing, takeover, session close) read as a divider,
  // never as something someone said.
  if (message.isInternal) {
    return (
      <View style={styles.dividerRow}>
        <View style={styles.internalPill}>
          <Text style={styles.internalText}>{message.content}</Text>
        </View>
      </View>
    );
  }

  const inbound = message.sender === "contact";
  const isBot = message.sender === "bot";
  const bubbleStyle = inbound ? styles.inbound : isBot ? styles.bot : styles.outbound;
  // Burbujas claras, como en WhatsApp: el texto es oscuro en las tres.
  const tint = chatColors.text;
  const url = mediaUrlOf(message);
  const caption = captionOf(message);
  const quote = message.replyTo;
  // Lo que Meta rechazó (típicamente la ventana de 24h cerrada): el motivo se lee
  // tocando el icono.
  const failed = !inbound && message.status === "failed" && !message.isDeleted;

  return (
    <View style={[styles.row, inbound ? styles.rowStart : styles.rowEnd]}>
      <Pressable
        onLongPress={onLongPress}
        disabled={!onLongPress}
        delayLongPress={350}
        style={({ pressed }) => [
          styles.bubble,
          bubbleStyle,
          highlighted && styles.highlighted,
          pressed && onLongPress ? { opacity: 0.85 } : null,
        ]}
      >
        {isBot && !message.isDeleted ? (
          <View style={styles.botTag}>
            <Ionicons name="sparkles" size={10} color={colors.bot} />
            <Text style={styles.botTagText}>Bot IA</Text>
          </View>
        ) : null}

        {quote && !message.isDeleted ? (
          <QuotedMessage quote={quote} onPress={onQuotePress ? () => onQuotePress(quote.id) : undefined} />
        ) : null}

        {message.isDeleted ? (
          <View style={styles.deletedRow}>
            <Ionicons name="ban" size={14} color={chatColors.meta} />
            <Text style={styles.deletedText}>Este mensaje fue eliminado</Text>
          </View>
        ) : message.type === "audio" ? (
          <>
            {/* Sin archivo, la transcripción llegó pero el audio no se guardó. */}
            {message.mediaUrl ? (
              <AudioBubble url={message.mediaUrl} tint={tint} />
            ) : (
              <Unavailable icon="mic-off" label="Audio no guardado" tint={tint} />
            )}
            {caption ? (
              <View style={styles.transcriptRow}>
                <Ionicons name="mic" size={11} color={tint} style={{ marginTop: 2 }} />
                <Text style={[styles.transcript, { color: tint }]}>{caption}</Text>
              </View>
            ) : null}
          </>
        ) : message.type === "image" || message.type === "video" || message.type === "document" ? (
          <>
            {message.type === "image" ? (
              <ImageAttachment url={url} tint={tint} />
            ) : (
              <FileAttachment url={url} kind={message.type} name={message.mediaName ?? null} tint={tint} />
            )}
            {caption ? (
              <Text style={[styles.text, { color: tint }]}>
                <Linkified text={caption} />
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={[styles.text, { color: tint }]}>
            <Linkified text={message.content} />
          </Text>
        )}

        <View style={styles.metaRow}>
          {message.isEdited && !message.isDeleted ? <Text style={styles.edited}>editado</Text> : null}
          <Text style={styles.time}>{formatTime(message.createdAt)}</Text>
          {failed ? (
            <Pressable
              hitSlop={8}
              onPress={() =>
                Alert.alert("No le llegó al cliente", message.failedReason ?? "Meta rechazó el envío.")
              }
            >
              <Ionicons name="alert-circle" size={14} color={colors.destructive} />
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

// Puntuación que suele ir pegada al final de un enlace y no forma parte de él.
const LINK = /https?:\/\/[^\s<>()]+/gi;
const TRAILING = /[.,;:!?…]+$/;

// Los enlaces del mensaje, tocables como en el teléfono del cliente: la ficha del
// producto que mandó el agente se abre sin copiarla.
function Linkified({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const link = match[0].replace(TRAILING, "");
    const start = match.index ?? 0;
    parts.push(text.slice(last, start));
    parts.push(
      <Text key={start} style={styles.link} onPress={() => void Linking.openURL(link)}>
        {link}
      </Text>,
    );
    last = start + link.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function Unavailable({ icon, label, tint }: { icon: keyof typeof Ionicons.glyphMap; label: string; tint: string }) {
  return (
    <View style={styles.unavailable}>
      <Ionicons name={icon} size={14} color={tint} />
      <Text style={[styles.unavailableText, { color: tint }]}>{label}</Text>
    </View>
  );
}

// Foto en la burbuja; al tocarla se abre a pantalla completa.
function ImageAttachment({ url, tint }: { url: string | null; tint: string }) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!url || failed) return <Unavailable icon="image-outline" label="Imagen no disponible" tint={tint} />;
  const source = mediaSource(url, token);

  return (
    <>
      <Pressable onPress={() => setOpen(true)}>
        <Image source={source} style={styles.image} contentFit="cover" transition={150} onError={() => setFailed(true)} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <View style={styles.viewer}>
          <Image source={source} style={StyleSheet.absoluteFill} contentFit="contain" />
          <Pressable
            onPress={() => setOpen(false)}
            hitSlop={12}
            style={[styles.viewerClose, { top: insets.top + spacing.md }]}
          >
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

// Documento o video: una tarjeta que lo abre en el visor del sistema, que sabe
// mostrar un PDF, una hoja de cálculo o un video mejor que cualquier cosa hecha aquí.
function FileAttachment({
  url,
  kind,
  name,
  tint,
}: {
  url: string | null;
  kind: "video" | "document";
  name: string | null;
  tint: string;
}) {
  const [opening, setOpening] = useState(false);
  const label = name ?? (kind === "video" ? "Video" : "Documento");

  const open = async () => {
    if (!url || opening) return;
    setOpening(true);
    try {
      await openMedia(url);
    } catch (err) {
      Alert.alert("No se pudo abrir el archivo", errorMessage(err));
    } finally {
      setOpening(false);
    }
  };

  return (
    <Pressable
      onPress={open}
      disabled={!url}
      style={({ pressed }) => [styles.file, { borderColor: `${tint}40` }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={kind === "video" ? "videocam" : "document-text"} size={24} color={tint} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.fileName, { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.fileHint, { color: tint }]}>
          {!url ? "No disponible" : opening ? "Abriendo…" : "Toca para abrir"}
        </Text>
      </View>
      {opening ? <ActivityIndicator size="small" color={tint} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  rowStart: { justifyContent: "flex-start" },
  rowEnd: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 5,
    borderRadius: 8,
    gap: 2,
    // La sombra mínima de WhatsApp: separa la burbuja del fondo sin borde.
    shadowColor: "#0B141A",
    shadowOpacity: 0.13,
    shadowRadius: 0.5,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  inbound: { backgroundColor: chatColors.incoming, borderTopLeftRadius: 0 },
  outbound: { backgroundColor: chatColors.outgoing, borderTopRightRadius: 0 },
  bot: { backgroundColor: chatColors.bot, borderTopRightRadius: 0 },
  text: { fontSize: 15, lineHeight: 20 },
  link: { textDecorationLine: "underline" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 1 },
  time: { fontSize: 11, color: chatColors.meta },
  edited: { fontSize: 11, color: chatColors.meta, fontStyle: "italic" },
  // Un momento de color al llegar desde una cita; sin borde, para no mover el hilo.
  highlighted: { backgroundColor: colors.primarySoft },
  deletedRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 },
  deletedText: { fontSize: 14, fontStyle: "italic", color: chatColors.meta },
  botTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  botTagText: { fontSize: 11, color: colors.bot, fontWeight: "700" },
  transcriptRow: { flexDirection: "row", gap: 4, alignItems: "flex-start" },
  transcript: { flex: 1, fontSize: 12, fontStyle: "italic", opacity: 0.85 },
  image: { width: 220, height: 165, borderRadius: radius.md, marginBottom: 4, backgroundColor: colors.muted },
  unavailable: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  unavailableText: { fontSize: 12, opacity: 0.8 },
  file: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minWidth: 200,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: 2,
  },
  fileName: { fontSize: 13, fontWeight: "600" },
  fileHint: { fontSize: 11, opacity: 0.75 },
  viewer: { flex: 1, backgroundColor: "#000000" },
  viewerClose: {
    position: "absolute",
    right: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  dividerRow: { alignItems: "center", paddingHorizontal: spacing.lg, marginVertical: spacing.sm },
  dividerPill: {
    backgroundColor: chatColors.incoming,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: 8,
    elevation: 1,
    shadowColor: "#0B141A",
    shadowOpacity: 0.13,
    shadowRadius: 0.5,
    shadowOffset: { width: 0, height: 1 },
  },
  dividerText: { fontSize: 12, color: chatColors.noteText, fontWeight: "600" },
  internalPill: {
    backgroundColor: chatColors.note,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 8,
    maxWidth: "90%",
  },
  internalText: { fontSize: 12, color: chatColors.noteText, textAlign: "center" },
});
