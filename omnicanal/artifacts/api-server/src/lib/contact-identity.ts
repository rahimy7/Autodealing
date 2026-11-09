import { and, eq, isNull, isNotNull, ne, sql } from "drizzle-orm";
import {
  db,
  contactsTable,
  contactFactsTable,
  conversationsTable,
  feedThreadsTable,
  emailThreadsTable,
  appointmentsTable,
  campaignRecipientsTable,
  type Contact,
} from "@workspace/db";
import { normalizeEmail, phoneDigits, phonesMatch } from "./email-format";

// Una persona, un contacto. El cliente puede llegar por WhatsApp, por un
// comentario o por correo, y cada canal la reconoce por una llave distinta: el
// wa_id o el PSID (`externalId`), el teléfono y la dirección de correo. Aquí vive
// lo que junta esas llaves en un solo registro.

type Log = { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };

// Los nombres que pone el sistema cuando aún no sabe cómo se llama la persona.
// Cualquier nombre real gana frente a uno de estos.
const PLACEHOLDER_NAME = /^(Cliente|Comentario)\s/i;

export function isPlaceholderName(name: string | null | undefined): boolean {
  return !name || PLACEHOLDER_NAME.test(name);
}

const FILLABLE: Array<keyof Contact & keyof typeof contactsTable.$inferInsert> = [
  "externalId",
  "metaProfileName",
  "instagramUsername",
  "phone",
  "email",
  "avatar",
  "company",
  "address",
  "city",
  "birthday",
  "tag",
  "buyerStatus",
  "purchaseProfile",
];

/**
 * Une `sourceId` dentro de `targetId`: sus conversaciones, hilos de correo,
 * comentarios, citas y datos pasan al destino, los campos que el destino no
 * tiene se completan con los del origen, y el origen desaparece. Todo en una
 * transacción, así que no quedan registros a medio mover.
 */
export async function mergeContacts(targetId: number, sourceId: number, log?: Log): Promise<Contact | null> {
  if (targetId === sourceId) {
    const [same] = await db.select().from(contactsTable).where(eq(contactsTable.id, targetId));
    return same ?? null;
  }

  const merged = await db.transaction(async (tx) => {
    const [target] = await tx.select().from(contactsTable).where(eq(contactsTable.id, targetId));
    const [source] = await tx.select().from(contactsTable).where(eq(contactsTable.id, sourceId));
    if (!target || !source) return null;

    const update: Partial<typeof contactsTable.$inferInsert> = {};
    for (const key of FILLABLE) {
      if (!target[key] && source[key]) (update as Record<string, unknown>)[key] = source[key];
    }
    if (isPlaceholderName(target.name) && !isPlaceholderName(source.name)) update.name = source.name;
    if (source.notes?.trim()) {
      update.notes = target.notes?.trim() ? `${target.notes.trim()}\n${source.notes.trim()}` : source.notes;
    }
    const channels = [...new Set([...(target.channels ?? []), ...(source.channels ?? [])])];
    if (channels.length !== (target.channels ?? []).length) update.channels = channels;
    const interests = [...new Set([...(target.interests ?? []), ...(source.interests ?? [])])].slice(0, 20);
    if (interests.length !== (target.interests ?? []).length) update.interests = interests;

    await tx.update(conversationsTable).set({ contactId: targetId }).where(eq(conversationsTable.contactId, sourceId));
    await tx.update(feedThreadsTable).set({ contactId: targetId }).where(eq(feedThreadsTable.contactId, sourceId));
    await tx.update(emailThreadsTable).set({ contactId: targetId }).where(eq(emailThreadsTable.contactId, sourceId));
    await tx.update(appointmentsTable).set({ contactId: targetId }).where(eq(appointmentsTable.contactId, sourceId));
    await tx
      .update(campaignRecipientsTable)
      .set({ contactId: targetId })
      .where(eq(campaignRecipientsTable.contactId, sourceId));

    // Un dato con la misma etiqueta que ya tiene el destino se descarta: el del
    // destino es el que venía usando el agente.
    const targetFacts = await tx.select().from(contactFactsTable).where(eq(contactFactsTable.contactId, targetId));
    const knownLabels = new Set(targetFacts.map((f) => f.label.toLowerCase()));
    const sourceFacts = await tx.select().from(contactFactsTable).where(eq(contactFactsTable.contactId, sourceId));
    for (const fact of sourceFacts) {
      if (knownLabels.has(fact.label.toLowerCase())) {
        await tx.delete(contactFactsTable).where(eq(contactFactsTable.id, fact.id));
      } else {
        knownLabels.add(fact.label.toLowerCase());
        await tx.update(contactFactsTable).set({ contactId: targetId }).where(eq(contactFactsTable.id, fact.id));
      }
    }

    await tx.delete(contactsTable).where(eq(contactsTable.id, sourceId));
    if (Object.keys(update).length === 0) return target;
    const [saved] = await tx.update(contactsTable).set(update).where(eq(contactsTable.id, targetId)).returning();
    return saved ?? target;
  });

  if (merged) log?.info({ targetId, sourceId }, "contacts merged");
  return merged;
}

