import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT only configures the dev/preview server, so it is required when serving
// but irrelevant to `vite build` (which just emits static assets). BASE_PATH
// defaults to the site root; deployments that mount the app under a sub-path
// override it.
function resolvePort(isServe: boolean): number | undefined {
  const rawPort = process.env.PORT;

  if (!rawPort) {
    if (isServe) {
      throw new Error(
        "PORT environment variable is required but was not provided.",
      );
    }
    return undefined;
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  return port;
}

export default defineConfig(async ({ command }) => {
  const port = resolvePort(command === "serve");
  const basePath = process.env.BASE_PATH || "/";

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(
          import.meta.dirname,
          "..",
          "..",
          "attached_assets",
        ),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
      },
      // Local dev only: forward /api to the API server. On Replit the global
      // reverse proxy handles /api before it reaches Vite, so this stays unset
      // there and has no effect. In the Railway image the API server serves the
      // built SPA itself, so no proxy is involved.
      proxy: process.env.API_PROXY_TARGET
        ? {
            "/api": {
              target: process.env.API_PROXY_TARGET,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
