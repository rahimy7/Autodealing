import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListLabels,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
  useListWorkflows,
  useCreateWorkflow,
  useUpdateWorkflow,
  useDeleteWorkflow,
  getListLabelsQueryKey,
  getListWorkflowsQueryKey,
  type Label as ApiLabel,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Tag, Trash2, Pencil, GitBranch, ToggleLeft, ToggleRight, Workflow as WorkflowIcon, MessageCircleReply, ArrowRightCircle, MapPin, Mail } from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CHANNEL_COLORS } from "@/lib/workflow";

const COLOR_PRESETS = ["#14b8a6", "#3b82f6", "#f59e0b", "#a855f7", "#ef4444", "#10b981", "#ec4899", "#6366f1"];

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  whatsapp: (p) => <SiWhatsapp {...p} />,
  instagram: (p) => <SiInstagram {...p} />,
  facebook: (p) => <SiFacebook {...p} />,
};

export default function WorkflowPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  // ── Labels ──────────────────────────────────────────────────────────────────
  const { data: labels, isLoading: labelsLoading } = useListLabels();
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();

  const [labelDialog, setLabelDialog] = useState(false);
  const [editingLabel, setEditingLabel] = useState<ApiLabel | null>(null);
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState(COLOR_PRESETS[0]);
  const [labelDesc, setLabelDesc] = useState("");
  const [labelSafeAutoReply, setLabelSafeAutoReply] = useState(false);
  const [labelSafeEmailAutoReply, setLabelSafeEmailAutoReply] = useState(false);
  const [labelAutoMigrate, setLabelAutoMigrate] = useState(false);

  const invalidateLabels = () => queryClient.invalidateQueries({ queryKey: getListLabelsQueryKey() });

  const openNewLabel = () => {
    setEditingLabel(null);
    setLabelName("");
    setLabelColor(COLOR_PRESETS[0]);
    setLabelDesc("");
    setLabelSafeAutoReply(false);
    setLabelSafeEmailAutoReply(false);
    setLabelAutoMigrate(false);
    setLabelDialog(true);
  };
  const openEditLabel = (l: ApiLabel) => {
    setEditingLabel(l);
    setLabelName(l.name);
    setLabelColor(l.color || COLOR_PRESETS[0]);
    setLabelDesc(l.description ?? "");
    setLabelSafeAutoReply(l.isSafeForAutoReply ?? false);
    setLabelSafeEmailAutoReply(l.isSafeForEmailAutoReply ?? false);
    setLabelAutoMigrate(l.autoMigrateToDm ?? false);
    setLabelDialog(true);
  };

  const submitLabel = () => {
    if (!labelName.trim()) return;
    const data = {
      name: labelName.trim(),
      color: labelColor,
      description: labelDesc.trim() || null,
      isSafeForAutoReply: labelSafeAutoReply,
      isSafeForEmailAutoReply: labelSafeEmailAutoReply,
      autoMigrateToDm: labelAutoMigrate,
    };
    if (editingLabel) {
      updateLabel.mutate(
        { id: editingLabel.id, data },
        { onSuccess: () => { invalidateLabels(); setLabelDialog(false); toast({ title: "Etiqueta actualizada" }); } },
      );
    } else {
      createLabel.mutate(
        { data },
        { onSuccess: () => { invalidateLabels(); setLabelDialog(false); toast({ title: "Etiqueta creada" }); } },
      );
    }
  };

  const toggleLabel = (l: ApiLabel) =>
    updateLabel.mutate({ id: l.id, data: { isActive: !l.isActive } }, { onSuccess: invalidateLabels });
  const removeLabel = (id: number) =>
    deleteLabel.mutate({ id }, { onSuccess: () => { invalidateLabels(); toast({ title: "Etiqueta eliminada" }); } });

  // ── Workflows ───────────────────────────────────────────────────────────────
  const { data: workflows, isLoading: wfLoading } = useListWorkflows();
  const createWorkflow = useCreateWorkflow();
  const updateWorkflow = useUpdateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();

  const invalidateWorkflows = () => queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });

  const createAndEdit = () => {
    createWorkflow.mutate(
      { data: { name: "Nuevo flujo", isActive: true } },
      {
        onSuccess: (wf) => {
          invalidateWorkflows();
          setLocation(`/workflow/${wf.id}`);
        },
      },
    );
  };

  const toggleWorkflow = (id: number, isActive: boolean) =>
    updateWorkflow.mutate({ id, data: { isActive: !isActive } }, { onSuccess: invalidateWorkflows });
  const removeWorkflow = (id: number) =>
    deleteWorkflow.mutate({ id }, { onSuccess: () => { invalidateWorkflows(); toast({ title: "Flujo eliminado" }); } });

  const nodeCount = (wf: { graph?: unknown }) => {
    const g = wf.graph as { nodes?: unknown[] } | undefined;
    return Array.isArray(g?.nodes) ? g!.nodes!.length : 0;
  };

  return (
    <Layout>
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <WorkflowIcon className="w-5 h-5 text-primary" /> Workflow
          </h1>
          <p className="text-sm text-muted-foreground">
            Crea etiquetas de intención y flujos de escalamiento que deciden qué agente atiende cada conversación.
          </p>
        </div>

        <Tabs defaultValue="labels">
          <TabsList>
            <TabsTrigger value="labels" data-testid="tab-labels">Etiquetas</TabsTrigger>
            <TabsTrigger value="flows" data-testid="tab-flows">Flujos</TabsTrigger>
          </TabsList>

          {/* ── Labels tab ── */}
          <TabsContent value="labels" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Las de <span className="text-foreground font-medium">intención</span> las asigna la IA según lo que pide el cliente.
                Las de <span className="text-foreground font-medium">localidad</span> las pone el sistema según la zona del cliente y son las que deciden qué tienda lo atiende.
              </p>
              <Button size="sm" onClick={openNewLabel} className="gap-2" data-testid="button-new-label">
                <Plus className="w-4 h-4" /> Nueva etiqueta
              </Button>
            </div>

            {labelsLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-card border border-card-border animate-pulse" />)}
              </div>
            ) : (labels ?? []).length === 0 ? (
              <div className="bg-card border border-card-border rounded-xl p-10 text-center">
                <Tag className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Aún no hay etiquetas</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Crea etiquetas como “Saludo”, “Soporte” o “Ventas”.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(labels ?? []).map((l) => (
                  <div key={l.id} className={cn("bg-card border rounded-xl p-4", l.isActive ? "border-card-border" : "border-card-border opacity-60")} data-testid={`label-card-${l.id}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: l.color }} />
                        <span className="text-sm font-semibold text-foreground truncate">{l.name}</span>
                        {l.kind === "locality" && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-medium flex-shrink-0" title="La pone el sistema según la zona del cliente; el flujo decide a qué tienda va">
                            <MapPin className="w-2.5 h-2.5" /> Localidad
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => toggleLabel(l)} className={cn("p-1", l.isActive ? "text-primary" : "text-muted-foreground")} title={l.isActive ? "Activa" : "Inactiva"} data-testid={`button-toggle-label-${l.id}`}>
                          {l.isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                        </button>
                        <button onClick={() => openEditLabel(l)} className="p-1 text-muted-foreground hover:text-foreground" data-testid={`button-edit-label-${l.id}`}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => removeLabel(l.id)} className="p-1 text-muted-foreground hover:text-red-400" data-testid={`button-delete-label-${l.id}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {l.description && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{l.description}</p>}
                    {/* Feed behaviour pills */}
                    {(l.isSafeForAutoReply || l.isSafeForEmailAutoReply || l.autoMigrateToDm) && (
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {l.isSafeForAutoReply && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 font-medium">
                            <MessageCircleReply className="w-2.5 h-2.5" /> Auto-reply
                          </span>
                        )}
                        {l.isSafeForEmailAutoReply && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
                            <Mail className="w-2.5 h-2.5" /> Correo automático
                          </span>
                        )}
                        {l.autoMigrateToDm && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-medium">
                            <ArrowRightCircle className="w-2.5 h-2.5" /> Migrar a DM
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Flows tab ── */}
          <TabsContent value="flows" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Flujos visuales que deciden el escalamiento. Pueden ser por canal o generales.</p>
              <Button size="sm" onClick={createAndEdit} disabled={createWorkflow.isPending} className="gap-2" data-testid="button-new-workflow">
                <Plus className="w-4 h-4" /> Nuevo flujo
              </Button>
            </div>

            {wfLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-32 rounded-xl bg-card border border-card-border animate-pulse" />)}
              </div>
            ) : (workflows ?? []).length === 0 ? (
              <div className="bg-card border border-card-border rounded-xl p-10 text-center">
                <GitBranch className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Aún no hay flujos</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Crea un flujo y conéctalo: etiqueta → agente / escalar.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {(workflows ?? []).map((wf) => {
                  const chans = wf.channels ?? [];
                  return (
                    <div key={wf.id} className={cn("bg-card border rounded-xl p-5", wf.isActive ? "border-primary/30" : "border-card-border")} data-testid={`workflow-card-${wf.id}`}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
                            <GitBranch className="w-4.5 h-4.5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-foreground truncate">{wf.name}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                              {chans.length === 0
                                ? "General · todos los canales"
                                : chans.map((ch) => {
                                    const Icon = CHANNEL_ICONS[ch];
                                    return (
                                      <span key={ch} className="inline-flex items-center gap-1">
                                        {Icon && <Icon className="w-3 h-3" style={{ color: CHANNEL_COLORS[ch] }} />} {ch}
                                      </span>
                                    );
                                  })}
                            </div>
                          </div>
                        </div>
                        <button onClick={() => toggleWorkflow(wf.id, wf.isActive)} className={cn("p-1 flex-shrink-0", wf.isActive ? "text-primary" : "text-muted-foreground")} data-testid={`button-toggle-workflow-${wf.id}`}>
                          {wf.isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                        <GitBranch className="w-3.5 h-3.5" /> {nodeCount(wf)} nodos
                      </div>
                      <div className="flex items-center gap-2 pt-3 border-t border-card-border">
                        <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={() => setLocation(`/workflow/${wf.id}`)} data-testid={`button-edit-workflow-${wf.id}`}>
                          <Pencil className="w-3.5 h-3.5" /> Editar flujo
                        </Button>
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-400 h-8 w-8 p-0" onClick={() => removeWorkflow(wf.id)} data-testid={`button-delete-workflow-${wf.id}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Label dialog */}
      <Dialog open={labelDialog} onOpenChange={setLabelDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingLabel ? "Editar etiqueta" : "Nueva etiqueta"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nombre</label>
              <Input value={labelName} onChange={(e) => setLabelName(e.target.value)} placeholder="Ej: Soporte Nivel II" data-testid="input-label-name" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Color</label>
              <div className="flex flex-wrap gap-2">
                {COLOR_PRESETS.map((c) => (
                  <button key={c} onClick={() => setLabelColor(c)} className={cn("w-7 h-7 rounded-full border-2", labelColor === c ? "border-foreground" : "border-transparent")} style={{ background: c }} data-testid={`color-${c}`} />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Descripción (ayuda a la IA a clasificar)</label>
              <Textarea value={labelDesc} onChange={(e) => setLabelDesc(e.target.value)} rows={3} placeholder="Ej: El cliente reporta un problema técnico complejo que requiere soporte especializado." data-testid="input-label-description" />
            </div>

            {/* Feed auto-reply behaviour */}
            <div className="border border-card-border rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Comportamiento en comentarios (Feed)</p>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <MessageCircleReply className="w-3.5 h-3.5 text-green-400" /> Auto-reply público
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">El bot publica la respuesta de forma automática en el comentario.</p>
                </div>
                <Switch
                  checked={labelSafeAutoReply}
                  onCheckedChange={setLabelSafeAutoReply}
                  data-testid="switch-safe-auto-reply"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <ArrowRightCircle className="w-3.5 h-3.5 text-blue-400" /> Migrar a DM automáticamente
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Si el intent es éste, el hilo se migra a un chat privado al instante.</p>
                </div>
                <Switch
                  checked={labelAutoMigrate}
                  onCheckedChange={setLabelAutoMigrate}
                  data-testid="switch-auto-migrate-dm"
                />
              </div>
            </div>

            {/* Correo: interruptor propio, no el del Feed. Un comentario lo lee
                cualquiera y un correo lo lee una sola persona. */}
            <div className="border border-card-border rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Comportamiento en el correo</p>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-amber-400" /> Responder el correo sin revisión
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    El correo con esta intención se contesta solo, si la IA supo qué responder. Requiere la
                    auto-respuesta encendida en Configuración → Correo.
                  </p>
                </div>
                <Switch
                  checked={labelSafeEmailAutoReply}
                  onCheckedChange={setLabelSafeEmailAutoReply}
                  data-testid="switch-safe-email-auto-reply"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setLabelDialog(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={submitLabel} disabled={createLabel.isPending || updateLabel.isPending} data-testid="button-submit-label">
                {editingLabel ? "Guardar" : "Crear"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
