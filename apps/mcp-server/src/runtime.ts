/**
 * runtime.ts — Shared bootstrap for GhostPR MCP Server (STDIO & HTTP)
 *
 * Loads .env from workspace root, opens SQLite via sql.js, optionally
 * connects Hindsight, and manages periodic disk flushes with mtime protection.
 */

import { readFileSync, existsSync, writeFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';
import dotenv from 'dotenv';
import type { Database } from 'sql.js';

import { HindsightClient } from './memory/hindsightClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  while (dir && dir !== dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return join(startDir, '..', '..', '..');
}

export interface McpRuntime {
  db: Database;
  hindsight: HindsightClient | null;
  workspaceRoot: string;
  databasePath: string;
  onBeforeShutdown: (hook: () => Promise<void> | void) => void;
  shutdown: (signal?: string) => Promise<void>;
}

let lastWrittenMtime = 0;

function resolveDbPath(workspaceRoot: string, dbPath: string): string {
  return dbPath.startsWith('.') ? join(workspaceRoot, dbPath) : dbPath;
}

async function openDatabase(workspaceRoot: string, dbPath: string): Promise<Database> {
  const SQL = await initSqlJs();
  const absolutePath = resolveDbPath(workspaceRoot, dbPath);

  if (!existsSync(absolutePath)) {
    console.error(`❌ Database not found at: ${absolutePath}`);
    console.error(`   Please run "pnpm run migrate" first.`);
    process.exit(1);
  }

  try {
    const fileBuffer = readFileSync(absolutePath);
    const db = new SQL.Database(fileBuffer);

    try {
      db.exec('SELECT 1 FROM decisions LIMIT 1');
    } catch {
      console.error(`❌ Database is not initialized (missing 'decisions' table).`);
      console.error(`   Run "pnpm run migrate" to apply the schema.`);
      db.close();
      process.exit(1);
    }

    db.run('PRAGMA foreign_keys = ON');
    lastWrittenMtime = statSync(absolutePath).mtimeMs;
    console.error(`📂 Database loaded: ${absolutePath}`);
    return db;
  } catch (err) {
    console.error(`❌ Failed to read database:`, err);
    process.exit(1);
  }
}

function saveDatabase(workspaceRoot: string, db: Database, dbPath: string): void {
  const absolutePath = resolveDbPath(workspaceRoot, dbPath);

  if (existsSync(absolutePath)) {
    const fileMtime = statSync(absolutePath).mtimeMs;
    if (fileMtime > lastWrittenMtime && lastWrittenMtime > 0) {
      console.error(`⚠ DB file changed externally (mtime ${fileMtime} > ${lastWrittenMtime}) — skipping save to avoid clobber`);
      return;
    }
  }

  const data = db.export();
  writeFileSync(absolutePath, Buffer.from(data));
  lastWrittenMtime = statSync(absolutePath).mtimeMs;
  console.error(`💾 Database saved: ${absolutePath}`);
}

export async function initRuntime(): Promise<McpRuntime> {
  const workspaceRoot = findWorkspaceRoot(__dirname);
  dotenv.config({ path: join(workspaceRoot, '.env') });

  const databasePath = process.env['DATABASE_PATH'] ?? './data/GhostPR.db';
  const hindsightApiKey = process.env['HINDSIGHT_API_KEY'];
  const hindsightBankUrl = process.env['HINDSIGHT_BANK_URL'];
  const hasHindsight = !!(hindsightApiKey && hindsightBankUrl);

  console.error('');
  console.error('🚀 GhostPR MCP Server starting...');
  console.error(`   Workspace: ${workspaceRoot}`);
  console.error(`   Database:  ${databasePath}`);
  console.error(`   Hindsight: ${hasHindsight ? 'connected' : 'not configured'}`);
  console.error('');

  const db = await openDatabase(workspaceRoot, databasePath);

  let hindsight: HindsightClient | null = null;
  if (hasHindsight) {
    try {
      hindsight = new HindsightClient({
        bankUrl: hindsightBankUrl!,
        apiKey: hindsightApiKey!,
      });
      console.error('☁ Hindsight client initialized');
    } catch (err) {
      console.error('⚠ Hindsight client failed to initialize:', err);
      console.error('  Continuing with SQLite-only mode');
    }
  }

  const saveInterval = setInterval(() => {
    try {
      saveDatabase(workspaceRoot, db, databasePath);
    } catch (err) {
      console.error('⚠ Periodic DB save failed:', err);
    }
  }, 30_000);

  const beforeShutdownHooks: Array<() => Promise<void> | void> = [];
  let closed = false;

  const shutdown = async (signal?: string): Promise<void> => {
    if (closed) return;
    closed = true;
    clearInterval(saveInterval);

    for (const hook of beforeShutdownHooks) {
      try {
        await hook();
      } catch (err) {
        console.error('⚠ Shutdown hook failed:', err);
      }
    }

    try {
      saveDatabase(workspaceRoot, db, databasePath);
    } catch (err) {
      console.error('⚠ Final DB save failed:', err);
    }
    db.close();
    console.error(`🛑 GhostPR MCP Server stopped${signal ? ` (${signal})` : ''}`);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT').finally(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM').finally(() => process.exit(0));
  });

  return {
    db,
    hindsight,
    workspaceRoot,
    databasePath,
    onBeforeShutdown: (hook) => {
      beforeShutdownHooks.push(hook);
    },
    shutdown,
  };
}
