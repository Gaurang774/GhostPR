/**
 * index.ts — MCP Server STDIO entry point
 *
 * Usage: pnpm run mcp  (from repo root)
 *   or:  pnpm run start (from apps/mcp-server/)
 *
 * Flow:
 *   1. Load .env from workspace root
 *   2. Open existing SQLite database (read-only access)
 *   3. Optionally connect to Hindsight for semantic recall
 *   4. Create McpServer with registered tools
 *   5. Connect via StdioServerTransport (JSON-RPC over stdin/stdout)
 *
 * IMPORTANT: All logging goes to stderr (console.error).
 * stdout is reserved for MCP JSON-RPC protocol messages.
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';
import dotenv from 'dotenv';
import type { Database } from 'sql.js';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { HindsightClient } from './memory/hindsightClient.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

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

const workspaceRoot = findWorkspaceRoot(__dirname);
const envPath = join(workspaceRoot, '.env');
dotenv.config({ path: envPath });

// ─── Config ───────────────────────────────────────────────────────────────────

const DATABASE_PATH = process.env['DATABASE_PATH'] ?? './data/GhostPR.db';

// Optional Hindsight config
const HINDSIGHT_API_KEY = process.env['HINDSIGHT_API_KEY'];
const HINDSIGHT_BANK_URL = process.env['HINDSIGHT_BANK_URL'];
const hasHindsight = !!(HINDSIGHT_API_KEY && HINDSIGHT_BANK_URL);

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function openDatabase(dbPath: string): Promise<Database> {
  const SQL = await initSqlJs();

  const absolutePath = dbPath.startsWith('.')
    ? join(workspaceRoot, dbPath)
    : dbPath;

  if (!existsSync(absolutePath)) {
    console.error(`❌ Database not found at: ${absolutePath}`);
    console.error(`   Please run "pnpm run migrate" first.`);
    process.exit(1);
  }

  try {
    const fileBuffer = readFileSync(absolutePath);
    const db = new SQL.Database(fileBuffer);

    // Verify schema is initialized
    try {
      db.exec('SELECT 1 FROM decisions LIMIT 1');
    } catch {
      console.error(`❌ Database is not initialized (missing 'decisions' table).`);
      console.error(`   Run "pnpm run migrate" to apply the schema.`);
      db.close();
      process.exit(1);
    }

    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON');

    console.error(`📂 Database loaded: ${absolutePath}`);
    return db;
  } catch (err) {
    console.error(`❌ Failed to read database:`, err);
    process.exit(1);
  }
}

function saveDatabase(db: Database, dbPath: string): void {
  const absolutePath = dbPath.startsWith('.')
    ? join(workspaceRoot, dbPath)
    : dbPath;
  const data = db.export();
  writeFileSync(absolutePath, Buffer.from(data));
  console.error(`💾 Database saved: ${absolutePath}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.error('');
  console.error('🚀 GhostPR MCP Server starting...');
  console.error(`   Workspace: ${workspaceRoot}`);
  console.error(`   Database:  ${DATABASE_PATH}`);
  console.error(`   Hindsight: ${hasHindsight ? 'connected' : 'not configured'}`);
  console.error('');

  // 1. Open database
  const db = await openDatabase(DATABASE_PATH);

  // 2. Optionally create Hindsight client
  let hindsight: HindsightClient | null = null;
  if (hasHindsight) {
    try {
      hindsight = new HindsightClient({
        bankUrl: HINDSIGHT_BANK_URL!,
        apiKey: HINDSIGHT_API_KEY!,
      });
      console.error('☁ Hindsight client initialized');
    } catch (err) {
      console.error('⚠ Hindsight client failed to initialize:', err);
      console.error('  Continuing with SQLite-only mode');
    }
  }

  // 3. Create MCP server with tools
  const server = createServer({ db, hindsight });

  // 4. Set up periodic DB saves (sql.js is in-memory, writes need explicit flush)
  // Save DB periodically to avoid data loss (every 30 seconds)
  const saveInterval = setInterval(() => {
    try {
      saveDatabase(db, DATABASE_PATH);
    } catch (err) {
      console.error('⚠ Periodic DB save failed:', err);
    }
  }, 30_000);

  // Clean up on process exit
  process.on('SIGINT', () => {
    clearInterval(saveInterval);
    saveDatabase(db, DATABASE_PATH);
    db.close();
    console.error('🛑 GhostPR MCP Server stopped (SIGINT)');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    clearInterval(saveInterval);
    saveDatabase(db, DATABASE_PATH);
    db.close();
    console.error('🛑 GhostPR MCP Server stopped (SIGTERM)');
    process.exit(0);
  });

  // 5. Connect via STDIO transport
  const transport = new StdioServerTransport();

  console.error('📡 Connecting to STDIO transport...');
  await server.connect(transport);
  console.error('✅ GhostPR MCP Server is running (STDIO mode)');
  console.error('   Waiting for JSON-RPC messages on stdin...');
  console.error('');
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
