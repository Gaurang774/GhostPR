FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# 1. Prune the workspace to the ingestion app and db package
FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune ingestion --docker

# 2. Install dependencies and build
FROM base AS builder
WORKDIR /app

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --no-frozen-lockfile

COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json

# Build ingestion and its dependencies (shared-types), then build db package for migration
RUN pnpm turbo run build --filter=ingestion... && pnpm --filter @GhostPR/db run build

# 3. Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/ingestion/dist ./apps/ingestion/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/ingestion/node_modules ./apps/ingestion/node_modules

# Include db migration for the migrate service
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/schema.sql ./packages/db/schema.sql

RUN mkdir -p /app/data
ENV DATABASE_PATH="/app/data/GhostPR.db"

CMD ["node", "apps/ingestion/dist/index.js"]
