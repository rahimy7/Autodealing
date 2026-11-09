import { Fragment, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEditMessage,
  useDeleteMessage,
  getListMessagesQueryKey,
  getListConversationsQueryKey,
  type Message,
} from "@workspace/api-client-react";
import { Bot, Ban, Pencil, Reply, Trash2, Check, X, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import MessageBody from "@/components/MessageBody";
import { QuotedMessage } from "@/components/Reply";
import { cn } from "@/lib/utils";

// El hilo de una conversación con la estética de WhatsApp: fondo beige, burbujas
// claras con pico, la hora dentro de la burbuja y un separador por día. Es la app
// que el equipo usa todo el día en su teléfono, y un chat que se lee igual no hay
// que aprender a leerlo. Lo comparten la bandeja del admin, la del agente, el chat
// general y la ficha del contacto. Los colores viven en index.css (.chat-*).

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return "Hoy";
  if (sameDay(date, yesterday)) return "Ayer";
  return date.toLocaleDateString("es-DO", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

export default function ChatMessages({
  messages,
  testIdPrefix = "message",
  // Muestra los controles de editar/eliminar al pasar el mouse por una burbuja.
  // false en la ficha del contacto: ahí el hilo es de solo lectura. Meta no deja
  // editar ni borrar un mensaje ya enviado, así que ambos cambian solo el panel
  // (el original sigue en la base); al editar, lo único que puede llegarle al
  // cliente es una corrección que cita el mensaje original.
  editable = false,
  // Responder citando un mensaje. Solo donde hay caja para escribir: la página
  // guarda a qué mensaje se responde y lo manda con el envío.
  onReply,
}: {
  messages: Message[];
  testIdPrefix?: string;
  editable?: boolean;
  onReply?: (msg: Message) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const editMessage = useEditMessage();
  const deleteMessage = useDeleteMessage();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [sendCorrection, setSendCorrection] = useState(true);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);

  // Tocar una cita lleva al mensaje citado y lo resalta un momento, como WhatsApp.
  const jumpTo = (id: number) => {
    const target = document.querySelector(`[data-message-id="${id}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightId(id);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightId(null), 1600);
  };

  const refresh = (conversationId: number) => {
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
  };

  const startEdit = (msg: Message) => {
    setEditingId(msg.id);
    setEditText(msg.content);
    setSendCorrection(true);
  };

  const saveEdit = (msg: Message) => {
    const content = editText.trim();
    if (!content || content === msg.content) {
      setEditingId(null);
      return;
    }
    editMessage.mutate(
      {
        conversationId: msg.conversationId,
        messageId: msg.id,
        data: { content, sendCorrection: msg.onChannel && sendCorrection },
      },
      {
        onSuccess: () => {
          setEditingId(null);
          refresh(msg.conversationId);
        },
        onError: (err: unknown) =>
          toast({
            title: "No se pudo editar el mensaje",
            description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
            variant: "destructive",
          }),
      },
    );
  };

  // Sin confirmación: la papelera borra al tocarla. Solo se oculta en el panel,
  // el texto original sigue en la base.
  const deleteMsg = (msg: Message) => {
    deleteMessage.mutate(
      { conversationId: msg.conversationId, messageId: msg.id },
      {
        onSuccess: () => refresh(msg.conversationId),
        onError: (err: unknown) => {
          toast({
            title: "No se pudo eliminar el mensaje",
            description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
            variant: "destructive",
          });
        },
      },
    );
  };

  let previous: Date | null = null;
  return (
    <>
      {messages.map((msg) => {
        const created = new Date(msg.createdAt);
        const newDay = !previous || !sameDay(previous, created);
        previous = created;
        const testId = `${testIdPrefix}-${msg.id}`;
        return (
          <Fragment key={msg.id}>
            {newDay && (
              <div className="flex justify-center py-1">
                <span className="chat-chip">{dayLabel(created)}</span>
              </div>
            )}
            {/* Routing, takeover and session-closure notes are panel-only audit
                trail: a centered notice, like WhatsApp's system messages. */}
            {msg.isInternal ? (
              <div className="flex justify-center" data-testid={testId}>
                <span className="chat-note">{msg.content}</span>
              </div>
            ) : (
              <Bubble
                msg={msg}
                testId={testId}
                editable={editable}
                isEditing={editingId === msg.id}
                editText={editText}
                sendCorrection={sendCorrection}
                savingEdit={editMessage.isPending && editingId === msg.id}
                onEditTextChange={setEditText}
                onSendCorrectionChange={setSendCorrection}
                onStartEdit={() => startEdit(msg)}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={() => saveEdit(msg)}
                onRequestDelete={() => deleteMsg(msg)}
                onReply={onReply ? () => onReply(msg) : undefined}
                onJumpToQuote={jumpTo}
                highlighted={highlightId === msg.id}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function Bubble({
  msg,
  testId,
  editable,
  isEditing,
  editText,
  sendCorrection,
  savingEdit,
  onEditTextChange,
  onSendCorrectionChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRequestDelete,
  onReply,
  onJumpToQuote,
  highlighted,
}: {
  msg: Message;
  testId: string;
  editable: boolean;
  isEditing: boolean;
  editText: string;
  sendCorrection: boolean;
  savingEdit: boolean;
  onEditTextChange: (value: string) => void;
  onSendCorrectionChange: (value: boolean) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onRequestDelete: () => void;
  onReply?: () => void;
  onJumpToQuote: (id: number) => void;
  highlighted: boolean;
}) {
  const outgoing = msg.sender !== "contact";
  const isBot = msg.sender === "bot";
  const tone = !outgoing ? "chat-bubble-in" : isBot ? "chat-bubble-bot" : "chat-bubble-out";

  // Solo lo que salió de nuestro lado. Lo del cliente sigue en su WhatsApp tal
  // cual, y reescribirlo u ocultarlo dejaría al equipo viendo otra conversación.
  const ours = msg.sender !== "contact";
  const canEdit = editable && ours && !msg.isDeleted && msg.type === "text";
  const canDelete = editable && ours && !msg.isDeleted;
  // Se cita cualquier mensaje, del cliente o nuestro, siempre que exista en el
  // canal: si no, el cliente no vería la cita.
  const canReply = !!onReply && !msg.isDeleted && msg.onChannel;
  const showActions = (canReply || canEdit || canDelete) && !isEditing;

  const actions = showActions && (
    <div
      className="flex items-start gap-0.5 pt-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
      data-testid={`${testId}-actions`}
    >
      {canReply && (
        <button
          type="button"
          onClick={onReply}
          className="p-1 rounded-full text-muted-foreground hover:bg-black/10 hover:text-foreground"
          title="Responder"
          aria-label="Responder"
          data-testid={`${testId}-button-reply`}
        >
          <Reply className="w-3 h-3" />
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={onStartEdit}
          className="p-1 rounded-full text-muted-foreground hover:bg-black/10 hover:text-foreground"
          title="Editar mensaje"
          aria-label="Editar mensaje"
          data-testid={`${testId}-button-edit`}
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={onRequestDelete}
          className="p-1 rounded-full text-muted-foreground hover:bg-black/10 hover:text-destructive"
          title="Eliminar mensaje"
          aria-label="Eliminar mensaje"
          data-testid={`${testId}-button-delete`}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );

  return (
    <div
      className={cn("flex group items-start gap-1", outgoing ? "justify-end" : "justify-start")}
      data-testid={testId}
      data-message-id={msg.id}
    >
      {outgoing && actions}
      <div
        className={cn(
          "chat-bubble relative max-w-[85%] md:max-w-md transition-shadow duration-500",
          tone,
          outgoing ? "rounded-tr-none" : "rounded-tl-none",
          highlighted && "ring-2 ring-primary/60",
        )}
      >
        {/* El pico de la burbuja, del lado de quien habla. */}
        <svg
          viewBox="0 0 8 13"
          aria-hidden="true"
          className={cn("chat-bubble-tail absolute top-0 h-[13px] w-2", outgoing ? "-right-2" : "-left-2 -scale-x-100")}
        >
          <path d="M0 0h8L0 13z" fill="currentColor" />
        </svg>
        {isBot && !msg.isDeleted && (
          <div className="chat-bot-label">
            <Bot className="w-3 h-3" /> Bot IA
          </div>
        )}
        {msg.replyTo && !msg.isDeleted && (
          <QuotedMessage
            quote={msg.replyTo}
            onClick={() => onJumpToQuote(msg.replyTo!.id)}
            className="mb-1"
          />
        )}
        {isEditing ? (
          <div className="min-w-[260px]">
            <textarea
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSaveEdit();
                } else if (e.key === "Escape") {
                  onCancelEdit();
                }
              }}
              rows={2}
              autoFocus
              disabled={savingEdit}
              className="w-full resize-none rounded-md border border-black/10 bg-white/70 p-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
              data-testid={`${testId}-edit-textarea`}
            />
            <div className="mt-1 flex items-center justify-end gap-1">
              {/* Meta no edita mensajes enviados: esto le manda al cliente un
                  mensaje nuevo que cita al original. Sin id de canal (nunca salió
                  por Meta) no hay nada que citar. */}
              {msg.onChannel && (
                <label
                  className="mr-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
                  title="Le llega al cliente como respuesta al mensaje original: «✏️ Corrección: …»"
                >
                  <input
                    type="checkbox"
                    checked={sendCorrection}
                    onChange={(e) => onSendCorrectionChange(e.target.checked)}
                    disabled={savingEdit}
                    className="h-3 w-3 accent-primary"
                    data-testid={`${testId}-checkbox-send-correction`}
                  />
                  Enviar corrección al cliente
                </label>
              )}
              <button
                type="button"
                onClick={onCancelEdit}
                disabled={savingEdit}
                className="p-1 rounded-full hover:bg-black/10 disabled:opacity-40"
                title="Cancelar"
                aria-label="Cancelar edición"
                data-testid={`${testId}-button-cancel-edit`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onSaveEdit}
                disabled={savingEdit || !editText.trim()}
                className="p-1 rounded-full hover:bg-black/10 disabled:opacity-40"
                title="Guardar"
                aria-label="Guardar edición"
                data-testid={`${testId}-button-save-edit`}
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : msg.isDeleted ? (
          <p className="flex items-center gap-1.5 italic opacity-60">
            <Ban className="w-3.5 h-3.5 flex-shrink-0" /> Este mensaje fue eliminado
          </p>
        ) : (
          <MessageBody msg={msg} />
        )}
        <div className="chat-meta flex items-center justify-end gap-1">
          {msg.isEdited && !msg.isDeleted && !isEditing && <span className="italic">editado</span>}
          {created(msg)}
          {outgoing && msg.status === "failed" && !msg.isDeleted && (
            <span
              role="img"
              aria-label="No le llegó al cliente"
              title={msg.failedReason ? `No le llegó al cliente: ${msg.failedReason}` : "No le llegó al cliente"}
              data-testid={`${testId}-icon-failed`}
            >
              <AlertCircle className="h-3.5 w-3.5 text-red-500" />
            </span>
          )}
        </div>
      </div>
      {!outgoing && actions}
    </div>
  );
}

function created(msg: Message): string {
  return new Date(msg.createdAt).toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" });
}
