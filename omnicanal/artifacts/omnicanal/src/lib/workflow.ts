import { Tag, Bot, Users, ArrowUpRight, Zap } from "lucide-react";

// Node kinds in an escalation flow. `label` is the entry point (matched against
// the conversation's detected intent); the others are handling targets.
// `trigger` is the other kind of entry: instead of routing the message that just
// came in, it schedules a proactive follow-up run by the agent it connects to.
export type WfNodeKind = "label" | "agent" | "escalation" | "group" | "trigger";

export type WfTriggerEvent = "closed_no_sale" | "sale_closed" | "unanswered";

export interface WfNodeData {
  kind: WfNodeKind;
  title?: string | null;
  labelId?: number | null;
  agentId?: number | null;
  groupId?: number | null;
  event?: WfTriggerEvent | null;
  labelIds?: number[] | null;
  delayHours?: number | null;
  deliveryDays?: number | null;
  satisfactionDays?: number | null;
  repurchaseDays?: number | null;
  [key: string]: unknown;
}

// Lo que el editor explica de cada disparador. Los valores por defecto son los
// mismos que aplica el backend (TRIGGER_DEFAULTS en lib/followup-rules.ts).
export const TRIGGER_EVENTS: Record<WfTriggerEvent, { label: string; hint: string }> = {
  closed_no_sale: {
    label: "Chat cerrado sin venta",
    hint: "Al cerrarse un chat con una de las etiquetas elegidas, la IA lo lee; si no hubo venta y queda una oportunidad, el agente conectado le escribe al cliente pasadas las horas indicadas.",
  },
  sale_closed: {
    label: "Venta cerrada",
    hint: "Cuando el chat termina en venta (botón \"Venta cerrada\" o detectada por la IA), el agente conectado confirma la entrega, pide la opinión y recuerda la recompra en los días indicados. 0 apaga ese paso.",
  },
  unanswered: {
    label: "Cliente sin respuesta",
    hint: "Si el cliente escribió y nadie del equipo le contesta en las horas indicadas, el agente conectado le responde; pasadas 24h, con la plantilla retomar_conversacion.",
  },
};

export const TRIGGER_DEFAULTS = {
  closedNoSaleDelayHours: 3,
  unansweredDelayHours: 2,
  deliveryDays: 4,
  satisfactionDays: 12,
  repurchaseDays: 25,
} as const;

export const NODE_KIND_META: Record<
  WfNodeKind,
  { label: string; icon: typeof Tag; color: string; hint: string }
> = {
  label: {
    label: "Etiqueta",
    icon: Tag,
    color: "#14b8a6",
    hint: "Punto de entrada: la intención detectada del cliente.",
  },
  agent: {
    label: "Agente",
    icon: Bot,
    color: "#3b82f6",
    hint: "Deriva la conversación a un agente (humano o virtual).",
  },
  escalation: {
    label: "Escalar",
    icon: ArrowUpRight,
    color: "#f59e0b",
    hint: "Escala al destino configurado del agente actual, o a uno específico.",
  },
  group: {
    label: "Grupo",
    icon: Users,
    color: "#a855f7",
    hint: "Deriva a un grupo de agentes humanos (próximamente).",
  },
  trigger: {
    label: "Disparador",
    icon: Zap,
    color: "#ec4899",
    hint: "Punto de entrada proactivo: programa un seguimiento que ejecuta el agente virtual al que lo conectes.",
  },
};

export const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "#25D366",
  instagram: "#E1306C",
  facebook: "#1877F2",
};

// Stored graph shapes (kept minimal — a subset of reactflow's node/edge objects).
export interface WfNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: WfNodeData;
}
export interface WfEdge {
  id: string;
  source: string;
  target: string;
}
export interface WfGraph {
  nodes: WfNode[];
  edges: WfEdge[];
}

export function emptyGraph(): WfGraph {
  return { nodes: [], edges: [] };
}

export function newNodeId(kind: WfNodeKind): string {
  return `${kind}-${Math.random().toString(36).slice(2, 9)}`;
}
