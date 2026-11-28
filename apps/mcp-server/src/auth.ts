/**
 * auth.ts — Stateless OAuth 2.1 + PKCE + Dynamic Client Registration for GhostPR MCP
 *
 * Implements the MCP Authorization specification (RFC 9728, RFC 8414, RFC 7591,
 * OAuth 2.1 + PKCE S256) so Gemini, Claude, ChatGPT, Cursor, VS Code, and CLI
 * clients can connect over HTTPS using standard OAuth.
 *
 * All registered clients, auth codes, access tokens, and refresh tokens are
 * AES-256-GCM sealed using a key derived from MCP_AUTH_TOKEN, so tokens and
 * dynamically registered clients survive container restarts / Render spin-downs.
 * Direct `Authorization: Bearer <MCP_AUTH_TOKEN>` is also accepted for CLIs.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { Request, Response } from 'express';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

const CLIENT_ID_PREFIX = 'gpr_';
const CODE_TTL_MS = 5 * 60 * 1000;          // 5 minutes
const TX_TTL_MS = 10 * 60 * 1000;           // 10 minutes
const ACCESS_TOKEN_TTL_SEC = 60 * 60;       // 1 hour
const REFRESH_TOKEN_TTL_SEC = 30 * 86_400;  // 30 days
const DIRECT_BEARER_TTL_SEC = 3600;

interface SealedClientPayload {
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method?: string;
  client_secret?: string;
  client_secret_expires_at?: number;
  client_id_issued_at?: number;
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
}

interface PendingAuthTx {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: string[];
  resource?: string;
  exp: number;
}

interface AuthCodePayload {
  typ: 'code';
  jti: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
  exp: number;
}

interface TokenPayload {
  typ: 'at' | 'rt';
  clientId: string;
  scopes: string[];
  resource?: string;
  exp: number; // epoch seconds
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

class TokenCrypto {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(`ghostpr-oauth:${secret}`).digest();
  }

  seal(payload: object): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64url');
  }

  unseal<T>(token: string): T | null {
    try {
      const raw = Buffer.from(token, 'base64url');
      if (raw.length < 29) return null;
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const ciphertext = raw.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      return JSON.parse(plaintext) as T;
    } catch {
      return null;
    }
  }
}

function renderConsentPage(
  tx: PendingAuthTx,
  txToken: string,
  requirePassphrase: boolean,
  errorMessage?: string
): string {
  const redirectHost = (() => {
    try {
      return new URL(tx.redirectUri).hostname;
    } catch {
      return tx.redirectUri;
    }
  })();

  const scopeList = tx.scopes.length > 0 ? tx.scopes.join(', ') : 'mcp';
  const errorBlock = errorMessage
    ? `<div class="error" role="alert">${escapeHtml(errorMessage)}</div>`
    : '';
  const passphraseField = requirePassphrase
    ? `<label for="passphrase">Server Access Token (<code>MCP_AUTH_TOKEN</code>)</label>
      <input id="passphrase" name="passphrase" type="password" autocomplete="current-password" required autofocus />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize GhostPR MCP</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: #0b0f17; color: #e6edf3; min-height: 100vh;
      display: grid; place-items: center; padding: 16px;
    }
    .card {
      width: 100%; max-width: 420px; background: #131926;
      border: 1px solid #263044; border-radius: 14px; padding: 24px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
    }
    h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
    p { margin: 0 0 16px; color: #9fb0c7; font-size: 14px; line-height: 1.5; }
    .meta {
      background: #0e1420; border: 1px solid #222c3f; border-radius: 10px;
      padding: 12px 14px; margin-bottom: 16px; font-size: 13px;
    }
    .meta div { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; }
    .meta span { color: #7f91ab; }
    .meta strong { color: #e6edf3; text-align: right; word-break: break-all; }
    label { display: block; font-size: 13px; color: #b7c5d9; margin-bottom: 6px; }
    input[type="password"] {
      width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
      border: 1px solid #2f3b52; background: #0b101b; color: #fff; font-size: 14px;
      margin-bottom: 14px;
    }
    .error {
      background: rgba(248, 81, 73, 0.14); border: 1px solid rgba(248, 81, 73, 0.45);
      color: #ff948d; padding: 10px 12px; border-radius: 8px; font-size: 13px;
      margin-bottom: 14px;
    }
    .actions { display: flex; gap: 10px; }
    button {
      flex: 1; padding: 10px 14px; border-radius: 8px; font-size: 14px;
      font-weight: 600; cursor: pointer; border: 1px solid transparent;
    }
    .approve { background: #2f81f7; color: #fff; }
    .approve:hover { background: #4493f8; }
    .deny { background: transparent; color: #9fb0c7; border-color: #2f3b52; }
    .deny:hover { background: #1a2234; }
  </style>
</head>
<body>
  <main class="card">
    <h1>Connect to GhostPR MCP</h1>
    <p>An application is requesting access to your GhostPR architectural decision registry.</p>
    <div class="meta">
      <div><span>Client</span><strong>${escapeHtml(tx.clientName)}</strong></div>
      <div><span>Redirect Host</span><strong>${escapeHtml(redirectHost)}</strong></div>
      <div><span>Scope</span><strong>${escapeHtml(scopeList)}</strong></div>
    </div>
    ${errorBlock}
    <form method="POST" action="/oauth/approve">
      <input type="hidden" name="tx" value="${escapeHtml(txToken)}" />
      ${passphraseField}
      <div class="actions">
        <button class="deny" type="submit" name="action" value="deny" formnovalidate>Deny</button>
        <button class="approve" type="submit" name="action" value="approve">Approve &amp; Connect</button>
      </div>
    </form>
  </main>
</body>
</html>`;
}

export class StatelessClientsStore implements OAuthRegisteredClientsStore {
  constructor(private readonly crypto: TokenCrypto) {}

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    if (!clientId.startsWith(CLIENT_ID_PREFIX)) return undefined;
    const payload = this.crypto.unseal<SealedClientPayload>(clientId.slice(CLIENT_ID_PREFIX.length));
    if (!payload || !Array.isArray(payload.redirect_uris)) return undefined;

    return {
      ...payload,
      client_id: clientId,
    };
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): OAuthClientInformationFull {
    const clientIdIssuedAt = Math.floor(Date.now() / 1000);
    const payload: SealedClientPayload = {
      redirect_uris: client.redirect_uris,
      client_name: client.client_name,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      client_secret: client.client_secret,
      client_secret_expires_at: client.client_secret_expires_at,
      client_id_issued_at: clientIdIssuedAt,
      grant_types: client.grant_types,
      response_types: client.response_types,
      scope: client.scope,
    };

    const clientId = `${CLIENT_ID_PREFIX}${this.crypto.seal(payload)}`;
    return {
      ...client,
      client_id: clientId,
      client_id_issued_at: clientIdIssuedAt,
    };
  }
}

export interface GhostPROAuthOptions {
  secret: string;
  requirePassphrase: boolean;
  directBearerToken?: string;
}

export class GhostPROAuthProvider implements OAuthServerProvider {
  public readonly clientsStore: StatelessClientsStore;
  private readonly crypto: TokenCrypto;
  private readonly directBearerToken?: string;
  private readonly requirePassphrase: boolean;
  private readonly usedCodes = new Map<string, number>();

  constructor(options: GhostPROAuthOptions) {
    this.directBearerToken = options.directBearerToken;
    this.requirePassphrase = options.requirePassphrase;
    this.crypto = new TokenCrypto(options.secret);
    this.clientsStore = new StatelessClientsStore(this.crypto);
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const tx: PendingAuthTx = {
      clientId: client.client_id,
      clientName: client.client_name ?? 'MCP Client',
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scopes: params.scopes ?? ['mcp'],
      resource: params.resource?.href,
      exp: Date.now() + TX_TTL_MS,
    };
    const txToken = this.crypto.seal(tx);
    res.status(200).type('html').send(renderConsentPage(tx, txToken, this.requirePassphrase));
  }

  handleApproval = (req: Request, res: Response): void => {
    const body = req.body as Record<string, unknown> | undefined;
    const txToken = typeof body?.['tx'] === 'string' ? body['tx'] : '';
    const action = typeof body?.['action'] === 'string' ? body['action'] : 'approve';
    const passphrase = typeof body?.['passphrase'] === 'string' ? body['passphrase'].trim() : '';

    const tx = this.crypto.unseal<PendingAuthTx>(txToken);
    if (!tx || tx.exp < Date.now()) {
      res.status(400).type('text/plain').send('Authorization request expired. Please start again.');
      return;
    }

    const redirectUrl = new URL(tx.redirectUri);
    if (tx.state) {
      redirectUrl.searchParams.set('state', tx.state);
    }

    if (action === 'deny') {
      redirectUrl.searchParams.set('error', 'access_denied');
      redirectUrl.searchParams.set('error_description', 'User denied access');
      res.redirect(302, redirectUrl.href);
      return;
    }

    if (
      this.requirePassphrase &&
      (!this.directBearerToken || !safeEqual(passphrase, this.directBearerToken))
    ) {
      res
        .status(401)
        .type('html')
        .send(
          renderConsentPage(
            tx,
            txToken,
            this.requirePassphrase,
            'Invalid MCP_AUTH_TOKEN. Please try again.'
          )
        );
      return;
    }

    const codePayload: AuthCodePayload = {
      typ: 'code',
      jti: randomUUID(),
      clientId: tx.clientId,
      redirectUri: tx.redirectUri,
      codeChallenge: tx.codeChallenge,
      scopes: tx.scopes,
      resource: tx.resource,
      exp: Date.now() + CODE_TTL_MS,
    };
    const code = this.crypto.seal(codePayload);

    redirectUrl.searchParams.set('code', code);
    res.redirect(302, redirectUrl.href);
  };

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const payload = this.parseAuthCode(client, authorizationCode);
    return payload.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    const payload = this.parseAuthCode(client, authorizationCode);

    if (this.usedCodes.has(payload.jti)) {
      throw new InvalidGrantError('Authorization code has already been used');
    }
    if (redirectUri && redirectUri !== payload.redirectUri) {
      throw new InvalidGrantError('redirect_uri mismatch');
    }
    if (payload.resource && resource && payload.resource !== resource.href) {
      throw new InvalidGrantError('resource mismatch');
    }

    this.markCodeUsed(payload.jti, payload.exp);
    return this.issueTokens(client.client_id, payload.scopes, resource?.href ?? payload.resource);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const payload = this.crypto.unseal<TokenPayload>(refreshToken);
    if (
      !payload ||
      payload.typ !== 'rt' ||
      payload.clientId !== client.client_id ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      throw new InvalidGrantError('Invalid or expired refresh token');
    }

    const grantedScopes = scopes && scopes.length > 0 ? scopes : payload.scopes;
    return this.issueTokens(client.client_id, grantedScopes, resource?.href ?? payload.resource);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (this.directBearerToken && safeEqual(token, this.directBearerToken)) {
      return {
        token,
        clientId: 'direct-bearer',
        scopes: ['mcp'],
        expiresAt: Math.floor(Date.now() / 1000) + DIRECT_BEARER_TTL_SEC,
      };
    }

    const payload = this.crypto.unseal<TokenPayload>(token);
    if (!payload || payload.typ !== 'at') {
      throw new InvalidTokenError('Invalid access token');
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new InvalidTokenError('Access token has expired');
    }

    return {
      token,
      clientId: payload.clientId,
      scopes: payload.scopes,
      expiresAt: payload.exp,
      resource: payload.resource ? new URL(payload.resource) : undefined,
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    _request: OAuthTokenRevocationRequest
  ): Promise<void> {
    // Stateless tokens expire naturally; accepted cleanly per RFC 7009.
  }

  private parseAuthCode(client: OAuthClientInformationFull, code: string): AuthCodePayload {
    const payload = this.crypto.unseal<AuthCodePayload>(code);
    if (
      !payload ||
      payload.typ !== 'code' ||
      payload.clientId !== client.client_id ||
      payload.exp < Date.now()
    ) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    return payload;
  }

  private markCodeUsed(jti: string, expMs: number): void {
    const now = Date.now();
    for (const [id, exp] of this.usedCodes) {
      if (exp < now) this.usedCodes.delete(id);
    }
    this.usedCodes.set(jti, expMs);
  }

  private issueTokens(clientId: string, scopes: string[], resource?: string): OAuthTokens {
    const nowSec = Math.floor(Date.now() / 1000);
    const accessToken = this.crypto.seal({
      typ: 'at',
      clientId,
      scopes,
      resource,
      exp: nowSec + ACCESS_TOKEN_TTL_SEC,
    } satisfies TokenPayload);

    const refreshToken = this.crypto.seal({
      typ: 'rt',
      clientId,
      scopes,
      resource,
      exp: nowSec + REFRESH_TOKEN_TTL_SEC,
    } satisfies TokenPayload);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SEC,
      scope: scopes.join(' '),
    };
  }
}
