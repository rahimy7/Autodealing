// Adjuntos de conversación: fotos, videos, audios y documentos que entran por
// los canales o que el equipo manda desde el panel y el móvil.
//
// Un adjunto se guarda como un mensaje más. Su `content` es el pie que escribió
// quien lo mandó o, si no escribió nada, la descripción de mediaSummary(). Así la
// bandeja, las búsquedas, los avisos push, el agente virtual y los resúmenes lo
// leen como cualquier otro turno sin tener que saber que existen los adjuntos.

export type MediaKind = "image" | "video" | "audio" | "document";

const MEDIA_ICON: Record<MediaKind, string> = {
  image: "📷",
  video: "🎬",
  audio: "🎵",
  document: "📎",
};

export function isMediaKind(type: string): type is MediaKind {
  return type in MEDIA_ICON;
}

// Cómo se lee un adjunto que llegó sin texto. Los clientes (web y móvil) usan la
// misma regla para no repetir la descripción debajo de la foto: si el contenido
// coincide con esto, no es un pie.
export function mediaSummary(kind: MediaKind, name: string | null): string {
  switch (kind) {
    case "image":
      return "📷 Imagen";
    case "video":
      return "🎬 Video";
    case "audio":
      return "🎵 Audio";
    default:
      return `📎 ${name || "Documento"}`;
  }
}

// La línea que va a la lista de conversaciones y a la notificación.
export function mediaPreview(kind: MediaKind, name: string | null, content: string): string {
  const summary = mediaSummary(kind, name);
  return content === summary ? summary : `${MEDIA_ICON[kind]} ${content}`;
}

// El turno tal como lo lee el modelo. Con un pie, el pie solo haría creer que el
// cliente escribió texto: "¿tienen este color?" sin saber que venía con una foto.
// El audio queda fuera porque su contenido ya es la transcripción.
export function historyContent(m: { type: string; content: string; mediaName: string | null }): string {
  if (!isMediaKind(m.type) || m.type === "audio") return m.content;
  const summary = mediaSummary(m.type, m.mediaName);
  return m.content === summary ? summary : `${summary}: ${m.content}`;
}

// ── Salida ────────────────────────────────────────────────────────────────────

// Lo que WhatsApp acepta como cada tipo. Fuera de estas listas el archivo sale
// como documento, que WhatsApp acepta de cualquier tipo: el cliente lo recibe
// igual, solo que como archivo en vez de verse en el chat.
const WHATSAPP_IMAGE = new Set(["image/jpeg", "image/png"]);
// Messenger e Instagram muestran también GIF y WebP como imagen.
const MESSENGER_IMAGE = new Set([...WHATSAPP_IMAGE, "image/gif", "image/webp"]);
const VIDEO = new Set(["video/mp4", "video/3gpp"]);
const AUDIO = new Set(["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"]);

// WhatsApp rechaza imágenes de más de 5 MB; como documento pasan.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Tope de lo que pasa por nuestro servidor. Es el límite de WhatsApp para video y
// audio; los documentos admiten más allá, pero un archivo así ya no se manda por chat.
export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

export function outboundKind(mimeType: string, size: number, channel: string): MediaKind {
  const images = channel === "whatsapp" ? WHATSAPP_IMAGE : MESSENGER_IMAGE;
  if (images.has(mimeType) && size <= MAX_IMAGE_BYTES) return "image";
  if (VIDEO.has(mimeType)) return "video";
  if (AUDIO.has(mimeType)) return "audio";
  return "document";
}

// ── Nombres y extensiones ─────────────────────────────────────────────────────

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/amr": "amr",
  "audio/ogg": "ogg",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
};

export function normalizeMime(value: string | null | undefined): string {
  const mime = value?.split(";")[0].trim().toLowerCase();
  return mime || "application/octet-stream";
}

// La extensión del archivo guardado. Manda la del nombre original —es la que el
// visor del sistema usa para decidir con qué abrirlo— y si no hay, la del tipo.
export function fileExtension(mimeType: string, name: string | null): string {
  const fromName = name?.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
  return fromName ?? MIME_EXT[mimeType] ?? "bin";
}

// El nombre que viene del cliente no es de fiar: sin rutas ni caracteres de
// control, y recortado por delante para no perder la extensión.
export function cleanFileName(value: string | null | undefined): string | null {
  const name = value
    ?.split(/[/\\]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!name) return null;
  return name.length > 120 ? name.slice(-120) : name;
}

// Messenger no manda el nombre de un archivo adjunto, pero la URL de su CDN lo
// lleva como último tramo de la ruta ("…/Cotizacion.pdf?_nc_cat=…").
export function fileNameFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return /\.[a-z0-9]{1,8}$/i.test(last) ? cleanFileName(last) : null;
  } catch {
    return null;
  }
}
