import { eq, inArray, or, and, isNull } from "drizzle-orm";
import { db, deviceTokensTable, agentsTable, contactsTable, conversationsTable } from "@workspace/db";
import { sendFcm, isFcmConfigured } from "./push-fcm";
import { sendApns, isApnsConfigured } from "./push-apns";
import type { Log } from "./messaging";

type DeviceRow = typeof deviceTokensTable.$inferSelect;
type Conversation = typeof conversationsTable.$inferSelect;

// Notifications go straight to Google and Apple; there is no relay in between,
// so nothing here depends on a third-party account beyond the two OS gateways.
// Android channel the app creates on launch; the id must match.
const ANDROID_CHANNEL_ID = "messages";
// How many notifications are in flight at once. FCM v1 and APNs are both
// one-request-per-device, and a burst of a few hundred should not open a few
// hundred sockets.
const CONCURRENCY = 10;

// What the app does when the notification is tapped. Kept in the payload so the
// mobile client can deep-link straight into the conversation.
export type PushData = {
  type: "message" | "assignment" | "test";
  conversationId?: number;
  channel?: string;
};

export type PushPayload = {
  title: string;
  body: string;
  data: PushData;
  // Groups notifications from the same chat into a single Android/iOS thread so
  // a busy conversation doesn't bury the rest of the shade.
  threadId?: string;
};

// ── Device registry ───────────────────────────────────────────────────────────

/**
 * Sanity check on a device token before it reaches the registry. The real
 * verdict comes from FCM/APNs when the first notification is sent — this only
 * keeps obvious junk out of the table.
 *
 * APNs tokens are 64 hex characters (some devices report 100+); FCM tokens are
 * long opaque strings with `:` and `-` in them.
 */
export function isValidDeviceToken(token: string, platform: "ios" | "android" | "web"): boolean {
  const value = token.trim();
  if (value.length < 32 || value.length > 4096) return false;
  if (platform === "ios") return /^[0-9a-fA-F]+$/.test(value);
  return /^[\w:.~%-]+$/.test(value);
}

export async function registerDevice(input: {
  token: string;
  platform: "ios" | "android" | "web";
  deviceName: string | null;
  agentId: number | null;
  userEmail: string;
  role: string;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(deviceTokensTable)
    .values({
      token: input.token,
      platform: input.platform,
      deviceName: input.deviceName,
      agentId: input.agentId,
      userEmail: input.userEmail,
      role: input.role,
      lastSeenAt: now,
    })
    // A device only ever belongs to whoever logged in last on it: rebind the row
    // instead of leaving the previous user subscribed to someone else's chats.
    .onConflictDoUpdate({
      target: deviceTokensTable.token,
      set: {
        platform: input.platform,
        deviceName: input.deviceName,
        agentId: input.agentId,
        userEmail: input.userEmail,
        role: input.role,
        lastSeenAt: now,
      },
    });
}

export async function unregisterDevice(token: string): Promise<void> {
  await db.delete(deviceTokensTable).where(eq(deviceTokensTable.token, token));
}

export async function devicesForAgent(agentId: number): Promise<DeviceRow[]> {
  return db.select().from(deviceTokensTable).where(eq(deviceTokensTable.agentId, agentId));
}

// Every device whose session is an administrator: both human agents with role
// "admin" (they carry an agentId) and the environment administrator (agentId null).
export async function devicesForAdmins(): Promise<DeviceRow[]> {
  return db.select().from(deviceTokensTable).where(eq(deviceTokensTable.role, "admin"));
}

export async function devicesForUser(userEmail: string, agentId: number | null): Promise<DeviceRow[]> {
  return db
    .select()
    .from(deviceTokensTable)
    .where(
      agentId == null
        ? and(eq(deviceTokensTable.userEmail, userEmail), isNull(deviceTokensTable.agentId))
        : or(eq(deviceTokensTable.agentId, agentId), eq(deviceTokensTable.userEmail, userEmail)),
    );
}

// ── Delivery ──────────────────────────────────────────────────────────────────

/** Which gateways currently have credentials. Surfaced by the /push/test route. */
export function pushProviderStatus(): { fcm: boolean; apns: boolean } {
  return { fcm: isFcmConfigured(), apns: isApnsConfigured() };
}

async function deliverOne(
  device: DeviceRow,
  payload: PushPayload,
): Promise<{ status: "ok" } | { status: "unregistered" } | { status: "error"; message: string }> {
  if (device.platform === "ios") {
    return sendApns({
      token: device.token,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      threadId: payload.threadId,
    });
  }
  if (device.platform === "android") {
    return sendFcm({
      token: device.token,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      channelId: ANDROID_CHANNEL_ID,
      tag: payload.threadId,
    });
  }
  return { status: "error", message: `Plataforma sin soporte de push: ${device.platform}` };
}

/**
 * Delivers a payload to a set of registered devices, each through its own OS
 * gateway. Tokens the gateway reports as unknown are dropped from the registry,
 * so an uninstalled app stops being retried forever.
 *
 * Never throws: a notification failing must not break message ingestion or the
 * HTTP request that triggered it.
 */
export async function sendPush(devices: DeviceRow[], payload: PushPayload, log: Log): Promise<number> {
  if (devices.length === 0) return 0;

  let delivered = 0;
  const dead: string[] = [];
  const queue = [...devices];

  const worker = async () => {
    for (let device = queue.shift(); device; device = queue.shift()) {
      try {
        const result = await deliverOne(device, payload);
        if (result.status === "ok") {
          delivered += 1;
        } else if (result.status === "unregistered") {
          dead.push(device.token);
        } else {
          log.error({ platform: device.platform, error: result.message }, "push delivery failed");
        }
      } catch (err) {
        log.error({ err, platform: device.platform }, "push delivery threw");
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, devices.length) }, worker));

  if (dead.length > 0) {
    await db
      .delete(deviceTokensTable)
      .where(inArray(deviceTokensTable.token, dead))
      .catch((err: unknown) => log.error({ err }, "could not prune dead push tokens"));
    log.info({ count: dead.length }, "pruned unregistered push tokens");
  }

  return delivered;
}

