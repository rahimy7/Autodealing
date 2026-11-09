// Etiquetas de envío de los pedidos de Shopify (2026-10-20): se leen las guías que
// Shopify ya tiene y se compra la etiqueta desde el despacho con la API de
// etiquetas de Shopify Shipping (`shippingLabelPurchase`, versión 2026-07 o mayor).
// https://shopify.dev/docs/apps/build/orders-fulfillment/order-management-apps/purchase-shipping-labels
//
// Lo que esa API NO da (y por eso no se finge aquí):
//   - el precio antes de comprar: sin `preferredRateSelection`, Shopify elige la
//     tarifa que escogió el cliente, la preferida de la tienda o la recomendada;
//   - el costo de la etiqueta: no entra a los cargos solo, se anota a mano;
//   - anularla: se anula en el admin de Shopify y aquí se "descarta";
//   - listar las etiquetas que alguien compró a mano en el admin: de esas solo
//     llega la guía, por el cumplimiento del pedido (shopify-sync).
//
// Sin probar contra una tienda real: las respuestas salen de la documentación de
// Shopify. La compra cobra a la cuenta de Shopify y va apagada hasta que se
// enciende en Configuración, después de dar a la app los permisos de escritura.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, ordersTable, shipmentsTable, shipmentOrdersTable, uspsLabelsTable, shopifyLabelsTable, carriersTable, type ShopifyLabel, type ExternalTracking } from "@workspace/db";
import { FulfillmentError } from "./fulfillment";
import { logOrderEvent } from "./orders";
import { shipmentCode } from "./codes";
import { isStorageConfigured, uploadMedia } from "./supabase";
import { ShopifyError, shopifyAccessToken, shopifyGraphql, type ShopifyCredentials } from "./shopify";
import { credentialsFrom, loadShopifySettings } from "./shopify-sync";
import { ensureUspsCarrier } from "./usps-labels";
import { serializeShopifyLabel } from "./shopify-label-view";
import type { Actor } from "./inventory";
import type { Log } from "./messaging";

// ── GraphQL ───────────────────────────────────────────────────────────────────

const FULFILLMENT_ORDERS_QUERY = `
query FulfillmentOrdersForLabel($id: ID!) {
  order(id: $id) {
    id
    name
    fulfillmentOrders(first: 10) {
      nodes { id status requestStatus assignedLocation { name } destination { city countryCode } }
    }
  }
}`;

const PURCHASE_MUTATION = `
mutation PurchaseShippingLabel($input: ShippingLabelPurchaseInput!) {
  shippingLabelPurchase(shippingLabelPurchase: $input) {
    shippingLabelPurchaseResult { id status }
    userErrors { field code message }
  }
}`;

const LABEL_FIELDS = `
  id
  cancellable
  printed
  trackingInfo { number company url }
  shippingDocuments { documentType format url }
`;

const PURCHASE_RESULT_QUERY = `
query ShippingLabelPurchaseResult($id: ID!) {
  node(id: $id) {
    ... on ShippingLabelPurchaseResult {
      id
      status
      done
      errors { code message }
      shippingLabels { ${LABEL_FIELDS} }
    }
  }
}`;

const LABEL_QUERY = `
query ShippingLabelById($id: ID!) {
  shippingLabel(id: $id) { ${LABEL_FIELDS} }
}`;

export type ShopifyLabelData = {
  id: string;
  cancellable: boolean | null;
  printed: boolean | null;
  trackingInfo: { number: string | null; company: string | null; url: string | null } | null;
  shippingDocuments: Array<{ documentType: string | null; format: string | null; url: string | null }>;
};

export type ShopifyPurchaseResult = {
  id: string;
  status: string;
  done?: boolean;
  errors: Array<{ code: string | null; message: string | null }>;
  shippingLabels: ShopifyLabelData[];
};

export type ShopifyFulfillmentOrder = {
  id: string;
  status: string;
  requestStatus?: string | null;
  assignedLocation: { name: string | null } | null;
  destination: { city: string | null; countryCode: string | null } | null;
};

