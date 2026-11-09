# syntax=docker/dockerfile:1

# One image, one service: the dealership site plus Omnicanal (omnicanal/), which the site starts
# on a loopback port and publishes under /omnicanal (server/omni-embed.js). Omnicanal only runs
# when OMNICANAL_DATABASE_URL is set; without it this is the site alone.

# ── Omnicanal: pnpm workspace ───────────────────────────────────────────────────────────────
# Debian, not Alpine: omnicanal/pnpm-workspace.yaml strips every platform binary except
# linux-x64-gnu (and darwin-arm64), so a musl or arm64 image would get no usable esbuild,
# rollup or lightningcss. Build on x64 (Railway does).
FROM node:24-bookworm-slim AS omni-base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
# The workspace is installed with --filter, so node_modules is a subset on purpose. Without
# this, `pnpm run` re-runs a full install to "fix" it.
ENV npm_config_verify_deps_before_run=false
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /omnicanal

# Every workspace manifest, so --frozen-lockfile finds each importer. Its own layer: the install
# below is only redone when a package.json changes.
FROM omni-base AS omni-manifests
COPY omnicanal/package.json omnicanal/pnpm-lock.yaml omnicanal/pnpm-workspace.yaml omnicanal/.npmrc ./
COPY omnicanal/artifacts/api-server/package.json     artifacts/api-server/
COPY omnicanal/artifacts/mobile/package.json         artifacts/mobile/
COPY omnicanal/artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/
COPY omnicanal/artifacts/omnicanal/package.json      artifacts/omnicanal/
COPY omnicanal/lib/api-client-react/package.json     lib/api-client-react/
COPY omnicanal/lib/api-spec/package.json             lib/api-spec/
COPY omnicanal/lib/api-zod/package.json              lib/api-zod/
COPY omnicanal/lib/db/package.json                   lib/db/
COPY omnicanal/lib/platform-config/package.json      lib/platform-config/
COPY omnicanal/scripts/package.json                  scripts/

# The API server (esbuild bundles its dependencies) and the panel, built for /omnicanal/.
FROM omni-manifests AS omni-build
RUN pnpm install --frozen-lockfile \
      --filter "@workspace/api-server..." \
      --filter "@workspace/omnicanal..."
COPY omnicanal/ ./
RUN sh build-embedded.sh

# drizzle-kit and the schema, for the schema push the site runs before starting Omnicanal.
# Installed without NODE_ENV=production, or pnpm would skip drizzle-kit as a devDependency.
FROM omni-manifests AS omni-db
RUN pnpm install --frozen-lockfile --filter "@workspace/db..."
COPY omnicanal/lib/db ./lib/db

# ── Runtime ─────────────────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim
# ffmpeg turns WhatsApp voice notes (OGG/Opus) into M4A, which an iPhone can play.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=omni-db /omnicanal ./omnicanal
COPY --from=omni-build /omnicanal/artifacts/api-server/dist ./omnicanal/artifacts/api-server/dist
COPY server ./server
COPY admin ./admin
COPY ventas ./ventas
COPY index.html ./
COPY css ./css
COPY js ./js
COPY img ./img
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
