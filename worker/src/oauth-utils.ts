// OAuth utilities: cookie-based client approval, PKCE (S256), Auth0 URL/token
// helpers. Adapted from Cloudflare's reference remote-MCP OAuth samples and the
// Auth0 OIDC demo, trimmed to exactly what the Tribeunal worker needs.
//
// No third-party crypto libs: everything uses Web Crypto (`crypto.subtle`),
// which is available in the Workers runtime.

import type { ClientInfo } from '@cloudflare/workers-oauth-provider';

// Cookie names, before the `__Host-` prefix `cookieName()` adds. The approval
// cookie was renamed when the consent flow was hardened, so approvals recorded
// before that are not honoured and every browser is asked once more.
const APPROVED_COOKIE = 'mcp-consented-clients';
const CONSENT_COOKIE = 'mcp-consent';
const LOGIN_COOKIE = 'mcp-login';
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
// Cookies
// ---------------------------------------------------------------------------

/**
 * `__Host-` pins a cookie to this exact host over HTTPS, so a sibling
 * subdomain cannot set or overwrite it. Browsers refuse the prefix on plain
 * HTTP, which is what `wrangler dev` serves, so an HTTP request gets the bare
 * name. `wrangler dev` reports the route's hostname, not `localhost`, which is
 * why this keys on the scheme. Production should never see HTTP: keep "Always
 * Use HTTPS" on for the zone.
 *
 * `Secure` stays on either way. Chrome and Firefox accept it on
 * http://localhost; any other plain-HTTP origin drops the cookie and the
 * sign-in is refused, which is the intended outcome outside local development.
 */
function cookieName(request: Request, name: string): string {
  return new URL(request.url).protocol === 'https:' ? `__Host-${name}` : name;
}

/** Value of the named cookie on the request, or null. */
export function readCookie(request: Request, name: string): string | null {
  const prefix = `${cookieName(request, name)}=`;
  const target = (request.headers.get('Cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(prefix));
  return target ? target.substring(prefix.length) : null;
}

/** A `Set-Cookie` value. Lax, so the cookie survives the redirect back from Auth0. */
export function setCookie(request: Request, name: string, value: string, maxAgeSeconds: number): string {
  return `${cookieName(request, name)}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearCookie(request: Request, name: string): string {
  return setCookie(request, name, '', 0);
}

/**
 * The cookie that pairs a browser with one consent screen (`consentCookie`) or
 * one Auth0 login (`loginCookie`). The name carries the start of the token, so
 * two sign-ins open in one browser each keep their own cookie; the value is the
 * whole token and is what gets compared.
 */
export function consentCookie(token: string): string {
  return `${CONSENT_COOKIE}-${token.slice(0, 16)}`;
}

export function loginCookie(state: string): string {
  return `${LOGIN_COOKIE}-${state.slice(0, 16)}`;
}

/** Compare two tokens without stopping at the first differing character. */
export function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

async function getApprovedClientsFromCookie(request: Request, secret: string): Promise<string[] | null> {
  const value = readCookie(request, APPROVED_COOKIE);
  if (!value) return null;

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
  const approved = await getApprovedClientsFromCookie(request, cookieSecret);
  return approved?.includes(clientId) ?? false;
}

/**
 * The `Set-Cookie` value that adds `clientId` to this browser's approved list.
 *
 * The caller decides WHICH client was approved, from the consent record it
 * holds server-side. Nothing here is read from the request body.
 */
export async function approvedClientsCookie(
  request: Request,
  clientId: string,
  cookieSecret: string,
): Promise<string> {
  const existing = (await getApprovedClientsFromCookie(request, cookieSecret)) || [];
  const payload = JSON.stringify(Array.from(new Set([...existing, clientId])));
  const signature = await signData(await importHmacKey(cookieSecret), payload);
  return setCookie(request, APPROVED_COOKIE, `${signature}.${btoa(payload)}`, ONE_YEAR_IN_SECONDS);
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
  /** Where the authorization code is sent once the user signs in. */
  redirectUri: string;
  /** Opaque handle for the pending request; also set as the consent cookie. */
  consentToken: string;
  /** Lifetime of the pending request, seconds. */
  ttlSeconds: number;
}

/**
 * Render the consent screen for a first-time MCP client.
 *
 * MCP clients register themselves, so the name on this page is whatever the
 * registrant typed. The page therefore says so, and shows the one thing the
 * registrant cannot dress up: where access is sent. The form carries only the
 * consent token, and the same token is set as a cookie so an approval counts
 * only from the browser that was shown this page. The page may not be framed.
 * A consent can be approved once, so the button disables itself on submit.
 */
export function renderApprovalDialog(request: Request, options: ApprovalDialogOptions): Response {
  const { client, server, redirectUri, consentToken, ttlSeconds } = options;
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
    .card { max-width:560px; margin:2rem auto; background:#fff; border-radius:8px; box-shadow:0 8px 36px rgba(0,0,0,.1); padding:2rem; overflow-wrap:anywhere; }
    h1 { font-size:1.3rem; font-weight:600; margin-top:0; }
    .destination { background:#f3f4f6; border-radius:6px; padding:.75rem 1rem; }
    .destination code { display:block; margin-top:.25rem; font-size:.95rem; }
    .notice { font-size:.9rem; color:#555; }
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
    <p class="destination">After you sign in, access is sent to:<code>${sanitizeHtml(redirectUri)}</code></p>
    <p class="notice">The application chose its own name; it is not verified by Tribeunal. Approving lets it act as you: create cases, vote, comment and manage tribes. Approve only if you started this connection yourself and recognise the address above.</p>
    <form method="post" action="${action}" onsubmit="this.querySelector('.primary').disabled=true">
      <input type="hidden" name="consent" value="${sanitizeHtml(consentToken)}">
      <div class="actions">
        <button type="button" class="secondary" onclick="window.history.back()">Cancel</button>
        <button type="submit" class="primary">Approve</button>
      </div>
    </form>
  </div>
</body>
</html>`;

  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  headers.append('Set-Cookie', setCookie(request, consentCookie(consentToken), consentToken, ttlSeconds));
  return new Response(html, { headers });
}
