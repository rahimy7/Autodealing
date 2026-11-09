// Etiquetas de USPS para los envíos a Estados Unidos: la parada de un despacho con
// courier compra su etiqueta (USPS cobra el franqueo de la cuenta de pago), la
// guía queda en la parada —de ahí sale en el correo "va en camino"— y el franqueo
// entra a los cargos del despacho, o sea al costo del envío y al margen del
// pedido. Una etiqueta sin usar se puede anular y USPS devuelve el franqueo.
//
// Regla de seguridad: una etiqueta comprada en el ambiente de PRUEBAS (TEM) no es
// un paquete real. Se guarda para verla y bajar el PDF, pero no toca la parada
// (ni su guía, ni el courier, ni el pedido) ni los cargos: una guía de prueba no
// puede acabar en el correo de un cliente.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  integrationSettingsTable,
  ordersTable,
  contactsTable,
  shipmentsTable,
  shipmentOrdersTable,
  carriersTable,
  uspsLabelsTable,
  shopifyLabelsTable,
  type IntegrationSettings,
  type UspsLabel,
  type UspsLabelAddress,
} from "@workspace/db";
import { FulfillmentError, addShipmentCharge, removeShipmentCharge } from "./fulfillment";
import { defaultRateToBase, logOrderEvent } from "./orders";
import { orderCode, shipmentCode } from "./codes";
import { isStorageConfigured, uploadMedia } from "./supabase";
import { parseUsAddress, splitName, stateCode } from "./us-address";
import {
  UspsError,
  USPS_MAIL_CLASSES,
  uspsCancelLabel,
  uspsCreateLabel,
  uspsTrack,
  uspsValidateAddress,
  type UspsAddressCheck,
  type UspsCredentials,
  type UspsEnvironment,
  type UspsMailClass,
} from "./usps";
import { serializeUspsLabel } from "./usps-label-view";
import type { Actor } from "./inventory";
import type { Log } from "./messaging";

export const USPS_TRACKING_URL = "https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking}";

export const USPS_MAIL_CLASS_LABELS: Record<UspsMailClass, string> = {
  USPS_GROUND_ADVANTAGE: "Ground Advantage",
  PRIORITY_MAIL: "Priority Mail",
  PRIORITY_MAIL_EXPRESS: "Priority Mail Express",
};

// ── Configuración ─────────────────────────────────────────────────────────────

export async function loadUspsSettings(): Promise<IntegrationSettings | null> {
  const [row] = await db.select().from(integrationSettingsTable).orderBy(integrationSettingsTable.id).limit(1);
  return row ?? null;
}

export function uspsEnvironmentOf(row: IntegrationSettings | null): UspsEnvironment {
  return row?.uspsEnvironment === "production" ? "production" : "test";
}

/** Las credenciales guardadas, para el ambiente indicado (por defecto el configurado). Null si no hay Consumer Key/Secret. */
export function uspsCredentialsFrom(row: IntegrationSettings | null, environment?: UspsEnvironment): UspsCredentials | null {
  if (!row?.uspsClientId?.trim() || !row.uspsClientSecret?.trim()) return null;
  return {
    environment: environment ?? uspsEnvironmentOf(row),
    clientId: row.uspsClientId.trim(),
    clientSecret: row.uspsClientSecret.trim(),
    crid: row.uspsCrid,
    mid: row.uspsMid,
    manifestMid: row.uspsManifestMid,
    accountNumber: row.uspsAccountNumber,
  };
}

/** Lo que falta en Configuración para poder comprar etiquetas (vacío = listo). */
export function missingForLabels(row: IntegrationSettings | null): string[] {
  const missing: string[] = [];
  if (!row?.uspsClientId?.trim() || !row.uspsClientSecret?.trim()) missing.push("Consumer Key y Consumer Secret");
  if (!row?.uspsCrid?.trim()) missing.push("CRID");
  if (!row?.uspsMid?.trim()) missing.push("MID");
  if (!row?.uspsAccountNumber?.trim()) missing.push("número de cuenta EPS");
  if (!row?.uspsFromName?.trim() || !row.uspsFromStreet?.trim() || !row.uspsFromCity?.trim() || !stateCode(row.uspsFromState) || !/^\d{5}$/.test(row.uspsFromZip?.trim() ?? "")) {
    missing.push("dirección del remitente");
  }
  return missing;
}

