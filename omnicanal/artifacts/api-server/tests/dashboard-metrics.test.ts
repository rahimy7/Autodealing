import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Agent, Campaign, Contact, Conversation, EmailThread, Message } from "@workspace/db";
import {
  composeDailyVolume,
  composeDashboardToday,
  isTraffic,
  responseWaitsMinutes,
} from "../src/lib/dashboard";
import type { ReportEmailMessage } from "../src/lib/reports";

const TZ = "America/Santo_Domingo";

// El día del negocio del 2026-09-20 en Santo Domingo (UTC-4) va del 04:00Z de
// ese día al 04:00Z del siguiente. Las horas de las pruebas se escriben en UTC a
// propósito: es justo el desfase que antes metía la noche de ayer dentro de hoy.
const NOW = new Date("2026-09-20T16:00:00Z");
const utc = (iso: string): Date => new Date(iso);

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
    createdAt: utc("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function mkConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 100,
    channel: "whatsapp",
    status: "open",
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
    sessionStartedAt: utc("2026-09-20T13:00:00Z"),
    closedAt: null,
    lastCustomerMessageAt: null,
    saleClosedAt: null,
    saleProduct: null,
    saleSource: null,
    saleMarkedByAgentId: null,
    followupId: null,
    lastMessage: null,
    unreadCount: 0,
    createdAt: utc("2026-09-01T00:00:00Z"),
    updatedAt: utc("2026-09-20T14:00:00Z"),
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

function mkContact(createdAt: Date): Pick<Contact, "createdAt"> {
  return { createdAt };
}

function mkCampaign(overrides: Pick<Campaign, "status" | "sentAt">): Pick<Campaign, "status" | "sentAt"> {
  return overrides;
}

function mkThread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    id: 1,
    gmailThreadId: "g-1",
    contactId: 900,
    agentId: 2,
    status: "open",
    subject: "Consulta",
    customerEmail: "cliente@x.com",
    labelId: null,
    lastMessageAt: utc("2026-09-20T13:00:00Z"),
    lastMessagePreview: null,
    unreadCount: 0,
    historySyncedAt: null,
    createdAt: utc("2026-09-20T13:00:00Z"),
    updatedAt: utc("2026-09-20T13:00:00Z"),
    ...overrides,
  };
}

function mkEmail(
  overrides: Partial<ReportEmailMessage> & Pick<ReportEmailMessage, "threadId" | "direction" | "sentAt">,
): ReportEmailMessage {
  return {
    authorAgentId: null,
    isDraft: false,
    isInternal: false,
    createdAt: overrides.sentAt ?? utc("2026-09-20T13:00:00Z"),
    ...overrides,
  };
}

// Lo que casi ningún caso usa: cada prueba pone encima solo lo suyo.
const EMPTY: Pick<Parameters<typeof composeDashboardToday>[0], "emailThreads" | "todayEmailMessages" | "contacts" | "campaigns"> = {
  emailThreads: [],
  todayEmailMessages: [],
  contacts: [],
  campaigns: [],
};

const SALE_NOTE = "🧾 La IA detectó una venta cerrada (Kit alisado): el cliente confirmó el pago.";
const AGENT_SALE_NOTE = "🧾 Ana marcó la venta como cerrada (Kit alisado).";

describe("isTraffic", () => {
  it("deja fuera las notas del panel y lo que el canal rechazó", () => {
    const base = { conversationId: 100, createdAt: NOW };
    assert.equal(isTraffic(mkMsg({ ...base, sender: "contact" })), true);
    assert.equal(isTraffic(mkMsg({ ...base, sender: "agent" })), true);
    assert.equal(isTraffic(mkMsg({ ...base, sender: "bot", isInternal: true, content: SALE_NOTE })), false);
    assert.equal(isTraffic(mkMsg({ ...base, sender: "agent", status: "failed" })), false);
    // Lo del cliente siempre llegó, aunque la fila quedara marcada de otra forma.
    assert.equal(isTraffic(mkMsg({ ...base, sender: "contact", status: "failed" })), true);
  });
});

