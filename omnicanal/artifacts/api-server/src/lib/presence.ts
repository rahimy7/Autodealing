/**
 * Who is actually connected right now.
 *
 * The `status` column on an agent row records what the agent *chose* (available
 * or busy); it says nothing about whether their browser is still open. Liveness
 * belongs to the session and is kept here in memory: every authenticated request
 * refreshes it (see the requireAuth middleware), and the panel keeps beating on a
 * timer for the stretches where the agent is just reading. A closed tab stops
 * both and the agent goes offline on its own, without a stale "online" left
 * behind in the database.
 *
 * In-memory is deliberate. Presence is worth seconds, not a migration, and a
 * server restart only costs one heartbeat interval before every open panel
 * re-announces itself.
 */

// Clients beat every HEARTBEAT_MS; the window tolerates one missed beat plus
// network jitter before declaring the agent gone.
export const HEARTBEAT_MS = 60_000;
const ONLINE_WINDOW_MS = HEARTBEAT_MS * 2.5;

const lastSeen = new Map<number, number>();

/** Records a heartbeat from an agent. */
export function touchPresence(agentId: number): void {
  lastSeen.set(agentId, Date.now());
}

/** Drops an agent from the registry (sign-out). */
export function clearPresence(agentId: number): void {
  lastSeen.delete(agentId);
}

/** True while the agent's panel is still beating. */
export function isConnected(agentId: number): boolean {
  const seen = lastSeen.get(agentId);
  if (seen === undefined) return false;
  if (Date.now() - seen <= ONLINE_WINDOW_MS) return true;
  lastSeen.delete(agentId);
  return false;
}
