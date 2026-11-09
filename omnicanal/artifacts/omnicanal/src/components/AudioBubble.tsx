import { Mic } from "lucide-react";
import { useMediaSrc } from "@/lib/media";

// Voice-note player. The media endpoint requires the bearer token, which an
// <audio src> tag can't send, so the audio is fetched to a blob object URL.
export default function AudioBubble({ url }: { url: string }) {
  const { src, failed } = useMediaSrc(url);

  if (failed) {
    return (
      <div className="flex items-center gap-1.5 text-xs opacity-70 py-1">
        <Mic className="w-3.5 h-3.5" /> Audio no disponible
      </div>
    );
  }

  if (!src) {
    return <div className="h-10 w-56 max-w-full rounded-full bg-black/10 animate-pulse my-1" />;
  }

  return <audio controls preload="metadata" src={src} className="h-10 w-56 max-w-full my-1" data-testid="audio-player" />;
}
