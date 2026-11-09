import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  updateMyPresence,
  logout as logoutRequest,
  getListAgentsQueryKey,
  useListAgents,
  type Agent,
  type PresenceInputStatus,
} from "@workspace/api-client-react";
import { useAuth } from "./auth";

/**
 * Presence lives on a heartbeat: while a panel is open it tells the server it is
 * still there, and the server reports the agent offline as soon as the beats
 * stop. Must match HEARTBEAT_MS in the api-server's presence module — the server
 * tolerates one missed beat, so anything slower than this reads as disconnected.
 */
const HEARTBEAT_MS = 60_000;

/**
 * Keeps the signed-in agent visible as connected. Mount once per layout; every
 * account backed by an agent row beats, admins included, since they show up in
 * the same roster.
 */
export function usePresenceHeartbeat() {
  const { user } = useAuth();
  const agentId = user?.agentId ?? null;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!agentId) return;

    // A failed beat is not worth surfacing: the next one is a minute away and
    // the roster degrades to "offline" on its own if the panel really is gone.
    const beat = () => {
      updateMyPresence({})
        .then(() => queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() }))
        .catch(() => {});
    };

    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    // Coming back to a backgrounded tab, where the browser throttled the timer.
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [agentId, queryClient]);
}

/** The signed-in agent's own row, plus a way to change their availability. */
export function useMyPresence() {
  const { user } = useAuth();
  const agentId = user?.agentId ?? null;
  const queryClient = useQueryClient();

  const { data: agents } = useListAgents();
  const agent: Agent | undefined = agents?.find((a) => a.id === agentId);
  // Rendering this panel at all means the session is alive, so while the roster
  // is still loading we say online rather than flashing "desconectado" at an
  // agent who is plainly connected.
  const status = agent?.status ?? (agentId ? "online" : "offline");

  const setStatus = useCallback(
    async (status: PresenceInputStatus) => {
      await updateMyPresence({ status });
      await queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
    },
    [queryClient],
  );

  return { agent, status, setStatus };
}

/**
 * Signs out on the server before the local session is dropped, so the roster
 * stops showing the agent as connected right away instead of waiting for the
 * heartbeat to go stale. The token dies either way, so a failure is ignored.
 */
export async function endServerSession() {
  await logoutRequest().catch(() => {});
}
