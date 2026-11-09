import { scrypt as scryptCb, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCb);
export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const text = (v, max = 200) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
export function money(v) {
  const n = Number(v);
  if (
    v === "" ||
    v == null ||
    !Number.isFinite(n) ||
    n < 0 ||
    n > 99999999 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 0.00001
  )
    throw new InputError("Importe inválido (máximo 2 decimales).");
  return Math.round(n * 100) / 100;
}
function integer(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new InputError(`${label} inválido.`);
  return n;
}
export const isUuid = (v) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function vehicleInput(b) {
  const stock = text(b.stock, 40),
    make = text(b.make, 80),
    model = text(b.model, 100),
    vin = text(b.vin, 17).toUpperCase();
  if (!stock || !make || !model)
    throw new InputError("Stock, marca y modelo son obligatorios.");
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))
    throw new InputError("El VIN debe tener 17 caracteres válidos.");
  if (!["draft", "available", "reserved", "archived"].includes(b.status))
    throw new InputError("Estado inválido. Las ventas se registran en Ventas.");
  const cats = Array.isArray(b.cats)
    ? [
        ...new Set(
          b.cats.filter((c) =>
            ["suv", "truck", "sedan", "coupe", "electric", "hatch", "van"].includes(c),
          ),
        ),
      ]
    : [];
  if (!cats.length) throw new InputError("Selecciona una carrocería.");
  const localized = (v, max) => ({
    en: text(typeof v === "string" ? v : v?.en, max),
    es: text(typeof v === "string" ? v : v?.es, max),
  });
  return {
    stock,
    vin,
    status: b.status,
    purchaseCost: money(b.purchaseCost ?? 0),
    data: {
      year: integer(b.year, 1900, new Date().getFullYear() + 2, "Año"),
      make,
      model,
      trim: text(b.trim, 100),
      price: money(b.price ?? (b.priceOnRequest === true ? 0 : undefined)),
      priceOnRequest: b.priceOnRequest === true,
      msrp: money(b.msrp ?? b.price ?? (b.priceOnRequest === true ? 0 : undefined)),
      miles: integer(b.miles ?? 0, 0, 9999999, "Millaje"),
      condition: ["used", "new", "certified"].includes(b.condition)
        ? b.condition
        : "used",
      cats,
      engine: text(b.engine, 150),
      hp: integer(b.hp ?? 0, 0, 3000, "Potencia"),
      drive: text(b.drive, 30),
      trans: localized(b.trans, 100),
      economy: text(b.economy, 60),
      seats: b.seats === null || b.seats === "" ? null : integer(b.seats ?? 5, 1, 50, "Asientos"),
      fuel: ["gas", "diesel", "hybrid", "electric"].includes(b.fuel)
        ? b.fuel
        : "gas",
      ext: localized(b.ext, 100),
      int: localized(b.int, 100),
      desc: localized(b.desc, 8000),
      featured: b.featured === true,
      demo: b.demo === true,
      zero60: 0,
    },
  };
}
export async function hashPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw new InputError("La contraseña debe tener entre 12 y 128 caracteres.");
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password, hash) {
  if (typeof password !== "string" || password.length > 128) return false;
  const [salt, key] = hash.split(":");
  const calc = await scrypt(password, salt, 64);
  const expected = Buffer.from(key, "hex");
  return expected.length === calc.length && timingSafeEqual(expected, calc);
}
export function publicVehicle(row, photos) {
  return {
    ...row.data,
    id: row.id,
    stock: row.stock,
    vin: row.vin,
    status: row.status,
    photos: photos.map((p) => `/media/vehicles/${row.id}/${p.id}.webp`),
    cutouts: photos.map((p) =>
      p.cutout ? `/media/vehicles/${row.id}/${p.id}/cutout.webp` : null,
    ),
    live: true,
  };
}
export function saleInput(b) {
  const price = money(b.price);
  if (price <= 0)
    throw new InputError("El precio de venta debe ser mayor que cero.");
  const name = text(b.buyerName, 160);
  if (!name) throw new InputError("Indica el nombre del comprador.");
  const soldAt = text(b.soldAt, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(soldAt) || Number.isNaN(Date.parse(soldAt)))
    throw new InputError("Fecha de venta inválida.");
  return {
    price,
    buyerName: name,
    buyerPhone: text(b.buyerPhone, 60),
    buyerEmail: text(b.buyerEmail, 200),
    notes: text(b.notes, 4000),
    soldAt,
  };
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const optionalId = (v, label) => {
  if (v === undefined || v === null || v === "") return null;
  if (!isUuid(v)) throw new InputError(`${label} inválido.`);
  return v;
};
const optionalCount = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647)
    throw new InputError("Referencia de Omnicanal inválida.");
  return n;
};
function customer(b) {
  const name = text(b.customerName, 160),
    phone = text(b.customerPhone, 60),
    email = text(b.customerEmail, 200);
  if (!name) throw new InputError("Indica el nombre del cliente.");
  if (!phone && !email)
    throw new InputError("Indica el teléfono o el email del cliente.");
  if (email && !EMAIL.test(email)) throw new InputError("Email inválido.");
  return { customerName: name, customerPhone: phone, customerEmail: email };
}
export const RESERVATION_MAX_DAYS = 30;
export function reservationInput(b) {
  return {
    ...customer(b),
    deposit: money(b.deposit ?? 0),
    days: integer(b.days ?? 3, 1, RESERVATION_MAX_DAYS, "Plazo de reserva"),
    notes: text(b.notes, 2000),
    sellerId: optionalId(b.sellerId, "Vendedor"),
    omniConversationId: optionalCount(b.omniConversationId),
  };
}
export const APPOINTMENT_KINDS = ["testdrive", "visit", "delivery", "call", "followup"];
export const APPOINTMENT_STATUSES = ["scheduled", "confirmed", "completed", "cancelled", "no_show"];
// Dates and times are the dealership's wall clock; the database turns them into an instant.
function localSlot(b) {
  const date = text(b.date, 10),
    time = text(b.time, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + "T00:00:00Z")))
    throw new InputError("Fecha de la cita inválida.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new InputError("Hora de la cita inválida.");
  return { date, time };
}
export function appointmentInput(b) {
  if (!APPOINTMENT_KINDS.includes(b.kind))
    throw new InputError("Tipo de cita inválido.");
  return {
    kind: b.kind,
    ...localSlot(b),
    durationMinutes: integer(b.durationMinutes ?? 60, 15, 600, "Duración"),
    ...customer(b),
    notes: text(b.notes, 2000),
    vehicleId: optionalId(b.vehicleId, "Vehículo"),
    leadId: optionalId(b.leadId, "Consulta"),
    sellerId: optionalId(b.sellerId, "Vendedor"),
    omniConversationId: optionalCount(b.omniConversationId),
  };
}
export function appointmentUpdate(b) {
  const out = {};
  if (b.status !== undefined) {
    if (!APPOINTMENT_STATUSES.includes(b.status))
      throw new InputError("Estado de la cita inválido.");
    out.status = b.status;
  }
  if (b.date !== undefined || b.time !== undefined) Object.assign(out, localSlot(b));
  if (b.durationMinutes !== undefined)
    out.durationMinutes = integer(b.durationMinutes, 15, 600, "Duración");
  if (b.notes !== undefined) out.notes = text(b.notes, 2000);
  if (b.sellerId !== undefined) out.sellerId = optionalId(b.sellerId, "Vendedor");
  if (!Object.keys(out).length) throw new InputError("No hay cambios que guardar.");
  return out;
}
export const phoneDigits = (v) => String(v ?? "").replace(/\D/g, "");
