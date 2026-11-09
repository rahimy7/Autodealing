import { useState } from "react";
import { useListConversations, useChangePassword } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Mail, MessageSquare, CheckCircle2, Clock, Award, MessagesSquare, ArrowRight, Eye, HandGrab, KeyRound, Loader2, Check } from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook, SiGmail } from "react-icons/si";
import AgentLayout from "@/components/layout/AgentLayout";
import ContactAvatar from "@/components/ContactAvatar";
import { useAuth } from "@/lib/auth";
import { useMyPresence } from "@/lib/presence";
import { STATUS_DOTS, STATUS_LABELS } from "@/lib/agent-ui";
import { useClient } from "@/lib/platform";
import { cn } from "@/lib/utils";

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  whatsapp: SiWhatsapp,
  instagram: SiInstagram,
  facebook: SiFacebook,
  email: SiGmail,
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "text-[#25D366]",
  instagram: "text-[#E1306C]",
  facebook: "text-[#1877F2]",
  email: "text-[#EA4335]",
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "Correo",
};

const MIN_PASSWORD_LENGTH = 8;

function ChangePasswordCard() {
  const changePassword = useChangePassword();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setError(null);
    setDone(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (form.newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError("La confirmación no coincide con la nueva contraseña.");
      return;
    }

    try {
      await changePassword.mutateAsync({
        data: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      });
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setDone(true);
    } catch (err) {
      const apiMessage = (err as { data?: { error?: string } }).data?.error;
      setError(apiMessage ?? "No se pudo cambiar la contraseña. Intenta de nuevo.");
    }
  };

  const inputClass =
    "w-full px-3 py-2.5 text-sm bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

  return (
    <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-start gap-4 mb-4">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <KeyRound className="w-5 h-5 text-primary" strokeWidth={2.5} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Cambiar contraseña</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Usa al menos {MIN_PASSWORD_LENGTH} caracteres. Tu sesión actual seguirá activa.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1.5">Contraseña actual</label>
          <input
            type="password"
            value={form.currentPassword}
            onChange={set("currentPassword")}
            className={inputClass}
            placeholder="••••••••"
            autoComplete="current-password"
            data-testid="input-current-password"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1.5">Nueva contraseña</label>
          <input
            type="password"
            value={form.newPassword}
            onChange={set("newPassword")}
            className={inputClass}
            placeholder="••••••••"
            autoComplete="new-password"
            data-testid="input-new-password"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1.5">Confirmar nueva contraseña</label>
          <input
            type="password"
            value={form.confirmPassword}
            onChange={set("confirmPassword")}
            className={inputClass}
            placeholder="••••••••"
            autoComplete="new-password"
            data-testid="input-confirm-password"
            required
          />
        </div>

        {error && (
          <div
            className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2"
            data-testid="change-password-error"
          >
            {error}
          </div>
        )}

        {done && (
          <div
            className="flex items-center gap-1.5 text-xs text-green-700 bg-green-100 border border-green-200 rounded-lg px-3 py-2"
            data-testid="change-password-success"
          >
            <Check className="w-3.5 h-3.5" /> Contraseña actualizada. Úsala la próxima vez que inicies sesión.
          </div>
        )}

        <button
          type="submit"
          disabled={changePassword.isPending}
          className={cn(
            "flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium text-sm transition-colors shadow-md shadow-primary/20",
            changePassword.isPending && "opacity-60",
          )}
          data-testid="button-change-password"
        >
          {changePassword.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Guardando…
            </>
          ) : (
            "Actualizar contraseña"
          )}
        </button>
      </form>
    </div>
  );
}

