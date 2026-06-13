/**
 * server.ts — McpServer factory + tool registration
 *
 * Creates a configured McpServer instance with two tools:
 *   1. getFileDecisions — Retrieve decision context for a file
 *   2. markDeprecated   — Manually deprecate a decision
 *
 * The server is read-only (Rule 5 — never auto-edit).
 * All tools are Zod-validated (no raw `any`).
 *
 * NOTE: The MCP SDK's .tool() method uses its own bundled Zod types for the
 * inputSchema parameter. To avoid type conflicts between our local Zod and the
 * SDK's Zod, we use the 3-argument overload (name, description, callback)
 * and perform Zod validation inside the callback body instead.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from 'sql.js';
import type { HindsightClient } from './memory/hindsightClient.js';

import {
  getFileDecisions,
  GetFileDecisionsInputSchema,
} from './tools/getFileDecisions.js';

import {
  markDeprecated,
  MarkDeprecatedInputSchema,
} from './tools/markDeprecated.js';

import {
  ignoreDecision,
  IgnoreDecisionInputSchema,
} from './tools/ignoreDecision.js';

// ─── Server Factory ───────────────────────────────────────────────────────────

export interface CreateServerOptions {
  db: Database;
  hindsight: HindsightClient | null;
}

export function createServer(options: CreateServerOptions): McpServer {
  const { db, hindsight } = options;

  const server = new McpServer({
    name: 'GhostPR',
    version: '0.1.0',
  });

  // ─── Tool 1: getFileDecisions ─────────────────────────────────────────────
  // Uses 3-arg overload to avoid Zod type conflicts with SDK's bundled Zod.
  // Validation is done inside the callback using our own Zod schemas.

  server.tool(
    'getFileDecisions',
    'Retrieve historical decision context for a file. Returns warning cards for high-confidence decisions (>75%) and soft notes for lower confidence. Requires file path, module name, and intent. Call with: {"file": "path/to/file.ts", "module": "moduleName", "intent": "edit|review|refactor"}',
    GetFileDecisionsInputSchema.shape as any,
    async (args: any) => {
      try {
        const validated = GetFileDecisionsInputSchema.parse(args);
        const result = await getFileDecisions(validated, db, hindsight);

        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error
          ? err.message
          : `Error retrieving decisions: ${String(err)}`;

        return {
          content: [
            {
              type: 'text' as const,
              text: message,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── Tool 2: markDeprecated ───────────────────────────────────────────────

  server.tool(
    'markDeprecated',
    'Manually deprecate a decision by its ID. Use when a decision no longer applies. Call with: {"decisionId": "uuid-string", "reason": "reason for deprecation"}',
    MarkDeprecatedInputSchema.shape as any,
    async (args: any) => {
      try {
        const validated = MarkDeprecatedInputSchema.parse(args);
        const result = markDeprecated(validated, db);

        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error
          ? err.message
          : `Error deprecating decision: ${String(err)}`;

        return {
          content: [
            {
              type: 'text' as const,
              text: message,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── Tool 3: ignoreDecision ───────────────────────────────────────────────

  server.tool(
    'ignoreDecision',
    'Log that a human explicitly chose to ignore a historical context warning. Call with: {"decisionId": "uuid-string", "reason": "reason for ignoring"}',
    IgnoreDecisionInputSchema.shape as any,
    async (args: any) => {
      try {
        const validated = IgnoreDecisionInputSchema.parse(args);
        const result = ignoreDecision(validated, db);

        return {
          content: [
            {
              type: 'text' as const,
              text: result,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error
          ? err.message
          : `Error ignoring decision: ${String(err)}`;

        return {
          content: [
            {
              type: 'text' as const,
              text: message,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
