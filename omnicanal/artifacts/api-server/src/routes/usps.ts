import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, integrationSettingsTable, type IntegrationSettings } from "@workspace/db";
import {
  GetUspsSettingsResponse,
  UpdateUspsSettingsBody,
  UpdateUspsSettingsResponse,
  TestUspsConnectionResponse,
  GetUspsLabelDraftQueryParams,
  GetUspsLabelDraftResponse,
  ValidateUspsAddressBody,
  ValidateUspsAddressResponse,
  CreateUspsLabelBody,
  CreateUspsLabelResponse,
  VoidUspsLabelParams,
  VoidUspsLabelResponse,
  RefreshUspsLabelTrackingParams,
  RefreshUspsLabelTrackingResponse,
} from "@workspace/api-zod";
import { UspsError, USPS_MAIL_CLASSES, forgetUspsTokens, testUspsConnection } from "../lib/usps";
import {
  checkUspsAddress,
  createUspsLabel,
  missingForLabels,
  refreshUspsTracking,
  uspsCredentialsFrom,
  uspsEnvironmentOf,
  uspsLabelDraft,
  uspsLabelPdf,
  voidUspsLabel,
} from "../lib/usps-labels";
import { stateCode } from "../lib/us-address";
import { actorFrom, badRequest, withDomainErrors } from "../lib/route-errors";

const router: IRouter = Router();

async function getOrCreateSettings(): Promise<IntegrationSettings> {
  const [row] = await db.select().from(integrationSettingsTable).orderBy(integrationSettingsTable.id).limit(1);
  if (row) return row;
  const [created] = await db.insert(integrationSettingsTable).values({}).returning();
  return created;
}

// Los secretos nunca salen: solo si están puestos y, de la cuenta EPS, sus
// últimos dígitos para reconocerla.
function serialize(row: IntegrationSettings) {
  const mailClass = USPS_MAIL_CLASSES.find((c) => c === row.uspsDefaultMailClass) ?? "USPS_GROUND_ADVANTAGE";
  return {
    enabled: row.uspsEnabled,
    environment: uspsEnvironmentOf(row),
    clientId: row.uspsClientId,
    hasClientSecret: Boolean(row.uspsClientSecret),
    crid: row.uspsCrid,
    mid: row.uspsMid,
    manifestMid: row.uspsManifestMid,
    hasAccountNumber: Boolean(row.uspsAccountNumber),
    accountNumberPreview: row.uspsAccountNumber ? `••••${row.uspsAccountNumber.slice(-4)}` : null,
    fromName: row.uspsFromName,
    fromStreet: row.uspsFromStreet,
    fromStreet2: row.uspsFromStreet2,
    fromCity: row.uspsFromCity,
    fromState: row.uspsFromState,
    fromZip: row.uspsFromZip,
    defaultMailClass: mailClass,
    defaultWeightOz: row.uspsDefaultWeightOz,
    defaultLengthIn: row.uspsDefaultLengthIn,
    defaultWidthIn: row.uspsDefaultWidthIn,
    defaultHeightIn: row.uspsDefaultHeightIn,
    missing: missingForLabels(row),
  };
}

/** Los errores de USPS llevan su mensaje para la persona; los de negocio, su estado; lo demás sigue al manejador global. */
function handle(handler: (req: Request, res: Response) => Promise<void>) {
  return withDomainErrors(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof UspsError) {
        res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message });
        return;
      }
      throw err;
    }
  });
}

const text = (v: string | null | undefined): string | null => v?.trim() || null;

router.get("/settings/usps", async (_req, res): Promise<void> => {
  res.json(GetUspsSettingsResponse.parse(serialize(await getOrCreateSettings())));
});

