// Aggregation logic for the admin reports overview. Kept apart from the route
// so the CSV export can reuse the exact same numbers and so the pure functions
// remain unit-testable in isolation.
//
// Qué entra en un periodo. Una conversación de chat es una sola fila por
// contacto y canal que se reabre en cada sesión, y un hilo de correo junta todo
// lo que se habló con esa persona: ninguno de los dos "nace" el día en que el
// cliente escribe. Por eso el periodo se decide por la actividad y no por la
// fecha de creación — entra la conversación que tuvo algún mensaje (o se
// resolvió) dentro del rango, y de ella solo cuentan los mensajes de esas
// fechas —. Los días son los del negocio (APP_TIMEZONE), no los de UTC.
import {
  db,
  conversationsTable,
  campaignsTable,
  messagesTable,
  labelsTable,
  agentsTable,
  emailThreadsTable,
  emailMessagesTable,
} from "@workspace/db";
import type { Conversation, Message, Agent, Label, Campaign, EmailThread, EmailMessage } from "@workspace/db";
import { APP_TIMEZONE, addDaysToKey, localDayKey, startOfLocalDay } from "./time";

const CHANNELS = ["whatsapp", "instagram", "facebook", "email"] as const;
type Channel = (typeof CHANNELS)[number];
// Las campañas solo salen por los canales de Meta.
const CAMPAIGN_CHANNELS = ["whatsapp", "instagram", "facebook"] as const;

// Gap that separates one active work window from the next when reconstructing
// agent activity from raw message timestamps.
const ACTIVITY_GAP_MINUTES = 15;
// Reference length of a business day used to normalize utilization.
const BUSINESS_DAY_MINUTES = 8 * 60;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

const round0 = (n: number): number => Math.round(n);
const round1 = (n: number): number => Math.round(n * 10) / 10;
const avgOf = (xs: number[]): number => (xs.length === 0 ? 0 : round1(xs.reduce((a, b) => a + b, 0) / xs.length));
const pct = (part: number, whole: number): number => (whole ? round0((part / whole) * 100) : 0);

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// Sum of gaps between consecutive timestamps, treating any gap larger than the
// activity-window threshold as a session boundary (contributes zero).
export function activeMinutesFromTimestamps(sortedMs: number[]): number {
  if (sortedMs.length === 0) return 0;
  if (sortedMs.length === 1) return 1;
  let total = 0;
  for (let i = 1; i < sortedMs.length; i++) {
    const gap = (sortedMs[i] - sortedMs[i - 1]) / 60_000;
    if (gap <= ACTIVITY_GAP_MINUTES) total += gap;
    else total += 1;
  }
  return total;
}

// Detection of internal-note events. Content strings are the ones emitted by
// conversations.ts, workflow-engine.ts and conversation-session.ts.
export function isTakeoverNote(m: Message): boolean {
  return m.isInternal && /tomó la conversación/i.test(m.content);
}

export function isEscalationNote(m: Message): boolean {
  return m.isInternal && (/^🔁 Escalado/i.test(m.content) || /🔀 Derivado/i.test(m.content) || /🔀 En cola/i.test(m.content));
}

export function isReopenNote(m: Message): boolean {
  return m.isInternal && /^🆕 Nueva conversación/i.test(m.content);
}

// "Cerrada al resolverse" la deja el cierre de la sesión; "marcada como resuelta",
// la resolución de una sesión que ya se había cerrado por inactividad.
export function isResolveNote(m: Message): boolean {
  return m.isInternal && /^🔚 Conversación (cerrada al resolverse|marcada como resuelta)/i.test(m.content);
}

// La IA describe la venta con "detectó una venta cerrada" (followups.ts) y el
// agente humano con "marcó la venta como cerrada" desde el botón del chat; ambas
// notas dejan la venta en pie. Desmarcarla deja "desmarcó la venta", que no
// matchea, así que no resta una venta ya contada en un día anterior.
export function isSaleClosedNote(m: Message): boolean {
  return m.isInternal && /marcó la venta como cerrada|detectó una venta cerrada/i.test(m.content);
}

export type ReportsWindow = {
  from: Date;
  to: Date;
  fromKey: string;
  toKey: string;
  days: number;
  timeZone: string;
};

/**
 * El rango del reporte en días del negocio. `from` y `to` son días "YYYY-MM-DD"
 * inclusivos (el mismo día en los dos pide solo ese día); sin ellos, los últimos
 * `days` días contando hoy.
 */
