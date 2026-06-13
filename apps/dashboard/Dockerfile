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

# First install the dependencies (as they change less often)
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --no-frozen-lockfile

# Then copy the source code and build the project
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
RUN pnpm turbo run build --filter=dashboard...

# 3. Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Install sql.js in the runner to ensure native modules/WASM work
# We copy from the builder's standalone output which includes node_modules
COPY --from=builder /app/apps/dashboard/.next/standalone ./
COPY --from=builder /app/apps/dashboard/.next/static ./apps/dashboard/.next/static

# Copy sql.js WASM binary to the exact path the standalone build expects
COPY --from=builder /app/node_modules/.pnpm/sql.js@1.*/node_modules/sql.js/dist/sql-wasm.wasm /app/node_modules/.pnpm/sql.js@1.14.1/node_modules/sql.js/dist/sql-wasm.wasm
COPY --from=builder /app/node_modules/.pnpm/sql.js@1.*/node_modules/sql.js/dist/sql-wasm.js /app/node_modules/.pnpm/sql.js@1.14.1/node_modules/sql.js/dist/sql-wasm.js

# Set up data directory for the SQLite database
RUN mkdir -p /app/data
ENV DATABASE_PATH="/app/data/GhostPR.db"

EXPOSE 3000
ENV HOSTNAME="0.0.0.0"

# Note: The standalone build puts the server at apps/dashboard/server.js
CMD ["node", "apps/dashboard/server.js"]
