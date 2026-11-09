import { useState } from "react";
import { Link, useLocation } from "wouter";
import { LogOut, Zap, Circle, Menu } from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import { useAuth } from "@/lib/auth";
import { useNavEntries } from "@/lib/views";
import { useClient, usePlatform } from "@/lib/platform";
import { endServerSession, useMyPresence, usePresenceHeartbeat } from "@/lib/presence";
import { STATUS_LABELS, STATUS_STYLES } from "@/lib/agent-ui";
import { useChatNotifications } from "@/lib/notifications";
import NotificationBell from "@/components/NotificationBell";
import ContactAvatar from "@/components/ContactAvatar";
import HandoffRibbon from "@/components/HandoffRibbon";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const CHANNEL_ICONS = {
  whatsapp: { Icon: SiWhatsapp, color: "#25D366" },
  instagram: { Icon: SiInstagram, color: "#E1306C" },
  facebook: { Icon: SiFacebook, color: "#1877F2" },
} as const;

function AgentSidebarInner({ onNavigate }: { onNavigate?: () => void }) {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { branding } = useClient();
  const { channels } = usePlatform();
  // El menú del agente es el mismo catálogo de vistas que el del administrador:
  // quien solo atiende ve Mis Chats, Chat General y Mi Perfil porque esas son las
  // vistas que tiene, y si se le asigna otra (Pedidos, Casos…) aparece aquí también.
  const visibleNavItems = useNavEntries();
  const { status, agent } = useMyPresence();
  const handleLogout = async () => {
    await endServerSession();
    logout();
    setLocation("/login");
    onNavigate?.();
  };

  return (
    <div className="w-full h-full flex flex-col bg-sidebar">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
        <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
          <Zap className="w-4 h-4 text-sidebar-primary-foreground" strokeWidth={2.5} />
        </div>
        <div>
          <div className="text-sm font-bold text-sidebar-foreground tracking-tight">{branding.productName}</div>
          <div className="text-xs text-sidebar-foreground/50">Panel de Agente</div>
        </div>
      </div>

      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/20">
          <ContactAvatar
            name={user?.name}
            avatar={agent?.avatar}
            className="w-9 h-9 bg-gradient-to-br from-primary to-accent text-xs font-bold text-primary-foreground"
          />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-sidebar-foreground truncate">{user?.name}</div>
            <div className={cn("flex items-center gap-1 text-[10px] font-medium", STATUS_STYLES[status])} data-testid="sidebar-agent-status">
              <Circle className="w-1.5 h-1.5 fill-current" /> {STATUS_LABELS[status]}
            </div>
          </div>
          <NotificationBell />
        </div>
      </div>

      {channels.length > 0 && (
        <div className="px-4 pt-2 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sidebar-accent/50 border border-sidebar-border">
            <div className="flex items-center gap-1.5">
              {channels.map((channel) => {
                const { Icon, color } = CHANNEL_ICONS[channel];
                return <Icon key={channel} className="w-3.5 h-3.5" style={{ color }} />;
              })}
            </div>
            <span className="text-xs text-sidebar-foreground/60 font-medium">
              {channels.length} {channels.length === 1 ? "canal" : "canales"}
            </span>
            <div className="ml-auto w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          </div>
        </div>
      )}

      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {visibleNavItems.map(({ href, icon: Icon, label }) => {
          const isActive = location === href || (href !== "/" && location.startsWith(href));
          return (
            <Link key={href} href={href}
              onClick={() => onNavigate?.()}
              data-testid={`nav-agent-${label.toLowerCase().replace(/\s+/g, "-")}`}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                isActive ? "bg-sidebar-primary/15 text-sidebar-primary" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <Icon className={cn("w-4 h-4 flex-shrink-0", isActive ? "text-sidebar-primary" : "")} />
              {label}
              {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-sidebar-primary" />}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 pb-5 pt-3 border-t border-sidebar-border">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-destructive/10 hover:text-destructive transition-colors"
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4" /> Cerrar sesión
        </button>
      </div>
    </div>
  );
}

interface AgentLayoutProps {
  children: React.ReactNode;
}

export default function AgentLayout({ children }: AgentLayoutProps) {
  const [open, setOpen] = useState(false);
  const { branding } = useClient();
  // Every screen of the panel is inside this layout, so the agent counts as
  // connected — and gets alerted about their chats — from wherever they are.
  usePresenceHeartbeat();
  useChatNotifications();
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden md:flex w-64 flex-shrink-0 h-screen flex-col border-r border-sidebar-border">
        <AgentSidebarInner />
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        {/* Fondo y texto del menú, como la barra lateral (ver Layout.tsx). */}
        <header className="md:hidden flex items-center gap-3 px-4 h-14 border-b border-sidebar-border bg-sidebar text-sidebar-foreground flex-shrink-0">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button className="p-2 -ml-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent" data-testid="button-open-sidebar" aria-label="Abrir menú">
                <Menu className="w-5 h-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-64 border-sidebar-border [&>button]:hidden">
              <AgentSidebarInner onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-sidebar-primary-foreground" strokeWidth={2.5} />
            </div>
            <span className="text-sm font-bold text-sidebar-foreground truncate">{branding.productName}</span>
          </div>
        </header>
        {/* Above the scroll area, so a transfer stays in sight no matter how far
            down the agent has scrolled. */}
        <HandoffRibbon />
        <main className="flex-1 overflow-y-auto min-h-0">{children}</main>
      </div>
    </div>
  );
}
