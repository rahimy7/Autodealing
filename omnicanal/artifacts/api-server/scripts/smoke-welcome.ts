// Smoke test del mensaje de bienvenida personalizado. Simula un mensaje entrante
// de un contacto nuevo contra la base de datos REAL y comprueba que se envía el
// mensaje activo (imagen + texto + botones) en lugar de la respuesta de la IA.
// Después limpia todo lo que creó. Ejecutar con:
//
//   DATABASE_URL="$(grep DATABASE_URL .env | cut -d= -f2- | tr -d '"')" \
//     pnpm --filter api-server exec tsx scripts/smoke-welcome.ts
//
// Sin credenciales de Meta la entrega se salta sola (externalId de prueba), pero
// las filas de mensajes se escriben igual, que es lo que se verifica aquí.

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  conversationsTable,
  contactsTable,
  messagesTable,
  customMessagesTable,
} from "@workspace/db";
import { ingestInboundMessage } from "../src/lib/messaging.js";

const log = {
  info: () => {},
  warn: (...a: unknown[]) => console.warn("[log.warn]", ...a),
  error: (...a: unknown[]) => console.error("[log.error]", ...a),
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FALLO: ${msg}`);
}

const SENDER = `smoke-welcome-${Date.now()}`;

async function main() {
  const [active] = await db
    .select()
    .from(customMessagesTable)
    .where(and(eq(customMessagesTable.kind, "welcome"), eq(customMessagesTable.isActive, true)))
    .limit(1);
  assert(active, "no hay ningún mensaje de bienvenida activo");
  console.log(`Mensaje activo: "${active.name}" (${active.buttons.length} botones, imagen: ${active.imagePath ?? "no"})`);

  await ingestInboundMessage(
    {
      channel: "whatsapp",
      senderId: SENDER,
      senderName: "Cliente de prueba",
      text: "Hola",
      audio: null,
      externalMessageId: `smoke-${Date.now()}`,
    },
    log,
  );

  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.externalId, SENDER));
  assert(contact, "no se creó el contacto");
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.contactId, contact.id));
  assert(conv, "no se creó la conversación");

  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conv.id))
    .orderBy(messagesTable.id);

  console.log("\nMensajes en la conversación:");
  for (const m of msgs) console.log(`  [${m.sender}/${m.type}] ${m.content.replace(/\n/g, " ⏎ ").slice(0, 90)}`);

  const bot = msgs.filter((m) => m.sender === "bot");
  assert(bot.length > 0, "el bot no respondió nada");

  if (active.imagePath) {
    const image = bot.find((m) => m.type === "image");
    assert(image, "no se registró el mensaje de imagen");
    console.log("\n✓ imagen registrada");
  }

  const text = bot.find((m) => m.type === "text");
  assert(text, "no se registró el mensaje de texto");
  assert(
    text.content.startsWith(active.body.slice(0, 40)),
    "el texto enviado no es el del mensaje personalizado (¿respondió la IA?)",
  );
  console.log("✓ texto es el del mensaje personalizado, no una respuesta de la IA");

  for (const b of active.buttons) {
    assert(text.content.includes(b.label), `falta el botón "${b.label}" en la transcripción`);
  }
  console.log(`✓ los ${active.buttons.length} botones quedan en la transcripción del inbox`);

  // La IA no debe haber añadido su propio saludo encima.
  assert(bot.filter((m) => m.type === "text").length === 1, "hubo más de una respuesta de texto del bot");
  console.log("✓ la IA no respondió además del mensaje de bienvenida");

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
