// Avisos al CLIENTE en cada etapa del pedido, por correo. Decisión del usuario
// del 2026-10-04 ("responderemos por correo"): nunca por WhatsApp, así siguen
// intactas dos reglas del negocio —el bot no escribe dos veces sin que el
// cliente conteste, y las plantillas de WhatsApp solo las manda una persona— y
// el despacho, que pasa días después del último mensaje del cliente, no choca
// con la ventana de 24 h de Meta.
//
// El primer aviso abre un hilo de Gmail (composeNewEmail) y los siguientes
// responden en ese mismo hilo: el cliente ve toda la historia de su pedido junta
// y, si contesta, su respuesta entra a la vista de Correo como cualquier otra.
//
// Un pedido sin correo NO se avisa (lo eligió el usuario): queda la nota en el
// expediente y en el chat para que el equipo decida. Nada de esto bloquea el
// cambio de etapa: un correo que no sale no deshace un despacho.
import { and, asc, eq, sql } from "drizzle-orm";
import { db, ordersTable, orderItemsTable, orderEventsTable, contactsTable, type Order } from "@workspace/db";
import { clientConfig, isModuleEnabled } from "./client-config";
import { orderCode } from "./codes";
import { composeNewEmail, sendEmailReply } from "./email";
import { logOrderEvent, noteOnOrderConversation } from "./orders";
import { SYSTEM_ACTOR, type Actor } from "./inventory";
import type { Log } from "./messaging";

export const ORDER_EMAIL_STAGES = ["confirmed", "dispatched", "delivered", "cancelled", "refund"] as const;
export type OrderEmailStage = (typeof ORDER_EMAIL_STAGES)[number];

const ONCE_STAGES = new Set<OrderEmailStage>(["confirmed", "delivered", "cancelled"]);

export const ORDER_EMAIL_STAGE_LABELS: Record<OrderEmailStage, string> = {
  confirmed: "pago confirmado",
  dispatched: "despachado",
  delivered: "entregado",
  cancelled: "cancelado",
  refund: "devolución / nota de crédito",
};

export type OrderEmailContext = {
  businessName: string;
  orderLabel: string;
  customerName: string | null;
  items: Array<{ description: string; quantity: number }>;
  shipmentKind?: "trip" | "courier" | null;
  carrierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  returnCode?: string | null;
  creditNote?: { code: string; amount: string } | null;
  refundAmount?: string | null;
};

/** El idioma del correo: inglés solo si sabemos que el cliente usa inglés (Shopify lo dice). */
export function emailLanguage(locale: string | null | undefined): "es" | "en" {
  return locale?.toLowerCase().startsWith("en") ? "en" : "es";
}

export function trackingUrlFor(template: string | null | undefined, tracking: string | null | undefined): string | null {
  if (!template || !tracking?.trim()) return null;
  return template.includes("{tracking}") ? template.replace("{tracking}", encodeURIComponent(tracking.trim())) : null;
}

// Un nombre que no es nombre ("Cliente 8095551234", el teléfono) no va en el saludo.
function greetingName(name: string | null): string | null {
  const clean = name?.trim();
  if (!clean || /^cliente\s/i.test(clean) || /^\+?\d[\d\s-]+$/.test(clean)) return null;
  return clean.split(/\s+/)[0];
}

function itemLines(items: OrderEmailContext["items"]): string {
  return items.map((i) => `- ${i.description}${i.quantity > 1 ? ` x${i.quantity}` : ""}`).join("\n");
}

/**
 * El asunto y el texto de cada aviso. Puros, sin base de datos. No prometen
 * plazos ni nada que el negocio no haya dicho: solo cuentan lo que pasó.
 */
