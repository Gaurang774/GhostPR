FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# 1. Prune the workspace to just the dashboard and its dependencies
FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune dashboard --docker

# 2. Add dependencies and build
FROM base AS builder
WORKDIR /app

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --no-frozen-lockfile

COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
# Enable Next.js standalone output for the production image (see next.config.js)
ENV BUILD_STANDALONE=true
RUN pnpm turbo run build --filter=dashboard...

# Stash the sql.js WASM and JS at a version-independent path for the runner stage
RUN find /app/node_modules -path '*/sql.js/dist/sql-wasm.wasm' -exec cp {} /tmp/sql-wasm.wasm \; && \
    find /app/node_modules -path '*/sql.js/dist/sql-wasm.js'   -exec cp {} /tmp/sql-wasm.js   \;

# 3. Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Next.js standalone server (self-contained, includes node_modules for server deps)
COPY --from=builder /app/apps/dashboard/.next/standalone ./
COPY --from=builder /app/apps/dashboard/.next/static ./apps/dashboard/.next/static

# Restore sql.js WASM into whichever versioned path the standalone bundle expects
COPY --from=builder /tmp/sql-wasm.wasm /tmp/sql-wasm.wasm
COPY --from=builder /tmp/sql-wasm.js   /tmp/sql-wasm.js
RUN SQLJS_DIST=$(find /app/node_modules -path '*/sql.js/dist' -type d 2>/dev/null | head -1) && \
    if [ -n "$SQLJS_DIST" ]; then \
      cp /tmp/sql-wasm.wasm "$SQLJS_DIST/sql-wasm.wasm" && \
      cp /tmp/sql-wasm.js   "$SQLJS_DIST/sql-wasm.js"; \
    else \
      echo "WARNING: sql.js dist dir not found in standalone output" >&2; \
    fi

RUN mkdir -p /app/data
ENV DATABASE_PATH="/app/data/GhostPR.db"

EXPOSE 3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/dashboard/server.js"]
