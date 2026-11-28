/**
 * http.ts — MCP Server Streamable HTTP entry point
 *
 * Usage:
 *   pnpm run mcp:http              (from repo root)
 *   pnpm --filter mcp-server start:http
 *   node apps/mcp-server/dist/http.js
 *
 * Exposes:
 *   POST/GET/DELETE /mcp   (or MCP_PATH) — MCP Streamable HTTP endpoint
 *   GET /health                          — Health check for cloud hosts
 *
 * Environment:
 *   PORT / MCP_PORT   — Port to listen on (default: 8080)
 *   HOST              — Bind address (default: 0.0.0.0)
 *   MCP_PATH          — Endpoint path (default: /mcp)
 *   MCP_AUTH_TOKEN    — Optional Bearer token required on /mcp requests
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { initRuntime, type McpRuntime } from './runtime.js';

const MAX_BODY_BYTES = 1_048_576; // 1 MB

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
}

function isAuthorized(req: IncomingMessage, authToken: string | undefined): boolean {
  if (!authToken) return true;
  const header = req.headers['authorization'];
  return header === `Bearer ${authToken}`;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

export async function startHttpServer(runtime: McpRuntime): Promise<void> {
  const port = Number(process.env['PORT'] ?? process.env['MCP_PORT'] ?? 8080);
  const host = process.env['HOST'] ?? '0.0.0.0';
  const mcpPath = process.env['MCP_PATH'] ?? '/mcp';
  const authToken = process.env['MCP_AUTH_TOKEN']?.trim() || undefined;

  const httpServer = createHttpServer(async (req, res) => {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health' && req.method === 'GET') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'GhostPR-mcp',
        transport: 'streamable-http',
      });
      return;
    }

    if (url.pathname !== mcpPath) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    if (!isAuthorized(req, authToken)) {
      sendJson(res, 401, {
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized' },
        id: null,
      });
      return;
    }

    let parsedBody: unknown;
    if (req.method === 'POST') {
      try {
        parsedBody = await readJsonBody(req);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Bad request';
        sendJson(res, 400, {
          jsonrpc: '2.0',
          error: { code: -32700, message },
          id: null,
        });
        return;
      }
    }

    const mcpServer = createServer({ db: runtime.db, hindsight: runtime.hindsight });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode for cloud/remote MCP clients
    });

    res.on('close', () => {
      void transport.close();
      void mcpServer.close();
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
    } catch (err) {
      console.error('❌ HTTP MCP request error:', err);
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => resolve());
  });

  console.error(`✅ GhostPR MCP Server is running (Streamable HTTP mode)`);
  console.error(`   Endpoint: http://${host}:${port}${mcpPath}`);
  console.error(`   Health:   http://${host}:${port}/health`);
  console.error(`   Auth:     ${authToken ? 'Bearer token enabled' : 'disabled (open)'}`);
  console.error('');
}

// Run directly when executed as an entry point
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  initRuntime()
    .then(startHttpServer)
    .catch((err) => {
      console.error('❌ Fatal error:', err);
      process.exit(1);
    });
}
