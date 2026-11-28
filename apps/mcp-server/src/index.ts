/**
 * index.ts — MCP Server entry point (STDIO default, optional --http)
 *
 * Usage:
 *   pnpm run mcp           (STDIO mode for IDEs)
 *   pnpm run mcp -- --http (Streamable HTTP mode)
 *   MCP_TRANSPORT=http node dist/index.js
 *
 * IMPORTANT: All logging goes to stderr (console.error).
 * stdout is reserved for MCP JSON-RPC protocol messages in STDIO mode.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { initRuntime } from './runtime.js';
import { startHttpServer } from './http.js';

async function main(): Promise<void> {
  const runtime = await initRuntime();

  const useHttp =
    process.argv.includes('--http') ||
    process.env['MCP_TRANSPORT']?.toLowerCase() === 'http';

  if (useHttp) {
    await startHttpServer(runtime);
    return;
  }

  const server = createServer({ db: runtime.db, hindsight: runtime.hindsight });
  const transport = new StdioServerTransport();

  console.error('📡 Connecting to STDIO transport...');
  await server.connect(transport);
  console.error('✅ GhostPR MCP Server is running (STDIO mode)');
  console.error('   Waiting for JSON-RPC messages on stdin...');
  console.error('');
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
