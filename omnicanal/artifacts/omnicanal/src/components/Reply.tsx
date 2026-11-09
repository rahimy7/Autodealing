import { useEffect, useRef, useState } from "react";
import type { Message, MessageQuote } from "@workspace/api-client-react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Responder citando, como en WhatsApp: la cita va encima de la respuesta en el
// hilo y encima de la caja de texto mientras se escribe. Lo usan las tres
// bandejas que contestan (admin, agente y Chat General).

const SENDER_LABEL: Record<MessageQuote["sender"], string> = {
  contact: "Cliente",
  agent: "Agente",
  bot: "Bot IA",
};

// El color de la barra distingue de quién es lo citado, igual que WhatsApp pinta
// distinto al otro y a uno mismo.
const SENDER_TONE: Record<MessageQuote["sender"], string> = {
  contact: "border-[#06cf9c] [&_.quote-author]:text-[#06cf9c]",
  agent: "border-[#53bdeb] [&_.quote-author]:text-[#53bdeb]",
  bot: "border-primary [&_.quote-author]:text-primary",
};

export function QuotedMessage({
  quote,
  onClick,
  className,
}: {
  quote: Pick<MessageQuote, "sender" | "content">;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <span className="quote-author block text-[12px] font-semibold leading-tight">{SENDER_LABEL[quote.sender]}</span>
      <span className="line-clamp-2 text-[13px] leading-snug opacity-75">{quote.content}</span>
    </>
  );
  const classes = cn(
    "block w-full min-w-0 rounded-md border-l-4 bg-black/5 px-2 py-1 text-left",
    SENDER_TONE[quote.sender],
    className,
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(classes, "hover:bg-black/10")} title="Ir al mensaje citado">
      {body}
    </button>
  ) : (
    <div className={classes}>{body}</div>
  );
}

export function useReplyDraft(conversationId: number | null) {
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Una respuesta es de su conversación: al cambiar de chat no se arrastra.
  useEffect(() => setReplyTo(null), [conversationId]);

  const start = (msg: Message) => {
    setReplyTo(msg);
    // Elegir "Responder" deja el cursor listo para escribir.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return { replyTo, start, clear: () => setReplyTo(null), inputRef };
}

export function ReplyChip({ msg, onCancel, disabled }: { msg: Message; onCancel: () => void; disabled?: boolean }) {
  return (
    <div className="mb-2 flex items-stretch gap-2 rounded-lg bg-white p-1.5" data-testid="reply-chip">
      <QuotedMessage quote={msg} />
      <button
        type="button"
        onClick={onCancel}
        disabled={disabled}
        className="flex-shrink-0 self-center rounded-full p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
        aria-label="Cancelar respuesta"
        data-testid="button-cancel-reply"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
