/**
 * markDeprecated.ts — MCP Tool: Manually deprecate a decision
 *
 * Rules enforced:
 *   Rule 6  — Human always wins (developer can override decision status)
 *   Rule 13 — Log the deprecation action to agent_log
 */
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
// ─── Input Schema ─────────────────────────────────────────────────────────────
export const MarkDeprecatedInputSchema = z.object({
    decisionId: z.string().uuid('decisionId must be a valid UUID'),
    reason: z.string().min(1, 'reason for deprecation is required'),
});
// ─── Tool Implementation ─────────────────────────────────────────────────────
export function markDeprecated(input, db) {
    const { decisionId, reason } = input;
    // 1. Verify decision exists and fetch its summary for the response
    const existing = db.exec(`SELECT id, summary, file_path, status FROM decisions WHERE id = '${escapeSQL(decisionId)}' LIMIT 1`);
    if (existing.length === 0 || existing[0].values.length === 0) {
        return `❌ Decision not found: ${decisionId}\n   No decision with this ID exists in the database.`;
    }
    const [id, summary, filePath, currentStatus] = existing[0].values[0];
    // 2. Already deprecated?
    if (currentStatus === 'deprecated') {
        return `ℹ Decision "${summary}" (${filePath}) is already deprecated.\n   ID: ${id}`;
    }
    // 3. Update decision: set status to deprecated, drop confidence
    const updateStmt = db.prepare(`
    UPDATE decisions
    SET status = :status, confidence = :confidence
    WHERE id = :id
  `);
    updateStmt.run({
        ':status': 'deprecated',
        ':confidence': 0.2,
        ':id': decisionId,
    });
    updateStmt.free();
    // 4. Log deprecation action (Rule 13)
    const now = new Date().toISOString();
    const logStmt = db.prepare(`
    INSERT INTO agent_log (id, decision_id, action, timestamp, result)
    VALUES (:id, :decisionId, :action, :timestamp, :result)
  `);
    logStmt.run({
        ':id': uuidv4(),
        ':decisionId': decisionId,
        ':action': 'ignored',
        ':timestamp': now,
        ':result': `Manually deprecated: ${reason}`,
    });
    logStmt.free();
    // 5. Return confirmation
    return [
        `✅ Decision deprecated successfully`,
        ``,
        `   ID:       ${id}`,
        `   File:     ${filePath}`,
        `   Decision: ${summary}`,
        `   Previous: ${currentStatus}`,
        `   New:      deprecated (confidence: 0.2)`,
        `   Reason:   ${reason}`,
        `   Logged:   ${now}`,
    ].join('\n');
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeSQL(value) {
    return value.replace(/'/g, "''");
}
//# sourceMappingURL=markDeprecated.js.map