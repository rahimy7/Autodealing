import { useEffect, useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import {
  useGetAgent,
  useCreateAgent,
  useUpdateAgent,
  useListAgents,
  useListKnowledgeBases,
  useCreateCapability,
  useUpdateCapability,
  useDeleteCapability,
  useAssistCapability,
  useAssistAgentPrompt,
  useListGroups,
  getGetAgentQueryKey,
  getListAgentsQueryKey,
  type Capability,
  type AgentPromptAssistInputProfileType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Save, Sparkles, UserCog, Bot, Wand2, Loader2, Trash2, Plus, Brain, KeyRound,
} from "lucide-react";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PROFILE_TEMPLATES, ALL_CHANNELS, CHANNEL_ICONS, CHANNEL_COLORS, CAPABILITY_CATEGORIES, CAPABILITY_LEVELS } from "@/lib/agent-ui";

const parseKeywords = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);

function ChannelToggle({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {ALL_CHANNELS.map((ch) => {
        const Icon = CHANNEL_ICONS[ch];
        const selected = value.includes(ch);
        return (
          <button
            key={ch}
            type="button"
            onClick={() => onChange(selected ? value.filter((c) => c !== ch) : [...value, ch])}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 text-xs font-medium capitalize transition-all",
              selected ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40",
            )}
            data-testid={`channel-toggle-${ch}`}
          >
            <Icon className={cn("w-3.5 h-3.5", CHANNEL_COLORS[ch])} /> {ch}
          </button>
        );
      })}
    </div>
  );
}