export function composeOrderEmail(stage: OrderEmailStage, ctx: OrderEmailContext, lang: "es" | "en" = "es"): { subject: string; body: string } {
  const name = greetingName(ctx.customerName);
  const items = ctx.items.length ? itemLines(ctx.items) : null;

  if (lang === "en") {
    const hello = name ? `Hi ${name},` : "Hi,";
    const close = `\n\nBest regards,\n${ctx.businessName}`;
    switch (stage) {
      case "confirmed":
        return {
          subject: `Your order ${ctx.orderLabel} is being prepared`,
          body: `${hello}\n\nWe confirmed your payment. Your order ${ctx.orderLabel} is now being prepared${items ? `:\n${items}` : "."}\n\nWe'll let you know here as soon as it ships.${close}`,
        };
      case "dispatched": {
        const how =
          ctx.shipmentKind === "trip"
            ? "Your order left today on our delivery route."
            : `Your order shipped${ctx.carrierName ? ` with ${ctx.carrierName}` : ""}.${ctx.trackingNumber ? ` Tracking number: ${ctx.trackingNumber}.` : ""}${ctx.trackingUrl ? `\nTrack it here: ${ctx.trackingUrl}` : ""}`;
        return { subject: `Your order ${ctx.orderLabel} is on its way`, body: `${hello}\n\n${how}${items ? `\n\n${items}` : ""}${close}` };
      }
      case "delivered":
        return {
          subject: `Your order ${ctx.orderLabel} was delivered`,
          body: `${hello}\n\nYour order ${ctx.orderLabel} was delivered. Thank you for your purchase! If anything didn't arrive as expected, just reply to this email.${close}`,
        };
      case "cancelled":
        return {
          subject: `Your order ${ctx.orderLabel} was cancelled`,
          body: `${hello}\n\nYour order ${ctx.orderLabel} was cancelled. If you have any questions, just reply to this email.${close}`,
        };
      case "refund": {
        const parts: string[] = [];
        if (ctx.returnCode) parts.push(`We received your return ${ctx.returnCode} for order ${ctx.orderLabel}.`);
        if (ctx.creditNote) parts.push(`We issued credit note ${ctx.creditNote.code} for ${ctx.creditNote.amount} in your favor.`);
        if (ctx.refundAmount) parts.push(`We refunded you ${ctx.refundAmount}.`);
        if (parts.length === 0) parts.push(`We processed an adjustment on your order ${ctx.orderLabel}.`);
        return { subject: `Update on your order ${ctx.orderLabel}`, body: `${hello}\n\n${parts.join(" ")}${close}` };
      }
    }
  }

  const hello = name ? `Hola, ${name}:` : "Hola:";
  const close = `\n\nSaludos,\n${ctx.businessName}`;
  switch (stage) {
    case "confirmed":
      return {
        subject: `Tu pedido ${ctx.orderLabel} está en preparación`,
        body: `${hello}\n\nConfirmamos tu pago. Tu pedido ${ctx.orderLabel} ya está en preparación${items ? `:\n${items}` : "."}\n\nTe avisaremos por este medio cuando salga.${close}`,
      };
    case "dispatched": {
      const how =
        ctx.shipmentKind === "trip"
          ? "Tu pedido salió hoy en nuestra ruta de entrega."
          : `Tu pedido salió${ctx.carrierName ? ` con ${ctx.carrierName}` : ""}.${ctx.trackingNumber ? ` Número de guía: ${ctx.trackingNumber}.` : ""}${ctx.trackingUrl ? `\nPuedes seguirlo aquí: ${ctx.trackingUrl}` : ""}`;
      return { subject: `Tu pedido ${ctx.orderLabel} va en camino`, body: `${hello}\n\n${how}${items ? `\n\n${items}` : ""}${close}` };
    }
    case "delivered":
      return {
        subject: `Tu pedido ${ctx.orderLabel} fue entregado`,
        body: `${hello}\n\nTu pedido ${ctx.orderLabel} fue entregado. ¡Gracias por tu compra! Si algo no llegó como esperabas, responde a este correo.${close}`,
      };
    case "cancelled":
      return {
        subject: `Tu pedido ${ctx.orderLabel} fue cancelado`,
        body: `${hello}\n\nTu pedido ${ctx.orderLabel} fue cancelado. Si tienes alguna duda, responde a este correo.${close}`,
      };
    case "refund": {
      const parts: string[] = [];
      if (ctx.returnCode) parts.push(`Recibimos tu devolución ${ctx.returnCode} del pedido ${ctx.orderLabel}.`);
      if (ctx.creditNote) parts.push(`Emitimos la nota de crédito ${ctx.creditNote.code} por ${ctx.creditNote.amount} a tu favor.`);
      if (ctx.refundAmount) parts.push(`Te reembolsamos ${ctx.refundAmount}.`);
      if (parts.length === 0) parts.push(`Hicimos un ajuste en tu pedido ${ctx.orderLabel}.`);
      return { subject: `Novedades de tu pedido ${ctx.orderLabel}`, body: `${hello}\n\n${parts.join(" ")}${close}` };
    }
  }
}

/** El número con que el cliente conoce su pedido: el de Shopify si vino de allí. */
export function orderLabelFor(order: Pick<Order, "id" | "externalName">): string {
  return order.externalName ? `${order.externalName} (${orderCode(order.id)})` : orderCode(order.id);
}