/** Los envíos del pedido en Shopify que se pueden etiquetar: abiertos o en curso. */
export function eligibleFulfillmentOrders(nodes: ShopifyFulfillmentOrder[]): ShopifyFulfillmentOrder[] {
  return nodes.filter((n) => (n.status === "OPEN" || n.status === "IN_PROGRESS") && n.assignedLocation != null);
}

export async function shopifyFulfillmentOrders(creds: ShopifyCredentials, orderGid: string): Promise<{ name: string; nodes: ShopifyFulfillmentOrder[] }> {
  const data = await shopifyGraphql<{ order: { name: string; fulfillmentOrders: { nodes: ShopifyFulfillmentOrder[] } } | null }>(creds, FULFILLMENT_ORDERS_QUERY, { id: orderGid });
  if (!data.order) throw new ShopifyError("Shopify no encontró este pedido.", 404);
  return { name: data.order.name, nodes: data.order.fulfillmentOrders.nodes };
}

/** Mensaje claro cuando a la app le faltan los permisos de escritura. */
function explain(err: unknown): never {
  if (err instanceof ShopifyError && /access denied|ACCESS_DENIED|scope/i.test(err.message)) {
    throw new ShopifyError(
      `${err.message} — La app de Shopify necesita los permisos write_orders y write_merchant_managed_fulfillment_orders (y que la tienda haya aceptado los términos de Shopify Shipping). Agrégalos en el Dev Dashboard, publica la versión y vuelve a instalarla.`,
      400,
    );
  }
  throw err;
}

/** Pide la compra; es asíncrona: devuelve el id del resultado para consultarlo. Un fallo sin respuesta pudo haber cobrado. */
export async function shopifyPurchaseLabel(creds: ShopifyCredentials, input: { fulfillmentOrderId: string; weightOz?: number | null; now?: Date }): Promise<string> {
  const shippingDatetime = new Date((input.now ?? new Date()).getTime() + 15 * 60 * 1000).toISOString();
  let data: { shippingLabelPurchase: { shippingLabelPurchaseResult: { id: string; status: string } | null; userErrors: Array<{ field: string[] | null; code: string | null; message: string }> } };
  try {
    data = await shopifyGraphql(creds, PURCHASE_MUTATION, {
      input: {
        fulfillmentOrderId: input.fulfillmentOrderId,
        // Tiene que ser a futuro; el aviso al cliente lo manda nuestro correo al despachar, no Shopify.
        shippingDatetime,
        notifyCustomer: false,
        ...(input.weightOz && input.weightOz > 0 ? { totalWeight: { value: input.weightOz, unit: "OUNCES" } } : {}),
      },
    });
  } catch (err) {
    if (err instanceof ShopifyError) explain(err);
    // Sin respuesta (red): no se sabe si Shopify llegó a comprarla.
    const reason = err instanceof Error ? err.message : String(err);
    throw new ShopifyError(`No hubo respuesta de Shopify (${reason}). Antes de intentarlo de nuevo, revisa en el admin de Shopify que no se haya comprado la etiqueta, para no pagarla dos veces.`, 502);
  }
  const { shippingLabelPurchaseResult: result, userErrors } = data.shippingLabelPurchase;
  if (userErrors.length || !result) {
    throw new ShopifyError(`Shopify no compró la etiqueta: ${userErrors.map((e) => e.message).join("; ") || "sin detalle"}.`, 400);
  }
  return result.id;
}

export async function shopifyPurchaseResult(creds: ShopifyCredentials, id: string): Promise<ShopifyPurchaseResult> {
  const data = await shopifyGraphql<{ node: ShopifyPurchaseResult | null }>(creds, PURCHASE_RESULT_QUERY, { id });
  if (!data.node) throw new ShopifyError("Shopify no reconoce el resultado de la compra.", 404);
  return data.node;
}

/** Espera a que la compra termine: PURCHASED, PURCHASE_FAILED o, pasado el tiempo, el último estado visto. */
export async function waitForPurchase(
  creds: ShopifyCredentials,
  id: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<ShopifyPurchaseResult> {
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  for (;;) {
    const result = await shopifyPurchaseResult(creds, id);
    if (result.status === "PURCHASED" || result.status === "PURCHASE_FAILED" || Date.now() >= deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs ?? 1500));
  }
}