// ── Capability row (edit mode only) ─────────────────────────────────────────────
function CapabilityRow({ cap, agentId }: { cap: Capability; agentId: number }) {
  const { data: kbs } = useListKnowledgeBases();
  const updateCap = useUpdateCapability();
  const deleteCap = useDeleteCapability();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(cap.name);
  const [description, setDescription] = useState(cap.description ?? "");
  const [keywords, setKeywords] = useState((cap.keywords ?? []).join(", "));
  const [examples, setExamples] = useState(cap.examples ?? "");
  const kbId = cap.knowledgeBaseId ?? null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });

  const save = (patch: Record<string, unknown>) =>
    updateCap.mutate({ id: cap.id, data: patch }, { onSuccess: invalidate });

  return (
    <div className="rounded-xl border border-card-border p-3 space-y-2 bg-muted/20" data-testid={`capability-${cap.id}`}>
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== cap.name && save({ name })} className="h-8 text-sm font-medium" data-testid={`capability-name-${cap.id}`} />
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400 flex-shrink-0"
          onClick={() => deleteCap.mutate({ id: cap.id }, { onSuccess: () => { invalidate(); toast({ title: "Capacidad eliminada" }); } })}
          data-testid={`delete-capability-${cap.id}`}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={cap.category ?? "none"} onValueChange={(v) => save({ category: v === "none" ? null : v })}>
          <SelectTrigger className="h-8 text-xs" data-testid={`capability-category-${cap.id}`}><SelectValue placeholder="Categoría" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin categoría</SelectItem>
            {CAPABILITY_CATEGORIES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={cap.level ?? "none"} onValueChange={(v) => save({ level: v === "none" ? null : v })}>
          <SelectTrigger className="h-8 text-xs" data-testid={`capability-level-${cap.id}`}><SelectValue placeholder="Nivel" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin nivel</SelectItem>
            {CAPABILITY_LEVELS.map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Input value={keywords} onChange={(e) => setKeywords(e.target.value)}
        onBlur={() => parseKeywords(keywords).join("|") !== (cap.keywords ?? []).join("|") && save({ keywords: parseKeywords(keywords) })}
        placeholder="Palabras clave (separadas por coma)" className="h-8 text-xs" data-testid={`capability-keywords-${cap.id}`} />
      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => (description || "") !== (cap.description ?? "") && save({ description: description || null })} rows={2} placeholder="Descripción de la capacidad" className="text-xs" />
      <Textarea value={examples} onChange={(e) => setExamples(e.target.value)} onBlur={() => (examples || "") !== (cap.examples ?? "") && save({ examples: examples || null })} rows={2} placeholder="Ejemplos de uso (situaciones o frases del cliente)" className="text-xs" data-testid={`capability-examples-${cap.id}`} />
      <div className="flex items-center gap-2">
        <Brain className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
        <Select value={kbId != null ? String(kbId) : "none"} onValueChange={(v) => save({ knowledgeBaseId: v === "none" ? null : Number(v) })}>
          <SelectTrigger className="h-8 text-xs" data-testid={`capability-kb-${cap.id}`}><SelectValue placeholder="Sin base de conocimiento" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin base de conocimiento</SelectItem>
            {(kbs ?? []).map((k) => <SelectItem key={k.id} value={String(k.id)}>{k.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function AddCapability({ agentId }: { agentId: number }) {
  const { data: kbs } = useListKnowledgeBases();
  const createCap = useCreateCapability();
  const assist = useAssistCapability();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("none");
  const [level, setLevel] = useState("none");
  const [keywords, setKeywords] = useState("");
  const [examples, setExamples] = useState("");
  const [kbId, setKbId] = useState("none");

  const reset = () => { setName(""); setDescription(""); setCategory("none"); setLevel("none"); setKeywords(""); setExamples(""); setKbId("none"); };

  const add = () => {
    if (!name.trim()) return;
    createCap.mutate(
      { id: agentId, data: {
        name: name.trim(),
        description: description.trim() || null,
        knowledgeBaseId: kbId === "none" ? null : Number(kbId),
        category: category === "none" ? null : category,
        level: level === "none" ? null : level,
        keywords: parseKeywords(keywords),
        examples: examples.trim() || null,
      } },
      { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) }); reset(); toast({ title: "Capacidad agregada" }); } },
    );
  };

  const generate = async () => {
    if (!name.trim()) { toast({ title: "Escribe el nombre de la capacidad primero", variant: "destructive" }); return; }
    const r = await assist.mutateAsync({ data: { name: name.trim(), brief: description.trim() || null } });
    setDescription(r.description);
    if (!r.ok) toast({ title: "Se cargó una descripción base", description: r.message ?? undefined });
  };

  return (
    <div className="rounded-xl border-2 border-dashed border-card-border p-3 space-y-2">
      <div className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Nueva capacidad</div>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Cotización de pintura por m²" className="h-8 text-sm" data-testid="input-new-capability-name" />
      <div className="grid grid-cols-2 gap-2">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-8 text-xs" data-testid="select-new-capability-category"><SelectValue placeholder="Categoría" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin categoría</SelectItem>
            {CAPABILITY_CATEGORIES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger className="h-8 text-xs" data-testid="select-new-capability-level"><SelectValue placeholder="Nivel" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin nivel</SelectItem>
            {CAPABILITY_LEVELS.map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Palabras clave (separadas por coma)" className="h-8 text-xs" data-testid="input-new-capability-keywords" />
      <div className="flex gap-2">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="¿Qué hace esta capacidad? (o genérala con IA)" className="text-xs flex-1" data-testid="input-new-capability-desc" />
      </div>
      <Textarea value={examples} onChange={(e) => setExamples(e.target.value)} rows={2} placeholder="Ejemplos de uso (opcional)" className="text-xs" data-testid="input-new-capability-examples" />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={generate} disabled={assist.isPending} data-testid="button-assist-capability">
          {assist.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5 text-primary" />} IA
        </Button>
        <Select value={kbId} onValueChange={setKbId}>
          <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-new-capability-kb"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin base de conocimiento</SelectItem>
            {(kbs ?? []).map((k) => <SelectItem key={k.id} value={String(k.id)}>{k.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" onClick={add} disabled={createCap.isPending || !name.trim()} data-testid="button-add-capability">Agregar</Button>
      </div>
    </div>
  );
}

export default function AgentEditorPage() {
  const [, params] = useRoute("/agents/:id");
  const [, setLocation] = useLocation();
  const idParam = params?.id;
  const isNew = idParam === "new";
  const agentId = isNew ? null : Number(idParam);

  const { data: agent, isLoading } = useGetAgent(agentId ?? 0, {
    query: { enabled: !isNew && Number.isFinite(agentId), queryKey: getGetAgentQueryKey(agentId ?? 0) },
  });
  const { data: allAgents } = useListAgents();
  const { data: groups } = useListGroups();
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const assistPrompt = useAssistAgentPrompt();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [type, setType] = useState<"human" | "virtual">("virtual");
  const [role, setRole] = useState<"admin" | "agent">("agent");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [channels, setChannels] = useState<string[]>(["whatsapp"]);
  const [profileType, setProfileType] = useState("general");
  const [model, setModel] = useState("gpt-5-mini");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [escalateTo, setEscalateTo] = useState("none");
  const [brief, setBrief] = useState("");
  const initialized = useState({ done: false })[0];

  // In create mode, preselect the type/role from the query params.
  useEffect(() => {
    if (!isNew) return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get("type");
    if (t === "human" || t === "virtual") setType(t);
    const r = params.get("role");
    if (r === "admin" || r === "agent") setRole(r);
  }, [isNew]);

  useEffect(() => {
    if (isNew || !agent || initialized.done) return;
    initialized.done = true;
    setType(agent.type);
    setRole(agent.role === "admin" ? "admin" : "agent");
    setName(agent.name);
    setEmail(agent.email ?? "");
    setChannels(agent.channels ?? []);
    setProfileType(agent.profileType ?? "general");
    setModel(agent.model ?? "gpt-5-mini");
    setSystemPrompt(agent.systemPrompt ?? "");
    setEscalateTo(
      agent.escalateToGroupId != null
        ? `group:${agent.escalateToGroupId}`
        : agent.escalateToAgentId != null
          ? `agent:${agent.escalateToAgentId}`
          : "none",
    );
  }, [agent, isNew, initialized]);

  const isVirtual = type === "virtual";

  const generatePrompt = async () => {
    if (!brief.trim()) { toast({ title: "Escribe una breve descripción para la IA", variant: "destructive" }); return; }
    const r = await assistPrompt.mutateAsync({ data: { profileType: (profileType || "general") as AgentPromptAssistInputProfileType, brief: brief.trim(), agentName: name || null, model: model || null } });
    setSystemPrompt(r.systemPrompt);
    toast({ title: r.ok ? "Instrucciones generadas" : "Plantilla base cargada", description: r.message ?? undefined });
  };

  const buildPayload = () => ({
    name: name.trim(),
    email: email.trim(),
    channels,
    ...(isVirtual
      ? {
          type: "virtual" as const,
          profileType,
          systemPrompt: systemPrompt || null,
          model,
          escalateToAgentId: escalateTo.startsWith("agent:") ? Number(escalateTo.slice(6)) : null,
          escalateToGroupId: escalateTo.startsWith("group:") ? Number(escalateTo.slice(6)) : null,
        }
      : { type: "human" as const, role }),
  });

  const handleCreate = () => {
    if (!name.trim() || !email.trim()) { toast({ title: "Nombre y correo son requeridos", variant: "destructive" }); return; }
    if (!isVirtual && password.length < 8) { toast({ title: "La contraseña debe tener al menos 8 caracteres", variant: "destructive" }); return; }
    createAgent.mutate(
      { data: { ...buildPayload(), ...(isVirtual ? {} : { password }) } },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          toast({ title: "Agente creado", description: isVirtual ? "Ahora puedes agregarle capacidades." : "Ya puede iniciar sesión." });
          setLocation(`/agents/${created.id}`);
        },
        onError: (e) => toast({ title: "No se pudo crear", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
      },
    );
  };

  const handleSave = () => {
    if (!agentId) return;
    const data: Record<string, unknown> = buildPayload();
    if (!isVirtual && password) data.password = password;
    updateAgent.mutate(
      { id: agentId, data: data as Parameters<typeof updateAgent.mutate>[0]["data"] },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          setPassword("");
          toast({ title: "Cambios guardados" });
        },
        onError: (e) => toast({ title: "No se pudo guardar", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
      },
    );
  };

  const otherAgents = (allAgents ?? []).filter((a) => a.id !== agentId);

  if (!isNew && isLoading) return <Layout><div className="p-6 text-sm text-muted-foreground">Cargando agente…</div></Layout>;
  if (!isNew && !agent) return <Layout><div className="p-6 text-sm text-muted-foreground">Agente no encontrado.</div></Layout>;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/agents" className="p-2 rounded-lg hover:bg-muted text-muted-foreground" data-testid="link-back-agents">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              {isVirtual ? <Sparkles className="w-5 h-5 text-primary" /> : <UserCog className="w-5 h-5 text-primary" />}
              {isNew ? (isVirtual ? "Nuevo agente" : role === "admin" ? "Nuevo administrador" : "Nuevo agente") : name || "Editar usuario"}
            </h1>
            <p className="text-sm text-muted-foreground">{isVirtual ? "Agente virtual con IA" : role === "admin" ? "Usuario administrador" : "Agente humano"}</p>
          </div>
          <Button onClick={isNew ? handleCreate : handleSave} disabled={createAgent.isPending || updateAgent.isPending} className="gap-2" data-testid="button-save-agent">
            <Save className="w-4 h-4" /> {isNew ? "Crear" : "Guardar"}
          </Button>
        </div>

        {/* Type toggle (create only) */}
        {isNew && (
          <div className="flex gap-2">
            {(["virtual", "human"] as const).map((t) => (
              <button key={t} onClick={() => setType(t)} className={cn("flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 text-sm font-medium transition-all", type === t ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground")} data-testid={`agent-type-${t}`}>
                {t === "virtual" ? <Bot className="w-4 h-4" /> : <UserCog className="w-4 h-4" />} {t === "virtual" ? "Virtual IA" : "Humano"}
              </button>
            ))}
          </div>
        )}

        {/* Basic */}
        <section className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Datos básicos</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Nombre</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={isVirtual ? "Sofía Ventas IA" : "Juan Pérez"} data-testid="input-agent-name" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Correo</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="agente@decolor.com" data-testid="input-agent-email" />
            </div>
          </div>
          {!isVirtual && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> Contraseña {isNew ? "de acceso" : "(dejar vacío para no cambiarla)"}</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" autoComplete="new-password" data-testid="input-agent-password" />
            </div>
          )}
          {!isVirtual && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Rol de acceso</label>
              <div className="grid grid-cols-2 gap-2">
                {(["admin", "agent"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={cn(
                      "flex items-center justify-center gap-2 py-2 rounded-xl border-2 text-sm font-medium transition-all",
                      role === r ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40",
                    )}
                    data-testid={`agent-role-${r}`}
                  >
                    {r === "admin" ? <Sparkles className="w-4 h-4 text-amber-500" /> : <UserCog className="w-4 h-4" />}
                    {r === "admin" ? "Administrador" : "Agente"}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {role === "admin"
                  ? "Un administrador arranca con todo el panel: usuarios, agentes, campañas y configuración."
                  : "Un agente arranca solo con la atención: sus chats, el Chat General y su perfil."}{" "}
                Es el punto de partida: las vistas que cada persona ve se eligen después en Administración, sea cual sea su rol.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Canales asignados</label>
            <ChannelToggle value={channels} onChange={setChannels} />
          </div>
        </section>

        {/* Virtual config */}
        {isVirtual && (
          <section className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Configuración de IA</h2>
            <div>
              <label className="text-xs font-medium mb-2 block">Perfil</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PROFILE_TEMPLATES.map((tpl) => (
                  <button key={tpl.id} type="button" onClick={() => { setProfileType(tpl.id); if (!name) setName(tpl.suggestedName); if (!email) setEmail(tpl.suggestedEmail); }}
                    className={cn("p-3 rounded-xl border-2 text-left transition-all", profileType === tpl.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")} data-testid={`profile-${tpl.id}`}>
                    <div className={cn("w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center mb-2", tpl.color)}><tpl.icon className="w-4 h-4 text-white" /></div>
                    <div className="text-xs font-semibold text-foreground">{tpl.name}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{tpl.description}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Modelo de IA</label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger data-testid="select-agent-model"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-5-nano">gpt-5-nano · rápido y económico</SelectItem>
                  <SelectItem value="gpt-5-mini">gpt-5-mini · balance (recomendado)</SelectItem>
                  <SelectItem value="gpt-5.4">gpt-5.4 · máxima calidad</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold"><Wand2 className="w-3.5 h-3.5 text-primary" /> Asistente de IA — redacta las instrucciones</div>
              <Textarea rows={2} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Describe qué debe hacer el agente…" className="text-sm bg-background/60" data-testid="textarea-brief" />
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={generatePrompt} disabled={assistPrompt.isPending} data-testid="button-generate-prompt">
                {assistPrompt.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-primary" />} Generar con IA
              </Button>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Instrucciones (system prompt)</label>
              <Textarea rows={5} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="Deja vacío para usar el prompt del perfil…" data-testid="textarea-system-prompt" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Escalar a (destino por defecto del agente)</label>
              <Select value={escalateTo} onValueChange={setEscalateTo}>
                <SelectTrigger data-testid="select-escalate-to"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin escalación automática</SelectItem>
                  {(groups ?? []).length > 0 && (
                    <>
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Grupos humanos</div>
                      {(groups ?? []).map((g) => <SelectItem key={`group-${g.id}`} value={`group:${g.id}`}>👥 {g.name}</SelectItem>)}
                    </>
                  )}
                  {otherAgents.length > 0 && (
                    <>
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Agentes</div>
                      {otherAgents.map((a) => <SelectItem key={`agent-${a.id}`} value={`agent:${a.id}`}>{a.type === "virtual" ? "🤖" : "👤"} {a.name}</SelectItem>)}
                    </>
                  )}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">Cuando el agente no pueda ayudar (o escale), deriva a este destino. Un grupo reparte entre sus humanos según su regla; el flujo (Workflow) además puede escalar por etiqueta.</p>
            </div>
          </section>
        )}

        {/* Capabilities */}
        <section className="bg-card border border-card-border rounded-2xl p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-primary" /> Capacidades</h2>
            <p className="text-xs text-muted-foreground">Habilidades del agente. Puedes describirlas con IA y enlazar una base de conocimiento.</p>
          </div>
          {isNew ? (
            <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">Guarda el agente primero para agregarle capacidades.</p>
          ) : (
            <div className="space-y-2">
              {(agent?.capabilities ?? []).map((cap) => <CapabilityRow key={cap.id} cap={cap} agentId={agentId!} />)}
              {(agent?.capabilities ?? []).length === 0 && <p className="text-xs text-muted-foreground">Aún no hay capacidades.</p>}
              <AddCapability agentId={agentId!} />
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
