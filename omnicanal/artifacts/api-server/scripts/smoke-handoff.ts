// Smoke del traspaso a humano en una instancia sin agentes virtuales: una vez
// que una persona contesta, el chat es suyo y nadie se lo quita, por mucho que
// tarde en volver a escribir. Corre contra la base REAL y limpia lo que crea.
//
//   CLIENT_ID=premier \
//   DATABASE_URL="$(grep '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"')" \
//     pnpm --filter api-server exec tsx scripts/smoke-handoff.ts
//
// Lo que se vigila: releaseAbandonedHumanChat suelta el chat pasada la ventana de
// gracia para que lo retome el agente virtual. Sin agente virtual —módulo apagado
// o ninguno activo— soltarlo dejaría la conversación huérfana y al cliente sin
// nadie, así que ahí no debe tocar nada.

import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  agentsTable,
  conversationsTable,
  contactsTable,
  messagesTable,
} from "@workspace/db";
import { ingestInboundMessage, HUMAN_REPLY_GRACE_MINUTES } from "../src/lib/messaging.js";

const log = {
  info: () => {},
  warn: (...a: unknown[]) => console.warn("[log.warn]", ...a),
  error: (...a: unknown[]) => console.error("[log.error]", ...a),
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FALLO: ${msg}`);
}

const SENDER = `smoke-handoff-${Date.now()}`;

async function main() {
  const agents = await db.select().from(agentsTable);
  const virtuales = agents.filter((a) => a.type === "virtual" && a.isActive);
  assert(
    virtuales.length === 0,
    `esta prueba supone una instancia sin agentes virtuales activos, y hay ${virtuales.length}`,
  );

  const [humano] = agents.filter((a) => a.type === "human" && a.isActive);
  assert(humano, "no hay ningún agente humano activo con el que probar");
  console.log(`Agente humano de prueba: #${humano.id} ${humano.name}`);

  // Primer mensaje del cliente: nace la conversación y la contesta la bienvenida.
  await ingestInboundMessage(
    { channel: "whatsapp", senderId: SENDER, senderName: "Cliente de prueba", text: "Hola", audio: null, externalMessageId: `smoke-${Date.now()}` },
    log,
  );

  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.externalId, SENDER));
  assert(contact, "no se creó el contacto");
  let [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.contactId, contact.id));
  assert(conv, "no se creó la conversación");
  assert(conv.agentId === null, "la conversación nueva no debería tener dueño: no hay agente virtual");
  console.log("✓ el chat nuevo nace sin dueño y solo recibe la bienvenida");

  // Contesta una persona. Es lo que hace el panel al responder (takeOverConversation
  // en routes/conversations.ts): el mensaje y el chat quedan a su nombre.
  await db.insert(messagesTable).values({
    conversationId: conv.id,
    sender: "agent",
    content: "Hola, con gusto te ayudo.",
    type: "text",
    isAiSuggestion: false,
  });
  [conv] = await db
    .update(conversationsTable)
    .set({ agentId: humano.id, status: "open" })
    .where(eq(conversationsTable.id, conv.id))
    .returning();
  console.log(`✓ contesta ${humano.name} y el chat queda asignado a esa persona`);

  // La persona se ausenta más de la ventana de gracia y el cliente insiste. Se
  // retrasan los mensajes del equipo, que es lo que mide la ventana.
  const haceRato = new Date(Date.now() - (HUMAN_REPLY_GRACE_MINUTES + 20) * 60_000);
  await db.update(messagesTable).set({ createdAt: haceRato }).where(eq(messagesTable.conversationId, conv.id));
  await db.update(conversationsTable).set({ sessionStartedAt: haceRato }).where(eq(conversationsTable.id, conv.id));

  await ingestInboundMessage(
    { channel: "whatsapp", senderId: SENDER, senderName: "Cliente de prueba", text: "¿Sigues ahí?", audio: null, externalMessageId: `smoke-${Date.now()}-2` },
    log,
  );

  [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conv.id));
  assert(
    conv.agentId === humano.id,
    `el chat cambió de dueño (agentId=${conv.agentId}): sin agente virtual nadie debe quitárselo a la persona`,
  );
  console.log(`✓ ${HUMAN_REPLY_GRACE_MINUTES + 20} min después el chat sigue siendo de ${humano.name}`);

  const msgs = await db.select().from(messagesTable).where(eq(messagesTable.conversationId, conv.id));
  const retomados = msgs.filter((m) => m.content.includes("retomó la conversación"));
  assert(retomados.length === 0, "se anotó una devolución al agente virtual que no existe");
  console.log("✓ no se anotó ninguna devolución al agente virtual");

  // Limpieza
  await db.delete(messagesTable).where(eq(messagesTable.conversationId, conv.id));
  await db.delete(conversationsTable).where(eq(conversationsTable.id, conv.id));
  await db.delete(contactsTable).where(inArray(contactsTable.id, [contact.id]));
  console.log("\n✓ limpieza completada — la prueba no dejó filas");
  console.log("\nSMOKE OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