/**
 * Condición SQL: la columna termina en los mismos 8 dígitos que alguno de estos
 * teléfonos. Es el filtro grueso para no traer a memoria todos los contactos; la
 * comparación fina la hace después `phonesMatch`.
 */
export function phoneSuffixCondition(column: typeof contactsTable.phone | typeof contactsTable.externalId, phones: string[]) {
  const suffixes = [...new Set(phones.map((p) => phoneDigits(p).slice(-8)).filter((d) => d.length >= 7))];
  if (suffixes.length === 0) return sql`false`;
  return sql`right(regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g'), 8) in (${sql.join(
    suffixes.map((s) => sql`${s}`),
    sql`, `,
  )})`;
}

/** El contacto que tiene registrada esta dirección de correo, sin importar mayúsculas. */
export async function findContactByEmail(email: string, excludeId?: number): Promise<Contact | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const [row] = await db
    .select()
    .from(contactsTable)
    .where(
      and(
        sql`lower(${contactsTable.email}) = ${normalized}`,
        ...(excludeId !== undefined ? [ne(contactsTable.id, excludeId)] : []),
      ),
    )
    .orderBy(contactsTable.id)
    .limit(1);
  return row ?? null;
}

/**
 * Un contacto que aún no está atado a ningún canal (lo dieron de alta a mano o
 * nació de un correo) y cuyo teléfono es este número. Es lo que permite que el
 * cliente registrado con su correo y su teléfono, cuando escribe por WhatsApp,
 * caiga en su propio contacto en vez de abrir uno nuevo.
 */
export async function findUnboundContactByPhone(phone: string): Promise<Contact | null> {
  const candidates = await db
    .select()
    .from(contactsTable)
    .where(
      and(
        isNull(contactsTable.externalId),
        isNotNull(contactsTable.phone),
        phoneSuffixCondition(contactsTable.phone, [phone]),
      ),
    )
    .orderBy(contactsTable.id);
  return candidates.find((c) => phonesMatch(c.phone, phone)) ?? null;
}

/**
 * Registra el correo que un cliente dio en un chat. Si ese correo ya tenía su
 * propio contacto —nacido de un email, sin chats ni canal de Meta— es la misma
 * persona y se unen: la dirección de correo es la llave con la que llegan sus
 * emails, así que quien la declara se queda con ellos.
 *
 * Si la dirección pertenece a un contacto con vida propia en otro canal no se
 * toca nada: unir a dos clientes distintos es mucho peor que dejar dos fichas.
 */
export async function attachEmailToContact(contactId: number, rawEmail: string, log: Log): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!email) return;

  const holder = await findContactByEmail(email, contactId);
  if (!holder) {
    await db
      .update(contactsTable)
      .set({ email })
      .where(and(eq(contactsTable.id, contactId), isNull(contactsTable.email)));
    return;
  }

  const [conversation] = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(eq(conversationsTable.contactId, holder.id))
    .limit(1);
  if (!holder.externalId && !conversation) {
    await mergeContacts(contactId, holder.id, log);
    log.info({ contactId, emailContactId: holder.id }, "email stated in chat linked the customer's email contact");
    return;
  }
  log.info({ contactId, holderId: holder.id }, "email stated in chat already belongs to another contact; left apart");
}
