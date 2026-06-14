---
name: run-ghostpr
description: run, start, launch, build, screenshot, test, verify, smoke-test the GhostPR dashboard or any service in this monorepo
---

GhostPR is a Windows-native monorepo (pnpm workspaces + Turborepo) with three runnable units: a Next.js 14 dashboard (port 3000), a STDIO MCP server, and a one-shot ingestion pipeline. All three share the same SQLite database at `data/GhostPR.db`. The project ships a bundled `node.exe` at `D:\GhostPR\node.exe` and a custom pnpm wrapper; these must be used instead of any system-wide `npm`/`pnpm`.

## Prerequisites

- Windows (project is Windows-native; `node.exe` + `pnpm` are bundled at `D:\GhostPR\`)
- `C:\Program Files\nodejs\node.exe` must exist (system Node.js — used for the dashboard)
- Database must be seeded: `data/GhostPR.db` must exist (run migration once if missing)

## Environment (required for every command)

Every PowerShell session that runs project code must set:

```powershell
$env:PATH = "D:\GhostPR;C:\Program Files\nodejs;" + $env:PATH
$env:NODE_OPTIONS = "--require D:\GhostPR\pnpm-preload.js"
$env:DATABASE_PATH = "D:\GhostPR\data\GhostPR.db"
$env:NODE_ENV = "development"
```

## Migration (run once, or to re-seed)

Stop the MCP server first (it has a 30 s periodic save that will clobber a fresh seed if left running). Then:

```powershell
# From D:\GhostPR
Set-Location D:\GhostPR
& "D:\GhostPR\node.exe" "packages/db/dist/migrate.js"
```

Expected output ends with:
```
✅ Schema applied
ℹ️  Database already has 8 decisions — skipping seed
```
(or `✅ Seeded 8 decisions` on first run / after deleting the DB file.)

## Run: dashboard (agent path — smoke script)

The smoke script launches the dashboard, polls until HTTP 200, then runs 5 endpoint checks.

```powershell
# From D:\GhostPR
$env:PATH = "D:\GhostPR;C:\Program Files\nodejs;" + $env:PATH
$env:NODE_OPTIONS = "--require D:\GhostPR\pnpm-preload.js"
$env:DATABASE_PATH = "D:\GhostPR\data\GhostPR.db"
$env:NODE_ENV = "development"

pwsh .claude\skills\run-ghostpr\smoke.ps1
```

The script exits 0 if all tests pass, 1 if any fail. It prints the PID so you can stop the server.

## Run: dashboard (manual)

```powershell
# From D:\GhostPR\apps\dashboard  ← must be this directory, not the workspace root
Set-Location D:\GhostPR\apps\dashboard
# Set env vars above first
Start-Process -NoNewWindow -FilePath "cmd.exe" `
  -ArgumentList "/c","node_modules\.bin\next.CMD","dev","-p","3000"
# Poll until ready:
#   Invoke-WebRequest http://localhost:3000 -UseBasicParsing
```

Then visit `http://localhost:3000`.

## Run: MCP server

```powershell
Set-Location D:\GhostPR
# Set env vars above first
& "D:\GhostPR\node.exe" "apps/mcp-server/dist/index.js"
```

Startup output on stderr:
```
🚀 GhostPR MCP Server starting...
📂 Database loaded: D:\GhostPR\data\GhostPR.db
📡 Connecting to STDIO transport...
✅ GhostPR MCP Server is running (STDIO mode)
```

The MCP server is also configured in `.mcp.json` — Claude Code connects to it automatically via `command: node`.

## Run: ingestion pipeline

Requires `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, and `GROQ_API_KEY` in `.env`. Copy `.env.example` first.

```powershell
Set-Location D:\GhostPR
# Set env vars above first
& "D:\GhostPR\node.exe" "apps/ingestion/dist/index.js"
```

## API smoke test (curl)

Once the dashboard is running:

```bash
# List all decisions (returns JSON array of 8)
curl http://localhost:3000/api/decisions

# Filter by status
curl "http://localhost:3000/api/decisions?status=active"
curl "http://localhost:3000/api/decisions?status=deprecated"

# Single decision
curl http://localhost:3000/api/decisions/a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5

# 404 on missing ID
curl -o /dev/null -w "%{http_code}" http://localhost:3000/api/decisions/00000000-0000-0000-0000-000000000000
```

## Gotchas

**`.bin/next` and `.bin/turbo` are bash shebang scripts.** Running them with `node` directly crashes with `SyntaxError: missing ) after argument list`. Always use the `.CMD` variants: `node_modules\.bin\next.CMD`, `node_modules\.bin\turbo.CMD`.

**Next.js must run from `apps/dashboard/`, not the workspace root.** Running from the root gives `Couldn't find any pages or app directory`. The `WorkingDirectory` in `Start-Process` must be `D:\GhostPR\apps\dashboard`.

**`turbo run dev` exits 134 due to `shared-types` crash.** The `tsc --watch` process in `packages/shared-types` hits a native Node.js assertion in `fsRealPathHandlingLongPath` when combined with `pnpm-preload.js`. Workaround: run the dashboard directly (as above) instead of through turbo. The dashboard itself works fine.

**Next.js stdout uses ANSI escape codes** — the `✓ Ready` line appears as raw bytes in log files. Don't try to grep it from a captured log; poll `http://localhost:3000` via HTTP instead.

**MCP server saves DB every 30 s.** If you run `pnpm migrate` while the MCP server is running, the server will skip the save if the file mtime is newer (the mtime-guard in `apps/mcp-server/src/index.ts`). To be safe, stop the MCP server first (`Stop-Process` its PID), migrate, then restart.

**`pnpm-preload.js` patches native fs bindings** to suppress EPERM errors. It must be loaded via `--require D:\GhostPR\pnpm-preload.js` (set in `NODE_OPTIONS`). Without it, pnpm operations on symlinked packages fail.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `SyntaxError: missing ) after argument list` on `.bin/next` | Use `next.CMD` not `next` |
| `Couldn't find any pages or app directory` | Run Next.js from `apps/dashboard/`, not workspace root |
| `node.exe not recognized` in pnpm.ps1 | System pnpm is being used instead of bundled one; add `D:\GhostPR` to the front of `$env:PATH` |
| `ERR_MODULE_NOT_FOUND` for sql.js WASM | Only happens in Docker; see `apps/ingestion/Dockerfile` for the `find/cp` fix |
| Dashboard returns empty decisions array | DB is missing or not seeded; run migration |
| MCP server: `❌ Database not found` | Run `node packages/db/dist/migrate.js` from workspace root first |
