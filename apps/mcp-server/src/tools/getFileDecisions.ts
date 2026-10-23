/**
 * getFileDecisions.ts — MCP Tool: Retrieve decisions for a file
 *
 * Rules enforced:
 *   Rule 1  — No memory found → "No historical context found." (never invent)
 *   Rule 4  — Warning card only at confidence > 0.75; soft note below
 *   Rule 10 — Requires file + module + intent (Zod enforced)
 *   Rule 11 — Explain before warning (reason surfaces first)
 *   Rule 13 — Log 'retrieved' action to agent_log
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from 'sql.js';
import type { WarningCard, HealthStatus, DecisionSource } from '@GhostPR/shared-types';
import type { HindsightClient } from '../memory/hindsightClient.js';
import { embedText, cosineSimilarity } from '../embeddings/embedder.js';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
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
  return join(startDir, '..', '..', '..');
}

const workspaceRoot = findWorkspaceRoot(__dirname);

function normalizeFilePath(filePath: string): string {
  let normalized = filePath.replace(/\\/g, '/');
  const rootNormalized = workspaceRoot.replace(/\\/g, '/');
  if (normalized.startsWith(rootNormalized)) {
    normalized = normalized.slice(rootNormalized.length);
  }
  if (normalized.startsWith('/')) {
    normalized = normalized.slice(1);
  }
  return normalized;
}

// ─── Input Schema (Rule 10) ──────────────────────────────────────────────────

export const GetFileDecisionsInputSchema = z.object({
  file: z.string().min(1, 'file path is required'),
  module: z.string().min(1, 'module name is required'),
  intent: z.string().min(1, 'intent is required (e.g. "edit", "review", "refactor")'),
});

export type GetFileDecisionsInput = z.infer<typeof GetFileDecisionsInputSchema>;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecisionRow {
  id: string;
  file_path: string;
  module: string;
  summary: string;
  reason: string;
  result: string;
  lesson: string;
  confidence: number;
  status: string;
  source_type: string;
  source_url: string;
  source_author: string;
  source_ref: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.75;
// Cosine cutoff for the semantic fallback. The stored fingerprint embeds
// file+module+summary+reason while the query is only file+module, so matches
// for a renamed/moved file land in a moderate range — tune if false positives
// or misses appear.
const SEMANTIC_SIMILARITY_THRESHOLD = 0.5;
const SEMANTIC_MAX_RESULTS = 3;

// Column order shared by the exact-match and semantic queries (semantic appends
// `embedding` at index 13).
const DECISION_COLUMNS = `id, file_path, module, summary, reason, result, lesson,
            confidence, status, source_type, source_url, source_author, source_ref`;

// ─── Tool Implementation ─────────────────────────────────────────────────────

export async function getFileDecisions(
  input: GetFileDecisionsInput,
  db: Database,
  hindsight: HindsightClient | null
): Promise<string> {
  const { file, module, intent } = input;
  const normalizedFile = normalizeFilePath(file);

  // 1. Query SQLite for decisions matching file + module
  const rows = db.exec(
    `SELECT ${DECISION_COLUMNS}
     FROM decisions
     WHERE file_path = '${escapeSQL(normalizedFile)}' AND module = '${escapeSQL(module)}'
     ORDER BY confidence DESC`
  );

  const decisions: DecisionRow[] = [];
  if (rows.length > 0 && rows[0]!.values.length > 0) {
    for (const row of rows[0]!.values) {
      decisions.push(rowToDecisionRow(row));
    }
  }

  // 2. Rule 1 — No exact match. Try a semantic fallback (handles renamed/moved
  //    files), and only if that also misses, log the query miss + try Hindsight.
  if (decisions.length === 0) {
    try {
      const semanticCards = await findSemanticMatches(db, normalizedFile, module);
      if (semanticCards.length > 0) {
        logRetrievals(db, semanticCards, normalizedFile, module, intent, true);
        return formatWarningCards(semanticCards, normalizedFile, module, intent, true);
      }
    } catch (err) {
      console.error(`⚠ Semantic search failed for ${normalizedFile} — falling back:`, err);
    }

    try {
      const logStmt = db.prepare(`
        INSERT INTO agent_log (id, decision_id, action, timestamp, result)
        VALUES (:id, :decisionId, :action, :timestamp, :result)
      `);
      logStmt.run({
        ':id': uuidv4(),
        ':decisionId': null,
        ':action': 'queried',
        ':timestamp': new Date().toISOString(),
        ':result': `No decisions found for ${normalizedFile} (module: ${module}, intent: ${intent})`,
      });
      logStmt.free();
    } catch {
      // Non-fatal — log failure should not block the tool response
    }

    // Optionally check Hindsight for semantic matches
    if (hindsight) {
      try {
        const hindsightResult = await hindsight.recall(
          `${normalizedFile} ${module} ${intent}`,
          { tags: [module, 'decision'], limit: 3 }
        );
        if (hindsightResult && hindsightResult.memories && hindsightResult.memories.length > 0) {
          return formatHindsightFallback(hindsightResult.memories, normalizedFile, module);
        }
      } catch {
        // Hindsight unavailable — fall through to "no context" message
        console.error(`⚠ Hindsight recall failed for ${normalizedFile} — falling back to SQLite-only`);
      }
    }
    return 'No historical context found.';
  }

  // 3. Format warning cards
  const warningCards = decisionRowsToCards(decisions);

  // 4. Log 'retrieved' action for each decision (Rule 13)
  logRetrievals(db, warningCards, normalizedFile, module, intent, false);

  // 5. Format output — reason before warning (Rule 11)
  return formatWarningCards(warningCards, normalizedFile, module, intent, false);
}

// ─── Row / card mapping ────────────────────────────────────────────────────────

function rowToDecisionRow(row: unknown[]): DecisionRow {
  return {
    id: row[0] as string,
    file_path: row[1] as string,
    module: row[2] as string,
    summary: row[3] as string,
    reason: row[4] as string,
    result: row[5] as string,
    lesson: row[6] as string,
    confidence: row[7] as number,
    status: row[8] as string,
    source_type: row[9] as string,
    source_url: row[10] as string,
    source_author: row[11] as string,
    source_ref: row[12] as number,
  };
}

function decisionRowsToCards(decisions: DecisionRow[]): WarningCard[] {
  return decisions.map((d) => ({
    decisionId: d.id,
    filePath: d.file_path,
    summary: d.summary,
    reason: d.reason,
    result: d.result,
    lesson: d.lesson,
    confidence: d.confidence,
    status: d.status as HealthStatus,
    source: {
      type: d.source_type as 'pr' | 'issue',
      url: d.source_url,
      author: d.source_author,
      refNumber: d.source_ref,
    } as DecisionSource,
    isHighConfidence: d.confidence > CONFIDENCE_THRESHOLD,
  }));
}

// ─── Semantic fallback ──────────────────────────────────────────────────────────

/**
 * Embed the query (file + module) and return the highest-similarity decisions
 * whose stored embedding clears SEMANTIC_SIMILARITY_THRESHOLD. Deprecated
 * decisions and those without an embedding are excluded.
 */
