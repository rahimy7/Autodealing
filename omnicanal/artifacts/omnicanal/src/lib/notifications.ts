import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import {
  useListAgents,
  useListConversations,
  getListAgentsQueryKey,
  getListConversationsQueryKey,
  type Conversation,
} from "@workspace/api-client-react";
import { chatInboxPath, useAuth } from "./auth";
import { raiseHandoff, setHandoffOwner } from "./handoffs";
import { toast } from "@/hooks/use-toast";

/**
 * Desk alerts: a chime plus a system banner when a chat lands on the signed-in
 * user's plate or a customer writes into one of their chats.
 *
 * Detection is client-side, off the same conversation list the inboxes already
 * poll: the platform has no realtime channel, and a diff between two polls says
 * exactly what changed. That also means alerts only fire while the panel is
 * open — the phone app is what covers a closed browser.
 */

// Same cadence the inboxes poll at, so an alert never lags behind the list.
const POLL_MS = 8_000;
const STORAGE_KEY = "omniai_notifications";

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

// ── Preference, shared between the bell button and the watcher ────────────────

type Preference = { enabled: boolean; permission: NotificationPermission | "unsupported" };

const listeners = new Set<() => void>();

function currentPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

let preference: Preference = {
  // On by default: an agent who never touches the bell still hears the chat that
  // was just handed to them. The system banner still waits for permission.
  enabled: localStorage.getItem(STORAGE_KEY) !== "off",
  permission: currentPermission(),
};

function publish(next: Preference) {
  preference = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNotificationPreference() {
  const value = useSyncExternalStore(subscribe, () => preference);

  /**
   * Turning alerts on doubles as the user gesture browsers require: it is the
   * moment we may ask for permission and unlock audio playback.
   */
  const toggle = useCallback(async () => {
    if (value.enabled) {
      localStorage.setItem(STORAGE_KEY, "off");
      publish({ ...preference, enabled: false });
      return;
    }

    localStorage.setItem(STORAGE_KEY, "on");
    primeChime();
    let permission = currentPermission();
    if (permission === "default") {
      permission = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
    }
    publish({ enabled: true, permission });
  }, [value.enabled]);

  return { ...value, toggle };
}

// ── Sound ─────────────────────────────────────────────────────────────────────

let audioContext: AudioContext | null = null;

function ensureAudioContext(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audioContext ??= new Ctor();
  return audioContext;
}

/**
 * Browsers hand out a suspended AudioContext until the page has been clicked,
 * so the first chime would be swallowed. Called from the bell button.
 */
export function primeChime() {
  void ensureAudioContext()?.resume().catch(() => {});
}

/**
 * Notes are synthesised rather than loaded: no asset to bundle, no request to
 * make, and the sound plays the instant a chat comes in.
 *
 * `notes` are [frequency in Hz, seconds from now, peak gain] triples.
 */
function playNotes(notes: [number, number, number][]) {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  void ctx.resume().catch(() => {});

  const start = ctx.currentTime;
  for (const [frequency, delay, peak] of notes) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    // Exponential ramps: a plain on/off would click.
    gain.gain.setValueAtTime(0.0001, start + delay);
    gain.gain.exponentialRampToValueAtTime(peak, start + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.24);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start + delay);
    oscillator.stop(start + delay + 0.26);
  }
}

/** Two short notes: a customer wrote in a chat that is already yours. */
export function playChime() {
  playNotes([
    [880, 0, 0.2],
    [1174.66, 0.13, 0.2],
  ]);
}

/**
 * A transfer deserves its own sound, so an agent can tell "someone wrote" from
 * "this is yours now" without looking: a rising three-note phrase, played twice
 * and a touch louder than the message chime.
 */
export function playHandoffChime() {
  playNotes([
    [659.25, 0, 0.24],
    [830.61, 0.14, 0.24],
    [987.77, 0.28, 0.28],
    [659.25, 0.62, 0.2],
    [987.77, 0.76, 0.24],
  ]);
}

// ── The conversation the user is looking at ───────────────────────────────────

// A message arriving in the thread that is open on screen is already visible;
// alerting about it would only be noise.
let openConversationId: number | null = null;

/** Declares which thread the current screen has open. Clears on unmount. */
export function useOpenConversation(id: number | null) {
  useEffect(() => {
    openConversationId = id;
    return () => {
      if (openConversationId === id) openConversationId = null;
    };
  }, [id]);
}

// ── Watcher ───────────────────────────────────────────────────────────────────

type Alert = {
  conversationId: number;
  title: string;
  body: string;
  // A handoff is a chat that just landed on the user's plate; it gets the ribbon
  // and its own sound. A message is a customer writing into a chat they own.
  kind: "handoff" | "message";
  contactName: string;
  channel: string;
};

function describe(conv: Conversation): string {
  const channel = CHANNEL_LABELS[conv.channel] ?? conv.channel;
  return `${conv.contactName ?? "Cliente"} · ${channel}`;
}

