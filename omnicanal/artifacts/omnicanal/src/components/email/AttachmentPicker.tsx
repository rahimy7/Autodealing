import { useCallback, useRef, useState } from "react";
import { AlertCircle, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MAX_EMAIL_ATTACHMENT_BYTES,
  MAX_EMAIL_ATTACHMENTS_COUNT,
  discardEmailAttachment,
  stageEmailAttachment,
} from "@/lib/email-attachments";
import { formatBytes } from "@/lib/media";
import { cn } from "@/lib/utils";

type PendingAttachment = {
  key: string;
  filename: string;
  size: number;
  state: "uploading" | "done" | "error";
  id?: number;
  error?: string;
};

// Se sube cada archivo en cuanto se elige, no al enviar: así la barra de espera
// es por archivo y un adjunto grande no bloquea a los demás ni al envío.
export function useAttachmentStaging() {
  const [items, setItems] = useState<PendingAttachment[]>([]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    setItems((prev) => {
      const room = MAX_EMAIL_ATTACHMENTS_COUNT - prev.length;
      if (room <= 0) return prev;
      const accepted = list.slice(0, room);
      const staged: PendingAttachment[] = accepted.map((file) => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        filename: file.name,
        size: file.size,
        state: file.size > MAX_EMAIL_ATTACHMENT_BYTES ? "error" : "uploading",
        error:
          file.size > MAX_EMAIL_ATTACHMENT_BYTES
            ? `Supera ${formatBytes(MAX_EMAIL_ATTACHMENT_BYTES)}.`
            : undefined,
      }));
      for (const [i, file] of accepted.entries()) {
        if (staged[i].state !== "uploading") continue;
        const key = staged[i].key;
        stageEmailAttachment(file).then(
          (attachment) =>
            setItems((cur) => cur.map((it) => (it.key === key ? { ...it, state: "done", id: attachment.id } : it))),
          (err) =>
            setItems((cur) =>
              cur.map((it) =>
                it.key === key
                  ? { ...it, state: "error", error: err instanceof Error ? err.message : "No se pudo subir." }
                  : it,
              ),
            ),
        );
      }
      return [...prev, ...staged];
    });
  }, []);

  const remove = useCallback((key: string) => {
    setItems((prev) => {
      const found = prev.find((it) => it.key === key);
      if (found?.id != null) void discardEmailAttachment(found.id).catch(() => {});
      return prev.filter((it) => it.key !== key);
    });
  }, []);

  // Descarta todo lo subido sin avisar al servidor de nuevo si ya se usó (el
  // envío ya se encargó de esas filas); solo limpia lo que quedó sin usar.
  const reset = useCallback(() => setItems([]), []);
  const discardAll = useCallback(() => {
    setItems((prev) => {
      for (const it of prev) if (it.id != null) void discardEmailAttachment(it.id).catch(() => {});
      return [];
    });
  }, []);

  return {
    items,
    addFiles,
    remove,
    reset,
    discardAll,
    isUploading: items.some((it) => it.state === "uploading"),
    hasError: items.some((it) => it.state === "error"),
    attachmentIds: items.filter((it) => it.state === "done" && it.id != null).map((it) => it.id!),
  };
}

export type AttachmentStaging = ReturnType<typeof useAttachmentStaging>;

/** Botón de clip + fila de chips con lo que ya se adjuntó (o se está subiendo). */
export function AttachmentPicker({ staging, disabled }: { staging: AttachmentStaging; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-1.5">
      {staging.items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {staging.items.map((it) => (
            <span
              key={it.key}
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border max-w-[220px]",
                it.state === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-muted/40",
              )}
              title={it.error ?? it.filename}
            >
              {it.state === "uploading" ? (
                <Loader2 className="w-3 h-3 flex-shrink-0 animate-spin" />
              ) : it.state === "error" ? (
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
              ) : (
                <Paperclip className="w-3 h-3 flex-shrink-0" />
              )}
              <span className="truncate">{it.filename}</span>
              {it.state === "done" && <span className="text-muted-foreground flex-shrink-0">{formatBytes(it.size)}</span>}
              <button
                type="button"
                onClick={() => staging.remove(it.key)}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) staging.addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1 h-8 text-xs"
        disabled={disabled || staging.items.length >= MAX_EMAIL_ATTACHMENTS_COUNT}
        onClick={() => inputRef.current?.click()}
        data-testid="email-attach-button"
      >
        <Paperclip className="w-3.5 h-3.5" /> Adjuntar
      </Button>
    </div>
  );
}
