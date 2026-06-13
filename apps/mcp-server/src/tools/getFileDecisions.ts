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
    `SELECT id, file_path, module, summary, reason, result, lesson,
            confidence, status, source_type, source_url, source_author, source_ref
     FROM decisions
     WHERE file_path = '${escapeSQL(normalizedFile)}' AND module = '${escapeSQL(module)}'
     ORDER BY confidence DESC`
  );

  const decisions: DecisionRow[] = [];
  if (rows.length > 0 && rows[0]!.values.length > 0) {
    for (const row of rows[0]!.values) {
      decisions.push({
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
      });
    }
  }

  // 2. Rule 1 — No memory found → log the query miss, then return clean null message
  if (decisions.length === 0) {
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
  const warningCards: WarningCard[] = decisions.map((d) => ({
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

  // 4. Log 'retrieved' action for each decision (Rule 13)
  const now = new Date().toISOString();
  for (const card of warningCards) {
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
        ':result': `Retrieved for ${intent} intent on ${normalizedFile}`,
      });
      logStmt.free();
    } catch (err) {
      console.error(`⚠ Failed to log retrieval for decision ${card.decisionId}:`, err);
    }
  }

  // 5. Format output — reason before warning (Rule 11)
  return formatWarningCards(warningCards, normalizedFile, module, intent);
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatWarningCards(
  cards: WarningCard[],
  file: string,
  module: string,
  intent: string
): string {
  const lines: string[] = [];

  lines.push(`📋 GhostPR — Decision Context for ${file} (module: ${module})`);
  lines.push(`   Intent: ${intent}`);
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