export async function shopifyLabelById(creds: ShopifyCredentials, id: string): Promise<ShopifyLabelData | null> {
  const data = await shopifyGraphql<{ shippingLabel: ShopifyLabelData | null }>(creds, LABEL_QUERY, { id });
  return data.shippingLabel;
}

/** El documento de la etiqueta (no el formulario de aduanas, si viene). */
export function labelDocument(label: ShopifyLabelData): { url: string; format: string | null } | null {
  const docs = label.shippingDocuments.filter((d) => d.url);
  const doc = docs.find((d) => d.documentType?.toUpperCase() === "LABEL") ?? docs[0];
  return doc?.url ? { url: doc.url, format: doc.format } : null;
}

/**
 * Baja el PDF. Shopify no dice si el enlace es público o pide el token: se
 * prueba sin él y, si lo rechaza, con él (sin mandarlo a otro dominio que no sea el de Shopify).
 */
export async function downloadLabelPdf(creds: ShopifyCredentials, url: string): Promise<Buffer | null> {
  const fetchOnce = async (headers: Record<string, string>) => fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  let res = await fetchOnce({});
  if ((res.status === 401 || res.status === 403) && /(^|\.)(myshopify\.com|shopify\.com)$/i.test(new URL(url).hostname)) {
    res = await fetchOnce({ "x-shopify-access-token": await shopifyAccessToken(creds) });
  }
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.subarray(0, 4).toString("latin1") === "%PDF" ? bytes : null;
}

// ── Negocio ───────────────────────────────────────────────────────────────────

type SettingsGate = { creds: ShopifyCredentials; enabled: boolean };

async function loadGate(): Promise<SettingsGate | null> {
  const settings = await loadShopifySettings();
  const creds = settings ? credentialsFrom(settings) : null;
  return creds ? { creds, enabled: Boolean(settings?.shopifyEnabled && settings.shopifyLabelsEnabled) } : null;
}

async function loadStop(shipmentId: number, orderId: number) {
  const [row] = await db
    .select({ shipment: shipmentsTable, stop: shipmentOrdersTable, order: ordersTable })
    .from(shipmentOrdersTable)
    .innerJoin(shipmentsTable, eq(shipmentsTable.id, shipmentOrdersTable.shipmentId))
    .innerJoin(ordersTable, eq(ordersTable.id, shipmentOrdersTable.orderId))
    .where(and(eq(shipmentOrdersTable.shipmentId, shipmentId), eq(shipmentOrdersTable.orderId, orderId)));
  if (!row) throw new FulfillmentError("Ese pedido no está en el despacho.", 404);
  return row;
}

async function liveLabelFor(shipmentId: number, orderId: number): Promise<ShopifyLabel | null> {
  const [label] = await db
    .select()
    .from(shopifyLabelsTable)
    .where(and(eq(shopifyLabelsTable.shipmentId, shipmentId), eq(shopifyLabelsTable.orderId, orderId), inArray(shopifyLabelsTable.status, ["creating", "active"])));
  return label ?? null;
}

/** Por qué no se puede comprar la etiqueta de esta parada con Shopify (null = se puede). */
export function labelBlocker(input: {
  gate: SettingsGate | null;
  order: { source: string; externalId: string | null; externalTracking: ExternalTracking[] | null };
  shipment: { status: string; kind: string };
  hasUspsLabel: boolean;
}): string | null {
  if (!input.gate) return "Shopify no está conectado en Configuración.";
  if (!input.gate.enabled) return "La compra de etiquetas con Shopify está apagada: enciéndela en Configuración → Shopify.";
  if (input.order.source !== "shopify" || !input.order.externalId) return "Este pedido no es de Shopify: usa la etiqueta de USPS directo.";
  if (input.order.externalTracking?.length) {
    return `Este pedido ya tiene guía en Shopify (${input.order.externalTracking.map((t) => t.number).join(", ")}). Se usa al despachar; no hace falta otra etiqueta.`;
  }
  if (input.shipment.status !== "planning") return "La etiqueta se crea antes de registrar el despacho: este ya salió o se canceló.";
  if (input.shipment.kind !== "courier") return "Las etiquetas son para despachos con courier, no para viajes de reparto propio.";
  if (input.hasUspsLabel) return "Esta parada ya tiene una etiqueta de USPS directo. Anúlala antes de comprar otra.";
  return null;
}

