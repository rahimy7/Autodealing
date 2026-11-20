// Units loaded from the lot with the mobile app. A salesperson or the service department records
// what they see (year, make, model, VIN, miles, body, color) and takes the photos; the unit is a
// draft without a price until administration completes its details and publishes it.
// Mounted under /api/admin, so every route already has a session and its CSRF check.
import express from "express";
import { randomUUID, randomInt } from "node:crypto";
import { query, transaction } from "./db.js";
import { InputError, intakeInput, vehicleInput } from "./domain.js";
import { DEALER_TZ } from "./omni-service.js";

// How the team reads a vehicle: its data plus who loaded it. Costs are administration's only.
export const VEHICLE_SELECT =
  "SELECT v.*,iu.name intake_name,coalesce((SELECT json_agg(json_build_object('id',p.id,'url','/api/photos/'||p.id,'cutoutUrl',CASE WHEN p.cutout IS NOT NULL THEN '/api/photos/'||p.id||'/cutout' END) ORDER BY p.position,p.created_at) FROM vehicle_photos p WHERE p.vehicle_id=v.id),'[]') photos FROM vehicles v LEFT JOIN admin_users iu ON iu.id=v.intake_by";

export function vehicleView(v, role) {
  const result = {
    ...v.data,
    id: v.id,
    stock: v.stock,
    vin: v.vin,
    status: v.status,
    version: v.version,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
    photos: v.photos || [],
    intakeBy: v.intake_by || null,
    intakeName: v.intake_name || null,
    intakeNotes: v.intake_notes || "",
  };
  if (role === "admin") result.purchaseCost = Number(v.purchase_cost);
  return result;
}

// Who may reorder, delete or cut out a unit's photos: administration, and whoever loaded a unit
// while it is still their draft. Anyone on the team may add photos to any unit.
export async function canArrangePhotos(c, user, vehicleId) {
  if (user.role === "admin") return true;
  const { rows } = await c.query("SELECT status,intake_by FROM vehicles WHERE id=$1", [vehicleId]);
  return rows[0]?.status === "draft" && rows[0].intake_by === user.id;
}

const STOCK_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
// A stock number for a unit loaded from the lot: IN-<yymmdd>-<3 characters>. Administration can
// change it when it completes the details.
async function freeStock(c) {
  const { rows } = await c.query(`SELECT to_char(now() AT TIME ZONE '${DEALER_TZ}','YYMMDD') d`);
  for (let i = 0; i < 8; i++) {
    const tail = Array.from({ length: 3 }, () => STOCK_CHARS[randomInt(STOCK_CHARS.length)]).join("");
    const stock = `IN-${rows[0].d}-${tail}`;
    const taken = await c.query("SELECT 1 FROM vehicles WHERE lower(stock)=lower($1)", [stock]);
    if (!taken.rowCount) return stock;
  }
  throw new InputError("No se pudo asignar un número de stock. Inténtalo de nuevo.", 409);
}

// The full vehicle record vehicleInput validates: what the intake says on top of what the unit
// already had, a draft without a price unless administration already gave it one.
function intakeBody(old, input) {
  const data = old?.data || {};
  const sameColor = data.ext && (data.ext.es === input.ext || data.ext.en === input.ext);
  const sameTrans = data.trans && (data.trans.es === input.trans || data.trans.en === input.trans);
  const fuel = input.fuel || data.fuel || "gas";
  const electric = input.body === "electric" || fuel === "electric";
  return {
    ...data,
    stock: old?.stock,
    vin: input.vin,
    status: "draft",
    purchaseCost: old ? Number(old.purchase_cost) : 0,
    year: input.year,
    make: input.make,
    model: input.model,
    trim: input.trim,
    miles: input.miles,
    condition: input.condition,
    cats: electric && input.body !== "electric" ? [input.body, "electric"] : [input.body],
    fuel: electric ? "electric" : fuel,
    ext: sameColor ? data.ext : { es: input.ext, en: input.ext },
    engine: input.engine || data.engine || "",
    drive: input.drive || data.drive || "",
    trans: sameTrans || !input.trans ? data.trans || {} : { es: input.trans, en: input.trans },
    priceOnRequest: old ? data.priceOnRequest === true : true,
    price: old ? data.price ?? 0 : 0,
    msrp: old ? data.msrp ?? 0 : 0,
    featured: old ? data.featured === true : false,
    demo: false,
  };
}

