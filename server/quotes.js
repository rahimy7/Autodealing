// Quotes: a salesperson prices a published unit for a customer (cash or an estimated monthly
// payment) and sends the link by WhatsApp. The price is the one administration set; only
// administration can quote another price, fees or tax. The figures are computed here, once, with
// the same function the app shows while typing (js/quote-math.js), and stored with the quote.
// Mounted under /api/admin. The customer's page is quotePage, at /cotizacion/<token>.
import express from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { query, transaction } from "./db.js";
import { InputError, isUuid, quoteInput, quoteSettingsInput } from "./domain.js";
import { quoteFigures } from "../js/quote-math.js";
import { DEALER_TZ } from "./omni-service.js";
import { renderQuotePage } from "./quote-page.js";

export const QUOTE_DEFAULTS = { taxRate: 0, docFee: 0, apr: 6.9, term: 72, validDays: 3, note: "" };
export async function quoteSettings() {
  const { rows } = await query("SELECT value FROM settings WHERE id='quote'");
  return { ...QUOTE_DEFAULTS, ...(rows[0]?.value || {}) };
}

const localToday = `(now() AT TIME ZONE '${DEALER_TZ}')::date`;
const QUOTE_SELECT = `SELECT q.*,to_char(q.valid_until,'YYYY-MM-DD') valid_until_date,q.valid_until<${localToday} expired,su.name seller_name,v.status vehicle_status,(SELECT p.id FROM vehicle_photos p WHERE p.vehicle_id=q.vehicle_id ORDER BY p.position,p.created_at LIMIT 1) photo_id FROM quotes q JOIN admin_users su ON su.id=q.seller_id JOIN vehicles v ON v.id=q.vehicle_id`;
const TOKEN = /^[A-Za-z0-9_-]{24}$/;
export const quoteNumber = (n) => "COT-" + String(n).padStart(5, "0");
const origin = (req) => `${req.protocol}://${req.get("host")}`;
const published = (status) => ["available", "reserved"].includes(status);

export function quoteView(q, base) {
  return {
    id: q.id,
    number: q.number,
    code: quoteNumber(q.number),
    link: `${base}/cotizacion/${q.token}`,
    vehicleId: q.vehicle_id,
    vehicle: q.vehicle,
    vehicleStatus: q.vehicle_status,
    photo: published(q.vehicle_status) && q.photo_id ? `/api/photos/${q.photo_id}` : null,
    sellerId: q.seller_id,
    sellerName: q.seller_name,
    customerName: q.customer_name,
    customerPhone: q.customer_phone,
    customerEmail: q.customer_email,
    figures: q.figures,
    notes: q.notes,
    validUntil: q.valid_until_date,
    expired: q.expired,
    omniConversationId: q.omni_conversation_id,
    createdAt: q.created_at,
  };
}

const vehicleTitle = (d) => [d.year, d.make, d.model].filter(Boolean).join(" ");

