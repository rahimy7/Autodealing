import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";

const { touchPresence, clearPresence, isConnected, HEARTBEAT_MS } = await import(
  "../src/lib/presence.js"
);
const { signToken } = await import("../src/lib/auth.js");
const { requireAuth } = await import("../src/middlewares/auth.js");

// The window the server allows before declaring an agent gone. Mirrors the
// module's own arithmetic so a change there fails loudly here.
const ONLINE_WINDOW_MS = HEARTBEAT_MS * 2.5;

describe("presence", () => {
  beforeEach(() => {
    clearPresence(1);
  });

  it("reports an agent that never checked in as disconnected", () => {
    assert.equal(isConnected(1), false);
  });

  it("reports an agent as connected right after a heartbeat", () => {
    touchPresence(1);
    assert.equal(isConnected(1), true);
  });

  it("tolerates one missed heartbeat", (t) => {
    touchPresence(1);
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + HEARTBEAT_MS * 2 });
    assert.equal(isConnected(1), true);
  });

  it("drops an agent whose panel stopped beating", (t) => {
    touchPresence(1);
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + ONLINE_WINDOW_MS + 1_000 });
    assert.equal(isConnected(1), false);
  });

  it("forgets an agent as soon as they sign out", () => {
    touchPresence(1);
    clearPresence(1);
    assert.equal(isConnected(1), false);
  });

  it("keeps agents apart", () => {
    touchPresence(1);
    assert.equal(isConnected(2), false);
    clearPresence(2);
    assert.equal(isConnected(1), true);
  });
});

// Presence is the session's, not one endpoint's: an agent who is using the panel
// stays connected even if the heartbeat timer never fires.
describe("requireAuth — presence", () => {
  function run(user: { role: "admin" | "agent"; agentId: number | null }): boolean {
    const req = {
      header: () => `Bearer ${signToken({ name: "Tester", email: "t@example.com", ...user })}`,
    } as unknown as Request;
    let passed = false;
    requireAuth(req, {} as Response, () => {
      passed = true;
    });
    return passed;
  }

  beforeEach(() => {
    clearPresence(7);
  });

  it("marks the agent connected on any authenticated request", () => {
    assert.equal(run({ role: "agent", agentId: 7 }), true);
    assert.equal(isConnected(7), true);
  });

  it("lets through a session with no agent row behind it", () => {
    assert.equal(run({ role: "admin", agentId: null }), true);
  });
});
