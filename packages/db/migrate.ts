import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { seedDecisions, seedAgentLogs } from './seed.js';

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

// Manually parse .env from workspace root if it exists, to get DATABASE_PATH
const envPath = join(workspaceRoot, '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      const cleanVal = val.replace(/^["']|["']$/g, '');
      process.env[key] = cleanVal;
    }
  }
}

// Database path from environment, or fallback to root data/GhostPR.db
const rawDbPath = process.env['DATABASE_PATH'] ?? './data/GhostPR.db';
const DB_PATH = rawDbPath.startsWith('.')
  ? join(workspaceRoot, rawDbPath)
  : rawDbPath;

// schema.sql is next to the source file (packages/db/) but not copied into dist/
// when running compiled output, look one directory up
const SCHEMA_PATH = existsSync(join(__dirname, 'schema.sql'))
  ? join(__dirname, 'schema.sql')
  : join(__dirname, '..', 'schema.sql');

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function run(): Promise<void> {
  console.log('📦 GhostPR DB migrate');
  console.log(`   Target: ${DB_PATH}`);

  // Ensure the data/ directory exists
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`   Created directory: ${dataDir}`);
  }

  // Initialize sql.js (pure WASM SQLite — no native compilation needed)
  const SQL = await initSqlJs();

  // Load existing DB from disk, or create fresh
  let db: InstanceType<typeof SQL.Database>;
  if (existsSync(DB_PATH)) {
    const fileBuffer = readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('   Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('   Created new database');
  }

  // Enable WAL-equivalent (sql.js uses in-memory, we persist manually at end)
  db.run('PRAGMA foreign_keys = ON;');

  // Run schema
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  db.run(schema);
  console.log('✅ Schema applied');

  // Migration: make agent_log.decision_id nullable if it currently has NOT NULL
  const tableInfo = db.exec("PRAGMA table_info(agent_log)");
  if (tableInfo.length > 0) {
    const decisionIdCol = tableInfo[0]!.values.find((r) => r[1] === 'decision_id');
    if (decisionIdCol && decisionIdCol[3] === 1) {
      db.run(`CREATE TABLE agent_log_new (
        id          TEXT PRIMARY KEY,
        decision_id TEXT REFERENCES decisions(id) ON DELETE CASCADE,
        action      TEXT NOT NULL,
        timestamp   TEXT NOT NULL,
        result      TEXT NOT NULL
      )`);
      db.run(`INSERT INTO agent_log_new SELECT * FROM agent_log`);
      db.run(`DROP TABLE agent_log`);
      db.run(`ALTER TABLE agent_log_new RENAME TO agent_log`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_agent_log_decision ON agent_log(decision_id)`);
      console.log('✅ Migrated agent_log.decision_id to nullable');
    }
  }

  // Check if already seeded
  const countResult = db.exec('SELECT COUNT(*) as count FROM decisions');
  const existingCount = countResult[0]?.values[0]?.[0] as number ?? 0;

  if (existingCount > 0) {
    console.log(`ℹ️  Database already has ${existingCount} decisions — skipping seed`);
    // Persist and exit
    const data = db.export();
    writeFileSync(DB_PATH, Buffer.from(data));
    db.close();
    return;
  }

  // Insert seed decisions
  const insertStmt = db.prepare(`
    INSERT INTO decisions (
      id, file_path, module, summary, reason, result, lesson,
      confidence, status, created, last_validated,
      source_type, source_url, source_author, source_ref
    ) VALUES (
      :id, :filePath, :module, :summary, :reason, :result, :lesson,
      :confidence, :status, :created, :lastValidated,
      :sourceType, :sourceUrl, :sourceAuthor, :sourceRef
    )
  `);

  for (const d of seedDecisions) {
    insertStmt.run({
      ':id': d.id,
      ':filePath': d.filePath,
      ':module': d.module,
      ':summary': d.summary,
      ':reason': d.reason,
      ':result': d.result,
      ':lesson': d.lesson,
      ':confidence': d.confidence,
      ':status': d.status,
      ':created': d.created,
      ':lastValidated': d.lastValidated ?? null,
      ':sourceType': d.source.type,
      ':sourceUrl': d.source.url,
      ':sourceAuthor': d.source.author,
      ':sourceRef': d.source.refNumber,
    });
  }
  insertStmt.free();

  console.log(`✅ Seeded ${seedDecisions.length} decisions`);

  // Insert seed agent logs
  const logStmt = db.prepare(`
    INSERT INTO agent_log (id, decision_id, action, timestamp, result)
    VALUES (:id, :decisionId, :action, :timestamp, :result)
  `);

  for (const log of seedAgentLogs) {
    logStmt.run({
      ':id': log.id,
      ':decisionId': log.decisionId,
      ':action': log.action,
      ':timestamp': log.timestamp,
      ':result': log.result,
    });
  }
  logStmt.free();

  console.log(`✅ Seeded ${seedAgentLogs.length} agent log entries`);

  // Verify: print summary
  const rows = db.exec(
    'SELECT id, file_path, status, confidence FROM decisions ORDER BY created DESC'
  );

  console.log('\n📋 Decisions in database:');
  if (rows[0]) {
    for (const row of rows[0].values) {
      const [id, filePath, status, confidence] = row as [string, string, string, number];
      const icon =
        status === 'active' ? '✅' : status === 'questionable' ? '⚠️ ' : '🔴';
      console.log(
        `  ${icon} [${status.padEnd(12)}] ${(filePath as string).padEnd(28)} confidence: ${confidence}`
      );
    }
  }

  // Persist database to disk (sql.js is in-memory — must export to save)
  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data));
  db.close();

  console.log('\n🎉 Migration complete — data/GhostPR.db is ready');
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
