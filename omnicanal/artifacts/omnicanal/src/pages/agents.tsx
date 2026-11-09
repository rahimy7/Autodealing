import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListAgents,
  useDeleteAgent,
  useUpdateAgent,
  getListAgentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus, UserCog, Trash2, Circle, MessageSquare, Mail, Bot, Sparkles,
  ArrowRightCircle, Power, PowerOff, Pencil,
} from "lucide-react";
import Layout from "@/components/layout/Layout";
import ContactAvatar from "@/components/ContactAvatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { STATUS_STYLES, STATUS_LABELS, CHANNEL_ICONS, CHANNEL_COLORS, profileTemplate } from "@/lib/agent-ui";
import GroupsPanel from "@/components/agents/GroupsPanel";
import KnowledgePanel from "@/components/agents/KnowledgePanel";

export default function AgentsPage() {
  const [filterTab, setFilterTab] = useState<"all" | "human" | "virtual">("all");
  const { data: agents, isLoading } = useListAgents();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });

  const allAgents = agents ?? [];
  const humans = allAgents.filter((a) => a.type === "human");
  const virtuals = allAgents.filter((a) => a.type === "virtual");
  const filtered = filterTab === "human" ? humans : filterTab === "virtual" ? virtuals : allAgents;
  const onlineCount = humans.filter((a) => a.status === "online").length;
  const activeVirtuals = virtuals.filter((a) => a.isActive).length;

  const toggleActive = (id: number, isActive: boolean) =>
    updateAgent.mutate({ id, data: { isActive: !isActive } }, { onSuccess: invalidate });
  const remove = (id: number) =>
    deleteAgent.mutate({ id }, { onSuccess: () => { invalidate(); toast({ title: "Agente eliminado" }); } });

  return (
    <Layout>
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">Agentes</h1>
            <p className="text-sm text-muted-foreground">Equipo humano, agentes virtuales IA, grupos y base de conocimiento</p>
          </div>
        </div>

        <Tabs defaultValue="agents">
          <TabsList>
            <TabsTrigger value="agents" data-testid="tab-agents">Agentes</TabsTrigger>
            <TabsTrigger value="groups" data-testid="tab-groups">Grupos</TabsTrigger>
            <TabsTrigger value="knowledge" data-testid="tab-knowledge">Conocimiento</TabsTrigger>
          </TabsList>

          {/* ── Agents tab ── */}
          <TabsContent value="agents" className="space-y-6">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setLocation("/agents/new?type=human")} className="gap-2" data-testid="button-new-human-agent">
                <UserCog className="w-4 h-4" /> Agente Humano
              </Button>
              <Button onClick={() => setLocation("/agents/new?type=virtual")} className="gap-2 bg-gradient-to-r from-primary to-accent hover:opacity-90" data-testid="button-new-virtual-agent">
                <Sparkles className="w-4 h-4" /> Agente Virtual IA
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Agentes humanos", value: humans.length, sub: `${onlineCount} en línea`, icon: UserCog, color: "text-primary", bg: "bg-primary/10" },
                { label: "Agentes virtuales IA", value: virtuals.length, sub: `${activeVirtuals} activos`, icon: Bot, color: "text-purple-600", bg: "bg-purple-100" },
                { label: "Conversaciones manejadas", value: allAgents.reduce((s, a) => s + a.activeChats, 0), sub: "Activas ahora", icon: MessageSquare, color: "text-emerald-600", bg: "bg-emerald-100" },
                { label: "Canales cubiertos", value: new Set(allAgents.flatMap((a) => a.channels ?? [])).size, sub: "WhatsApp · IG · FB", icon: Sparkles, color: "text-amber-600", bg: "bg-amber-100" },
              ].map(({ label, value, sub, icon: Icon, color, bg }) => (
                <div key={label} className="bg-card border border-card-border rounded-2xl p-4 shadow-sm">
                  <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center mb-3", bg)}><Icon className={cn("w-4 h-4", color)} strokeWidth={2.5} /></div>
                  <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="text-[10px] text-muted-foreground/60 mt-0.5">{sub}</div>
                </div>
              ))}
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 p-1 bg-muted/40 rounded-xl w-fit">
              {[
                { id: "all", label: "Todos", count: allAgents.length },
                { id: "human", label: "Humanos", count: humans.length },
                { id: "virtual", label: "Virtuales IA", count: virtuals.length },
              ].map((tab) => (
                <button key={tab.id} onClick={() => setFilterTab(tab.id as typeof filterTab)}
                  className={cn("px-4 py-1.5 rounded-lg text-xs font-medium transition-all", filterTab === tab.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
                  data-testid={`agents-tab-${tab.id}`}>
                  {tab.label} <span className="opacity-60 ml-1">({tab.count})</span>
                </button>
              ))}
            </div>

            {/* Grid */}
            {isLoading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-card border border-card-border rounded-2xl p-5 h-48 animate-pulse" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
                <Bot className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">No hay agentes en esta vista</p>
                <p className="text-xs text-muted-foreground mt-1">Crea tu primer agente con los botones de arriba</p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((agent) => {
                  const isVirtual = agent.type === "virtual";
                  const tpl = profileTemplate(agent.profileType);
                  const escalateTarget = agent.escalateToAgentId ? allAgents.find((a) => a.id === agent.escalateToAgentId) : null;
                  return (
                    <div key={agent.id} className={cn("bg-card border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all", isVirtual ? "border-primary/30" : "border-card-border")} data-testid={`agent-card-${agent.id}`}>
                      <div className="flex items-start justify-between mb-4">
                        <button onClick={() => setLocation(`/agents/${agent.id}`)} className="flex items-center gap-3 text-left min-w-0" data-testid={`edit-agent-${agent.id}`}>
                          <ContactAvatar
                            name={agent.name}
                            avatar={agent.avatar}
                            fallback={isVirtual && tpl ? <tpl.icon className="w-5 h-5" /> : undefined}
                            className={cn("w-11 h-11 rounded-xl text-sm font-bold shadow-md text-white", isVirtual && tpl ? `bg-gradient-to-br ${tpl.color}` : "bg-gradient-to-br from-primary to-accent")}
                          >
                            {isVirtual && <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-purple-500 border-2 border-card flex items-center justify-center"><Sparkles className="w-2.5 h-2.5 text-white" /></div>}
                          </ContactAvatar>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground truncate">{agent.name}</div>
                            <div className={cn("flex items-center gap-1.5 text-xs", isVirtual ? (agent.isActive ? "text-purple-600" : "text-muted-foreground") : STATUS_STYLES[agent.status])}>
                              {isVirtual ? <><Bot className="w-3 h-3" /> {agent.isActive ? "IA activa" : "IA pausada"}</> : <><Circle className="w-2 h-2 fill-current" /> {STATUS_LABELS[agent.status]}</>}
                            </div>
                          </div>
                        </button>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-primary" onClick={() => setLocation(`/agents/${agent.id}`)} title="Editar" data-testid={`button-edit-agent-${agent.id}`}><Pencil className="w-3.5 h-3.5" /></Button>
                          {isVirtual && (
                            <Button size="sm" variant="ghost" className={cn("h-8 w-8 p-0", agent.isActive ? "text-purple-600 hover:bg-purple-100" : "text-muted-foreground hover:bg-muted")} onClick={() => toggleActive(agent.id, agent.isActive)} title={agent.isActive ? "Pausar IA" : "Activar IA"} data-testid={`button-toggle-agent-${agent.id}`}>
                              {agent.isActive ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive h-8 w-8 p-0" onClick={() => remove(agent.id)} data-testid={`button-delete-agent-${agent.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </div>

                      {isVirtual && tpl && (
                        <div className="mb-3 p-2 rounded-lg bg-muted/40 text-xs">
                          <div className="font-medium text-foreground">{tpl.name}</div>
                          <div className="text-muted-foreground text-[11px] mt-0.5">{tpl.description}</div>
                        </div>
                      )}

                      <div className="space-y-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">{agent.email}</span></div>
                        <div className="flex items-center gap-2"><MessageSquare className="w-3.5 h-3.5 flex-shrink-0" /><span>{agent.activeChats} chat{agent.activeChats !== 1 ? "s" : ""} activo{agent.activeChats !== 1 ? "s" : ""}</span></div>
                        {isVirtual && agent.model && <div className="flex items-center gap-2"><Sparkles className="w-3.5 h-3.5 flex-shrink-0 text-purple-500" /><span className="font-mono text-[11px]">{agent.model}</span></div>}
                        {escalateTarget && <div className="flex items-center gap-2"><ArrowRightCircle className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" /><span>Escala a <span className="font-medium text-foreground">{escalateTarget.name}</span></span></div>}
                      </div>

                      <div className="mt-3 pt-3 border-t border-card-border flex items-center gap-2">
                        {(agent.channels ?? []).map((ch: string) => { const Icon = CHANNEL_ICONS[ch]; return Icon ? <Icon key={ch} className={cn("w-4 h-4", CHANNEL_COLORS[ch])} /> : null; })}
                        {(agent.channels ?? []).length === 0 && <span className="text-muted-foreground/60 text-xs">Sin canales</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="groups"><GroupsPanel /></TabsContent>
          <TabsContent value="knowledge"><KnowledgePanel /></TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
