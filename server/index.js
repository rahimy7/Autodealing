import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import sharp from "sharp";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { query, transaction, initialize, pool } from "./db.js";
import {
  InputError,
  text,
  money,
  isUuid,
  vehicleInput,
  saleInput,
  verifyPassword,
  hashPassword,
  publicVehicle,
  ROLES,
  sells,
} from "./domain.js";
import { CONTENT_KEYS } from "./content.js";
import { composeCutout } from "./cutout.js";
import { vehiclePreview, injectPreview, PREVIEW_WIDTH, PREVIEW_HEIGHT } from "./share.js";
import { salesRouter } from "./sales.js";
import { intakeRouter, VEHICLE_SELECT, vehicleView, canArrangePhotos } from "./intake.js";
import { quotesRouter, quotePage } from "./quotes.js";
import { assistantRouter } from "./assistant.js";
import { crmRouter } from "./crm.js";
import { expireReservations } from "./agenda.js";
import { workHours, everyWorkSlot } from "./work-hours.js";
import {
  pushLead,
  scheduleInventorySync,
  syncAfterStart,
  markConversationSale,
  omniEmbedded,
  attachEmbedded,
  identityFor,
} from "./omni-service.js";
import { EMBED_PREFIX, mintToken } from "./omnicanal.js";
import {
  startOmnicanal,
  omniProxy,
  handoffPage,
  handoffCsp,
  messagePage,
  omniEntry,
} from "./omni-embed.js";
import { syncAdminFromEnv, adminAlias, MIN_PASSWORD } from "./admin-env.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const production = process.env.NODE_ENV === "production";
await initialize();
// The administrator's password from the environment, when it is set (server/admin-env.js).
await syncAdminFromEnv();
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }),
);
// Omnicanal inside this service, under /omnicanal (server/omni-embed.js). Before the body parser:
// its requests are streamed through untouched.
const hours = workHours();
const embedded = omniEmbedded();
if (embedded) {
  // One administration: Omnicanal's screens are entries of the administration's own menu, and the
  // site's account is how they open (server/omni-embed.js, omniEntry).
  const entry = omniEntry({ principal, identityFor, mintToken, secret: embedded.secret });
  app.get(`${EMBED_PREFIX}/entrar`, entry.entrar);
  app.use(EMBED_PREFIX, entry.pageRedirect);
  app.use(EMBED_PREFIX, omniProxy({ port: embedded.embedded.port }));
}
app.use(express.json({ limit: "128kb" }));
app.use("/api", (_, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api", (req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== req.get("host"))
          return res.status(403).json({ error: "Origen no permitido." });
      } catch {
        return res.status(403).json({ error: "Origen inválido." });
      }
    }
    if (req.get("sec-fetch-site") === "cross-site")
      return res.status(403).json({ error: "Origen no permitido." });
  }
  next();
});
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera 15 minutos." },
});
const leadsLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes. Inténtalo más tarde." },
});
// The background-removal worker runs third-party code, so it can only reach the hosts of that code
// and its model. It can't call this site's API: the page hands it each photo.
// Updating the library in admin/cutout-worker.js can change the onnxruntime-web version it loads.
const CUTOUT_WORKER_CDN =
  "https://cdn.jsdelivr.net/npm/@huggingface/ https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/";
const CUTOUT_WORKER_CSP = `default-src 'none'; script-src 'self' ${CUTOUT_WORKER_CDN} 'wasm-unsafe-eval'; connect-src ${CUTOUT_WORKER_CDN} https://huggingface.co https://*.huggingface.co https://*.hf.co`;
const hash = (v) => createHash("sha256").update(v).digest("hex");
const cookieToken = (req) => {
  const entry = (req.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("premier_sid="));
  return entry?.slice("premier_sid=".length) || "";
};
async function principal(req) {
  const token = cookieToken(req);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { rows } = await query(
    "SELECT u.id,u.username,u.name,u.role,s.csrf FROM sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active",
    [hash(token)],
  );
  return rows[0] || null;
}
async function auth(req, res, next) {
  req.user = await principal(req);
  if (!req.user) return res.status(401).json({ error: "Inicia sesión." });
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.get("x-csrf-token") !== req.user.csrf
  )
    return res
      .status(403)
      .json({ error: "Sesión desactualizada. Recarga la página." });
  next();
}
const admin = (req, res, next) =>
  req.user.role === "admin"
    ? next()
    : res
        .status(403)
        .json({ error: "Solo administración puede realizar esta acción." });
// Reservations, sales, quotes and web inquiries: administration and salespeople, not service.
const seller = (req, res, next) =>
  sells(req.user.role)
    ? next()
    : res.status(403).json({ error: "Tu perfil no gestiona reservas, ventas, cotizaciones ni consultas." });
const userView = (u) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  role: u.role,
  csrf: u.csrf,
});
const audit = (client, user, action, id) =>
  client.query(
    "INSERT INTO audit_log(user_id,action,entity_id) VALUES($1,$2,$3)",
    [user.id, action, id || null],
  );
const checkId = (req, res, next) => {
  for (const key of ["id", "photoId"])
    if (req.params[key] && !isUuid(req.params[key]))
      return res.status(404).json({ error: "No encontrado." });
  next();
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_, file, cb) =>
    cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});
