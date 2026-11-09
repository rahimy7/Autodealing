import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListConversationTemplates,
  useSendMessageTemplate,
  getListConversationTemplatesQueryKey,
  getListMessagesQueryKey,
  getListConversationsQueryKey,
  type Conversation,
  type MarketingTemplate,
} from "@workspace/api-client-react";
import { AlertTriangle, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

// La ventana de 24h de Meta: pasadas 24h desde el último mensaje del cliente, el
// canal rechaza un mensaje libre. En WhatsApp una plantilla aprobada la reabre;
// en Instagram/Facebook no hay catálogo de plantillas en la app, así que solo
// queda esperar a que el cliente vuelva a escribir. Lo comparten las tres
// bandejas que contestan (admin, agente, Chat General).

function bodyText(t: MarketingTemplate): string {
  return t.components?.find((c) => (c.type ?? "").toUpperCase() === "BODY")?.text ?? "";
}

function countBodyVars(text: string): number {
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g);
  if (!matches) return 0;
  return Math.max(...matches.map((m) => parseInt(m.replace(/\D/g, ""), 10)));
}

// Encabezados con imagen/video/documento/ubicación necesitan subir un archivo,
// que este modal no ofrece (eso ya existe en Marketing). Se muestran pero no se
// pueden elegir, en vez de desaparecer sin explicación.
function needsMediaHeader(t: MarketingTemplate): boolean {
  const header = t.components?.find((c) => (c.type ?? "").toUpperCase() === "HEADER");
  return ["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes((header?.format ?? "").toUpperCase());
}

export function WindowClosedNotice({
  channel,
  onOpenTemplates,
}: {
  channel: Conversation["channel"];
  onOpenTemplates: () => void;
}) {
  return (
    <div
      className="mb-2 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"
      data-testid="notice-window-closed"
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
      <p className="flex-1 text-[11px] leading-snug text-amber-800">
        Pasaron más de 24h desde el último mensaje del cliente.{" "}
        {channel === "whatsapp"
          ? "Solo puedes reabrir la conversación con una plantilla aprobada."
          : "Debes esperar a que vuelva a escribir para responderle."}
      </p>
      {channel === "whatsapp" && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 flex-shrink-0 text-[11px]"
          onClick={onOpenTemplates}
          data-testid="button-open-template-modal"
        >
          <FileText className="mr-1 h-3 w-3" /> Enviar plantilla
        </Button>
      )}
    </div>
  );
}

export function TemplateSendDialog({
  conversationId,
  open,
  onOpenChange,
}: {
  conversationId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<MarketingTemplate | null>(null);
  const [variables, setVariables] = useState<string[]>([]);

  const {
    data: templates,
    isLoading,
    error,
  } = useListConversationTemplates(conversationId, {
    query: { enabled: open, queryKey: getListConversationTemplatesQueryKey(conversationId) },
  });
  const sendTemplate = useSendMessageTemplate();

  const reset = () => {
    setSelected(null);
    setVariables([]);
  };

  const pick = (t: MarketingTemplate) => {
    setSelected(t);
    setVariables(Array.from({ length: countBodyVars(bodyText(t)) }, () => ""));
  };

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

  const handleSend = () => {
    if (!selected) return;
    sendTemplate.mutate(
      { conversationId, data: { name: selected.name, language: selected.language, variables } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          reset();
          onOpenChange(false);
        },
        onError: (err: unknown) =>
          toast({
            title: "No se pudo enviar la plantilla",
            description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar plantilla aprobada</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading && <p className="text-sm text-muted-foreground">Cargando plantillas…</p>}
          {!!error && (
            <p className="text-sm text-red-500">
              No se pudieron cargar las plantillas. Revisa las credenciales de WhatsApp en Configuración.
            </p>
          )}
          {!isLoading && !error && (templates ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No hay plantillas aprobadas disponibles.</p>
          )}
          {!isLoading && (templates ?? []).length > 0 && (
            <div className="space-y-2">
              <Label>Plantilla</Label>
              <Select
                value={selected?.name ?? ""}
                onValueChange={(v) => {
                  const t = (templates ?? []).find((x) => x.name === v);
                  if (t) pick(t);
                }}
              >
                <SelectTrigger data-testid="select-conversation-template">
                  <SelectValue placeholder="Selecciona una plantilla" />
                </SelectTrigger>
                <SelectContent>
                  {(templates ?? []).map((t) => (
                    <SelectItem
                      key={`${t.name}-${t.language}`}
                      value={t.name}
                      disabled={needsMediaHeader(t)}
                    >
                      {t.name} · {t.language}
                      {needsMediaHeader(t) ? " (con encabezado — usa Marketing)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selected && (
            <div className="space-y-3 rounded-lg border border-card-border p-3">
              <p className="whitespace-pre-wrap text-sm text-foreground/90">{bodyText(selected)}</p>
              {variables.map((v, i) => (
                <Input
                  key={i}
                  placeholder={`Variable {{${i + 1}}}`}
                  value={v}
                  onChange={(e) =>
                    setVariables((prev) => prev.map((p, idx) => (idx === i ? e.target.value : p)))
                  }
                  data-testid={`input-template-variable-${i}`}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={sendTemplate.isPending}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSend}
            disabled={!selected || variables.some((v) => !v.trim()) || sendTemplate.isPending}
            data-testid="button-send-template"
          >
            {sendTemplate.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
