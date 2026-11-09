// El bucle del 2026-09-20: el único miembro del grupo humano se había borrado
// desde el panel y la membresía se quedó apuntando a ese id. Cada escalación
// asignaba el chat a un agente inexistente, el cliente recibía "en breve te
// estará atendiendo…", el chat no llegaba a la bandeja de nadie y al mensaje
// siguiente el flujo se lo devolvía al agente virtual, que volvía a escalar. Una
// clienta recibió el mismo aviso catorce veces en un canal y nueve en el otro.
//
// Necesita base: `sh .claude/skills/parametrizar-agentes/base-local.sh start` y
// DATABASE_URL apuntando a ella.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  agentsTable,
  agentGroupsTable,
  agentGroupMembersTable,
  conversationsTable,
  contactsTable,
  messagesTable,
  labelsTable,
} from "@workspace/db";
import { escalateConversationToGroup, classifyAndRoute } from "../src/lib/workflow-engine";
import { noticeAlreadySent } from "../src/lib/messaging";

const log = { info: () => {}, warn: () => {}, error: () => {} };

let contactId: number;
let groupId: number;
let humanId: number;
const createdConversations: number[] = [];

// Un id de agente que no existe: es exactamente el estado que dejó el borrado.
const GHOST_AGENT_ID = 999_999;

async function newConversation(overrides: Partial<typeof conversationsTable.$inferInsert> = {}): Promise<number> {
  const [conv] = await db
    .insert(conversationsTable)
    .values({ channel: "whatsapp", contactId, status: "open", ...overrides })
    .returning();
  createdConversations.push(conv.id);
  return conv.id;
}

async function internalNotes(conversationId: number): Promise<string[]> {
  const rows = await db
    .select({ content: messagesTable.content })
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId));
  return rows.map((r) => r.content);
}

before(async () => {
  // Sin etiquetas de intención activas, classifyAndRoute no llama al modelo y se
  // queda con la etiqueta que ya trae la conversación: lo que se prueba aquí es
  // el enrutado, no el clasificador.
  await db.delete(labelsTable);

  const [contact] = await db.insert(contactsTable).values({ name: "Prueba bucle" }).returning();
  contactId = contact.id;

  const [human] = await db
    .insert(agentsTable)
    .values({ name: "Persona de prueba", email: `bucle-${Date.now()}@test.local`, type: "human", role: "agent" })
    .returning();
  humanId = human.id;

  const [group] = await db
    .insert(agentGroupsTable)
    .values({ name: `Grupo de prueba ${Date.now()}`, distributionRule: "least_busy" })
    .returning();
  groupId = group.id;
});

after(async () => {
  if (createdConversations.length) {
    await db.delete(messagesTable).where(inArray(messagesTable.conversationId, createdConversations));
    await db.delete(conversationsTable).where(inArray(conversationsTable.id, createdConversations));
  }
  await db.delete(agentGroupMembersTable).where(eq(agentGroupMembersTable.groupId, groupId));
  await db.delete(agentGroupsTable).where(eq(agentGroupsTable.id, groupId));
  await db.delete(agentsTable).where(eq(agentsTable.id, humanId));
  await db.delete(contactsTable).where(eq(contactsTable.id, contactId));
});

describe("escalar a un grupo cuyo miembro ya no existe", () => {
  it("deja la conversación en cola en vez de asignarla a un agente borrado", async () => {
    await db.delete(agentGroupMembersTable).where(eq(agentGroupMembersTable.groupId, groupId));
    await db.insert(agentGroupMembersTable).values({ groupId, agentId: GHOST_AGENT_ID });

    const conversationId = await newConversation();
    const handed = await escalateConversationToGroup(conversationId, groupId, log);
    assert.equal(handed, true, "la conversación tiene que quedar en manos del equipo");

    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
    assert.equal(conv.agentId, null, "nunca se asigna a un agente que no existe");
    assert.equal(conv.groupId, groupId);
    assert.equal(conv.status, "pending");

    const notes = await internalNotes(conversationId);
    assert.ok(
      notes.some((n) => n.includes("En cola del grupo")),
      "el chat queda visible en la cola del grupo",
    );
  });

  it("sigue asignando a un miembro que sí existe", async () => {
    await db.delete(agentGroupMembersTable).where(eq(agentGroupMembersTable.groupId, groupId));
    await db.insert(agentGroupMembersTable).values({ groupId, agentId: humanId });

    const conversationId = await newConversation();
    assert.equal(await escalateConversationToGroup(conversationId, groupId, log), true);

    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
    assert.equal(conv.agentId, humanId);
    assert.equal(conv.status, "pending");
  });
});

describe("un chat ya escalado no vuelve al agente virtual", () => {
  it("classifyAndRoute lo respeta mientras espera en la cola de un grupo", async () => {
    const conversationId = await newConversation({ status: "pending", groupId, labelId: 1, agentId: null });

    const { routedToHuman } = await classifyAndRoute(conversationId, log);
    assert.equal(routedToHuman, true, "para el flujo ya es del equipo, aunque no tenga persona asignada");

    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
    assert.equal(conv.agentId, null, "no se lo devuelve a ningún agente virtual");
    assert.equal(conv.groupId, groupId);
    assert.equal(conv.status, "pending");
  });
});

describe("el aviso de traspaso no se repite", () => {
  const AVISO = "En breve te estará atendiendo uno de nuestros agentes de servicio. 🙌";

  it("no ha salido todavía", async () => {
    const conversationId = await newConversation();
    assert.equal(await noticeAlreadySent(conversationId, AVISO), false);
  });

  it("ya salió en esta sesión: no se repite", async () => {
    const conversationId = await newConversation();
    await db.insert(messagesTable).values({ conversationId, sender: "bot", content: AVISO, type: "text" });
    assert.equal(await noticeAlreadySent(conversationId, AVISO), true);
  });

  it("vuelve a salir si una persona del equipo contestó después", async () => {
    const conversationId = await newConversation();
    await db.insert(messagesTable).values({ conversationId, sender: "bot", content: AVISO, type: "text" });
    await db.insert(messagesTable).values({
      conversationId,
      sender: "agent",
      content: "Buenas, ya reviso tu pedido.",
      type: "text",
    });
    assert.equal(
      await noticeAlreadySent(conversationId, AVISO),
      false,
      "el traspaso se completó: el siguiente aviso es información nueva",
    );
  });

  it("el de un pedido confirmado se trata igual", async () => {
    const pedido = "¡Gracias por tu compra! 💗 Tu pedido estará siendo procesado en las próximas horas.";
    const conversationId = await newConversation();
    await db.insert(messagesTable).values({ conversationId, sender: "bot", content: pedido, type: "text" });
    assert.equal(await noticeAlreadySent(conversationId, pedido), true);
  });

  it("una nota interna con el mismo texto no cuenta como aviso enviado", async () => {
    const conversationId = await newConversation();
    await db
      .insert(messagesTable)
      .values({ conversationId, sender: "bot", content: AVISO, type: "text", isInternal: true });
    assert.equal(await noticeAlreadySent(conversationId, AVISO), false);
  });
});
