import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Agent, Campaign, Conversation, EmailThread, Label, Message } from "@workspace/db";
import {
  activeMinutesFromTimestamps,
  composeReportsOverview,
  isEscalationNote,
  isReopenNote,
  isResolveNote,
  isSaleClosedNote,
  isTakeoverNote,
  percentile,
  renderReportsCsv,
  resolveWindow,
  type ReportEmailMessage,
} from "../src/lib/reports";

const TZ = "America/Santo_Domingo";

// Deterministic epoch to base every fixture off. Keeps tests order-independent
// and makes it easy to eyeball the numbers.
const T0 = new Date("2026-06-01T12:00:00Z").getTime();
const at = (min: number): Date => new Date(T0 + min * 60_000);

function mkAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 1,
    name: "Ana",
    email: "ana@x.com",
    avatar: null,
    passwordHash: null,
    status: "online",
    activeChats: 0,
    channels: [],
    type: "human",
    role: "agent",
    profileType: null,
    systemPrompt: null,
    model: null,
    escalateToAgentId: null,
    escalateToGroupId: null,
    isActive: true,
    createdAt: at(-1000),
    ...overrides,
  };
}

function mkConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 100,
    channel: "whatsapp",
    status: "resolved",
    contactId: 500,
    agentId: 1,
    externalId: null,
    whatsappNumberId: null,
    label: null,
    labelId: null,
    localityLabelId: null,
    groupId: null,
    contextSummary: null,
    historySummary: null,
    sessionStartedAt: at(0),
    closedAt: null,
    lastCustomerMessageAt: null,
    saleClosedAt: null,
    saleProduct: null,
    saleSource: null,
    saleMarkedByAgentId: null,
    followupId: null,
    lastMessage: null,
    unreadCount: 0,
    createdAt: at(0),
    updatedAt: at(30),
    ...overrides,
  };
}

let msgSeq = 1;
function mkMsg(overrides: Partial<Message> & Pick<Message, "conversationId" | "sender" | "createdAt">): Message {
  return {
    id: msgSeq++,
    conversationId: overrides.conversationId,
    sender: overrides.sender,
    content: overrides.content ?? "hola",
    type: "text",
    mediaUrl: null,
    mediaName: null,
    isAiSuggestion: false,
    isInternal: overrides.isInternal ?? false,
    createdAt: overrides.createdAt,
    editedContent: null,
    isEdited: false,
    isDeleted: false,
    editedAt: null,
    deletedAt: null,
    editedByAgentId: null,
    deletedByAgentId: null,
    externalMessageId: null,
    replyToMessageId: null,
    status: overrides.status ?? "sent",
    failedReason: null,
  };
}

function mkThread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    id: 1,
    gmailThreadId: `g-${overrides.id ?? 1}`,
    contactId: 900,
    agentId: 2,
    status: "open",
    subject: "Consulta",
    customerEmail: "cliente@x.com",
    labelId: null,
    lastMessageAt: at(0),
    lastMessagePreview: null,
    unreadCount: 0,
    historySyncedAt: null,
    createdAt: at(0),
    updatedAt: at(0),
    ...overrides,
  };
}

function mkEmail(overrides: Partial<ReportEmailMessage> & Pick<ReportEmailMessage, "threadId" | "direction" | "sentAt">): ReportEmailMessage {
  return {
    authorAgentId: null,
    isDraft: false,
    isInternal: false,
    createdAt: overrides.sentAt ?? at(0),
    ...overrides,
  };
}

describe("percentile", () => {
  it("returns 0 when there is nothing to measure", () => {
    assert.equal(percentile([], 0.5), 0);
  });

  it("does linear interpolation between adjacent samples", () => {
    const xs = [1, 2, 3, 4, 5];
    assert.equal(percentile(xs, 0.5), 3);
    assert.equal(percentile(xs, 0.9), 4.6);
    assert.equal(percentile(xs, 0.95), 4.8);
  });
});

describe("activeMinutesFromTimestamps", () => {
  it("counts an isolated event as one minute of work", () => {
    assert.equal(activeMinutesFromTimestamps([at(0).getTime()]), 1);
  });

  it("adds up gaps inside the 15-minute window and treats larger gaps as new sessions", () => {
    const t = [0, 5, 10, 60, 62].map((m) => at(m).getTime());
    // 5 + 5 (small gaps) + 1 (isolated 60m start) + 2 = 13
    assert.equal(activeMinutesFromTimestamps(t), 13);
  });
});

