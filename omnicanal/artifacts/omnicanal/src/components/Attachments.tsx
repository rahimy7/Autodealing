import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileText, Paperclip, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MAX_ATTACHMENT_BYTES, formatBytes, sendAttachment } from "@/lib/media";
import { cn } from "@/lib/utils";

// El archivo elegido para mandar en el chat, antes de mandarlo. Lo que se escriba
// en la caja de texto viaja como su pie.
export function useAttachmentDraft(conversationId: number | null) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: (v: { conversationId: number; file: File; caption: string; replyToMessageId?: number }) =>
      sendAttachment(v.conversationId, v.file, v.caption, v.replyToMessageId),
  });

  // Un borrador es de su conversación: al cambiar de chat no se lleva el archivo.
  useEffect(() => setFile(null), [conversationId]);

  const pick = (next: File) => {
    if (next.size > MAX_ATTACHMENT_BYTES) {
      toast({
        title: "Archivo demasiado grande",
        description: `El máximo es ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
        variant: "destructive",
      });
      return;
    }
    setFile(next);
  };

  // Una captura pegada en la caja de texto se adjunta, como en WhatsApp Web.
  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.files?.[0];
    if (!pasted) return;
    e.preventDefault();
    pick(pasted);
  };

  const send = (caption: string, onSent: () => void, replyToMessageId?: number) => {
    if (!file || !conversationId) return;
    upload.mutate(
      { conversationId, file, caption, replyToMessageId },
      {
        onSuccess: () => {
          setFile(null);
          onSent();
        },
        onError: (err) =>
          toast({
            title: "No se pudo enviar el archivo",
            description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
            variant: "destructive",
          }),
      },
    );
  };

  return { file, pick, clear: () => setFile(null), onPaste, send, sending: upload.isPending };
}

export function AttachButton({
  onPick,
  disabled,
  className,
}: {
  onPick: (file: File) => void;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        title="Adjuntar foto, video o documento"
        aria-label="Adjuntar archivo"
        className={cn(
          "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40",
          className,
        )}
        data-testid="button-attach-file"
      >
        <Paperclip className="w-4 h-4" />
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onPick(picked);
          // Sin esto, elegir otra vez el mismo archivo no dispara onChange.
          e.target.value = "";
        }}
        data-testid="input-attach-file"
      />
    </>
  );
}

export function AttachmentChip({ file, onRemove, disabled }: { file: File; onRemove: () => void; disabled?: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith("image/")) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2" data-testid="attachment-chip">
      {preview ? (
        <img src={preview} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" />
      ) : (
        <div className="h-10 w-10 flex-shrink-0 rounded bg-muted flex items-center justify-center">
          <FileText className="w-5 h-5 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">{file.name}</p>
        <p className="text-[10px] text-muted-foreground">
          {disabled ? "Enviando…" : `${formatBytes(file.size)} · lo que escribas irá como pie`}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40"
        aria-label="Quitar archivo"
        data-testid="button-remove-attachment"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