// ── Notification builders ─────────────────────────────────────────────────────

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

function preview(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

async function contactNameFor(conv: Pick<Conversation, "contactId">): Promise<string> {
  if (!conv.contactId) return "Cliente";
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, conv.contactId));
  return contact?.name ?? "Cliente";
}

// A chat a virtual agent is answering fine is not something anyone has to act on,
// so by default it stays out of the administrators' phones. Set this to "true" to
// mirror every inbound message to them regardless.
const NOTIFY_ADMINS_ON_BOT_CHATS = process.env.PUSH_NOTIFY_ADMINS_ON_BOT_CHATS === "true";

/**
 * A customer wrote in. The chat's human owner gets it. When no person owns it,
 * the administrators do — but only if the chat actually needs a human: one a
 * virtual agent is handling is skipped unless PUSH_NOTIFY_ADMINS_ON_BOT_CHATS
 * says otherwise.
 */
export async function notifyInboundMessage(
  conv: Pick<Conversation, "id" | "channel" | "contactId" | "agentId" | "status">,
  text: string,
  log: Log,
): Promise<void> {
  try {
    let devices: DeviceRow[] = [];

    if (conv.agentId) {
      const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, conv.agentId));
      if (agent?.type === "human") {
        devices = await devicesForAgent(agent.id);
      } else if (agent && !NOTIFY_ADMINS_ON_BOT_CHATS && conv.status !== "pending") {
        return;
      }
    }
    // Nobody to reach: either the chat has no human owner, or its owner has not
    // installed the app. Either way a customer is waiting, so it goes to the
    // administrators rather than to nobody.
    if (devices.length === 0) devices = await devicesForAdmins();
    if (devices.length === 0) return;

    const name = await contactNameFor(conv);
    const channel = CHANNEL_LABEL[conv.channel] ?? conv.channel;

    await sendPush(
      devices,
      {
        title: `${name} · ${channel}`,
        body: preview(text) || "Nuevo mensaje",
        data: { type: "message", conversationId: conv.id, channel: conv.channel },
        threadId: `conversation-${conv.id}`,
      },
      log,
    );
  } catch (err) {
    log.error({ err, conversationId: conv.id }, "inbound push notification failed");
  }
}

/**
 * A chat landed on someone's plate — by an admin assigning it, by an escalation,
 * or by a workflow routing rule. Only human agents are notified; virtual ones
 * have no device.
 */
export async function notifyChatAssigned(
  conv: Pick<Conversation, "id" | "channel" | "contactId">,
  agentId: number,
  reason: string,
  log: Log,
): Promise<void> {
  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (!agent || agent.type !== "human" || !agent.isActive) return;

    const devices = await devicesForAgent(agent.id);
    if (devices.length === 0) return;

    const name = await contactNameFor(conv);
    const channel = CHANNEL_LABEL[conv.channel] ?? conv.channel;

    await sendPush(
      devices,
      {
        title: "Chat asignado",
        body: `${name} · ${channel} — ${reason}`,
        data: { type: "assignment", conversationId: conv.id, channel: conv.channel },
        threadId: `conversation-${conv.id}`,
      },
      log,
    );
  } catch (err) {
    log.error({ err, conversationId: conv.id, agentId }, "assignment push notification failed");
  }
}

/**
 * A chat was parked in a group queue with nobody assigned. Supervisors need to
 * see it, so it goes to the administrators.
 */
export async function notifyChatQueued(
  conv: Pick<Conversation, "id" | "channel" | "contactId">,
  groupName: string,
  log: Log,
): Promise<void> {
  try {
    const devices = await devicesForAdmins();
    if (devices.length === 0) return;

    const name = await contactNameFor(conv);
    await sendPush(
      devices,
      {
        title: "Chat en cola",
        body: `${name} está esperando en el grupo "${groupName}".`,
        data: { type: "assignment", conversationId: conv.id, channel: conv.channel },
        threadId: `conversation-${conv.id}`,
      },
      log,
    );
  } catch (err) {
    log.error({ err, conversationId: conv.id }, "queued push notification failed");
  }
}
