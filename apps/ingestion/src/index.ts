/**
 * index.ts — Ingestion CLI entry point
 *
 * Usage: pnpm run ingest
 *
 * Flow:
 *   1. Load .env and validate required vars
 *   2. Open existing SQLite DB (data/GhostPR.db)
 *   3. Fetch last N merged PRs from GitHub
 *   4. For each PR:
 *      a. Skip if PR already in DB (idempotent)
 *      b. Extract decision via Groq
 *      c. Skip if no decision found
 *      d. Insert into decisions table
 *   5. Apply time-decay to ALL existing decisions
 *   6. Save DB to disk
 *   7. Print summary
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';
import dotenv from 'dotenv';
import type { Database } from 'sql.js';
import type { Decision } from '@GhostPR/shared-types';

import { fetchMergedPRs } from './github/prFetcher.js';
import { extractDecision } from './extractor/decisionExtractor.js';
import { applyTimeDecay } from './health/scorer.js';
import { scanPRForSignals } from './health/updater.js';
import { HindsightClient } from './memory/hindsightClient.js';
import { embedDecision } from './embeddings/embedder.js';

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

// ─── Env validation ───────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    console.error(`❌ Missing required environment variable: ${name}`);
    console.error(`   Copy .env.example to .env and fill in your values.`);
    process.exit(1);
  }
  return value.trim();
}

const GITHUB_TOKEN = requireEnv('GITHUB_TOKEN');
const GITHUB_OWNER = requireEnv('GITHUB_OWNER');
const GITHUB_REPO = requireEnv('GITHUB_REPO');
const GROQ_API_KEY = requireEnv('GROQ_API_KEY'); // Validates it exists for groqClient.ts
void GROQ_API_KEY; // Used by groqClient.ts via process.env — suppress unused warning

const DATABASE_PATH = process.env['DATABASE_PATH'] ?? './data/GhostPR.db';
const PR_LIMIT = parseInt(process.env['PR_LIMIT'] ?? '20', 10);

// Optional Hindsight config (Phase 3)
const HINDSIGHT_API_KEY = process.env['HINDSIGHT_API_KEY'];
const HINDSIGHT_BANK_URL = process.env['HINDSIGHT_BANK_URL'];
const hasHindsight = !!(HINDSIGHT_API_KEY && HINDSIGHT_BANK_URL);

let hindsightClient: HindsightClient | null = null;
if (hasHindsight) {
  hindsightClient = new HindsightClient({
    bankUrl: HINDSIGHT_BANK_URL!,
    apiKey: HINDSIGHT_API_KEY!,
  });
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Load or create the SQLite database.
 * sql.js works entirely in memory; the file is loaded at start and saved at end.
 */
async function openDatabase(dbPath: string): Promise<Database> {
  const SQL = await initSqlJs();

  // Resolve db path relative to workspace root
  const absolutePath = dbPath.startsWith('.')
    ? join(workspaceRoot, dbPath)
    : dbPath;

  if (!existsSync(absolutePath)) {
    console.error(`❌ Database not found at: ${absolutePath}`);
    console.error(`   Please run "pnpm run migrate" first to initialize the database schema and seed data.`);
    process.exit(1);
  }

  try {
    const fileBuffer = readFileSync(absolutePath);
    const db = new SQL.Database(fileBuffer);

    // Verify database schema is initialized
    try {
      db.exec("SELECT 1 FROM decisions LIMIT 1");
    } catch {
      console.error(`❌ Database at ${absolutePath} is not initialized (missing 'decisions' table).`);
      console.error(`   Please run "pnpm run migrate" to apply the database schema.`);
      db.close();
      process.exit(1);
    }

    console.log(`📂 Opened existing database: ${absolutePath}`);
    return db;
  } catch (err) {
    console.error(`❌ Failed to read database at ${absolutePath}:`, err);
    process.exit(1);
  }
}

function saveDatabase(db: Database, dbPath: string): void {
  const absolutePath = dbPath.startsWith('.')
    ? join(workspaceRoot, dbPath)
    : dbPath;
  const data = db.export();
  writeFileSync(absolutePath, Buffer.from(data));
  console.log(`💾 Database saved: ${absolutePath}`);
}

