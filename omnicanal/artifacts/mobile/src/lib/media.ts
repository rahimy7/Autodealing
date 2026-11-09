import { Linking, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { customFetch, type Message } from "@workspace/api-client-react";
import { API_URL } from "./config";

// Adjuntos del chat en el móvil. Las mismas reglas que el panel
// (omnicanal/src/lib/media.ts) y el servidor (api-server/src/lib/media.ts).

export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

const isExternal = (url: string) => /^https?:\/\//i.test(url);

type MediaFields = Pick<Message, "type" | "content" | "mediaUrl" | "mediaName">;

// Dónde está el archivo de un mensaje. Las fotos de catálogo que manda el agente
// virtual no pasan por el almacenamiento: guardan la URL del producto como texto.
export function mediaUrlOf(msg: MediaFields): string | null {
  if (msg.mediaUrl) return msg.mediaUrl;
  const content = msg.content.trim();
  return msg.type === "image" && isExternal(content) ? content : null;
}

function mediaSummary(type: string, name: string | null | undefined): string | null {
  switch (type) {
    case "image":
      return "📷 Imagen";
    case "video":
      return "🎬 Video";
    case "audio":
      return "🎵 Audio";
    case "document":
      return `📎 ${name || "Documento"}`;
    default:
      return null;
  }
}

// El texto que acompaña al adjunto, o null si no escribieron nada: un adjunto sin
// pie guarda su descripción como contenido, y no se repite debajo del archivo.
export function captionOf(msg: MediaFields): string | null {
  const content = msg.content.trim();
  if (!content || content === mediaSummary(msg.type, msg.mediaName)) return null;
  if (!msg.mediaUrl && msg.type === "image" && isExternal(content)) return null;
  return msg.content;
}

// La fuente de expo-image para un adjunto: /api/media va detrás del token de
// sesión, así que viaja en la cabecera. Una URL externa no lo necesita.
export function mediaSource(url: string, token: string | null) {
  if (isExternal(url)) return { uri: url };
  return { uri: `${API_URL}${url}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined };
}

// Abre un documento o un video en el visor del sistema. El visor no puede mandar
// el token, así que se pide antes un enlace temporal al servidor.
export async function openMedia(url: string): Promise<void> {
  if (isExternal(url)) {
    await Linking.openURL(url);
    return;
  }
  const file = url.split("/").pop() ?? "";
  const { url: link } = await customFetch<{ url: string }>(`/api/media/${encodeURIComponent(file)}/link`, {
    responseType: "json",
  });
  await Linking.openURL(link);
}

// ── Elegir un archivo ─────────────────────────────────────────────────────────

export type PickedFile = {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
  isImage: boolean;
};

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  "3gp": "video/3gpp",
  pdf: "application/pdf",
};

const extOf = (value: string | null | undefined) =>
  value?.split("?")[0].match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ?? null;

function fromImageAsset(asset: ImagePicker.ImagePickerAsset): PickedFile {
  // Lo que se sube es el archivo del uri, que el selector ya convirtió a JPEG
  // (quality < 1). El nombre original puede seguir diciendo .HEIC, y el servidor
  // decide por el tipo si WhatsApp lo muestra como foto: manda el uri.
  const ext = extOf(asset.uri);
  const isVideo = asset.type === "video";
  const original = asset.fileName ?? `${isVideo ? "video" : "foto"}.${ext ?? "jpg"}`;
  const name = ext && extOf(original) !== ext ? `${original.replace(/\.[^.]+$/, "")}.${ext}` : original;
  return {
    uri: asset.uri,
    name,
    mimeType: (ext && EXT_MIME[ext]) || asset.mimeType || "application/octet-stream",
    size: asset.fileSize ?? null,
    isImage: !isVideo,
  };
}

export async function pickFromLibrary(): Promise<PickedFile | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.8 });
  return result.canceled ? null : fromImageAsset(result.assets[0]);
}

export async function takePhoto(): Promise<PickedFile | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Permite el acceso a la cámara en los ajustes del teléfono.");
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
  return result.canceled ? null : fromImageAsset(result.assets[0]);
}

export async function pickDocument(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const mimeType = asset.mimeType || EXT_MIME[extOf(asset.name) ?? ""] || "application/octet-stream";
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType,
    size: asset.size ?? null,
    isImage: mimeType.startsWith("image/"),
  };
}

// En iOS, abrir el selector mientras la hoja de opciones todavía se está cerrando
// falla sin avisar: el sistema no presenta una pantalla encima de otra que se va.
export function afterSheetCloses(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Platform.OS === "ios" ? 450 : 0));
}

// ── Enviar ────────────────────────────────────────────────────────────────────

// FileSystem lee el archivo del disco y lo manda como cuerpo binario, que es lo
// que espera el servidor, sin pasarlo entero por la memoria de JS.
export async function uploadAttachment(
  conversationId: number,
  file: PickedFile,
  caption: string,
  token: string | null,
  // El mensaje al que responde, citándolo como en WhatsApp.
  replyToMessageId?: number,
): Promise<Message> {
  const query = [
    ["name", file.name],
    ["type", file.mimeType],
    ...(caption.trim() ? [["caption", caption.trim()]] : []),
    ...(replyToMessageId ? [["replyTo", String(replyToMessageId)]] : []),
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  const result = await FileSystem.uploadAsync(
    `${API_URL}/api/conversations/${conversationId}/attachments?${query}`,
    file.uri,
    {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        // Siempre octet-stream: el tipo real va en la query (ver la ruta en el servidor).
        "Content-Type": "application/octet-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );

  let body: (Message & { error?: string }) | null = null;
  try {
    body = JSON.parse(result.body);
  } catch {
    body = null;
  }
  if (result.status < 200 || result.status >= 300 || !body) {
    throw new Error(body?.error ?? `El servidor respondió ${result.status}.`);
  }
  return body;
}