export async function shopifyLabelDraft(shipmentId: number, orderId: number) {
  const [gate, { order, shipment }, label, usps] = await Promise.all([
    loadGate(),
    loadStop(shipmentId, orderId),
    liveLabelFor(shipmentId, orderId),
    db.select({ id: uspsLabelsTable.id }).from(uspsLabelsTable).where(and(eq(uspsLabelsTable.shipmentId, shipmentId), eq(uspsLabelsTable.orderId, orderId), inArray(uspsLabelsTable.status, ["creating", "active"]))),
  ]);
  return {
    orderName: order.externalName,
    blocker: label ? null : labelBlocker({ gate, order, shipment, hasUspsLabel: usps.length > 0 }),
    // Si no se puede con Shopify, ¿vale el USPS directo? Sí mientras el pedido no tenga ya una guía ni una etiqueta.
    uspsFallback: !label && !(order.externalTracking?.length) && usps.length === 0,
    externalTracking: (order.externalTracking ?? []).map((t) => ({ number: t.number, company: t.company, url: t.url, deliveredAt: t.deliveredAt })),
    label: label ? serializeShopifyLabel(label) : null,
  };
}

const isUniqueViolation = (err: unknown) => (err as { cause?: { code?: string } }).cause?.code === "23505" || (err as { code?: string }).code === "23505";