describe("responseWaitsMinutes", () => {
  const t = (min: number) => new Date("2026-09-20T13:00:00Z").getTime() + min * 60_000;

  it("mide desde el primer mensaje sin contestar hasta la respuesta", () => {
    const waits = responseWaitsMinutes([
      { at: t(0), sender: "contact" },
      { at: t(3), sender: "agent" },
    ]);
    assert.deepEqual(waits, [3]);
  });

  it("no cuenta dos veces al cliente que escribe seguido", () => {
    const waits = responseWaitsMinutes([
      { at: t(0), sender: "contact" },
      { at: t(1), sender: "contact" },
      { at: t(5), sender: "agent" },
    ]);
    assert.deepEqual(waits, [5]);
  });

  it("una espera por vuelta, y la que sigue abierta no cuenta", () => {
    const waits = responseWaitsMinutes([
      { at: t(0), sender: "contact" },
      { at: t(2), sender: "bot" },
      { at: t(10), sender: "contact" },
      { at: t(14), sender: "agent" },
      { at: t(30), sender: "contact" },
    ]);
    assert.deepEqual(waits, [2, 4]);
  });
});

describe("composeDashboardToday", () => {
  const agents = [mkAgent(), mkAgent({ id: 2, name: "Sofía", type: "virtual" })];

  it("cuenta el día del negocio y no el de UTC", () => {
    const conversations = [
      mkConv({ id: 100, agentId: 1 }),
      // Anoche a las 9 en Santo Domingo ya es "mañana" en UTC: no es de hoy.
      mkConv({ id: 101, agentId: 1, sessionStartedAt: utc("2026-09-20T01:00:00Z") }),
    ];
    const todayMessages = [
      mkMsg({ conversationId: 100, sender: "contact", createdAt: utc("2026-09-20T13:00:00Z") }),
      mkMsg({ conversationId: 100, sender: "agent", createdAt: utc("2026-09-20T13:06:00Z") }),
      mkMsg({ conversationId: 101, sender: "contact", createdAt: utc("2026-09-20T01:00:00Z") }),
      mkMsg({ conversationId: 101, sender: "agent", createdAt: utc("2026-09-20T01:10:00Z") }),
    ];

    const { summary } = composeDashboardToday({
      ...EMPTY,
      conversations,
      todayMessages,
      agents,
      now: NOW,
      timeZone: TZ,
    });

    assert.equal(summary.day, "2026-09-20");
    assert.equal(summary.conversationsToday, 1);
    assert.equal(summary.messagesSentToday, 1);
    assert.equal(summary.messagesReceivedToday, 1);
    assert.equal(summary.avgResponseMinutes, 6);
    assert.equal(summary.respondedToday, 1);
  });

  it("la venta es la nota del día, una por conversación", () => {
    const conversations = [mkConv({ id: 100 }), mkConv({ id: 101, channel: "instagram", agentId: 2 })];
    const todayMessages = [
      mkMsg({ conversationId: 100, sender: "contact", createdAt: utc("2026-09-20T13:00:00Z") }),
      // La IA deja la nota y el agente confirma a mano lo mismo: es una venta.
      mkMsg({ conversationId: 100, sender: "bot", isInternal: true, content: SALE_NOTE, createdAt: utc("2026-09-20T14:00:00Z") }),
      mkMsg({ conversationId: 100, sender: "bot", isInternal: true, content: AGENT_SALE_NOTE, createdAt: utc("2026-09-20T15:00:00Z") }),
      // Esta vendió sin escribirse nada hoy: la nota llega al analizar la sesión.
      mkMsg({ conversationId: 101, sender: "bot", isInternal: true, content: SALE_NOTE, createdAt: utc("2026-09-20T16:00:00Z") }),
    ];

    const { summary, byChannel, byAgent } = composeDashboardToday({
      ...EMPTY,
      conversations,
      todayMessages,
      agents,
      now: NOW,
      timeZone: TZ,
    });

    assert.equal(summary.salesClosedToday, 2);
    // La que solo tiene venta también es una conversación del día.
    assert.equal(summary.conversationsToday, 2);
    assert.equal(byChannel.find((c) => c.channel === "whatsapp")?.sales, 1);
    assert.equal(byChannel.find((c) => c.channel === "instagram")?.sales, 1);
    assert.equal(byChannel.find((c) => c.channel === "instagram")?.conversations, 1);
    assert.equal(byAgent.find((a) => a.agentId === 1)?.salesClosed, 1);
    assert.equal(byAgent.find((a) => a.agentId === 2)?.salesClosed, 1);
  });

  it("una nota de venta desmarcada no cuenta", () => {
    const { summary } = composeDashboardToday({
      ...EMPTY,
      conversations: [mkConv({ id: 100 })],
      todayMessages: [
        mkMsg({
          conversationId: 100,
          sender: "bot",
          isInternal: true,
          content: "🧾 Ana desmarcó la venta.",
          createdAt: utc("2026-09-20T14:00:00Z"),
        }),
      ],
      agents,
      now: NOW,
      timeZone: TZ,
    });

    assert.equal(summary.salesClosedToday, 0);
  });

  it("lo abierto es de ahora; lo nuevo, del día", () => {
    const conversations = [
      mkConv({ id: 100, status: "open", sessionStartedAt: utc("2026-09-20T13:00:00Z") }),
      mkConv({ id: 101, status: "pending", sessionStartedAt: utc("2026-09-10T13:00:00Z") }),
      mkConv({ id: 102, status: "resolved", sessionStartedAt: utc("2026-09-01T13:00:00Z") }),
    ];
    const todayMessages = [
      mkMsg({ conversationId: 100, sender: "contact", createdAt: utc("2026-09-20T13:00:00Z") }),
      mkMsg({ conversationId: 101, sender: "contact", createdAt: utc("2026-09-20T14:00:00Z") }),
    ];

    const { summary } = composeDashboardToday({
      ...EMPTY,
      conversations,
      todayMessages,
      agents,
      now: NOW,
      timeZone: TZ,
    });

    // Las tres siguen existiendo, pero solo dos hablaron hoy y una empezó hoy.
    assert.equal(summary.openConversations, 2);
    assert.equal(summary.conversationsToday, 2);
    assert.equal(summary.newConversationsToday, 1);
  });

  it("contactos y campañas se cuentan por el día en que pasaron", () => {
    const { summary } = composeDashboardToday({
      ...EMPTY,
      conversations: [],
      todayMessages: [],
      contacts: [mkContact(utc("2026-09-20T15:00:00Z")), mkContact(utc("2026-06-01T15:00:00Z"))],
      campaigns: [
        mkCampaign({ status: "sent", sentAt: utc("2026-09-20T15:00:00Z") }),
        mkCampaign({ status: "sent", sentAt: utc("2026-09-19T15:00:00Z") }),
        mkCampaign({ status: "draft", sentAt: null }),
      ],
      agents,
      now: NOW,
      timeZone: TZ,
    });

    assert.equal(summary.newContactsToday, 1);
    assert.equal(summary.totalContacts, 2);
    assert.equal(summary.campaignsSentToday, 1);
  });

  it("solo salen los agentes con actividad, las ventas primero", () => {
    const conversations = [
      mkConv({ id: 100, agentId: 1 }),
      mkConv({ id: 101, agentId: 2 }),
      mkConv({ id: 102, agentId: 2 }),
    ];
    const todayMessages = [
      mkMsg({ conversationId: 100, sender: "contact", createdAt: utc("2026-09-20T13:00:00Z") }),
      mkMsg({ conversationId: 100, sender: "agent", createdAt: utc("2026-09-20T13:02:00Z") }),
      mkMsg({ conversationId: 100, sender: "bot", isInternal: true, content: SALE_NOTE, createdAt: utc("2026-09-20T13:30:00Z") }),
      mkMsg({ conversationId: 101, sender: "contact", createdAt: utc("2026-09-20T13:00:00Z") }),
      mkMsg({ conversationId: 102, sender: "contact", createdAt: utc("2026-09-20T13:00:00Z") }),
    ];

    const { byAgent } = composeDashboardToday({
      ...EMPTY,
      conversations,
      todayMessages,
      agents: [...agents, mkAgent({ id: 3, name: "Nadie" })],
      now: NOW,
      timeZone: TZ,
    });

    assert.deepEqual(byAgent.map((a) => a.agentId), [1, 2]);
    assert.equal(byAgent[0].salesClosed, 1);
    assert.equal(byAgent[0].avgResponseMinutes, 2);
    assert.equal(byAgent[0].respondedCount, 1);
    // Sin respuesta todavía: no hay tiempo que enseñar, y eso se nota.
    assert.equal(byAgent[1].respondedCount, 0);
    assert.equal(byAgent[1].conversations, 2);
  });
  it("el correo cuenta como una conversación más del día", () => {
    const { summary, byChannel, byAgent } = composeDashboardToday({
      ...EMPTY,
      conversations: [mkConv({ id: 100, agentId: 1 })],
      todayMessages: [mkMsg({ conversationId: 100, sender: "contact", createdAt: utc("2026-09-20T13:00:00Z") })],
      emailThreads: [mkThread({ id: 7, agentId: 2, status: "open" })],
      todayEmailMessages: [
        mkEmail({ threadId: 7, direction: "in", sentAt: utc("2026-09-20T14:00:00Z") }),
        // La contesta Sofía, que es virtual: eso es el bot atendiendo.
        mkEmail({ threadId: 7, direction: "out", authorAgentId: 2, sentAt: utc("2026-09-20T14:30:00Z") }),
        // Un borrador sin enviar no le llegó a nadie.
        mkEmail({ threadId: 7, direction: "out", isDraft: true, sentAt: utc("2026-09-20T14:40:00Z") }),
      ],
      agents,
      now: NOW,
      timeZone: TZ,
    });

    assert.equal(summary.conversationsToday, 2);
    assert.equal(summary.botHandledToday, 1);
    assert.equal(summary.messagesReceivedToday, 2);
    assert.equal(summary.messagesSentToday, 1);
    assert.equal(summary.avgResponseMinutes, 30);
    assert.equal(byChannel.find((c) => c.channel === "email")?.conversations, 1);
    assert.equal(byChannel.find((c) => c.channel === "email")?.messages, 2);
    assert.equal(byAgent.find((a) => a.agentId === 2)?.conversations, 1);
  });

  it("un correo de hace meses importado hoy no es de hoy", () => {
    const { summary } = composeDashboardToday({
      ...EMPTY,
      conversations: [],
      todayMessages: [],
      emailThreads: [mkThread({ id: 7, createdAt: utc("2026-03-01T13:00:00Z") })],
      todayEmailMessages: [
        mkEmail({
          threadId: 7,
          direction: "in",
          sentAt: utc("2026-03-02T13:00:00Z"),
          createdAt: utc("2026-09-20T16:00:00Z"),
        }),
      ],
      agents,
      now: NOW,
      timeZone: TZ,
    });

    assert.equal(summary.conversationsToday, 0);
    // El hilo sigue abierto, y eso sí es de ahora mismo.
    assert.equal(summary.openConversations, 1);
  });
});

