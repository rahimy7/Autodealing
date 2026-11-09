import type { WorkflowGraph, WorkflowNode, WorkflowTriggerEvent } from "@workspace/db";

// Un disparador listo para usar: el nodo con su configuración y el agente que lo
// ejecuta (el primer nodo "agent" al que está conectado).
export type ResolvedTrigger = { trigger: WorkflowNode; agentId: number };

// Los disparadores de un evento en un flujo. Un disparador sin agente conectado
// no hace nada — no hay quién escriba — así que no se devuelve.
export function triggersForEvent(graph: WorkflowGraph, event: WorkflowTriggerEvent): ResolvedTrigger[] {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: ResolvedTrigger[] = [];
  for (const node of nodes) {
    if (node.data?.kind !== "trigger" || node.data.event !== event) continue;
    const agent = edges
      .filter((e) => e.source === node.id)
      .map((e) => byId.get(e.target))
      .find((n) => n?.data?.kind === "agent" && typeof n.data.agentId === "number");
    if (agent) out.push({ trigger: node, agentId: agent.data.agentId! });
  }
  return out;
}

// Días/horas configurados en un nodo, con el valor por defecto cuando el campo
// está vacío o no es un número razonable. Cero es válido: apaga ese paso.
export function triggerNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Walks the flow forward from the label node until it reaches a handling node
// (agent/group/escalation). Breadth-first with a visited set so cycles terminate.
// Pure function — no DB, no I/O — kept in its own module so it can be unit-tested
// without pulling in the database layer.
export function resolveTargetFromLabel(
  graph: WorkflowGraph,
  labelId: number,
): WorkflowNode | null {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const start = nodes.find(
    (n) => n.data?.kind === "label" && n.data?.labelId === labelId,
  );
  if (!start) return null;

  const visited = new Set<string>();
  const queue: string[] = [start.id];
  while (queue.length) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const e of edges.filter((edge) => edge.source === cur)) {
      const next = byId.get(e.target);
      if (!next) continue;
      const kind = next.data?.kind;
      if (kind === "agent" || kind === "group" || kind === "escalation") return next;
      queue.push(next.id);
    }
  }
  return null;
}
