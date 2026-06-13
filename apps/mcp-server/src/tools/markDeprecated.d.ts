/**
 * markDeprecated.ts — MCP Tool: Manually deprecate a decision
 *
 * Rules enforced:
 *   Rule 6  — Human always wins (developer can override decision status)
 *   Rule 13 — Log the deprecation action to agent_log
 */
import { z } from 'zod';
import type { Database } from 'sql.js';
export declare const MarkDeprecatedInputSchema: z.ZodObject<{
    decisionId: z.ZodString;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    reason: string;
    decisionId: string;
}, {
    reason: string;
    decisionId: string;
}>;
export type MarkDeprecatedInput = z.infer<typeof MarkDeprecatedInputSchema>;
export declare function markDeprecated(input: MarkDeprecatedInput, db: Database): string;
//# sourceMappingURL=markDeprecated.d.ts.map