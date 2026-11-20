// Omnicanal inside this service. With OMNICANAL_SESSION_SECRET set, the site starts Omnicanal's
// built server (omnicanal/, compiled by `npm run omnicanal:build` or the Dockerfile) as a child
// process on a loopback port and publishes it under /omnicanal on this same domain: one deploy,
// one domain, one sign-in. Omnicanal keeps its own process and its own schema of the site's database
// (the agenda is the one table they share), so a crash or
// a slow AI reply there never takes the catalogue down, and, agenda aside, its tables never meet the site's.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";
import { EMBED_PREFIX, sitePublicOrigin } from "./omnicanal.js";
import { workHours } from "./work-hours.js";
import { mergeLegacyAppointmentsFromUrl } from "./appointments-merge.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OMNI_ROOT = path.join(root, "omnicanal");
export const OMNI_ENTRY = path.join(OMNI_ROOT, "artifacts/api-server/dist/index.mjs");
const DB_DIR = path.join(OMNI_ROOT, "lib/db");
const DRIZZLE_KIT = path.join(DB_DIR, "node_modules/.bin/drizzle-kit");

// ── The child's environment ─────────────────────────────────────────────────────────────────
// Omnicanal reads its own names (DATABASE_URL, SESSION_SECRET, PORT…). These belong to the site
// and must not reach it: one is the site's own bootstrap password, and the rest would point
// Omnicanal at the site's database or repeat what is passed below under Omnicanal's names.
const SITE_ONLY = [
  "DATABASE_URL",
  "DATABASE_SCHEMA",
  "ADMIN_BOOTSTRAP_PASSWORD",
  "OMNICANAL_URL",
  "OMNICANAL_DATABASE_URL",
  "OMNICANAL_SESSION_SECRET",
  "OMNICANAL_PORT",
];

// The address Meta downloads images from and Google returns to: the site's public domain plus
// /omnicanal. PUBLIC_BASE_URL names the site's domain; on Railway its generated domain is used.
export function omniPublicUrl(env) {
  const base = sitePublicOrigin(env);
  return base ? base + EMBED_PREFIX : "";
}

export function childEnv(env, cfg, hours = workHours(env)) {
  const out = { ...env };
  for (const name of SITE_ONLY) delete out[name];
  Object.assign(out, {
    PORT: String(cfg.embedded.port),
    HOST: "127.0.0.1",
    DATABASE_URL: cfg.embedded.databaseUrl,
    // One administration: the site's account is the only way in (omnicanal/.../lib/auth.ts).
    SITE_LOGIN_ONLY: "1",
    SESSION_SECRET: cfg.secret,
    CLIENT_ID: env.CLIENT_ID || "premier",
    // Omnicanal's background checks keep the team's hours too (server/work-hours.js).
    SCHEDULER_DAYS: hours.env.days,
    SCHEDULER_HOURS: hours.env.hours,
    SCHEDULER_INTERVAL_MINUTES: hours.env.everyMinutes,
  });
  const publicUrl = omniPublicUrl(env);
  if (publicUrl) out.PUBLIC_BASE_URL = publicUrl;
  else delete out.PUBLIC_BASE_URL;
  return out;
}