/** Lo que pasa cuando la compra terminó bien: la guía, el courier, el PDF y el expediente. Compartida con "Consultar". */
async function finalizePurchased(label: ShopifyLabel, data: ShopifyLabelData, creds: ShopifyCredentials, actor: Actor, log: Log): Promise<{ label: ShopifyLabel; warnings: string[] }> {
  const warnings: string[] = [];
  const doc = labelDocument(data);
  let pdf: Buffer | null = null;
  if (doc) {
    try {
      pdf = await downloadLabelPdf(creds, doc.url);
    } catch (err) {
      log.warn({ err, labelId: label.id }, "shopify label: could not download the PDF");
    }
  }
  if (!pdf) warnings.push("No se pudo bajar el PDF de la etiqueta: imprímela desde el admin de Shopify.");

  const tracking = data.trackingInfo;
  const number = tracking?.number?.trim() || null;
  let saved: ShopifyLabel;
  try {
    saved = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(shopifyLabelsTable)
        .set({
          status: "active",
          shopifyLabelId: data.id,
          trackingNumber: number,
          trackingCompany: tracking?.company?.trim() || null,
          trackingUrl: tracking?.url?.trim() || null,
          labelPdf: pdf ? pdf.toString("base64") : null,
          documentUrl: doc?.url ?? null,
          cancellable: data.cancellable,
          updatedAt: new Date(),
        })
        .where(eq(shopifyLabelsTable.id, label.id))
        .returning();
      if (number && label.shipmentId != null) {
        await tx.update(shipmentOrdersTable).set({ trackingNumber: number }).where(and(eq(shipmentOrdersTable.shipmentId, label.shipmentId), eq(shipmentOrdersTable.orderId, label.orderId)));
        // Ya la tiene Shopify: así el despacho la ve igual que una comprada allá.
        const [order] = await tx.select({ externalTracking: ordersTable.externalTracking }).from(ordersTable).where(eq(ordersTable.id, label.orderId));
        if (!(order?.externalTracking ?? []).some((t) => t.number === number)) {
          const entry: ExternalTracking = { fulfillmentId: label.purchaseResultId ?? data.id, number, company: row.trackingCompany, url: row.trackingUrl, deliveredAt: null };
          await tx.update(ordersTable).set({ externalTracking: [...(order?.externalTracking ?? []), entry], updatedAt: new Date() }).where(eq(ordersTable.id, label.orderId));
        }
      }
      await logOrderEvent(
        tx,
        label.orderId,
        "shopify_label",
        `Etiqueta comprada con Shopify${label.shipmentId != null ? ` para ${shipmentCode(label.shipmentId)}` : ""}: guía ${number ?? "—"}${tracking?.company ? ` (${tracking.company})` : ""}. Shopify no informa el costo: anótalo en los cargos del despacho.`,
        actor,
        { labelId: label.id, trackingNumber: number, shopifyLabelId: data.id },
      );
      return row;
    });
  } catch (err) {
    log.error({ err, labelId: label.id, trackingNumber: number }, "shopify label: bought but could not be saved");
    throw new ShopifyError(`Shopify compró la etiqueta${number ? ` (guía ${number})` : ""} pero no se pudo guardar aquí. Búscala en el admin de Shopify; no la compres otra vez.`, 500);
  }

  // El carrier del despacho: USPS es el único que conocemos con enlace de rastreo.
  if (label.shipmentId != null && /^usps$/i.test(tracking?.company?.trim() ?? "")) {
    try {
      const [shipment] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, label.shipmentId));
      if (shipment && shipment.carrierId == null) {
        await db.update(shipmentsTable).set({ carrierId: await ensureUspsCarrier(), updatedAt: new Date() }).where(eq(shipmentsTable.id, shipment.id));
      }
    } catch (err) {
      log.warn({ err, labelId: label.id }, "shopify label: carrier not assigned");
    }
  } else if (label.shipmentId != null) {
    const [shipment] = await db.select({ carrierId: shipmentsTable.carrierId }).from(shipmentsTable).where(eq(shipmentsTable.id, label.shipmentId));
    if (shipment?.carrierId != null) {
      const [carrier] = await db.select({ name: carriersTable.name }).from(carriersTable).where(eq(carriersTable.id, shipment.carrierId));
      if (carrier && tracking?.company && carrier.name.trim().toLowerCase() !== tracking.company.trim().toLowerCase()) {
        warnings.push(`El despacho va con ${carrier.name} y esta etiqueta es de ${tracking.company}.`);
      }
    }
  }

  if (pdf && isStorageConfigured()) {
    try {
      const path = `order-${label.orderId}-etiqueta-${randomUUID()}.pdf`;
      if (await uploadMedia(path, pdf, "application/pdf")) await db.update(ordersTable).set({ shippingLabelPath: path, updatedAt: new Date() }).where(eq(ordersTable.id, label.orderId));
    } catch (err) {
      log.warn({ err, labelId: label.id }, "shopify label: copy to storage failed (the PDF is saved in the database)");
    }
  }
  warnings.push("Shopify no informa el costo de la etiqueta: anótalo en «Cargos del envío» cuando lo veas en Shopify.");
  return { label: saved, warnings };
}

/**
 * Compra la etiqueta de un pedido de Shopify desde su parada del despacho. Antes
 * de llamar a Shopify se reserva la parada (`creating`): dos clics no compran dos
 * etiquetas. La compra es asíncrona: si Shopify tarda, la parada queda en
 * `creating` con el id de la compra y "Consultar" la retoma.
 */
