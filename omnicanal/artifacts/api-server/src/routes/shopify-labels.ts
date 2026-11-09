import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetShopifyLabelDraftQueryParams,
  GetShopifyLabelDraftResponse,
  CreateShopifyLabelBody,
  CreateShopifyLabelResponse,
  RefreshShopifyLabelParams,
  RefreshShopifyLabelResponse,
  DiscardShopifyLabelParams,
  DiscardShopifyLabelResponse,
} from "@workspace/api-zod";
import { ShopifyError } from "../lib/shopify";
import { buyShopifyLabel, discardShopifyLabel, refreshShopifyLabel, shopifyLabelDraft, shopifyLabelPdf } from "../lib/shopify-labels";
import { actorFrom, badRequest, withDomainErrors } from "../lib/route-errors";

const router: IRouter = Router();

/** Los errores de Shopify llevan su mensaje para la persona; los de negocio, su estado; lo demás sigue al manejador global. */
function handle(handler: (req: Request, res: Response) => Promise<void>) {
  return withDomainErrors(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ShopifyError) {
        res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message });
        return;
      }
      throw err;
    }
  });
}

router.get(
  "/shopify-labels/draft",
  handle(async (req, res) => {
    const parsed = GetShopifyLabelDraftQueryParams.safeParse(req.query);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    res.json(GetShopifyLabelDraftResponse.parse(await shopifyLabelDraft(parsed.data.shipmentId, parsed.data.orderId)));
  }),
);

router.post(
  "/shopify-labels",
  handle(async (req, res) => {
    const parsed = CreateShopifyLabelBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const { shipmentId, orderId, weightOz } = parsed.data;
    res.json(CreateShopifyLabelResponse.parse(await buyShopifyLabel(shipmentId, orderId, { weightOz }, actorFrom(req.user), req.log)));
  }),
);

router.post(
  "/shopify-labels/:id/refresh",
  handle(async (req, res) => {
    const parsed = RefreshShopifyLabelParams.safeParse(req.params);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    res.json(RefreshShopifyLabelResponse.parse(await refreshShopifyLabel(parsed.data.id, actorFrom(req.user), req.log)));
  }),
);

router.post(
  "/shopify-labels/:id/discard",
  handle(async (req, res) => {
    const parsed = DiscardShopifyLabelParams.safeParse(req.params);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    res.json(DiscardShopifyLabelResponse.parse(await discardShopifyLabel(parsed.data.id, actorFrom(req.user), req.log)));
  }),
);

// El PDF de la etiqueta. Fuera del contrato de OpenAPI (el cuerpo no es JSON): el
// panel lo baja con su sesión y lo abre como blob.
router.get(
  "/shopify-labels/:id/pdf",
  handle(async (req, res) => {
    const parsed = DiscardShopifyLabelParams.safeParse(req.params);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const { pdf, filename } = await shopifyLabelPdf(parsed.data.id);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `inline; filename="${filename}"`);
    res.setHeader("cache-control", "private, no-store");
    res.send(pdf);
  }),
);

export default router;
