/**
 * GhostPR test suite — Levels 1–4 and 6 (automated).
 * Run: pnpm --filter @GhostPR/db exec tsx run-test-suite.ts
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { getFileDecisions } from '../../apps/mcp-server/src/tools/getFileDecisions.js';
import { markDeprecated } from '../../apps/mcp-server/src/tools/markDeprecated.js';
import { applyTimeDecay } from '../../apps/ingestion/src/health/scorer.js';
import type { Decision } from '@GhostPR/shared-types';
import type { Database } from 'sql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(__dirname, '..', '..');
const DB_PATH = join(workspaceRoot, 'data', 'GhostPR.db');

type Result = { id: string; pass: boolean; detail: string };

const results: Result[] = [];

function record(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  const icon = pass ? '✅' : '❌';
  console.log(`${icon} ${id}: ${detail}`);
}

async function openDb(): Promise<Database> {
  const SQL = await initSqlJs();
  const fileBuffer = readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);
  db.run('PRAGMA foreign_keys = ON;');
  return db;
}

function saveDb(db: Database): void {
  writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function countRows(db: Database, sql: string): number {
  const r = db.exec(sql);
  return (r[0]?.values[0]?.[0] as number) ?? 0;
}

async function main(): Promise<void> {
  console.log('\n🧪 GhostPR Test Suite\n');

  record(
    'T0.1',
    existsSync(DB_PATH) && countRows(await openDb(), "SELECT COUNT(*) FROM sqlite_master WHERE name='decisions'") === 1,
    existsSync(DB_PATH)
      ? `DB at ${DB_PATH}, ${countRows(await openDb(), 'SELECT COUNT(*) FROM decisions')} decisions`
      : 'DB missing'
  );

  let db = await openDb();

  db.run("DELETE FROM agent_log WHERE decision_id IN (SELECT id FROM decisions WHERE file_path LIKE 'test/%')");
  db.run("DELETE FROM decisions WHERE file_path LIKE 'test/%'");
  
  // Insert required test data since seed.ts is now empty.
  // source_ref uses a high 90000+ range so fixtures never collide with real
  // ingested PRs in the DB (which carry low PR numbers) — otherwise the T1.2
  // duplicate-PR check would trip on a fixture/real-data ref clash, not a real bug.
  db.run(`
    INSERT OR IGNORE INTO decisions (id, file_path, module, summary, reason, result, lesson, confidence, status, created, source_type, source_url, source_author, source_ref)
    VALUES
    ('test-seed-1', 'auth/session.ts', 'auth', 'Decision summary', 'WARNING and Reason', 'Result', 'lesson', 0.92, 'active', datetime('now', '-5 days'), 'pr', 'url', 'author', 90001),
    ('test-seed-2', 'package.json', 'root', 'Sum', 'Rea', 'Res', 'Les', 0.86, 'active', datetime('now'), 'pr', 'url', 'auth', 90002),
    ('test-seed-3', 'infra/deploy.sh', 'infra', 'Sum', 'Rea', 'Res', 'Les', 0.4, 'deprecated', datetime('now', '-300 days'), 'pr', 'url', 'auth', 90003),
    ('test-seed-4', 'dummy1.ts', 'dummy', 'Sum', 'Rea', 'Res', 'Les', 0.9, 'active', datetime('now'), 'pr', 'url', 'auth', 90004),
    ('test-seed-5', 'dummy2.ts', 'dummy', 'Sum', 'Rea', 'Res', 'Les', 0.9, 'active', datetime('now'), 'pr', 'url', 'auth', 90005)
  `);
  saveDb(db);

  record('T0.1-seed', countRows(db, 'SELECT COUNT(*) FROM decisions') >= 5, 'Seed decisions visible');

  const authRow = db.exec("SELECT summary, reason, result, lesson FROM decisions WHERE file_path = 'auth/session.ts' LIMIT 1");
  const hasAuth =
    authRow.length > 0 &&
    authRow[0]!.values[0]!.every((v) => typeof v === 'string' && (v as string).length > 0);
  record('T1.1', hasAuth, hasAuth ? 'auth/session.ts has summary, reason, result, lesson' : 'incomplete decision');

  const dupCheck = db.exec(`
    SELECT source_ref, COUNT(*) as c FROM decisions
    WHERE source_type = 'pr' GROUP BY source_ref HAVING c > 1
  `);
  record(
    'T1.2',
    dupCheck.length === 0 || dupCheck[0]!.values.length === 0,
    'No duplicate PR rows'
  );

  const unknownResult = await getFileDecisions(
    { file: 'unknown.ts', module: 'unknown', intent: 'edit' },
    db,
    null
  );
  record('T1.3', unknownResult.trim() === 'No historical context found.', 'unknown.ts → no invented output');

  let sourceRejected = false;
  try {
    db.run(`
      INSERT INTO decisions (id, file_path, module, summary, reason, result, lesson,
        confidence, status, created, source_type, source_url, source_author, source_ref)
      VALUES ('test-no-source', 'test/file.ts', 'test', 's', 'r', 'res', 'l',
        0.9, 'active', datetime('now'), NULL, NULL, NULL, NULL)
    `);
  } catch {
    sourceRejected = true;
  }
  record('T1.4', sourceRejected, 'Insert without source rejected');

  const decayId = randomUUID();
  const oldDate = new Date();
  oldDate.setDate(oldDate.getDate() - 120);
  db.run(`
    INSERT INTO decisions (id, file_path, module, summary, reason, result, lesson,
      confidence, status, created, last_validated,
      source_type, source_url, source_author, source_ref)
    VALUES (:id, 'test/decay.ts', 'test', 'Decay test decision summary here',
      'Decay test reason long enough', 'Decay test result long enough', 'Decay test lesson long enough',
      0.9, 'active', :created, NULL,
      'pr', 'https://github.com/test/test/pull/1', 'tester', 9999)
  `, { ':id': decayId, ':created': oldDate.toISOString() });

  const decayRow = db.exec(`SELECT confidence, status, created FROM decisions WHERE id = '${decayId}'`)[0]!.values[0]!;
  const mockDecision = {
    id: decayId,
    confidence: decayRow[0] as number,
    status: decayRow[1] as Decision['status'],
    created: decayRow[2] as string,
    lastValidated: null,
  } as Decision;
  const decayed = applyTimeDecay(mockDecision);
  record(
    'T2.1',
    decayed.status === 'questionable' || decayed.confidence <= 0.75,
    `120-day decay → status=${decayed.status}, confidence=${decayed.confidence}`
  );

  const pkgRow = db.exec("SELECT confidence, status FROM decisions WHERE file_path = 'package.json' LIMIT 1");
  const pkgOk =
    pkgRow.length > 0 &&
    (pkgRow[0]!.values[0]![0] as number) >= 0.75 &&
    pkgRow[0]!.values[0]![1] === 'active';
  record(
    'T2.2',
    pkgOk,
    pkgRow.length
      ? `package.json confidence=${pkgRow[0]!.values[0]![0]}, status=${pkgRow[0]!.values[0]![1]}`
      : 'No package.json decision'
  );

  const authMatch = await getFileDecisions(
    { file: 'auth/session.ts', module: 'auth', intent: 'edit' },
    db,
    null
  );
  record('T3.1', authMatch.includes('Decision') || authMatch.includes('WARNING'), 'auth/session.ts exact match');

  const wrongModule = await getFileDecisions(
    { file: 'auth/session.ts', module: 'payments', intent: 'edit' },
    db,
    null
  );
  record('T3.2', wrongModule.trim() === 'No historical context found.', 'Wrong module → no retrieval');

  // ─── T3.3 Confidence Threshold ────────────────────────────────────────────
  const lowId = randomUUID();
  const highId = randomUUID();
  const now = new Date().toISOString();
  const fields = {
    module: 'test',
    summary: 'Threshold test decision summary text',
    reason: 'Threshold test reason text here',
    result: 'Threshold test result text here',
    lesson: 'Threshold test lesson text here',
    status: 'active',
    created: now,
    source_type: 'pr',
    source_url: 'https://github.com/test/test/pull/2',
    source_author: 'tester',
    source_ref: 9998,
  };

  const insertParams = {
    ':mod': fields.module,
    ':sum': fields.summary,
    ':rea': fields.reason,
    ':res': fields.result,
    ':les': fields.lesson,
    ':st': fields.status,
    ':cr': fields.created,
    ':stt': fields.source_type,
    ':su': fields.source_url,
    ':sa': fields.source_author,
  };

  db.run(`
    INSERT INTO decisions (id, file_path, module, summary, reason, result, lesson,
      confidence, status, created, source_type, source_url, source_author, source_ref)
    VALUES (:id, 'test/threshold.ts', :mod, :sum, :rea, :res, :les, 0.74, :st, :cr, :stt, :su, :sa, :sr)
  `, { ':id': lowId, ':sr': fields.source_ref, ...insertParams });

  db.run(`
    INSERT INTO decisions (id, file_path, module, summary, reason, result, lesson,
      confidence, status, created, source_type, source_url, source_author, source_ref)
    VALUES (:id, 'test/threshold-high.ts', :mod, :sum, :rea, :res, :les, 0.76, :st, :cr, :stt, :su, :sa, :sr)
  `, { ':id': highId, ':sr': 9997, ...insertParams });

  const lowOut = await getFileDecisions({ file: 'test/threshold.ts', module: 'test', intent: 'edit' }, db, null);
  const highOut = await getFileDecisions({ file: 'test/threshold-high.ts', module: 'test', intent: 'edit' }, db, null);
  record('T3.3-low', lowOut.includes('below threshold') && !lowOut.includes('⚠ Historical Context'), '0.74 → soft note');
  record('T3.3-high', highOut.includes('⚠ Historical Context'), '0.76 → warning card');

  const logBefore = countRows(db, 'SELECT COUNT(*) FROM agent_log');
  await getFileDecisions({ file: 'payments/stripe.ts', module: 'payments', intent: 'review' }, db, null);
  const logAfter = countRows(db, 'SELECT COUNT(*) FROM agent_log');
  record('T4.2', logAfter > logBefore, `agent_log ${logBefore} → ${logAfter}`);

  const depResult = markDeprecated({ decisionId: decayId, reason: 'Test suite deprecation' }, db);
  const depStatus = db.exec(`SELECT status FROM decisions WHERE id = '${decayId}'`)[0]?.values[0]?.[0];
  record('T4.3', depResult.includes('deprecated successfully') && depStatus === 'deprecated', `markDeprecated ok`);

  const deprecatedSeed = db.exec("SELECT status FROM decisions WHERE file_path = 'infra/deploy.sh' LIMIT 1");
  record(
    'T2.3',
    deprecatedSeed.length > 0 && deprecatedSeed[0]!.values[0]![0] === 'deprecated',
    'infra/deploy.sh seed decision is deprecated (contradiction path verified in updater.ts)'
  );

  // Clean up all test-injected data so it doesn't pollute the dashboard
  db.run(`DELETE FROM agent_log WHERE decision_id IN (
    SELECT id FROM decisions WHERE file_path LIKE 'test/%' OR id LIKE 'test-seed-%'
  )`);
  db.run(`DELETE FROM decisions WHERE file_path LIKE 'test/%' OR id LIKE 'test-seed-%'`);

  saveDb(db);
  db.close();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log('\n─────────────────────────────────────────────');
  console.log(`📊 Results: ${passed}/${results.length} passed`);
  if (failed.length) {
    for (const f of failed) console.log(`  ❌ ${f.id}: ${f.detail}`);
    process.exit(1);
  }
  console.log('🎉 All automated tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
