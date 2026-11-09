// El panel de control: el día de hoy del negocio, medido de verdad.
//
// Antes estas cifras eran una mezcla de totales de toda la vida presentados como
// "hoy" (una conversación resuelta en marzo contaba en "Resueltas hoy") y de
// números inventados en el propio código (el tiempo de respuesta era un 4.2
// fijo, el de cada agente un `Math.random()`). Aquí todo sale de mensajes con
// fecha, y "hoy" es el día del negocio (APP_TIMEZONE): en Santo Domingo el día
// de UTC empieza a las 8 de la noche del día anterior, así que contar por UTC
// pone la noche de ayer dentro de hoy.
//
// Lo que de verdad interesa del día es la venta cerrada, no el chat resuelto:
// resolver es cerrar la ventana, vender es el negocio. Una venta es la nota 🧾
// que deja la IA al analizar la sesión o el agente al marcarla a mano — la misma
// que cuentan los Reportes, con la misma regla de una por conversación y día
// (la IA repite la nota al reanalizar, y el agente confirma a mano lo que la IA
// ya había marcado).
//
// El correo entra en las mismas cuentas que el chat. Se mide con el mismo
// criterio que los Reportes para que las dos pantallas no digan cifras distintas
// del mismo día, que es la forma más rápida de que nadie se crea ninguna.
import {
  db,
  conversationsTable,
  contactsTable,
  campaignsTable,
  messagesTable,
  agentsTable,
  emailThreadsTable,
  emailMessagesTable,
} from "@workspace/db";
import type { Agent, Campaign, Contact, Conversation, EmailThread, Message } from "@workspace/db";
import { gte, or } from "drizzle-orm";
import { isSaleClosedNote, type ReportEmailMessage } from "./reports";
import { APP_TIMEZONE, addDaysToKey, localDayKey, startOfLocalDay } from "./time";

const CHANNELS = ["whatsapp", "instagram", "facebook", "email"] as const;
type Channel = (typeof CHANNELS)[number];
type Sender = "contact" | "agent" | "bot";

const round1 = (n: number): number => Math.round(n * 10) / 10;
const avg = (xs: number[]): number => (xs.length === 0 ? 0 : round1(xs.reduce((a, b) => a + b, 0) / xs.length));

export type DashboardSummary = {
  day: string;
  timeZone: string;
  salesClosedToday: number;
  conversationsToday: number;
  newConversationsToday: number;
  openConversations: number;
  botHandledToday: number;
  avgResponseMinutes: number;
  respondedToday: number;
  messagesSentToday: number;
  messagesReceivedToday: number;
  newContactsToday: number;
  totalContacts: number;
  campaignsSentToday: number;
};

export type DashboardChannelStat = {
  channel: string;
  conversations: number;
  messages: number;
  sales: number;
};

export type DashboardAgentStat = {
  agentId: number;
  agentName: string;
  agentType: string;
  conversations: number;
  salesClosed: number;
  avgResponseMinutes: number;
  respondedCount: number;
};

export type DailyVolumePoint = {
  date: string;
  conversations: number;
  messages: number;
  sales: number;
};

export type DashboardToday = {
  summary: DashboardSummary;
  byChannel: DashboardChannelStat[];
  byAgent: DashboardAgentStat[];
};

/**
 * Lo que de verdad se cruzó con el cliente. Las notas internas del panel
 * (escalados, cierres, la propia nota de la venta) no son tráfico, y lo que Meta
 * rechazó nunca le llegó a nadie: contarlos inflaría el día con cosas que el
 * cliente no vio. Mismo criterio que los Reportes.
 */
export function isTraffic(m: Message): boolean {
  if (m.isInternal) return false;
  return m.sender === "contact" || m.status !== "failed";
}

/**
 * Las esperas del cliente dentro de un tramo de mensajes ya ordenado, en minutos.
 * Una espera empieza cuando el cliente escribe sin nada pendiente y termina con
 * la primera respuesta, venga de una persona o del bot; los mensajes seguidos del
 * cliente no abren una espera nueva, que sería contar dos veces lo mismo.
 */
export function responseWaitsMinutes(sorted: Array<{ at: number; sender: Sender }>): number[] {
  const waits: number[] = [];
  let waitingSince: number | null = null;
  for (const m of sorted) {
    if (m.sender === "contact") {
      if (waitingSince === null) waitingSince = m.at;
    } else if (waitingSince !== null) {
      waits.push(Math.max(0, (m.at - waitingSince) / 60_000));
      waitingSince = null;
    }
  }
  return waits;
}

