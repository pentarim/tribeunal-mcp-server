import type {
  AuthRequest,
  TokenExchangeCallbackOptions,
  TokenExchangeCallbackResult,
} from '@cloudflare/workers-oauth-provider';
import { Hono } from 'hono';
import { PublicFiles } from './public-files';
import type { Env, HonoEnv, UserProps } from './types';
import {
  approvedClientsCookie,
  buildAuth0AuthorizeUrl,
  clearCookie,
  clientIdAlreadyApproved,
  consentCookie,
  decodeJwtClaims,
  exchangeAuth0Code,
  generatePkcePair,
  loginCookie,
  randomToken,
  readCookie,
  refreshAuth0Token,
  renderApprovalDialog,
  sameToken,
  setCookie,
} from './oauth-utils';

// How long a pending PKCE transaction is valid for (login round-trip), seconds.
const PKCE_TX_TTL_SECONDS = 600;
// How long a consent screen may sit open before it must be requested again, seconds.
const CONSENT_TTL_SECONDS = 600;
const INVALID_CONSENT = 'Invalid or expired authorization request. Please restart the connection from your MCP client.';
// The shape of `randomToken()`; anything else never reaches a KV key.
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** KV record persisted between `/authorize` and `/callback` for one login. */
interface PkceTransaction {
  codeVerifier: string;
  oauthReqInfo: AuthRequest;
}

const app = new Hono<HonoEnv>();

/**
 * GET /authorize — entry point from the MCP client.
 *
 * Parses the incoming OAuth request, shows a one-time consent screen for new
 * MCP clients, then redirects the user to Auth0 Universal Login with the
 * audience + scopes from the contract and a PKCE S256 challenge.
 *
 * MCP clients register themselves and Auth0 skips its own consent for the one
 * upstream application, so this screen is the only place a person agrees to a
 * particular client. The request being approved is kept in KV under a random
 * token; the form and a cookie carry the token, never the request.
 */
app.get('/authorize', async (c) => {
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch (error) {
    // The library throws on an unknown client or an unregistered redirect URI.
    return c.text(`Invalid request: ${error instanceof Error ? error.message : 'bad authorization request'}`, 400);
  }
  if (!oauthReqInfo.clientId) {
    return c.text('Invalid request: missing client_id', 400);
  }
  if (!oauthReqInfo.redirectUri) {
    return c.text('Invalid request: missing redirect_uri', 400);
  }
  // OAuth 2.1 and the MCP authorization spec make PKCE mandatory. The library
  // only checks a challenge when one was sent, so its absence is refused here.
  if (!oauthReqInfo.codeChallenge || oauthReqInfo.codeChallengeMethod !== 'S256') {
    return c.text('Invalid request: PKCE is required (code_challenge with code_challenge_method=S256)', 400);
  }

  // Skip the consent screen if this MCP client was already approved.
  if (await clientIdAlreadyApproved(c.req.raw, oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
    return redirectToAuth0(c.req.raw, oauthReqInfo, c.env, []);
  }

  const consentToken = randomToken();
  await c.env.OAUTH_KV.put(`consent:${consentToken}`, JSON.stringify(oauthReqInfo), {
    expirationTtl: CONSENT_TTL_SECONDS,
  });

  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId),
    server: {
      name: 'Tribeunal Remote MCP',
      description: 'Authorize this MCP client to act on your behalf on Tribeunal.',
    },
    redirectUri: oauthReqInfo.redirectUri,
    consentToken,
    ttlSeconds: CONSENT_TTL_SECONDS,
  });
});

/**
 * POST /authorize — the consent screen was approved.
 *
 * Counts only when the posted token matches the consent cookie, i.e. the post
 * comes from the browser that was shown the screen. The request is then read
 * from KV; nothing describing it is accepted from the form. Records the client
 * approval (signed cookie) and proceeds to Auth0.
 */
app.post('/authorize', async (c) => {
  // A body that is not a form answers the same 400 as a missing token.
  const token = (await c.req.formData().catch(() => null))?.get('consent');
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    return c.text(INVALID_CONSENT, 400);
  }
  const cookieToken = readCookie(c.req.raw, consentCookie(token));
  if (!cookieToken || !sameToken(token, cookieToken)) {
    return c.text(INVALID_CONSENT, 400);
  }

  const consentKey = `consent:${token}`;
  const stored = await c.env.OAUTH_KV.get(consentKey);
  if (!stored) {
    return c.text(INVALID_CONSENT, 400);
  }
  await c.env.OAUTH_KV.delete(consentKey);
  const oauthReqInfo = JSON.parse(stored) as AuthRequest;

  return redirectToAuth0(c.req.raw, oauthReqInfo, c.env, [
    await approvedClientsCookie(c.req.raw, oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY),
    clearCookie(c.req.raw, consentCookie(token)),
  ]);
});

/**
 * GET /callback — Auth0 redirects here with `?code=...&state=...`.
 *
 * Looks up the PKCE transaction, exchanges the code for Auth0 tokens, extracts
 * the user's `sub`/`email`, and completes the MCP authorization, persisting the
 * Auth0 tokens into the (encrypted) grant props.
 */
