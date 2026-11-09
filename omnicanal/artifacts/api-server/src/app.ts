import express, { type Express, type ErrorRequestHandler } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { createReviewDemo } from "./middlewares/review-demo";

const app: Express = express();

// Railway terminates TLS at its edge and forwards the original protocol and
// client IP in X-Forwarded-*. Without this, req.ip/req.protocol report the proxy.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Capture the raw request body so Meta webhook signatures (X-Hub-Signature-256) can be verified.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

app.use("/api", createReviewDemo());
app.use("/api", router);

// Unmatched API routes must answer JSON. Without this they fall through to the
// SPA fallback or Express's default handler, and the client gets HTML.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Recurso no encontrado." });
});

// ── Frontend ─────────────────────────────────────────────────────────────────
// In a deployed image the omnicanal build is copied next to this bundle and
// served from the same origin, so the SPA's relative `/api/...` calls resolve
// without CORS or a separate proxy. When the build is absent (local `pnpm dev`,
// where Vite serves the SPA on its own port) the server stays API-only.
const webDist =
  process.env["WEB_DIST"] ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "public");
const webIndex = path.join(webDist, "index.html");

if (fs.existsSync(webIndex)) {
  // Hashed assets are immutable; index.html must always be revalidated so a new
  // deploy is picked up instead of serving a stale bundle from cache.
  app.use(
    express.static(webDist, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath === webIndex) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  // Client-side routing: any non-API GET that didn't match a file renders the SPA.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (req.path === "/api" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(webIndex);
  });

  logger.info({ webDist }, "Serving frontend build");
} else {
  logger.warn({ webDist }, "No frontend build found — running API-only");
}

// ── Errors ───────────────────────────────────────────────────────────────────
// Must be last. Without it, Express's default handler answers a thrown route
// error with an HTML error page, which the API client cannot parse — the caller
// just sees "the server returned HTML" instead of the real failure.
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  // Un adjunto por encima del límite de express.raw no es un fallo del servidor:
  // quien lo manda tiene que saber que el problema es el tamaño.
  if ((err as { type?: string } | null)?.type === "entity.too.large") {
    res.status(413).json({ error: "El archivo es demasiado grande." });
    return;
  }

  // Drizzle wraps driver failures in a generic "Failed query" error and keeps
  // the real reason (auth failed, connection terminated, SSL required…) on
  // `cause`, so log it explicitly or the actual problem stays invisible.
  const cause = err instanceof Error ? err.cause : undefined;
  (req.log ?? logger).error({ err, cause }, "Unhandled request error");

  res.status(500).json({ error: "Error interno del servidor." });
};
app.use(errorHandler);

export default app;
