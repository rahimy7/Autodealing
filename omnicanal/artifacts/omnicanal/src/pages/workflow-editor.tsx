import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  useGetWorkflow,
  useUpdateWorkflow,
  useListLabels,
  useListAgents,
  getGetWorkflowQueryKey,
  type WorkflowUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, Trash2, Tag, Bot, Users, ArrowUpRight, Zap } from "lucide-react";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  NODE_KIND_META,
  TRIGGER_EVENTS,
  TRIGGER_DEFAULTS,
  newNodeId,
  CHANNEL_COLORS,
  type WfNodeData,
  type WfNodeKind,
  type WfGraph,
  type WfTriggerEvent,
} from "@/lib/workflow";

const ADD_BUTTONS: { kind: WfNodeKind; icon: typeof Tag }[] = [
  { kind: "label", icon: Tag },
  { kind: "trigger", icon: Zap },
  { kind: "agent", icon: Bot },
  { kind: "escalation", icon: ArrowUpRight },
  { kind: "group", icon: Users },
];

// A flow can apply to several channels at once; an empty selection means general
// (all channels).
const CHANNELS = ["whatsapp", "instagram", "facebook"] as const;
const CHANNEL_LABELS: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook" };

// ── Custom node ────────────────────────────────────────────────────────────────
function FlowNode({ data, selected }: NodeProps) {
  const d = data as WfNodeData;
  const meta = NODE_KIND_META[d.kind];
  const Icon = meta.icon;
  return (
    <div
      className={cn(
        "rounded-xl border-2 bg-card px-3 py-2 shadow-sm min-w-[150px] transition-shadow",
        selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
      )}
      style={{ borderColor: meta.color }}
    >
      <Handle type="target" position={Position.Left} style={{ background: meta.color }} />
      <div className="flex items-center gap-2">
        <span
          className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: `${meta.color}22`, color: meta.color }}
        >
          <Icon className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{meta.label}</div>
          <div className="text-xs font-semibold text-foreground truncate max-w-[120px]">
            {d.title || "(sin configurar)"}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: meta.color }} />
    </div>
  );
}

const nodeTypes: NodeTypes = { flow: FlowNode };