app.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const errorParam = c.req.query('error');

  if (errorParam) {
    return c.text(`Auth0 returned an error: ${errorParam} ${c.req.query('error_description') ?? ''}`, 400);
  }
  if (!code || !state) {
    return c.text('Invalid callback: missing code or state', 400);
  }

  // The login must finish in the browser that started it. Without this, a
  // login URL prepared in one browser could be completed by someone else's.
  const startedHere = TOKEN_PATTERN.test(state) ? readCookie(c.req.raw, loginCookie(state)) : null;
  if (!startedHere || !sameToken(startedHere, state)) {
    return c.text('This login was not started in this browser. Please restart the connection from your MCP client.', 400);
  }

  // Retrieve and consume the one-time PKCE transaction.
  const txKey = `pkce:${state}`;
  const txRaw = await c.env.OAUTH_KV.get(txKey);
  if (!txRaw) {
    return c.text('Invalid or expired login transaction. Please restart the login.', 400);
  }
  await c.env.OAUTH_KV.delete(txKey);
  const tx = JSON.parse(txRaw) as PkceTransaction;

  // Exchange the authorization code for Auth0 tokens (audience-restricted).
  const tokenSet = await exchangeAuth0Code({
    domain: c.env.AUTH0_DOMAIN,
    clientId: c.env.AUTH0_CLIENT_ID,
    clientSecret: c.env.AUTH0_CLIENT_SECRET,
    code,
    redirectUri: new URL('/callback', c.req.url).href,
    codeVerifier: tx.codeVerifier,
  });

  // Identify the user from the id_token (falls back to access-token claims).
  const claims = decodeJwtClaims(tokenSet.id_token ?? tokenSet.access_token);
  const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  if (!sub) {
    return c.text('Auth0 did not return a subject (sub) claim.', 400);
  }
  const email = typeof claims.email === 'string' ? claims.email : undefined;

  const props: UserProps = {
    sub,
    email,
    upstreamAccessToken: tokenSet.access_token,
    upstreamRefreshToken: tokenSet.refresh_token,
    upstreamExpiresIn: tokenSet.expires_in,
  };

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: tx.oauthReqInfo,
    userId: sub,
    metadata: { email },
    scope: tx.oauthReqInfo.scope,
    props,
  });

  return new Response(null, {
    status: 302,
    headers: { location: redirectTo, 'Set-Cookie': clearCookie(c.req.raw, loginCookie(state)) },
  });
});

/**
 * Build the Auth0 authorize redirect, persisting the PKCE verifier + original
 * MCP auth request in KV keyed by the random `state` we send to Auth0. The
 * same `state` is set as a cookie, which `/callback` requires back.
 */
async function redirectToAuth0(
  request: Request,
  oauthReqInfo: AuthRequest,
  env: Env,
  cookies: string[],
): Promise<Response> {
  const { codeVerifier, codeChallenge } = await generatePkcePair();
  const state = randomToken();

  const tx: PkceTransaction = { codeVerifier, oauthReqInfo };
  await env.OAUTH_KV.put(`pkce:${state}`, JSON.stringify(tx), {
    expirationTtl: PKCE_TX_TTL_SECONDS,
  });

  const headers = new Headers({
    location: buildAuth0AuthorizeUrl({
      domain: env.AUTH0_DOMAIN,
      clientId: env.AUTH0_CLIENT_ID,
      redirectUri: new URL('/callback', request.url).href,
      scope: env.AUTH0_SCOPE,
      audience: env.AUTH0_AUDIENCE,
      state,
      codeChallenge,
    }),
  });
  for (const cookie of [...cookies, setCookie(request, loginCookie(state), state, PKCE_TX_TTL_SECONDS)]) {
    headers.append('Set-Cookie', cookie);
  }

  return new Response(null, { status: 302, headers });
}

/**
 * OAuthProvider token-exchange hook.
 *
 * - authorization_code: mirror the MCP access-token TTL to the Auth0 token's
 *   `expires_in`, and persist the Auth0 tokens into the grant props.
 * - refresh_token: refresh the upstream Auth0 token too, so the forwarded
 *   Bearer stays valid, and update both props and the MCP token TTL.
 *
 * `env` is injected by the provider via a closure created in `index.ts`.
 */
export function makeTokenExchangeCallback(env: Env) {
  return async function tokenExchangeCallback(
    options: TokenExchangeCallbackOptions,
  ): Promise<TokenExchangeCallbackResult | void> {
    const props = options.props as UserProps;

    if (options.grantType === 'authorization_code') {
      return {
        accessTokenTTL: props.upstreamExpiresIn,
        newProps: { ...props },
      };
    }

    if (options.grantType === 'refresh_token') {
      const refreshToken = props.upstreamRefreshToken;
      if (!refreshToken) {
        throw new Error('No Auth0 refresh token stored for this grant.');
      }

      const tokenSet = await refreshAuth0Token({
        domain: env.AUTH0_DOMAIN,
        clientId: env.AUTH0_CLIENT_ID,
        clientSecret: env.AUTH0_CLIENT_SECRET,
        refreshToken,
      });

      const claims = decodeJwtClaims(tokenSet.id_token ?? tokenSet.access_token);

      const newProps: UserProps = {
        ...props,
        sub: typeof claims.sub === 'string' ? claims.sub : props.sub,
        email: typeof claims.email === 'string' ? claims.email : props.email,
        upstreamAccessToken: tokenSet.access_token,
        // Auth0 rotates refresh tokens; keep the new one, fall back to the old.
        upstreamRefreshToken: tokenSet.refresh_token ?? refreshToken,
        upstreamExpiresIn: tokenSet.expires_in,
      };

      return {
        accessTokenTTL: tokenSet.expires_in,
        newProps,
      };
    }
  };
}

app.route('/', PublicFiles);
export { app as Auth0Handler };