export function resolveWindow(
  input: { days?: number | null; from?: string | null; to?: string | null },
  opts: { now?: Date; timeZone?: string } = {},
): ReportsWindow {
  const timeZone = opts.timeZone ?? APP_TIMEZONE;
  let fromKey: string;
  let toKey: string;

  if (input.from && input.to && DAY_KEY.test(input.from) && DAY_KEY.test(input.to)) {
    [fromKey, toKey] = input.from <= input.to ? [input.from, input.to] : [input.to, input.from];
  } else {
    const requested = input.days != null && Number.isFinite(input.days) ? input.days : 30;
    const days = Math.min(Math.max(Math.trunc(requested), 1), 365);
    toKey = localDayKey(opts.now ?? new Date(), timeZone);
    fromKey = addDaysToKey(toKey, -(days - 1));
  }

  const from = startOfLocalDay(fromKey, timeZone);
  const to = new Date(startOfLocalDay(addDaysToKey(toKey, 1), timeZone).getTime() - 1);
  const days = Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000) + 1;
  return { from, to, fromKey, toKey, days, timeZone };
}

const heatmapFormatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Bucket a Date into (dayOfWeek, hour) in the business timezone.
export function heatmapBucket(d: Date, timeZone: string = APP_TIMEZONE): { dayOfWeek: number; hour: number } {
  let fmt = heatmapFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hour12: false });
    heatmapFormatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const hour = Number.parseInt(hourStr, 10) % 24;
  return { dayOfWeek: WEEKDAY_INDEX[weekday] ?? 0, hour: Number.isFinite(hour) ? hour : 0 };
}

// ── Modelo común a chat y correo ─────────────────────────────────────────────

type Sender = "contact" | "agent" | "bot";
type Traffic = { at: number; sender: Sender };

// Una conversación de cualquier canal reducida a lo que los reportes miden.
type ReportThread = {
  key: string;
  channel: Channel;
  contactId: number | null;
  agentId: number | null;
  labelId: number | null;
  localityLabelId: number | null;
  // Primera vez que se supo de este cliente por esta vía.
  firstSeenAt: number;
  // Mensajes que de verdad se cruzaron con el cliente, en orden, de todo el historial.
  traffic: Traffic[];
  // Notas internas del panel (solo chat): tomas, escalados, reaperturas.
  notes: Message[];
  // Inicio de cada sesión posterior a la primera (solo chat).
  sessionStarts: number[];
  // Momentos en que se resolvió, en orden.
  resolvedAt: number[];
  // Chat: se mide la primera respuesta de cada sesión. Correo: cada correo del
  // cliente que llega sin nada pendiente es una solicitud nueva.
  onePerSession: boolean;
  // Desde cuándo espera ahora mismo a que alguien lo atienda (null: no espera).
  pendingSince: number | null;
};

export type ReportEmailMessage = Pick<
  EmailMessage,
  "threadId" | "direction" | "authorAgentId" | "isDraft" | "isInternal" | "sentAt" | "createdAt"
>;

function chatThreads(convs: Conversation[], msgs: Message[]): ReportThread[] {
  const byConv = new Map<number, Message[]>();
  for (const m of msgs) {
    const arr = byConv.get(m.conversationId);
    if (arr) arr.push(m);
    else byConv.set(m.conversationId, [m]);
  }

  return convs.map((c) => {
    const rows = (byConv.get(c.id) ?? []).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const traffic: Traffic[] = [];
    const notes: Message[] = [];
    for (const m of rows) {
      if (m.isInternal) notes.push(m);
      // Lo que Meta rechazó nunca le llegó al cliente: no es envío ni respuesta.
      else if (m.sender === "contact" || m.status !== "failed") traffic.push({ at: m.createdAt.getTime(), sender: m.sender });
    }

    const resolvedAt = notes.filter(isResolveNote).map((n) => n.createdAt.getTime());
    // Las resoluciones anteriores a la nota "marcada como resuelta" solo dejaron
    // el estado y la fecha en que se tocó la conversación.
    if (c.status === "resolved") resolvedAt.push(c.updatedAt.getTime());

    let pendingSince: number | null = null;
    if (c.status === "pending" && c.agentId == null) {
      // En cola desde que el flujo la mandó al grupo en esta sesión.
      const sessionStart = c.sessionStartedAt.getTime();
      const queued = notes.filter((n) => isEscalationNote(n) && n.createdAt.getTime() >= sessionStart).at(-1);
      pendingSince = queued?.createdAt.getTime() ?? sessionStart;
    }

    return {
      key: `chat:${c.id}`,
      channel: c.channel,
      contactId: c.contactId,
      agentId: c.agentId,
      labelId: c.labelId,
      localityLabelId: c.localityLabelId,
      firstSeenAt: Math.min(c.createdAt.getTime(), traffic[0]?.at ?? Infinity),
      traffic,
      notes,
      sessionStarts: notes.filter(isReopenNote).map((n) => n.createdAt.getTime()),
      resolvedAt: resolvedAt.sort((a, b) => a - b),
      onePerSession: true,
      pendingSince,
    };
  });
}

