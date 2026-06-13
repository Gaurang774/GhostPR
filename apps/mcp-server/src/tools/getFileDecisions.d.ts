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
import type { Database } from 'sql.js';
import type { HindsightClient } from '../memory/hindsightClient.js';
export declare const GetFileDecisionsInputSchema: z.ZodObject<{
    file: z.ZodString;
    module: z.ZodString;
    intent: z.ZodString;
}, "strip", z.ZodTypeAny, {
    module: string;
    file: string;
    intent: string;
}, {
    module: string;
    file: string;
    intent: string;
}>;
export type GetFileDecisionsInput = z.infer<typeof GetFileDecisionsInputSchema>;
export declare function getFileDecisions(input: GetFileDecisionsInput, db: Database, hindsight: HindsightClient | null): Promise<string>;
//# sourceMappingURL=getFileDecisions.d.ts.map