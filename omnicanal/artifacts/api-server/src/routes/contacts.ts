import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, contactsTable, contactFactsTable, contactTagEnum, conversationsTable } from "@workspace/db";
import {
  CreateContactBody,
  UpdateContactBody,
  UpdateContactParams,
  GetContactParams,
  DeleteContactParams,
  ListContactsQueryParams,
  ListContactsResponse,
  GetContactResponse,
  UpdateContactResponse,
  CreateContactFactBody,
  CreateContactFactParams,
  DeleteContactFactParams,
  MergeContactParams,
  MergeContactBody,
} from "@workspace/api-zod";
import { fetchSenderProfile } from "../lib/meta";
import { metaProfilePatch } from "../lib/meta-contact-profile";
import { loadIntegrationSettings } from "../lib/campaign-sender";
import { mergeContacts } from "../lib/contact-identity";

type TagValue = (typeof contactTagEnum.enumValues)[number];

const router: IRouter = Router();

// Live count of conversations per contact — the stored `total_conversations`
// column is not maintained, so we derive it on read.
async function conversationCountByContact(): Promise<Map<number, number>> {
  const rows = await db.select({ contactId: conversationsTable.contactId }).from(conversationsTable);
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.contactId, (counts.get(row.contactId) ?? 0) + 1);
  return counts;
}

async function countConversations(contactId: number): Promise<number> {
  const rows = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(eq(conversationsTable.contactId, contactId));
  return rows.length;
}

router.get("/contacts", async (req, res): Promise<void> => {
  const query = ListContactsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let results = await db.select().from(contactsTable).orderBy(contactsTable.createdAt);

  if (query.data.search) {
    const s = query.data.search.toLowerCase();
    results = results.filter(
      (c) =>
        c.name.toLowerCase().includes(s) ||
        (c.phone && c.phone.includes(s)) ||
        (c.email && c.email.toLowerCase().includes(s)) ||
        (c.metaProfileName && c.metaProfileName.toLowerCase().includes(s)) ||
        (c.instagramUsername && c.instagramUsername.toLowerCase().includes(s.replace(/^@/, "")))
    );
  }

  if (query.data.tag) {
    results = results.filter((c) => c.tag === query.data.tag);
  }

  const counts = await conversationCountByContact();
  res.json(
    ListContactsResponse.parse(
      results.map((c) => ({ ...c, channels: c.channels ?? [], totalConversations: counts.get(c.id) ?? 0 })),
    ),
  );
});

router.post("/contacts", async (req, res): Promise<void> => {
  const parsed = CreateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [contact] = await db.insert(contactsTable).values({
    name: parsed.data.name,
    phone: parsed.data.phone ?? null,
    email: parsed.data.email ?? null,
    company: parsed.data.company ?? null,
    address: parsed.data.address ?? null,
    city: parsed.data.city ?? null,
    birthday: parsed.data.birthday ?? null,
    tag: (parsed.data.tag ?? null) as TagValue | null,
    notes: parsed.data.notes ?? null,
  }).returning();

  res.status(201).json(GetContactResponse.parse({ ...contact, channels: contact.channels ?? [], totalConversations: 0 }));
});

router.get("/contacts/:id", async (req, res): Promise<void> => {
  const params = GetContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, params.data.id));

  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  const total = await countConversations(contact.id);
  const facts = await db
    .select()
    .from(contactFactsTable)
    .where(eq(contactFactsTable.contactId, contact.id))
    .orderBy(contactFactsTable.createdAt);
  const base = GetContactResponse.parse({ ...contact, channels: contact.channels ?? [], totalConversations: total });
  res.json({ ...base, facts });
});

router.patch("/contacts/:id", async (req, res): Promise<void> => {
  const params = UpdateContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Partial<typeof contactsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone ?? null;
  if (parsed.data.email !== undefined) updateData.email = parsed.data.email ?? null;
  if (parsed.data.company !== undefined) updateData.company = parsed.data.company ?? null;
  if (parsed.data.address !== undefined) updateData.address = parsed.data.address ?? null;
  if (parsed.data.city !== undefined) updateData.city = parsed.data.city ?? null;
  if (parsed.data.birthday !== undefined) updateData.birthday = parsed.data.birthday ?? null;
  if (parsed.data.tag !== undefined) updateData.tag = (parsed.data.tag ?? null) as TagValue | null;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes ?? null;
  if (parsed.data.buyerStatus !== undefined) updateData.buyerStatus = parsed.data.buyerStatus ?? null;
  if (parsed.data.interests !== undefined) updateData.interests = parsed.data.interests ?? [];
  if (parsed.data.purchaseProfile !== undefined) updateData.purchaseProfile = parsed.data.purchaseProfile ?? null;

  const [contact] = await db
    .update(contactsTable)
    .set(updateData)
    .where(eq(contactsTable.id, params.data.id))
    .returning();

  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  const total = await countConversations(contact.id);
  res.json(UpdateContactResponse.parse({ ...contact, channels: contact.channels ?? [], totalConversations: total }));
});

