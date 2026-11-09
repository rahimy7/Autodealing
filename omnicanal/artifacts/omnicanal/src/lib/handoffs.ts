import { useSyncExternalStore } from "react";

/**
 * The chats that were just handed to the signed-in user and that they have not
 * acknowledged yet — what the ribbon across the top of the panel shows.
 *
 * A transfer is the one alert that must not be missed: the customer is already
 * waiting and nobody else is going to answer. So unlike the chime and the system
 * banner, which are gone in a second, this one persists — across screens and
 * across a reload — until the agent opens the chat or dismisses it by hand.
 */

export type Handoff = {
  conversationId: number;
  /** Headline for the ribbon, e.g. "Te transfirieron un chat". */
  title: string;
  contactName: string;
  channel: string;
  at: number;
};

const STORAGE_PREFIX = "omniai_handoffs";
// A ribbon from yesterday's shift helps nobody; older entries are dropped on load.
const MAX_AGE_MS = 8 * 60 * 60 * 1000;
// Long enough to cover the poll that follows a chat the user took themselves:
// it lands in their list like any other arrival, but they already know about it.
const MUTE_MS = 2 * 60 * 1000;

const listeners = new Set<() => void>();
const muted = new Map<number, number>();

// Two people share a machine more often than you would think in a contact
// centre, and one agent's pending transfers must not greet the next one.
let owner: string | null = null;
let handoffs: Handoff[] = [];

function storageKey(): string {
  return `${STORAGE_PREFIX}:${owner ?? "anon"}`;
}

function load(): Handoff[] {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const cutoff = Date.now() - MAX_AGE_MS;
    return (JSON.parse(raw) as Handoff[])
      .filter((h) => typeof h?.conversationId === "number" && typeof h.at === "number" && h.at > cutoff)
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

function publish(next: Handoff[]) {
  handoffs = next;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(next));
  } catch {
    // A full or blocked storage costs persistence, not the ribbon itself.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Points the store at one account's ribbon. Called by the alert watcher. */
export function setHandoffOwner(next: string | null) {
  if (next === owner) return;
  owner = next;
  handoffs = load();
  listeners.forEach((l) => l());
}

/** Adds a transfer to the ribbon. Ignores duplicates and muted chats. */
export function raiseHandoff(handoff: Omit<Handoff, "at">) {
  const mutedUntil = muted.get(handoff.conversationId);
  if (mutedUntil !== undefined) {
    if (mutedUntil > Date.now()) return;
    muted.delete(handoff.conversationId);
  }
  if (handoffs.some((h) => h.conversationId === handoff.conversationId)) return;
  publish([{ ...handoff, at: Date.now() }, ...handoffs]);
}

/** The agent has seen it: opened the chat, or closed the ribbon. */
export function dismissHandoff(conversationId: number) {
  if (!handoffs.some((h) => h.conversationId === conversationId)) return;
  publish(handoffs.filter((h) => h.conversationId !== conversationId));
}

export function dismissAllHandoffs() {
  if (handoffs.length === 0) return;
  publish([]);
}

/**
 * Keeps a chat out of the ribbon for the next couple of polls. For chats the
 * user brought on themselves — taking one from the general panel — which reach
 * their inbox by the same route as a transfer but need no announcement.
 */
export function muteHandoff(conversationId: number) {
  muted.set(conversationId, Date.now() + MUTE_MS);
  dismissHandoff(conversationId);
}

export function useHandoffs(): Handoff[] {
  return useSyncExternalStore(subscribe, () => handoffs);
}
