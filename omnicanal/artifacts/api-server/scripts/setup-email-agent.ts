// Deja un agente virtual atendiendo el CANAL CORREO.
//
//   DATABASE_URL="$(grep '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"')" \
//     pnpm --filter api-server exec tsx scripts/setup-email-agent.ts [--activar] \
//       [--nombre "Elena, Correo IA"] [--auto-responder saludo,ventas]
//
// Por qué hace falta: `pickVirtualAgentForEmail` (lib/email.ts) solo toma a un
// agente virtual activo cuyo `channels` incluya "email" o esté vacío. Con todos
// los agentes declarados en WhatsApp/Instagram/Facebook —que es como quedaron al
// montar la primera línea— ninguno califica: cada correo entra, se guarda, y el
// borrador no se genera nunca. Ese es el motivo de que el buzón se llenara de
// correos sin una sola respuesta.
//
// Qué hace: crea (o actualiza) un agente virtual de perfil `support` en el canal
// `email`, le copia las capacidades —y con ellas las bases de conocimiento— del
// agente de atención que ya existe, y lo hace escalar al mismo grupo humano. Sin
// agente de atención del que copiar, enlaza todas las bases activas.
//
// --auto-responder: enciende la auto-respuesta del buzón y marca esas etiquetas
// (por su slug) como seguras PARA EL CORREO. Es un permiso distinto del del Feed
// (`isSafeForAutoReply`): un comentario público lo lee cualquiera y un correo lo
// lee una sola persona, así que lo que puede salir sin revisión no es lo mismo en
// los dos sitios. Lo que no se nombre aquí sigue quedando como borrador, y aun
// las nombradas solo salen solas si la IA supo qué contestar — cuando escala, no
// se manda nada.
//
// Idempotente: reconoce al agente por su correo y lo actualiza en vez de
// duplicarlo. Sin --activar, un agente que ya existía conserva su estado.
import { and, eq } from "drizzle-orm";
import { db, pool, agentsTable, capabilitiesTable, knowledgeBasesTable, labelsTable, integrationSettingsTable } from "@workspace/db";

const ACTIVAR = process.argv.includes("--activar");
const nameArg = process.argv.indexOf("--nombre");
const AGENT_NAME = nameArg > -1 ? process.argv[nameArg + 1] : "Elena, Correo IA";
const AGENT_EMAIL = "correo-ia@premierlinemotors.com";
const autoArg = process.argv.indexOf("--auto-responder");
const AUTO_SLUGS =
  autoArg > -1
    ? (process.argv[autoArg + 1] ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];

async function main() {
  // El agente de atención de los otros canales es el molde: mismo conocimiento,
  // mismo grupo de escalación, otro canal.
  const [model] = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.type, "virtual"), eq(agentsTable.profileType, "support")))
    .orderBy(agentsTable.id)
    .limit(1);
  if (model) console.log(`Molde: ${model.name} (id ${model.id})`);
  else console.warn("⚠ no hay agente de atención del que copiar: se enlazan todas las bases activas");

  const values = {
    name: AGENT_NAME,
    type: "virtual" as const,
    role: "agent" as const,
    profileType: "support",
    // null: hereda el prompt afinado del cliente para el perfil `support`, el
    // mismo que ya usa la atención por chat. La conducta propia del correo
    // (saludo, despedida, sin asunto ni firma) la pone EMAIL_CONDUCT en el core.
    systemPrompt: null,
    model: "gpt-5-mini",
    channels: ["email"],
    escalateToGroupId: model?.escalateToGroupId ?? null,
    escalateToAgentId: model?.escalateToAgentId ?? null,
  };

  const [existing] = await db.select().from(agentsTable).where(eq(agentsTable.email, AGENT_EMAIL)).limit(1);
  let id: number;
  if (existing) {
    await db
      .update(agentsTable)
      .set({ ...values, ...(ACTIVAR ? { isActive: true } : {}) })
      .where(eq(agentsTable.id, existing.id));
    id = existing.id;
    console.log(`• ${AGENT_NAME} actualizado (${ACTIVAR ? "activo" : `sigue ${existing.isActive ? "activo" : "inactivo"}`})`);
  } else {
    const [created] = await db
      .insert(agentsTable)
      .values({ ...values, email: AGENT_EMAIL, isActive: true, status: "online" })
      .returning();
    id = created.id;
    console.log(`✓ ${AGENT_NAME} creado (activo)`);
  }

  // Capacidades: las del molde, o una sola que enlace cada base activa.
  const sourceCaps = model
    ? await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.agentId, model.id))
    : [];
  const specs = sourceCaps.length
    ? sourceCaps.map((c) => ({
        name: c.name,
        description: c.description,
        category: c.category,
        level: c.level,
        keywords: c.keywords ?? [],
        knowledgeBaseId: c.knowledgeBaseId,
      }))
    : (await db.select().from(knowledgeBasesTable).where(eq(knowledgeBasesTable.isActive, true))).map((kb) => ({
        name: kb.name.slice(0, 80),
        description: `Consulta ${kb.name} para responder por correo.`,
        category: "soporte",
        level: "intermedio",
        keywords: [] as string[],
        knowledgeBaseId: kb.id,
      }));

  const current = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.agentId, id));
  for (const spec of specs) {
    const row = { agentId: id, ...spec };
    const match = current.find((c) => c.name === spec.name);
    if (match) await db.update(capabilitiesTable).set(row).where(eq(capabilitiesTable.id, match.id));
    else await db.insert(capabilitiesTable).values(row);
  }
  console.log(`✓ ${specs.length} capacidades enlazadas (${specs.filter((s) => s.knowledgeBaseId != null).length} con base de conocimiento)`);

  if (AUTO_SLUGS.length) {
    const labels = await db.select().from(labelsTable).where(eq(labelsTable.isActive, true));
    for (const slug of AUTO_SLUGS) {
      const label = labels.find((l) => l.slug === slug);
      if (!label) {
        console.warn(`⚠ no hay etiqueta activa "${slug}": esa intención seguirá quedando en borrador`);
        continue;
      }
      await db.update(labelsTable).set({ isSafeForEmailAutoReply: true }).where(eq(labelsTable.id, label.id));
      console.log(`✓ "${label.name}" se contesta sola por correo`);
    }
    // Las que no se nombraron vuelven a borrador: correr el script con una lista
    // más corta tiene que QUITAR permisos, no solo agregarlos.
    for (const label of labels) {
      if (AUTO_SLUGS.includes(label.slug) || !label.isSafeForEmailAutoReply) continue;
      await db.update(labelsTable).set({ isSafeForEmailAutoReply: false }).where(eq(labelsTable.id, label.id));
      console.log(`• "${label.name}" vuelve a quedar en borrador`);
    }

    const [settings] = await db.select().from(integrationSettingsTable).orderBy(integrationSettingsTable.id).limit(1);
    if (!settings) {
      console.warn("⚠ no hay configuración de integraciones: conecta Gmail antes de encender la auto-respuesta");
    } else {
      await db
        .update(integrationSettingsTable)
        .set({ gmailAutoReply: true })
        .where(eq(integrationSettingsTable.id, settings.id));
      console.log("✓ auto-respuesta del buzón encendida");
    }
  }

  const [check] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  if (!check.isActive) {
    console.warn("⚠ el agente está INACTIVO: mientras lo esté, el correo sigue sin borradores. Usa --activar o enciéndelo en Agentes.");
  } else {
    console.log("✓ el canal Correo ya tiene quien lo atienda");
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
