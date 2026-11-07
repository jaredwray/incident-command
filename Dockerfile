# syntax=docker/dockerfile:1

# Incident Command container image (Next.js standalone server).
#
#   docker build -t incident-command .
#   docker run -p 3000:3000 \
#     -e DATABASE_URI=postgres://user:pass@db-host:5432/incident_command \
#     -e SITE_URL=http://localhost:3000 \
#     incident-command
#
# See docs/deployment.md for every environment variable.

ARG NODE_VERSION=24

# ---------------------------------------------------------------------------
# Build: install dependencies with corepack-managed pnpm and run `next build`.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build

# libc6-compat: recommended by Next.js for native modules on Alpine (musl).
RUN apk add --no-cache libc6-compat && corepack enable

# MONGOMS_DISABLE_POSTINSTALL: mongodb-memory-server (a test-only devDependency)
# would otherwise download a ~120MB MongoDB binary in its postinstall script.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    MONGOMS_DISABLE_POSTINSTALL=1

WORKDIR /app

# pnpm-workspace.yaml carries `allowBuilds`, so it must sit next to the lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Next.js salts the server action ids with this key. Pass the same key to each
# build so the ids stay the same between deploys. See docs/deployment.md.
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY}
RUN pnpm build

# ---------------------------------------------------------------------------
# Runtime: only the standalone server, static assets and public files.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime

LABEL org.opencontainers.image.title="incident-command" \
      org.opencontainers.image.description="Status page, management portal and MCP server for incident command" \
      org.opencontainers.image.source="https://github.com/jaredwray/incident-command" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

# The official Node image ships an unprivileged `node` user (uid 1000).
USER node

EXPOSE 3000

# Alpine has no curl; use Node's built-in fetch. /healthz returns 503 only
# when the app cannot start; a database outage after boot reports "degraded"
# with a 200 while cached data keeps being served.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "server.js"]