describe("internal note detection", () => {
  const base = { conversationId: 1, sender: "bot" as const, createdAt: at(0), isInternal: true };
  it("recognises takeover notes", () => {
    assert.equal(isTakeoverNote(mkMsg({ ...base, content: "👤 Ana tomó la conversación (antes: Nico)" })), true);
    assert.equal(isTakeoverNote(mkMsg({ ...base, isInternal: false, content: "👤 Ana tomó la conversación" })), false);
  });
  it("recognises escalation notes for the three routes emitted by the server", () => {
    assert.equal(isEscalationNote(mkMsg({ ...base, content: "🔁 Escalado de Nico a Ana" })), true);
    assert.equal(isEscalationNote(mkMsg({ ...base, content: '🔀 Derivado a Ana según la etiqueta "Ventas".' })), true);
    assert.equal(isEscalationNote(mkMsg({ ...base, content: '🔀 En cola del grupo "Soporte" (etiqueta "Devoluciones").' })), true);
    assert.equal(isEscalationNote(mkMsg({ ...base, content: "hola" })), false);
  });
  it("recognises reopen notes emitted by ensureActiveSession", () => {
    assert.equal(isReopenNote(mkMsg({ ...base, content: "🆕 Nueva conversación (último contacto hace 2 días)." })), true);
  });
  it("recognises both resolution notes but not the inactivity closure", () => {
    assert.equal(isResolveNote(mkMsg({ ...base, content: "🔚 Conversación cerrada al resolverse. Lo anterior queda solo como referencia." })), true);
    assert.equal(isResolveNote(mkMsg({ ...base, content: "🔚 Conversación marcada como resuelta." })), true);
    assert.equal(isResolveNote(mkMsg({ ...base, content: "🔚 Conversación cerrada por inactividad (más de 90 min sin respuesta)." })), false);
  });
  it("recognises a sale closed by the AI or by an agent, but not when it's unmarked", () => {
    assert.equal(isSaleClosedNote(mkMsg({ ...base, content: "🧾 La IA detectó una venta cerrada (Kit alisado): el cliente confirmó el pago." })), true);
    assert.equal(isSaleClosedNote(mkMsg({ ...base, content: '🧾 Ana marcó la venta como cerrada (Kit alisado).' })), true);
    assert.equal(isSaleClosedNote(mkMsg({ ...base, content: "🧾 Ana desmarcó la venta." })), false);
    assert.equal(isSaleClosedNote(mkMsg({ ...base, isInternal: false, content: "🧾 Ana marcó la venta como cerrada." })), false);
  });
});

describe("resolveWindow", () => {
  it("falls back to a rolling window when no dates are given", () => {
    const w = resolveWindow({ days: 7 });
    assert.equal(w.days, 7);
    assert.equal(w.fromKey.length, 10);
  });
  it("clamps days into 1..365", () => {
    assert.equal(resolveWindow({ days: 0 }).days, 1);
    assert.equal(resolveWindow({ days: 9999 }).days, 365);
  });
  it("uses explicit dates when provided", () => {
    const w = resolveWindow({ from: "2026-01-01", to: "2026-01-07" }, { timeZone: TZ });
    assert.equal(w.days, 7);
    assert.equal(w.fromKey, "2026-01-01");
    assert.equal(w.toKey, "2026-01-07");
  });
  it("covers exactly one business day when from and to are the same day", () => {
    const w = resolveWindow({ from: "2026-09-10", to: "2026-09-10" }, { timeZone: TZ });
    assert.equal(w.days, 1);
    // Santo Domingo is UTC-4: its day runs from 04:00Z to 03:59:59.999Z next day.
    assert.equal(w.from.toISOString(), "2026-09-10T04:00:00.000Z");
    assert.equal(w.to.toISOString(), "2026-09-11T03:59:59.999Z");
  });
  it("counts today in the business timezone, not in UTC", () => {
    // 01:00Z on the 15th is still 21:00 on the 14th in Santo Domingo.
    const w = resolveWindow({ days: 1 }, { now: new Date("2026-09-15T01:00:00Z"), timeZone: TZ });
    assert.equal(w.fromKey, "2026-09-14");
    assert.equal(w.toKey, "2026-09-14");
  });
  it("swaps a reversed range instead of returning nothing", () => {
    const w = resolveWindow({ from: "2026-09-12", to: "2026-09-10" }, { timeZone: TZ });
    assert.equal(w.fromKey, "2026-09-10");
    assert.equal(w.toKey, "2026-09-12");
  });
});

