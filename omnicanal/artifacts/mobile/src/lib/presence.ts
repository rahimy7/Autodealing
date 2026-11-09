import { useEffect } from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { updateMyPresence, getListAgentsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "./auth";

/**
 * Must match HEARTBEAT_MS in the api-server's presence module: the server
 * tolerates one missed beat before reporting the agent as disconnected.
 */
const HEARTBEAT_MS = 60_000;

/**
 * Reports the signed-in agent as connected while the app is in the foreground.
 * Backgrounding the app stops the beats, and the roster shows them offline a
 * couple of minutes later — the same rule the web panel follows for a closed
 * tab. Push notifications keep working either way.
 */
export function usePresenceHeartbeat() {
  const { user } = useAuth();
  const agentId = user?.agentId ?? null;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!agentId) return;

    // A dropped beat is not worth surfacing: the next one is a minute away.
    const beat = () => {
      updateMyPresence({})
        .then(() => queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() }))
        .catch(() => {});
    };

    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    // Timers do not fire reliably while the app is backgrounded, so coming back
    // to the foreground announces the agent again right away.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") beat();
    });

    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [agentId, queryClient]);
}
