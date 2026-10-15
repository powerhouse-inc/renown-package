# =============================================================================
# Multi-stage Dockerfile for Powerhouse Document Model Packages
# Produces two images: connect (frontend) and switchboard (backend)
#
# Build commands:
#   docker build --target connect -t <registry>/<project>/connect:<tag> .
#   docker build --target switchboard -t <registry>/<project>/switchboard:<tag> .
#
# Layer layout (for cache reuse across releases):
#   toolchain -> deps (manifests + pnpm install) -> base (source + pnpm build)
# The dependency layer only depends on the lockfile/manifest content, not on
# the source or the release version, so a source-only release skips the
# install and reuses the node_modules layers of the runtime image.
# =============================================================================

# -----------------------------------------------------------------------------
# Toolchain: node + build tools + pnpm
# -----------------------------------------------------------------------------
FROM node:24-alpine AS toolchain

# Install build dependencies
RUN apk add --no-cache python3 make g++ git bash \
    && ln -sf /usr/bin/python3 /usr/bin/python

# Setup pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Pinned: pnpm@latest (12.x) fails `pnpm add -g` with ERR_PNPM_GLOBAL_BIN_DIR_NOT_IN_PATH.
ARG PNPM_VERSION=10.33.0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Configure JSR registry
RUN pnpm config set @jsr:registry https://npm.jsr.io

# Install ph-cmd globally (used by `ph connect build`). TAG is the lockfile's
# ph-cli version, so it only changes together with the lockfile, which
# re-runs the install below anyway.
ARG TAG=dev
RUN pnpm add -g ph-cmd@$TAG

# -----------------------------------------------------------------------------
# Manifests: dependency inputs with the release version normalised away.
# semantic-release bumps package.json "version" on every release; without
# this, every release would re-run `pnpm install`. COPY --from is keyed on
# file content, so the deps stage below stays cached while only the version
# changes.
# -----------------------------------------------------------------------------
FROM node:24-alpine AS manifests

WORKDIR /manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));p.version="0.0.0";fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'

# -----------------------------------------------------------------------------
# Deps: install all dependencies (dev deps included: ph-cli, switchboard and
# connect are devDependencies and are what `ph switchboard` runs at runtime).
# -----------------------------------------------------------------------------
FROM toolchain AS deps

WORKDIR /app/project

COPY --from=manifests /manifests/ ./

ENV CI=true
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Base stage: source + build
# -----------------------------------------------------------------------------
FROM deps AS base

# Copy project source (see .dockerignore)
COPY . ./

# Build the project
RUN pnpm build


# -----------------------------------------------------------------------------
# Connect build stage
# -----------------------------------------------------------------------------
FROM base AS connect-builder

ARG PH_CONNECT_BASE_PATH="/"

# Build connect
RUN ph connect build --base ${PH_CONNECT_BASE_PATH}

# -----------------------------------------------------------------------------
# Connect final stage - nginx
# -----------------------------------------------------------------------------
FROM nginx:alpine AS connect

# Install envsubst for config templating
RUN apk add --no-cache gettext

# Copy nginx config template
COPY docker/nginx.conf /etc/nginx/nginx.conf.template

# Copy built static files from build stage
COPY --from=connect-builder /app/project/.ph/connect-build/dist /var/www/html/project

# Environment variables for nginx config
ENV PORT=3001
ENV PH_CONNECT_BASE_PATH="/"

# Copy and setup entrypoint
COPY docker/connect-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:${PORT}/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]

# -----------------------------------------------------------------------------
# Switchboard final stage - node runtime
# -----------------------------------------------------------------------------
FROM node:24-alpine AS switchboard

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache curl openssl

# Setup pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Pinned: pnpm@latest (12.x) fails `pnpm add -g` with ERR_PNPM_GLOBAL_BIN_DIR_NOT_IN_PATH.
ARG PNPM_VERSION=10.33.0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Configure JSR registry
RUN pnpm config set @jsr:registry https://npm.jsr.io

# Install ph-cmd globally (needed at runtime)
ARG TAG=dev
RUN pnpm add -g ph-cmd@$TAG

WORKDIR /app/project

# Runtime needs only what `ph switchboard` loads: the project's node_modules
# (ph-cli/switchboard), the package manifest + config, and the built dist
# (loaded through package.json "exports"). The TypeScript source is not used
# outside `--dev`. node_modules comes from the deps stage in its own layer so
# it is reused unchanged by source-only releases.
COPY --from=deps /app/project/node_modules ./node_modules
COPY --from=base /app/project/package.json /app/project/pnpm-lock.yaml /app/project/pnpm-workspace.yaml /app/project/powerhouse.config.json /app/project/powerhouse.manifest.json ./
COPY --from=base /app/project/dist ./dist

# Copy entrypoint
COPY docker/switchboard-entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=""
ENV SKIP_DB_MIGRATIONS="false"

EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
