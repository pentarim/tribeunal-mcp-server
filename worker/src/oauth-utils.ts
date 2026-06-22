// OAuth utilities: cookie-based client approval, PKCE (S256), Auth0 URL/token
// helpers. Adapted from Cloudflare's reference remote-MCP OAuth samples and the
// Auth0 OIDC demo, trimmed to exactly what the Tribeunal worker needs.
//
// No third-party crypto libs: everything uses Web Crypto (`crypto.subtle`),
// which is available in the Workers runtime.

import type { AuthRequest, ClientInfo } from '@cloudflare/workers-oauth-provider';

const COOKIE_NAME = 'mcp-approved-clients';
const ONE_YEAR_IN_SECONDS = 31536000;

// ---------------------------------------------------------------------------
// base64url helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636, S256)
// ---------------------------------------------------------------------------

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

/** Generate a PKCE code_verifier + S256 code_challenge pair. */
export async function generatePkcePair(): Promise<PkcePair> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = base64UrlEncode(verifierBytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64UrlEncode(new Uint8Array(digest));
  return { codeChallenge, codeVerifier };
}

/** Cryptographically-random opaque token (hex), used for the Auth0 `state`. */
export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Auth0 endpoints
// ---------------------------------------------------------------------------

export interface BuildAuth0AuthorizeUrlParams {
  domain: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  audience: string;
  state: string;
  codeChallenge: string;
}

/** Build the Auth0 `/authorize` redirect URL (authorization code + PKCE S256). */
export function buildAuth0AuthorizeUrl({
  domain,
  clientId,
  redirectUri,
  scope,
  audience,
  state,
  codeChallenge,
}: BuildAuth0AuthorizeUrlParams): string {
  const url = new URL(`https://${domain}/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('audience', audience);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.href;
}

export interface Auth0TokenSet {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface ExchangeCodeParams {
  domain: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

/** Exchange an authorization code at Auth0 `/oauth/token` (PKCE). */
export async function exchangeAuth0Code(params: ExchangeCodeParams): Promise<Auth0TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const resp = await fetch(`https://${params.domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    throw new Error(`Auth0 token exchange failed (${resp.status}): ${await resp.text()}`);
  }
  return (await resp.json()) as Auth0TokenSet;
}

