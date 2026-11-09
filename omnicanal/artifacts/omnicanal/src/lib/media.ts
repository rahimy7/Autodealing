import { useEffect, useState } from "react";
import { customFetch, type Message } from "@workspace/api-client-react";

// Adjuntos del chat en el panel. La contraparte del servidor es
// api-server/src/lib/media.ts.

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

// Misma regla que mediaSummary() en el servidor: un adjunto sin pie guarda su
// descripción como contenido, y esa descripción no se repite debajo del archivo.
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

// El texto que acompaña al adjunto, o null si no escribieron nada.
export function captionOf(msg: MediaFields): string | null {
  const content = msg.content.trim();
  if (!content || content === mediaSummary(msg.type, msg.mediaName)) return null;
  if (!msg.mediaUrl && msg.type === "image" && isExternal(content)) return null;
  return msg.content;
}

// /api/media va detrás del token de sesión, que ni <img> ni <video> ni <audio>
// pueden mandar: el archivo se descarga aquí y se sirve como blob. Una URL
// externa se usa tal cual.
export function useMediaSrc(url: string | null): { src: string | null; failed: boolean } {
  const external = url != null && isExternal(url);
  const [state, setState] = useState<{ src: string | null; failed: boolean }>({ src: null, failed: false });

  useEffect(() => {
    if (!url || external) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setState({ src: null, failed: false });
    customFetch<Blob>(url, { responseType: "blob" })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ src: objectUrl, failed: false });
      })
      .catch(() => !cancelled && setState({ src: null, failed: true }));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, external]);

  if (!url) return { src: null, failed: true };
  if (external) return { src: url, failed: false };
  return state;
}

// Guarda el archivo con su nombre original. El que tiene en el almacenamiento
// ("chat-12-9f3c….pdf") no le dice nada a quien lo descarga.
export async function downloadMedia(url: string, name: string): Promise<void> {
  if (isExternal(url)) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const blob = await customFetch<Blob>(url, { responseType: "blob" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export async function sendAttachment(
  conversationId: number,
  file: File,
  caption: string,
  replyToMessageId?: number,
): Promise<Message> {
  const params = new URLSearchParams({ name: file.name, type: file.type || "application/octet-stream" });
  if (caption.trim()) params.set("caption", caption.trim());
  if (replyToMessageId) params.set("replyTo", String(replyToMessageId));
  return customFetch<Message>(`/api/conversations/${conversationId}/attachments?${params}`, {
    method: "POST",
    // Siempre octet-stream: el tipo real va en la query (ver la ruta en el servidor).
    headers: { "content-type": "application/octet-stream" },
    body: file,
    responseType: "json",
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