/** La fecha del correo, no la de su importación: al importar el buzón llegan correos de meses atrás. */
export function emailAt(m: ReportEmailMessage): number {
  return (m.sentAt ?? m.createdAt).getTime();
}

// Una conversación de cualquier canal reducida a lo que el panel mide del día.
type DayThread = {
  channel: Channel;
  agentId: number | null;
  /** Empezó hoy: la sesión del chat, o el hilo de correo. */
  startedToday: boolean;
  /** Sigue abierta ahora mismo, sea de hoy o de antes. */
  openNow: boolean;
  /** Solo los mensajes de hoy, en orden. */
  traffic: Array<{ at: number; sender: Sender }>;
  /** Cerró venta hoy. Una por conversación y día, aunque la nota se repita. */
  soldToday: boolean;
};

type ComposeInput = {
  conversations: Conversation[];
  /** Mensajes de chat del día de hoy del negocio, notas internas incluidas. */
  todayMessages: Message[];
  emailThreads: EmailThread[];
  /** Correos con fecha de hoy (la del correo, no la de la importación). */
  todayEmailMessages: ReportEmailMessage[];
  contacts: Pick<Contact, "createdAt">[];
  campaigns: Pick<Campaign, "status" | "sentAt">[];
  agents: Pick<Agent, "id" | "name" | "type">[];
  now?: Date;
  timeZone?: string;
};