// ─── Decision existence check ─────────────────────────────────────────────────

function prAlreadyIngested(db: Database, prNumber: number): boolean {
  const result = db.exec(
    `SELECT id FROM decisions WHERE source_type = 'pr' AND source_ref = ${prNumber} LIMIT 1`
  );
  return result.length > 0 && result[0]!.values.length > 0;
}

// ─── Decision insert ──────────────────────────────────────────────────────────

function insertDecision(db: Database, decision: Decision, embedding: number[] | null): void {
  const stmt = db.prepare(`
    INSERT INTO decisions (
      id, file_path, module, summary, reason, result, lesson,
      confidence, status, created, last_validated,
      source_type, source_url, source_author, source_ref, embedding
    ) VALUES (
      :id, :filePath, :module, :summary, :reason, :result, :lesson,
      :confidence, :status, :created, :lastValidated,
      :sourceType, :sourceUrl, :sourceAuthor, :sourceRef, :embedding
    )
  `);

  stmt.run({
    ':id': decision.id,
    ':filePath': decision.filePath,
    ':module': decision.module,
    ':summary': decision.summary,
    ':reason': decision.reason,
    ':result': decision.result,
    ':lesson': decision.lesson,
    ':confidence': decision.confidence,
    ':status': decision.status,
    ':created': decision.created,
    ':lastValidated': decision.lastValidated ?? null,
    ':sourceType': decision.source.type,
    ':sourceUrl': decision.source.url,
    ':sourceAuthor': decision.source.author,
    ':sourceRef': decision.source.refNumber,
    ':embedding': embedding ? JSON.stringify(embedding) : null,
  });

  stmt.free();
}

// ─── Time-decay updater ───────────────────────────────────────────────────────

/**
 * Re-scores ALL decisions in the DB for time decay.
 * Called at the end of every ingest run to keep health statuses current.
 */