describe("composeDailyVolume", () => {
  it("devuelve un día por fila, en días del negocio, con sus ventas", () => {
    const messages = [
      // 23:00 del 19 en Santo Domingo — en UTC ya es el 20.
      mkMsg({ conversationId: 100, sender: "contact", createdAt: utc("2026-09-20T03:00:00Z") }),
      mkMsg({ conversationId: 100, sender: "contact", createdAt: utc("2026-09-20T13:00:00Z") }),
      mkMsg({ conversationId: 100, sender: "agent", createdAt: utc("2026-09-20T13:05:00Z") }),
      mkMsg({ conversationId: 100, sender: "agent", status: "failed", createdAt: utc("2026-09-20T13:06:00Z") }),
      mkMsg({ conversationId: 100, sender: "bot", isInternal: true, content: SALE_NOTE, createdAt: utc("2026-09-20T14:00:00Z") }),
      mkMsg({ conversationId: 100, sender: "bot", isInternal: true, content: AGENT_SALE_NOTE, createdAt: utc("2026-09-20T15:00:00Z") }),
    ];

    const rows = composeDailyVolume({ messages, emailMessages: [], days: 3, now: NOW, timeZone: TZ });

    assert.deepEqual(rows.map((r) => r.date), ["2026-09-18", "2026-09-19", "2026-09-20"]);
    assert.deepEqual(rows[1], { date: "2026-09-19", conversations: 1, messages: 1, sales: 0 });
    // El rechazado no llegó y la nota repetida no es una venta más.
    assert.deepEqual(rows[2], { date: "2026-09-20", conversations: 1, messages: 2, sales: 1 });
  });
});
