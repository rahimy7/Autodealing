import { useState } from "react";
import {
  useListGroups,
  useCreateGroup,
  useUpdateGroup,
  useDeleteGroup,
  useGetGroup,
  useAddGroupMember,
  useRemoveGroupMember,
  useListAgents,
  getListGroupsQueryKey,
  getGetGroupQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Users, Trash2, UserPlus, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DISTRIBUTION_RULES, STATUS_STYLES } from "@/lib/agent-ui";

function ruleMeta(id: string) {
  return DISTRIBUTION_RULES.find((r) => r.id === id) ?? DISTRIBUTION_RULES[0];
}

export default function GroupsPanel() {
  const { data: groups, isLoading } = useListGroups();
  const { data: agents } = useListAgents();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const addMember = useAddGroupMember();
  const removeMember = useRemoveGroupMember();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rule, setRule] = useState<string>("round_robin");
  const [addAgent, setAddAgent] = useState("");

  const { data: detail } = useGetGroup(selectedId ?? 0, { query: { enabled: !!selectedId, queryKey: getGetGroupQueryKey(selectedId ?? 0) } });

  const invalidateList = () => queryClient.invalidateQueries({ queryKey: getListGroupsQueryKey() });
  const invalidateDetail = () => { if (selectedId) queryClient.invalidateQueries({ queryKey: getGetGroupQueryKey(selectedId) }); invalidateList(); };

  const submitCreate = () => {
    if (!name.trim()) return;
    createGroup.mutate(
      { data: { name: name.trim(), description: description.trim() || null, distributionRule: rule as "round_robin" } },
      { onSuccess: (g) => { invalidateList(); setOpen(false); setName(""); setDescription(""); setRule("round_robin"); setSelectedId(g.id); toast({ title: "Grupo creado" }); } },
    );
  };

  const humans = (agents ?? []).filter((a) => a.type === "human");
  const memberIds = new Set((detail?.members ?? []).map((m) => m.agentId));
  const addable = humans.filter((h) => !memberIds.has(h.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Grupos de agentes humanos con reglas de distribución para el escalamiento.</p>
        <Button size="sm" onClick={() => setOpen(true)} className="gap-2" data-testid="button-new-group"><Plus className="w-4 h-4" /> Nuevo grupo</Button>
      </div>

      <div className="grid lg:grid-cols-[300px_1fr] gap-4">
        {/* Group list */}
        <div className="space-y-2">
          {isLoading ? (
            Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-card border border-card-border animate-pulse" />)
          ) : (groups ?? []).length === 0 ? (
            <div className="bg-card border border-card-border rounded-xl p-8 text-center">
              <Users className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Sin grupos</p>
            </div>
          ) : (
            (groups ?? []).map((g) => {
              const meta = ruleMeta(g.distributionRule);
              return (
                <button key={g.id} onClick={() => setSelectedId(g.id)} className={cn("w-full text-left bg-card border rounded-xl p-3 transition-all", selectedId === g.id ? "border-primary ring-1 ring-primary/30" : "border-card-border hover:border-primary/40")} data-testid={`group-card-${g.id}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground truncate">{g.name}</span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1"><meta.icon className="w-3 h-3" /> {meta.label}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-3">
                    <span>{g.memberCount} miembros</span>
                    {(g.queuedConversations ?? 0) > 0 && <span className="text-amber-500">{g.queuedConversations} en cola</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Group detail */}
        <div className="bg-card border border-card-border rounded-2xl p-5">
          {!selectedId || !detail ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Selecciona un grupo para ver su estado y miembros.</div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-bold text-foreground">{detail.name}</h3>
                  {detail.description && <p className="text-xs text-muted-foreground mt-0.5">{detail.description}</p>}
                </div>
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-400 gap-1.5" onClick={() => deleteGroup.mutate({ id: detail.id }, { onSuccess: () => { invalidateList(); setSelectedId(null); toast({ title: "Grupo eliminado" }); } })} data-testid="button-delete-group">
                  <Trash2 className="w-3.5 h-3.5" /> Eliminar
                </Button>
              </div>

              {/* Status */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl bg-muted/40 p-3"><div className="text-lg font-bold text-foreground">{detail.memberCount}</div><div className="text-[10px] text-muted-foreground">Miembros</div></div>
                <div className="rounded-xl bg-muted/40 p-3"><div className="text-lg font-bold text-foreground">{(detail.members ?? []).reduce((s, m) => s + m.activeConversations, 0)}</div><div className="text-[10px] text-muted-foreground">Conversaciones activas</div></div>
                <div className="rounded-xl bg-muted/40 p-3"><div className="text-lg font-bold text-amber-500">{detail.queuedConversations ?? 0}</div><div className="text-[10px] text-muted-foreground">En cola</div></div>
              </div>

              {/* Rule */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Regla de distribución</label>
                <Select value={detail.distributionRule} onValueChange={(v) => updateGroup.mutate({ id: detail.id, data: { distributionRule: v as "round_robin" } }, { onSuccess: invalidateDetail })}>
                  <SelectTrigger data-testid="select-group-rule"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DISTRIBUTION_RULES.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">{ruleMeta(detail.distributionRule).description}</p>
              </div>

              {/* Members */}
              <div className="space-y-2">
                <label className="text-xs font-medium">Miembros y utilización</label>
                {(detail.members ?? []).map((m) => (
                  <div key={m.agentId} className="flex items-center gap-2 rounded-lg border border-card-border p-2.5" data-testid={`member-${m.agentId}`}>
                    <Circle className={cn("w-2 h-2 fill-current flex-shrink-0", STATUS_STYLES[m.status ?? "offline"])} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">{m.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {m.activeConversations} activas{(m.capabilities?.length ?? 0) > 0 && ` · ${(m.capabilities ?? []).join(", ")}`}
                      </div>
                    </div>
                    <button onClick={() => removeMember.mutate({ id: detail.id, agentId: m.agentId }, { onSuccess: invalidateDetail })} className="p-1 text-muted-foreground hover:text-red-400 flex-shrink-0" data-testid={`remove-member-${m.agentId}`}><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                {(detail.members ?? []).length === 0 && <p className="text-xs text-muted-foreground">Sin miembros todavía.</p>}

                {/* Add member */}
                <div className="flex items-center gap-2 pt-1">
                  <UserPlus className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <Select value={addAgent} onValueChange={setAddAgent}>
                    <SelectTrigger className="h-9 text-xs flex-1" data-testid="select-add-member"><SelectValue placeholder={addable.length ? "Agregar agente humano…" : "No hay agentes humanos disponibles"} /></SelectTrigger>
                    <SelectContent>
                      {addable.map((h) => <SelectItem key={h.id} value={String(h.id)}>{h.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={!addAgent || addMember.isPending} onClick={() => addMember.mutate({ id: detail.id, data: { agentId: Number(addAgent) } }, { onSuccess: () => { invalidateDetail(); setAddAgent(""); } })} data-testid="button-add-member">Agregar</Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuevo grupo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><label className="text-sm font-medium">Nombre</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Soporte técnico" data-testid="input-group-name" /></div>
            <div className="space-y-1.5"><label className="text-sm font-medium">Descripción (opcional)</label><Input value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-group-description" /></div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Regla de distribución</label>
              <Select value={rule} onValueChange={setRule}>
                <SelectTrigger data-testid="select-new-group-rule"><SelectValue /></SelectTrigger>
                <SelectContent>{DISTRIBUTION_RULES.map((r) => <SelectItem key={r.id} value={r.id}>{r.label} — {r.description}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={submitCreate} disabled={createGroup.isPending} data-testid="button-submit-group">Crear</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
