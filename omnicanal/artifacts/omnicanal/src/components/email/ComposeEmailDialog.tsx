import { useEffect, useState } from "react";
import { useComposeEmail } from "@workspace/api-client-react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AttachmentPicker, useAttachmentStaging } from "./AttachmentPicker";

type Prefill = { to?: string; contactId?: number | null; subject?: string };

function errorText(err: unknown): string | undefined {
  const data = (err as { data?: { error?: string } } | null)?.data;
  return data?.error ?? (err instanceof Error ? err.message : undefined);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Redactar un correo nuevo, sin que el cliente haya escrito primero. Se usa
 * tanto desde la bandeja de Correo (botón "Redactar") como desde la ficha de un
 * contacto (botón "Enviar correo", con el destinatario ya puesto).
 */
export default function ComposeEmailDialog({
  open,
  onOpenChange,
  prefill,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: Prefill;
  onSent?: (threadId: number) => void;
}) {
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const staging = useAttachmentStaging();
  const compose = useComposeEmail();

  useEffect(() => {
    if (!open) return;
    setTo(prefill?.to ?? "");
    setCc("");
    setShowCc(false);
    setSubject(prefill?.subject ?? "");
    setContent("");
  }, [open, prefill?.to, prefill?.subject]);

  const ccList = cc
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const toValid = EMAIL_RE.test(to.trim());
  const ccInvalid = ccList.some((x) => !EMAIL_RE.test(x));
  const canSend = toValid && subject.trim().length > 0 && content.trim().length > 0 && !ccInvalid && !staging.isUploading;

  const close = (nextOpen: boolean) => {
    if (!nextOpen) staging.discardAll();
    onOpenChange(nextOpen);
  };

  const handleSend = () => {
    if (!canSend) return;
    compose.mutate(
      {
        data: {
          to: to.trim(),
          subject: subject.trim(),
          content: content.trim(),
          ...(ccList.length ? { cc: ccList } : {}),
          ...(prefill?.contactId != null ? { contactId: prefill.contactId } : {}),
          ...(staging.attachmentIds.length ? { attachmentIds: staging.attachmentIds } : {}),
        },
      },
      {
        onSuccess: (res) => {
          staging.reset();
          onOpenChange(false);
          toast({ title: "Correo enviado" });
          onSent?.(res.threadId);
        },
        onError: (err) => toast({ title: "Gmail no aceptó el envío", description: errorText(err), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Redactar correo</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground/70">Para</Label>
            <div className="flex items-center gap-2">
              <Input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="cliente@correo.com"
                className={to && !toValid ? "border-destructive" : ""}
                autoFocus
                data-testid="compose-email-to"
              />
              <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground flex-shrink-0" onClick={() => setShowCc((v) => !v)}>
                {showCc ? "Quitar CC" : "CC"}
              </button>
            </div>
          </div>
          {showCc && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground/70">CC</Label>
              <Input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="otro@correo.com, otro-mas@correo.com"
                className={ccInvalid ? "border-destructive" : ""}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground/70">Asunto</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="compose-email-subject" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground/70">Mensaje</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={7}
              className="resize-none text-sm"
              data-testid="compose-email-content"
            />
          </div>
          <AttachmentPicker staging={staging} disabled={compose.isPending} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => close(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSend} disabled={!canSend || compose.isPending} data-testid="compose-email-send">
              {compose.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              Enviar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
