# Dockerfile
#
# NOT using Next's standalone output. Standalone traces imports from Next's own
# server; this app runs a CUSTOM server (server.mjs) that hosts Socket.IO
# alongside Next, and its dependencies — socket.io, ioredis, prisma, web-push —
# are not traced. The image is larger with full node_modules and it actually
# works, which is the better trade.
#
# One image serves BOTH services. The worker is the same code with a different
# start command, so it cannot drift out of step with the app.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# argon2 and sharp need a toolchain. This layer is discarded.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build regenerates the Prisma client. It does NOT touch the database —
# migrations run separately at deploy time.
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
# handlers.mjs is plain ESM imported by server.mjs at runtime — Next never
# bundles it, so it must ship as a source file.
COPY --from=builder --chown=nextjs:nodejs /app/src/server ./src/server
COPY --from=builder --chown=nextjs:nodejs /app/server.mjs ./server.mjs
COPY --from=builder --chown=nextjs:nodejs /app/worker.mjs ./worker.mjs
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Never root. A container escape from a process running as root is a host
# compromise; from uid 1001 it is much less.
USER nextjs

EXPOSE 3000

# Railway uses its own healthcheck, but this keeps `docker run` honest.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/healthz || exit 1

# One image, two roles. Railway's start command lives in a per-service
# dashboard setting that config-as-code silently overrode, so the image decides
# from an environment variable instead.
CMD ["sh", "-c", "if [ \"$SERVICE_ROLE\" = \"worker\" ]; then exec node worker.mjs; else exec node server.mjs; fi"]
