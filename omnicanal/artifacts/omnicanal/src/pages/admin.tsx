import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListAgents,
  useListViewAccess,
  useUpdateAgent,
  useDeleteAgent,
  getListAgentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { UserPlus, Shield, ShieldCheck, KeyRound, Trash2, Pencil, Circle, Power, PowerOff, Users, LayoutList } from "lucide-react";
import Layout from "@/components/layout/Layout";
import ContactAvatar from "@/components/ContactAvatar";
import { ViewAccessDialog, type ViewAccessTarget } from "@/components/admin/ViewAccessDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { STATUS_STYLES, STATUS_LABELS } from "@/lib/agent-ui";

export default function AdminPage() {
  const { user } = useAuth();
  const { data: agents, isLoading } = useListAgents();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [resetTarget, setResetTarget] = useState<{ id: number; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [accessTarget, setAccessTarget] = useState<ViewAccessTarget | null>(null);

  // Qué vistas tiene cada usuario (tabla view_access), independiente de su rol.
  const { data: access } = useListViewAccess();
  const viewsOf = (agentId: number) => access?.users.find((u) => u.agentId === agentId)?.views ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
  const humans = (agents ?? []).filter((a) => a.type === "human");
  const activeCount = humans.filter((a) => a.isActive).length;
  const dbAdminCount = humans.filter((a) => a.role === "admin").length;

  const toggleActive = (id: number, isActive: boolean) =>
    updateAgent.mutate({ id, data: { isActive: !isActive } }, { onSuccess: invalidate });
  const remove = (id: number) =>
    deleteAgent.mutate({ id }, { onSuccess: () => { invalidate(); toast({ title: "Usuario eliminado" }); } });

  const submitReset = () => {
    if (!resetTarget || newPassword.length < 8) {
      toast({ title: "La contraseña debe tener al menos 8 caracteres", variant: "destructive" });
      return;
    }
    updateAgent.mutate(
      { id: resetTarget.id, data: { password: newPassword } },
      { onSuccess: () => { setResetTarget(null); setNewPassword(""); toast({ title: "Contraseña actualizada" }); } },
    );
  };

  return (
    <Layout>
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" /> Administración
            </h1>
            <p className="text-sm text-muted-foreground">
              Gestiona los usuarios del sistema y las vistas que cada uno puede abrir, sea cual sea su rol.
            </p>
          </div>
          <Button onClick={() => setLocation("/agents/new?type=human&role=admin")} className="gap-2" data-testid="button-new-user">
            <UserPlus className="w-4 h-4" /> Nuevo administrador
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { label: "Usuarios", value: humans.length + 1, icon: Users, color: "text-primary", bg: "bg-primary/10" },
            { label: "Activos", value: activeCount + 1, icon: Circle, color: "text-green-600", bg: "bg-green-100" },
            { label: "Administradores", value: dbAdminCount + 1, icon: Shield, color: "text-amber-600", bg: "bg-amber-100" },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="bg-card border border-card-border rounded-2xl p-4 shadow-sm">
              <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center mb-3", bg)}><Icon className={cn("w-4 h-4", color)} strokeWidth={2.5} /></div>
              <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>

        {/* Users list */}
        <div className="space-y-2">
          {/* Admin account (read-only) */}
          <div className="bg-card border border-primary/30 rounded-xl p-4 flex items-center gap-3" data-testid="user-admin">
            <ContactAvatar
              name={user?.name}
              avatar={humans.find((a) => a.id === user?.agentId)?.avatar}
              className="w-10 h-10 bg-gradient-to-br from-primary to-accent text-sm font-bold text-primary-foreground"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground truncate">{user?.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
            </div>
            <span className="hidden sm:inline text-[10px] text-muted-foreground flex-shrink-0" title="Esta cuenta ve todo el panel y no se puede restringir">
              Todo el panel
            </span>
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-amber-500/15 text-amber-600 flex items-center gap-1 flex-shrink-0">
              <Shield className="w-3 h-3" /> Administrador
            </span>
          </div>

          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-card border border-card-border animate-pulse" />)
          ) : (
            humans.map((agent) => (
              <div key={agent.id} className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3" data-testid={`user-${agent.id}`}>
                <ContactAvatar name={agent.name} avatar={agent.avatar} className="w-10 h-10 bg-muted text-sm font-bold text-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground truncate flex items-center gap-2">
                    {agent.name}
                    <span className={cn("inline-flex items-center gap-1 text-[10px]", STATUS_STYLES[agent.status])}>
                      <Circle className="w-1.5 h-1.5 fill-current" /> {STATUS_LABELS[agent.status]}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{agent.email}</div>
                </div>
                <span
                  className={cn(
                    "hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full flex-shrink-0",
                    agent.role === "admin"
                      ? "bg-amber-500/15 text-amber-600"
                      : "bg-blue-500/15 text-blue-600",
                  )}
                >
                  {agent.role === "admin" ? (
                    <>
                      <Shield className="w-3 h-3" /> Administrador
                    </>
                  ) : (
                    "Agente"
                  )}
                </span>
                <span
                  className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full flex-shrink-0 bg-muted text-muted-foreground"
                  data-testid={`views-count-${agent.id}`}
                >
                  <LayoutList className="w-3 h-3" />
                  {access ? `${viewsOf(agent.id).length} ${viewsOf(agent.id).length === 1 ? "vista" : "vistas"}` : "…"}
                </span>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-primary" title="Elegir vistas" disabled={!access} onClick={() => setAccessTarget({ id: agent.id, name: agent.name, role: agent.role, views: viewsOf(agent.id) })} data-testid={`access-user-${agent.id}`}>
                    <LayoutList className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-primary" title="Editar" onClick={() => setLocation(`/agents/${agent.id}`)} data-testid={`edit-user-${agent.id}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-primary" title="Restablecer contraseña" onClick={() => { setNewPassword(""); setResetTarget({ id: agent.id, name: agent.name }); }} data-testid={`reset-user-${agent.id}`}>
                    <KeyRound className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className={cn("h-8 w-8 p-0", agent.isActive ? "text-green-600" : "text-muted-foreground")} title={agent.isActive ? "Desactivar" : "Activar"} onClick={() => toggleActive(agent.id, agent.isActive)} data-testid={`toggle-user-${agent.id}`}>
                    {agent.isActive ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" title="Eliminar" onClick={() => remove(agent.id)} data-testid={`delete-user-${agent.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
          {!isLoading && humans.length === 0 && (
            <div className="bg-card border border-card-border rounded-xl p-8 text-center text-sm text-muted-foreground">
              Aún no hay más usuarios. Crea el primer administrador con "Nuevo administrador".
            </div>
          )}
        </div>
      </div>

      <ViewAccessDialog target={accessTarget} onClose={() => setAccessTarget(null)} />

      {/* Reset password dialog */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary" /> Restablecer contraseña</DialogTitle>
            <DialogDescription>Nueva contraseña de acceso para <span className="font-medium text-foreground">{resetTarget?.name}</span>.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 8 caracteres" autoComplete="new-password" onKeyDown={(e) => e.key === "Enter" && submitReset()} data-testid="input-reset-password" />
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setResetTarget(null)}>Cancelar</Button>
              <Button className="flex-1" onClick={submitReset} disabled={updateAgent.isPending} data-testid="button-submit-reset">Guardar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