export async function buyShopifyLabel(shipmentId: number, orderId: number, input: { weightOz?: number | null; pollMs?: number; timeoutMs?: number }, actor: Actor, log: Log) {
  const gate = await loadGate();
  const { order, shipment } = await loadStop(shipmentId, orderId);
  // Con una etiqueta viva en esta parada, ese es el motivo (la guía que dejó su compra también cuenta como "ya tiene guía").
  if (await liveLabelFor(shipmentId, orderId)) throw new FulfillmentError("Esta parada ya tiene una etiqueta de Shopify (o se está creando). Descártala antes de comprar otra.", 409);
  const usps = await db.select({ id: uspsLabelsTable.id }).from(uspsLabelsTable).where(and(eq(uspsLabelsTable.shipmentId, shipmentId), eq(uspsLabelsTable.orderId, orderId), inArray(uspsLabelsTable.status, ["creating", "active"])));
  const blocker = labelBlocker({ gate, order, shipment, hasUspsLabel: usps.length > 0 });
  if (blocker) throw new FulfillmentError(blocker, 409);
  const creds = gate!.creds;
  if (input.weightOz != null && !(input.weightOz > 0 && input.weightOz <= 70 * 16)) throw new FulfillmentError("El peso va entre más de 0 y 1120 onzas (70 libras).", 400);

  let reserved: ShopifyLabel;
  try {
    [reserved] = await db.insert(shopifyLabelsTable).values({ orderId, shipmentId, status: "creating", weightOz: input.weightOz ?? null, createdByAgentId: actor.agentId }).returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw new FulfillmentError("Esta parada ya tiene una etiqueta de Shopify (o se está creando). Descártala antes de comprar otra.", 409);
    throw err;
  }
  const release = () => db.delete(shopifyLabelsTable).where(eq(shopifyLabelsTable.id, reserved.id));

  let purchaseId: string;
  try {
    const { nodes } = await shopifyFulfillmentOrders(creds, order.externalId!);
    const eligible = eligibleFulfillmentOrders(nodes);
    if (eligible.length === 0) throw new FulfillmentError("El pedido no tiene en Shopify un envío pendiente con ubicación asignada: puede que ya esté cumplido allá.", 409);
    if (eligible.length > 1) throw new FulfillmentError("El pedido tiene varios envíos pendientes en Shopify (varias ubicaciones). Compra la etiqueta desde el admin de Shopify.", 409);
    await db.update(shopifyLabelsTable).set({ fulfillmentOrderId: eligible[0].id }).where(eq(shopifyLabelsTable.id, reserved.id));
    purchaseId = await shopifyPurchaseLabel(creds, { fulfillmentOrderId: eligible[0].id, weightOz: input.weightOz });
  } catch (err) {
    await release();
    if (err instanceof ShopifyError && err.status >= 500) log.error({ err, orderId, shipmentId }, "shopify label: no confirmation from Shopify");
    if (err instanceof ShopifyError) explain(err);
    throw err;
  }

  // Desde aquí Shopify tiene la orden de compra: ya no se borra la reserva sin saber cómo terminó.
  await db.update(shopifyLabelsTable).set({ purchaseResultId: purchaseId, updatedAt: new Date() }).where(eq(shopifyLabelsTable.id, reserved.id));
  return resolvePurchase(reserved.id, purchaseId, creds, actor, log, { intervalMs: input.pollMs, timeoutMs: input.timeoutMs });
}

async function resolvePurchase(labelId: number, purchaseId: string, creds: ShopifyCredentials, actor: Actor, log: Log, wait: { intervalMs?: number; timeoutMs?: number } = {}) {
  const [label] = await db.select().from(shopifyLabelsTable).where(eq(shopifyLabelsTable.id, labelId));
  const result = await waitForPurchase(creds, purchaseId, wait);
  if (result.status === "PURCHASE_FAILED") {
    // No se compró nada: la parada queda libre.
    await db.delete(shopifyLabelsTable).where(eq(shopifyLabelsTable.id, labelId));
    throw new ShopifyError(`Shopify no pudo comprar la etiqueta: ${result.errors.map((e) => e.message ?? e.code).filter(Boolean).join("; ") || "sin detalle"}.`, 400);
  }
  const data = result.status === "PURCHASED" ? result.shippingLabels[0] : null;
  if (!data) {
    await db.update(shopifyLabelsTable).set({ note: "Shopify aún no confirma la compra.", updatedAt: new Date() }).where(eq(shopifyLabelsTable.id, labelId));
    throw new ShopifyError("Shopify aún no confirma la compra de la etiqueta. Espera un momento y pulsa «Consultar»; si ya salió, aparecerá con su guía.", 409);
  }
  const done = await finalizePurchased(label, data, creds, actor, log);
  return { label: serializeShopifyLabel(done.label), warnings: done.warnings };
}

async function loadLabel(id: number): Promise<ShopifyLabel> {
  const [label] = await db.select().from(shopifyLabelsTable).where(eq(shopifyLabelsTable.id, id));
  if (!label) throw new FulfillmentError("Etiqueta no encontrada.", 404);
  return label;
}