async function findSemanticMatches(
  db: Database,
  file: string,
  module: string
): Promise<WarningCard[]> {
  // Fetch candidate embeddings FIRST — if no decision has been embedded yet
  // (e.g. a DB from before this feature, or a fresh install), skip loading the
  // model entirely. Avoids a needless ~23MB model load + network on every miss.
  const res = db.exec(
    `SELECT ${DECISION_COLUMNS}, embedding
     FROM decisions
     WHERE status != 'deprecated' AND embedding IS NOT NULL`
  );
  if (res.length === 0 || res[0]!.values.length === 0) return [];

  const queryVec = await embedText(`file: ${file}\nmodule: ${module}`);

  const scored: Array<{ row: DecisionRow; score: number }> = [];
  for (const row of res[0]!.values) {
    const embStr = row[13] as string | null;
    if (!embStr) continue;
    let vec: number[];
    try {
      vec = JSON.parse(embStr) as number[];
    } catch {
      continue; // skip rows with a malformed embedding
    }
    const score = cosineSimilarity(queryVec, vec);
    if (score >= SEMANTIC_SIMILARITY_THRESHOLD) {
      scored.push({ row: rowToDecisionRow(row), score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return decisionRowsToCards(scored.slice(0, SEMANTIC_MAX_RESULTS).map((s) => s.row));
}

// ─── Retrieval logging (Rule 13) ─────────────────────────────────────────────────

function logRetrievals(
  db: Database,
  cards: WarningCard[],
  file: string,
  module: string,
  intent: string,
  viaSemantic: boolean
): void {
  const now = new Date().toISOString();
  const how = viaSemantic ? 'semantic match' : `${intent} intent`;
  for (const card of cards) {
    try {
      const logStmt = db.prepare(`
        INSERT INTO agent_log (id, decision_id, action, timestamp, result)
        VALUES (:id, :decisionId, :action, :timestamp, :result)
      `);
      logStmt.run({
        ':id': uuidv4(),
        ':decisionId': card.decisionId,
        ':action': 'retrieved',
        ':timestamp': now,
        ':result': `Retrieved via ${how} on ${file} (module: ${module})`,
      });
      logStmt.free();
    } catch (err) {
      console.error(`⚠ Failed to log retrieval for decision ${card.decisionId}:`, err);
    }
  }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatWarningCards(
  cards: WarningCard[],
  file: string,
  module: string,
  intent: string,
  viaSemantic: boolean
): string {
  const lines: string[] = [];

  lines.push(`📋 GhostPR — Decision Context for ${file} (module: ${module})`);
  lines.push(`   Intent: ${intent}`);
  if (viaSemantic) {
    lines.push(`   🔎 No exact path match — showing semantically related decisions (file may have moved/renamed)`);
  }
  lines.push(`   Found ${cards.length} decision(s)\n`);

  for (const card of cards) {
    if (card.isHighConfidence) {
      // Full warning card (Rule 4 + Rule 11: explain before warning)
      lines.push(`${'─'.repeat(60)}`);
      lines.push(`⚠ Historical Context`);
      lines.push(`   Confidence: ${(card.confidence * 100).toFixed(0)}%`);
      lines.push(`   Status:     ${statusEmoji(card.status)} ${card.status}`);
      lines.push('');
      lines.push(`   📌 Decision: ${card.summary}`);
      lines.push(`   💡 Reason:   ${card.reason}`);
      lines.push(`   📊 Outcome:  ${card.result}`);
      lines.push(`   🎓 Lesson:   ${card.lesson}`);
      lines.push('');
      lines.push(`   📎 Source: ${card.source.type.toUpperCase()} #${card.source.refNumber} by @${card.source.author}`);
      lines.push(`      ${card.source.url}`);
      lines.push(`${'─'.repeat(60)}`);
      lines.push('');
    } else {
      // Soft note — below threshold (Rule 4)
      lines.push(`${'─'.repeat(60)}`);
      lines.push(`ℹ Historical context available — confidence below threshold (${(card.confidence * 100).toFixed(0)}%)`);
      lines.push(`   Status: ${statusEmoji(card.status)} ${card.status}`);
      lines.push(`   Decision: ${card.summary}`);
      lines.push(`   Source: ${card.source.type.toUpperCase()} #${card.source.refNumber}`);
      lines.push(`${'─'.repeat(60)}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function formatHindsightFallback(
  memories: Array<{ content: string }>,
  file: string,
  module: string
): string {
  const lines: string[] = [];
  lines.push(`📋 GhostPR — Semantic Memory Recall for ${file} (module: ${module})`);
  lines.push(`   Source: Hindsight vector memory (no exact SQLite match found)\n`);

  for (let i = 0; i < memories.length; i++) {
    lines.push(`   ${i + 1}. ${memories[i]!.content}`);
    lines.push('');
  }

  return lines.join('\n');
}

function statusEmoji(status: HealthStatus): string {
  switch (status) {
    case 'active': return '✅';
    case 'questionable': return '⚠️';
    case 'deprecated': return '🔴';
    default: return '❓';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeSQL(value: string): string {
  return value.replace(/'/g, "''");
}