// ── Schema ──────────────────────────────────────────────────────────────────────────────────
// Brings Omnicanal's tables to the schema of the code that is about to run, as
// `pnpm --filter @workspace/db run push` does in the Omnicanal workspace. They all live in the
// Postgres schema "omnicanal" and drizzle-kit only looks there, so in the site's database it
// never sees the site's tables. A change that would
// drop data asks for confirmation; with no one to answer, the push times out and Omnicanal
// starts on the schema it has. `npm run omnicanal:migrate` in a terminal answers it.
export async function migrateOmnicanal(
  cfg,
  { env = process.env, timeoutMs = 180_000, stdio = ["ignore", "inherit", "inherit"] } = {},
) {
  if (!fs.existsSync(DRIZZLE_KIT)) {
    console.error("Omnicanal: falta drizzle-kit. Ejecuta npm run omnicanal:build.");
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  const run = (command, args) =>
    new Promise((resolve) => {
      const child = spawn(command, args, { cwd: DB_DIR, env: childEnv(env, cfg), stdio });
      const timer = setTimeout(() => {
        console.error("Omnicanal: la actualización de su base no terminó a tiempo.");
        child.kill("SIGKILL");
      }, Math.max(deadline - Date.now(), 1000));
      child.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
  // The schema first (drizzle-kit 0.31 doesn't create it); then Omnicanal's old appointments, if
  // it still has any, move into the agenda it now shares with the site (so the update below has
  // no table to drop); then the tables inside its schema only.
  return (
    (await run(process.execPath, ["./ensure-schema.mjs"])) &&
    (await mergeLegacyAppointmentsFromUrl(cfg.embedded.databaseUrl)) &&
    (await run(DRIZZLE_KIT, ["push", "--config", "./drizzle.config.ts"]))
  );
}

// ── The process ─────────────────────────────────────────────────────────────────────────────
// Updates the schema, starts Omnicanal and starts it again if it stops, waiting longer each
// time it fails right after starting (usually configuration) so a bad value doesn't spin.
export function startOmnicanal(
  cfg,
  { env = process.env, entry = OMNI_ENTRY, migrate = migrateOmnicanal, hours = workHours(env) } = {},
) {
  let child = null,
    stopping = false,
    timer = null,
    delay = 1000;
  const state = { running: false, error: null };
  if (!fs.existsSync(entry)) {
    state.error = "Omnicanal no está compilado en este servidor (npm run omnicanal:build).";
    console.error(`Omnicanal: ${state.error}`);
    return { state, stop: async () => {} };
  }
  const launch = () => {
    if (stopping) return;
    const startedAt = Date.now();
    child = spawn(process.execPath, ["--enable-source-maps", entry], {
      cwd: OMNI_ROOT,
      env: childEnv(env, cfg, hours),
      stdio: "inherit",
    });
    state.running = true;
    let restarted = false;
    const restart = (why) => {
      if (restarted) return;
      restarted = true;
      child = null;
      state.running = false;
      if (stopping) return;
      delay = Date.now() - startedAt > 60_000 ? 1000 : Math.min(delay * 2, 60_000);
      state.error = `Omnicanal se detuvo (${why}).`;
      console.error(`Omnicanal se detuvo (${why}); se reinicia en ${delay / 1000} s.`);
      timer = setTimeout(launch, delay);
    };
    child.on("error", (error) => restart(error.code || error.message));
    child.on("exit", (code, signal) => restart(signal || `código ${code}`));
  };
  Promise.resolve(migrate(cfg, { env }))
    .then((ok) => {
      if (!ok) console.error("Omnicanal: su base no se pudo actualizar; arranca con el esquema que tiene.");
    })
    .finally(launch);
  return {
    state,
    stop: () =>
      new Promise((resolve) => {
        stopping = true;
        clearTimeout(timer);
        const current = child;
        if (!current) return resolve();
        const force = setTimeout(() => current.kill("SIGKILL"), 8000);
        current.once("exit", () => {
          clearTimeout(force);
          resolve();
        });
        current.kill("SIGTERM");
      }),
  };
}

// ── The panel and its API on this domain ────────────────────────────────────────────────────
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);
// Omnicanal's documents share this site's origin, so they are held to it: the panel runs only
// its own scripts, and nothing under its /api (a chat attachment opened in a tab) runs as a page.
export const PANEL_CSP = "script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

// The site's session cookie is for the site; Omnicanal never needs it.
function withoutSiteCookie(cookie) {
  const rest = String(cookie || "")
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith("premier_sid="));
  return rest.length ? rest.join("; ") : null;
}

// Mounted at /omnicanal, so Express has already removed the prefix: req.url is what Omnicanal
// expects ("/api/…", "/assets/…", "/inbox"). The body is streamed untouched, which Meta's
// webhook signature check depends on, so this must run before any body parser.
export function omniProxy({ port, host = "127.0.0.1" }) {
  return (req, res) => {
    if (req.originalUrl === EMBED_PREFIX || req.originalUrl.startsWith(`${EMBED_PREFIX}?`))
      return res.redirect(308, EMBED_PREFIX + "/" + req.originalUrl.slice(EMBED_PREFIX.length));
    const api = /^\/api(\/|\?|$)/.test(req.url);
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(name)) headers[name] = value;
    const cookie = withoutSiteCookie(req.headers.cookie);
    if (cookie) headers.cookie = cookie;
    else delete headers.cookie;
    headers.host = `${host}:${port}`;
    // One value each, as this site resolved them: Omnicanal trusts exactly one proxy hop.
    headers["x-forwarded-for"] = req.ip || "";
    headers["x-forwarded-proto"] = req.protocol;
    headers["x-forwarded-host"] = req.get("host") || "";
    headers["x-forwarded-prefix"] = EMBED_PREFIX;

    const upstream = http.request({ host, port, method: req.method, path: req.url, headers, agent }, (up) => {
      const out = {};
      for (const [name, value] of Object.entries(up.headers)) if (!HOP_BY_HOP.has(name)) out[name] = value;
      out["content-security-policy"] = api ? API_CSP : up.headers["content-security-policy"] || PANEL_CSP;
      out["x-content-type-options"] = "nosniff";
      // A sign-in page for the team, not a page of the dealership's site.
      out["x-robots-tag"] = "noindex, nofollow";
      res.writeHead(up.statusCode, out);
      pipeline(up, res, () => {});
    });
    upstream.on("error", () => {
      if (res.headersSent) return res.destroy();
      const message = "Omnicanal está arrancando o no responde. Inténtalo en unos segundos.";
      res.status(503).set("Retry-After", "5").set("Cache-Control", "no-store");
      if (api) res.json({ error: message });
      else res.type("text/plain; charset=utf-8").send(message);
    });
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    pipeline(req, upstream, () => {});
  };
}