/** Retoma una compra que Shopify no había confirmado, o vuelve a leer una vigente (guía, si todavía se puede anular, PDF que faltaba). */
export async function refreshShopifyLabel(labelId: number, actor: Actor, log: Log) {
  const label = await loadLabel(labelId);
  const gate = await loadGate();
  if (!gate) throw new FulfillmentError("Shopify no está conectado en Configuración.", 409);
  if (label.status === "discarded") throw new FulfillmentError("Esta etiqueta ya se descartó.", 409);
  if (label.status === "creating") {
    if (!label.purchaseResultId) throw new FulfillmentError("La compra de esta etiqueta no llegó a Shopify: descártala y vuelve a intentar.", 409);
    return resolvePurchase(label.id, label.purchaseResultId, gate.creds, actor, log, { timeoutMs: 5_000 });
  }
  if (!label.shopifyLabelId) return { label: serializeShopifyLabel(label), warnings: [] as string[] };
  const data = await shopifyLabelById(gate.creds, label.shopifyLabelId);
  if (!data) {
    const [noted] = await db.update(shopifyLabelsTable).set({ note: "Shopify ya no devuelve esta etiqueta (¿la anulaste allá?). Si es así, descártala.", updatedAt: new Date() }).where(eq(shopifyLabelsTable.id, label.id)).returning();
    return { label: serializeShopifyLabel(noted), warnings: [] as string[] };
  }
  let pdf: string | null = label.labelPdf;
  const doc = labelDocument(data);
  if (!pdf && doc) pdf = (await downloadLabelPdf(gate.creds, doc.url).catch(() => null))?.toString("base64") ?? null;
  const [updated] = await db.update(shopifyLabelsTable).set({ cancellable: data.cancellable, labelPdf: pdf, note: null, updatedAt: new Date() }).where(eq(shopifyLabelsTable.id, label.id)).returning();
  return { label: serializeShopifyLabel(updated), warnings: [] as string[] };
}

/**
 * La etiqueta se anuló en Shopify (la API no deja anularla): aquí se descarta,
 * se quita su guía de la parada y se libera para comprar otra.
 */
export async function discardShopifyLabel(labelId: number, actor: Actor, log: Log) {
  const label = await loadLabel(labelId);
  if (label.status === "discarded") throw new FulfillmentError("Esta etiqueta ya se descartó.", 409);
  const [discarded] = await db.update(shopifyLabelsTable).set({ status: "discarded", discardedAt: new Date(), updatedAt: new Date() }).where(eq(shopifyLabelsTable.id, label.id)).returning();
  try {
    if (label.shipmentId != null && label.trackingNumber) {
      await db
        .update(shipmentOrdersTable)
        .set({ trackingNumber: null })
        .where(and(eq(shipmentOrdersTable.shipmentId, label.shipmentId), eq(shipmentOrdersTable.orderId, label.orderId), eq(shipmentOrdersTable.trackingNumber, label.trackingNumber)));
    }
    if (label.trackingNumber) {
      const [order] = await db.select({ externalTracking: ordersTable.externalTracking }).from(ordersTable).where(eq(ordersTable.id, label.orderId));
      const rest = (order?.externalTracking ?? []).filter((t) => t.number !== label.trackingNumber);
      await db.update(ordersTable).set({ externalTracking: rest.length ? rest : null, updatedAt: new Date() }).where(eq(ordersTable.id, label.orderId));
    }
    await logOrderEvent(db, label.orderId, "shopify_label", `Etiqueta de Shopify descartada${label.trackingNumber ? ` (guía ${label.trackingNumber})` : ""}: se anuló en Shopify.`, actor, { labelId: label.id });
  } catch (err) {
    log.error({ err, labelId }, "shopify label: discarded but local cleanup failed");
  }
  return serializeShopifyLabel(discarded);
}

export async function shopifyLabelPdf(labelId: number): Promise<{ pdf: Buffer; filename: string }> {
  const label = await loadLabel(labelId);
  if (!label.labelPdf) throw new FulfillmentError("Esta etiqueta no tiene PDF guardado: imprímela desde el admin de Shopify.", 404);
  return { pdf: Buffer.from(label.labelPdf, "base64"), filename: `etiqueta-shopify-${label.trackingNumber ?? label.id}.pdf` };
}
