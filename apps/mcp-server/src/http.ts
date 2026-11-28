/**
 * http.ts — MCP Server Streamable HTTP + Standard OAuth 2.1 entry point
 *
 * Usage:
 *   pnpm run mcp:http              (from repo root)
 *   pnpm --filter mcp-server start:http
 *   node apps/mcp-server/dist/http.js
 *
 * Exposes:
 *   POST/GET/DELETE /mcp                  — MCP Streamable HTTP endpoint
 *   GET /health                           — Health check for cloud hosts
 *   GET /                                 — Service metadata
 *   /.well-known/oauth-* + /authorize + /token + /register + /revoke (when MCP_AUTH_TOKEN is set)
 *
 * Environment:
 *   PORT / MCP_PORT     — Port to listen on (default: 8080)
 *   HOST                — Bind address (default: 0.0.0.0)
 *   MCP_PATH            — Endpoint path (default: /mcp)
 *   MCP_AUTH_MODE       — 'public' (one-click OAuth), 'token' (passphrase OAuth), or 'open' (no auth)
 *   MCP_AUTH_TOKEN      — Signing secret (and passphrase when MCP_AUTH_MODE=token)
 *   MCP_PUBLIC_URL      — Public HTTPS origin (defaults to RENDER_EXTERNAL_URL or http://localhost:<port>)
 */

import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import express, { type Request, type RequestHandler, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createServer } from './server.js';
import { initRuntime, type McpRuntime } from './runtime.js';
import { GhostPROAuthProvider } from './auth.js';

function resolvePort(): number {
  const raw = process.env['PORT'] ?? process.env['MCP_PORT'] ?? '8080';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: "${raw}". Expected an integer between 1 and 65535.`);
  }
  return port;
}

function resolvePublicOrigin(port: number): string {
  const configured =
    process.env['MCP_PUBLIC_URL']?.trim() ||
    process.env['RENDER_EXTERNAL_URL']?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return `http://localhost:${port}`;
}

type AuthMode = 'public' | 'token' | 'open';

function resolveAuthMode(authToken: string | undefined): AuthMode {
  const raw = process.env['MCP_AUTH_MODE']?.trim().toLowerCase();
  if (raw === 'public' || raw === 'token' || raw === 'open') {
    if (raw === 'token' && !authToken) {
      throw new Error('MCP_AUTH_MODE=token requires MCP_AUTH_TOKEN to be set.');
    }
    return raw;
  }
  return authToken ? 'public' : 'open';
}

export async function startHttpServer(runtime: McpRuntime): Promise<void> {
  const port = resolvePort();
  const host = process.env['HOST'] ?? '0.0.0.0';
  const rawPath = process.env['MCP_PATH'] ?? '/mcp';
  const mcpPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const authToken = process.env['MCP_AUTH_TOKEN']?.trim() || undefined;
  const authMode = resolveAuthMode(authToken);
  const publicOrigin = resolvePublicOrigin(port);

  const app = express();
  // Required behind Render / reverse proxies so express-rate-limit uses X-Forwarded-For cleanly
  app.set('trust proxy', 1);

  // Global CORS for web-based MCP clients (Gemini, Claude Web, MCP Inspector)
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID'
    );
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'GhostPR-mcp',
      transport: 'streamable-http',
      mcpEndpoint: mcpPath,
      healthEndpoint: '/health',
      authMode,
      oauthEnabled: authMode !== 'open',
    });
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'GhostPR-mcp',
      transport: 'streamable-http',
    });
  });

  const mcpMiddleware: RequestHandler[] = [];

  if (authMode !== 'open') {
    const issuerUrl = new URL(publicOrigin);
    const resourceServerUrl = new URL(mcpPath, issuerUrl);
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceServerUrl);
    const oauthProvider = new GhostPROAuthProvider({
      secret: authToken ?? randomBytes(32).toString('hex'),
      requirePassphrase: authMode === 'token',
      directBearerToken: authToken,
    });

    app.use(
      mcpAuthRouter({
        provider: oauthProvider,
        issuerUrl,
        resourceServerUrl,
        resourceName: 'GhostPR MCP Server',
        scopesSupported: ['mcp'],
        clientRegistrationOptions: {
          clientIdGeneration: false,
        },
      })
    );

    // Fallback alias for clients probing root protected-resource metadata instead of path-suffixed RFC 9728 URL
    app.get('/.well-known/oauth-protected-resource', (_req, res) => {
      res.json({
        resource: resourceServerUrl.href,
        authorization_servers: [issuerUrl.href],
        scopes_supported: ['mcp'],
        resource_name: 'GhostPR MCP Server',
      });
    });

    app.post(
      '/oauth/approve',
      express.urlencoded({ extended: false }),
      oauthProvider.handleApproval
    );

    mcpMiddleware.push(
      requireBearerAuth({
        verifier: oauthProvider,
        resourceMetadataUrl,
      })
    );
  }

  mcpMiddleware.push(express.json({ limit: '1mb' }));

  const handleMcp = async (req: Request, res: Response): Promise<void> => {
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
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('❌ HTTP MCP request error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  };

  app.all(mcpPath, ...mcpMiddleware, handleMcp);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const httpServer: Server = await new Promise((resolve) => {
    const srv = app.listen(port, host, () => resolve(srv));
  });

  runtime.onBeforeShutdown(
    () =>
      new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      })
  );

  const authSummary =
    authMode === 'open'
      ? 'disabled (open)'
      : authMode === 'public'
        ? 'OAuth 2.1 (public one-click consent)'
        : 'OAuth 2.1 (MCP_AUTH_TOKEN required)';

  console.error(`✅ GhostPR MCP Server is running (Streamable HTTP mode)`);
  console.error(`   Public:   ${publicOrigin}`);
  console.error(`   Endpoint: http://${host}:${port}${mcpPath}`);
  console.error(`   Health:   http://${host}:${port}/health`);
  console.error(`   Auth:     ${authSummary}`);
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
