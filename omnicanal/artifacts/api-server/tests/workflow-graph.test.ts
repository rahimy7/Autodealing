import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { WorkflowGraph, WorkflowNode } from "@workspace/db";

const { resolveTargetFromLabel } = await import("../src/lib/workflow-graph.js");

const node = (
  id: string,
  data: WorkflowNode["data"],
): WorkflowNode => ({ id, position: { x: 0, y: 0 }, data });

describe("workflow-graph — resolveTargetFromLabel", () => {
  it("returns null when there is no label node for the given labelId", () => {
    const graph: WorkflowGraph = {
      nodes: [node("s", { kind: "start" })],
      edges: [],
    };
    assert.equal(resolveTargetFromLabel(graph, 99), null);
  });

  it("resolves a direct label → agent edge", () => {
    const graph: WorkflowGraph = {
      nodes: [
        node("L", { kind: "label", labelId: 5 }),
        node("A", { kind: "agent", agentId: 42 }),
      ],
      edges: [{ id: "e1", source: "L", target: "A" }],
    };
    const target = resolveTargetFromLabel(graph, 5);
    assert.ok(target);
    assert.equal(target!.data.kind, "agent");
    assert.equal(target!.data.agentId, 42);
  });

  it("resolves label → group when the first hop is a group node", () => {
    const graph: WorkflowGraph = {
      nodes: [
        node("L", { kind: "label", labelId: 1 }),
        node("G", { kind: "group", groupId: 7 }),
      ],
      edges: [{ id: "e1", source: "L", target: "G" }],
    };
    const target = resolveTargetFromLabel(graph, 1);
    assert.equal(target?.data.kind, "group");
    assert.equal(target?.data.groupId, 7);
  });

  it("resolves label → escalation when the first hop is an escalation node", () => {
    const graph: WorkflowGraph = {
      nodes: [
        node("L", { kind: "label", labelId: 2 }),
        node("E", { kind: "escalation" }),
      ],
      edges: [{ id: "e1", source: "L", target: "E" }],
    };
    const target = resolveTargetFromLabel(graph, 2);
    assert.equal(target?.data.kind, "escalation");
  });

  it("walks through intermediate label/start nodes to find a handling node (BFS)", () => {
    const graph: WorkflowGraph = {
      nodes: [
        node("L", { kind: "label", labelId: 10 }),
        node("Mid", { kind: "start" }), // intermediate, not a handling kind
        node("A", { kind: "agent", agentId: 99 }),
      ],
      edges: [
        { id: "e1", source: "L", target: "Mid" },
        { id: "e2", source: "Mid", target: "A" },
      ],
    };
    const target = resolveTargetFromLabel(graph, 10);
    assert.equal(target?.data.agentId, 99);
  });

  it("terminates on cycles without infinite loop", () => {
    const graph: WorkflowGraph = {
      nodes: [
        node("L", { kind: "label", labelId: 3 }),
        node("X", { kind: "start" }),
        node("Y", { kind: "start" }),
      ],
      edges: [
        { id: "e1", source: "L", target: "X" },
        { id: "e2", source: "X", target: "Y" },
        { id: "e3", source: "Y", target: "X" }, // cycle
      ],
    };
    // No handling node reachable → null, but must not hang.
    assert.equal(resolveTargetFromLabel(graph, 3), null);
  });

  it("returns null when the label has no outgoing edges", () => {
    const graph: WorkflowGraph = {
      nodes: [node("L", { kind: "label", labelId: 7 })],
      edges: [],
    };
    assert.equal(resolveTargetFromLabel(graph, 7), null);
  });

  it("ignores edges pointing to unknown nodes", () => {
    const graph: WorkflowGraph = {
      nodes: [node("L", { kind: "label", labelId: 8 })],
      edges: [{ id: "e1", source: "L", target: "ghost" }],
    };
    assert.equal(resolveTargetFromLabel(graph, 8), null);
  });

  it("handles an empty graph object defensively", () => {
    const empty = { nodes: [], edges: [] } as WorkflowGraph;
    assert.equal(resolveTargetFromLabel(empty, 1), null);
  });

  it("picks the handling node closest to the label (BFS ordering)", () => {
    // Two branches: one long (label→a→b→agentFar), one short (label→agentNear).
    // BFS must return agentNear because it is 1 hop away.
    const graph: WorkflowGraph = {
      nodes: [
        node("L", { kind: "label", labelId: 4 }),
        node("agentNear", { kind: "agent", agentId: 1 }),
        node("mid1", { kind: "start" }),
        node("mid2", { kind: "start" }),
        node("agentFar", { kind: "agent", agentId: 2 }),
      ],
      edges: [
        { id: "e1", source: "L", target: "mid1" },
        { id: "e2", source: "L", target: "agentNear" },
        { id: "e3", source: "mid1", target: "mid2" },
        { id: "e4", source: "mid2", target: "agentFar" },
      ],
    };
    const target = resolveTargetFromLabel(graph, 4);
    assert.equal(target?.data.agentId, 1);
  });
});