function updateAllDecayScores(db: Database): number {
  const rows = db.exec(`
    SELECT id, confidence, status, created, last_validated
    FROM decisions
  `);

  if (rows.length === 0 || rows[0]!.values.length === 0) return 0;

  const updateStmt = db.prepare(`
    UPDATE decisions SET confidence = :confidence, status = :status WHERE id = :id
  `);

  let updated = 0;

  for (const row of rows[0]!.values) {
    const [id, confidence, status, created, lastValidated] = row as [string, number, string, string, string | null];

    // Build a minimal Decision-like object for the scorer
    const mockDecision = {
      id,
      confidence,
      status: status as Decision['status'],
      created,
      lastValidated: lastValidated ?? null,
    } as Decision;

    const { confidence: newConf, status: newStatus } = applyTimeDecay(mockDecision);

    if (newConf !== confidence || newStatus !== status) {
      updateStmt.run({
        ':confidence': newConf,
        ':status': newStatus,
        ':id': id,
      });
      updated++;
    }
  }

  updateStmt.free();
  return updated;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log('🚀 GhostPR Ingestion Pipeline');
  console.log(`   Repo:  ${GITHUB_OWNER}/${GITHUB_REPO}`);
  console.log(`   Limit: ${PR_LIMIT} merged PRs`);
  console.log('');

  // 1. Open DB
  const db = await openDatabase(DATABASE_PATH);

  // 2. Fetch PRs
  let prs;
  try {
    prs = await fetchMergedPRs({
      token: GITHUB_TOKEN,
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      limit: PR_LIMIT,
    });
  } catch (err) {
    console.error('❌ GitHub fetch failed:', err);
    db.close();
    process.exit(1);
  }

  if (prs.length === 0) {
    console.log('ℹ No merged PRs found. Nothing to ingest.');
    db.close();
    return;
  }

  // 3. Process each PR (oldest first for chronological correctness)
  console.log('');
  console.log('🔍 Processing PRs chronologically...');
  console.log('');

  const chronologicalPRs = [...prs].reverse();

  let skippedExisting = 0;
  let skippedNoDecision = 0;
  let inserted = 0;
  let errors = 0;
  let totalRevalidated = 0;
  let totalDeprecated = 0;

  for (const pr of chronologicalPRs) {
    const alreadyIngested = prAlreadyIngested(db, pr.number);

    if (alreadyIngested) {
      console.log(`   ⏭ PR #${pr.number}: already in database — skipping extraction`);
      skippedExisting++;
    } else {
      console.log(`   🔎 PR #${pr.number}: "${pr.title}"`);

      // Extract decision
      let decision;
      try {
        decision = await extractDecision(pr);
      } catch (err) {
        console.warn(`   ⚠ PR #${pr.number}: extraction threw unexpectedly:`, err);
        errors++;
        continue;
      }

      // No decision found
      if (!decision) {
        console.log(`   ⬜ PR #${pr.number}: no architectural decision found`);
        skippedNoDecision++;
      } else {
        // Generate the semantic-search embedding. Non-fatal: if the model fails
        // to load, we still store the decision (embedding stays NULL — exact
        // match still works, only semantic fallback is unavailable for it).
        let embedding: number[] | null = null;
        try {
          embedding = await embedDecision(decision);
        } catch (embErr) {
          console.warn(`   ⚠ PR #${pr.number}: embedding generation failed (storing without it):`, embErr);
        }

        // Insert into DB
        try {
          insertDecision(db, decision, embedding);
          console.log(`   ✅ PR #${pr.number}: decision stored → "${decision.summary.slice(0, 60)}..."`);
          console.log(`      File: ${decision.filePath} | Module: ${decision.module} | Confidence: ${decision.confidence}`);
          inserted++;

          // Sync to Hindsight remote memory (Phase 3)
          if (hindsightClient) {
            try {
              const content = `Decision: ${decision.summary}\nReason: ${decision.reason}\nOutcome: ${decision.result}\nLesson: ${decision.lesson}`;
              await hindsightClient.retain(content, {
                filePath: decision.filePath,
                module: decision.module,
                id: decision.id,
                sourceUrl: decision.source.url,
                author: decision.source.author,
                refNumber: String(decision.source.refNumber)
              }, [decision.module, 'decision']);
              console.log(`      ☁ Synced decision to Hindsight`);
            } catch (hindsightErr) {
              console.warn(`      ⚠ Failed to sync to Hindsight:`, hindsightErr);
            }
          }
        } catch (err) {
          console.warn(`   ❌ PR #${pr.number}: DB insert failed:`, err);
          errors++;
        }
      }
    }

    // Run signal scanner on the PR (against older decisions)
    try {
      const { revalidatedCount, deprecatedCount } = await scanPRForSignals(db, pr);
      totalRevalidated += revalidatedCount;
      totalDeprecated += deprecatedCount;
    } catch (err) {
      console.warn(`   ⚠ PR #${pr.number}: signal scanning failed:`, err);
    }
  }

  // 4. Apply time-decay to all existing decisions
  console.log('');
  console.log('⏳ Applying time-decay scores to all decisions...');
  const decayUpdated = updateAllDecayScores(db);
  console.log(`   Updated ${decayUpdated} decision(s) with fresh decay scores`);

  // 5. Save DB to disk
  console.log('');
  saveDatabase(db, DATABASE_PATH);
  db.close();

  // 6. Summary
  console.log('');
  console.log('─────────────────────────────────────────────');
  console.log('📊 Ingestion Summary');
  console.log(`   PRs fetched:         ${prs.length}`);
  console.log(`   Decisions inserted:  ${inserted}`);
  console.log(`   Already existed:     ${skippedExisting}`);
  console.log(`   No decision found:   ${skippedNoDecision}`);
  console.log(`   Errors:              ${errors}`);
  console.log(`   Decay updates:       ${decayUpdated}`);
  console.log(`   Signals revalidated: ${totalRevalidated}`);
  console.log(`   Signals deprecated:  ${totalDeprecated}`);
  console.log('─────────────────────────────────────────────');
  console.log('');

  if (inserted > 0) {
    console.log(`🎉 ${inserted} new decision(s) written to SQLite.`);
  } else {
    console.log('ℹ No new decisions were stored this run.');
  }

  console.log('');
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