router.put("/settings/usps", async (req, res): Promise<void> => {
  const parsed = UpdateUspsSettingsBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error.message);
  const body = parsed.data;
  const row = await getOrCreateSettings();
  const update: Partial<typeof integrationSettingsTable.$inferInsert> = { updatedAt: new Date() };

  if (body.enabled !== undefined) update.uspsEnabled = body.enabled;
  if (body.environment !== undefined) update.uspsEnvironment = body.environment;
  if (body.clientId !== undefined) update.uspsClientId = text(body.clientId);
  // Un secreto vacío deja el que está (igual que Shopify y Meta); null lo borra.
  if (body.clientSecret === null) update.uspsClientSecret = null;
  else if (typeof body.clientSecret === "string" && body.clientSecret.trim()) update.uspsClientSecret = body.clientSecret.trim();
  if (body.accountNumber === null) update.uspsAccountNumber = null;
  else if (typeof body.accountNumber === "string" && body.accountNumber.trim()) update.uspsAccountNumber = body.accountNumber.trim();
  if (body.crid !== undefined) update.uspsCrid = text(body.crid);
  if (body.mid !== undefined) update.uspsMid = text(body.mid);
  if (body.manifestMid !== undefined) update.uspsManifestMid = text(body.manifestMid);

  if (body.fromName !== undefined) update.uspsFromName = text(body.fromName);
  if (body.fromStreet !== undefined) update.uspsFromStreet = text(body.fromStreet);
  if (body.fromStreet2 !== undefined) update.uspsFromStreet2 = text(body.fromStreet2);
  if (body.fromCity !== undefined) update.uspsFromCity = text(body.fromCity);
  if (body.fromState !== undefined) {
    const state = text(body.fromState);
    if (state && !stateCode(state)) return badRequest(res, "El estado del remitente va con su sigla de dos letras (FL, NY…).");
    update.uspsFromState = state ? stateCode(state) : null;
  }
  if (body.fromZip !== undefined) {
    const zip = text(body.fromZip);
    if (zip && !/^\d{5}$/.test(zip)) return badRequest(res, "El ZIP del remitente son 5 dígitos.");
    update.uspsFromZip = zip;
  }

  if (body.defaultMailClass !== undefined) update.uspsDefaultMailClass = body.defaultMailClass;
  for (const [key, column] of [
    ["defaultWeightOz", "uspsDefaultWeightOz"],
    ["defaultLengthIn", "uspsDefaultLengthIn"],
    ["defaultWidthIn", "uspsDefaultWidthIn"],
    ["defaultHeightIn", "uspsDefaultHeightIn"],
  ] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (value !== null && !(value > 0)) return badRequest(res, "El peso y las medidas del paquete van mayores que cero.");
    update[column] = value;
  }

  const [saved] = await db.update(integrationSettingsTable).set(update).where(eq(integrationSettingsTable.id, row.id)).returning();
  // Otras credenciales u otro ambiente: los tokens guardados ya no valen.
  forgetUspsTokens();
  res.json(UpdateUspsSettingsResponse.parse(serialize(saved)));
});

router.post("/settings/usps/test", async (_req, res): Promise<void> => {
  const row = await getOrCreateSettings();
  const creds = uspsCredentialsFrom(row);
  if (!creds) {
    res.json(TestUspsConnectionResponse.parse({ ok: false, error: "Faltan el Consumer Key y el Consumer Secret." }));
    return;
  }
  try {
    const result = await testUspsConnection(creds);
    res.json(TestUspsConnectionResponse.parse({ ok: true, environment: creds.environment, payment: result.payment }));
  } catch (err) {
    res.json(TestUspsConnectionResponse.parse({ ok: false, environment: creds.environment, error: err instanceof Error ? err.message : "No se pudo conectar." }));
  }
});

router.get(
  "/usps/draft",
  handle(async (req, res) => {
    const parsed = GetUspsLabelDraftQueryParams.safeParse(req.query);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    res.json(GetUspsLabelDraftResponse.parse(await uspsLabelDraft(parsed.data.shipmentId, parsed.data.orderId)));
  }),
);

router.post(
  "/usps/validate-address",
  handle(async (req, res) => {
    const parsed = ValidateUspsAddressBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    res.json(ValidateUspsAddressResponse.parse(await checkUspsAddress({ ...parsed.data, ZIPCode: parsed.data.ZIPCode ?? "" })));
  }),
);

router.post(
  "/usps/labels",
  handle(async (req, res) => {
    const parsed = CreateUspsLabelBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const { shipmentId, orderId, to, package: pkg } = parsed.data;
    const created = await createUspsLabel(shipmentId, orderId, { to, package: pkg }, actorFrom(req.user), req.log);
    res.json(CreateUspsLabelResponse.parse(created));
  }),
);

router.post(
  "/usps/labels/:id/void",
  handle(async (req, res) => {
    const parsed = VoidUspsLabelParams.safeParse(req.params);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    res.json(VoidUspsLabelResponse.parse(await voidUspsLabel(parsed.data.id, actorFrom(req.user), req.log)));
  }),
);

router.post(
  "/usps/labels/:id/tracking",
  handle(async (req, res) => {
    const parsed = RefreshUspsLabelTrackingParams.safeParse(req.params);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    res.json(RefreshUspsLabelTrackingResponse.parse(await refreshUspsTracking(parsed.data.id)));
  }),
);

// El PDF de la etiqueta. Fuera del contrato de OpenAPI (el cuerpo no es JSON), como
// los adjuntos del pedido: el panel lo baja con su sesión y lo abre como blob.
router.get(
  "/usps/labels/:id/pdf",
  handle(async (req, res) => {
    const parsed = VoidUspsLabelParams.safeParse(req.params);
    if (!parsed.success) return badRequest(res, parsed.error.message);
    const { pdf, filename } = await uspsLabelPdf(parsed.data.id);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `inline; filename="${filename}"`);
    res.setHeader("cache-control", "private, no-store");
    res.send(pdf);
  }),
);

export default router;
