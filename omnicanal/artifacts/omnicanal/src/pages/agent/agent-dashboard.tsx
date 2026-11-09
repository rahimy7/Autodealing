import { useListConversations, type PresenceInputStatus } from "@workspace/api-client-react";
import { MessageSquare, CheckCircle2, Clock, Inbox, ArrowRight, Headphones } from "lucide-react";
import { Link } from "wouter";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import AgentLayout from "@/components/layout/AgentLayout";
import ContactAvatar from "@/components/ContactAvatar";
import { useAuth } from "@/lib/auth";
import { useMyPresence } from "@/lib/presence";
import { STATUS_DOTS, STATUS_LABELS } from "@/lib/agent-ui";
import { cn } from "@/lib/utils";

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  whatsapp: SiWhatsapp,
  instagram: SiInstagram,
  facebook: SiFacebook,
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "text-[#25D366]",
  instagram: "text-[#E1306C]",
  facebook: "text-[#1877F2]",
};

function timeAgo(date: string) {
  const d = new Date(date);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function AgentDashboard() {
  const { user } = useAuth();
  const agentId = user?.agentId;

  const { agent, status, setStatus } = useMyPresence();
  const { data: myConvs } = useListConversations({ agentId: agentId ?? undefined });

  const open = (myConvs ?? []).filter((c) => c.status === "open").length;
  const pending = (myConvs ?? []).filter((c) => c.status === "pending").length;
  const resolved = (myConvs ?? []).filter((c) => c.status === "resolved").length;
  const total = (myConvs ?? []).length;
  const recent = (myConvs ?? []).slice(0, 5);

  const stats = [
    { label: "Mis Chats Activos", value: open + pending, icon: Inbox, color: "from-primary to-cyan-400", bg: "bg-primary/10" },
    { label: "Resueltos Hoy", value: resolved, icon: CheckCircle2, color: "from-green-500 to-emerald-400", bg: "bg-green-500/10" },
    { label: "En Espera", value: pending, icon: Clock, color: "from-amber-500 to-orange-400", bg: "bg-amber-500/10" },
    { label: "Total Asignados", value: total, icon: MessageSquare, color: "from-purple-500 to-pink-400", bg: "bg-purple-500/10" },
  ];

  return (
    <AgentLayout>
      <div className="p-8 space-y-6">
        {/* Greeting header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Headphones className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-primary uppercase tracking-wide">Panel de agente</span>
            </div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              Hola, {user?.name.split(" ")[0]} 👋
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Aquí tienes un resumen de tus conversaciones de hoy
            </p>
          </div>
          <Link href="/agent/inbox" className="hidden sm:flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium shadow-md shadow-primary/20 transition-colors">
            Ir a mis chats <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="bg-card border border-card-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", bg)}>
                  <Icon className={cn("w-5 h-5 bg-gradient-to-br bg-clip-text text-transparent", color)} strokeWidth={2.5} />
                </div>
              </div>
              <div className="text-3xl font-bold text-foreground">{value}</div>
              <div className="text-xs text-muted-foreground mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* Recent conversations */}
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-card border border-card-border rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">Conversaciones Recientes</h2>
              <Link href="/agent/inbox" className="text-xs text-primary font-medium hover:underline">Ver todo →</Link>
            </div>
            {recent.length === 0 ? (
              <div className="py-12 text-center">
                <Inbox className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No tienes conversaciones asignadas</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recent.map((conv) => {
                  const Icon = CHANNEL_ICONS[conv.channel];
                  return (
                    <Link
                      key={conv.id}
                      href="/agent/inbox"
                      className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/40 transition-colors"
                      data-testid={`recent-conv-${conv.id}`}
                    >
                      <ContactAvatar
                        name={conv.contactName}
                        avatar={conv.contactAvatar}
                        className="w-10 h-10 bg-gradient-to-br from-muted to-muted/60 text-sm font-bold text-foreground"
                      >
                        {Icon && (
                          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-card flex items-center justify-center">
                            <Icon className={cn("w-3 h-3", CHANNEL_COLORS[conv.channel])} />
                          </div>
                        )}
                      </ContactAvatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-foreground truncate">{conv.contactName}</span>
                          <span className="text-[10px] text-muted-foreground">{timeAgo(conv.updatedAt)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{conv.lastMessage ?? "Sin mensajes"}</p>
                      </div>
                      {conv.unreadCount > 0 && (
                        <span className="w-5 h-5 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center">
                          {conv.unreadCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Performance card */}
          <div className="bg-gradient-to-br from-primary/10 via-accent/5 to-purple-500/10 border border-primary/20 rounded-2xl p-5 shadow-sm">
            <h2 className="text-base font-semibold text-foreground mb-4">Mi Desempeño</h2>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground">Tasa de resolución</span>
                  <span className="font-semibold text-foreground">
                    {total > 0 ? Math.round((resolved / total) * 100) : 0}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all"
                    style={{ width: `${total > 0 ? (resolved / total) * 100 : 0}%` }}
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-border/50">
                <div className="text-xs text-muted-foreground mb-2">Estado actual</div>
                <div className="flex items-center gap-2">
                  <div className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", STATUS_DOTS[status])} />
                  {/* Only the availability is a choice; "desconectado" belongs to
                      the session, so it is shown but never offered. */}
                  {status === "offline" ? (
                    <span className="text-sm font-medium text-foreground" data-testid="select-my-status">
                      {STATUS_LABELS.offline}
                    </span>
                  ) : (
                    <select
                      value={status}
                      onChange={(e) => void setStatus(e.target.value as PresenceInputStatus)}
                      className="text-sm font-medium text-foreground bg-transparent -ml-1 px-1 py-0.5 rounded cursor-pointer hover:bg-background/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      data-testid="select-my-status"
                    >
                      <option value="online">{STATUS_LABELS.online}</option>
                      <option value="busy">{STATUS_LABELS.busy}</option>
                    </select>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  {status === "offline"
                    ? "Reconectando… apareces en línea mientras tengas la sesión abierta."
                    : "Sigues en línea mientras tengas la sesión abierta; al cerrarla apareces desconectado."}
                </p>
              </div>

              <div className="pt-3 border-t border-border/50">
                <div className="text-xs text-muted-foreground mb-2">Canales asignados</div>
                <div className="flex items-center gap-2">
                  {(agent?.channels ?? []).map((ch: string) => {
                    const Icon = CHANNEL_ICONS[ch];
                    return Icon ? <Icon key={ch} className={cn("w-4 h-4", CHANNEL_COLORS[ch])} /> : null;
                  })}
                  {(agent?.channels ?? []).length === 0 && (
                    <span className="text-xs text-muted-foreground">Sin canales</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AgentLayout>
  );
}
