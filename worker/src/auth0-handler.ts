import type {
  AuthRequest,
  TokenExchangeCallbackOptions,
  TokenExchangeCallbackResult,
} from '@cloudflare/workers-oauth-provider';
import { Hono } from 'hono';
import type { Env, HonoEnv, UserProps } from './types';
import {
  buildAuth0AuthorizeUrl,
  clientIdAlreadyApproved,
  decodeJwtClaims,
  exchangeAuth0Code,
  generatePkcePair,
  parseRedirectApproval,
  randomToken,
  refreshAuth0Token,
  renderApprovalDialog,
} from './oauth-utils';

// How long a pending PKCE transaction is valid for (login round-trip), seconds.
const PKCE_TX_TTL_SECONDS = 600;

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
 */
app.get('/authorize', async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  if (!oauthReqInfo.clientId) {
    return c.text('Invalid request: missing client_id', 400);
  }

  // Skip the consent screen if this MCP client was already approved.
  if (await clientIdAlreadyApproved(c.req.raw, oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
    return redirectToAuth0(c.req.raw, oauthReqInfo, c.env, {});
  }

  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId),
    server: {
      name: 'Tribeunal Remote MCP',
      description: 'Authorize this MCP client to act on your behalf on Tribeunal.',
    },
    state: { oauthReqInfo },
  });
});

/**
 * POST /authorize — the consent screen was approved.
 *
 * Records the client approval (signed cookie) and proceeds to Auth0.
 */
app.post('/authorize', async (c) => {
  const { state, headers } = await parseRedirectApproval(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY);
  if (!state.oauthReqInfo) {
    return c.text('Invalid request', 400);
  }
  return redirectToAuth0(c.req.raw, state.oauthReqInfo, c.env, headers);
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

  return Response.redirect(redirectTo);
});

/**
 * Build the Auth0 authorize redirect, persisting the PKCE verifier + original
 * MCP auth request in KV keyed by the random `state` we send to Auth0.
 */
async function redirectToAuth0(
  request: Request,
  oauthReqInfo: AuthRequest,
  env: Env,
  extraHeaders: Record<string, string>,
): Promise<Response> {
  const { codeVerifier, codeChallenge } = await generatePkcePair();
  const state = randomToken();

  const tx: PkceTransaction = { codeVerifier, oauthReqInfo };
  await env.OAUTH_KV.put(`pkce:${state}`, JSON.stringify(tx), {
    expirationTtl: PKCE_TX_TTL_SECONDS,
  });

  const location = buildAuth0AuthorizeUrl({
    domain: env.AUTH0_DOMAIN,
    clientId: env.AUTH0_CLIENT_ID,
    redirectUri: new URL('/callback', request.url).href,
    scope: env.AUTH0_SCOPE,
    audience: env.AUTH0_AUDIENCE,
    state,
    codeChallenge,
  });

  return new Response(null, {
    status: 302,
    headers: { ...extraHeaders, location },
  });
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

export { app as Auth0Handler };
