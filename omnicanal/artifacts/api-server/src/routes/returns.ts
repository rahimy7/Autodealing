import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, returnsTable, creditNotesTable } from "@workspace/db";
import {
  ListReturnsQueryParams,
  ListReturnsResponse,
  ListReturnsResponseItem,
  CreateReturnBody,
  GetReturnableLinesQueryParams,
  GetReturnableLinesResponse,
  ReceiveReturnParams,
  ReceiveReturnBody,
  ReceiveReturnResponse,
  CancelReturnParams,
  CancelReturnResponse,
  ListCreditNotesQueryParams,
  ListCreditNotesResponse,
  ListCreditNotesResponseItem,
  CreateCreditNoteBody,
  ApplyCreditNoteParams,
  ApplyCreditNoteBody,
  ApplyCreditNoteResponse,
  RefundCreditNoteParams,
  RefundCreditNoteBody,
  RefundCreditNoteResponse,
  VoidCreditNoteParams,
  VoidCreditNoteResponse,
} from "@workspace/api-zod";
import {
  returnableLines,
  createReturn,
  cancelReturn,
  receiveReturn,
  serializeReturns,
  listReturnsFor,
  issueCreditNote,
  applyCreditNote,
  refundCreditNote,
  voidCreditNote,
  serializeCreditNotes,
} from "../lib/returns";
import { orderCode } from "../lib/codes";
import { BASE_CURRENCY } from "../lib/money";
import { withDomainErrors, actorFrom, badRequest } from "../lib/route-errors";

const router: IRouter = Router();

async function serializedReturn(id: number) {
  const [row] = await db.select().from(returnsTable).where(eq(returnsTable.id, id));
  const [out] = await serializeReturns(row ? [row] : []);
  return out;
}

async function serializedNote(id: number) {
  const [row] = await db.select().from(creditNotesTable).where(eq(creditNotesTable.id, id));
  const [out] = await serializeCreditNotes(row ? [row] : []);
  return out;
}

router.get("/returns", async (req, res): Promise<void> => {
  const parsed = ListReturnsQueryParams.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const rows = await listReturnsFor({ status: parsed.data.status, orderId: parsed.data.orderId });
  res.json(ListReturnsResponse.parse(await serializeReturns(rows)));
});

router.get(
  "/returns/returnable",
  withDomainErrors(async (req, res) => {
    const parsed = GetReturnableLinesQueryParams.safeParse(req.query);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const { order, lines } = await returnableLines(parsed.data.orderId);
    res.json(
      GetReturnableLinesResponse.parse({
        orderId: order.id,
        orderCode: orderCode(order.id),
        currency: order.priceCurrency ?? BASE_CURRENCY,
        lines: lines.map(({ dispatchQuantity: _q, dispatchValueCents: _v, ...line }) => line),
      }),
    );
  }),
);

router.post(
  "/returns",
  withDomainErrors(async (req, res) => {
    const parsed = CreateReturnBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const ret = await createReturn(
      {
        orderId: parsed.data.orderId,
        caseId: parsed.data.caseId ?? null,
        warehouseId: parsed.data.warehouseId ?? null,
        reason: parsed.data.reason ?? null,
        notes: parsed.data.notes ?? null,
        lines: parsed.data.lines.map((l) => ({ ...l, lotId: l.lotId ?? null })),
      },
      actorFrom(req.user),
    );
    res.status(201).json(ListReturnsResponseItem.parse(await serializedReturn(ret.id)));
  }),
);

router.post(
  "/returns/:id/receive",
  withDomainErrors(async (req, res) => {
    const params = ReceiveReturnParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = ReceiveReturnBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    await receiveReturn(
      params.data.id,
      {
        resolution: body.data.resolution,
        amountCents: body.data.amountCents ?? null,
        refundMethod: body.data.refundMethod ?? null,
        fiscalNumber: body.data.fiscalNumber ?? null,
        notes: body.data.notes ?? null,
      },
      actorFrom(req.user),
      req.log,
    );
    res.json(ReceiveReturnResponse.parse(await serializedReturn(params.data.id)));
  }),
);

router.post(
  "/returns/:id/cancel",
  withDomainErrors(async (req, res) => {
    const params = CancelReturnParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    await cancelReturn(params.data.id, actorFrom(req.user));
    res.json(CancelReturnResponse.parse(await serializedReturn(params.data.id)));
  }),
);

router.get("/credit-notes", async (req, res): Promise<void> => {
  const parsed = ListCreditNotesQueryParams.safeParse(req.query);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const rows = await db
    .select()
    .from(creditNotesTable)
    .where(parsed.data.contactId != null ? and(eq(creditNotesTable.contactId, parsed.data.contactId)) : undefined)
    .orderBy(desc(creditNotesTable.createdAt))
    .limit(300);
  let out = await serializeCreditNotes(rows);
  if (parsed.data.withBalance) out = out.filter((n) => n.balanceCents > 0);
  res.json(ListCreditNotesResponse.parse(out));
});

router.post(
  "/credit-notes",
  withDomainErrors(async (req, res) => {
    const parsed = CreateCreditNoteBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const note = await issueCreditNote(
      {
        contactId: parsed.data.contactId,
        orderId: parsed.data.orderId ?? null,
        caseId: parsed.data.caseId ?? null,
        reason: parsed.data.reason,
        currency: parsed.data.currency ?? null,
        amountCents: parsed.data.amountCents,
        fiscalNumber: parsed.data.fiscalNumber ?? null,
        notes: parsed.data.notes ?? null,
      },
      actorFrom(req.user),
      req.log,
    );
    res.status(201).json(ListCreditNotesResponseItem.parse(await serializedNote(note.id)));
  }),
);

router.post(
  "/credit-notes/:id/apply",
  withDomainErrors(async (req, res) => {
    const params = ApplyCreditNoteParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = ApplyCreditNoteBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    await applyCreditNote(params.data.id, body.data.orderId, body.data.amountCents, actorFrom(req.user));
    res.json(ApplyCreditNoteResponse.parse(await serializedNote(params.data.id)));
  }),
);

router.post(
  "/credit-notes/:id/refund",
  withDomainErrors(async (req, res) => {
    const params = RefundCreditNoteParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    const body = RefundCreditNoteBody.safeParse(req.body);
    if (!body.success) return badRequest(res, body.error.message);
    await refundCreditNote(params.data.id, body.data.amountCents, body.data.method ?? null, actorFrom(req.user));
    res.json(RefundCreditNoteResponse.parse(await serializedNote(params.data.id)));
  }),
);

router.post(
  "/credit-notes/:id/void",
  withDomainErrors(async (req, res) => {
    const params = VoidCreditNoteParams.safeParse(req.params);
    if (!params.success) return badRequest(res, params.error.message);
    await voidCreditNote(params.data.id, actorFrom(req.user));
    res.json(VoidCreditNoteResponse.parse(await serializedNote(params.data.id)));
  }),
);

export default router;