function emailReportThreads(threads: EmailThread[], msgs: ReportEmailMessage[], agents: Agent[]): ReportThread[] {
  const virtualAgents = new Set(agents.filter((a) => a.type === "virtual").map((a) => a.id));
  const byThread = new Map<number, Traffic[]>();
  for (const m of msgs) {
    // Los borradores sin enviar y las notas del panel nunca salieron por correo.
    if (m.isDraft || m.isInternal) continue;
    const sender: Sender =
      m.direction === "in" ? "contact" : m.authorAgentId != null && virtualAgents.has(m.authorAgentId) ? "bot" : "agent";
    // La fecha del correo y no la de su importación: al importar el buzón llegan
    // correos de meses atrás.
    const entry = { at: (m.sentAt ?? m.createdAt).getTime(), sender };
    const arr = byThread.get(m.threadId);
    if (arr) arr.push(entry);
    else byThread.set(m.threadId, [entry]);
  }

  return threads.map((t) => {
    const traffic = (byThread.get(t.id) ?? []).sort((a, b) => a.at - b.at);
    let pendingSince: number | null = null;
    if (t.status === "open") {
      for (const m of traffic) {
        if (m.sender !== "contact") pendingSince = null;
        else if (pendingSince === null) pendingSince = m.at;
      }
    }
    return {
      key: `email:${t.id}`,
      channel: "email",
      contactId: t.contactId,
      agentId: t.agentId,
      labelId: t.labelId,
      localityLabelId: null,
      firstSeenAt: Math.min(t.createdAt.getTime(), traffic[0]?.at ?? Infinity),
      traffic,
      notes: [],
      sessionStarts: [],
      // El correo no guarda cada resolución: solo el estado actual y su fecha.
      resolvedAt: t.status === "resolved" ? [t.updatedAt.getTime()] : [],
      onePerSession: false,
      pendingSince,
    };
  });
}

// Cada vez que el cliente quedó esperando y cuándo se le contestó (null: nunca).
function customerWaits(thread: ReportThread): { from: number; reply: number | null }[] {
  const waits: { from: number; reply: number | null }[] = [];
  let session = -1;
  let boundary = 0;
  let since: number | null = null;
  let answered = false;
  for (const m of thread.traffic) {
    while (boundary < thread.sessionStarts.length && thread.sessionStarts[boundary] <= m.at) boundary++;
    if (boundary !== session) {
      if (since !== null) waits.push({ from: since, reply: null });
      session = boundary;
      since = null;
      answered = false;
    }
    if (m.sender === "contact") {
      if (since === null && !answered) since = m.at;
    } else if (since !== null) {
      waits.push({ from: since, reply: m.at });
      since = null;
      answered = thread.onePerSession;
    }
  }
  if (since !== null) waits.push({ from: since, reply: null });
  return waits;
}

// Lo que una conversación hizo dentro del periodo.
type Activity = {
  thread: ReportThread;
  traffic: Traffic[];
  firstResponses: number[];
  resolved: boolean;
  resolutionMinutes: number | null;
  handlingMinutes: number;
  turns: number;
};

function activityIn(thread: ReportThread, from: number, to: number): Activity | null {
  const inRange = (t: number): boolean => t >= from && t <= to;
  const traffic = thread.traffic.filter((m) => inRange(m.at));
  const resolvedAt = thread.resolvedAt.filter(inRange).at(-1) ?? null;
  if (traffic.length === 0 && resolvedAt === null) return null;

  // Una espera que empezó en el periodo cuenta aunque la respuesta llegara después.
  const firstResponses = customerWaits(thread)
    .filter((w): w is { from: number; reply: number } => w.reply !== null && inRange(w.from))
    .map((w) => (w.reply - w.from) / 60_000);

  // Resolution time runs from the customer's first message of the session that
  // was resolved (not from when the chat row was created, months ago).
  let resolutionMinutes: number | null = null;
  if (resolvedAt !== null) {
    let sessionStart = -Infinity;
    for (const s of thread.sessionStarts) if (s <= resolvedAt) sessionStart = s;
    const firstInbound = thread.traffic.find((m) => m.sender === "contact" && m.at >= sessionStart && m.at <= resolvedAt);
    const start = firstInbound?.at ?? (Number.isFinite(sessionStart) ? sessionStart : thread.firstSeenAt);
    resolutionMinutes = Math.max(0, resolvedAt - start) / 60_000;
  }

  let turns = 0;
  let lastSide: "in" | "out" | null = null;
  for (const m of traffic) {
    const side = m.sender === "contact" ? "in" : "out";
    if (side !== lastSide) {
      turns += 1;
      lastSide = side;
    }
  }

  return {
    thread,
    traffic,
    firstResponses,
    resolved: resolvedAt !== null,
    resolutionMinutes,
    handlingMinutes: activeMinutesFromTimestamps(traffic.filter((m) => m.sender !== "contact").map((m) => m.at)),
    turns,
  };
}

