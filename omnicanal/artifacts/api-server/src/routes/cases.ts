import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, casesTable, contactsTable, conversationsTable, messagesTable, type Case } from "@workspace/db";
import {
  ListCasesQueryParams,
  ListCasesResponse,
  ListCasesResponseItem,
  CreateCaseBody,
  GetCaseParams,
  UpdateCaseParams,
  UpdateCaseBody,
  UpdateCaseResponse,
  AddCaseEventParams,
  AddCaseEventBody,
  ResolveCaseParams,
  ResolveCaseBody,
  SuggestCaseResolutionParams,
  SuggestCaseResolutionResponse,
} from "@workspace/api-zod";
import {
  isCaseTypeAllowed,
  caseEventsFor,
  createCase,
  logCaseEvent,
  resolveCase,
  serializeCase,
  serializeCases,
  suggestCaseResolution,
  CASE_STATUS_LABELS,
  type CaseStatus,
} from "../lib/cases";
import { sendEmailReply } from "../lib/email";
import { deliverConversationMessage } from "../lib/messaging";
import { clientConfig } from "../lib/client-config";
import { openSessionForTeamMessage } from "../lib/conversation-session";

const router: IRouter = Router();

const PENDING_STATUSES = ["open", "in_progress", "waiting_customer"] as const;

async function detail(row: Case) {
  return { case: await serializeCase(row), events: await caseEventsFor(row.id) };
}

router.get("/cases", async (req, res): Promise<void> => {
  const parsed = ListCasesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status, type, priority, contactId, search } = parsed.data;

  const conditions = [];
  // "pending" no es un estado guardado: es todo lo que todavía es trabajo.
  if (status === "pending") conditions.push(inArray(casesTable.status, [...PENDING_STATUSES]));
  else if (status) conditions.push(eq(casesTable.status, status as CaseStatus));
  if (type) conditions.push(eq(casesTable.type, type));
  if (priority) conditions.push(eq(casesTable.priority, priority));
  if (contactId) conditions.push(eq(casesTable.contactId, contactId));

  const term = search?.trim();
  if (term) {
    const like = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
    // El código que ve el equipo es "CASO-000123": con dígitos, también se
    // prueba como el id exacto, igual que en Pedidos.
    const digits = term.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    const idMatch = digits ? Number(digits) : null;
    const orConditions = [
      sql`${casesTable.subject} ilike ${like}`,
      sql`${casesTable.description} ilike ${like}`,
      sql`exists (select 1 from ${contactsTable} where ${contactsTable.id} = ${casesTable.contactId} and (${contactsTable.name} ilike ${like} or ${contactsTable.phone} ilike ${like} or ${contactsTable.email} ilike ${like}))`,
    ];
    if (idMatch != null && Number.isInteger(idMatch) && idMatch > 0) orConditions.push(eq(casesTable.id, idMatch));
    conditions.push(or(...orConditions)!);
  }

  const rows = await db
    .select()
    .from(casesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    // Lo urgente primero dentro de lo reciente: la vista se lee de arriba abajo
    // y lo que arde no puede quedar debajo de una consulta de producto.
    .orderBy(desc(sql`case ${casesTable.priority} when 'urgent' then 3 when 'high' then 2 when 'normal' then 1 else 0 end`), desc(casesTable.createdAt))
    .limit(300);
  res.json(ListCasesResponse.parse(await serializeCases(rows)));
});

router.post("/cases", async (req, res): Promise<void> => {
  const parsed = CreateCaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const requestType = parsed.data.type ?? (clientConfig.id === "linaje-real" ? "prayer_request" : "other");
  if (!isCaseTypeAllowed(requestType)) { res.status(400).json({ error: "Tipo de petición no disponible para esta instancia." }); return; }
  const [contact] = await db.select({ id: contactsTable.id }).from(contactsTable).where(eq(contactsTable.id, parsed.data.contactId));
  if (!contact) {
    res.status(404).json({ error: "Contacto no encontrado." });
    return;
  }
  const row = await createCase({
    contactId: parsed.data.contactId,
    // Un caso cargado a mano nace del canal por el que vino lo que se está
    // registrando; si no se dice, es una gestión interna.
    channel: parsed.data.emailThreadId != null ? "email" : parsed.data.conversationId != null ? "chat" : "manual",
    type: requestType,
    priority: parsed.data.priority ?? "normal",
    subject: parsed.data.subject,
    description: parsed.data.description ?? null,
    requestedAction: parsed.data.requestedAction ?? null,
    emailThreadId: parsed.data.emailThreadId ?? null,
    conversationId: parsed.data.conversationId ?? null,
    orderId: parsed.data.orderId ?? null,
    createdByAgentId: req.user?.agentId ?? null,
  });
  // Orval solo genera esquema de respuesta para los 200: el de un caso suelto
  // es el ítem de la lista, que es exactamente la misma forma.
  res.status(201).json(ListCasesResponseItem.parse(await serializeCase(row)));
});