// ── Signing in with the site's account ──────────────────────────────────────────────────────
// The panel keeps its session in localStorage under this key (omnicanal/artifacts/omnicanal/
// src/lib/auth.tsx). Same origin, so the site can leave a session there and open the panel.
export const PANEL_SESSION_KEY = "omniai_session";

// Inline script data must not be able to close the <script> element.
const scriptJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

// Framed by the site only: the administration opens the panel inside its own page.
export const handoffCsp = (nonce) =>
  `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;

// Where inside the panel a sign-in leads: a path of the panel and nothing else, never another site.
export function panelNext(value) {
  const v = String(value ?? "");
  if (!v.startsWith("/") || v.startsWith("//") || v.length > 300) return "/";
  if (!/^\/[A-Za-z0-9._~\-/?=&%:+,@]*$/.test(v)) return "/";
  if (v.split("?")[0].split("/").includes("..")) return "/";
  return v;
}

// The administration shows the panel's screens inside its own menu; this is that page.
export const shellUrl = (next) => `/admin/#omnicanal${panelNext(next)}`;

// A page loaded in the administration's frame that needs the whole window to move, as when the
// site's own session has ended: the sign-in belongs to the administration, not to the frame.
export function topNavigationPage(url, nonce) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Omnicanal</title></head>
<body><p>Abriendo la administración…</p>
<script nonce="${nonce}">try{(window.top||window).location.replace(${scriptJson(url)})}catch(e){location.replace(${scriptJson(url)})}</script>
</body></html>`;
}

export function handoffPage({ token, user }, nonce, next = "/") {
  const session = { token, user };
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Omnicanal</title></head>
<body><p>Abriendo Omnicanal…</p><noscript>Omnicanal necesita JavaScript.</noscript>
<script nonce="${nonce}">try{localStorage.setItem(${scriptJson(PANEL_SESSION_KEY)},${scriptJson(JSON.stringify(session))})}catch(e){}location.replace(${scriptJson(EMBED_PREFIX + panelNext(next))})</script>
</body></html>`;
}

// How the site's account opens Omnicanal, as two Express handlers:
// - `entrar` (/omnicanal/entrar?next=…) signs the person in to the panel with their site session
//   (an administrator as the instance's administrator, or as their agent once linked; a salesperson
//   only as the agent they are linked to) and lands on the screen `next`.
// - `pageRedirect` sends an administrator who opens a screen of the panel as a page of its own
//   (an address typed or saved, the return from Google's consent screen) to the administration,
//   where that screen is an entry of the menu. Its API, files and webhooks are untouched.
// `principal(req)` is the site's session, `identityFor(user, opts)` who they are in Omnicanal and
// `mintToken(secret, identity, seconds)` the panel's session.
export function omniEntry({ principal, identityFor, mintToken, secret }) {
  const entrar = async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    const next = panelNext(req.query.next);
    const dest = req.get("sec-fetch-dest");
    const user = await principal(req);
    // The site's session has ended: signing in belongs to the administration, whichever page asked.
    if (!user) {
      if (dest !== "iframe") return res.redirect(303, shellUrl(next));
      const nonce = randomBytes(16).toString("base64");
      return res
        .set("Content-Security-Policy", handoffCsp(nonce))
        .type("html")
        .send(topNavigationPage(shellUrl(next), nonce));
    }
    // Opened as a page of its own, an administrator goes to the administration, where the screen is
    // part of the menu. A salesperson has no such menu: they keep the panel as their agent.
    if (dest === "document" && user.role === "admin") return res.redirect(303, shellUrl(next));
    let identity;
    try {
      identity = await identityFor(user, { requireAgent: user.role !== "admin" });
    } catch (error) {
      res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'");
      return res
        .status(error.status || 502)
        .type("html")
        .send(messagePage("No se pudo abrir Omnicanal", error.message, { href: "/admin/", label: "Volver al panel" }));
    }
    // Without a linked agent the panel shows the person's name, not the site's system identity.
    if (identity.agentId === null) identity = { ...identity, name: user.name };
    const nonce = randomBytes(16).toString("base64");
    // Twelve hours, like a sign-in on Omnicanal's own form.
    const token = mintToken(secret, identity, 12 * 60 * 60);
    res
      .set("Content-Security-Policy", handoffCsp(nonce))
      .type("html")
      .send(handoffPage({ token, user: identity }, nonce, next));
  };
  const pageRedirect = async (req, res, next) => {
    try {
      if (req.method !== "GET" || req.get("sec-fetch-dest") !== "document") return next();
      if (/^\/(api|assets|clients|entrar)(\/|$)/.test(req.path) || /\.[A-Za-z0-9]+$/.test(req.path)) return next();
      const user = await principal(req);
      if (user?.role !== "admin") return next();
      return res.redirect(303, shellUrl(req.url));
    } catch (error) {
      return next(error);
    }
  };
  return { entrar, pageRedirect };
}

export function messagePage(title, message, link) {
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;line-height:1.5">
<h1 style="font-size:1.25rem">${esc(title)}</h1><p>${esc(message)}</p>${link ? `<p><a href="${esc(link.href)}">${esc(link.label)}</a></p>` : ""}
</body></html>`;
}