function aggregate(acts: Activity[]) {
  const firsts = acts.flatMap((a) => a.firstResponses).sort((x, y) => x - y);
  const resolutions = acts.map((a) => a.resolutionMinutes).filter((n): n is number => n !== null).sort((x, y) => x - y);
  const count = (sender: Sender): number => acts.reduce((s, a) => s + a.traffic.filter((m) => m.sender === sender).length, 0);
  const resolved = acts.filter((a) => a.resolved).length;
  const messages = acts.reduce((s, a) => s + a.traffic.length, 0);
  return {
    conversations: acts.length,
    resolved,
    resolutionRate: pct(resolved, acts.length),
    inboundMessages: count("contact"),
    agentMessages: count("agent"),
    botMessages: count("bot"),
    firsts,
    resolutions,
    avgFirstResponseMinutes: avgOf(firsts),
    avgResolutionMinutes: avgOf(resolutions),
    avgHandlingMinutes: avgOf(acts.map((a) => a.handlingMinutes)),
    avgMessagesPerConversation: acts.length ? round1(messages / acts.length) : 0,
    avgTurnsPerSession: acts.length ? round1(acts.reduce((s, a) => s + a.turns, 0) / acts.length) : 0,
  };
}

export type BuildReportsInput = {
  agents: Agent[];
  labels: Label[];
  allConvs: Conversation[];
  allMsgs: Message[];
  emailThreads?: EmailThread[];
  emailMsgs?: ReportEmailMessage[];
  allCampaigns: Campaign[];
  window: ReportsWindow;
  now?: Date;
};

export type ReportsOverviewPayload = ReturnType<typeof composeReportsOverview>;

