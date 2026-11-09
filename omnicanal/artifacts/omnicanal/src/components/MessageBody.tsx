import { useState } from "react";
import type { Message } from "@workspace/api-client-react";
import { Download, FileText, ImageOff, Mic, MicOff, VideoOff } from "lucide-react";
import AudioBubble from "@/components/AudioBubble";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { captionOf, downloadMedia, mediaUrlOf, useMediaSrc } from "@/lib/media";

// Lo que va dentro de una burbuja de chat: texto, nota de voz o adjunto con su
// pie. Lo comparten la bandeja del admin, la del agente, el chat general y la
// ficha del contacto, para que un adjunto se vea igual en todas.
export default function MessageBody({ msg }: { msg: Message }) {
  const caption = captionOf(msg);

  if (msg.type === "audio") {
    return (
      <>
        {/* Sin archivo, la transcripción llegó pero el audio no se guardó
            (almacenamiento sin configurar o descarga fallida): que se vea, en
            vez de dejar solo el texto como si no hubiera audio. */}
        {msg.mediaUrl ? <AudioBubble url={msg.mediaUrl} /> : <Unavailable icon={MicOff} label="Audio no guardado" />}
        {caption && (
          <p className="flex items-start gap-1 text-xs italic opacity-80">
            <Mic className="w-3 h-3 mt-0.5 flex-shrink-0" /> {caption}
          </p>
        )}
      </>
    );
  }

  if (msg.type !== "image" && msg.type !== "video" && msg.type !== "document") {
    return (
      <p>
        <Linkified text={msg.content} />
      </p>
    );
  }

  const url = mediaUrlOf(msg);
  return (
    <>
      {msg.type === "image" ? (
        <ImageAttachment url={url} name={msg.mediaName ?? null} />
      ) : msg.type === "video" ? (
        <VideoAttachment url={url} />
      ) : (
        <DocumentAttachment url={url} name={msg.mediaName ?? null} />
      )}
      {caption && (
        <p className="mt-1.5">
          <Linkified text={caption} />
        </p>
      )}
    </>
  );
}

// Puntuación que suele ir pegada al final de un enlace y no forma parte de él.
const LINK = /https?:\/\/[^\s<>()]+/gi;
const TRAILING = /[.,;:!?…]+$/;

// Los enlaces del mensaje, clicables como en el teléfono del cliente: la ficha
// del producto que mandó el agente se abre desde el panel sin copiarla.
function Linkified({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const link = match[0].replace(TRAILING, "");
    const start = match.index ?? 0;
    parts.push(text.slice(last, start));
    parts.push(
      <a
        key={start}
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 break-all"
        onClick={(e) => e.stopPropagation()}
      >
        {link}
      </a>,
    );
    last = start + link.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function Unavailable({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs opacity-70 py-1">
      <Icon className="w-3.5 h-3.5" /> {label}
    </div>
  );
}

function Placeholder() {
  return <div className="h-40 w-56 max-w-full rounded-lg bg-black/10 animate-pulse" />;
}

function ImageAttachment({ url, name }: { url: string | null; name: string | null }) {
  const { src, failed } = useMediaSrc(url);
  const [open, setOpen] = useState(false);

  if (failed) return <Unavailable icon={ImageOff} label="Imagen no disponible" />;
  if (!src) return <Placeholder />;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block cursor-zoom-in" data-testid="image-attachment">
        <img src={src} alt={name ?? "Imagen"} className="max-h-64 max-w-full rounded-lg object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl p-3">
          <DialogTitle className="sr-only">{name ?? "Imagen"}</DialogTitle>
          <img src={src} alt={name ?? "Imagen"} className="max-h-[80vh] w-full rounded-md object-contain" />
          {url && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void downloadMedia(url, name ?? "imagen.jpg")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-xs font-medium text-foreground hover:bg-muted/70 transition-colors"
                data-testid="button-download-image"
              >
                <Download className="w-3.5 h-3.5" /> Descargar
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function VideoAttachment({ url }: { url: string | null }) {
  const { src, failed } = useMediaSrc(url);
  if (failed) return <Unavailable icon={VideoOff} label="Video no disponible" />;
  if (!src) return <Placeholder />;
  return <video controls preload="metadata" src={src} className="max-h-64 max-w-full rounded-lg" data-testid="video-attachment" />;
}

function DocumentAttachment({ url, name }: { url: string | null; name: string | null }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = name || "Documento";

  const download = async () => {
    if (!url) return;
    setBusy(true);
    setFailed(false);
    try {
      await downloadMedia(url, label);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const status = !url ? "No disponible" : failed ? "No se pudo descargar" : busy ? "Descargando…" : "Descargar";

  return (
    <button
      type="button"
      onClick={download}
      disabled={!url || busy}
      className="flex w-60 max-w-full items-center gap-2.5 rounded-lg bg-black/10 px-3 py-2 text-left transition-colors enabled:hover:bg-black/15"
      data-testid="document-attachment"
    >
      <FileText className="w-6 h-6 flex-shrink-0 opacity-80" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{label}</span>
        <span className="block text-[10px] opacity-70">{status}</span>
      </span>
      {url && <Download className="w-4 h-4 flex-shrink-0 opacity-70" />}
    </button>
  );
}
