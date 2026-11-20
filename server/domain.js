import { scrypt as scryptCb, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { QUOTE_TERMS } from "../js/quote-math.js";
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
// "service" is the service department's: maintenance, repairs, inspections.
export const APPOINTMENT_KINDS = ["testdrive", "visit", "delivery", "call", "followup", "service"];
export const APPOINTMENT_STATUSES = ["pending", "confirmed", "completed", "cancelled", "no_show"];
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
// The team's profiles. "service" is the service department: it loads units and photos, keeps its
// own agenda and answers its chats, but does not reserve, quote or sell.
export const ROLES = ["admin", "sales", "service"];
export const ROLE_LABELS = { admin: "Administración", sales: "Ventas", service: "Servicio" };
export const sells = (role) => role === "admin" || role === "sales";
export const VEHICLE_BODIES = ["suv", "truck", "sedan", "coupe", "electric", "hatch", "van"];

// What a salesperson or the service department records about a unit that just arrived. Price,
// details and publication are left to administration.
export function intakeInput(b) {
  const body = VEHICLE_BODIES.includes(b.body) ? b.body : null;
  if (!body) throw new InputError("Selecciona una carrocería.");
  return {
    year: b.year,
    make: text(b.make, 80),
    model: text(b.model, 100),
    trim: text(b.trim, 100),
    vin: text(b.vin, 17).toUpperCase(),
    miles: b.miles === "" || b.miles == null ? 0 : b.miles,
    body,
    condition: ["used", "new", "certified"].includes(b.condition) ? b.condition : "used",
    ext: text(b.ext, 100),
    notes: text(b.notes, 2000),
    // From the VIN decoder, when it was used; administration reviews them.
    engine: text(b.engine, 150),
    drive: text(b.drive, 30),
    trans: text(b.trans, 100),
    fuel: ["gas", "diesel", "hybrid", "electric"].includes(b.fuel) ? b.fuel : "",
  };
}

const percent = (v, max, label) => {
  const n = Number(v ?? 0);
  if (v === "" || !Number.isFinite(n) || n < 0 || n > max || Math.abs(n * 1000 - Math.round(n * 1000)) > 0.0001)
    throw new InputError(`${label} inválido (0 a ${max}).`);
  return n;
};
export function quoteInput(b) {
  const term = Number(b.termMonths ?? 0);
  if (!QUOTE_TERMS.includes(term)) throw new InputError("Plazo inválido.");
  return {
    ...customer(b),
    down: money(b.down ?? 0),
    tradeIn: money(b.tradeIn ?? 0),
    apr: term ? percent(b.apr, 40, "Tasa") : 0,
    termMonths: term,
    notes: text(b.notes, 2000),
    // Only administration may change these; the route ignores them for everyone else.
    price: b.price === undefined || b.price === "" || b.price === null ? null : money(b.price),
    fees: b.fees === undefined || b.fees === "" || b.fees === null ? null : money(b.fees),
    taxRate: b.taxRate === undefined || b.taxRate === "" || b.taxRate === null ? null : percent(b.taxRate, 20, "Impuesto"),
    omniConversationId: optionalCount(b.omniConversationId),
  };
}
export function quoteSettingsInput(b) {
  const days = integer(b.validDays ?? 3, 1, 30, "Vigencia");
  const term = Number(b.term ?? 72);
  if (!QUOTE_TERMS.includes(term) || !term) throw new InputError("Plazo por defecto inválido.");
  return {
    taxRate: percent(b.taxRate, 20, "Impuesto"),
    docFee: money(b.docFee ?? 0),
    apr: percent(b.apr ?? 6.9, 40, "Tasa"),
    term,
    validDays: days,
    note: text(b.note, 1000),
  };
}
export const phoneDigits = (v) => String(v ?? "").replace(/\D/g, "");
