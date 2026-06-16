# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What GhostPR is

GhostPR is a persistent architectural-decision registry for agentic IDEs. It ingests merged GitHub PRs, uses a Groq LLM to extract the "why" behind design decisions, stores them in a local SQLite file, and surfaces them as warning cards inside an IDE through an MCP server — so an AI assistant sees historical context *before* it edits a file.

## Commands

All commands run from the repo root (pnpm workspaces + Turborepo). Requires Node.js 24+ and pnpm.

```bash
pnpm install            # install workspace deps
pnpm run build          # turbo build all packages — REQUIRED before the MCP server can start
                        #   (it runs apps/mcp-server/dist/index.js)
pnpm run dev            # turbo dev — dashboard at http://localhost:3000
pnpm run lint           # turbo lint
pnpm run migrate        # apply schema.sql, create data/GhostPR.db (SEED_DEMO=true loads 8 demo decisions)
pnpm run ingest         # scan the target repo's merged PRs and extract decisions
pnpm run mcp            # run the MCP server manually (normally the IDE launches it)
pnpm run test           # db test suite — runs packages/db/run-test-suite.ts via tsx
pnpm run mcp:setup      # regenerate the IDE MCP config files (.mcp.json / .vscode / .cursor);
                        #   points them at dist/index.js if built, else src via tsx
```

Run a single workspace's script directly with a filter, e.g. `pnpm --filter @GhostPR/db run migrate`, `pnpm --filter ingestion run start`, `pnpm --filter mcp-server run start`.

There is no per-test runner flag; `pnpm run test` executes the whole `packages/db/run-test-suite.ts` harness. Edit that file to scope what runs.

## Environment

Config comes from `.env` at the repo root (copy `.env.example`). Key vars: `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GROQ_API_KEY`, `GROQ_MODEL` (default `llama-3.3-70b-versatile`), `DATABASE_PATH` (default `./data/GhostPR.db`, kept relative so it works at any clone path), `PR_LIMIT` (default 20), `SEED_DEMO` (demo data toggle), and optional `HINDSIGHT_API_KEY` / `HINDSIGHT_BANK_URL`. Every app independently walks up the tree to find the workspace root (the dir containing `pnpm-workspace.yaml`) and loads `.env` from there.

## Architecture

Three apps + two packages, all sharing one SQLite file as the single source of truth:

- `apps/ingestion` — one-shot CLI pipeline. Fetches merged PRs (`github/prFetcher.ts`), extracts a decision per PR via Groq (`extractor/`), runs the signal scanner against older decisions (`health/updater.ts`), applies time-decay to every decision (`health/scorer.ts`), then writes the DB. Idempotent: PRs already in the DB are skipped.
- `apps/mcp-server` — STDIO MCP server the IDE spawns. Registers three tools (`tools/getFileDecisions`, `tools/markDeprecated`, `tools/ignoreDecision`). `getFileDecisions` is the core: matches on `file_path` + `module`, returns full warning cards above the 0.75 confidence threshold and soft notes below it, and logs every retrieval to `agent_log`.
- `apps/dashboard` — Next.js 14 App Router SSR dashboard. Reads the DB via `src/lib/db.ts`; API routes under `src/app/api/decisions`.
- `packages/db` — owns `schema.sql`, `migrate.ts`, `seed.ts`, and the test suite.
- `packages/shared-types` — the `Decision`, `WarningCard`, `HealthStatus`, `DecisionSource` types. **Column names in `schema.sql` and types here must stay in sync** (noted at the top of `schema.sql`).

### SQLite via sql.js — the load/save model that matters

The DB is `sql.js` (pure-WASM SQLite). It runs **entirely in memory**: each process reads the file at startup and must explicitly `db.export()` + write to persist. Consequences to keep in mind:

- **The MCP server saves the in-memory DB to disk every 30 seconds.** This can clobber external writes (a `pnpm migrate` or re-seed done while the server is live). There is an mtime guard (`apps/mcp-server/src/index.ts`): if the file on disk is newer than the server's last write, the periodic save is skipped. Even so, **stop the MCP server before running `migrate`/`ingest`/seed**, then restart it.
- The dashboard (`src/lib/db.ts`) caches its in-memory DB and reloads only when the file mtime changes — so it auto-refreshes after ingestion.

### Health / decay model (`apps/ingestion/src/health/scorer.ts`)

New decisions start at confidence 0.9 (`active`). Confidence decays exponentially from the `created` date (or `last_validated` if more recent, which acts as a reset anchor): `confidence = 0.9 * e^(-0.0020 * days)`. Status thresholds: `>= 0.75` active, `>= 0.3` questionable, below deprecated. Warning cards only show at confidence **> 0.75**. Decay is applied to all decisions at the end of every ingest run.

## MCP / IDE config

The repo ships `.mcp.json` (Claude Code, `${CLAUDE_PROJECT_DIR}`), `.vscode/mcp.json` (VS Code / Copilot, `${workspaceFolder}`), and `.cursor/mcp.json`. The MCP server only starts if **both** `apps/mcp-server/dist/index.js` (from `pnpm run build`) and the DB file (from `pnpm run migrate`) exist — a "failed" server in the IDE almost always means one is missing. All MCP-server logging goes to **stderr**; stdout is reserved for the JSON-RPC protocol.

## Docker & CI

- `docker-compose.yml` defines three services sharing the `ghostpr_data` named volume (mounted at `/app/data`): `migrate` (one-shot, idempotent — downstream services `depends_on` its successful completion), `dashboard` (always-on, port 3000, healthchecks `/api/decisions`), and `ingestion` (one-shot, run manually via `docker compose run --rm ingestion`). Each app has its own Dockerfile (`apps/ingestion/Dockerfile`, `apps/dashboard/Dockerfile`).
- `.github/workflows/ingest.yml` runs the ingestion pipeline daily at 02:00 UTC (and on manual dispatch), then commits the updated `data/GhostPR.db` back to the repo with `[skip ci]`. The DB file is committed to git and updated by this job. Note: GitHub forbids `GITHUB_`-prefixed vars/secrets, so the target repo is passed via `vars.TARGET_OWNER` / `vars.TARGET_REPO` (mapped to `GITHUB_OWNER` / `GITHUB_REPO` at the step).