export function composeDashboardToday(input: ComposeInput): DashboardToday {
  const timeZone = input.timeZone ?? APP_TIMEZONE;
  const now = input.now ?? new Date();
  const day = localDayKey(now, timeZone);
  const dayStart = startOfLocalDay(day, timeZone).getTime();
  const dayEnd = startOfLocalDay(addDaysToKey(day, 1), timeZone).getTime();
  const isToday = (at: number | null | undefined): boolean => at != null && at >= dayStart && at < dayEnd;
  const isTodayDate = (d: Date | null | undefined): boolean => isToday(d?.getTime());

  const virtualAgents = new Set(input.agents.filter((a) => a.type === "virtual").map((a) => a.id));
  const threads: DayThread[] = [];

  // ── Chat ───────────────────────────────────────────────────────────────────
  const chatTraffic = new Map<number, Array<{ at: number; sender: Sender }>>();
  const chatSales = new Set<number>();
  const knownConv = new Map<number, Conversation>(input.conversations.map((c) => [c.id, c]));

  for (const m of input.todayMessages) {
    if (!isTodayDate(m.createdAt) || !knownConv.has(m.conversationId)) continue;
    if (isSaleClosedNote(m)) chatSales.add(m.conversationId);
    if (!isTraffic(m)) continue;
    const entry = { at: m.createdAt.getTime(), sender: m.sender as Sender };
    const arr = chatTraffic.get(m.conversationId);
    if (arr) arr.push(entry);
    else chatTraffic.set(m.conversationId, [entry]);
  }

  for (const conv of input.conversations) {
    const traffic = (chatTraffic.get(conv.id) ?? []).sort((a, b) => a.at - b.at);
    const soldToday = chatSales.has(conv.id);
    // Una conversación de otro día que hoy no habló ni vendió solo cuenta para
    // "abiertas ahora"; se queda en la lista para eso.
    threads.push({
      channel: conv.channel as Channel,
      agentId: conv.agentId,
      startedToday: isTodayDate(conv.sessionStartedAt),
      openNow: conv.status === "open" || conv.status === "pending",
      traffic,
      soldToday,
    });
  }

  // ── Correo ─────────────────────────────────────────────────────────────────
  const emailTraffic = new Map<number, Array<{ at: number; sender: Sender }>>();
  const knownThread = new Set(input.emailThreads.map((t) => t.id));

  for (const m of input.todayEmailMessages) {
    // Un borrador sin enviar y una nota del panel nunca salieron por correo.
    if (m.isDraft || m.isInternal) continue;
    const at = emailAt(m);
    if (!isToday(at) || !knownThread.has(m.threadId)) continue;
    const sender: Sender =
      m.direction === "in" ? "contact" : m.authorAgentId != null && virtualAgents.has(m.authorAgentId) ? "bot" : "agent";
    const arr = emailTraffic.get(m.threadId);
    if (arr) arr.push({ at, sender });
    else emailTraffic.set(m.threadId, [{ at, sender }]);
  }

  for (const thread of input.emailThreads) {
    threads.push({
      channel: "email",
      agentId: thread.agentId,
      startedToday: isTodayDate(thread.createdAt),
      openNow: thread.status === "open",
      traffic: (emailTraffic.get(thread.id) ?? []).sort((a, b) => a.at - b.at),
      // El correo no cierra ventas: la nota 🧾 vive en el chat.
      soldToday: false,
    });
  }

  // ── Cuentas del día ────────────────────────────────────────────────────────
  const channelStats = new Map<Channel, DashboardChannelStat>(
    CHANNELS.map((c) => [c, { channel: c, conversations: 0, messages: 0, sales: 0 }]),
  );
  const agentById = new Map(input.agents.map((a) => [a.id, a]));
  const agentStats = new Map<number, DashboardAgentStat & { waits: number[] }>();

  let conversationsToday = 0;
  let newConversationsToday = 0;
  let openConversations = 0;
  let botHandledToday = 0;
  let salesClosedToday = 0;
  let messagesSentToday = 0;
  let messagesReceivedToday = 0;
  const waits: number[] = [];

  for (const thread of threads) {
    if (thread.openNow) openConversations += 1;

    // Del día es la que habló hoy; la que solo vendió también cuenta, porque la
    // IA deja la nota al analizar una sesión que ya no tuvo mensajes.
    const active = thread.traffic.length > 0 || thread.soldToday;
    if (!active) continue;

    conversationsToday += 1;
    if (thread.startedToday) newConversationsToday += 1;
    if (thread.soldToday) salesClosedToday += 1;
    if (thread.traffic.some((m) => m.sender === "bot")) botHandledToday += 1;

    for (const m of thread.traffic) {
      if (m.sender === "contact") messagesReceivedToday += 1;
      else messagesSentToday += 1;
    }

    const threadWaits = responseWaitsMinutes(thread.traffic);
    waits.push(...threadWaits);

    const bucket = channelStats.get(thread.channel);
    if (bucket) {
      bucket.conversations += 1;
      bucket.messages += thread.traffic.length;
      if (thread.soldToday) bucket.sales += 1;
    }

    // La conversación se le apunta a quien la tiene asignada, que es también
    // quien responde en ella. Un agente sin nada hoy no sale en la lista: una
    // tabla de ceros no dice nada de la jornada.
    const agent = thread.agentId != null ? agentById.get(thread.agentId) : undefined;
    if (!agent) continue;
    let row = agentStats.get(agent.id);
    if (!row) {
      row = {
        agentId: agent.id,
        agentName: agent.name,
        agentType: agent.type,
        conversations: 0,
        salesClosed: 0,
        avgResponseMinutes: 0,
        respondedCount: 0,
        waits: [],
      };
      agentStats.set(agent.id, row);
    }
    row.conversations += 1;
    if (thread.soldToday) row.salesClosed += 1;
    row.waits.push(...threadWaits);
  }

  const byAgent: DashboardAgentStat[] = Array.from(agentStats.values())
    .map(({ waits: agentWaits, ...row }) => ({
      ...row,
      avgResponseMinutes: avg(agentWaits),
      respondedCount: agentWaits.length,
    }))
    .sort((a, b) => b.salesClosed - a.salesClosed || b.conversations - a.conversations);

  return {
    summary: {
      day,
      timeZone,
      salesClosedToday,
      conversationsToday,
      newConversationsToday,
      openConversations,
      botHandledToday,
      avgResponseMinutes: avg(waits),
      respondedToday: waits.length,
      messagesSentToday,
      messagesReceivedToday,
      newContactsToday: input.contacts.filter((c) => isTodayDate(c.createdAt)).length,
      totalContacts: input.contacts.length,
      campaignsSentToday: input.campaigns.filter((c) => c.status === "sent" && isTodayDate(c.sentAt)).length,
    },
    byChannel: CHANNELS.map((c) => channelStats.get(c)!),
    byAgent,
  };
}

/**
 * La serie de los últimos `days` días del negocio. Cada día cuenta las
 * conversaciones que hablaron ese día (una misma conversación cuenta en cada día
 * en que hubo mensajes), los mensajes de ese día y sus ventas.
 */