async function requireCredentials(): Promise<{ settings: IntegrationSettings; creds: UspsCredentials }> {
  const settings = await loadUspsSettings();
  if (!settings?.uspsEnabled) throw new FulfillmentError("La integración con USPS está apagada: enciéndela en Configuración.", 409);
  const creds = uspsCredentialsFrom(settings);
  if (!creds) throw new FulfillmentError("Faltan el Consumer Key y el Consumer Secret de USPS en Configuración.", 409);
  return { settings, creds };
}

// ── Entrada de una etiqueta ───────────────────────────────────────────────────

export type UspsLabelInput = {
  to: { firstName?: string | null; lastName?: string | null; streetAddress: string; secondaryAddress?: string | null; city: string; state: string; ZIPCode: string; ZIPPlus4?: string | null };
  package: { mailClass: string; weightOz: number; lengthIn: number; widthIn: number; heightIn: number };
};

export type NormalizedLabelInput = {
  to: UspsLabelAddress;
  mailClass: UspsMailClass;
  weightLb: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

const MAX_WEIGHT_OZ = 70 * 16;
const MAX_SIDE_IN = 108;

/** Valida y deja en el formato de USPS lo que escribió la persona. Lanza 400 con el campo que falla. */
export function normalizeLabelInput(input: UspsLabelInput): NormalizedLabelInput {
  const bad = (message: string) => new FulfillmentError(message, 400);
  const firstName = input.to.firstName?.trim() ?? "";
  const lastName = input.to.lastName?.trim() ?? "";
  if (!firstName && !lastName) throw bad("Falta el nombre de quien recibe.");
  const streetAddress = input.to.streetAddress?.trim() ?? "";
  if (!streetAddress) throw bad("Falta la calle.");
  const city = input.to.city?.trim() ?? "";
  if (!city) throw bad("Falta la ciudad.");
  const state = stateCode(input.to.state);
  if (!state) throw bad("El estado va con su sigla de dos letras (FL, NY…).");
  const zip = input.to.ZIPCode?.trim() ?? "";
  if (!/^\d{5}$/.test(zip)) throw bad("El ZIP son 5 dígitos.");
  const plus4 = input.to.ZIPPlus4?.trim() || null;
  if (plus4 && !/^\d{4}$/.test(plus4)) throw bad("El ZIP+4 son 4 dígitos.");

  const mailClass = USPS_MAIL_CLASSES.find((c) => c === input.package.mailClass);
  if (!mailClass) throw bad("El servicio de USPS no es válido.");
  const { weightOz, lengthIn, widthIn, heightIn } = input.package;
  if (!(weightOz > 0) || weightOz > MAX_WEIGHT_OZ) throw bad("El peso va entre más de 0 y 1120 onzas (70 libras).");
  for (const [label, value] of [["largo", lengthIn], ["ancho", widthIn], ["alto", heightIn]] as const) {
    if (!(value > 0) || value > MAX_SIDE_IN) throw bad(`El ${label} del paquete va entre más de 0 y ${MAX_SIDE_IN} pulgadas.`);
  }
  return {
    to: { firstName, lastName, streetAddress, secondaryAddress: input.to.secondaryAddress?.trim() || null, city, state, ZIPCode: zip, ZIPPlus4: plus4 },
    mailClass,
    weightLb: weightOz / 16,
    lengthIn,
    widthIn,
    heightIn,
  };
}

/** La fecha de hoy en Nueva York (AAAA-MM-DD): USPS cuenta el día de envío allá, no en la hora de quien la crea. */
export function uspsMailingDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const usd = (cents: number) => `US$${(cents / 100).toFixed(2)}`;

// ── Borrador de la parada ─────────────────────────────────────────────────────

async function loadStop(shipmentId: number, orderId: number) {
  const [row] = await db
    .select({ shipment: shipmentsTable, stop: shipmentOrdersTable, order: ordersTable, contactName: contactsTable.name })
    .from(shipmentOrdersTable)
    .innerJoin(shipmentsTable, eq(shipmentsTable.id, shipmentOrdersTable.shipmentId))
    .innerJoin(ordersTable, eq(ordersTable.id, shipmentOrdersTable.orderId))
    .leftJoin(contactsTable, eq(contactsTable.id, ordersTable.contactId))
    .where(and(eq(shipmentOrdersTable.shipmentId, shipmentId), eq(shipmentOrdersTable.orderId, orderId)));
  if (!row) throw new FulfillmentError("Ese pedido no está en el despacho.", 404);
  return row;
}

async function liveLabelFor(shipmentId: number, orderId: number): Promise<UspsLabel | null> {
  const [label] = await db
    .select()
    .from(uspsLabelsTable)
    .where(and(eq(uspsLabelsTable.shipmentId, shipmentId), eq(uspsLabelsTable.orderId, orderId), inArray(uspsLabelsTable.status, ["creating", "active"])));
  return label ?? null;
}

/** Lo que el diálogo propone al crear la etiqueta de una parada: dirección leída del pedido y el paquete de siempre. */
export async function uspsLabelDraft(shipmentId: number, orderId: number) {
  const [settings, { order, contactName }, label] = await Promise.all([loadUspsSettings(), loadStop(shipmentId, orderId), liveLabelFor(shipmentId, orderId)]);
  const parsed = parseUsAddress(order.address);
  const { firstName, lastName } = splitName(contactName ?? parsed.name);
  return {
    enabled: Boolean(settings?.uspsEnabled),
    environment: uspsEnvironmentOf(settings),
    missing: missingForLabels(settings),
    address: order.address,
    to: {
      firstName,
      lastName,
      streetAddress: parsed.streetAddress,
      secondaryAddress: parsed.secondaryAddress,
      city: parsed.city,
      state: parsed.state,
      ZIPCode: parsed.ZIPCode,
      ZIPPlus4: parsed.ZIPPlus4,
    },
    package: {
      mailClass: settings?.uspsDefaultMailClass ?? "USPS_GROUND_ADVANTAGE",
      weightOz: settings?.uspsDefaultWeightOz ?? null,
      lengthIn: settings?.uspsDefaultLengthIn ?? null,
      widthIn: settings?.uspsDefaultWidthIn ?? null,
      heightIn: settings?.uspsDefaultHeightIn ?? null,
    },
    label: label ? serializeUspsLabel(label) : null,
  };
}

/** Pregunta a USPS si la dirección existe y cómo la escribe. */
export async function checkUspsAddress(to: UspsLabelInput["to"]): Promise<UspsAddressCheck> {
  const { creds } = await requireCredentials();
  const state = stateCode(to.state);
  if (!to.streetAddress?.trim() || !to.city?.trim() || !state) throw new FulfillmentError("Para validar hacen falta la calle, la ciudad y el estado.", 400);
  return uspsValidateAddress(creds, { streetAddress: to.streetAddress.trim(), secondaryAddress: to.secondaryAddress?.trim() || null, city: to.city.trim(), state, ZIPCode: to.ZIPCode?.trim() ?? "", ZIPPlus4: to.ZIPPlus4?.trim() || null });
}

// ── Courier USPS ──────────────────────────────────────────────────────────────

const isUsps = (name: string | null | undefined) => name?.trim().toLowerCase() === "usps";

/** El courier "USPS" del catálogo, con su enlace de rastreo; lo crea la primera vez. */
export async function ensureUspsCarrier(): Promise<number> {
  const rows = await db.select().from(carriersTable);
  const found = rows.find((c) => isUsps(c.name));
  if (found) {
    if (!found.trackingUrlTemplate || !found.active) {
      await db.update(carriersTable).set({ trackingUrlTemplate: found.trackingUrlTemplate ?? USPS_TRACKING_URL, active: true }).where(eq(carriersTable.id, found.id));
    }
    return found.id;
  }
  const [created] = await db.insert(carriersTable).values({ name: "USPS", kind: "courier", trackingUrlTemplate: USPS_TRACKING_URL }).returning({ id: carriersTable.id });
  return created.id;
}

// ── Comprar ───────────────────────────────────────────────────────────────────

const isUniqueViolation = (err: unknown) => (err as { cause?: { code?: string } }).cause?.code === "23505" || (err as { code?: string }).code === "23505";

/**
 * Compra la etiqueta de USPS de una parada. Antes de llamar a USPS se reserva la
 * parada (`creating`): dos clics seguidos no pagan dos etiquetas.
 */
export async function createUspsLabel(shipmentId: number, orderId: number, input: UspsLabelInput, actor: Actor, log: Log) {
  const { settings, creds } = await requireCredentials();
  const missing = missingForLabels(settings);
  if (missing.length) throw new FulfillmentError(`Falta en Configuración → USPS: ${missing.join(", ")}.`, 409);
  const normalized = normalizeLabelInput(input);

  const { shipment, order } = await loadStop(shipmentId, orderId);
  // Un pedido que ya tiene guía en Shopify (o una etiqueta de Shopify en esta parada) no compra otra: sería pagar dos veces.
  if (order.externalTracking?.length) {
    throw new FulfillmentError(`Este pedido ya tiene guía en Shopify (${order.externalTracking.map((t) => t.number).join(", ")}). Se usa al despachar; no compres otra etiqueta.`, 409);
  }
  const [shopifyLive] = await db
    .select({ id: shopifyLabelsTable.id })
    .from(shopifyLabelsTable)
    .where(and(eq(shopifyLabelsTable.shipmentId, shipmentId), eq(shopifyLabelsTable.orderId, orderId), inArray(shopifyLabelsTable.status, ["creating", "active"])));
  if (shopifyLive) throw new FulfillmentError("Esta parada ya tiene una etiqueta comprada con Shopify. Descártala antes de comprar otra.", 409);
  if (shipment.status !== "planning") throw new FulfillmentError("La etiqueta se crea antes de registrar el despacho: este ya salió o se canceló.", 409);
  if (shipment.kind !== "courier") throw new FulfillmentError("Las etiquetas de USPS son para despachos con courier, no para viajes de reparto propio.", 409);
  if (shipment.carrierId != null) {
    const [carrier] = await db.select().from(carriersTable).where(eq(carriersTable.id, shipment.carrierId));
    if (!isUsps(carrier?.name)) throw new FulfillmentError(`Este despacho va con otro courier (${carrier?.name ?? "?"}). Cámbialo a USPS para comprar la etiqueta.`, 409);
  }

  const environment = creds.environment;
  let reserved: UspsLabel;
  try {
    [reserved] = await db
      .insert(uspsLabelsTable)
      .values({
        orderId,
        shipmentId,
        status: "creating",
        environment,
        mailClass: normalized.mailClass,
        weightLb: normalized.weightLb,
        lengthIn: normalized.lengthIn,
        widthIn: normalized.widthIn,
        heightIn: normalized.heightIn,
        toAddress: normalized.to,
        createdByAgentId: actor.agentId,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw new FulfillmentError("Esta parada ya tiene una etiqueta de USPS (o se está creando). Anúlala antes de crear otra.", 409);
    throw err;
  }

  const from = {
    ...splitName(settings.uspsFromName),
    streetAddress: settings.uspsFromStreet!.trim(),
    secondaryAddress: settings.uspsFromStreet2?.trim() || null,
    city: settings.uspsFromCity!.trim(),
    state: stateCode(settings.uspsFromState)!,
    ZIPCode: settings.uspsFromZip!.trim(),
  };

  let created;
  try {
    created = await uspsCreateLabel(creds, {
      from,
      to: normalized.to,
      mailClass: normalized.mailClass,
      weightLb: normalized.weightLb,
      lengthIn: normalized.lengthIn,
      widthIn: normalized.widthIn,
      heightIn: normalized.heightIn,
      mailingDate: uspsMailingDate(),
    });
  } catch (err) {
    // Nada quedó comprado (o no se sabe): se libera la parada para poder reintentar.
    await db.delete(uspsLabelsTable).where(eq(uspsLabelsTable.id, reserved.id));
    if (err instanceof UspsError && !err.definitive) {
      log.error({ err, orderId, shipmentId }, "usps label: no confirmation from USPS");
      throw new UspsError(`${err.message} Antes de intentarlo de nuevo, revisa en tu cuenta de USPS que no se haya creado la etiqueta, para no pagarla dos veces.`, err.status, false);
    }
    throw err;
  }

  // Desde aquí el franqueo está cobrado: lo que se pueda, se guarda sin perder la guía ni el PDF.
  const real = environment === "production";
  const base = {
    status: "active" as const,
    trackingNumber: created.trackingNumber,
    postageCents: created.postageCents,
    extraCents: created.extraCents,
    commitmentName: created.commitmentName,
    commitmentDate: created.commitmentDate,
    labelPdf: created.pdf.toString("base64"),
    updatedAt: new Date(),
  };
  let label: UspsLabel;
  try {
    label = await db.transaction(async (tx) => {
      const [saved] = await tx.update(uspsLabelsTable).set(base).where(eq(uspsLabelsTable.id, reserved.id)).returning();
      if (real) {
        const carrierId = shipment.carrierId ?? (await ensureUspsCarrier());
        if (shipment.carrierId == null) await tx.update(shipmentsTable).set({ carrierId, updatedAt: new Date() }).where(eq(shipmentsTable.id, shipmentId));
        await tx.update(shipmentOrdersTable).set({ trackingNumber: created.trackingNumber }).where(and(eq(shipmentOrdersTable.shipmentId, shipmentId), eq(shipmentOrdersTable.orderId, orderId)));
      }
      await logOrderEvent(
        tx,
        orderId,
        "usps_label",
        real
          ? `Etiqueta de USPS creada para ${shipmentCode(shipmentId)}: guía ${created.trackingNumber}, franqueo ${usd(created.postageCents)} (${USPS_MAIL_CLASS_LABELS[normalized.mailClass]}).`
          : `Etiqueta de USPS de PRUEBA para ${shipmentCode(shipmentId)} (guía ${created.trackingNumber}): no es un paquete real ni se cobró.`,
        actor,
        { shipmentId, labelId: reserved.id, trackingNumber: created.trackingNumber, environment },
      );
      return saved;
    });
  } catch (err) {
    log.error({ err, orderId, shipmentId, trackingNumber: created.trackingNumber, postageCents: created.postageCents, environment }, "usps label: bought but could not be saved");
    throw new UspsError(
      `USPS creó la etiqueta (guía ${created.trackingNumber}, franqueo ${usd(created.postageCents)}) pero no se pudo guardar aquí. Anota la guía y búscala en tu cuenta de USPS; no la compres otra vez.`,
      500,
      false,
    );
  }

  const warnings: string[] = [];
  if (real) {
    // El franqueo es costo del envío de este pedido: va a los cargos del despacho.
    try {
      const rate = await defaultRateToBase("USD");
      if (rate == null) {
        warnings.push("No se anotó el franqueo en los cargos del despacho: falta la tasa para llevar USD a la moneda base. Agrégalo a mano.");
      } else if (created.postageCents > 0) {
        const chargeId = await addShipmentCharge(shipmentId, {
          concept: "Courier",
          amountCents: created.postageCents,
          currency: "USD",
          rateToBase: rate,
          orderId,
          notes: `Franqueo USPS, guía ${created.trackingNumber}`,
        });
        [label] = await db.update(uspsLabelsTable).set({ chargeId }).where(eq(uspsLabelsTable.id, label.id)).returning();
      }
    } catch (err) {
      log.error({ err, orderId, shipmentId }, "usps label: postage charge not recorded");
      warnings.push("No se pudo anotar el franqueo en los cargos del despacho. Agrégalo a mano.");
    }

    // La copia en el almacenamiento: es la "etiqueta de envío" que ya muestra el pedido.
    if (isStorageConfigured()) {
      try {
        const path = `order-${order.id}-etiqueta-${randomUUID()}.pdf`;
        if (await uploadMedia(path, created.pdf, "application/pdf")) {
          await db.update(ordersTable).set({ shippingLabelPath: path, updatedAt: new Date() }).where(eq(ordersTable.id, order.id));
          [label] = await db.update(uspsLabelsTable).set({ labelPath: path }).where(eq(uspsLabelsTable.id, label.id)).returning();
        }
      } catch (err) {
        log.warn({ err, orderId }, "usps label: copy to storage failed (the PDF is saved in the database)");
      }
    }
  }
  log.info({ orderId, shipmentId, trackingNumber: created.trackingNumber, environment }, "usps label created");
  return { label: serializeUspsLabel(label), warnings };
}

// ── Anular ────────────────────────────────────────────────────────────────────

async function loadLabel(id: number): Promise<UspsLabel> {
  const [label] = await db.select().from(uspsLabelsTable).where(eq(uspsLabelsTable.id, id));
  if (!label) throw new FulfillmentError("Etiqueta no encontrada.", 404);
  return label;
}

/** Anula una etiqueta sin usar: USPS devuelve el franqueo y aquí se quita su guía y su cargo. */
export async function voidUspsLabel(labelId: number, actor: Actor, log: Log) {
  const label = await loadLabel(labelId);
  if (label.status !== "active" || !label.trackingNumber) throw new FulfillmentError("Solo se anula una etiqueta creada y vigente.", 409);
  const settings = await loadUspsSettings();
  // Con las credenciales del ambiente en que se compró, aunque ahora esté configurado el otro.
  const creds = uspsCredentialsFrom(settings, label.environment === "production" ? "production" : "test");
  if (!creds) throw new FulfillmentError("Faltan el Consumer Key y el Consumer Secret de USPS en Configuración.", 409);

  const { message } = await uspsCancelLabel(creds, label.trackingNumber);
  const [voided] = await db
    .update(uspsLabelsTable)
    .set({ status: "voided", voidedAt: new Date(), voidNote: message, updatedAt: new Date() })
    .where(eq(uspsLabelsTable.id, label.id))
    .returning();

  try {
    if (label.chargeId != null && label.shipmentId != null) await removeShipmentCharge(label.shipmentId, label.chargeId);
    if (label.shipmentId != null) {
      await db
        .update(shipmentOrdersTable)
        .set({ trackingNumber: null })
        .where(and(eq(shipmentOrdersTable.shipmentId, label.shipmentId), eq(shipmentOrdersTable.orderId, label.orderId), eq(shipmentOrdersTable.trackingNumber, label.trackingNumber)));
    }
    if (label.labelPath) {
      await db.update(ordersTable).set({ shippingLabelPath: null, updatedAt: new Date() }).where(and(eq(ordersTable.id, label.orderId), eq(ordersTable.shippingLabelPath, label.labelPath)));
    }
    await logOrderEvent(db, label.orderId, "usps_label", `Etiqueta de USPS anulada (guía ${label.trackingNumber}): se pidió el reembolso del franqueo.${message ? ` USPS: ${message}` : ""}`, actor, {
      labelId: label.id,
      trackingNumber: label.trackingNumber,
    });
  } catch (err) {
    log.error({ err, labelId }, "usps label: voided at USPS but local cleanup failed");
  }
  log.info({ labelId, trackingNumber: label.trackingNumber }, "usps label voided");
  return serializeUspsLabel(voided);
}

// ── Rastrear ──────────────────────────────────────────────────────────────────

/** Consulta el estado de la guía en USPS y lo deja en la etiqueta. No cambia el pedido: eso lo decide el equipo. */
export async function refreshUspsTracking(labelId: number) {
  const label = await loadLabel(labelId);
  if (label.status !== "active" || !label.trackingNumber) throw new FulfillmentError("Solo se rastrea una etiqueta vigente.", 409);
  const creds = uspsCredentialsFrom(await loadUspsSettings(), label.environment === "production" ? "production" : "test");
  if (!creds) throw new FulfillmentError("Faltan el Consumer Key y el Consumer Secret de USPS en Configuración.", 409);
  const tracking = await uspsTrack(creds, label.trackingNumber);
  const [updated] = await db
    .update(uspsLabelsTable)
    .set({ trackingStatus: tracking.status, trackingCategory: tracking.statusCategory, trackingSummary: tracking.summary, trackingCheckedAt: new Date(), updatedAt: new Date() })
    .where(eq(uspsLabelsTable.id, label.id))
    .returning();
  return serializeUspsLabel(updated);
}

// ── PDF ───────────────────────────────────────────────────────────────────────

export async function uspsLabelPdf(labelId: number): Promise<{ pdf: Buffer; filename: string }> {
  const label = await loadLabel(labelId);
  if (!label.labelPdf) throw new FulfillmentError("Esta etiqueta no tiene PDF guardado.", 404);
  return { pdf: Buffer.from(label.labelPdf, "base64"), filename: `${orderCode(label.orderId)}-usps-${label.trackingNumber ?? label.id}.pdf` };
}