router.delete("/contacts/:id", async (req, res): Promise<void> => {
  const params = DeleteContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [contact] = await db.delete(contactsTable).where(eq(contactsTable.id, params.data.id)).returning();

  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  res.sendStatus(204);
});

// La misma persona registrada dos veces (una ficha por WhatsApp y otra por
// correo, por ejemplo): la del cuerpo se une a la de la ruta y desaparece.
router.post("/contacts/:id/merge", async (req, res): Promise<void> => {
  const params = MergeContactParams.safeParse(req.params);
  const body = MergeContactBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  if (params.data.id === body.data.sourceContactId) {
    res.status(400).json({ error: "Un contacto no se puede unir consigo mismo." });
    return;
  }
  const merged = await mergeContacts(params.data.id, body.data.sourceContactId, req.log);
  if (!merged) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  const total = await countConversations(merged.id);
  res.json(GetContactResponse.parse({ ...merged, channels: merged.channels ?? [], totalConversations: total }));
});


// Uses the identity already received from Meta; a typed @handle never changes
// the recipient ID or lets the app initiate a conversation with a new person.
router.post("/contacts/:id/meta-profile", async (req, res): Promise<void> => {
  const params = GetContactParams.safeParse(req.params);
  if (!params.success || !Number.isSafeInteger(params.data.id) || params.data.id <= 0) {
    res.status(400).json({ error: "Contacto inválido." });
    return;
  }
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, params.data.id));
  if (!contact) {
    res.status(404).json({ error: "Contacto no encontrado." });
    return;
  }
  const channels = contact.channels ?? [];
  if (!contact.externalId || channels.length !== 1 || !["instagram", "facebook"].includes(channels[0])) {
    res.status(422).json({ error: "WhatsApp actualiza el nombre al recibir un mensaje. Los contactos unidos se actualizan desde cada conversación entrante." });
    return;
  }
  const channel = channels[0] as "instagram" | "facebook";
  const settings = await loadIntegrationSettings();
  const profile = settings ? await fetchSenderProfile(settings, channel, contact.externalId) : null;
  if (!profile || (!profile.name && !profile.username)) {
    res.status(502).json({ error: "Meta no devolvió el perfil. Revisa la conexión y los permisos del canal; los datos actuales se conservan." });
    return;
  }
  const patch = metaProfilePatch(contact, channel, profile);
  if (!Object.keys(patch).length) {
    res.status(502).json({ error: "Meta no devolvió un nombre o usuario válido; se conservan los datos actuales." });
    return;
  }
  const { name, ...metadata } = patch;
  if (Object.keys(metadata).length) await db.update(contactsTable).set(metadata).where(eq(contactsTable.id, contact.id));
  if (name) {
    await db.update(contactsTable).set({ name })
      .where(and(eq(contactsTable.id, contact.id), eq(contactsTable.name, contact.name)));
  }
  const [saved] = await db.select().from(contactsTable).where(eq(contactsTable.id, contact.id));
  if (!saved) {
    res.status(404).json({ error: "Contacto no encontrado." });
    return;
  }
  res.json(GetContactResponse.parse({ ...saved, channels: saved.channels ?? [], totalConversations: await countConversations(saved.id) }));
});

// ── Profile facts ───────────────────────────────────────────────────────────────
router.post("/contacts/:id/facts", async (req, res): Promise<void> => {
  const params = CreateContactFactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateContactFactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, params.data.id));
  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  const [fact] = await db
    .insert(contactFactsTable)
    .values({ contactId: params.data.id, label: parsed.data.label, value: parsed.data.value, source: "manual" })
    .returning();
  res.status(201).json(fact);
});

router.delete("/contact-facts/:id", async (req, res): Promise<void> => {
  const params = DeleteContactFactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [fact] = await db.delete(contactFactsTable).where(eq(contactFactsTable.id, params.data.id)).returning();
  if (!fact) {
    res.status(404).json({ error: "Fact not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