async function compressed(file) {
  if (!file)
    throw new InputError(
      "Selecciona una imagen JPG, PNG o WEBP de hasta 10 MB.",
    );
  try {
    return await sharp(file.buffer, {
      limitInputPixels: 40_000_000,
      animated: false,
    })
      .rotate()
      .resize({
        width: 1800,
        height: 1400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 84 })
      .toBuffer();
  } catch {
    throw new InputError("La imagen no se pudo procesar. Usa JPG, PNG o WEBP.");
  }
}
app.get("/health", async (_, res) => {
  await query("SELECT 1");
  res.json({ ok: true });
});
app.post("/api/auth/login", loginLimit, async (req, res) => {
  let username = text(req.body.username, 80).toLowerCase();
  // With ADMIN_EMAIL and ADMIN_PASSWORD set, the e-mail is the administrator's user name too.
  if (username && username === adminAlias()) username = "admin";
  const { rows } = await query(
    "SELECT * FROM admin_users WHERE username=$1 AND active",
    [username],
  );
  const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
  const valid = await verifyPassword(
    req.body.password,
    rows[0]?.password_hash || dummy,
  );
  if (!rows[0] || !valid)
    return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(24).toString("hex");
  await query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
    [hash(token), rows[0].id, csrf],
  );
  await query("DELETE FROM sessions WHERE expires_at<now()");
  res.cookie("premier_sid", token, {
    httpOnly: true,
    secure: production,
    sameSite: "strict",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });
  res.json({ user: userView({ ...rows[0], csrf }) });
});
app.get("/api/auth/me", auth, (req, res) =>
  res.json({ user: userView(req.user) }),
);
app.post("/api/auth/logout", auth, async (req, res) => {
  await query("DELETE FROM sessions WHERE token_hash=$1", [
    hash(cookieToken(req)),
  ]);
  res.clearCookie("premier_sid", {
    path: "/",
    secure: production,
    httpOnly: true,
    sameSite: "strict",
  });
  res.json({ ok: true });
});
app.post("/api/auth/password", auth, async (req, res) => {
  const { rows } = await query(
    "SELECT password_hash FROM admin_users WHERE id=$1",
    [req.user.id],
  );
  if (!(await verifyPassword(req.body.currentPassword, rows[0].password_hash)))
    throw new InputError("Contraseña actual incorrecta.");
  const passwordHash = await hashPassword(req.body.newPassword);
  await transaction(async (c) => {
    await c.query("UPDATE admin_users SET password_hash=$1 WHERE id=$2", [
      passwordHash,
      req.user.id,
    ]);
    await c.query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2", [
      req.user.id,
      hash(cookieToken(req)),
    ]);
    await audit(c, req.user, "password.changed", req.user.id);
  });
  res.json({ ok: true });
});
// A visit already wakes the database, so the public catalogue releases ended reservations itself
// (at most every five minutes) instead of showing them until the next working hour.
let publicExpiryAt = 0;
app.get("/api/inventory", async (_, res) => {
  if (Date.now() - publicExpiryAt > 5 * 60 * 1000) {
    publicExpiryAt = Date.now();
    await expireReservations().catch((e) =>
      console.error("Reservation expiry failed:", e.code || e.name),
    );
  }
  const { rows } = await query(
    "SELECT v.*,coalesce((SELECT json_agg(json_build_object('id',p.id,'cutout',p.cutout IS NOT NULL) ORDER BY p.position,p.created_at) FROM vehicle_photos p WHERE p.vehicle_id=v.id),'[]') photos FROM vehicles v WHERE status IN ('available','reserved') ORDER BY created_at DESC",
  );
  res.json(rows.map((v) => publicVehicle(v, v.photos)));
});
app.get("/api/photos/:id", checkId, async (req, res) => {
  const { rows } = await query(
    "SELECT p.image,p.mime,v.status FROM vehicle_photos p JOIN vehicles v ON v.id=p.vehicle_id WHERE p.id=$1",
    [req.params.id],
  );
  const p = rows[0];
  if (
    !p ||
    (!["available", "reserved"].includes(p.status) && !(await principal(req)))
  )
    return res.sendStatus(404);
  res.type(p.mime);
  res.set("Cache-Control", "private, no-cache");
  res.send(p.image);
});
app.get("/api/photos/:id/cutout", checkId, async (req, res) => {
  const { rows } = await query(
    "SELECT p.cutout,v.status FROM vehicle_photos p JOIN vehicles v ON v.id=p.vehicle_id WHERE p.id=$1 AND p.cutout IS NOT NULL",
    [req.params.id],
  );
  const p = rows[0];
  if (
    !p ||
    (!["available", "reserved"].includes(p.status) && !(await principal(req)))
  )
    return res.sendStatus(404);
  res.type("image/webp");
  res.set("Cache-Control", "private, no-cache");
  res.send(p.cutout);
});
// Public vehicle folders are withdrawn immediately when the unit is sold.
app.get("/media/vehicles/:vehicleId/:photoId.webp", async (req, res) => {
  if (!isUuid(req.params.vehicleId) || !isUuid(req.params.photoId)) return res.sendStatus(404);
  const { rows } = await query(
    "SELECT p.image,p.mime FROM vehicle_photos p JOIN vehicles v ON v.id=p.vehicle_id WHERE p.id=$1 AND v.id=$2 AND v.status IN ('available','reserved')",
    [req.params.photoId, req.params.vehicleId],
  );
  if (!rows[0]) return res.sendStatus(404);
  res.set("Cache-Control", "no-store");
  res.type(rows[0].mime).send(rows[0].image);
});
app.get("/media/vehicles/:vehicleId/:photoId/cutout.webp", async (req, res) => {
  if (!isUuid(req.params.vehicleId) || !isUuid(req.params.photoId)) return res.sendStatus(404);
  const { rows } = await query(
    "SELECT p.cutout FROM vehicle_photos p JOIN vehicles v ON v.id=p.vehicle_id WHERE p.id=$1 AND v.id=$2 AND p.cutout IS NOT NULL AND v.status IN ('available','reserved')",
    [req.params.photoId, req.params.vehicleId],
  );
  if (!rows[0]) return res.sendStatus(404);
  res.set("Cache-Control", "no-store");
  res.type("image/webp").send(rows[0].cutout);
});
// The picture WhatsApp and Facebook show for a shared vehicle link (server/share.js): a JPEG,
// which every crawler reads, cropped to the wide card they draw. Withdrawn with the unit.
app.get("/media/vehicles/:vehicleId/:photoId.jpg", async (req, res) => {
  if (!isUuid(req.params.vehicleId) || !isUuid(req.params.photoId)) return res.sendStatus(404);
  const { rows } = await query(
    "SELECT p.image FROM vehicle_photos p JOIN vehicles v ON v.id=p.vehicle_id WHERE p.id=$1 AND v.id=$2 AND v.status IN ('available','reserved')",
    [req.params.photoId, req.params.vehicleId],
  );
  if (!rows[0]) return res.sendStatus(404);
  const jpeg = await sharp(rows[0].image)
    .rotate()
    .flatten({ background: "#0d1017" })
    .resize(PREVIEW_WIDTH, PREVIEW_HEIGHT, { fit: "cover", position: "attention" })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  res.set("Cache-Control", "no-store");
  res.type("image/jpeg").send(jpeg);
});
app.get("/api/content", async (_, res) => {
  res.json(
    (await query("SELECT value FROM settings WHERE id='content'")).rows[0]
      ?.value || { en: {}, es: {} },
  );
});
app.get("/api/site", async (_, res) => {
  const { rows } = await query("SELECT value FROM settings WHERE id='dealer'");
  res.json(rows[0].value);
});
app.get("/api/site/logo", async (_, res) => {
  const { rows } = await query(
    "SELECT image,mime FROM site_assets WHERE id='logo'",
  );
  // Without an uploaded logo, the original in WEBP (a tenth of the PNG's weight).
  if (!rows[0]) return res.sendFile(path.join(root, "img/premier-logo.webp"));
  res.type(rows[0].mime).set("Cache-Control", "no-cache").send(rows[0].image);
});
// Finance: a request a salesperson follows up by phone. It never asks for an SSN or date of birth.
const LEAD_KINDS = ["testdrive", "trade", "contact", "finance", "visit"];
const LEAD_FIELDS = [
  "date", "time", "msg", "year", "make", "model", "miles", "condition",
  "topic", "down", "employment", "income", "credit",
];
app.post("/api/leads", leadsLimit, async (req, res) => {
  const b = req.body;
  if (b.website) return res.json({ ok: true });
  const kind = LEAD_KINDS.includes(b.kind) ? b.kind : "contact";
  const name = text(b.name, 160),
    phone = text(b.phone || b.contact, 100),
    email = text(b.email, 200);
  if (!name || (!phone && !email))
    throw new InputError("Indica tu nombre y teléfono o email.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new InputError("Email inválido.");
  const vehicle = isUuid(b.vehicle) ? b.vehicle : null;
  if (vehicle) {
    const { rows } = await query(
      "SELECT id FROM vehicles WHERE id=$1 AND status IN ('available','reserved')",
      [vehicle],
    );
    if (!rows.length)
      throw new InputError("Ese vehículo ya no está disponible.");
  }
  const data = Object.fromEntries(
    LEAD_FIELDS.map((k) => [k, text(b[k], k === "msg" ? 3000 : 100)]),
  );
  const leadId = randomUUID();
  await query(
    "INSERT INTO leads(id,kind,name,phone,email,vehicle_id,data) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [leadId, kind, name, phone, email, vehicle, JSON.stringify(data)],
  );
  res.status(201).json({ ok: true });
  // The inquiry also becomes a contact in Omnicanal's CRM. The visitor never waits on it.
  void pushLead(leadId);
});
// Leo, the mascot on the public site, answers typed questions with the AI (server/assistant.js).
app.use("/api/assistant", assistantRouter({ query }));
app.use("/api/admin", auth);
// Any change to what is for sale refreshes the inventory the virtual agents answer with.
app.use("/api/admin", (req, res, next) => {
  if (req.method !== "GET" && /^\/(vehicles|sales|reservations)(\/|$)/.test(req.path))
    res.on("finish", () => {
      if (res.statusCode < 400) scheduleInventorySync();
    });
  next();
});
app.get("/api/admin/dashboard", async (req, res) => {
  const [{ rows: counts }, { rows: sales }, { rows: leads }, { rows: recent }] =
    await Promise.all([
      query(
        "SELECT status,count(*)::integer count,coalesce(sum((data->>'price')::numeric),0) value FROM vehicles GROUP BY status",
      ),
      query(
        "SELECT count(*)::integer count,coalesce(sum(price),0) revenue,coalesce(sum(price-cost),0) margin FROM sales WHERE cancelled_at IS NULL",
      ),
      query("SELECT count(*)::integer count FROM leads WHERE status='new'"),
      query(
        "SELECT action,entity_id,created_at FROM audit_log ORDER BY id DESC LIMIT 12",
      ),
    ]);
  res.json({
    counts,
    sales: req.user.role === "admin" ? sales[0] : { count: sales[0].count },
    leads: leads[0].count,
    recent,
  });
});
app.get("/api/admin/vehicles", async (req, res) => {
  const { rows } = await query(`${VEHICLE_SELECT} ORDER BY v.created_at DESC`);
  res.json(rows.map((v) => vehicleView(v, req.user.role)));
});
// Details, price and publication are administration's. The rest of the team loads units from the
// lot with the mobile app (server/intake.js): a draft without a price.
app.post("/api/admin/vehicles", admin, async (req, res) => {
  const v = vehicleInput(req.body);
  const id = randomUUID();
  await transaction(async (c) => {
    await c.query(
      "INSERT INTO vehicles(id,stock,vin,status,data,purchase_cost) VALUES($1,$2,$3,$4,$5,$6)",
      [id, v.stock, v.vin, v.status, JSON.stringify(v.data), v.purchaseCost],
    );
    await audit(c, req.user, "vehicle.created", id);
  });
  res.status(201).json({ id });
});
app.put("/api/admin/vehicles/:id", checkId, admin, async (req, res) => {
  const v = vehicleInput(req.body);
  await transaction(async (c) => {
    const { rows } = await c.query(
      "SELECT * FROM vehicles WHERE id=$1 FOR UPDATE",
      [req.params.id],
    );
    const old = rows[0];
    if (!old) throw new InputError("Vehículo no encontrado.", 404);
    if (old.status === "sold")
      throw new InputError(
        "La venta está registrada. Anúlala antes de editar este vehículo.",
        409,
      );
    if (old.version !== Number(req.body.version))
      throw new InputError(
        "Otro usuario actualizó el vehículo. Recarga el inventario.",
        409,
      );
    if (old.status === "reserved" && v.status !== "reserved") {
      const { rows: held } = await c.query(
        "SELECT r.customer_name,u.name FROM reservations r JOIN admin_users u ON u.id=r.seller_id WHERE r.vehicle_id=$1 AND r.status='active'",
        [old.id],
      );
      if (held[0])
        throw new InputError(
          `${held[0].name} tiene este vehículo reservado. Libera la reserva desde la app de ventas antes de cambiar su estado.`,
          409,
        );
    }
    await c.query(
      "UPDATE vehicles SET stock=$1,vin=$2,status=$3,data=$4,purchase_cost=$5,version=version+1,updated_at=now() WHERE id=$6",
      [
        v.stock,
        v.vin,
        v.status,
        JSON.stringify(v.data),
        v.purchaseCost,
        req.params.id,
      ],
    );
    await audit(c, req.user, "vehicle.updated", req.params.id);
  });
  res.json({ ok: true });
});
app.post(
  "/api/admin/vehicles/:id/photos",
  checkId,
  upload.single("photo"),
  async (req, res) => {
    const bytes = await compressed(req.file);
    const id = randomUUID();
    await transaction(async (c) => {
      const { rows } = await c.query(
        "SELECT id FROM vehicles WHERE id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!rows.length) throw new InputError("Vehículo no encontrado.", 404);
      const { rows: count } = await c.query(
        "SELECT count(*)::integer count FROM vehicle_photos WHERE vehicle_id=$1",
        [req.params.id],
      );
      if (count[0].count >= 60)
        throw new InputError("Máximo 60 fotos por vehículo.");
      await c.query(
        "INSERT INTO vehicle_photos(id,vehicle_id,image,mime,position) VALUES($1,$2,$3,$4,$5)",
        [id, req.params.id, bytes, "image/webp", count[0].count],
      );
      await audit(c, req.user, "photo.added", req.params.id);
    });
    res.status(201).json({ id, url: `/api/photos/${id}` });
  },
);
app.delete(
  "/api/admin/vehicles/:id/photos/:photoId",
  checkId,
  async (req, res) => {
    await transaction(async (c) => {
      await c.query("SELECT id FROM vehicles WHERE id=$1 FOR UPDATE", [
        req.params.id,
      ]);
      if (!(await canArrangePhotos(c, req.user, req.params.id)))
        throw new InputError("Solo administración ordena o quita las fotos de una unidad publicada.", 403);
      await c.query(
        "DELETE FROM vehicle_photos WHERE id=$1 AND vehicle_id=$2",
        [req.params.photoId, req.params.id],
      );
      await audit(c, req.user, "photo.deleted", req.params.id);
    });
    res.json({ ok: true });
  },
);
app.put(
  "/api/admin/vehicles/:id/photos/:photoId/cutout",
  checkId,
  upload.single("mask"),
  async (req, res) => {
    if (!req.file) throw new InputError("Falta la máscara de la foto.");
    if (!(await canArrangePhotos({ query }, req.user, req.params.id)))
      throw new InputError("Solo administración quita el fondo de las fotos de una unidad publicada.", 403);
    const { rows } = await query(
      "SELECT image FROM vehicle_photos WHERE id=$1 AND vehicle_id=$2",
      [req.params.photoId, req.params.id],
    );
    if (!rows[0]) throw new InputError("Foto no encontrada.", 404);
    const cutout = await composeCutout(rows[0].image, req.file.buffer);
    await transaction(async (c) => {
      const updated = await c.query(
        "UPDATE vehicle_photos SET cutout=$1 WHERE id=$2 AND vehicle_id=$3",
        [cutout, req.params.photoId, req.params.id],
      );
      if (!updated.rowCount) throw new InputError("Foto no encontrada.", 404);
      await audit(c, req.user, "photo.cutout_saved", req.params.id);
    });
    res.json({ cutoutUrl: `/api/photos/${req.params.photoId}/cutout` });
  },
);
app.delete(
  "/api/admin/vehicles/:id/photos/:photoId/cutout",
  checkId,
  async (req, res) => {
    await transaction(async (c) => {
      if (!(await canArrangePhotos(c, req.user, req.params.id)))
        throw new InputError("Solo administración quita el fondo de las fotos de una unidad publicada.", 403);
      const updated = await c.query(
        "UPDATE vehicle_photos SET cutout=NULL WHERE id=$1 AND vehicle_id=$2",
        [req.params.photoId, req.params.id],
      );
      if (!updated.rowCount) throw new InputError("Foto no encontrada.", 404);
      await audit(c, req.user, "photo.cutout_deleted", req.params.id);
    });
    res.json({ ok: true });
  },
);
app.put("/api/admin/vehicles/:id/photos/order", checkId, async (req, res) => {
  const ids = req.body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length > 60 ||
    !ids.every(isUuid) ||
    new Set(ids).size !== ids.length
  )
    throw new InputError("Orden de fotografías inválido.");
  await transaction(async (c) => {
    await c.query("SELECT id FROM vehicles WHERE id=$1 FOR UPDATE", [
      req.params.id,
    ]);
    if (!(await canArrangePhotos(c, req.user, req.params.id)))
      throw new InputError("Solo administración ordena o quita las fotos de una unidad publicada.", 403);
    const { rows } = await c.query(
      "SELECT id FROM vehicle_photos WHERE vehicle_id=$1",
      [req.params.id],
    );
    if (rows.length !== ids.length || rows.some((p) => !ids.includes(p.id)))
      throw new InputError("Las fotos cambiaron. Recarga la ficha.", 409);
    for (let i = 0; i < ids.length; i++)
      await c.query("UPDATE vehicle_photos SET position=$1 WHERE id=$2", [
        i,
        ids[i],
      ]);
    await audit(c, req.user, "photos.reordered", req.params.id);
  });
  res.json({ ok: true });
});
app.get("/api/admin/vehicles/:id/expenses", checkId, admin, async (req, res) =>
  res.json(
    (
      await query(
        "SELECT * FROM vehicle_expenses WHERE vehicle_id=$1 ORDER BY expense_date DESC",
        [req.params.id],
      )
    ).rows,
  ),
);
app.post(
  "/api/admin/vehicles/:id/expenses",
  checkId,
  admin,
  async (req, res) => {
    const amount = money(req.body.amount),
      description = text(req.body.description, 300),
      date = text(req.body.date, 10);
    if (!description || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new InputError("Completa el concepto, importe y fecha.");
    await transaction(async (c) => {
      const { rows } = await c.query(
        "SELECT status FROM vehicles WHERE id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!rows.length) throw new InputError("No encontrado.", 404);
      if (rows[0].status === "sold")
        throw new InputError(
          "La venta ya está cerrada. Anúlala para cambiar los costos.",
          409,
        );
      await c.query(
        "INSERT INTO vehicle_expenses(id,vehicle_id,description,amount,expense_date) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), req.params.id, description, amount, date],
      );
      await audit(c, req.user, "expense.created", req.params.id);
    });
    res.status(201).json({ ok: true });
  },
);
app.get("/api/admin/sales", seller, async (req, res) => {
  const { rows } = await query(
    "SELECT s.*,v.stock,v.data->>'make' make,v.data->>'model' model,v.data->>'year' AS \"year\",su.name seller_name FROM sales s JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN admin_users su ON su.id=coalesce(s.seller_id,s.created_by) ORDER BY s.created_at DESC",
  );
  res.json(
    rows.map((s) => {
      if (req.user.role !== "admin") delete s.cost;
      return s;
    }),
  );
});
app.post("/api/admin/sales", seller, async (req, res) => {
  if (!isUuid(req.body.vehicleId))
    throw new InputError("Selecciona un vehículo.");
  const sale = saleInput(req.body),
    id = randomUUID();
  if (req.body.sellerId != null && req.body.sellerId !== "" && !isUuid(req.body.sellerId))
    throw new InputError("Vendedor inválido.");
  let fromChat = null;
  await transaction(async (c) => {
    const { rows } = await c.query(
      "SELECT * FROM vehicles WHERE id=$1 FOR UPDATE",
      [req.body.vehicleId],
    );
    const v = rows[0];
    if (v?.data.demo)
      throw new InputError(
        "Esta unidad es de demostración. Completa sus datos reales y desmarca Demo antes de vender.",
        409,
      );
    if (!v || !["available", "reserved"].includes(v.status))
      throw new InputError(
        "Solo se pueden vender vehículos disponibles o reservados.",
        409,
      );
    const { rows: costs } = await c.query(
      "SELECT coalesce(sum(amount),0) total FROM vehicle_expenses WHERE vehicle_id=$1",
      [v.id],
    );
    const cost = Number(v.purchase_cost) + Number(costs[0].total);
    // A live reservation belongs to its salesperson: only they or administration can close it,
    // and the sale is credited to them unless administration names someone else.
    const { rows: held } = await c.query(
      "SELECT r.id,r.seller_id,r.omni_conversation_id,r.expires_at>now() live,u.name FROM reservations r JOIN admin_users u ON u.id=r.seller_id WHERE r.vehicle_id=$1 AND r.status='active'",
      [v.id],
    );
    const hold = held[0];
    if (hold?.live && req.user.role !== "admin" && hold.seller_id !== req.user.id)
      throw new InputError(`Este vehículo está reservado por ${hold.name}.`, 409);
    let sellerId = hold?.live ? hold.seller_id : req.user.id;
    if (req.user.role === "admin" && req.body.sellerId) {
      const { rows: seller } = await c.query(
        "SELECT id FROM admin_users WHERE id=$1 AND active AND role IN ('admin','sales')",
        [req.body.sellerId],
      );
      if (!seller.length) throw new InputError("Vendedor no encontrado o desactivado.");
      sellerId = req.body.sellerId;
    }
    await c.query(
      "INSERT INTO sales(id,vehicle_id,price,cost,buyer_name,buyer_phone,buyer_email,notes,sold_at,created_by,seller_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        id,
        v.id,
        sale.price,
        cost,
        sale.buyerName,
        sale.buyerPhone,
        sale.buyerEmail,
        sale.notes,
        sale.soldAt,
        req.user.id,
        sellerId,
      ],
    );
    if (hold) {
      await c.query(
        "UPDATE reservations SET status=$2,sale_id=CASE WHEN $2='converted' THEN $3::uuid END,closed_at=now(),closed_by=$4 WHERE id=$1",
        [hold.id, hold.live ? "converted" : "expired", id, req.user.id],
      );
      if (hold.live && hold.omni_conversation_id)
        fromChat = { conversationId: hold.omni_conversation_id, sellerId, vehicle: v.data };
    }
    await c.query(
      "UPDATE vehicles SET status='sold',version=version+1,updated_at=now() WHERE id=$1",
      [v.id],
    );
    await audit(c, req.user, "sale.created", id);
  });
  res.status(201).json({ id });
  if (fromChat) void markConversationSale(fromChat);
});
app.post("/api/admin/sales/:id/cancel", checkId, admin, async (req, res) => {
  await transaction(async (c) => {
    const lookup = await c.query("SELECT vehicle_id FROM sales WHERE id=$1", [
      req.params.id,
    ]);
    if (!lookup.rows[0]) throw new InputError("Venta no encontrada.", 404);
    await c.query("SELECT id FROM vehicles WHERE id=$1 FOR UPDATE", [
      lookup.rows[0].vehicle_id,
    ]);
    const { rows } = await c.query(
      "UPDATE sales SET cancelled_at=now() WHERE id=$1 AND cancelled_at IS NULL RETURNING vehicle_id",
      [req.params.id],
    );
    if (!rows.length) throw new InputError("La venta ya fue anulada.", 409);
    await c.query(
      "UPDATE vehicles SET status='available',version=version+1,updated_at=now() WHERE id=$1",
      [rows[0].vehicle_id],
    );
    await audit(c, req.user, "sale.cancelled", req.params.id);
  });
  res.json({ ok: true });
});
app.get("/api/admin/leads", seller, async (_, res) =>
  res.json(
    (
      await query(
        "SELECT l.*,v.stock,v.data->>'make' make,v.data->>'model' model,v.data->>'year' AS \"year\",au.name assigned_name FROM leads l LEFT JOIN vehicles v ON v.id=l.vehicle_id LEFT JOIN admin_users au ON au.id=l.assigned_to ORDER BY l.created_at DESC LIMIT 500",
      )
    ).rows,
  ),
);
app.put("/api/admin/leads/:id", checkId, seller, async (req, res) => {
  if (!["new", "contacted", "closed"].includes(req.body.status))
    throw new InputError("Estado inválido.");
  await query("UPDATE leads SET status=$1 WHERE id=$2", [
    req.body.status,
    req.params.id,
  ]);
  res.json({ ok: true });
});
app.put("/api/admin/content", admin, async (req, res) => {
  const value = { en: {}, es: {} };
  for (const lang of ["en", "es"])
    for (const key of CONTENT_KEYS) {
      const input = req.body[lang]?.[key];
      if (typeof input === "string" && input.trim())
        value[lang][key] = text(input, 8000);
    }
  await transaction(async (c) => {
    await c.query(
      "INSERT INTO settings(id,value) VALUES('content',$1) ON CONFLICT(id) DO UPDATE SET value=$1",
      [JSON.stringify(value)],
    );
    await audit(c, req.user, "content.updated");
  });
  res.json({ ok: true });
});
app.get("/api/admin/settings", admin, async (_, res) =>
  res.json(
    (await query("SELECT value FROM settings WHERE id='dealer'")).rows[0].value,
  ),
);
app.put("/api/admin/settings", admin, async (req, res) => {
  const value = {};
  for (const k of [
    "name",
    "phone",
    "phoneNumber",
    "email",
    "address",
    "city",
    "instagram",
    "facebook",
    "tiktok",
  ])
    value[k] = text(req.body[k], 200);
  if (
    !value.name ||
    !/^\+\d{8,15}$/.test(value.phoneNumber) ||
    !/^\S+@\S+\.\S+$/.test(value.email)
  )
    throw new InputError(
      "Completa nombre, email y teléfono internacional (+1...).",
    );
  for (const k of ["instagram", "facebook", "tiktok"])
    if (value[k] && !/^https:\/\//.test(value[k]))
      throw new InputError("Los enlaces sociales deben empezar por https://.");
  await transaction(async (c) => {
    await c.query("UPDATE settings SET value=$1 WHERE id='dealer'", [
      JSON.stringify(value),
    ]);
    await audit(c, req.user, "settings.updated");
  });
  res.json({ ok: true });
});
app.post(
  "/api/admin/settings/logo",
  admin,
  upload.single("photo"),
  async (req, res) => {
    const bytes = await compressed(req.file);
    await query(
      "INSERT INTO site_assets(id,image,mime) VALUES('logo',$1,'image/webp') ON CONFLICT(id) DO UPDATE SET image=$1,mime='image/webp',updated_at=now()",
      [bytes],
    );
    res.json({ ok: true });
  },
);
app.get("/api/admin/users", admin, async (_, res) =>
  res.json(
    (
      await query(
        "SELECT id,username,name,role,active,created_at,omni_agent_id FROM admin_users ORDER BY created_at",
      )
    ).rows,
  ),
);
app.post("/api/admin/users", admin, async (req, res) => {
  const username = text(req.body.username, 80).toLowerCase(),
    name = text(req.body.name, 100),
    role = req.body.role;
  if (
    !/^[a-z0-9_.@-]{3,80}$/.test(username) ||
    !name ||
    !ROLES.includes(role)
  )
    throw new InputError("Completa usuario, nombre y rol.");
  const passwordHash = await hashPassword(req.body.password),
    id = randomUUID();
  await transaction(async (c) => {
    await c.query(
      "INSERT INTO admin_users(id,username,name,role,password_hash) VALUES($1,$2,$3,$4,$5)",
      [id, username, name, role, passwordHash],
    );
    await audit(c, req.user, "user.created", id);
  });
  res.status(201).json({ id });
});
// The team always keeps at least one active administrator. Changes to profiles and access take
// one lock, so two administrators demoting each other at once can't leave nobody in charge.
async function keepAnAdmin(c, userId) {
  await c.query("SELECT pg_advisory_xact_lock(487251895)");
  const { rows } = await c.query(
    "SELECT count(*)::integer n FROM admin_users WHERE role='admin' AND active AND id<>$1",
    [userId],
  );
  if (!rows[0].n)
    throw new InputError("Debe quedar al menos una persona activa con perfil de administración.", 409);
}
// Name and profile. A person's profile is read on every request, so a change applies at once.
app.put("/api/admin/users/:id", checkId, admin, async (req, res) => {
  const name = text(req.body.name, 100),
    role = req.body.role;
  if (!name || !ROLES.includes(role)) throw new InputError("Completa nombre y perfil.");
  await transaction(async (c) => {
    const { rows } = await c.query("SELECT id,role FROM admin_users WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!rows[0]) throw new InputError("Usuario no encontrado.", 404);
    if (rows[0].role !== role) {
      if (req.params.id === req.user.id) throw new InputError("No puedes cambiar tu propio perfil.");
      if (rows[0].role === "admin") await keepAnAdmin(c, req.params.id);
    }
    await c.query("UPDATE admin_users SET name=$2,role=$3 WHERE id=$1", [req.params.id, name, role]);
    await audit(c, req.user, "user.updated", req.params.id);
  });
  res.json({ ok: true });
});
// A new password for someone who forgot theirs. Their open sessions end. The administrator whose
// password comes from ADMIN_PASSWORD is changed there (server/admin-env.js), not here.
app.post("/api/admin/users/:id/password", checkId, admin, async (req, res) => {
  if (req.params.id === req.user.id)
    throw new InputError("Cambia tu propia contraseña desde Mi cuenta.");
  const passwordHash = await hashPassword(req.body.password);
  await transaction(async (c) => {
    const { rows } = await c.query("SELECT username,role FROM admin_users WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!rows[0]) throw new InputError("Usuario no encontrado.", 404);
    if (rows[0].username === "admin" && rows[0].role === "admin" && (process.env.ADMIN_PASSWORD || "").length >= MIN_PASSWORD)
      throw new InputError("La contraseña de «admin» se toma de ADMIN_PASSWORD en las variables del servicio.", 409);
    await c.query("UPDATE admin_users SET password_hash=$2 WHERE id=$1", [req.params.id, passwordHash]);
    await c.query("DELETE FROM sessions WHERE user_id=$1", [req.params.id]);
    await audit(c, req.user, "user.password.reset", req.params.id);
  });
  res.json({ ok: true });
});
app.put("/api/admin/users/:id/active", checkId, admin, async (req, res) => {
  if (req.params.id === req.user.id)
    throw new InputError("No puedes desactivar tu propia cuenta.");
  if (typeof req.body.active !== "boolean")
    throw new InputError("Estado inválido.");
  await transaction(async (c) => {
    if (!req.body.active) await keepAnAdmin(c, req.params.id);
    await c.query("UPDATE admin_users SET active=$1 WHERE id=$2", [
      req.body.active,
      req.params.id,
    ]);
    if (!req.body.active)
      await c.query("DELETE FROM sessions WHERE user_id=$1", [req.params.id]);
    await audit(c, req.user, "user.active.changed", req.params.id);
  });
  res.json({ ok: true });
});
app.use("/api/admin", salesRouter({ admin, seller, audit, checkId }));
app.use("/api/admin", intakeRouter({ audit, checkId }));
app.use("/api/admin", quotesRouter({ admin, seller, audit, checkId }));
app.use("/api/admin/crm", crmRouter({ admin, audit }));
app.use("/api", (_, res) =>
  res.status(404).json({ error: "Ruta no encontrada." }),
);
const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
app.use(
  "/admin",
  (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set(
      "Content-Security-Policy",
      req.path === "/cutout-worker.js" ? CUTOUT_WORKER_CSP : APP_CSP,
    );
    next();
  },
  express.static(path.join(root, "admin"), { index: "index.html" }),
);
// The team's mobile app (sales, service and administration): same session and API as the panel,
// built for the phone. It loads the site's fonts, like the public page.
const MOBILE_CSP = APP_CSP.replace("style-src 'self'", "style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com");
app.get("/app", (_req, res) => res.redirect(302, "/ventas/"));
app.use(
  "/ventas",
  (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("Content-Security-Policy", MOBILE_CSP);
    next();
  },
  express.static(path.join(root, "ventas"), { index: "index.html" }),
);
for (const folder of ["css", "js", "img"])
  app.use("/" + folder, express.static(path.join(root, folder), { maxAge: 0 }));
// A quote the customer opens from WhatsApp (server/quotes.js).
app.get("/cotizacion/:token", quotePage);
const indexFile = path.join(root, "index.html");
// /?v=<id> is the link the page, the sales app and the virtual agents share for a unit: it opens
// that vehicle, and its preview shows the unit's photo, title and price.
async function sharedVehicle(req) {
  const id = req.query.v;
  if (typeof id !== "string" || !isUuid(id)) return null;
  const [{ rows }, { rows: dealer }] = await Promise.all([
    query(
      "SELECT v.id,v.data,(SELECT p.id FROM vehicle_photos p WHERE p.vehicle_id=v.id ORDER BY p.position,p.created_at LIMIT 1) photo FROM vehicles v WHERE v.id=$1 AND v.status IN ('available','reserved')",
      [id],
    ),
    query("SELECT value FROM settings WHERE id='dealer'"),
  ]);
  if (!rows[0]) return null;
  return vehiclePreview(rows[0], dealer[0]?.value, {
    base: `${req.protocol}://${req.get("host")}`,
    lang: req.query.lang === "en" ? "en" : "es",
  });
}
app.get("/", async (req, res) => {
  res.set("Cache-Control", "no-cache");
  const preview = await sharedVehicle(req).catch((e) => {
    console.error("Vehicle preview failed:", e.code || e.name);
    return null;
  });
  if (!preview) return res.sendFile(indexFile);
  res.type("html").send(injectPreview(await readFile(indexFile, "utf8"), preview));
});
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.code === "23505")
    return res
      .status(409)
      .json({ error: "Ya existe ese stock, VIN o usuario." });
  if (err instanceof multer.MulterError)
    return res
      .status(400)
      .json({
        error: "Archivo demasiado grande o carga inválida (máximo 10 MB).",
      });
  if (err.type === "entity.parse.failed" || err.type === "entity.too.large")
    return res
      .status(400)
      .json({ error: "Solicitud inválida o demasiado grande." });
  if (err instanceof InputError)
    return res.status(err.status).json({ error: err.message });
  console.error("Request failed:", err.code || err.name);
  res
    .status(500)
    .json({ error: "No se pudo completar la operación. Inténtalo de nuevo." });
});
const server = app.listen(Number(process.env.PORT) || 8080, "0.0.0.0", () =>
  console.log("Premier server ready"),
);
const omnicanal = embedded ? startOmnicanal(embedded, { hours }) : null;
if (omnicanal) attachEmbedded(omnicanal.state);
syncAfterStart();
// Reservations that reached their date return to the catalogue even if nobody opens the app:
// at start, once an hour within the team's hours (server/work-hours.js), and before the sales
// app or the public catalogue shows them. Outside those hours nothing here wakes the database.
const expireSoon = () =>
  expireReservations().catch((e) =>
    console.error("Reservation expiry failed:", e.code || e.name),
  );
expireSoon();
everyWorkSlot(hours, expireSoon);
process.on("SIGTERM", () => {
  const stopped = omnicanal ? omnicanal.stop() : Promise.resolve();
  server.close(() => Promise.all([pool.end(), stopped]).then(() => process.exit(0)));
});