function EditorInner({ id }: { id: number }) {
  const { data: workflow, isLoading } = useGetWorkflow(id);
  const { data: labels } = useListLabels();
  const { data: agents } = useListAgents();
  const updateWorkflow = useUpdateWorkflow();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const initialized = useRef(false);

  // Hydrate local state once the workflow loads.
  useEffect(() => {
    if (!workflow || initialized.current) return;
    initialized.current = true;
    const graph = (workflow.graph ?? { nodes: [], edges: [] }) as unknown as WfGraph;
    setNodes(
      (graph.nodes ?? []).map((n) => ({
        id: n.id,
        type: "flow",
        position: n.position ?? { x: 0, y: 0 },
        data: n.data as unknown as Record<string, unknown>,
      })),
    );
    setEdges((graph.edges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target })));
    setName(workflow.name);
    setChannels(workflow.channels ?? []);
    setIsActive(workflow.isActive);
  }, [workflow, setNodes, setEdges]);

  const onConnect = useCallback(
    (conn: Connection) => setEdges((eds) => addEdge({ ...conn, id: `e-${conn.source}-${conn.target}` }, eds)),
    [setEdges],
  );

  const addNode = (kind: WfNodeKind) => {
    const meta = NODE_KIND_META[kind];
    const node: Node = {
      id: newNodeId(kind),
      type: "flow",
      position: { x: 120 + Math.random() * 200, y: 80 + Math.random() * 200 },
      data: (kind === "trigger"
        ? { kind, event: "closed_no_sale", title: TRIGGER_EVENTS.closed_no_sale.label }
        : { kind, title: kind === "escalation" ? "Destino del agente" : null }) as Record<string, unknown>,
    };
    setNodes((nds) => [...nds, node]);
    setSelectedId(node.id);
  };

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  const patchNodeData = (patch: Partial<WfNodeData>) => {
    if (!selectedId) return;
    setNodes((nds) =>
      nds.map((n) => (n.id === selectedId ? { ...n, data: { ...(n.data as object), ...patch } } : n)),
    );
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  };

  const handleSave = () => {
    const graph: WfGraph = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: "flow",
        position: n.position,
        data: n.data as unknown as WfNodeData,
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    };
    updateWorkflow.mutate(
      {
        id,
        data: {
          name: name.trim() || "Flujo sin nombre",
          channels: (channels.length ? channels : null) as WorkflowUpdate["channels"],
          isActive,
          graph: graph as unknown as WorkflowUpdate["graph"],
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWorkflowQueryKey(id) });
          toast({ title: "Flujo guardado", description: "Los cambios se guardaron correctamente." });
        },
        onError: (err: unknown) => {
          const data = (err as { data?: { error?: string } } | null)?.data;
          toast({
            title: "No se pudo guardar",
            description: data?.error ?? (err instanceof Error ? err.message : "Error desconocido"),
            variant: "destructive",
          });
        },
      },
    );
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Cargando flujo…</div>;
  }
  if (!workflow) {
    return <div className="p-6 text-sm text-muted-foreground">Flujo no encontrado.</div>;
  }

  const selData = selectedNode?.data as WfNodeData | undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3 border-b border-card-border bg-card">
        <Link href="/workflow" className="p-2 rounded-lg hover:bg-muted text-muted-foreground" data-testid="link-back-workflows">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-48 sm:w-64 font-semibold"
          placeholder="Nombre del flujo"
          data-testid="input-workflow-name"
        />
        <div className="flex items-center gap-1" data-testid="channels-select" title="Canales a los que aplica el flujo (vacío = todos)">
          {CHANNELS.map((c) => {
            const active = channels.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() =>
                  setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
                }
                className={cn(
                  "px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                  active ? "bg-primary/10" : "border-card-border text-muted-foreground hover:text-foreground",
                )}
                style={active ? { borderColor: CHANNEL_COLORS[c], color: CHANNEL_COLORS[c] } : undefined}
                data-testid={`channel-toggle-${c}`}
              >
                {CHANNEL_LABELS[c]}
              </button>
            );
          })}
          {channels.length === 0 && (
            <span className="text-xs text-muted-foreground ml-1">General (todos)</span>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={isActive} onCheckedChange={setIsActive} data-testid="switch-workflow-active" />
          Activo
        </label>
        <Button onClick={handleSave} disabled={updateWorkflow.isPending} className="ml-auto gap-2" data-testid="button-save-workflow">
          <Save className="w-4 h-4" /> {updateWorkflow.isPending ? "Guardando…" : "Guardar"}
        </Button>
      </div>

      {/* Toolbar: add nodes */}
      <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-2 border-b border-card-border bg-muted/30">
        <span className="text-xs text-muted-foreground mr-1">Agregar:</span>
        {ADD_BUTTONS.map(({ kind, icon: Icon }) => (
          <button
            key={kind}
            onClick={() => addNode(kind)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-card-border bg-card text-xs font-medium hover:border-primary/50 transition-colors"
            style={{ color: NODE_KIND_META[kind].color }}
            data-testid={`button-add-node-${kind}`}
          >
            <Icon className="w-3.5 h-3.5" />
            {NODE_KIND_META[kind].label}
          </button>
        ))}
      </div>

      {/* Canvas + inspector */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
        <div className="flex-1 h-[55vh] lg:h-auto min-h-0" data-testid="workflow-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable className="!hidden sm:!block" />
          </ReactFlow>
        </div>

        {/* Inspector */}
        <aside className="w-full lg:w-72 border-t lg:border-t-0 lg:border-l border-card-border bg-card p-4 overflow-y-auto">
          {!selectedNode ? (
            <div className="text-xs text-muted-foreground space-y-3">
              <p className="font-semibold text-foreground text-sm">Editor de flujo</p>
              <p>Agrega nodos con la barra superior y conéctalos arrastrando desde el punto derecho de un nodo al izquierdo de otro.</p>
              <p>El flujo entra por un nodo <span style={{ color: NODE_KIND_META.label.color }}>Etiqueta</span> (la intención detectada) y decide a quién derivar.</p>
              <p>Un nodo <span style={{ color: NODE_KIND_META.trigger.color }}>Disparador</span> no enruta mensajes: programa un seguimiento (recuperar una venta, post-venta, cliente sin respuesta) que envía el agente virtual al que lo conectes.</p>
              <p>Selecciona un nodo para configurarlo.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{NODE_KIND_META[selData!.kind].label}</span>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400" onClick={deleteSelected} data-testid="button-delete-node">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{NODE_KIND_META[selData!.kind].hint}</p>

              {selData!.kind === "label" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Etiqueta</label>
                  <Select
                    value={selData!.labelId != null ? String(selData!.labelId) : ""}
                    onValueChange={(v) => {
                      const lbl = labels?.find((l) => l.id === Number(v));
                      patchNodeData({ labelId: Number(v), title: lbl?.name ?? null });
                    }}
                  >
                    <SelectTrigger data-testid="select-node-label"><SelectValue placeholder="Elegir etiqueta" /></SelectTrigger>
                    {/* Dos familias, dos formas de llegar aquí: la intención la
                        detecta la IA, la localidad sale de la zona del cliente. */}
                    <SelectContent>
                      {(["intent", "locality"] as const).map((kind) => {
                        const group = (labels ?? []).filter((l) => (l.kind ?? "intent") === kind);
                        if (group.length === 0) return null;
                        return (
                          <SelectGroup key={kind}>
                            <SelectLabel>{kind === "intent" ? "Intención" : "Localidad"}</SelectLabel>
                            {group.map((l) => (
                              <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                            ))}
                          </SelectGroup>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    {(labels ?? []).find((l) => l.id === selData!.labelId)?.kind === "locality"
                      ? "Conéctala a un grupo: es el equipo de esa tienda el que recibe al cliente de esa zona."
                      : "Lo que quiere el cliente, detectado por la IA."}
                  </p>
                </div>
              )}

              {(selData!.kind === "agent" || selData!.kind === "escalation") && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    {selData!.kind === "escalation" ? "Escalar a (opcional)" : "Agente destino"}
                  </label>
                  <Select
                    value={selData!.agentId != null ? String(selData!.agentId) : ""}
                    onValueChange={(v) => {
                      const ag = agents?.find((a) => a.id === Number(v));
                      patchNodeData({ agentId: Number(v), title: ag?.name ?? null });
                    }}
                  >
                    <SelectTrigger data-testid="select-node-agent"><SelectValue placeholder={selData!.kind === "escalation" ? "Destino del agente actual" : "Elegir agente"} /></SelectTrigger>
                    <SelectContent>
                      {(agents ?? []).map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.name} · {a.type === "human" ? "Humano" : "IA"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {selData!.kind === "trigger" && (
                <TriggerInspector
                  data={selData!}
                  labels={(labels ?? []).filter((l) => (l.kind ?? "intent") === "intent")}
                  onChange={patchNodeData}
                />
              )}

              {selData!.kind === "group" && (
                <p className="text-xs text-amber-500/90 bg-amber-500/10 rounded-lg p-2">
                  Los grupos de agentes humanos y sus reglas de distribución llegan en la siguiente entrega.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// Horas o días de un disparador: vacío vuelve al valor por defecto del backend.
function NumberField({
  label,
  suffix,
  value,
  placeholder,
  onChange,
  testId,
}: {
  label: string;
  suffix: string;
  value: number | null | undefined;
  placeholder: number;
  onChange: (value: number | null) => void;
  testId: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          step={1}
          value={value ?? ""}
          placeholder={String(placeholder)}
          onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
          className="h-8 w-24"
          data-testid={testId}
        />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}

function TriggerInspector({
  data,
  labels,
  onChange,
}: {
  data: WfNodeData;
  labels: { id: number; name: string; color?: string | null }[];
  onChange: (patch: Partial<WfNodeData>) => void;
}) {
  const event = (data.event ?? "closed_no_sale") as WfTriggerEvent;
  const selectedLabels = data.labelIds ?? [];
  const toggleLabel = (id: number) =>
    onChange({
      labelIds: selectedLabels.includes(id) ? selectedLabels.filter((x) => x !== id) : [...selectedLabels, id],
    });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Cuándo se dispara</label>
        <Select
          value={event}
          onValueChange={(v) => onChange({ event: v as WfTriggerEvent, title: TRIGGER_EVENTS[v as WfTriggerEvent].label })}
        >
          <SelectTrigger data-testid="select-trigger-event"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(TRIGGER_EVENTS) as WfTriggerEvent[]).map((key) => (
              <SelectItem key={key} value={key}>{TRIGGER_EVENTS[key].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">{TRIGGER_EVENTS[event].hint}</p>
      </div>

      {event === "closed_no_sale" && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Con qué etiqueta cerró el chat</label>
            <div className="flex flex-wrap gap-1.5" data-testid="trigger-labels">
              {labels.map((l) => {
                const active = selectedLabels.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggleLabel(l.id)}
                    className={cn(
                      "px-2 py-1 rounded-full border text-[11px] font-medium transition-colors",
                      active ? "text-white" : "border-card-border text-muted-foreground hover:text-foreground",
                    )}
                    style={active ? { backgroundColor: l.color ?? "#14b8a6", borderColor: l.color ?? "#14b8a6" } : undefined}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {selectedLabels.length === 0 ? "Sin etiquetas elegidas aplica a cualquier chat cerrado sin venta." : "Solo los chats que cerraron con estas etiquetas."}
            </p>
          </div>
          <NumberField
            label="Escribirle después de"
            suffix="horas del cierre"
            value={data.delayHours}
            placeholder={TRIGGER_DEFAULTS.closedNoSaleDelayHours}
            onChange={(v) => onChange({ delayHours: v })}
            testId="input-trigger-delay"
          />
        </>
      )}

      {event === "unanswered" && (
        <NumberField
          label="Responder si nadie contestó en"
          suffix="horas"
          value={data.delayHours}
          placeholder={TRIGGER_DEFAULTS.unansweredDelayHours}
          onChange={(v) => onChange({ delayHours: v })}
          testId="input-trigger-delay"
        />
      )}

      {event === "sale_closed" && (
        <div className="space-y-3">
          <NumberField
            label="Confirmar la entrega a los"
            suffix="días"
            value={data.deliveryDays}
            placeholder={TRIGGER_DEFAULTS.deliveryDays}
            onChange={(v) => onChange({ deliveryDays: v })}
            testId="input-trigger-delivery"
          />
          <NumberField
            label="Encuesta de satisfacción a los"
            suffix="días"
            value={data.satisfactionDays}
            placeholder={TRIGGER_DEFAULTS.satisfactionDays}
            onChange={(v) => onChange({ satisfactionDays: v })}
            testId="input-trigger-satisfaction"
          />
          <NumberField
            label="Recordatorio de recompra a los"
            suffix="días"
            value={data.repurchaseDays}
            placeholder={TRIGGER_DEFAULTS.repurchaseDays}
            onChange={(v) => onChange({ repurchaseDays: v })}
            testId="input-trigger-repurchase"
          />
        </div>
      )}

      <p className="text-[11px] text-pink-600/90 bg-pink-500/10 rounded-lg p-2">
        Conéctalo a un nodo Agente con un agente virtual activo: es quien escribe y quien atiende la respuesta del cliente.
      </p>
    </div>
  );
}

export default function WorkflowEditorPage() {
  const [, params] = useRoute("/workflow/:id");
  const id = Number(params?.id);
  return (
    <Layout>
      <ReactFlowProvider>
        {Number.isFinite(id) ? <EditorInner id={id} /> : <div className="p-6">Flujo inválido</div>}
      </ReactFlowProvider>
    </Layout>
  );
}