// Pure aggregation. Fetching is done in `loadReportsOverview` so this function
// stays deterministic and unit-testable.
export function composeReportsOverview(input: BuildReportsInput) {
  const { agents, labels, allCampaigns, window } = input;
  const from = window.from.getTime();
  const to = window.to.getTime();
  const inRange = (t: number): boolean => t >= from && t <= to;

  const threads = [
    ...chatThreads(input.allConvs, input.allMsgs),
    ...emailReportThreads(input.emailThreads ?? [], input.emailMsgs ?? [], agents),
  ];
  const acts = threads.map((t) => activityIn(t, from, to)).filter((a): a is Activity => a !== null);
  const notesInRange = acts.flatMap((a) => a.thread.notes.filter((n) => inRange(n.createdAt.getTime())).map((note) => ({ thread: a.thread, note })));

  // Nuevo: la primera vez que supimos de ese contacto, por cualquier canal, cae
  // dentro del periodo. Recurrente: ya nos había escrito antes.
  const contactFirstSeen = new Map<number, number>();
  for (const t of threads) {
    if (t.contactId == null) continue;
    const prev = contactFirstSeen.get(t.contactId);
    if (prev === undefined || t.firstSeenAt < prev) contactFirstSeen.set(t.contactId, t.firstSeenAt);
  }
  const splitContacts = (group: Activity[]) => {
    const reached = new Set(group.map((a) => a.thread.contactId).filter((id): id is number => id != null));
    let fresh = 0;
    for (const id of reached) if ((contactFirstSeen.get(id) ?? -Infinity) >= from) fresh++;
    return { reached: reached.size, newContacts: fresh, returningContacts: reached.size - fresh };
  };

  // ── Summary ────────────────────────────────────────────────────────────────
  const all = aggregate(acts);
  const contacts = splitContacts(acts);
  const takeovers = notesInRange.filter((n) => isTakeoverNote(n.note)).length;
  const escalations = notesInRange.filter((n) => isEscalationNote(n.note)).length;
  const reopenedConversations = new Set(notesInRange.filter((n) => isReopenNote(n.note)).map((n) => n.thread.key)).size;
  const botHandledConvs = acts.filter((a) => a.traffic.some((m) => m.sender === "bot")).length;

  const summary = {
    conversations: all.conversations,
    resolved: all.resolved,
    resolutionRate: all.resolutionRate,
    inboundMessages: all.inboundMessages,
    outboundMessages: all.agentMessages,
    botMessages: all.botMessages,
    avgFirstResponseMinutes: all.avgFirstResponseMinutes,
    medianFirstResponseMinutes: round1(percentile(all.firsts, 0.5)),
    p90FirstResponseMinutes: round1(percentile(all.firsts, 0.9)),
    p95FirstResponseMinutes: round1(percentile(all.firsts, 0.95)),
    avgResolutionMinutes: all.avgResolutionMinutes,
    medianResolutionMinutes: round1(percentile(all.resolutions, 0.5)),
    p95ResolutionMinutes: round1(percentile(all.resolutions, 0.95)),
    avgHandlingMinutes: all.avgHandlingMinutes,
    avgMessagesPerConversation: all.avgMessagesPerConversation,
    avgTurnsPerSession: all.avgTurnsPerSession,
    newContacts: contacts.newContacts,
    returningContacts: contacts.returningContacts,
    returningShare: pct(contacts.returningContacts, contacts.reached),
    botToHumanEscalations: escalations,
    escalationRate: pct(escalations, botHandledConvs),
    takeovers,
    takeoverRate: pct(takeovers, all.conversations),
    reopenedConversations,
    reopenRate: pct(reopenedConversations, all.conversations),
    activeAgents: agents.filter((a) => a.isActive).length,
    contactsReached: contacts.reached,
  };

  // ── By agent ───────────────────────────────────────────────────────────────
  // The takeover note doesn't carry an agentId of its own, so it is credited to
  // the conversation's current owner.
  const agentTakeoverCounts = new Map<number, number>();
  for (const { thread, note } of notesInRange) {
    if (isTakeoverNote(note) && thread.agentId != null) {
      agentTakeoverCounts.set(thread.agentId, (agentTakeoverCounts.get(thread.agentId) ?? 0) + 1);
    }
  }

  const byAgent = agents
    .map((a) => {
      const agentActs = acts.filter((act) => act.thread.agentId === a.id);
      const stats = aggregate(agentActs);
      const sender: Sender = a.type === "virtual" ? "bot" : "agent";
      const outbound = agentActs
        .flatMap((act) => act.traffic.filter((m) => m.sender === sender).map((m) => ({ at: m.at, key: act.thread.key })))
        .sort((x, y) => x.at - y.at);
      const activeMinutes = activeMinutesFromTimestamps(outbound.map((e) => e.at));
      const utilization = window.days > 0 ? round0((activeMinutes / (BUSINESS_DAY_MINUTES * window.days)) * 100) : 0;

      // Chats worked concurrently per active window (approx): while the agent
      // was on any active window, how many distinct conversations they touched.
      const windows: { end: number; convs: Set<string> }[] = [];
      for (const e of outbound) {
        const cur = windows.at(-1);
        if (cur && (e.at - cur.end) / 60_000 <= ACTIVITY_GAP_MINUTES) {
          cur.end = e.at;
          cur.convs.add(e.key);
        } else {
          windows.push({ end: e.at, convs: new Set([e.key]) });
        }
      }
      const avgConcurrent = windows.length ? windows.reduce((s, w) => s + w.convs.size, 0) / windows.length : 0;

      return {
        agentId: a.id,
        agentName: a.name,
        type: a.type,
        conversations: stats.conversations,
        resolved: stats.resolved,
        resolutionRate: stats.resolutionRate,
        messages: outbound.length,
        avgFirstResponseMinutes: stats.avgFirstResponseMinutes,
        avgResolutionMinutes: stats.avgResolutionMinutes,
        activeMinutes: round0(activeMinutes),
        avgConcurrentChats: round1(avgConcurrent),
        utilizationPercent: Math.min(100, utilization),
        takeovers: agentTakeoverCounts.get(a.id) ?? 0,
      };
    })
    .filter((row) => row.conversations > 0 || agents.find((g) => g.id === row.agentId)?.isActive)
    .sort((x, y) => y.conversations - x.conversations);

  // ── By channel ─────────────────────────────────────────────────────────────
  const byChannel = CHANNELS.map((channel) => {
    const channelActs = acts.filter((a) => a.thread.channel === channel);
    const stats = aggregate(channelActs);
    const channelContacts = splitContacts(channelActs);
    return {
      channel,
      conversations: stats.conversations,
      resolved: stats.resolved,
      resolutionRate: stats.resolutionRate,
      inboundMessages: stats.inboundMessages,
      outboundMessages: stats.agentMessages + stats.botMessages,
      avgFirstResponseMinutes: stats.avgFirstResponseMinutes,
      medianFirstResponseMinutes: round1(percentile(stats.firsts, 0.5)),
      p95FirstResponseMinutes: round1(percentile(stats.firsts, 0.95)),
      avgResolutionMinutes: stats.avgResolutionMinutes,
      avgMessagesPerConversation: stats.avgMessagesPerConversation,
      newContacts: channelContacts.newContacts,
      returningContacts: channelContacts.returningContacts,
    };
  });

  // ── By label (intent) ──────────────────────────────────────────────────────
  const total = acts.length || 1;
  const byLabel = labels
    .filter((l) => l.kind === "intent")
    .map((l) => {
      const labelActs = acts.filter((a) => a.thread.labelId === l.id);
      return {
        labelId: l.id as number | null,
        labelName: l.name,
        color: l.color,
        conversations: labelActs.length,
        resolved: labelActs.filter((a) => a.resolved).length,
        share: round0((labelActs.length / total) * 100),
      };
    })
    .filter((l) => l.conversations > 0)
    .sort((a, b) => b.conversations - a.conversations);

  const untagged = acts.filter((a) => a.thread.labelId == null);
  if (untagged.length > 0) {
    byLabel.push({
      labelId: null,
      labelName: "Sin etiqueta",
      color: "#64748b",
      conversations: untagged.length,
      resolved: untagged.filter((a) => a.resolved).length,
      share: round0((untagged.length / total) * 100),
    });
  }

  // ── By locality ────────────────────────────────────────────────────────────
  const byLocality = labels
    .filter((l) => l.kind === "locality")
    .map((l) => {
      const localityActs = acts.filter((a) => a.thread.localityLabelId === l.id);
      const resolved = localityActs.filter((a) => a.resolved).length;
      return {
        localityLabelId: l.id as number | null,
        localityName: l.name,
        color: l.color,
        conversations: localityActs.length,
        resolved,
        resolutionRate: pct(resolved, localityActs.length),
        share: round0((localityActs.length / total) * 100),
      };
    })
    .filter((l) => l.conversations > 0)
    .sort((a, b) => b.conversations - a.conversations);

  const noLocality = acts.filter((a) => a.thread.localityLabelId == null);
  if (noLocality.length > 0) {
    const resolved = noLocality.filter((a) => a.resolved).length;
    byLocality.push({
      localityLabelId: null,
      localityName: "Sin sucursal",
      color: "#64748b",
      conversations: noLocality.length,
      resolved,
      resolutionRate: pct(resolved, noLocality.length),
      share: round0((noLocality.length / total) * 100),
    });
  }

  // ── Campaigns per channel ──────────────────────────────────────────────────
  // Meta no devuelve acuses de entrega ni de lectura de las campañas: lo único
  // medido es lo que aceptó (enviados) y lo que rechazó (fallidos).
  const campaignsInWindow = allCampaigns.filter((c) => c.sentAt && inRange(c.sentAt.getTime()));
  const byCampaignChannel = CAMPAIGN_CHANNELS.map((channel) => {
    const cs = campaignsInWindow.filter((c) => c.channel === channel);
    return {
      channel,
      campaignsSent: cs.length,
      recipients: cs.reduce((s, c) => s + c.recipientCount, 0),
      sent: cs.reduce((s, c) => s + c.sentCount, 0),
      failed: cs.reduce((s, c) => s + c.failedCount, 0),
    };
  });

  // ── Backlog (right-now) ────────────────────────────────────────────────────
  const now = (input.now ?? new Date()).getTime();
  const pending = threads.filter((t) => t.pendingSince !== null);
  const ageOf = (t: ReportThread): number => Math.max(0, now - (t.pendingSince ?? now)) / 60_000;
  const queueAges = pending.map(ageOf);
  const backlog = {
    pendingConversations: pending.length,
    avgQueueMinutes: avgOf(queueAges),
    oldestQueueAgeMinutes: queueAges.length ? round1(Math.max(...queueAges)) : 0,
    byChannel: CHANNELS.map((channel) => {
      const ages = pending.filter((t) => t.channel === channel).map(ageOf);
      return {
        channel,
        pending: ages.length,
        oldestAgeMinutes: ages.length ? round1(Math.max(...ages)) : 0,
      };
    }),
  };

  // ── Heatmap (day × hour, timezone-aware) ───────────────────────────────────
  const heatmapMap = new Map<string, { dayOfWeek: number; hour: number; conversations: number; messages: number }>();
  const heatCell = (at: number) => {
    const { dayOfWeek, hour } = heatmapBucket(new Date(at), window.timeZone);
    const key = `${dayOfWeek}-${hour}`;
    let cell = heatmapMap.get(key);
    if (!cell) {
      cell = { dayOfWeek, hour, conversations: 0, messages: 0 };
      heatmapMap.set(key, cell);
    }
    return cell;
  };
  for (const a of acts) {
    if (a.traffic.length > 0) heatCell(a.traffic[0].at).conversations += 1;
    for (const m of a.traffic) heatCell(m.at).messages += 1;
  }
  const heatmap = Array.from(heatmapMap.values()).sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour);

  // ── Label × channel cross-tab ──────────────────────────────────────────────
  const labelById = new Map<number, Label>(labels.map((l) => [l.id, l]));
  const crossMap = new Map<string, { labelId: number | null; labelName: string; color: string; channel: Channel; conversations: number }>();
  for (const a of acts) {
    const label = a.thread.labelId != null ? labelById.get(a.thread.labelId) : null;
    const key = `${label?.id ?? "none"}-${a.thread.channel}`;
    const existing = crossMap.get(key);
    if (existing) existing.conversations += 1;
    else
      crossMap.set(key, {
        labelId: label?.id ?? null,
        labelName: label?.name ?? "Sin etiqueta",
        color: label?.color ?? "#64748b",
        channel: a.thread.channel,
        conversations: 1,
      });
  }
  const labelByChannel = Array.from(crossMap.values());

  // ── Daily trend ────────────────────────────────────────────────────────────
  // Una fila por día del negocio, con el mismo desglose por canal que el resto
  // del reporte. "Conversaciones" son las que tuvieron mensajes ese día, así que
  // una misma conversación cuenta en cada día en que habló (siempre en el mismo
  // canal: eso no cambia dentro de una conversación).
  type DailyChannelBucket = { conversations: number; messages: number; sales: number };
  const daily = Array.from({ length: window.days }, (_, i) => {
    const date = addDaysToKey(window.fromKey, i);
    return {
      date,
      start: startOfLocalDay(date, window.timeZone).getTime(),
      conversations: 0,
      messages: 0,
      sales: 0,
      byChannel: new Map<Channel, DailyChannelBucket>(CHANNELS.map((c) => [c, { conversations: 0, messages: 0, sales: 0 }])),
    };
  });
  const dayIndex = (at: number): number => {
    let lo = 0;
    let hi = daily.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (daily[mid].start <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  for (const a of acts) {
    const byDay = new Map<number, number>();
    for (const m of a.traffic) {
      const i = dayIndex(m.at);
      byDay.set(i, (byDay.get(i) ?? 0) + 1);
    }
    for (const [i, count] of byDay) {
      daily[i].messages += count;
      daily[i].conversations += 1;
      const bucket = daily[i].byChannel.get(a.thread.channel)!;
      bucket.messages += count;
      bucket.conversations += 1;
    }
  }
  // Las ventas del día salen de todas las conversaciones y no solo de las que
  // hablaron dentro del rango: la IA deja la nota al analizar la sesión ya
  // cerrada, que a veces cae en un día en el que ya no se escribió nada. Si se
  // filtraran por actividad, un mismo día daría una cifra distinta según el
  // rango con el que se mire, y la comparación dejaría de cuadrar.
  //
  // Una conversación cuenta una sola venta por día: esa nota se repite cuando la
  // IA vuelve a analizar la sesión, y el agente puede confirmar a mano lo que la
  // IA ya había marcado.
  const countedSales = new Set<string>();
  for (const thread of threads) {
    for (const note of thread.notes) {
      const at = note.createdAt.getTime();
      if (!isSaleClosedNote(note) || !inRange(at)) continue;
      const i = dayIndex(at);
      const once = `${i}:${thread.key}`;
      if (countedSales.has(once)) continue;
      countedSales.add(once);
      daily[i].sales += 1;
      daily[i].byChannel.get(thread.channel)!.sales += 1;
    }
  }

  return {
    periodDays: window.days,
    periodFrom: window.fromKey,
    periodTo: window.toKey,
    summary,
    byAgent,
    byChannel,
    byLabel,
    byLocality,
    byCampaignChannel,
    backlog,
    heatmap,
    labelByChannel,
    daily: daily.map(({ date, conversations, messages, sales, byChannel: byCh }) => ({
      date,
      conversations,
      messages,
      sales,
      byChannel: CHANNELS.map((channel) => ({ channel, ...byCh.get(channel)! })),
    })),
  };
}

export async function loadReportsOverview(input: { days?: number | null; from?: string | null; to?: string | null }): Promise<ReportsOverviewPayload> {
  const window = resolveWindow(input);
  const [agents, labels, allConvs, allMsgs, allCampaigns, threads, emailMsgs] = await Promise.all([
    db.select().from(agentsTable),
    db.select().from(labelsTable),
    db.select().from(conversationsTable),
    // Todo el historial y no solo el rango: la sesión a la que pertenece un
    // mensaje, la espera que abrió uno anterior y si un cliente es nuevo se
    // deciden con lo que pasó antes.
    db.select().from(messagesTable),
    db.select().from(campaignsTable),
    db.select().from(emailThreadsTable),
    // Sin los cuerpos de los correos, que son lo pesado y aquí no hacen falta.
    db
      .select({
        threadId: emailMessagesTable.threadId,
        direction: emailMessagesTable.direction,
        authorAgentId: emailMessagesTable.authorAgentId,
        isDraft: emailMessagesTable.isDraft,
        isInternal: emailMessagesTable.isInternal,
        sentAt: emailMessagesTable.sentAt,
        createdAt: emailMessagesTable.createdAt,
      })
      .from(emailMessagesTable),
  ]);
  return composeReportsOverview({ agents, labels, allConvs, allMsgs, emailThreads: threads, emailMsgs, allCampaigns, window });
}

// ── CSV rendering ───────────────────────────────────────────────────────────
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cols: unknown[]): string {
  return cols.map(csvEscape).join(",");
}

