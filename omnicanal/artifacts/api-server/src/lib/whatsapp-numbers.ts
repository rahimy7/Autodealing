// Resolución de "por cuál de nuestros números va esto". Todo lo que necesita
// saber qué número usar —la entrada del webhook, la respuesta de la bandeja, el
// envío de una campaña— pasa por aquí, para que la regla viva en un solo sitio.

import { eq, ne, and, asc } from "drizzle-orm";
import { db, integrationSettingsTable, whatsappNumbersTable, type WhatsappNumber } from "@workspace/db";
// Solo el tipo: messaging.ts importa este módulo, y traerlo en runtime cerraría
// el ciclo. `import type` se borra al compilar, así que no hay tal ciclo.
import type { Log } from "./messaging";

export type { WhatsappNumber };

// Una vez que se ha visto la tabla con contenido, no hace falta volver a
// mirarla: una tabla poblada no vuelve a estar vacía por sí sola. Sin esta
// bandera el arranque añadiría un SELECT a cada mensaje que entra y a cada
// respuesta que sale, que es el camino más caliente del servidor.
let seedChecked = false;

/**
 * Da de alta el número que la instancia ya tenía configurado, si la tabla está
 * vacía.
 *
 * Antes de esta tabla el número vivía en `integration_settings.whatsappPhoneNumberId`.
 * Sin este arranque, una instancia en producción se quedaría sin ningún número al
 * desplegar —la tabla nace vacía— y dejaría de responder hasta que alguien entre a
 * Configuración. Con él, el número de siempre aparece solo, marcado como principal.
 *
 * Idempotente y seguro con varias réplicas: el índice único de `phoneNumberId`
 * decide, y el que pierde la carrera no hace nada.
 */
export async function ensureNumbersSeeded(): Promise<void> {
  if (seedChecked) return;

  const existing = await db.select({ id: whatsappNumbersTable.id }).from(whatsappNumbersTable).limit(1);
  if (existing.length > 0) {
    seedChecked = true;
    return;
  }

  const [settings] = await db
    .select()
    .from(integrationSettingsTable)
    .orderBy(asc(integrationSettingsTable.id))
    .limit(1);
  // Instancia todavía sin WhatsApp configurado: no hay nada que migrar y NO se
  // marca como comprobada, para que el número aparezca solo en cuanto lo guarden
  // en Configuración.
  if (!settings?.whatsappPhoneNumberId) return;

  await db
    .insert(whatsappNumbersTable)
    .values({
      phoneNumberId: settings.whatsappPhoneNumberId,
      displayNumber: settings.whatsappDisplayNumber,
      label: "Principal",
      isPrimary: true,
      isActive: true,
    })
    .onConflictDoNothing({ target: whatsappNumbersTable.phoneNumberId });

  seedChecked = true;
}

/** Todos los números dados de alta, activos primero por comodidad de la UI. */
export async function listNumbers(): Promise<WhatsappNumber[]> {
  await ensureNumbersSeeded();
  return db.select().from(whatsappNumbersTable).orderBy(asc(whatsappNumbersTable.id));
}

/**
 * El número de respaldo: el marcado como principal, y si nadie lo está, el
 * primero activo. Lo usan los envíos que no tienen conversación de la cual
 * deducir el número.
 */
export async function primaryNumber(): Promise<WhatsappNumber | null> {
  await ensureNumbersSeeded();

  const [primary] = await db
    .select()
    .from(whatsappNumbersTable)
    .where(and(eq(whatsappNumbersTable.isPrimary, true), eq(whatsappNumbersTable.isActive, true)))
    .limit(1);
  if (primary) return primary;

  const [firstActive] = await db
    .select()
    .from(whatsappNumbersTable)
    .where(eq(whatsappNumbersTable.isActive, true))
    .orderBy(asc(whatsappNumbersTable.id))
    .limit(1);
  return firstActive ?? null;
}

/**
 * Da de alta un número (o lo reactiva si ya estaba) y lo devuelve.
 *
 * `makePrimary` sin indicar significa "principal solo si no hay otro activo": un
 * número que aparece solo no le quita el puesto al que el negocio eligió, pero
 * tampoco deja la instancia sin principal cuando el anterior está apagado.
 */
export async function registerNumber(
  phoneNumberId: string,
  opts: { displayNumber?: string | null; makePrimary?: boolean } = {},
): Promise<WhatsappNumber> {
  const makePrimary = opts.makePrimary ?? !(await primaryNumber());
  if (makePrimary) {
    await db
      .update(whatsappNumbersTable)
      .set({ isPrimary: false })
      .where(ne(whatsappNumbersTable.phoneNumberId, phoneNumberId));
  }

  const displayNumber = opts.displayNumber ?? null;
  await db
    .insert(whatsappNumbersTable)
    .values({
      phoneNumberId,
      displayNumber,
      label: makePrimary ? "Principal" : null,
      isPrimary: makePrimary,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: whatsappNumbersTable.phoneNumberId,
      set: {
        isActive: true,
        ...(makePrimary ? { isPrimary: true } : {}),
        ...(displayNumber ? { displayNumber } : {}),
        updatedAt: new Date(),
      },
    });

  const [row] = await db
    .select()
    .from(whatsappNumbersTable)
    .where(eq(whatsappNumbersTable.phoneNumberId, phoneNumberId))
    .limit(1);
  return row;
}

/**
 * A qué número dado de alta corresponde el `phone_number_id` que trajo el webhook.
 *
 * Si no está dado de alta, se da de alta aquí mismo. El webhook llega firmado con
 * nuestro App Secret, así que el número es nuestro. Lo que se hacía antes —atender
 * la conversación por el principal— dejaba la bandeja sin poder contestar: la
 * respuesta salía por un número al que el cliente nunca escribió, sin ventana de
 * 24 h abierta, y Meta la rechazaba. Pasa al añadir un número en Meta antes de
 * darlo de alta aquí, y al cambiar el Phone Number ID en Conexión con Meta.
 */
export async function resolveInboundNumber(
  phoneNumberId: string | null | undefined,
  log: Log,
): Promise<WhatsappNumber | null> {
  await ensureNumbersSeeded();
  if (!phoneNumberId) return primaryNumber();

  const [match] = await db
    .select()
    .from(whatsappNumbersTable)
    .where(eq(whatsappNumbersTable.phoneNumberId, phoneNumberId))
    .limit(1);
  if (match) return match;

  const registered = await registerNumber(phoneNumberId);
  log.warn(
    { phoneNumberId, numberId: registered.id, isPrimary: registered.isPrimary },
    "mensaje recibido por un número que no estaba dado de alta: se da de alta y se responde por él",
  );
  return registered;
}

/**
 * El número por el que sale un envío, a partir del que quedó grabado en la
 * conversación o la campaña. Sin él —conversaciones anteriores a esta tabla,
 * campañas viejas— se usa el principal, que es como se comportaba antes.
 */
export async function resolveOutboundNumber(
  whatsappNumberId: number | null | undefined,
): Promise<WhatsappNumber | null> {
  await ensureNumbersSeeded();
  if (whatsappNumberId == null) return primaryNumber();

  const [match] = await db
    .select()
    .from(whatsappNumbersTable)
    .where(eq(whatsappNumbersTable.id, whatsappNumberId))
    .limit(1);
  // Un número apagado sigue sirviendo para responder a sus conversaciones
  // abiertas: apagarlo evita que se le asignen cosas nuevas, no deja a medias las
  // que ya estaban.
  return match ?? (await primaryNumber());
}