export function composeDailyVolume(input: {
  messages: Message[];
  emailMessages: ReportEmailMessage[];
  days: number;
  now?: Date;
  timeZone?: string;
}): DailyVolumePoint[] {
  const timeZone = input.timeZone ?? APP_TIMEZONE;
  const toKey = localDayKey(input.now ?? new Date(), timeZone);
  const days = Math.min(Math.max(Math.trunc(input.days), 1), 365);
  const keys = Array.from({ length: days }, (_, i) => addDaysToKey(toKey, -(days - 1 - i)));
  const index = new Map(keys.map((key, i) => [key, i]));

  const rows: DailyVolumePoint[] = keys.map((date) => ({ date, conversations: 0, messages: 0, sales: 0 }));
  const seen = keys.map(() => new Set<string>());
  const seenSale = keys.map(() => new Set<number>());

  for (const m of input.messages) {
    const i = index.get(localDayKey(m.createdAt, timeZone));
    if (i === undefined) continue;

    if (isSaleClosedNote(m) && !seenSale[i].has(m.conversationId)) {
      seenSale[i].add(m.conversationId);
      rows[i].sales += 1;
    }
    if (!isTraffic(m)) continue;

    rows[i].messages += 1;
    const key = `chat:${m.conversationId}`;
    if (!seen[i].has(key)) {
      seen[i].add(key);
      rows[i].conversations += 1;
    }
  }

  for (const m of input.emailMessages) {
    if (m.isDraft || m.isInternal) continue;
    const i = index.get(localDayKey(new Date(emailAt(m)), timeZone));
    if (i === undefined) continue;

    rows[i].messages += 1;
    const key = `email:${m.threadId}`;
    if (!seen[i].has(key)) {
      seen[i].add(key);
      rows[i].conversations += 1;
    }
  }

  return rows;
}

// El panel pide sus tres cortes (resumen, canales, agentes) a la vez y los tres
// son del mismo día: se calcula una sola vez y los otros dos esperan a ese mismo
// cálculo. Cinco segundos duran lo que la ráfaga, así que recargar la página
// sigue trayendo el día como está ahora mismo.
const BURST_MS = 5_000;
let inflight: { at: number; value: Promise<DashboardToday> } | null = null;

/** El día de hoy tal como va, leído de la base. */
export function loadDashboardToday(): Promise<DashboardToday> {
  if (inflight && Date.now() - inflight.at < BURST_MS) return inflight.value;
  const value = readDashboardToday();
  inflight = { at: Date.now(), value };
  // Un fallo no se queda pegado cinco segundos: el siguiente vuelve a intentarlo.
  value.catch(() => {
    if (inflight?.value === value) inflight = null;
  });
  return value;
}

// Un correo se fecha por cuándo se envió, pero esa columna puede venir vacía en
// los importados: se pide por cualquiera de las dos y se decide en memoria.
const emailSince = (from: Date) => or(gte(emailMessagesTable.sentAt, from), gte(emailMessagesTable.createdAt, from));

async function readDashboardToday(): Promise<DashboardToday> {
  const now = new Date();
  const dayStart = startOfLocalDay(localDayKey(now));

  const [conversations, todayMessages, emailThreads, todayEmailMessages, contacts, campaigns, agents] = await Promise.all([
    db.select().from(conversationsTable),
    db.select().from(messagesTable).where(gte(messagesTable.createdAt, dayStart)),
    db.select().from(emailThreadsTable),
    db.select().from(emailMessagesTable).where(emailSince(dayStart)),
    db.select().from(contactsTable),
    db.select().from(campaignsTable),
    db.select().from(agentsTable),
  ]);

  return composeDashboardToday({
    conversations,
    todayMessages,
    emailThreads,
    todayEmailMessages,
    contacts,
    campaigns,
    agents,
    now,
  });
}

/**
 * La serie diaria leída de la base. Solo se piden los mensajes del rango: la
 * gráfica cuenta conversaciones distintas por su id, así que no hace falta traer
 * la tabla de conversaciones entera para dibujarla.
 */
export async function loadDailyVolume(days: number): Promise<DailyVolumePoint[]> {
  const now = new Date();
  const span = Math.min(Math.max(Math.trunc(days), 1), 365);
  const from = startOfLocalDay(addDaysToKey(localDayKey(now), -(span - 1)));

  const [messages, emailMessages] = await Promise.all([
    db.select().from(messagesTable).where(gte(messagesTable.createdAt, from)),
    db.select().from(emailMessagesTable).where(emailSince(from)),
  ]);

  return composeDailyVolume({ messages, emailMessages, days: span, now });
}