export function quotesRouter({ admin, seller, audit, checkId }) {
  const r = express.Router();

  // The defaults every quote starts from. The app reads them to show the right figures.
  r.get("/quote-settings", async (_req, res) => res.json(await quoteSettings()));

  r.put("/quote-settings", admin, async (req, res) => {
    const value = quoteSettingsInput(req.body);
    await transaction(async (c) => {
      await c.query(
        "INSERT INTO settings(id,value) VALUES('quote',$1) ON CONFLICT(id) DO UPDATE SET value=$1",
        [JSON.stringify(value)],
      );
      await audit(c, req.user, "quote.settings_updated");
    });
    res.json(value);
  });

  r.get("/quotes", seller, async (req, res) => {
    const params = [],
      where = [];
    if (req.user.role !== "admin") where.push(`q.seller_id=$${params.push(req.user.id)}`);
    else if (isUuid(req.query.seller)) where.push(`q.seller_id=$${params.push(req.query.seller)}`);
    if (isUuid(req.query.vehicle)) where.push(`q.vehicle_id=$${params.push(req.query.vehicle)}`);
    const { rows } = await query(
      `${QUOTE_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY q.created_at DESC LIMIT 200`,
      params,
    );
    const base = origin(req);
    res.json(rows.map((q) => quoteView(q, base)));
  });

  r.get("/quotes/:id", checkId, seller, async (req, res) => {
    const { rows } = await query(`${QUOTE_SELECT} WHERE q.id=$1`, [req.params.id]);
    const q = rows[0];
    if (!q || (req.user.role !== "admin" && q.seller_id !== req.user.id))
      throw new InputError("Cotización no encontrada.", 404);
    res.json(quoteView(q, origin(req)));
  });

  r.post("/quotes", seller, async (req, res) => {
    if (!isUuid(req.body.vehicleId)) throw new InputError("Selecciona un vehículo.");
    const input = quoteInput(req.body);
    const settings = await quoteSettings();
    const isAdmin = req.user.role === "admin";
    const id = randomUUID();
    await transaction(async (c) => {
      const { rows } = await c.query("SELECT id,stock,vin,status,data FROM vehicles WHERE id=$1", [req.body.vehicleId]);
      const v = rows[0];
      if (!v) throw new InputError("Vehículo no encontrado.", 404);
      if (!published(v.status)) throw new InputError("Solo se cotizan unidades publicadas (disponibles o reservadas).", 409);
      if (v.data.demo) throw new InputError("Esta unidad es de demostración: no se cotiza.", 409);
      const listPrice = v.data.priceOnRequest ? 0 : Number(v.data.price) || 0;
      const price = isAdmin && input.price ? input.price : listPrice;
      if (!(price > 0))
        throw new InputError("Administración aún no cargó el precio de esta unidad.", 409);
      const figures = quoteFigures({
        price,
        fees: isAdmin && input.fees !== null ? input.fees : settings.docFee,
        taxRate: isAdmin && input.taxRate !== null ? input.taxRate : settings.taxRate,
        down: input.down,
        tradeIn: input.tradeIn,
        apr: input.apr,
        termMonths: input.termMonths,
      });
      if (figures.down + figures.tradeIn > figures.total)
        throw new InputError("El pago inicial y el intercambio superan el total.");
      const snapshot = {
        title: vehicleTitle(v.data),
        year: v.data.year,
        make: v.data.make,
        model: v.data.model,
        trim: v.data.trim || "",
        stock: v.stock,
        vin: v.vin,
        miles: v.data.miles,
        condition: v.data.condition,
        ext: v.data.ext?.es || v.data.ext?.en || "",
        listPrice,
      };
      await c.query(
        `INSERT INTO quotes(id,token,vehicle_id,seller_id,customer_name,customer_phone,customer_email,price,fees,tax_rate,down,trade_in,apr,term_months,figures,vehicle,notes,valid_until,omni_conversation_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,${localToday}+$18::int,$19)`,
        [
          id,
          randomBytes(18).toString("base64url"),
          v.id,
          req.user.id,
          input.customerName,
          input.customerPhone,
          input.customerEmail,
          figures.price,
          figures.fees,
          figures.taxRate,
          figures.down,
          figures.tradeIn,
          figures.apr,
          figures.termMonths,
          JSON.stringify(figures),
          JSON.stringify(snapshot),
          input.notes,
          settings.validDays,
          input.omniConversationId,
        ],
      );
      await audit(c, req.user, "quote.created", id);
    });
    const { rows } = await query(`${QUOTE_SELECT} WHERE q.id=$1`, [id]);
    res.status(201).json(quoteView(rows[0], origin(req)));
  });

  return r;
}

// The customer's page. Whoever has the link reads it, so the token is long and random and the
// page is kept out of search engines. The photo is shown while the unit is still published.
export const QUOTE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
export async function quotePage(req, res) {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  if (!TOKEN.test(req.params.token)) return res.status(404).type("text").send("Cotización no encontrada.");
  const [{ rows }, { rows: dealer }, settings] = await Promise.all([
    query(`${QUOTE_SELECT} WHERE q.token=$1`, [req.params.token]),
    query("SELECT value FROM settings WHERE id='dealer'"),
    quoteSettings(),
  ]);
  if (!rows[0]) return res.status(404).type("text").send("Cotización no encontrada.");
  const q = rows[0];
  res.set("Content-Security-Policy", QUOTE_CSP);
  res.type("html").send(
    renderQuotePage(q, dealer[0]?.value || {}, {
      base: origin(req),
      lang: req.query.lang === "en" ? "en" : "es",
      note: settings.note,
      code: quoteNumber(q.number),
      published: published(q.vehicle_status),
    }),
  );
}