const CHANNEL_NAMES: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "Correo",
};

export function renderReportsCsv(payload: ReportsOverviewPayload): string {
  const lines: string[] = [];
  lines.push(`# Decolor-Pro — Reportes`);
  lines.push(`# Periodo,${payload.periodFrom},a,${payload.periodTo}`);
  lines.push("");

  lines.push("## Resumen");
  const s = payload.summary;
  const summaryPairs: [string, string | number][] = [
    ["Conversaciones", s.conversations],
    ["Resueltas", s.resolved],
    ["Tasa resolución (%)", s.resolutionRate],
    ["Mensajes recibidos", s.inboundMessages],
    ["Mensajes enviados (agente)", s.outboundMessages],
    ["Mensajes IA", s.botMessages],
    ["1ª respuesta avg (min)", s.avgFirstResponseMinutes],
    ["1ª respuesta mediana (min)", s.medianFirstResponseMinutes],
    ["1ª respuesta p90 (min)", s.p90FirstResponseMinutes],
    ["1ª respuesta p95 (min)", s.p95FirstResponseMinutes],
    ["Resolución avg (min)", s.avgResolutionMinutes],
    ["Resolución mediana (min)", s.medianResolutionMinutes],
    ["Resolución p95 (min)", s.p95ResolutionMinutes],
    ["AHT (min)", s.avgHandlingMinutes],
    ["Mensajes por conversación", s.avgMessagesPerConversation],
    ["Turnos por sesión", s.avgTurnsPerSession],
    ["Contactos nuevos", s.newContacts],
    ["Contactos recurrentes", s.returningContacts],
    ["Recurrentes (%)", s.returningShare],
    ["Escalaciones bot→humano", s.botToHumanEscalations],
    ["Tasa escalación (%)", s.escalationRate],
    ["Takeovers", s.takeovers],
    ["Tasa takeover (%)", s.takeoverRate],
    ["Reaperturas", s.reopenedConversations],
    ["Tasa reapertura (%)", s.reopenRate],
    ["Agentes activos", s.activeAgents],
    ["Contactos alcanzados", s.contactsReached],
  ];
  lines.push("Métrica,Valor");
  for (const [k, v] of summaryPairs) lines.push(csvRow([k, v]));
  lines.push("");

  lines.push("## Por canal");
  lines.push(csvRow([
    "Canal", "Conversaciones", "Resueltas", "Tasa (%)", "Recibidos", "Enviados",
    "1ª resp avg", "1ª resp mediana", "1ª resp p95", "Resolución avg",
    "Msg/conv", "Nuevos", "Recurrentes",
  ]));
  for (const c of payload.byChannel) {
    lines.push(csvRow([
      CHANNEL_NAMES[c.channel] ?? c.channel, c.conversations, c.resolved, c.resolutionRate, c.inboundMessages, c.outboundMessages,
      c.avgFirstResponseMinutes, c.medianFirstResponseMinutes, c.p95FirstResponseMinutes, c.avgResolutionMinutes,
      c.avgMessagesPerConversation, c.newContacts, c.returningContacts,
    ]));
  }
  lines.push("");

  lines.push("## Por agente");
  lines.push(csvRow([
    "ID", "Nombre", "Tipo", "Conversaciones", "Resueltas", "Tasa (%)", "Mensajes",
    "1ª resp avg", "Resolución avg", "Minutos activos", "Chats concurrentes", "Utilización (%)", "Takeovers",
  ]));
  for (const a of payload.byAgent) {
    lines.push(csvRow([
      a.agentId, a.agentName, a.type, a.conversations, a.resolved, a.resolutionRate, a.messages,
      a.avgFirstResponseMinutes, a.avgResolutionMinutes, a.activeMinutes, a.avgConcurrentChats, a.utilizationPercent, a.takeovers,
    ]));
  }
  lines.push("");

  lines.push("## Por etiqueta (intención)");
  lines.push(csvRow(["ID", "Etiqueta", "Conversaciones", "Resueltas", "Participación (%)"]));
  for (const l of payload.byLabel) lines.push(csvRow([l.labelId ?? "", l.labelName, l.conversations, l.resolved, l.share]));
  lines.push("");

  lines.push("## Por sucursal");
  lines.push(csvRow(["ID", "Sucursal", "Conversaciones", "Resueltas", "Tasa (%)", "Participación (%)"]));
  for (const l of payload.byLocality)
    lines.push(csvRow([l.localityLabelId ?? "", l.localityName, l.conversations, l.resolved, l.resolutionRate, l.share]));
  lines.push("");

  lines.push("## Campañas por canal");
  lines.push(csvRow(["Canal", "Campañas", "Destinatarios", "Enviados", "Fallidos"]));
  for (const c of payload.byCampaignChannel)
    lines.push(csvRow([CHANNEL_NAMES[c.channel] ?? c.channel, c.campaignsSent, c.recipients, c.sent, c.failed]));
  lines.push("");

  lines.push("## Por día");
  lines.push(csvRow(["Fecha", "Conversaciones", "Mensajes", "Ventas"]));
  for (const d of payload.daily) lines.push(csvRow([d.date, d.conversations, d.messages, d.sales]));
  lines.push("");

  lines.push("## Por día y canal");
  lines.push(csvRow(["Fecha", "Canal", "Conversaciones", "Mensajes", "Ventas"]));
  for (const d of payload.daily) {
    for (const c of d.byChannel) {
      if (c.conversations === 0 && c.sales === 0) continue;
      lines.push(csvRow([d.date, CHANNEL_NAMES[c.channel] ?? c.channel, c.conversations, c.messages, c.sales]));
    }
  }
  lines.push("");

  lines.push("## Backlog actual");
  lines.push(csvRow(["Canal", "Pendientes", "Más antigua (min)"]));
  for (const b of payload.backlog.byChannel) lines.push(csvRow([CHANNEL_NAMES[b.channel] ?? b.channel, b.pending, b.oldestAgeMinutes]));
  lines.push(csvRow(["Total", payload.backlog.pendingConversations, payload.backlog.oldestQueueAgeMinutes]));

  return lines.join("\n") + "\n";
}