/**
 * Raises the alerts for one poll: chats that just appeared were handed over,
 * chats whose unread counter grew received a customer message. `unreadCount`
 * only ever grows on an inbound message, so nothing the user sends can trigger
 * an alert on their own screen.
 */
export function diffConversations(
  previous: Map<number, number>,
  conversations: Conversation[],
  isRelevant: (conv: Conversation) => boolean,
  arrivalTitle: string,
): Alert[] {
  const alerts: Alert[] = [];
  for (const conv of conversations) {
    if (!isRelevant(conv)) continue;
    const common = {
      conversationId: conv.id,
      contactName: conv.contactName ?? "Cliente",
      channel: CHANNEL_LABELS[conv.channel] ?? conv.channel,
    };
    const before = previous.get(conv.id);
    if (before === undefined) {
      alerts.push({ ...common, kind: "handoff", title: arrivalTitle, body: describe(conv) });
    } else if (conv.unreadCount > before && conv.id !== openConversationId) {
      alerts.push({
        ...common,
        kind: "message",
        title: describe(conv),
        body: conv.lastMessage?.trim() || "Nuevo mensaje",
      });
    }
  }
  return alerts;
}

/**
 * Watches the signed-in user's chats and alerts on the two things that need
 * them at the desk. Mount once per layout.
 *
 * An account backed by an agent row watches its own chats. An administrator
 * without one has nothing assigned to them, so they watch the chats waiting for
 * a human instead — the same split the phone notifications make.
 */
export function useChatNotifications() {
  const { user, views } = useAuth();
  const [, setLocation] = useLocation();
  const { enabled, permission } = useNotificationPreference();

  const agentId = user?.agentId ?? null;
  const supervising = agentId === null && user?.role === "admin";
  // Dónde se abre el chat al pulsar el aviso: el agente de servicio contesta en el
  // Chat General, un supervisor en la bandeja del panel.
  const inboxPath = chatInboxPath(user?.role ?? "agent", views);
  const active = agentId !== null || supervising;

  const params = agentId !== null ? { agentId } : {};
  const { data: conversations } = useListConversations(params, {
    query: {
      queryKey: getListConversationsQueryKey(params),
      refetchInterval: POLL_MS,
      refetchOnWindowFocus: true,
      staleTime: 0,
      enabled: active,
    },
  });
  // Only needed to tell a bot-owned chat from a human-owned one when supervising.
  const { data: agents } = useListAgents({
    query: { queryKey: getListAgentsQueryKey(), enabled: supervising },
  });

  const seen = useRef<Map<number, number> | null>(null);

  // The ribbon outlives a reload, so it is stored per account: whoever signs in
  // next must not inherit the transfers of whoever used this browser before.
  useEffect(() => {
    setHandoffOwner(user?.email ?? null);
  }, [user?.email]);

  // Re-running this on anything other than fresh data is harmless: the baseline
  // is refreshed first, so a second pass over the same list finds no changes.
  useEffect(() => {
    if (!active || !conversations) return;

    const previous = seen.current;
    seen.current = new Map(conversations.map((c) => [c.id, c.unreadCount]));
    // The first poll of a session only establishes the baseline — reloading the
    // panel must not replay every chat as if it had just arrived.
    if (!previous || !enabled) return;

    const isRelevant = (conv: Conversation) => {
      if (agentId !== null) return conv.agentId === agentId;
      // Supervising: a chat a virtual agent is answering is not waiting on
      // anyone, unless it has been parked as pending.
      if (!conv.agentId) return true;
      const owner = agents?.find((a) => a.id === conv.agentId);
      return owner?.type === "virtual" && conv.status === "pending";
    };

    // Nobody assigned anything to a supervisor: their chats are the ones nobody
    // has picked up yet.
    const arrivalTitle = agentId !== null ? "Te transfirieron un chat" : "Chat en espera";

    for (const alert of diffConversations(previous, conversations, isRelevant, arrivalTitle)) {
      const { conversationId, title, body, kind } = alert;
      if (kind === "handoff") {
        // The ribbon is the alert that stays; the chime and the banner below only
        // make sure the agent looks up when it appears.
        playHandoffChime();
        raiseHandoff({
          conversationId,
          title,
          contactName: alert.contactName,
          channel: alert.channel,
        });
      } else {
        playChime();
      }
      if (permission !== "granted") {
        // No system banner available. A handoff already has the ribbon on screen;
        // a message would otherwise go unannounced, so it falls back to a toast.
        if (kind === "message") toast({ title, description: body });
        continue;
      }
      // Tagging by thread means a chatty customer replaces their own banner
      // instead of stacking a dozen of them.
      const banner = new Notification(title, {
        body,
        tag: `conversation-${conversationId}`,
        renotify: true,
      } as NotificationOptions);
      banner.onclick = () => {
        window.focus();
        setLocation(`${inboxPath}?conv=${conversationId}`);
        banner.close();
      };
    }
  }, [conversations, enabled, active, permission, agentId, agents, inboxPath, setLocation]);
}