export type StageExtras = Pick<
  OrderEmailContext,
  "shipmentKind" | "carrierName" | "trackingNumber" | "trackingUrl" | "returnCode" | "creditNote" | "refundAmount"
>;

/**
 * Avisa al cliente por correo de una etapa de su pedido y lo deja en el
 * expediente. Nunca lanza: se llama después de que la etapa ya ocurrió.
 * `force` reenvía aunque la etapa no esté en la configuración (botón "Avisar").
 */
export async function notifyOrderStage(
  orderId: number,
  stage: OrderEmailStage,
  extras: StageExtras,
  log: Log,
  opts: { actor?: Actor; force?: boolean } = {},
): Promise<{ sent: boolean; reason?: string }> {
  const actor = opts.actor ?? SYSTEM_ACTOR;
  try {
    if (!opts.force && !clientConfig.business.orderEmails.stages.includes(stage)) {
      return { sent: false, reason: "la etapa no se avisa en esta instancia" };
    }
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
    if (!order) return { sent: false, reason: "pedido no encontrado" };
    // Confirmado, entregado y cancelado se avisan una vez: mover el estado de ida
    // y vuelta no le manda al cliente el mismo correo dos veces. Despachado y
    // devolución sí se repiten (un segundo despacho tras uno fallido, otra nota).
    if (!opts.force && ONCE_STAGES.has(stage)) {
      const [already] = await db
        .select({ id: orderEventsTable.id })
        .from(orderEventsTable)
        .where(and(eq(orderEventsTable.orderId, orderId), eq(orderEventsTable.kind, "notified"), sql`${orderEventsTable.data}->>'stage' = ${stage}`))
        .limit(1);
      if (already) return { sent: false, reason: "ya se le avisó de esta etapa" };
    }
    const [contact] = await db
      .select({ name: contactsTable.name, email: contactsTable.email })
      .from(contactsTable)
      .where(eq(contactsTable.id, order.contactId));
    const items = await db
      .select({ description: orderItemsTable.description, quantity: orderItemsTable.quantity })
      .from(orderItemsTable)
      .where(eq(orderItemsTable.orderId, orderId))
      .orderBy(asc(orderItemsTable.sortOrder));

    const skip = async (reason: string) => {
      reason = reason.replace(/\.$/, "");
      await logOrderEvent(db, orderId, "notification_skipped", `No se avisó al cliente (${ORDER_EMAIL_STAGE_LABELS[stage]}): ${reason}.`, actor, { stage });
      await noteOnOrderConversation(order, `📧 No se avisó por correo que el pedido ${orderCode(order.id)} quedó "${ORDER_EMAIL_STAGE_LABELS[stage]}": ${reason}.`);
      return { sent: false, reason };
    };

    const to = order.email?.trim() || contact?.email?.trim() || null;
    if (!to) return await skip("el pedido no tiene correo");
    if (!isModuleEnabled("email")) return await skip("el correo no está activo en esta instancia");

    const { subject, body } = composeOrderEmail(
      stage,
      {
        businessName: clientConfig.business.displayName,
        orderLabel: orderLabelFor(order),
        customerName: contact?.name ?? null,
        items: items.length ? items : order.product ? [{ description: order.product, quantity: 1 }] : [],
        ...extras,
      },
      emailLanguage(order.customerLocale),
    );

    let threadId = order.emailThreadId;
    if (threadId != null) {
      const sent = await sendEmailReply(threadId, { content: `${subject}\n\n${body}`, authorAgentId: actor.agentId }, log);
      if (!sent.ok) {
        // El hilo pudo borrarse: se abre uno nuevo en vez de dejar al cliente sin aviso.
        if (sent.status !== 404) return await skip(sent.error);
        threadId = null;
      }
    }
    if (threadId == null) {
      const composed = await composeNewEmail({ to, subject, content: body, contactId: order.contactId, authorAgentId: actor.agentId }, log);
      if (!composed.ok) return await skip(composed.error);
      await db.update(ordersTable).set({ emailThreadId: composed.threadId }).where(eq(ordersTable.id, orderId));
    }

    await logOrderEvent(db, orderId, "notified", `Se avisó por correo a ${to}: ${ORDER_EMAIL_STAGE_LABELS[stage]}.`, actor, { stage, to });
    log.info({ orderId, stage }, "order stage email sent");
    return { sent: true };
  } catch (err) {
    log.error({ err, orderId, stage }, "order stage email crashed");
    return { sent: false, reason: "error inesperado al enviar el correo" };
  }
}
