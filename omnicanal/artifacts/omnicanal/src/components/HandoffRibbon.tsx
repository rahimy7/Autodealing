import { useLocation } from "wouter";
import { ArrowLeftRight, X } from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import { chatInboxPath, useAuth } from "@/lib/auth";
import { useHandoffs, dismissHandoff, dismissAllHandoffs, type Handoff } from "@/lib/handoffs";
import { cn } from "@/lib/utils";

/**
 * The ribbon that announces a chat handed to the signed-in user. It sits above
 * every screen of the panel and stays there until the chat is opened or the
 * ribbon is closed — a transfer is not something to find out about later.
 *
 * Only the two most recent are shown as rows; anything beyond that is a count,
 * because a wall of ribbons would push the panel off the screen.
 */

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  WhatsApp: SiWhatsapp,
  Instagram: SiInstagram,
  Facebook: SiFacebook,
};

const CHANNEL_COLORS: Record<string, string> = {
  WhatsApp: "text-[#25D366]",
  Instagram: "text-[#E1306C]",
  Facebook: "text-[#1877F2]",
};

const VISIBLE = 2;

function HandoffRow({ handoff, onOpen }: { handoff: Handoff; onOpen: (h: Handoff) => void }) {
  const Icon = CHANNEL_ICONS[handoff.channel];

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5"
      data-testid={`handoff-${handoff.conversationId}`}
    >
      <span className="relative flex w-8 h-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/20">
        <span className="absolute inset-0 rounded-full bg-amber-500/30 animate-ping" />
        <ArrowLeftRight className="relative w-4 h-4 text-amber-600 dark:text-amber-400" strokeWidth={2.5} />
      </span>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">{handoff.title}</div>
        <div className="flex items-center gap-1.5 text-xs text-amber-800/80 dark:text-amber-200/80 truncate">
          {Icon && <Icon className={cn("w-3 h-3 flex-shrink-0", CHANNEL_COLORS[handoff.channel])} />}
          <span className="truncate">
            {handoff.contactName} · {handoff.channel}
          </span>
        </div>
      </div>

      <button
        onClick={() => onOpen(handoff)}
        className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold shadow-sm transition-colors"
        data-testid={`button-open-handoff-${handoff.conversationId}`}
      >
        Abrir chat
      </button>
      <button
        onClick={() => dismissHandoff(handoff.conversationId)}
        aria-label="Descartar aviso"
        title="Descartar aviso"
        className="flex-shrink-0 p-1.5 rounded-md text-amber-800/60 hover:text-amber-900 hover:bg-amber-500/10 dark:text-amber-200/60 dark:hover:text-amber-100 transition-colors"
        data-testid={`button-dismiss-handoff-${handoff.conversationId}`}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function HandoffRibbon() {
  const handoffs = useHandoffs();
  const { user, views } = useAuth();
  const [, setLocation] = useLocation();

  if (handoffs.length === 0) return null;

  // El agente de servicio contesta desde el Chat General; un supervisor, desde la
  // bandeja del panel. Con las vistas sueltas, quien no tenga una usa la otra.
  const inboxPath = chatInboxPath(user?.role ?? "agent", views);
  const open = (handoff: Handoff) => {
    dismissHandoff(handoff.conversationId);
    setLocation(`${inboxPath}?conv=${handoff.conversationId}`);
  };

  const shown = handoffs.slice(0, VISIBLE);
  const extra = handoffs.length - shown.length;

  return (
    <div
      className="flex-shrink-0 border-b border-amber-500/30 bg-gradient-to-r from-amber-500/15 via-amber-400/10 to-transparent divide-y divide-amber-500/20 animate-in slide-in-from-top-2 duration-300"
      role="status"
      aria-live="polite"
      data-testid="handoff-ribbon"
    >
      {shown.map((handoff) => (
        <HandoffRow key={handoff.conversationId} handoff={handoff} onOpen={open} />
      ))}
      {extra > 0 && (
        <div className="flex items-center justify-between px-4 py-1.5 text-xs text-amber-800/80 dark:text-amber-200/80">
          <button
            onClick={() => setLocation(inboxPath)}
            className="font-medium hover:underline"
            data-testid="button-see-all-handoffs"
          >
            y {extra} chat{extra === 1 ? "" : "s"} más en espera →
          </button>
          <button
            onClick={dismissAllHandoffs}
            className="font-medium hover:underline"
            data-testid="button-dismiss-all-handoffs"
          >
            Descartar todo
          </button>
        </div>
      )}
    </div>
  );
}
