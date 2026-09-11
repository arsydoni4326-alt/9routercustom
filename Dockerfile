# syntax=docker/dockerfile:1.7
# Minimal two-stage, Node-only image. Bun is not used anywhere at runtime: the DB
# driver chain runs better-sqlite3 → node:sqlite (Node >= 22.5) → sql.js under Node.
FROM node:22-alpine AS builder
WORKDIR /app
# CN mirror for apk (used by builder and runner stages)
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories

# Install deps first for layer caching. Native build tools are NOT required:
# better-sqlite3 is an optionalDependency with musl prebuilds (skipped when
# unavailable — sql.js / node:sqlite fall back at runtime); everything else ships
# musl prebuilds or WASM.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci

COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="9router"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/custom-server.js ./custom-server.js
# Next file tracing can omit sibling files; MITM runs server.js as a separate process.
COPY --from=builder /app/open-sse ./open-sse
COPY --from=builder /app/src/mitm ./src/mitm
# node-forge may be omitted by tracing (MITM child process); node-machine-id is
# createRequire-loaded at runtime. Both are copied explicitly.
COPY --from=builder /app/node_modules/node-forge ./node_modules/node-forge
COPY --from=builder /app/node_modules/node-machine-id ./node_modules/node-machine-id
# sql.js loads dist/sql-wasm.wasm by path at runtime; tracing only follows JS
# imports, so copy the full package or the last-resort DB driver aborts with ENOENT.
COPY --from=builder /app/node_modules/sql.js ./node_modules/sql.js

RUN mkdir -p /app/data

EXPOSE 20128

# Health: Next serves /api/health (dashboardGuard public path).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:20128/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "custom-server.js"]
