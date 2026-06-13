import initSqlJs from 'sql.js';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';

let dbInstance: any = null;
let cachedMtime: number = 0;

function findWorkspaceRoot(): string {
  const startDir = process.cwd();
  let dir = startDir;
  while (dir && dir !== dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return startDir;
}

export async function getDb() {
  const workspaceRoot = findWorkspaceRoot();
  const envDbPath = process.env.DATABASE_PATH || './data/GhostPR.db';
  const dbPath = envDbPath.startsWith('.') ? join(workspaceRoot, envDbPath) : envDbPath;

  if (!existsSync(dbPath)) {
    throw new Error(`Database file not found at: ${dbPath}. Please run migration first.`);
  }

  const stats = statSync(dbPath);
  const mtime = stats.mtimeMs;

  if (dbInstance && mtime <= cachedMtime) {
    return dbInstance;
  }

  // sql.js is loaded as CommonJS external, so its __dirname is correct
  // and it can locate sql-wasm.wasm in its own dist/ directory automatically
  const SQL = await initSqlJs();

  const fileBuffer = readFileSync(dbPath);
  dbInstance = new SQL.Database(fileBuffer);
  dbInstance.run('PRAGMA foreign_keys = ON;');
  cachedMtime = mtime;

  return dbInstance;
}