describe("composeReportsOverview", () => {
  // T0 is 2026-06-01 08:00 in Santo Domingo.
  const window = resolveWindow({ from: "2026-05-27", to: "2026-06-02" }, { timeZone: TZ });

  const agents: Agent[] = [
    mkAgent({ id: 1, name: "Ana" }),
    mkAgent({ id: 2, name: "Nico IA", type: "virtual" }),
  ];
  const labels: Label[] = [
    { id: 10, name: "Ventas", slug: "ventas", kind: "intent", color: "#ff0000", description: null, isActive: true, isSafeForAutoReply: false, autoMigrateToDm: false, createdAt: at(-1000) } as Label,
    { id: 20, name: "Sucursal Santiago", slug: "santiago", kind: "locality", color: "#00ff00", description: null, isActive: true, isSafeForAutoReply: false, autoMigrateToDm: false, createdAt: at(-1000) } as Label,
  ];

  const convs: Conversation[] = [
    // resolved WA conv with quick first response and one takeover
    mkConv({ id: 100, channel: "whatsapp", contactId: 500, agentId: 1, labelId: 10, localityLabelId: 20, createdAt: at(0), updatedAt: at(20), status: "resolved" }),
    // reopened Instagram conv, currently open, no resolution
    mkConv({ id: 101, channel: "instagram", contactId: 501, agentId: 1, labelId: 10, createdAt: at(60), updatedAt: at(90), status: "open" }),
    // pending in queue, part of backlog
    mkConv({ id: 102, channel: "facebook", contactId: 502, agentId: null, createdAt: at(-30), updatedAt: at(-30), sessionStartedAt: at(-30), status: "pending" }),
  ];

  const msgs: Message[] = [
    mkMsg({ conversationId: 100, sender: "contact", createdAt: at(0), content: "hola" }),
    mkMsg({ conversationId: 100, sender: "bot", createdAt: at(2), content: "hola" }),
    mkMsg({ conversationId: 100, sender: "agent", createdAt: at(4), content: "cómo puedo ayudarte" }),
    mkMsg({ conversationId: 100, sender: "contact", createdAt: at(15), content: "gracias" }),
    // internal event: takeover on conv 100 (agent 1 is the current owner)
    mkMsg({ conversationId: 100, sender: "bot", isInternal: true, createdAt: at(3), content: "👤 Ana tomó la conversación (antes: Nico)" }),
    // internal event: sale closed on conv 100 (whatsapp)
    mkMsg({ conversationId: 100, sender: "bot", isInternal: true, createdAt: at(5), content: "🧾 Ana marcó la venta como cerrada (Kit alisado)." }),

    mkMsg({ conversationId: 101, sender: "contact", createdAt: at(60) }),
    mkMsg({ conversationId: 101, sender: "agent", createdAt: at(70) }),
    // reopen note
    mkMsg({ conversationId: 101, sender: "bot", isInternal: true, createdAt: at(60), content: "🆕 Nueva conversación (último contacto hace 3 días)." }),
    // escalation note
    mkMsg({ conversationId: 101, sender: "bot", isInternal: true, createdAt: at(61), content: '🔀 Derivado a Ana según la etiqueta "Ventas".' }),

    // customer waiting in the queue, nobody answered yet
    mkMsg({ conversationId: 102, sender: "contact", createdAt: at(-30) }),
  ];

  // prior conversation to make contact 501 "returning"
  const allConvs = [
    ...convs,
    mkConv({ id: 90, contactId: 501, createdAt: at(-100 * 24 * 60), updatedAt: at(-100 * 24 * 60), status: "resolved", channel: "instagram" }),
  ];

  const campaigns: Campaign[] = [
    {
      id: 1,
      name: "Julio",
      channel: "whatsapp",
      status: "sent",
      type: "marketing",
      mode: "template",
      message: null,
      templateName: null,
      templateLanguage: null,
      payload: null,
      recipientCount: 100,
      sentCount: 90,
      failedCount: 10,
      openedCount: 0,
      scheduledAt: null,
      sentAt: at(30),
      createdAt: at(-500),
    } as Campaign,
  ];

  const payload = composeReportsOverview({ agents, labels, allConvs, allMsgs: msgs, allCampaigns: campaigns, window, now: at(120) });

  it("counts every conversation with activity in the window", () => {
    // 100, 101, 102 have messages inside; 90 had nothing in the period, out.
    assert.equal(payload.summary.conversations, 3);
    assert.equal(payload.summary.resolved, 1);
    assert.equal(payload.summary.resolutionRate, 33);
  });

  it("computes response percentiles from the two conversations that received a reply", () => {
    // First responses in minutes: 2 (conv 100) and 10 (conv 101)
    assert.equal(payload.summary.medianFirstResponseMinutes, 6);
    assert.equal(payload.summary.p95FirstResponseMinutes, 9.6);
  });

  it("classifies contacts as new vs returning based on their first-ever conversation", () => {
    assert.equal(payload.summary.newContacts, 2); // 500, 502
    assert.equal(payload.summary.returningContacts, 1); // 501 (had conv 90 before)
  });

  it("counts takeovers, reopens and escalations from internal notes", () => {
    assert.equal(payload.summary.takeovers, 1);
    assert.equal(payload.summary.reopenedConversations, 1);
    assert.equal(payload.summary.botToHumanEscalations, 1);
  });

  it("puts the pending conversation in the backlog panel, aged from when it was queued", () => {
    assert.equal(payload.backlog.pendingConversations, 1);
    assert.equal(payload.backlog.byChannel.find((c) => c.channel === "facebook")?.pending, 1);
    assert.equal(payload.backlog.oldestQueueAgeMinutes, 150);
  });

  it("aggregates campaign sends into the correct channel row", () => {
    const wa = payload.byCampaignChannel.find((c) => c.channel === "whatsapp");
    assert.ok(wa);
    assert.equal(wa.campaignsSent, 1);
    // sentCount already excludes the failed recipients.
    assert.equal(wa.sent, 90);
    assert.equal(wa.failed, 10);
  });

  it("emits label × channel cross-tab cells only for pairs with traffic", () => {
    const cell = payload.labelByChannel.find((r) => r.labelId === 10 && r.channel === "whatsapp");
    assert.equal(cell?.conversations, 1);
  });

  it("groups the resolved conversation under its locality bucket", () => {
    const loc = payload.byLocality.find((l) => l.localityLabelId === 20);
    assert.equal(loc?.conversations, 1);
    assert.equal(loc?.resolutionRate, 100);
  });

  it("renders CSV with the expected sections", () => {
    const csv = renderReportsCsv(payload);
    assert.match(csv, /## Resumen/);
    assert.match(csv, /## Por canal/);
    assert.match(csv, /## Por agente/);
    assert.match(csv, /## Por etiqueta/);
    assert.match(csv, /## Por sucursal/);
    assert.match(csv, /## Campañas por canal/);
    assert.match(csv, /## Por día\b/);
    assert.match(csv, /## Por día y canal/);
    assert.match(csv, /## Backlog actual/);
  });

  it("buckets the daily trend by business day, with sales and a per-channel split", () => {
    const day = payload.daily.find((d) => d.date === "2026-06-01");
    assert.equal(day?.messages, 7);
    assert.equal(day?.conversations, 3);
    assert.equal(day?.sales, 1);
    assert.equal(payload.daily.length, 7);

    const wa = day?.byChannel.find((c) => c.channel === "whatsapp");
    assert.equal(wa?.conversations, 1);
    assert.equal(wa?.messages, 4);
    assert.equal(wa?.sales, 1);

    const ig = day?.byChannel.find((c) => c.channel === "instagram");
    assert.equal(ig?.conversations, 1);
    assert.equal(ig?.sales, 0);
  });
});

describe("composeReportsOverview — a specific date", () => {
  const agents = [mkAgent({ id: 1, name: "Ana" })];
  const day = (key: string, time: string): Date => new Date(`${key}T${time}-04:00`);

  // A chat row created in May and reopened on later days: the row's createdAt
  // must not decide which days it shows up in.
  const conv = mkConv({ id: 300, contactId: 700, agentId: 1, status: "open", createdAt: day("2026-05-01", "10:00"), updatedAt: day("2026-06-03", "11:00") });
  const msgs: Message[] = [
    mkMsg({ conversationId: 300, sender: "contact", createdAt: day("2026-05-01", "10:00") }),
    mkMsg({ conversationId: 300, sender: "agent", createdAt: day("2026-05-01", "10:05") }),
    mkMsg({ conversationId: 300, sender: "bot", isInternal: true, createdAt: day("2026-06-01", "21:59"), content: "🆕 Nueva conversación (último contacto hace 31 días)." }),
    // 22:00 in Santo Domingo is already 02:00Z of June 2nd.
    mkMsg({ conversationId: 300, sender: "contact", createdAt: day("2026-06-01", "22:00") }),
    mkMsg({ conversationId: 300, sender: "agent", createdAt: day("2026-06-01", "22:03") }),
    mkMsg({ conversationId: 300, sender: "bot", isInternal: true, createdAt: day("2026-06-03", "09:59"), content: "🆕 Nueva conversación (último contacto hace 2 días)." }),
    mkMsg({ conversationId: 300, sender: "contact", createdAt: day("2026-06-03", "10:00") }),
    // Meta rejected this one: the customer never got it, so it is not the reply.
    mkMsg({ conversationId: 300, sender: "agent", status: "failed", createdAt: day("2026-06-03", "10:01") }),
    mkMsg({ conversationId: 300, sender: "agent", createdAt: day("2026-06-03", "10:20") }),
  ];
  const report = (from: string, to = from) =>
    composeReportsOverview({ agents, labels: [], allConvs: [conv], allMsgs: msgs, allCampaigns: [], window: resolveWindow({ from, to }, { timeZone: TZ }) });

  it("includes an old conversation on the day it had messages, with only that day's messages", () => {
    const r = report("2026-06-03");
    assert.equal(r.summary.conversations, 1);
    assert.equal(r.summary.inboundMessages, 1);
    assert.equal(r.summary.outboundMessages, 1);
    assert.equal(r.summary.avgFirstResponseMinutes, 20);
    assert.equal(r.summary.returningContacts, 1);
    assert.equal(r.byChannel.find((c) => c.channel === "whatsapp")?.conversations, 1);
  });

  it("puts a 10 pm message on its own business day, not on the next UTC day", () => {
    const june1 = report("2026-06-01");
    assert.equal(june1.summary.conversations, 1);
    assert.equal(june1.summary.inboundMessages, 1);
    assert.equal(june1.summary.avgFirstResponseMinutes, 3);
    assert.equal(june1.daily[0].messages, 2);

    const june2 = report("2026-06-02");
    assert.equal(june2.summary.conversations, 0);
    assert.equal(june2.summary.inboundMessages, 0);
  });

  it("counts the same day's sales the same whether the window is one day or many", () => {
    // La IA analiza la sesión ya cerrada: deja la nota el día 7 aunque el último
    // mensaje fuera el 6, y la repite al volver a analizarla.
    const msgsVenta: Message[] = [
      mkMsg({ conversationId: 400, sender: "contact", createdAt: day("2026-06-06", "15:00") }),
      mkMsg({ conversationId: 400, sender: "agent", createdAt: day("2026-06-06", "15:10") }),
      mkMsg({ conversationId: 400, sender: "bot", isInternal: true, createdAt: day("2026-06-07", "02:00"), content: "🧾 La IA detectó una venta cerrada (Kit alisado): el cliente pagó." }),
      mkMsg({ conversationId: 400, sender: "bot", isInternal: true, createdAt: day("2026-06-07", "03:00"), content: "🧾 La IA detectó una venta cerrada (Kit alisado): el cliente pagó." }),
    ];
    const conv400 = mkConv({ id: 400, contactId: 800, agentId: 1, status: "open", createdAt: day("2026-06-06", "15:00"), updatedAt: day("2026-06-07", "03:00") });
    const ventas = (from: string, to = from) =>
      composeReportsOverview({
        agents, labels: [], allConvs: [conv400], allMsgs: msgsVenta, allCampaigns: [],
        window: resolveWindow({ from, to }, { timeZone: TZ }),
      }).daily.find((d) => d.date === "2026-06-07");

    // Las dos notas son la misma venta, y la conversación no habló el día 7.
    assert.equal(ventas("2026-06-07")?.sales, 1);
    assert.equal(ventas("2026-06-07")?.conversations, 0);
    assert.equal(ventas("2026-06-01", "2026-06-07")?.sales, 1);
    assert.equal(ventas("2026-06-07")?.byChannel.find((c) => c.channel === "whatsapp")?.sales, 1);
  });

  it("counts a resolution on the day it happened, even after the chat reopened", () => {
    const resolvedLater: Message[] = [
      mkMsg({ conversationId: 301, sender: "contact", createdAt: day("2026-06-05", "09:00") }),
      mkMsg({ conversationId: 301, sender: "agent", createdAt: day("2026-06-05", "09:10") }),
      mkMsg({ conversationId: 301, sender: "bot", isInternal: true, createdAt: day("2026-06-06", "12:00"), content: "🔚 Conversación marcada como resuelta." }),
      mkMsg({ conversationId: 301, sender: "bot", isInternal: true, createdAt: day("2026-06-08", "08:00"), content: "🆕 Nueva conversación (último contacto hace 2 días)." }),
      mkMsg({ conversationId: 301, sender: "contact", createdAt: day("2026-06-08", "08:00") }),
    ];
    const reopened = mkConv({ id: 301, contactId: 701, agentId: 1, status: "open", createdAt: day("2026-06-05", "09:00"), updatedAt: day("2026-06-08", "08:00") });
    const r = composeReportsOverview({
      agents, labels: [], allConvs: [reopened], allMsgs: resolvedLater, allCampaigns: [],
      window: resolveWindow({ from: "2026-06-06", to: "2026-06-06" }, { timeZone: TZ }),
    });
    assert.equal(r.summary.conversations, 1);
    assert.equal(r.summary.resolved, 1);
    assert.equal(r.summary.resolutionRate, 100);
    // From the customer's first message on the 5th at 09:00 to the 6th at 12:00.
    assert.equal(r.summary.avgResolutionMinutes, 27 * 60);
    assert.equal(r.summary.inboundMessages, 0);
  });
});

describe("composeReportsOverview — email channel", () => {
  const agents = [mkAgent({ id: 1, name: "Ana" }), mkAgent({ id: 2, name: "Nico IA", type: "virtual" })];
  const threads: EmailThread[] = [
    // answered by the AI after 30 min, then by a human; resolved in the window
    mkThread({ id: 1, contactId: 900, status: "resolved", createdAt: at(0), updatedAt: at(240) }),
    // customer still waiting for an answer
    mkThread({ id: 2, contactId: 901, status: "open", createdAt: at(60), updatedAt: at(60) }),
  ];
  const emailMsgs: ReportEmailMessage[] = [
    mkEmail({ threadId: 1, direction: "in", sentAt: at(0) }),
    mkEmail({ threadId: 1, direction: "out", sentAt: at(30), authorAgentId: 2 }),
    mkEmail({ threadId: 1, direction: "in", sentAt: at(60) }),
    mkEmail({ threadId: 1, direction: "out", sentAt: at(180), authorAgentId: 1 }),
    // unsent draft and a panel note never went out
    mkEmail({ threadId: 1, direction: "out", sentAt: null, createdAt: at(200), isDraft: true, authorAgentId: 2 }),
    mkEmail({ threadId: 1, direction: "out", sentAt: null, createdAt: at(210), isInternal: true }),
    mkEmail({ threadId: 2, direction: "in", sentAt: at(60) }),
  ];
  const r = composeReportsOverview({
    agents, labels: [], allConvs: [], allMsgs: [], emailThreads: threads, emailMsgs, allCampaigns: [],
    window: resolveWindow({ from: "2026-06-01", to: "2026-06-01" }, { timeZone: TZ }),
    now: at(120),
  });
  const email = r.byChannel.find((c) => c.channel === "email");

  it("reports email as its own channel and in the totals", () => {
    assert.ok(email);
    assert.equal(email.conversations, 2);
    assert.equal(email.resolved, 1);
    assert.equal(email.inboundMessages, 3);
    assert.equal(email.outboundMessages, 2);
    assert.equal(r.summary.conversations, 2);
    assert.equal(r.summary.botMessages, 1);
    assert.equal(r.summary.outboundMessages, 1);
  });

  it("measures the response to every customer email that arrived with nothing pending", () => {
    // 30 min for the first email, 120 min for the second one.
    assert.equal(email?.avgFirstResponseMinutes, 75);
  });

  it("puts the unanswered email in the backlog", () => {
    const row = r.backlog.byChannel.find((c) => c.channel === "email");
    assert.equal(row?.pending, 1);
    assert.equal(row?.oldestAgeMinutes, 60);
  });

  it("uses the email's own date, not when it was imported", () => {
    const imported = composeReportsOverview({
      agents, labels: [], allConvs: [], allMsgs: [], allCampaigns: [],
      emailThreads: [mkThread({ id: 3, createdAt: at(10 * 24 * 60) })],
      emailMsgs: [mkEmail({ threadId: 3, direction: "in", sentAt: at(0), createdAt: at(10 * 24 * 60) })],
      window: resolveWindow({ from: "2026-06-01", to: "2026-06-01" }, { timeZone: TZ }),
    });
    assert.equal(imported.byChannel.find((c) => c.channel === "email")?.conversations, 1);
  });
});
