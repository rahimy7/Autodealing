import { Link, useLocation } from "wouter";
import { Zap, LogOut, Shield, User as UserIcon, EyeOff, ChevronsUpDown } from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import { useGetPlan, getGetPlanQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useNavEntries } from "@/lib/views";
import { useClient, usePlatform } from "@/lib/platform";
import { endServerSession, useMyPresence } from "@/lib/presence";
import { setIncognito, useIncognito } from "@/lib/incognito";
import NotificationBell from "@/components/NotificationBell";
import ContactAvatar from "@/components/ContactAvatar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { withBase } from "@/lib/base-path";

// Cuadro de nivel de uso del plan: oculto temporalmente mientras se ajusta el
// modelo de uso. Poner en true para volver a mostrarlo.
const SHOW_PLAN_USAGE = false;

const CHANNEL_ICONS = {
  whatsapp: { Icon: SiWhatsapp, color: "#25D366" },
  instagram: { Icon: SiInstagram, color: "#E1306C" },
  facebook: { Icon: SiFacebook, color: "#1877F2" },
} as const;

// Inner content, shared by the desktop aside and the mobile drawer.
export function SidebarInner({ onNavigate }: { onNavigate?: () => void }) {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  // El plan solo se pide si se va a mostrar: es una vista de Dashboard y
  // Configuración, y quien no las tenga recibiría un 403 en cada pantalla.
  const { data: plan } = useGetPlan({ query: { queryKey: getGetPlanQueryKey(), enabled: SHOW_PLAN_USAGE } });
  const { branding } = useClient();
  const { channels } = usePlatform();
  // La fila de agente trae la foto; el administrador de entorno no tiene fila y
  // se queda con la inicial.
  const { agent } = useMyPresence();
  const incognito = useIncognito();

  // Las vistas que le asignaron y que esta instancia tiene (ver lib/views.tsx).
  const visibleNavItems = useNavEntries();
  const isAdminRole = user?.role === "admin";

  const handleLogout = async () => {
    await endServerSession();
    logout();
    setLocation("/login");
    onNavigate?.();
  };

  const toggleIncognito = (next: boolean) => {
    setIncognito(next);
    toast({
      title: next ? "Modo incógnito activado" : "Modo incógnito desactivado",
      description: next
        ? "Los chats, correos y comentarios que abras seguirán como no leídos."
        : "Abrir una conversación vuelve a marcarla como leída.",
    });
  };

  const pct = plan && plan.messagesLimit > 0 ? Math.min(100, Math.round((plan.messagesUsed / plan.messagesLimit) * 100)) : 0;

  return (
    <div className="w-full h-full flex flex-col bg-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
        <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center overflow-hidden">
          {branding.logoUrl ? (
            <img src={withBase(branding.logoUrl)} alt={branding.productName} className="w-full h-full object-contain" />
          ) : (
            <Zap className="w-4 h-4 text-sidebar-primary-foreground" strokeWidth={2.5} />
          )}
        </div>
        <div>
          <div className="text-sm font-bold text-sidebar-foreground tracking-tight">{branding.productName}</div>
          <div className="text-xs text-sidebar-foreground/50">{branding.tagline}</div>
        </div>
      </div>

      {/* Channels pill — refleja los canales que esta instancia tiene contratados */}
      {channels.length > 0 && (
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sidebar-accent/50 border border-sidebar-border">
            <div className="flex items-center gap-1.5">
              {channels.map((channel) => {
                const { Icon, color } = CHANNEL_ICONS[channel];
                return <Icon key={channel} className="w-3.5 h-3.5" style={{ color }} />;
              })}
            </div>
            <span className="text-xs text-sidebar-foreground/60 font-medium">
              {channels.length} {channels.length === 1 ? "canal activo" : "canales activos"}
            </span>
            <div className="ml-auto w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {visibleNavItems.map(({ href, icon: Icon, label }) => {
          const isActive = location === href || (href !== "/" && location.startsWith(href));
          return (
            <Link key={href} href={href}
              onClick={() => onNavigate?.()}
              data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-sidebar-primary/15 text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <Icon className={cn("w-4 h-4 flex-shrink-0", isActive ? "text-sidebar-primary" : "")} />
              {label}
              {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-sidebar-primary" />}
            </Link>
          );
        })}
      </nav>

      {/* Plan + user */}
      <div className="px-4 pb-3 pt-3 border-t border-sidebar-border space-y-2">
        {SHOW_PLAN_USAGE && (
        <div className="rounded-lg bg-sidebar-primary/10 border border-sidebar-primary/20 p-3" data-testid="sidebar-plan">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-sidebar-primary">{plan?.planName ?? "Plan Activo"}</span>
            <span className="text-xs text-sidebar-foreground/50">${plan?.monthlyPrice ?? "—"}/mes</span>
          </div>
          <div className="text-xs text-sidebar-foreground/60">
            Bot 24/7 · {plan?.agentsUsed ?? 0}/{plan?.agentsLimit ?? 0} agentes
          </div>
          <div className="mt-2 h-1 rounded-full bg-sidebar-accent">
            <div className="h-full rounded-full bg-sidebar-primary/70 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[10px] text-sidebar-foreground/40 tabular-nums">
            {plan ? `${plan.messagesUsed.toLocaleString()} / ${plan.messagesLimit.toLocaleString()} mensajes este mes` : "Cargando uso…"}
          </div>
        </div>
        )}

        {user && (
          <div className="flex items-center gap-1 p-1 rounded-lg bg-sidebar-accent/40">
            {/* La tarjeta entera abre las opciones de la cuenta. La campana queda
                fuera: es su propio botón y no puede ir dentro de otro. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex-1 min-w-0 flex items-center gap-2 p-1 rounded-md text-left transition-colors outline-none hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  title="Opciones de la cuenta"
                  data-testid="button-admin-menu"
                >
                  <ContactAvatar
                    name={user.name}
                    avatar={agent?.avatar}
                    className="w-8 h-8 bg-gradient-to-br from-primary to-accent text-xs font-bold text-primary-foreground"
                  >
                    {incognito && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-sidebar border border-sidebar-border flex items-center justify-center">
                        <EyeOff className="w-2 h-2 text-amber-500" />
                      </span>
                    )}
                  </ContactAvatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-sidebar-foreground truncate">{user.name}</div>
                    {/* Mientras esté activo se ve aquí, para que nadie lo deje
                        encendido sin darse cuenta y llene la bandeja de no leídos. */}
                    {incognito ? (
                      <div className="flex items-center gap-1 text-[10px] font-medium text-amber-500" data-testid="sidebar-incognito">
                        <EyeOff className="w-2.5 h-2.5" /> Modo incógnito
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-[10px] text-sidebar-foreground/60">
                        {isAdminRole ? <Shield className="w-2.5 h-2.5" /> : <UserIcon className="w-2.5 h-2.5" />}
                        {isAdminRole ? "Administrador" : "Agente"}
                      </div>
                    )}
                  </div>
                  <ChevronsUpDown className="w-3.5 h-3.5 flex-shrink-0 text-sidebar-foreground/40" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-xs font-semibold truncate">{user.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {/* El modo incógnito es de la supervisión: solo existe para el rol
                    administrador (lib/incognito.ts), así que a un agente no se le
                    ofrece un interruptor que no hace nada. */}
                {isAdminRole && (
                  <>
                    <DropdownMenuCheckboxItem
                      checked={incognito}
                      onCheckedChange={(checked) => toggleIncognito(checked === true)}
                      data-testid="menu-incognito"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <EyeOff className="w-3.5 h-3.5" /> Modo incógnito
                        </div>
                        <div className="text-[11px] text-muted-foreground">Leer sin marcar como leído</div>
                      </div>
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  onSelect={() => void handleLogout()}
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                  data-testid="button-admin-logout"
                >
                  <LogOut /> Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <NotificationBell />
          </div>
        )}
      </div>
    </div>
  );
}

// Desktop-only fixed sidebar.
export default function Sidebar() {
  return (
    <aside className="hidden md:flex w-64 flex-shrink-0 h-screen flex-col border-r border-sidebar-border">
      <SidebarInner />
    </aside>
  );
}
