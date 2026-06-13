import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  while (dir && dir !== dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return join(startDir, '..', '..');
}

const workspaceRoot = findWorkspaceRoot(__dirname);

async function main() {
  const SQL = await initSqlJs();
  const dbPath = join(workspaceRoot, 'data', 'GhostPR.db');
  
  try {
    const fileBuffer = readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    db.run(`
      UPDATE decisions
      SET created = '2025-01-01T00:00:00Z', confidence = 0.5, status = 'questionable'
      WHERE file_path = 'package.json'
    `);

    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
    db.close();

    console.log('✅ Successfully updated package.json decision in SQLite to created = 2025-01-01, confidence = 0.5, status = questionable');
    console.log('Now run "pnpm run ingest" to verify the signal scanner!');
  } catch (err) {
    console.error('❌ Failed to update decision:', err);
  }
}

main();
