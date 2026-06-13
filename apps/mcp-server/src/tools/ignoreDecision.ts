import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from 'sql.js';

export const IgnoreDecisionInputSchema = z.object({
  decisionId: z.string().uuid('must be a valid UUID'),
  reason: z.string().min(1, 'reason for ignoring is required'),
});

export type IgnoreDecisionInput = z.infer<typeof IgnoreDecisionInputSchema>;

export function ignoreDecision(input: IgnoreDecisionInput, db: Database): string {
  const { decisionId, reason } = input;
  const now = new Date().toISOString();

  // Verify decision exists
  const check = db.exec(`SELECT id FROM decisions WHERE id = '${decisionId}'`);
  if (!check.length || !check[0]!.values.length) {
    throw new Error(`Decision with ID ${decisionId} not found.`);
  }

  const logStmt = db.prepare(`
    INSERT INTO agent_log (id, decision_id, action, timestamp, result)
    VALUES (:id, :decisionId, :action, :timestamp, :result)
  `);
  
  logStmt.run({
    ':id': uuidv4(),
    ':decisionId': decisionId,
    ':action': 'ignored',
    ':timestamp': now,
    ':result': `User explicitly ignored warning. Reason: ${reason}`,
  });
  logStmt.free();

  return `Successfully logged that decision ${decisionId} was ignored. Reason: ${reason}`;
}
