/**
 * updater.ts
 *
 * Signal scanner for GhostPR.
 * Scans newly ingested/fetched PRs to check if they touch files with existing decisions.
 * Uses Groq LLM to check if the PR confirms, contradicts, or is neutral to the decision.
 * Updates confidence and logs actions accordingly.
 */

import type { Database } from 'sql.js';
import type { Decision } from '@GhostPR/shared-types';
import type { RawPR } from '../github/prFetcher.js';
import { callGroq } from '../extractor/groqClient.js';

// ─── UUID Generator ──────────────────────────────────────────────────────────

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── LLM Signal Classifier ────────────────────────────────────────────────────

type SignalType = 'CONFIRMED' | 'CONTRADICTED' | 'NEUTRAL';

async function classifySignal(decision: { filePath: string; summary: string; reason: string; result: string }, pr: RawPR): Promise<SignalType> {
  const prompt = `You are a validation signal scanner for a codebase decision memory system.
Your job is to determine how a subsequent GitHub Pull Request affects an existing technical decision record.

Existing Technical Decision:
- File touched: ${decision.filePath}
- Decision Summary: ${decision.summary}
- Decision Reason: ${decision.reason}
- Decision Outcome: ${decision.result}

Subsequent Pull Request:
- PR #${pr.number}: "${pr.title}"
- PR Body: ${pr.body}
- Changed Files: ${pr.changedFiles.join(', ')}
- Comments/Reviews: ${pr.comments.join('\n\n')}

Analyze the relationship between the PR and the existing decision.
Decide if the PR:
1. CONFIRMED: The PR confirms that the decision/workaround still holds or is verified as correct (e.g. they worked on the same module/file and maintained or reinforced the choice, or explicitly mentioned that the choice worked).
2. CONTRADICTED: The PR contradicts, reverses, replaces, or overrides the decision (e.g., they refactored the OAuth refresh token flow to use standard OAuth instead of the custom flow, or removed a specific caching module).
3. NEUTRAL: The PR is unrelated, does a minor modification, is a standard refactoring of unrelated logic, or is a routine dependency bump that does not alter the core decision.

Respond with exactly one of these three words in uppercase:
CONFIRMED
CONTRADICTED
NEUTRAL

Do not output any introductory or concluding text, explanations, or quotes. Output ONLY the raw single word.`;

  try {
    const response = await callGroq(prompt);
    const cleaned = response.trim().toUpperCase();
    if (cleaned.includes('CONFIRMED')) return 'CONFIRMED';
    if (cleaned.includes('CONTRADICTED')) return 'CONTRADICTED';
    return 'NEUTRAL';
  } catch (err) {
    console.warn(`   ⚠ Failed to classify signal for decision in ${decision.filePath} from PR #${pr.number}:`, err);
    return 'NEUTRAL';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function scanPRForSignals(
  db: Database,
  pr: RawPR
): Promise<{ revalidatedCount: number; deprecatedCount: number }> {
  let revalidatedCount = 0;
  let deprecatedCount = 0;

  const revalidatedIds: string[] = [];
  const deprecatedIds: string[] = [];

  for (const file of pr.changedFiles) {
    // Find active or questionable decisions matching this exact file path
    const stmt = db.prepare(`
      SELECT id, file_path, summary, reason, result, created, last_validated, status, confidence
      FROM decisions
      WHERE file_path = :filePath AND status != 'deprecated'
    `);

    stmt.bind({ ':filePath': file });

    const matchingRows: any[] = [];
    while (stmt.step()) {
      matchingRows.push(stmt.getAsObject());
    }
    stmt.free();

    for (const row of matchingRows) {
      const decisionId = row.id as string;
      const createdStr = row.created as string;
      const filePath = row.file_path as string;
      const summary = row.summary as string;
      const reason = row.reason as string;
      const result = row.result as string;

      // Skip if we already processed this decision in the current PR scan
      if (revalidatedIds.includes(decisionId) || deprecatedIds.includes(decisionId)) {
        continue;
      }

      // We only scan PRs that were merged AFTER the decision was created
      if (new Date(pr.mergedAt).getTime() > new Date(createdStr).getTime()) {
        console.log(`   📡 Scanning PR #${pr.number} for signal on: "${filePath}" (decision created ${createdStr})`);

        const signal = await classifySignal({ filePath, summary, reason, result }, pr);

        if (signal === 'CONFIRMED') {
          // Revalidate decision
          db.run(`
            UPDATE decisions
            SET confidence = 0.9, last_validated = :lastValidated, status = 'active'
            WHERE id = :id
          `, {
            ':lastValidated': pr.mergedAt,
            ':id': decisionId
          });

          // Log to agent_log (Rule 13)
          const logId = generateUUID();
          db.run(`
            INSERT INTO agent_log (id, decision_id, action, timestamp, result)
            VALUES (:id, :decisionId, 'accepted', :timestamp, :result)
          `, {
            ':id': logId,
            ':decisionId': decisionId,
            ':timestamp': pr.mergedAt,
            ':result': `Revalidated by PR #${pr.number}: "${pr.title}"`
          });

          console.log(`      ✨ CONFIRMED: Reset confidence to 0.9, updated last_validated to ${pr.mergedAt}`);
          revalidatedIds.push(decisionId);
          revalidatedCount++;
        } else if (signal === 'CONTRADICTED') {
          // Deprecate decision
          db.run(`
            UPDATE decisions
            SET confidence = 0.2, status = 'deprecated'
            WHERE id = :id
          `, {
            ':id': decisionId
          });

          // Log to agent_log
          const logId = generateUUID();
          db.run(`
            INSERT INTO agent_log (id, decision_id, action, timestamp, result)
            VALUES (:id, :decisionId, 'ignored', :timestamp, :result)
          `, {
            ':id': logId,
            ':decisionId': decisionId,
            ':timestamp': pr.mergedAt,
            ':result': `Contradicted/Reverted by PR #${pr.number}: "${pr.title}"`
          });

          console.log(`      🔴 CONTRADICTED: Marked status as 'deprecated', confidence dropped to 0.2`);
          deprecatedIds.push(decisionId);
          deprecatedCount++;
        } else {
          // NEUTRAL — log only in debug/verbose if necessary
          // No DB change
        }
      }
    }
  }

  return { revalidatedCount, deprecatedCount };
}