export default function AgentProfile() {
  const { user } = useAuth();
  const agentId = user?.agentId;
  const { business } = useClient();

  const { agent, status } = useMyPresence();
  const { data: convs } = useListConversations({ agentId: agentId ?? undefined });
  const { data: allConvs } = useListConversations();

  const teamTotal = (allConvs ?? []).length;
  const teamUnassigned = (allConvs ?? []).filter((c) => !c.agentId).length;

  const total = (convs ?? []).length;
  const resolved = (convs ?? []).filter((c) => c.status === "resolved").length;
  const open = (convs ?? []).filter((c) => c.status === "open" || c.status === "pending").length;
  const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

  return (
    <AgentLayout>
      <div className="p-8 max-w-4xl mx-auto space-y-6">
        {/* Profile header */}
        <div className="bg-gradient-to-br from-primary/10 via-accent/5 to-purple-500/10 border border-primary/20 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-5">
            <ContactAvatar
              name={user?.name}
              avatar={agent?.avatar}
              className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-accent text-3xl font-bold text-primary-foreground shadow-lg shadow-primary/30"
            />
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-foreground tracking-tight">{user?.name}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                <Mail className="w-4 h-4" /> {user?.email}
              </div>
              <div className="flex items-center gap-3 mt-3">
                <span className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full",
                  status === "online" ? "bg-green-100 text-green-700" :
                  status === "busy" ? "bg-amber-100 text-amber-700" :
                  "bg-gray-100 text-gray-700",
                )}>
                  <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOTS[status])} />
                  {STATUS_LABELS[status]}
                </span>
                <span className="text-xs text-muted-foreground">Agente de atención al cliente</span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Asignados", value: total, icon: MessageSquare, color: "text-primary", bg: "bg-primary/10" },
            { label: "Activos", value: open, icon: Clock, color: "text-amber-600", bg: "bg-amber-100" },
            { label: "Resueltos", value: resolved, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-100" },
            { label: "Tasa Resolución", value: `${resolutionRate}%`, icon: Award, color: "text-purple-600", bg: "bg-purple-100" },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="bg-card border border-card-border rounded-2xl p-4 shadow-sm">
              <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center mb-3", bg)}>
                <Icon className={cn("w-4 h-4", color)} strokeWidth={2.5} />
              </div>
              <div className="text-2xl font-bold text-foreground">{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* General chat panel access */}
        <Link
          href="/agent/chats"
          className="block bg-card border border-card-border rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-primary/40 transition-all group"
          data-testid="link-agent-chats-panel"
        >
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <MessagesSquare className="w-5 h-5 text-primary" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">Chat General</h2>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  <Eye className="w-2.5 h-2.5" /> Solo lectura
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Consulta todas las conversaciones del equipo y toma cualquiera que necesites atender.
              </p>
              <div className="flex items-center gap-4 mt-3 text-xs">
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{teamTotal}</strong> conversaciones
                </span>
                <span className="text-muted-foreground">
                  <strong className="text-orange-600">{teamUnassigned}</strong> sin asignar
                </span>
                <span className="flex items-center gap-1 text-primary font-medium">
                  <HandGrab className="w-3 h-3" /> Tomar chat
                </span>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-1" />
          </div>
        </Link>

        {/* Channels */}
        <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-foreground mb-4">Canales asignados</h2>
          {(agent?.channels ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No tienes canales asignados todavía</p>
          ) : (
            <div className="grid sm:grid-cols-3 gap-3">
              {(agent?.channels ?? []).map((ch: string) => {
                const Icon = CHANNEL_ICONS[ch];
                return (
                  <div key={ch} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/20">
                    {Icon && <Icon className={cn("w-6 h-6", CHANNEL_COLORS[ch])} />}
                    <div>
                      <div className="text-sm font-semibold text-foreground">{CHANNEL_LABELS[ch]}</div>
                      <div className="text-[11px] text-muted-foreground">Activo</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Security */}
        <ChangePasswordCard />

        {/* Info note */}
        <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-foreground mb-3">Información de cuenta</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground">Rol</span>
              <span className="font-medium text-foreground">Agente de atención</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground">Empresa</span>
              <span className="font-medium text-foreground">{business.displayName}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground">Soporte técnico</span>
              <span className="font-medium text-foreground">RVR Service</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">ID de agente</span>
              <span className="font-mono text-foreground">#{agentId}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4 italic">
            Puedes cambiar tu contraseña desde esta página y tu disponibilidad desde Mi Panel. Para
            modificar el resto de tu información, contacta al administrador.
          </p>
        </div>
      </div>
    </AgentLayout>
  );
}