// The VIN decoder of the US Department of Transportation (NHTSA vPIC): public, free, no key. Only
// the VIN is sent. It fills what the person would otherwise type on the lot.
const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/";
const BODY_RULES = [
  [/pickup/i, "truck"],
  [/sport utility|crossover|multi-?purpose/i, "suv"],
  [/van/i, "van"],
  [/coupe|convertible|cabriolet|roadster/i, "coupe"],
  [/hatchback|liftback|wagon/i, "hatch"],
  [/sedan|saloon/i, "sedan"],
];
const titleCase = (s) => String(s || "").toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());
export function decodedVehicle(vin, d) {
  const primary = d.FuelTypePrimary || "", secondary = d.FuelTypeSecondary || "";
  const fuel = /electric/i.test(primary) && !secondary ? "electric"
    : /electric/i.test(secondary) || /hybrid/i.test(d.ElectrificationLevel || "") ? "hybrid"
    : /diesel/i.test(primary) ? "diesel" : "gas";
  const liters = Number(d.DisplacementL) ? `${Math.round(Number(d.DisplacementL) * 10) / 10}L` : "";
  const cylinders = Number(d.EngineCylinders) ? `${d.EngineCylinders} cil.` : "";
  const trans = /cvt|continuously/i.test(d.TransmissionStyle) ? "CVT" : /manual|standard/i.test(d.TransmissionStyle) ? "Manual" : /automatic|automated/i.test(d.TransmissionStyle) ? "Automática" : "";
  // Electric is a category of its own in the catalogue; a body class wins, and the fuel adds it.
  const body = BODY_RULES.find(([re]) => re.test(d.BodyClass || ""))?.[1] || (fuel === "electric" ? "electric" : "");
  return {
    vin,
    year: Number(d.ModelYear) || null,
    make: titleCase(d.Make),
    model: String(d.Model || "").trim(),
    trim: [d.Trim, d.Trim2].filter(Boolean).join(" ").trim(),
    body,
    fuel,
    engine: [liters, cylinders].filter(Boolean).join(" "),
    drive: String(d.DriveType || "").split("/")[0].trim(),
    trans,
  };
}

export function intakeRouter({ audit, checkId }) {
  const r = express.Router();

  r.get("/intake/vin/:vin", async (req, res) => {
    const vin = String(req.params.vin).toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new InputError("El VIN debe tener 17 caracteres (sin I, O ni Q).");
    let d;
    try {
      const response = await fetch(VPIC + vin + "?format=json", { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(String(response.status));
      d = (await response.json()).Results?.[0];
    } catch {
      throw new InputError("No se pudo consultar el VIN en este momento. Completa los datos a mano.", 502);
    }
    if (!d?.Make || !d.ModelYear) throw new InputError("No se encontró ese VIN. Revísalo o completa los datos a mano.", 404);
    res.json(decodedVehicle(vin, d));
  });

  // Salespeople and service see the units they loaded, whatever became of them. Administration
  // sees every draft: what is waiting for its details and price.
  r.get("/intake", async (req, res) => {
    const admin = req.user.role === "admin";
    const { rows } = await query(
      admin
        ? `${VEHICLE_SELECT} WHERE v.status='draft' ORDER BY v.intake_by IS NULL,v.created_at DESC LIMIT 300`
        : `${VEHICLE_SELECT} WHERE v.intake_by=$1 ORDER BY v.created_at DESC LIMIT 200`,
      admin ? [] : [req.user.id],
    );
    res.json(rows.map((v) => vehicleView(v, req.user.role)));
  });

  r.post("/intake", async (req, res) => {
    const input = intakeInput(req.body);
    const id = randomUUID();
    await transaction(async (c) => {
      const stock = await freeStock(c);
      const v = vehicleInput({ ...intakeBody(null, input), stock });
      await c.query(
        "INSERT INTO vehicles(id,stock,vin,status,data,purchase_cost,intake_by,intake_notes) VALUES($1,$2,$3,'draft',$4,0,$5,$6)",
        [id, v.stock, v.vin, JSON.stringify(v.data), req.user.id, input.notes],
      );
      await audit(c, req.user, "vehicle.intake", id);
    });
    res.status(201).json({ id });
  });

  // While the unit is a draft, whoever loaded it can correct what they recorded.
  async function ownDraft(c, req) {
    const { rows } = await c.query("SELECT * FROM vehicles WHERE id=$1 FOR UPDATE", [req.params.id]);
    const old = rows[0];
    if (!old) throw new InputError("Vehículo no encontrado.", 404);
    if (old.status !== "draft")
      throw new InputError("Administración ya publicó o archivó esta unidad; pídele los cambios.", 409);
    if (req.user.role !== "admin" && old.intake_by !== req.user.id)
      throw new InputError("Solo quien cargó la unidad o administración puede cambiarla.", 403);
    return old;
  }

  r.put("/intake/:id", checkId, async (req, res) => {
    const input = intakeInput(req.body);
    await transaction(async (c) => {
      const old = await ownDraft(c, req);
      const v = vehicleInput(intakeBody(old, input));
      await c.query(
        "UPDATE vehicles SET vin=$2,data=$3,intake_notes=$4,version=version+1,updated_at=now() WHERE id=$1",
        [old.id, v.vin, JSON.stringify(v.data), input.notes],
      );
      await audit(c, req.user, "vehicle.intake_updated", old.id);
    });
    res.json({ ok: true });
  });

  // A unit loaded by mistake is archived, never deleted: its photos and history stay.
  r.post("/intake/:id/discard", checkId, async (req, res) => {
    await transaction(async (c) => {
      const old = await ownDraft(c, req);
      await c.query("UPDATE vehicles SET status='archived',version=version+1,updated_at=now() WHERE id=$1", [old.id]);
      await audit(c, req.user, "vehicle.intake_discarded", old.id);
    });
    res.json({ ok: true });
  });

  return r;
}