export interface RefreshTokenParams {
  domain: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** Refresh an Auth0 access token via the refresh_token grant. */
export async function refreshAuth0Token(params: RefreshTokenParams): Promise<Auth0TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken,
  });

  const resp = await fetch(`https://${params.domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    throw new Error(`Auth0 token refresh failed (${resp.status}): ${await resp.text()}`);
  }
  return (await resp.json()) as Auth0TokenSet;
}

/**
 * Decode (WITHOUT verifying) the claims of a JWT.
 *
 * Safe here because the id_token came directly from Auth0 over a TLS-verified
 * back-channel `/oauth/token` call we just made — we only need `sub`/`email`.
 * The Tribeunal resource server independently verifies the access token's
 * signature/aud/iss via JWKS.
 */
export function decodeJwtClaims(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
  try {
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Cookie-based client approval (so a given MCP client only sees the consent
// screen once). HMAC-SHA256 signed with COOKIE_ENCRYPTION_KEY.
// ---------------------------------------------------------------------------

async function importHmacKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error('COOKIE_ENCRYPTION_KEY is not set.');
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign', 'verify'],
  );
}

async function signData(key: CryptoKey, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifySignature(key: CryptoKey, signatureHex: string, data: string): Promise<boolean> {
  try {
    const sigBytes = new Uint8Array(signatureHex.match(/.{1,2}/g)!.map((h) => parseInt(h, 16)));
    return await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
  } catch {
    return false;
  }
}

async function getApprovedClientsFromCookie(
  cookieHeader: string | null,
  secret: string,
): Promise<string[] | null> {
  if (!cookieHeader) return null;
  const target = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!target) return null;

  const value = target.substring(COOKIE_NAME.length + 1);
  const parts = value.split('.');
  if (parts.length !== 2) return null;

  const [signatureHex, base64Payload] = parts;
  const payload = atob(base64Payload);
  const key = await importHmacKey(secret);
  if (!(await verifySignature(key, signatureHex, payload))) return null;

  try {
    const list = JSON.parse(payload);
    if (!Array.isArray(list) || !list.every((i) => typeof i === 'string')) return null;
    return list as string[];
  } catch {
    return null;
  }
}

/** True if `clientId` is in the user's signed approval cookie. */
export async function clientIdAlreadyApproved(
  request: Request,
  clientId: string,
  cookieSecret: string,
): Promise<boolean> {
  if (!clientId) return false;
  const approved = await getApprovedClientsFromCookie(request.headers.get('Cookie'), cookieSecret);
  return approved?.includes(clientId) ?? false;
}

export interface ParsedApproval {
  state: { oauthReqInfo?: AuthRequest };
  headers: Record<string, string>;
}

/** Parse the approval form POST, returning the decoded state + Set-Cookie. */
export async function parseRedirectApproval(
  request: Request,
  cookieSecret: string,
): Promise<ParsedApproval> {
  if (request.method !== 'POST') throw new Error('Expected POST.');

  const formData = await request.formData();
  const encodedState = formData.get('state');
  if (typeof encodedState !== 'string' || !encodedState) {
    throw new Error("Missing 'state' in form data.");
  }

  const state = JSON.parse(atob(encodedState)) as { oauthReqInfo?: AuthRequest };
  const clientId = state?.oauthReqInfo?.clientId;
  if (!clientId) throw new Error('Could not extract clientId from state.');

  const existing = (await getApprovedClientsFromCookie(request.headers.get('Cookie'), cookieSecret)) || [];
  const updated = Array.from(new Set([...existing, clientId]));

  const payload = JSON.stringify(updated);
  const key = await importHmacKey(cookieSecret);
  const signature = await signData(key, payload);
  const cookieValue = `${signature}.${btoa(payload)}`;

  return {
    headers: {
      'Set-Cookie': `${COOKIE_NAME}=${cookieValue}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${ONE_YEAR_IN_SECONDS}`,
    },
    state,
  };
}

function sanitizeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface ApprovalDialogOptions {
  client: ClientInfo | null;
  server: { name: string; description?: string };
  state: Record<string, unknown>;
}

/** Render a minimal, XSS-safe consent screen for first-time MCP clients. */
export function renderApprovalDialog(request: Request, options: ApprovalDialogOptions): Response {
  const { client, server, state } = options;
  const encodedState = btoa(JSON.stringify(state));
  const serverName = sanitizeHtml(server.name);
  const clientName = client?.clientName ? sanitizeHtml(client.clientName) : 'A new MCP Client';
  const serverDescription = server.description ? sanitizeHtml(server.description) : '';
  const action = new URL(request.url).pathname;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${serverName} | Authorization Request</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background:#f9fafb; color:#333; margin:0; padding:2rem; }
    .card { max-width:560px; margin:2rem auto; background:#fff; border-radius:8px; box-shadow:0 8px 36px rgba(0,0,0,.1); padding:2rem; }
    h1 { font-size:1.3rem; font-weight:600; margin-top:0; }
    .actions { display:flex; justify-content:flex-end; gap:1rem; margin-top:2rem; }
    button { padding:.75rem 1.5rem; border-radius:6px; font-size:1rem; font-weight:500; border:none; cursor:pointer; }
    .primary { background:#0070f3; color:#fff; }
    .secondary { background:transparent; border:1px solid #e5e7eb; color:#333; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${serverName}</h1>
    ${serverDescription ? `<p>${serverDescription}</p>` : ''}
    <p><strong>${clientName}</strong> is requesting access to Tribeunal on your behalf. If you approve, you will be redirected to Auth0 to sign in.</p>
    <form method="post" action="${action}">
      <input type="hidden" name="state" value="${encodedState}">
      <div class="actions">
        <button type="button" class="secondary" onclick="window.history.back()">Cancel</button>
        <button type="submit" class="primary">Approve</button>
      </div>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
