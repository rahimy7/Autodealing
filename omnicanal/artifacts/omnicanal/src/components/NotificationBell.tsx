import { Bell, BellOff } from "lucide-react";
import { useNotificationPreference } from "@/lib/notifications";
import { cn } from "@/lib/utils";

/**
 * Turns desk alerts on and off. Enabling is also the click browsers require
 * before they will grant notification permission or let a page play a sound, so
 * everything is asked for here rather than behind the user's back on load.
 */
export default function NotificationBell({ className }: { className?: string }) {
  const { enabled, permission, toggle } = useNotificationPreference();

  if (permission === "unsupported") return null;

  const label = !enabled
    ? "Avisos de chats desactivados"
    : permission === "granted"
      ? "Avisos de chats activados"
      : "Avisos activados — el navegador bloqueó las notificaciones del sistema, así que suenan dentro de la app";

  return (
    <button
      onClick={() => void toggle()}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      data-testid="button-notifications"
      className={cn(
        "relative p-1.5 rounded-md transition-colors",
        enabled
          ? "text-sidebar-primary hover:bg-sidebar-primary/10"
          : "text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        className,
      )}
    >
      {enabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
      {enabled && permission !== "granted" && (
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
      )}
    </button>
  );
}