router.get("/cases/:id", async (req, res): Promise<void> => {
  const parsed = GetCaseParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.select().from(casesTable).where(eq(casesTable.id, parsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Caso no encontrado." });
    return;
  }
  res.json(await detail(row));
});

router.patch("/cases/:id", async (req, res): Promise<void> => {
  const params = UpdateCaseParams.safeParse(req.params);
  const body = UpdateCaseBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  if (body.data.type !== undefined && !isCaseTypeAllowed(body.data.type)) {
    res.status(400).json({ error: "Tipo de petición no disponible para esta instancia." }); return;
  }
  const [existing] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Caso no encontrado." });
    return;
  }

  const update: Partial<typeof casesTable.$inferInsert> = { updatedAt: new Date() };
  if (body.data.status !== undefined) update.status = body.data.status;
  if (body.data.type !== undefined) update.type = body.data.type;
  if (body.data.priority !== undefined) update.priority = body.data.priority;
  if (body.data.subject !== undefined) update.subject = body.data.subject;
  if (body.data.description !== undefined) update.description = body.data.description;
  if (body.data.requestedAction !== undefined) update.requestedAction = body.data.requestedAction;
  if (body.data.assignedAgentId !== undefined) update.assignedAgentId = body.data.assignedAgentId;
  if (body.data.orderId !== undefined) update.orderId = body.data.orderId;

  const [row] = await db.update(casesTable).set(update).where(eq(casesTable.id, params.data.id)).returning();

  // Al expediente solo lo que se entiende leyéndolo: el cambio de estado y el
  // cambio de dueño. Corregir el asunto no es un hecho del caso.
  if (body.data.status !== undefined && body.data.status !== existing.status) {
    await logCaseEvent(
      row.id,
      "status",
      `${CASE_STATUS_LABELS[existing.status as CaseStatus]} → ${CASE_STATUS_LABELS[row.status as CaseStatus]}`,
      req.user?.agentId ?? null,
    );
  }
  if (body.data.assignedAgentId !== undefined && body.data.assignedAgentId !== existing.assignedAgentId) {
    await logCaseEvent(row.id, "assigned", row.assignedAgentId == null ? "Sin asignar" : "Asignado", req.user?.agentId ?? null);
  }

  res.json(UpdateCaseResponse.parse(await serializeCase(row)));
});

router.post("/cases/:id/events", async (req, res): Promise<void> => {
  const params = AddCaseEventParams.safeParse(req.params);
  const body = AddCaseEventBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const [row] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Caso no encontrado." });
    return;
  }
  await logCaseEvent(row.id, body.data.kind, body.data.body, req.user?.agentId ?? null);
  // Anotar algo es empezar a trabajarlo: el caso deja de estar "sin tocar".
  if (row.status === "open") {
    await db.update(casesTable).set({ status: "in_progress", updatedAt: new Date() }).where(eq(casesTable.id, row.id));
  }
  const [fresh] = await db.select().from(casesTable).where(eq(casesTable.id, row.id));
  res.status(201).json(await detail(fresh));
});

router.post("/cases/:id/resolve", async (req, res): Promise<void> => {
  const params = ResolveCaseParams.safeParse(req.params);
  const body = ResolveCaseBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const [row] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Caso no encontrado." });
    return;
  }

  // Si el cierre incluye escribirle al cliente, se escribe PRIMERO: un caso
  // marcado como resuelto cuando la respuesta no salió es peor que uno abierto.
  const reply = body.data.replyToCustomer?.trim();
  if (reply) {
    if (row.emailThreadId != null) {
      const sent = await sendEmailReply(
        row.emailThreadId,
        { content: reply, authorAgentId: req.user?.agentId ?? null },
        req.log,
      );
      if (!sent.ok) {
        res.status(502).json({ error: sent.error });
        return;
      }
    } else if (row.conversationId != null) {
      const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, row.conversationId));
      if (!conv) {
        res.status(404).json({ error: "La conversación del caso ya no existe." });
        return;
      }
      // Igual que contestar desde la bandeja: el mensaje queda en el chat y
      // luego sale al canal. Si Meta lo rechaza (ventana de 24 h cerrada, por
      // ejemplo), el caso NO se cierra.
      // Y si la conversación estaba cerrada, este mensaje abre una nueva, para
      // que la respuesta del cliente no caiga en otra sesión sin él.
      await openSessionForTeamMessage(conv.id, req.user?.name ?? "el equipo", req.log);
      const [message] = await db
        .insert(messagesTable)
        .values({ conversationId: conv.id, sender: "agent", content: reply, type: "text", isAiSuggestion: false })
        .returning();
      const outcome = await deliverConversationMessage(conv, reply, req.log);
      if (!outcome.ok) {
        await db
          .update(messagesTable)
          .set({ status: "failed", failedReason: outcome.error ?? null })
          .where(eq(messagesTable.id, message.id));
        res.status(502).json({ error: outcome.error ?? "No se pudo enviar el mensaje." });
        return;
      }
      await db
        .update(conversationsTable)
        .set({ lastMessage: reply, updatedAt: new Date() })
        .where(eq(conversationsTable.id, conv.id));
      if (outcome.externalMessageId) {
        await db
          .update(messagesTable)
          .set({ externalMessageId: outcome.externalMessageId })
          .where(eq(messagesTable.id, message.id));
      }
    } else {
      res.status(400).json({ error: "Este caso no tiene por dónde contestarle al cliente." });
      return;
    }
    await logCaseEvent(row.id, "reply", reply, req.user?.agentId ?? null);
  }

  const resolved = await resolveCase(
    row.id,
    { kind: body.data.kind, resolution: body.data.resolution, agentId: req.user?.agentId ?? null },
    req.log,
  );
  if (!resolved) {
    res.status(404).json({ error: "Caso no encontrado." });
    return;
  }
  res.json(await detail(resolved));
});

router.post("/cases/:id/suggest", async (req, res): Promise<void> => {
  const parsed = SuggestCaseResolutionParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.select().from(casesTable).where(eq(casesTable.id, parsed.data.id));
  if (!row) {
    res.status(404).json({ error: "Caso no encontrado." });
    return;
  }
  res.json(SuggestCaseResolutionResponse.parse(await suggestCaseResolution(row, req.log)));
});

export default router;
