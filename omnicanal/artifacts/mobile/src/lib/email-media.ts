import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { customFetch } from "@workspace/api-client-react";
import { API_URL } from "./config";
import { type PickedFile } from "./media";

// Adjuntos de correo en el móvil. Mismo patrón que uploadAttachment() en
// media.ts para el chat, pero con su propio endpoint: el archivo se sube a un
// área de espera (aún no hay correo que lo lleve) y se referencia por id al
// responder, redactar o aprobar un borrador.

export type StagedEmailAttachment = { id: number; filename: string; mimeType: string; size: number };

export const MAX_EMAIL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export async function uploadEmailAttachment(file: PickedFile, token: string | null): Promise<StagedEmailAttachment> {
  const query = [
    ["name", file.name],
    ["type", file.mimeType],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  const result = await FileSystem.uploadAsync(`${API_URL}/api/email/attachments?${query}`, file.uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      "Content-Type": "application/octet-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  let body: (StagedEmailAttachment & { error?: string }) | null = null;
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

export async function discardEmailAttachment(id: number): Promise<void> {
  await customFetch(`/api/email/attachments/${id}`, { method: "DELETE" });
}

// Un adjunto entrante no vive en nuestro almacenamiento (se lee de Gmail al
// vuelo), así que no hay una URL firmada para abrirlo como en el chat: se baja
// con el token de sesión a un archivo temporal y se ofrece por la hoja de
// compartir del sistema, que es lo que deja "abrir con…" o guardarlo.
export async function openEmailAttachment(
  messageId: number,
  partId: string,
  filename: string,
  token: string | null,
): Promise<void> {
  const dest = `${FileSystem.cacheDirectory}${Date.now()}-${filename}`;
  const download = FileSystem.createDownloadResumable(
    `${API_URL}/api/email/messages/${messageId}/attachments/${encodeURIComponent(partId)}`,
    dest,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  const result = await download.downloadAsync();
  if (!result) throw new Error("No se pudo descargar el adjunto.");
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.uri);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
