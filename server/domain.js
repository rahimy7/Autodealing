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
            ["suv", "truck", "sedan", "coupe", "electric", "hatch"].includes(c),
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
      price: money(b.price),
      msrp: money(b.msrp ?? b.price),
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
      seats: integer(b.seats ?? 5, 1, 50, "Asientos"),
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
    photos: photos.map((p) => `/api/photos/${p.id}`),
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
