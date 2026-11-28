FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# 1. Prune the workspace to mcp-server, @GhostPR/db, and their workspace dependencies
FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune mcp-server @GhostPR/db --docker

# 2. Install dependencies and build
FROM base AS builder
WORKDIR /app

COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --no-frozen-lockfile

COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json

RUN pnpm turbo run build --filter=mcp-server... --filter=@GhostPR/db...

# 3. Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/mcp-server/dist ./apps/mcp-server/dist
COPY --from=builder /app/apps/mcp-server/package.json ./apps/mcp-server/package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/mcp-server/node_modules ./apps/mcp-server/node_modules
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/packages/db/schema.sql ./packages/db/schema.sql
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

RUN mkdir -p /app/data
COPY data/ ./data/

ENV DATABASE_PATH="/app/data/GhostPR.db"
ENV PORT=8080
EXPOSE 8080

# Auto-run DB migration if GhostPR.db is not present (e.g., fresh Render deploy)
CMD ["sh", "-c", "if [ ! -f \"$DATABASE_PATH\" ]; then echo 'Initializing database...' && node packages/db/dist/migrate.js; fi && exec node apps/mcp-server/dist/http.js"]
